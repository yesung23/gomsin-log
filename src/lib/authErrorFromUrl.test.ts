import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearAuthErrorFromUrl, readAuthErrorFromUrl } from '@/lib/authErrorFromUrl';

/**
 * The bug: a failing Google sign-in returned the user to the login screen with no
 * message at all.
 *
 * GoTrue sends a SUCCESSFUL exchange to the requested `redirect_to` and a FAILED one
 * to the project's Site URL. Verified against the live project:
 *
 *   /auth/v1/callback?code=bad&state=bad
 *     -> https://gomsin-log.vercel.app?error=invalid_request
 *        &error_code=bad_oauth_state&error_description=OAuth+state+parameter+is+invalid
 *
 * `AuthCallbackPage` handled those parameters correctly and never received them,
 * because it only mounts on `/auth/callback`. The app root had no reader, so the
 * attempt looked ignored -- on the first screen a new user ever sees.
 */

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('an OAuth failure is legible wherever GoTrue drops it', () => {
  it('reads the query string, which is where a PKCE failure lands', () => {
    const found = readAuthErrorFromUrl(
      'https://gomsin-log.vercel.app/?error=invalid_request&error_code=bad_oauth_state',
    );
    expect(found).not.toBeNull();
    expect(found!.code).toBe('invalid_request');
  });

  it('reads the fragment too, because implicit-flow errors arrive there', () => {
    const found = readAuthErrorFromUrl(
      'https://gomsin-log.vercel.app/auth/callback#error=access_denied&error_code=access_denied',
    );
    expect(found?.code).toBe('access_denied');
  });

  it('returns null for a clean url, so no screen shows a phantom failure', () => {
    expect(readAuthErrorFromUrl('https://gomsin-log.vercel.app/')).toBeNull();
    expect(readAuthErrorFromUrl('https://gomsin-log.vercel.app/?code=abc')).toBeNull();
  });

  it('survives a url it cannot parse instead of throwing on the login screen', () => {
    expect(readAuthErrorFromUrl('not a url at all')).toBeNull();
  });

  it('distinguishes cancelled from broken, because only one of them is worth retrying identically', () => {
    const cancelled = readAuthErrorFromUrl('https://x.test/?error=access_denied');
    const stale = readAuthErrorFromUrl('https://x.test/?error_code=bad_oauth_state');
    const server = readAuthErrorFromUrl('https://x.test/?error=server_error');

    expect(cancelled!.message).toContain('취소');
    // A stale link cannot be fixed by pressing the same button again, so the copy has
    // to send the user back to the app rather than say "try again" and nothing else.
    expect(stale!.message).toContain('만료');
    expect(server!.message).toContain('서버');

    // Three distinct messages, not one generic string.
    expect(new Set([cancelled!.message, stale!.message, server!.message]).size).toBe(3);
  });

  it('falls back to a usable message for a code it has never seen', () => {
    const unknown = readAuthErrorFromUrl('https://x.test/?error=some_new_gotrue_code');
    expect(unknown!.message).toMatch(/로그인/);
  });

  it('reads an expiry hint out of the description when the code is unhelpful', () => {
    const found = readAuthErrorFromUrl(
      'https://x.test/?error=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(found!.message).toContain('만료');
  });
});

describe('the error is cleared from the address bar', () => {
  const originalHref = 'https://gomsin-log.vercel.app/?error=access_denied&error_description=denied';

  beforeEach(() => {
    // jsdom forbids assigning location, so history + location are stubbed together.
    vi.stubGlobal('location', new URL(originalHref) as unknown as Location);
    vi.stubGlobal('history', { replaceState: vi.fn() } as unknown as History);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rewrites the url without the error parameters', () => {
    /*
     * Without this the message reappears on every reload, and a shared or bookmarked
     * link carries a stale failure forever. `replaceState` rather than a navigation,
     * so Back does not walk into the error again.
     */
    clearAuthErrorFromUrl();
    const replaceState = (globalThis.history as unknown as { replaceState: ReturnType<typeof vi.fn> }).replaceState;
    expect(replaceState).toHaveBeenCalledTimes(1);
    const rewritten = String(replaceState.mock.calls[0][2]);
    expect(rewritten).not.toContain('error=');
    expect(rewritten).not.toContain('error_description=');
  });
});

describe('the login screen is wired to the reader', () => {
  it('renders the message on the app root, which is where the failure actually lands', () => {
    /*
     * Asserted at the call site: the module can be perfect and the bug still present
     * if nothing on `/` calls it. That is precisely the shape the original defect had.
     */
    const onboarding = read('src/pages/OnboardingPage.tsx');
    expect(onboarding).toContain('readAuthErrorFromUrl');
    expect(onboarding).toContain('clearAuthErrorFromUrl');
    expect(onboarding).toContain('role="alert"');
    expect(onboarding).not.toContain('authUrlError.code');
  });

  it('initialises from the url rather than in an effect, so the message is in the first paint', () => {
    // An effect would paint the login screen without the message for one frame, which
    // is long enough to read as "the app ignored my attempt".
    const onboarding = read('src/pages/OnboardingPage.tsx');
    expect(onboarding).toMatch(/useState\(\(\)\s*=>\s*readAuthErrorFromUrl\(\)\)/);
  });
});
