import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';

/**
 * A PKCE authorization code is single-use. The client must not automatically
 * exchange it while AuthCallbackPage also exchanges it: that race removed the
 * verifier and reproduced `AuthPKCECodeVerifierMissingError` in production.
 */

const navigate = vi.fn();
const toastError = vi.fn();

type Session = { access_token: string } | null;

const auth = {
  session: null as Session,
  listener: null as ((event: string, session: Session) => void) | null,
  getSession: vi.fn(async () => ({ data: { session: auth.session } })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null as { message: string } | null })),
  setSession: vi.fn(async () => ({ error: null as { message: string } | null })),
  onAuthStateChange: vi.fn((cb: (event: string, session: Session) => void) => {
    auth.listener = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
};

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
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
    auth.setSession.mockClear();
    auth.setSession.mockImplementation(async () => ({ error: null }));
    window.history.replaceState({}, '', '/auth/callback?code=auth-code-123');
  });

  afterEach(() => vi.useRealTimers());

  it('pins automatic URL detection off so the callback owns the only exchange', () => {
    const source = readFileSync('src/lib/supabase.ts', 'utf8');
    expect(source).toMatch(/detectSessionInUrl:\s*false/);
    expect(source).not.toMatch(/detectSessionInUrl:\s*true/);
  });

  it('exchanges the PKCE code exactly once and succeeds', async () => {
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('auth-code-123');
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports a genuine exchange failure without retrying the one-time code', async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: 'invalid grant' } });

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
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

  it('accepts a complete legacy implicit token pair', async () => {
    window.history.replaceState(
      {},
      '',
      '/auth/callback#access_token=old-access&refresh_token=old-refresh',
    );
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'old-access',
      refresh_token: 'old-refresh',
    });
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
