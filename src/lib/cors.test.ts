import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAllowedOrigins, resolveCors } from '../../supabase/functions/_shared/cors.ts';
import { handleDeleteAccountRequest } from '../../supabase/functions/delete-account/handler.ts';

/**
 * C2 bug condition:
 *   isBugConditionC2(input) =
 *     origin IS NOT NULL AND origin NOT IN parseAllowedOrigins(env.ALLOWED_ORIGINS)
 *
 * Before the fix the function answered every preflight with
 * `Access-Control-Allow-Origin: '*'` and never sent `Vary: Origin`.
 */

const ALLOWED = 'https://gomsinlog.app,https://www.gomsinlog.app';

function makeRequest(method: string, origin: string | null, authorization?: string) {
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  if (authorization) headers.set('Authorization', authorization);
  return new Request('https://edge.example/delete-account', { method, headers });
}

/** Minimal admin double: records the sequence and fails nothing by default. */
function makeAdmin(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const admin = {
    calls,
    auth: {
      getUser: vi.fn(async () => {
        calls.push('auth.getUser');
        return {
          data: { user: { id: 'user-a', app_metadata: { provider: 'google', providers: ['google'] } } },
          error: null,
        };
      }),
      admin: {
        updateUserById: vi.fn(async (_id: string, payload: Record<string, unknown>) => {
          calls.push('auth.admin.updateUserById');
          (admin as unknown as { lastMetadata?: unknown }).lastMetadata = payload.app_metadata;
          return { data: {}, error: null };
        }),
        deleteUser: vi.fn(async () => {
          calls.push('auth.admin.deleteUser');
          return { error: null };
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: async () => {
          calls.push(`from:${table}.select`);
          return { data: [], error: null };
        },
      }),
    }),
    rpc: vi.fn(async (name: string) => {
      calls.push(`rpc:${name}`);
      return { data: name === 'prepare_account_deletion' ? { ok: true } : null, error: null };
    }),
    storage: {
      from: () => ({
        list: async () => {
          calls.push('storage.list');
          return { data: [], error: null };
        },
        remove: async () => {
          calls.push('storage.remove');
          return { error: null };
        },
      }),
    },
    ...overrides,
  };
  return admin;
}

function makeDeps(admin: unknown, env: Record<string, string | undefined> = {}) {
  return {
    env: (key: string) => ({
      ALLOWED_ORIGINS: ALLOWED,
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ...env,
    })[key],
    createAdmin: () => admin,
  };
}

describe('C2 - parseAllowedOrigins', () => {
  it('trims, drops empties, de-duplicates and keeps exact origins', () => {
    expect(parseAllowedOrigins(null)).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
    expect(parseAllowedOrigins('https://a.example')).toEqual(['https://a.example']);
    expect(parseAllowedOrigins(' https://a.example , https://b.example '))
      .toEqual(['https://a.example', 'https://b.example']);
    expect(parseAllowedOrigins('https://a.example,https://a.example'))
      .toEqual(['https://a.example']);
    expect(parseAllowedOrigins('https://a.example,')).toEqual(['https://a.example']);
    expect(parseAllowedOrigins(',,')).toEqual([]);
  });
});

describe('C2 - the clause 2.13 decision table, rows (a) to (g)', () => {
  const allowlist = parseAllowedOrigins(ALLOWED);

  it('(a) an allowlisted OPTIONS reflects the exact origin and advertises the method set', () => {
    const decision = resolveCors('OPTIONS', 'https://gomsinlog.app', allowlist);
    expect(decision).toMatchObject({ configured: true, allowed: true });
    expect(decision.headers['Access-Control-Allow-Origin']).toBe('https://gomsinlog.app');
    expect(decision.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(decision.headers['Access-Control-Allow-Headers'])
      .toBe('authorization, apikey, content-type, x-client-info');
  });

  it('(b) a disallowed OPTIONS is refused with NO Access-Control-Allow-Origin', () => {
    const decision = resolveCors('OPTIONS', 'https://evil.example', allowlist);
    expect(decision.allowed).toBe(false);
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('(c) an absent-Origin OPTIONS is allowed and reflects nothing', () => {
    const decision = resolveCors('OPTIONS', null, allowlist);
    expect(decision.allowed).toBe(true);
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('(d) an allowlisted POST falls through with the origin reflected', () => {
    const decision = resolveCors('POST', 'https://www.gomsinlog.app', allowlist);
    expect(decision.allowed).toBe(true);
    expect(decision.headers['Access-Control-Allow-Origin']).toBe('https://www.gomsinlog.app');
    // Preflight-only headers are not attached to a real request.
    expect(decision.headers['Access-Control-Allow-Methods']).toBeUndefined();
  });

  it('(e) a disallowed POST is refused', () => {
    expect(resolveCors('POST', 'https://evil.example', allowlist).allowed).toBe(false);
  });

  it('(f) an absent-Origin POST is allowed; bearer verification remains the control', () => {
    expect(resolveCors('POST', null, allowlist).allowed).toBe(true);
  });

  it('(g) an unconfigured allowlist fails closed for every method, with no wildcard', () => {
    for (const method of ['OPTIONS', 'POST', 'GET', 'DELETE']) {
      for (const origin of ['https://gomsinlog.app', 'https://evil.example', null]) {
        const decision = resolveCors(method, origin, []);
        expect(decision.configured).toBe(false);
        expect(decision.allowed).toBe(false);
        expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
      }
    }
  });

  it('matches origins by exact equality: no wildcard, suffix or case folding', () => {
    for (const origin of [
      'https://evil-gomsinlog.app', 'https://gomsinlog.app.evil.example',
      'https://gomsinlog.app/', 'http://gomsinlog.app', 'HTTPS://GOMSINLOG.APP',
      'https://sub.gomsinlog.app', '*', 'null',
    ]) {
      expect(resolveCors('POST', origin, allowlist).allowed, origin).toBe(false);
    }
  });

  /** Property: over the whole method x origin x allowlist cross product. */
  it('never emits a wildcard, always emits Vary: Origin, never reflects a disallowed origin', () => {
    const methods = ['OPTIONS', 'POST', 'GET', 'PUT', 'DELETE', 'HEAD', 'PATCH'];
    const origins = [
      null, 'https://gomsinlog.app', 'https://www.gomsinlog.app', 'https://evil.example',
      'HTTPS://GOMSINLOG.APP', 'https://gomsinlog.app/', '', 'not-a-url', '*', 'null',
    ];
    const allowlists = [[], ['https://gomsinlog.app'], parseAllowedOrigins(ALLOWED)];
    let checked = 0;
    for (const method of methods) {
      for (const origin of origins) {
        for (const list of allowlists) {
          const decision = resolveCors(method, origin, list);
          const label = `${method} ${origin} [${list.join('|')}]`;
          expect(decision.headers.Vary, label).toBe('Origin');
          expect(Object.values(decision.headers), label).not.toContain('*');
          if (!list.includes(origin as string)) {
            expect(decision.headers['Access-Control-Allow-Origin'], label).toBeUndefined();
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(methods.length * origins.length * allowlists.length);
  });
});

describe('C2 - the delete-account function applies the table end to end', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('answers a disallowed preflight with 403, no reflection and Vary: Origin', async () => {
    const admin = makeAdmin();
    const response = await handleDeleteAccountRequest(
      makeRequest('OPTIONS', 'https://evil.example'),
      makeDeps(admin),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
    // Refused before any authentication or admin-client work.
    expect(admin.calls).toEqual([]);
  });

  it('answers an allowlisted preflight with 200 and the exact origin', async () => {
    const response = await handleDeleteAccountRequest(
      makeRequest('OPTIONS', 'https://gomsinlog.app'),
      makeDeps(makeAdmin()),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://gomsinlog.app');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('refuses a disallowed POST before authentication and mutates nothing', async () => {
    const admin = makeAdmin();
    const response = await handleDeleteAccountRequest(
      makeRequest('POST', 'https://evil.example', 'Bearer token'),
      makeDeps(admin),
    );
    expect(response.status).toBe(403);
    expect(admin.calls).toEqual([]);
  });

  it('fails closed with 500 when ALLOWED_ORIGINS is unset, for every method', async () => {
    for (const method of ['OPTIONS', 'POST', 'GET']) {
      const admin = makeAdmin();
      const response = await handleDeleteAccountRequest(
        makeRequest(method, 'https://gomsinlog.app', 'Bearer token'),
        makeDeps(admin, { ALLOWED_ORIGINS: undefined }),
      );
      expect(response.status, method).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin'), method).toBeNull();
      expect(response.headers.get('Vary'), method).toBe('Origin');
      expect(admin.calls, method).toEqual([]);
    }
  });

  it('sends Vary: Origin on 401, 405 and 500 responses', async () => {
    const unauthenticated = await handleDeleteAccountRequest(
      makeRequest('POST', 'https://gomsinlog.app'),
      makeDeps(makeAdmin()),
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('Vary')).toBe('Origin');

    const wrongMethod = await handleDeleteAccountRequest(
      makeRequest('GET', 'https://gomsinlog.app', 'Bearer token'),
      makeDeps(makeAdmin()),
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('Vary')).toBe('Origin');

    const misconfigured = await handleDeleteAccountRequest(
      makeRequest('POST', 'https://gomsinlog.app', 'Bearer token'),
      makeDeps(makeAdmin(), { SUPABASE_SERVICE_ROLE_KEY: undefined }),
    );
    expect(misconfigured.status).toBe(500);
    expect(misconfigured.headers.get('Vary')).toBe('Origin');
  });

  it('PRESERVATION: bearer verification is still mandatory for an allowlisted origin', async () => {
    const admin = makeAdmin({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'expired' } })),
        admin: { updateUserById: vi.fn(), deleteUser: vi.fn() },
      },
    });
    const response = await handleDeleteAccountRequest(
      makeRequest('POST', 'https://gomsinlog.app', 'Bearer expired'),
      makeDeps(admin),
    );
    expect(response.status).toBe(401);
    expect((admin.auth.admin.updateUserById as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('PRESERVATION: an absent-Origin POST still runs the whole deletion sequence', async () => {
    const admin = makeAdmin();
    const response = await handleDeleteAccountRequest(
      makeRequest('POST', null, 'Bearer token'),
      makeDeps(admin),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, warnings: [] });
    // The sequence and its relative order are unchanged. C2 reorders, removes
    // and re-semanticises nothing; the exact step list including the
    // pending-flag write is pinned by `deleteAccountFunction.test.ts`.
    expect(admin.calls.filter((call) => call !== 'auth.admin.updateUserById')).toEqual([
      'auth.getUser',
      'from:daily_records.select',
      'rpc:begin_account_deletion',
      'rpc:prepare_account_deletion',
      'auth.admin.deleteUser',
    ]);
  });
});
