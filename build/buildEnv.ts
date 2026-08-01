/**
 * Build-time environment validation and CSP generation.
 *
 * Kept in its own module, free of any Vite or Node import, so the rules can be
 * exercised directly by the test suite instead of only through a full build.
 *
 * This SUPERSEDES the earlier deliberate decision to delegate CSP entirely to
 * the hosting platform. That decision was made because the Supabase project URL
 * is known only at build time; the reversal is safe now because the build
 * validates that URL and injects it, and fails rather than emitting a policy
 * with unsubstituted markers.
 */

export const CSP_HTTP_MARKER = '__SUPABASE_HTTP_SRC__';
export const CSP_CONNECT_MARKER = '__SUPABASE_CONNECT_SRC__';

export type BuildEnvironment = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

export type ValidatedBuildEnvironment = {
  /** The validated origin, e.g. `https://project.supabase.co`. */
  origin: string;
  /** The websocket origin realtime actually connects to. */
  websocketOrigin: string;
};

export class BuildEnvironmentError extends Error {}

function fail(message: string): never {
  throw new BuildEnvironmentError(`[gomsinlog] build aborted: ${message}`);
}

/**
 * A production build with no Supabase configuration used to succeed and emit a
 * permanently demo-mode artifact. It now fails, naming the missing variable.
 */
export function validateBuildEnvironment(env: BuildEnvironment): ValidatedBuildEnvironment {
  const rawUrl = (env.VITE_SUPABASE_URL || '').trim();
  if (!rawUrl) fail('VITE_SUPABASE_URL is missing or empty.');

  // The `VITE_SUPABASE_ANON_KEY` fallback is load-bearing: `src/lib/supabase.ts`
  // already accepts it, so a build that only sets it must keep working.
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!key) {
    fail('VITE_SUPABASE_PUBLISHABLE_KEY is missing or empty (VITE_SUPABASE_ANON_KEY is also accepted).');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail(`VITE_SUPABASE_URL is not a valid URL: ${rawUrl}`);
  }

  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLoopback) {
    fail(
      `VITE_SUPABASE_URL must use https (got ${parsed.protocol}//${parsed.hostname}); `
      + 'only localhost and 127.0.0.1 may use http.',
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    fail(`VITE_SUPABASE_URL must be an http(s) URL (got ${parsed.protocol}).`);
  }

  return {
    origin: parsed.origin,
    websocketOrigin: `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`,
  };
}

/**
 * Substitute the marker tokens in a `_headers` file.
 *
 * Throws when a marker survives, so a policy containing a literal
 * `__SUPABASE_CONNECT_SRC__` can never be shipped.
 */
export function injectCspOrigins(
  headers: string,
  validated: ValidatedBuildEnvironment,
): string {
  const injected = headers
    .split(CSP_HTTP_MARKER).join(validated.origin)
    .split(CSP_CONNECT_MARKER).join(`${validated.origin} ${validated.websocketOrigin}`);
  for (const marker of [CSP_HTTP_MARKER, CSP_CONNECT_MARKER]) {
    if (injected.includes(marker)) {
      fail(`CSP marker ${marker} survived substitution in _headers.`);
    }
  }
  return injected;
}
