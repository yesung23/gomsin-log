/**
 * Explicit CORS allowlist for the Edge Functions.
 *
 * Deliberately pure and free of any `Deno` reference at module scope, so it can
 * be imported and exhaustively tested under vitest/Node. `ALLOWED_ORIGINS` is
 * read by the function entrypoint and passed in.
 *
 * There is no wildcard anywhere in this module, and no suffix or prefix
 * matching: comparison is exact string equality on the `Origin` value.
 */

export type CorsDecision = {
  /** False when `ALLOWED_ORIGINS` is unset/empty. The caller must fail closed. */
  configured: boolean;
  /** True when the request may proceed as far as CORS is concerned. */
  allowed: boolean;
  /** Headers to attach to the response. Always includes `Vary: Origin`. */
  headers: Record<string, string>;
};

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info';

/** Trimmed, non-empty, de-duplicated exact origins. */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const origin = entry.trim();
    if (origin) seen.add(origin);
  }
  return [...seen];
}

/**
 * `Vary: Origin` is emitted unconditionally.
 *
 * A shared cache that stored one origin's response and replayed it for another
 * would defeat the allowlist, so this header is not optional and is threaded
 * through every response shape -- allowed, disallowed, absent-`Origin`,
 * preflight, 401, 405 and 500 alike.
 */
function baseHeaders(): Record<string, string> {
  return { Vary: 'Origin' };
}

export function resolveCors(
  method: string,
  origin: string | null,
  allowlist: string[],
): CorsDecision {
  const headers = baseHeaders();

  // Fail closed: an unconfigured allowlist is a deployment error, never an
  // invitation to fall back to a wildcard.
  if (allowlist.length === 0) {
    return { configured: false, allowed: false, headers };
  }

  // No `Origin` at all: not a browser cross-origin request. Nothing is
  // reflected. Bearer-token verification remains the mandatory control.
  if (origin === null) {
    if (method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS;
      headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS;
    }
    return { configured: true, allowed: true, headers };
  }

  if (!allowlist.includes(origin)) {
    // Deliberately no `Access-Control-Allow-Origin` of any kind.
    return { configured: true, allowed: false, headers };
  }

  headers['Access-Control-Allow-Origin'] = origin;
  if (method === 'OPTIONS') {
    headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS;
    headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS;
  }
  return { configured: true, allowed: true, headers };
}
