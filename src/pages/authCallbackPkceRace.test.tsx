import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';

/**
 * A PKCE authorization code is single-use. The client must not automatically
 * exchange it while AuthCallbackPage also exchanges it: that race removed the
 * verifier and reproduced `AuthPKCECodeVerifierMissingError` in production.
 */

const navigate = vi.fn();
const toastError = vi.fn();
const FLOW_ID = 'flow-id-123';

type Session = { access_token: string } | null;

const auth = {
  session: null as Session,
  listener: null as ((event: string, session: Session) => void) | null,
  getSession: vi.fn(async () => ({ data: { session: auth.session } })),
  exchangeCodeForSession: vi.fn(async (
    _code?: string,
    _options?: { flowId?: string },
  ) => ({ error: null as { message: string } | null })),
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
    window.history.replaceState(
      {},
      '',
      `/auth/callback?code=auth-code-123&sb_flow_id=${FLOW_ID}`,
    );
  });

  afterEach(() => vi.useRealTimers());

  it('pins automatic URL detection off so the callback owns the only exchange', () => {
    const source = readFileSync('src/lib/supabase.ts', 'utf8');
    expect(source).toMatch(/detectSessionInUrl:\s*false/);
    expect(source).not.toMatch(/detectSessionInUrl:\s*true/);
    expect(source).toMatch(/appendPkceFlowIdToRedirects:\s*true/);
    expect(source).toMatch(/fetch:\s*createPkceTimeoutFetch\(/);
  });

  it('exchanges the PKCE code exactly once and succeeds', async () => {
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(
      'auth-code-123',
      { flowId: FLOW_ID },
    );
    expect(auth.getSession).not.toHaveBeenCalled();
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

  it('does not adopt an existing session instead of exchanging a valid callback code', async () => {
    auth.session = { access_token: 'existing' };
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(
      'auth-code-123',
      { flowId: FLOW_ID },
    );
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('ignores an INITIAL_SESSION event and still exchanges the callback code', async () => {
    auth.onAuthStateChange.mockImplementationOnce((cb) => {
      auth.listener = cb;
      cb('INITIAL_SESSION', { access_token: 'existing' });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(
      'auth-code-123',
      { flowId: FLOW_ID },
    );
  });

  it.each([
    '/auth/callback?code=auth-code-123',
    '/auth/callback?code=auth-code-123&sb_flow_id=short',
    '/auth/callback?code=auth-code-123&sb_flow_id=invalid.flow.id',
    `/auth/callback?code=auth-code-123&sb_flow_id=${'a'.repeat(65)}`,
  ])('rejects a missing or invalid flow id without reading or exchanging: %s', async (url) => {
    window.history.replaceState({}, '', url);

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
  });

  it('accepts an existing session only when the callback has no code', async () => {
    auth.session = { access_token: 'existing' };
    window.history.replaceState({}, '', '/auth/callback');

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.getSession).toHaveBeenCalledTimes(1);
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

  it('never calls setSession for a fragment token pair', async () => {
    window.history.replaceState(
      {},
      '',
      '/auth/callback#access_token=attacker-access&refresh_token=attacker-refresh',
    );
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalledWith('/', { replace: true });
    expect(toastError).toHaveBeenCalledWith('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
  });

  it('never calls setSession for a query token pair', async () => {
    window.history.replaceState(
      {},
      '',
      '/auth/callback?access_token=attacker-access&refresh_token=attacker-refresh',
    );
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('refuses a callback carrying nothing usable', async () => {
    window.history.replaceState({}, '', '/auth/callback');
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
  });

  it('exchanges the code once under StrictMode effect replay', async () => {
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('never consults an existing session for a code under StrictMode', async () => {
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it('does not hang on spinner when getSession throws', async () => {
    auth.getSession.mockRejectedValueOnce(new Error('session fetch failed'));
    window.history.replaceState({}, '', '/auth/callback');
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(toastError).toHaveBeenCalledWith('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
    await vi.advanceTimersByTimeAsync(2500);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('times out a pending getSession only on a code-less callback', async () => {
    auth.getSession.mockImplementationOnce(() => new Promise(() => {}));
    window.history.replaceState({}, '', '/auth/callback');

    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(toastError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요.');
  });

  it('does not hang on spinner when exchangeCodeForSession throws', async () => {
    auth.exchangeCodeForSession.mockRejectedValueOnce(new Error('exchange promise rejected'));
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(toastError).toHaveBeenCalledWith('로그인 처리에 실패했습니다. 다시 시도해 주세요.');
    await vi.advanceTimersByTimeAsync(2500);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('does not let a late auth event reverse a failed exchange', async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: 'invalid grant' } });
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    auth.listener?.('SIGNED_IN', { access_token: 'late-session' });
    await vi.advanceTimersByTimeAsync(0);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('handles throwing toast without breaking navigation timer', async () => {
    toastError.mockImplementationOnce(() => {
      throw new Error('toast error failed');
    });
    window.history.replaceState({}, '', '/auth/callback?error=access_denied');
    render(<AuthCallbackPage />);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(2500);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('logs no token, authorization code, flow id or raw error in console', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      auth.exchangeCodeForSession.mockImplementation(async () => ({
        error: { message: 'flow_state_not_found' },
      }));
      window.history.replaceState(
        {},
        '',
        '/auth/callback?code=secret-auth-code&sb_flow_id=secret-flow-id',
      );
      render(<AuthCallbackPage />);
      await vi.advanceTimersByTimeAsync(0);

      const printed = errorLog.mock.calls
        .flat()
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part) ?? ''))
        .join(' | ');
      expect(printed).not.toContain('secret-auth-code');
      expect(printed).not.toContain('secret-flow-id');
      expect(printed).not.toContain('flow_state_not_found');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('is the only session-establishing path: no setSession call site remains', () => {
    const source = readFileSync('src/pages/AuthCallbackPage.tsx', 'utf8');
    expect(source).not.toMatch(/supabase.auth.setSession\s*\(/);
    expect(readFileSync('src/lib/deepLinks.ts', 'utf8')).not.toMatch(/\.setSession\s*\(/);
  });
});
