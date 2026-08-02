import { describe, expect, it, vi } from 'vitest';
import {
  classifyServerError,
  isAuthExpired,
  isRetryableKind,
  serverErrorMessage,
  type ServerErrorKind,
} from '@/lib/serverErrors';

const ALL_KINDS: ServerErrorKind[] = [
  'auth_expired',
  'forbidden',
  'not_found',
  'offline',
  'server',
  'unknown',
];

describe('classifyServerError', () => {
  it('classifies PGRST301 as an expired session', () => {
    const result = classifyServerError({ code: 'PGRST301', message: 'JWT expired' }, { online: true });
    expect(result.kind).toBe('auth_expired');
    expect(result.message).toContain('세션이 만료');
  });

  it('classifies HTTP 401 as an expired session', () => {
    expect(classifyServerError({ status: 401 }, { online: true }).kind).toBe('auth_expired');
  });

  it('classifies a JWT expiry message with no code as an expired session', () => {
    expect(
      classifyServerError({ message: 'JWT expired' }, { online: true }).kind,
    ).toBe('auth_expired');
    expect(
      classifyServerError({ message: 'invalid token supplied' }, { online: true }).kind,
    ).toBe('auth_expired');
  });

  it('classifies 42501 as forbidden, not as a connection problem', () => {
    const result = classifyServerError(
      { code: '42501', message: 'new row violates row-level security policy' },
      { online: true },
    );
    expect(result.kind).toBe('forbidden');
    expect(result.message).not.toContain('인터넷');
  });

  it('classifies HTTP 403 as forbidden', () => {
    expect(classifyServerError({ status: 403 }, { online: true }).kind).toBe('forbidden');
  });

  it('classifies PGRST116 and HTTP 404 as not found', () => {
    expect(classifyServerError({ code: 'PGRST116' }, { online: true }).kind).toBe('not_found');
    expect(classifyServerError({ status: 404 }, { online: true }).kind).toBe('not_found');
  });

  it('classifies an undeployed RPC (PGRST202) as a server problem', () => {
    const result = classifyServerError({ code: 'PGRST202' }, { online: true });
    expect(result.kind).toBe('server');
    expect(result.message).not.toContain('인터넷');
  });

  it('classifies HTTP 5xx as a server problem', () => {
    expect(classifyServerError({ status: 500 }, { online: true }).kind).toBe('server');
    expect(classifyServerError({ status: 503 }, { online: true }).kind).toBe('server');
  });

  it('classifies an offline device as offline whatever the error looks like', () => {
    expect(classifyServerError(new Error('boom'), { online: false }).kind).toBe('offline');
    expect(classifyServerError({ status: 500 }, { online: false }).kind).toBe('offline');
  });

  it('classifies a bare fetch failure as offline even when the browser claims to be online', () => {
    const result = classifyServerError(new TypeError('Failed to fetch'), { online: true });
    expect(result.kind).toBe('offline');
  });

  it('keeps an authoritative auth/permission answer even when the flag says offline', () => {
    // The server demonstrably answered, so "you are offline" would be a lie and
    // would hide the real, actionable cause.
    expect(
      classifyServerError({ code: 'PGRST301' }, { online: false }).kind,
    ).toBe('auth_expired');
    expect(
      classifyServerError({ code: '42501' }, { online: false }).kind,
    ).toBe('forbidden');
  });

  it('falls back to unknown rather than inventing a cause', () => {
    const result = classifyServerError({ code: 'XX000', message: 'internal' }, { online: true });
    expect(result.kind).toBe('unknown');
    expect(result.message).not.toContain('인터넷');
  });

  it('accepts a plain string and a null error without throwing', () => {
    expect(classifyServerError('JWT expired', { online: true }).kind).toBe('auth_expired');
    expect(classifyServerError(null, { online: true }).kind).toBe('unknown');
    expect(classifyServerError(undefined, { online: true }).kind).toBe('unknown');
  });

  it('reads navigator.onLine when no override is supplied', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(classifyServerError(new Error('boom')).kind).toBe('offline');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('serverErrorMessage', () => {
  it('supplies non-empty Korean copy for every kind', () => {
    for (const kind of ALL_KINDS) {
      expect(serverErrorMessage(kind).length).toBeGreaterThan(0);
    }
  });

  it('never mentions 인터넷 연결 for a cause that is not offline', () => {
    // This is the whole point of the module: an authorization or session failure
    // must never be reported as a connectivity failure.
    for (const kind of ALL_KINDS) {
      if (kind === 'offline') {
        expect(serverErrorMessage(kind)).toContain('인터넷 연결');
        continue;
      }
      expect(serverErrorMessage(kind)).not.toContain('인터넷');
      expect(serverErrorMessage(kind)).not.toContain('연결을 확인');
    }
  });
});

describe('kind predicates', () => {
  it('flags only auth_expired as an auth loss', () => {
    for (const kind of ALL_KINDS) {
      expect(isAuthExpired(kind)).toBe(kind === 'auth_expired');
    }
  });

  it('does not offer a retry for causes a retry cannot fix', () => {
    expect(isRetryableKind('offline')).toBe(true);
    expect(isRetryableKind('server')).toBe(true);
    expect(isRetryableKind('unknown')).toBe(true);
    expect(isRetryableKind('forbidden')).toBe(false);
    expect(isRetryableKind('not_found')).toBe(false);
    expect(isRetryableKind('auth_expired')).toBe(false);
  });
});
