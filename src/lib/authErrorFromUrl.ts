/**
 * Read an OAuth failure that GoTrue reported on the CURRENT url, wherever it landed.
 *
 * ## The bug this exists for
 *
 * `AuthCallbackPage` handles `?error=...` correctly, but it only ever runs on
 * `/auth/callback` -- and a failing Google sign-in does not come back there. GoTrue
 * redirects a SUCCESSFUL exchange to the requested `redirect_to`, and sends a FAILED
 * one to the project's Site URL instead. Measured against the live project:
 *
 *   /auth/v1/callback?code=bad&state=bad
 *     -> https://gomsin-log.vercel.app?error=invalid_request
 *        &error_code=bad_oauth_state&error_description=OAuth+state+parameter+is+invalid
 *
 * That is the app root. Nothing there read those parameters, so the user was
 * returned to the login screen with no message at all -- the app looked like it had
 * simply ignored the attempt, which is the worst possible failure for the very first
 * thing a new user does.
 *
 * ## Why a shared reader rather than one more copy
 *
 * The same failure can arrive on at least three surfaces: the callback route, the
 * login screen, and the onboarding wizard (any of which may be what `/` renders,
 * depending on session state). Duplicating the parsing invites exactly the drift
 * that produced this bug, where one surface knew about `error_code` and another did
 * not.
 */

/** Parameters GoTrue uses, in both the query string and the fragment. */
const ERROR_KEYS = ['error', 'error_code'] as const;

export interface AuthUrlError {
  /** The raw code, kept for logging rather than for display. */
  code: string;
  /** Korean copy safe to show a user. */
  message: string;
}

/**
 * Implicit-flow responses put everything in the fragment; PKCE errors arrive in the
 * query string. Both are checked, query first, because a fragment can survive a
 * redirect chain and go stale.
 */
function readParam(url: URL, name: string): string | null {
  const fromQuery = url.searchParams.get(name);
  if (fromQuery) return fromQuery;
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash).get(name);
}

/**
 * Map a GoTrue error code to something a person can act on.
 *
 * The distinction that matters is "you cancelled" versus "something is misconfigured
 * or expired", because the first needs no action and the second means retrying the
 * same way will fail the same way. `bad_oauth_state` is called out separately: it is
 * what a stale or reused callback link produces, and telling the user to start again
 * from the app is the only thing that actually resolves it.
 */
function messageFor(code: string, description: string | null): string {
  if (code === 'access_denied') return '로그인이 취소되었어요. 다시 시도해 주세요.';
  if (code === 'bad_oauth_state' || code === 'invalid_request') {
    return '로그인 링크가 만료되었어요. 앱에서 다시 시도해 주세요.';
  }
  if (code === 'server_error' || code === 'unexpected_failure') {
    return '로그인 서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
  }
  if (description?.toLowerCase().includes('expired')) {
    return '로그인 링크가 만료되었어요. 다시 시도해 주세요.';
  }
  return '로그인에 실패했어요. 다시 시도해 주세요.';
}

export function readAuthErrorFromUrl(href: string = window.location.href): AuthUrlError | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const key of ERROR_KEYS) {
    const code = readParam(url, key);
    if (code) return { code, message: messageFor(code, readParam(url, 'error_description')) };
  }
  return null;
}

/**
 * Strip the error parameters from the address bar.
 *
 * Without this the message reappears on every reload, and a shared or bookmarked url
 * carries a stale failure forever. `replaceState` rather than a navigation so the
 * back button does not walk back into the error.
 */
export function clearAuthErrorFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of [...ERROR_KEYS, 'error_description']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (url.hash && /(^|&)(error|error_code)=/.test(url.hash.replace(/^#/, ''))) {
      url.hash = '';
      changed = true;
    }
    if (changed) window.history.replaceState({}, '', url.toString());
  } catch {
    // A malformed url is not worth failing over; the message still showed.
  }
}
