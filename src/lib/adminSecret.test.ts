import { describe, it, expect } from 'vitest';
import {
  parseAdminSecretKey,
  parseNamedSecretKey,
  parseSchedulerSecret,
  timingSafeEqualSecret,
  createAdminClientFetch,
  createAdminClient,
} from '../../supabase/functions/_shared/adminSecret.ts';

describe('parseAdminSecretKey - pure parser for SUPABASE_SECRET_KEYS', () => {
  it('returns null on missing, undefined, null, or empty/whitespace strings', () => {
    expect(parseAdminSecretKey(undefined)).toBeNull();
    expect(parseAdminSecretKey(null)).toBeNull();
    expect(parseAdminSecretKey('')).toBeNull();
    expect(parseAdminSecretKey('   ')).toBeNull();
    expect(parseAdminSecretKey('\n\t')).toBeNull();
  });

  it('returns null on malformed JSON without throwing', () => {
    expect(parseAdminSecretKey('{ invalid json')).toBeNull();
    expect(parseAdminSecretKey('{ "default": ')).toBeNull();
    expect(parseAdminSecretKey('not-json-at-all')).toBeNull();
  });

  it('returns null on non-object JSON values (primitives, null)', () => {
    expect(parseAdminSecretKey('123')).toBeNull();
    expect(parseAdminSecretKey('true')).toBeNull();
    expect(parseAdminSecretKey('"sb_secret_string"')).toBeNull();
    expect(parseAdminSecretKey('null')).toBeNull();
  });

  it('returns null on JSON arrays (dictionaries required)', () => {
    expect(parseAdminSecretKey('[]')).toBeNull();
    expect(parseAdminSecretKey('["sb_secret_in_array"]')).toBeNull();
    expect(parseAdminSecretKey('[{ "default": "sb_secret_nested" }]')).toBeNull();
  });

  it('returns null when default property is missing or non-string', () => {
    expect(parseAdminSecretKey('{}')).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ primary: 'sb_secret_primary' }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: 12345 }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: true }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: null }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: {} }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: [] }))).toBeNull();
  });

  it('returns null when default value is blank or prefix-only', () => {
    expect(parseAdminSecretKey(JSON.stringify({ default: '' }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: '   ' }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: 'sb_secret_' }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: 'sb_secret_   ' }))).toBeNull();
  });

  it('rejects legacy service_role keys, JWTs, and publishable keys', () => {
    expect(parseAdminSecretKey(JSON.stringify({ default: 'service-role-key' }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({
      default: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig',
    }))).toBeNull();
    expect(parseAdminSecretKey(JSON.stringify({ default: 'sb_publishable_key_123' }))).toBeNull();
  });

  it('accepts valid JSON dictionary with default key starting with sb_secret_', () => {
    expect(parseAdminSecretKey(JSON.stringify({ default: 'sb_secret_valid_admin_token' })))
      .toBe('sb_secret_valid_admin_token');
  });

  it('reads only the default key and ignores extra dictionary keys', () => {
    expect(parseAdminSecretKey(JSON.stringify({
      default: 'sb_secret_primary_key',
      secondary: 'sb_secret_other_key',
      rotated_at: 1800000000,
    }))).toBe('sb_secret_primary_key');
  });
});

describe('parseNamedSecretKey - parser for named keys in SUPABASE_SECRET_KEYS', () => {
  it('returns null on missing, undefined, null, or empty key names', () => {
    const validDict = JSON.stringify({ push: 'sb_secret_push_123', default: 'sb_secret_def' });
    expect(parseNamedSecretKey(validDict, '')).toBeNull();
    expect(parseNamedSecretKey(undefined, 'push')).toBeNull();
    expect(parseNamedSecretKey(null, 'push')).toBeNull();
  });

  it('extracts the specified named secret', () => {
    const dict = JSON.stringify({
      default: 'sb_secret_default_key',
      push: 'sb_secret_push_key_abc',
    });
    expect(parseNamedSecretKey(dict, 'push')).toBe('sb_secret_push_key_abc');
    expect(parseNamedSecretKey(dict, 'default')).toBe('sb_secret_default_key');
    expect(parseNamedSecretKey(dict, 'unknown')).toBeNull();
  });

  it('fails closed on invalid key format for named key', () => {
    const dict = JSON.stringify({
      push: 'legacy_service_key',
      default: 'sb_secret_valid',
    });
    expect(parseNamedSecretKey(dict, 'push')).toBeNull();
  });
});

describe('parseSchedulerSecret - parser for standalone PUSH_SCHEDULER_SECRET', () => {
  it('returns null on missing, undefined, null, empty, or whitespace-only strings', () => {
    expect(parseSchedulerSecret(undefined)).toBeNull();
    expect(parseSchedulerSecret(null)).toBeNull();
    expect(parseSchedulerSecret('')).toBeNull();
    expect(parseSchedulerSecret('   ')).toBeNull();
    expect(parseSchedulerSecret('\t\n')).toBeNull();
  });

  it('returns null on low-entropy strings (< 32 characters)', () => {
    expect(parseSchedulerSecret('short-secret')).toBeNull();
    expect(parseSchedulerSecret('1234567890123456789012345678901')).toBeNull();
  });

  it('rejects secrets with leading or trailing whitespace rather than silently trimming', () => {
    const validSecret = 'high_entropy_custom_scheduler_secret_32_characters_long';
    expect(parseSchedulerSecret('  ' + validSecret)).toBeNull();
    expect(parseSchedulerSecret(validSecret + '  ')).toBeNull();
    expect(parseSchedulerSecret('\n' + validSecret)).toBeNull();
  });

  it('returns exact secret for high-entropy strings (>= 32 characters) without whitespace', () => {
    const validSecret = 'high_entropy_custom_scheduler_secret_32_characters_long';
    expect(parseSchedulerSecret(validSecret)).toBe(validSecret);
  });
});

describe('timingSafeEqualSecret - constant-time string comparison', () => {
  it('returns true for matching strings', async () => {
    expect(await timingSafeEqualSecret('sb_secret_match', 'sb_secret_match')).toBe(true);
  });

  it('returns false for non-matching strings of equal length', async () => {
    expect(await timingSafeEqualSecret('sb_secret_aaaa', 'sb_secret_bbbb')).toBe(false);
  });

  it('returns false for strings of different lengths', async () => {
    expect(await timingSafeEqualSecret('sb_secret_short', 'sb_secret_much_longer_string')).toBe(false);
    expect(await timingSafeEqualSecret('', 'sb_secret_something')).toBe(false);
  });
});

describe('createAdminClientFetch - safe header rewriting for admin clients', () => {
  const SUPABASE_URL = 'https://mock-project.supabase.co';
  const SECRET_KEY = 'sb_secret_test_admin_key_999';

  it('forces redirect: error on same-origin Supabase requests', async () => {
    const customFetch = createAdminClientFetch(SUPABASE_URL, SECRET_KEY);
    let seenInit: RequestInit | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenInit = init;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      await customFetch(SUPABASE_URL + '/rest/v1/some_table', {
        headers: { apikey: SECRET_KEY },
      });

      expect(seenInit?.redirect).toBe('error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accepts Request instance as input and applies init.headers overrides', async () => {
    const customFetch = createAdminClientFetch(SUPABASE_URL, SECRET_KEY);
    let seenHeaders: Headers | undefined;
    let seenInit: RequestInit | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenInit = init;
      seenHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const req = new Request(SUPABASE_URL + '/rest/v1/items', {
        headers: {
          'x-base-header': 'base-value',
          'x-override-me': 'old-value',
          Authorization: 'Bearer ' + SECRET_KEY,
        },
      });

      await customFetch(req, {
        headers: {
          'x-override-me': 'new-value',
          'x-extra-header': 'extra-value',
        },
      });

      expect(seenInit?.redirect).toBe('error');
      expect(seenHeaders?.get('x-base-header')).toBe('base-value');
      expect(seenHeaders?.get('x-override-me')).toBe('new-value');
      expect(seenHeaders?.get('x-extra-header')).toBe('extra-value');
      expect(seenHeaders?.get('Authorization')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('strips Authorization when it exactly matches Bearer <secretKey> and preserves apikey', async () => {
    const customFetch = createAdminClientFetch(SUPABASE_URL, SECRET_KEY);
    let seenHeaders: Headers | undefined;

    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      await customFetch(`${SUPABASE_URL}/rest/v1/some_table`, {
        headers: {
          apikey: SECRET_KEY,
          Authorization: `Bearer ${SECRET_KEY}`,
        },
      });

      expect(seenHeaders?.get('apikey')).toBe(SECRET_KEY);
      expect(seenHeaders?.get('Authorization')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves Authorization when it holds a caller user token', async () => {
    const customFetch = createAdminClientFetch(SUPABASE_URL, SECRET_KEY);
    let seenHeaders: Headers | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const userJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.user_payload.sig';
      await customFetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: SECRET_KEY,
          Authorization: `Bearer ${userJwt}`,
        },
      });

      expect(seenHeaders?.get('apikey')).toBe(SECRET_KEY);
      expect(seenHeaders?.get('Authorization')).toBe(`Bearer ${userJwt}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not alter headers for outbound requests to non-Supabase origins', async () => {
    const customFetch = createAdminClientFetch(SUPABASE_URL, SECRET_KEY);
    let seenHeaders: Headers | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      await customFetch('https://fcm.googleapis.com/v1/projects/my-project/messages:send', {
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
        },
      });

      expect(seenHeaders?.get('Authorization')).toBe(`Bearer ${SECRET_KEY}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('createAdminClient instantiates client with correct auth and global fetch options', () => {
    let passedUrl = '';
    let passedKey = '';
    let passedOptions: Record<string, unknown> | undefined;

    const mockCreateClient = (url: string, key: string, options?: unknown) => {
      passedUrl = url;
      passedKey = key;
      passedOptions = options as Record<string, unknown>;
      return { url, key, options };
    };

    const client = createAdminClient(mockCreateClient, SUPABASE_URL, SECRET_KEY);
    expect(passedUrl).toBe(SUPABASE_URL);
    expect(passedKey).toBe(SECRET_KEY);
    expect(passedOptions?.auth).toEqual({ autoRefreshToken: false, persistSession: false });
    expect(typeof (passedOptions?.global as Record<string, unknown>)?.fetch).toBe('function');
    expect(client).toBeDefined();
  });
});
