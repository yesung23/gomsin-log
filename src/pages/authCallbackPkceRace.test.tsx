import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

/**
 * Google sign-in reported "로그인 처리에 실패했습니다" after a successful callback.
 *
 * A PKCE authorization code may be redeemed exactly once. With
 * `detectSessionInUrl: true` the Supabase client is ALREADY redeeming the code in
 * the callback URL, and `AuthCallbackPage` used to call
 * `exchangeCodeForSession(code)` for the same code concurrently. Exactly one of
 * the two could win; the loser came back with an `invalid_grant`-class error.
 *
 * The loser's error path probed `getSession()` once, immediately. When the winner
 * had not finished persisting the session yet, that probe saw `null` and the page
 * called `fail()` -- which set `cancelled = true` and therefore permanently
 * suppressed the `onAuthStateChange` listener's `succeed()` that landed
 * milliseconds later. The user was told the login failed, and was bounced back to
 * `/`, while actually being signed in.
 *
 * These tests pin the two properties that fix it: the explicit exchange is a
 * sequential FALLBACK (never a second concurrent redemption of the same code),
 * and an exchange error is not terminal while a session may still be arriving.
 */

const GRACE_MS = 2_000;
const TIMEOUT_MS = 15_000;

const navigate = vi.fn();
const toastError = vi.fn();

type Session = { access_token: string } | null;

const auth = {
  session: null as Session,
  listener: null as ((event: string, session: Session) => void) | null,
  getSession: vi.fn(async () => ({ data: { session: auth.session } })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null as { message: string } | null })),
  onAuthStateChange: vi.fn((cb: (event: string, session: Session) => void) => {
    auth.listener = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
};

/** Simulate the winning exchange landing: persist the session and notify. */
function landSession() {
  auth.session = { access_token: 'token' };
  auth.listener?.('SIGNED_IN', auth.session);
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth },
}));

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn(), info: vi.fn() },
}));

const { AuthCallbackPage } = await import('@/pages/AuthCallbackPage');

describe('AuthCallbackPage PKCE handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockClear();
    toastError.mockClear();
    auth.session = null;
    auth.listener = null;
    auth.getSession.mockClear();
    auth.onAuthStateChange.mockClear();
    auth.exchangeCodeForSession.mockClear();
    auth.exchangeCodeForSession.mockImplementation(async () => ({ error: null }));
    window.history.replaceState({}, '', '/auth/callback?code=auth-code-123');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not redeem the code a second time when detectSessionInUrl already won', async () => {
    render(<AuthCallbackPage />);
    // Let the effect run: read params, probe the existing session, subscribe.
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.onAuthStateChange).toHaveBeenCalled();

    // The client's own exchange completes inside the grace window.
    landSession();
    await vi.advanceTimersByTimeAsync(10);

    // The single-use code must NOT be redeemed again.
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports success, not failure, when its own exchange loses the race', async () => {
    // The explicit exchange loses: the code was already redeemed. The winner's
    // session lands 50ms later -- after the error, exactly as in production.
    auth.exchangeCodeForSession.mockImplementation(async () => {
      setTimeout(landSession, 50);
      return { error: { message: 'invalid request: both auth code and code verifier should be non-empty' } };
    });

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    // Nothing arrives during the grace window, so the fallback exchange runs.
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);

    // The losing error must not be treated as terminal.
    await vi.advanceTimersByTimeAsync(100);

    expect(toastError).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('still reports failure when no session ever arrives', async () => {
    auth.exchangeCodeForSession.mockImplementation(async () => ({
      error: { message: 'invalid grant' },
    }));

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);

    // Genuine failure: the deadline passes with no session at all.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(toastError).toHaveBeenCalledWith('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
  });

  it('succeeds immediately when a session already exists', async () => {
    auth.session = { access_token: 'existing' };

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('surfaces a provider error without touching the code exchange', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=access_denied');

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('로그인이 취소되었습니다. 다시 시도해 주세요.');
  });
});
