import { timingSafeEqual } from 'node:crypto';

/**
 * Shared parser and client boundary for Edge Function admin secret keys.
 *
 * Edge admin clients read the `default` (or specific named) string from the
 * `SUPABASE_SECRET_KEYS` JSON dictionary. Legacy `SUPABASE_SERVICE_ROLE_KEY`
 * fallback is forbidden (no dual read).
 *
 * Missing, invalid JSON, non-object/array, missing/non-string/blank key,
 * or wrong key format (must start with `sb_secret_`) fails closed and returns
 * `null`. Never logs key values, prefixes, lengths, or parse errors.
 */
export function parseNamedSecretKey(
  rawJson: string | null | undefined,
  name: string,
): string | null {
  if (typeof rawJson !== 'string' || !rawJson.trim() || !name) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const key = (parsed as Record<string, unknown>)[name];
    if (
      typeof key !== 'string' ||
      !key.startsWith('sb_secret_') ||
      key.length <= 'sb_secret_'.length ||
      key.slice('sb_secret_'.length).trim().length === 0
    ) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

export function parseAdminSecretKey(rawJson: string | null | undefined): string | null {
  return parseNamedSecretKey(rawJson, 'default');
}

/**
 * Parser and validator for the standalone push scheduler secret (PUSH_SCHEDULER_SECRET).
 *
 * Push scheduling auth uses a high-entropy custom secret distinct from the
 * database service-role / admin keys. This parser enforces a 32-character minimum
 * and rejects surrounding whitespace; the deployment process is responsible for
 * generating the value with a cryptographically secure random source.
 */
export function parseSchedulerSecret(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  if (raw.trim() !== raw) {
    return null;
  }
  if (raw.length < 32) {
    return null;
  }
  return raw;
}

/**
 * Timing-safe string comparison. Hashes inputs with SHA-256 first so length
 * differences do not leak timing information, then compares with timingSafeEqual.
 */
export async function timingSafeEqualSecret(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(provided)));
  const bHash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  return timingSafeEqual(aHash, bHash);
}

/**
 * Custom fetch wrapper for Supabase admin clients.
 *
 * Official Supabase docs require new opaque `sb_secret_` keys on `apikey`, not `Bearer`.
 * Outgoing requests to the Supabase project origin keep `apikey: secretKey`, strip
 * `Authorization` iff it exactly matches `Bearer <secretKey>`, and preserve caller
 * `Authorization` (e.g. `auth.getUser(userToken)`). Outbound requests to external
 * origins are not modified.
 */
export function createAdminClientFetch(
  supabaseUrl: string,
  secretKey: string,
  timeoutMs?: number,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const adminBearer = `Bearer ${secretKey}`;

  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
  ) {
    throw new RangeError('Supabase admin request timeout must be a positive integer');
  }

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let targetUrl: URL;
    try {
      if (typeof input === 'string') {
        targetUrl = new URL(input);
      } else if (input instanceof URL) {
        targetUrl = input;
      } else {
        targetUrl = new URL(input.url);
      }
    } catch {
      return fetch(input, init);
    }

    if (targetUrl.origin === supabaseOrigin) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) {
        const overrideHeaders = new Headers(init.headers);
        overrideHeaders.forEach((value, key) => {
          headers.set(key, value);
        });
      }
      const auth = headers.get('Authorization') ?? headers.get('authorization');
      if (auth && auth.trim() === adminBearer) {
        headers.delete('Authorization');
        headers.delete('authorization');
      }

      if (timeoutMs === undefined) {
        return fetch(input, {
          ...init,
          redirect: 'error',
          headers,
        });
      }

      const controller = new AbortController();
      const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
      if (callerSignal?.aborted) {
        forwardCallerAbort();
      } else {
        callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });
      }
      const timeoutId = setTimeout(() => {
        controller.abort(new DOMException('Supabase admin request timed out', 'TimeoutError'));
      }, timeoutMs);

      return fetch(input, {
        ...init,
        redirect: 'error',
        headers,
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeoutId);
        callerSignal?.removeEventListener('abort', forwardCallerAbort);
      });
    }

    return fetch(input, init);
  };
}

/**
 * Helper factory for creating Supabase admin clients with safe admin fetch options.
 */
export function createAdminClient<
  Fn extends (url: string, key: string, options?: any) => any,
>(
  createClientFn: Fn,
  supabaseUrl: string,
  secretKey: string,
): ReturnType<Fn> {
  return createClientFn(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(supabaseUrl, secretKey) },
  });
}
