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
const APPLE_LOGIN_RELEASE_HOLD_CODE = 'APPLE_LOGIN_RELEASE_HOLD';
const E2EE_DEVICE_PROTECTION_RELEASE_HOLD_CODE = 'E2EE_DEVICE_PROTECTION_RELEASE_HOLD';
const APPLE_IAP_SALE_RELEASE_HOLD_CODE = 'APPLE_IAP_SALE_RELEASE_HOLD';

export type BuildEnvironment = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_LEGAL_OPERATOR_NAME?: string;
  VITE_PRIVACY_CONTACT_EMAIL?: string;
  VITE_APPLE_LOGIN_ENABLED?: string;
  VITE_E2EE_DEVICE_PROTECTION_ENABLED?: string;
  VITE_APPLE_IAP_SALE_ENABLED?: string;
  /** Vite mode for build-only safety gates; ordinary local validation may omit it. */
  buildMode?: string;
  /** Vercel sets this to `production` only for the public production target. */
  deploymentTarget?: string;
  /** Explicit release signal (e.g. GOMSINLOG_RELEASE=true or build:release command). */
  isRelease?: boolean;
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
  const isProductionTarget = env.deploymentTarget === 'production' || env.isRelease === true;
  const isAppleReleaseTarget = env.buildMode === 'production' || isProductionTarget;
  if (isAppleReleaseTarget && env.VITE_APPLE_LOGIN_ENABLED === 'true') {
    fail(
      `${APPLE_LOGIN_RELEASE_HOLD_CODE}: VITE_APPLE_LOGIN_ENABLED=true is blocked in production/release builds. `
      + 'Remove this fuse only in a separately reviewed activation commit after same-email silent-merge '
      + 'prevention, the Apple token custody/revocation ledger, and native AuthenticationServices are verified.',
    );
  }
  if (isAppleReleaseTarget && env.VITE_E2EE_DEVICE_PROTECTION_ENABLED === 'true') {
    fail(
      `${E2EE_DEVICE_PROTECTION_RELEASE_HOLD_CODE}: `
      + 'VITE_E2EE_DEVICE_PROTECTION_ENABLED=true is blocked in production/release builds. '
      + 'Remove this fuse only in a separately reviewed activation commit after every reachable '
      + 'E2EE ceremony holds an operation-lifetime account-deletion barrier, exact-user race tests '
      + 'pass, and migration 076 is verified on the target environment.',
    );
  }
  if (isAppleReleaseTarget && env.VITE_APPLE_IAP_SALE_ENABLED === 'true') {
    fail(
      `${APPLE_IAP_SALE_RELEASE_HOLD_CODE}: VITE_APPLE_IAP_SALE_ENABLED=true is blocked in production/release builds. `
      + 'Remove this fuse only in a separately reviewed activation commit after migrations 077-079, '
      + 'App Store Server Notification and consumption-response secrets, consent text, server-owned '
      + 'fulfilment evidence, Sandbox refund flows, and App Review readiness are verified on the target.',
    );
  }
  if (isProductionTarget) {
    const operatorName = (env.VITE_LEGAL_OPERATOR_NAME || '').trim();
    const privacyEmail = (env.VITE_PRIVACY_CONTACT_EMAIL || '').trim();
    if (!operatorName || /^(?:your-name-or-business-name|곰신로그 운영자)$/i.test(operatorName)) {
      fail('VITE_LEGAL_OPERATOR_NAME must contain the real person or business operating the production service.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail) || privacyEmail === 'privacy@example.com') {
      fail('VITE_PRIVACY_CONTACT_EMAIL must contain a real monitored privacy-contact email for production.');
    }

    const prodPublishableKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
    if (!prodPublishableKey) {
      fail(
        'VITE_SUPABASE_PUBLISHABLE_KEY is required for production builds. '
        + 'VITE_SUPABASE_ANON_KEY fallback is forbidden for production deployments.',
      );
    }
    if (!prodPublishableKey.startsWith('sb_publishable_') || prodPublishableKey.length <= 'sb_publishable_'.length) {
      fail(
        'Production deployment requires VITE_SUPABASE_PUBLISHABLE_KEY to use the `sb_publishable_` format. '
        + 'Legacy JWT and anon key fallbacks cannot be used for production artifacts.',
      );
    }
  }

  const rawUrl = (env.VITE_SUPABASE_URL || '').trim();
  if (!rawUrl) fail('VITE_SUPABASE_URL is missing or empty.');

  // The `VITE_SUPABASE_ANON_KEY` fallback is load-bearing: `src/lib/supabase.ts`
  // already accepts it, so a build that only sets it must keep working.
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!key) {
    fail('VITE_SUPABASE_PUBLISHABLE_KEY is missing or empty (VITE_SUPABASE_ANON_KEY is also accepted).');
  }

  /*
   * The key must LOOK like a key. Emptiness was the only thing checked here, and a
   * production deployment shipped for hours with the Postgres connection string in
   * this variable instead of the anon JWT:
   *
   *   postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres
   *
   * The build passed, the bundle was emitted, every request then sent that string as
   * `apikey`, and GoTrue answered 401 Invalid API key -- surfacing to the user as
   * "로그인 처리에 실패했습니다" with nothing to distinguish it from a wrong password.
   * The two values sit next to each other in the Supabase dashboard, so this is a
   * copy-paste away at any time.
   *
   * Rejecting a connection string explicitly, rather than only accepting `eyJ`,
   * because the failure deserves a message that names what went wrong. Supabase also
   * issues newer `sb_publishable_...` keys, so both shapes are allowed.
   */
  if (key.startsWith('postgres://') || key.startsWith('postgresql://')) {
    fail(
      'VITE_SUPABASE_PUBLISHABLE_KEY holds a Postgres connection string, not an API key. '
      + 'Copy the `anon public` key from Settings -> API (it starts with `eyJ`), not the '
      + 'database URI. A connection string here makes every request fail with '
      + '401 Invalid API key.',
    );
  }
  const looksLikeJwt = key.startsWith('eyJ') && key.split('.').length === 3;
  const looksLikePublishable = key.startsWith('sb_publishable_');
  if (!looksLikeJwt && !looksLikePublishable) {
    fail(
      'VITE_SUPABASE_PUBLISHABLE_KEY does not look like a Supabase API key. Expected a '
      + 'JWT beginning `eyJ` with three dot-separated parts, or a key beginning '
      + '`sb_publishable_`.',
    );
  }
  /*
   * A service_role key here would be a data breach, not a misconfiguration: every
   * `VITE_` value is inlined into the browser bundle, and that key bypasses RLS. The
   * role claim is readable without verifying the signature, so this is cheap to check
   * and the only place it can be caught before shipping.
   */
  if (looksLikeJwt) {
    let role: string | undefined;
    try {
      /*
       * `atob` rather than `Buffer`: this module is imported by `vite.config.ts` AND
       * by a jsdom test, and `Buffer` is not guaranteed in the second. The first
       * attempt used it and the service_role check silently fell into the catch
       * below -- the guard looked present and enforced nothing.
       *
       * base64url differs from base64 in two characters and drops padding, so both
       * are normalised before decoding.
       */
      const segment = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = segment.padEnd(Math.ceil(segment.length / 4) * 4, '=');
      role = (JSON.parse(atob(padded)) as { role?: string }).role;
    } catch {
      // An unparseable payload is caught by the shape check above; nothing to add.
    }
    /*
     * The `fail()` call is OUTSIDE the try on purpose. It throws, and the first
     * version put it inside -- where the catch swallowed it, so a service_role key
     * passed validation while the guard appeared to be present. Decoding and deciding
     * are separate steps for exactly that reason.
     */
    if (role === 'service_role') {
      fail(
        'VITE_SUPABASE_PUBLISHABLE_KEY is a service_role key. It bypasses every RLS '
        + 'policy and every VITE_ value is inlined into the browser bundle, so shipping '
        + 'it would expose all user data to anyone who opens the app. Use the `anon '
        + 'public` key and rotate this one now.',
      );
    }
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
