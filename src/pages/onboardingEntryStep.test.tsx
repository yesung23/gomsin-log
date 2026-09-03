import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AuthUser } from '@/types';

/**
 * The sign-in step must not be shown to someone who has already signed in.
 *
 * A brand-new account is exactly this state: `/auth/callback` exchanges the code,
 * hydration finds no `profiles` row, `setupComplete` stays false, and `App` renders
 * the onboarding wizard. The wizard opened at step 0 -- the landing screen, whose
 * only controls are Google, Apple (when configured), and email magic-link login.
 *
 * Nothing advanced past it. `onboardingStep` is never written with a non-zero
 * value by anything except the wizard mirroring its own state, and step 0 has no
 * "다음". So the first thing a user saw after successfully signing in was a request
 * to sign in again, and pressing it repeated the same round trip: no new account
 * could reach role selection at all.
 */

const state = {
  authenticatedUser: null as AuthUser | null,
  onboardingStep: 0,
  setupComplete: false,
  profile: {
    myName: '',
    role: 'gomsin' as const,
    couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' as const },
    military: {},
    contact: {},
  },
};

const setOnboardingStep = vi.fn();
const fetchAuthProviderAvailability = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  authRepository: {
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
  },
  createCoupleInvitation: vi.fn(),
  consumeCoupleInvitation: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
  fetchMyCoupleState: vi.fn(),
  fetchAuthProviderAvailability: (...args: unknown[]) => fetchAuthProviderAvailability(...(args as [])),
  saveCoupleAnniversary: vi.fn(),
}));

vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: vi.fn(async () => false),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state,
    updateProfile: vi.fn(),
    setSetupComplete: vi.fn(),
    setOnboardingStep: (...args: unknown[]) => setOnboardingStep(...(args as [])),
    recoverExpiredSession: vi.fn(),
  }),
}));

const { OnboardingPage } = await import('@/pages/OnboardingPage');

const SIGN_IN_CTA = 'Google로 계속하기';
/** The step-1 heading, i.e. proof the wizard actually started. */
const ROLE_STEP = '곰신로그를 어떻게 사용할까요?';

describe('onboarding entry step', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'true');
    setOnboardingStep.mockClear();
    state.authenticatedUser = null;
    state.onboardingStep = 0;
    fetchAuthProviderAvailability.mockReset().mockResolvedValue({
      google: true,
      apple: false,
      email: true,
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the sign-in screen to a visitor who is not signed in', async () => {
    render(<OnboardingPage />);
    expect(await screen.findByText(SIGN_IN_CTA)).toBeInTheDocument();
    expect(screen.queryByText(/둘러보기/)).not.toBeInTheDocument();
  });

  it('does not show a dead Apple button on iPhone when the server disables Apple login', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });

    render(<OnboardingPage />);

    await waitFor(() => expect(fetchAuthProviderAvailability).toHaveBeenCalledOnce());
    expect(screen.queryByText('Apple로 계속하기')).not.toBeInTheDocument();
  });

  it('shows Apple first on web and PWA after the server confirms the provider', async () => {
    fetchAuthProviderAvailability.mockResolvedValue({
      google: true,
      apple: true,
      email: true,
    });

    render(<OnboardingPage />);

    const apple = await screen.findByRole('button', { name: /Apple로 계속하기/ });
    const google = screen.getByRole('button', { name: /Google로 계속하기/ });
    expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('separator', { name: '기타 로그인' })).toBeInTheDocument();
  });

  it('keeps Apple login hidden when the server enables it but the reviewed build gate is off', async () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'false');
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    fetchAuthProviderAvailability.mockResolvedValue({
      google: true,
      apple: true,
      email: true,
    });

    render(<OnboardingPage />);

    expect(await screen.findByText(SIGN_IN_CTA)).toBeInTheDocument();
    expect(screen.queryByText('Apple로 계속하기')).not.toBeInTheDocument();
  });

  it('shows a recoverable unavailable state when Apple is the only remote provider but its build gate is off', async () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'false');
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    fetchAuthProviderAvailability.mockResolvedValue({
      google: false,
      apple: true,
      email: true,
    });

    render(<OnboardingPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '현재 사용할 수 있는 로그인 방법을 확인하지 못했어요. 잠시 후 다시 열어 주세요.',
    );
    expect(screen.queryByText('Apple로 계속하기')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('does NOT ask an already-signed-in account to sign in again', async () => {
    state.authenticatedUser = { id: 'user-new', email: 'new@example.com', provider: 'google' };

    render(<OnboardingPage />);

    // The defect: this rendered the landing screen, and there was no way forward.
    await waitFor(() => expect(screen.queryByText(SIGN_IN_CTA)).not.toBeInTheDocument());
    expect(await screen.findByText(ROLE_STEP)).toBeInTheDocument();
  });

  it('advances a visitor who signs in while the landing screen is open', async () => {
    const view = render(<OnboardingPage />);
    expect(await screen.findByText(SIGN_IN_CTA)).toBeInTheDocument();

    // The OAuth round trip resolves after mount, so the fix cannot live only in
    // the initial state.
    state.authenticatedUser = { id: 'user-new', email: 'new@example.com', provider: 'google' };
    view.rerender(<OnboardingPage />);

    await waitFor(() => expect(screen.queryByText(SIGN_IN_CTA)).not.toBeInTheDocument());
    expect(await screen.findByText(ROLE_STEP)).toBeInTheDocument();
  });

  /**
   * The nickname step's 다음 was always enabled and answered a tap with an error
   * toast. The composer already refuses to offer 저장 when there is nothing a save
   * could persist; this applies the same rule so the button never promises a step
   * it is about to refuse.
   */
  it('does not offer 다음 on the nickname step until the nickname is usable', async () => {
    state.authenticatedUser = { id: 'user-new', email: 'new@example.com', provider: 'google' };
    state.onboardingStep = 2;

    render(<OnboardingPage />);
    const next = () => screen.getByRole('button', { name: '다음' });

    expect(next()).toBeDisabled();

    const input = screen.getByPlaceholderText('예) 춘향');
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    await user.type(input, '춘');
    expect(next()).toBeDisabled();

    await user.type(input, '향');
    await waitFor(() => expect(next()).toBeEnabled());
  });

  it('respects a resumed step instead of forcing the user back to the start', async () => {
    state.authenticatedUser = { id: 'user-new', email: 'new@example.com', provider: 'google' };
    state.onboardingStep = 3;

    render(<OnboardingPage />);

    // A creator who was already shown a code must not be dropped to step 1.
    expect(await screen.findByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();
  });

  describe('auth provider fail-closed availability', () => {
    beforeEach(() => {
      setOnboardingStep.mockClear();
      state.authenticatedUser = null;
      state.onboardingStep = 0;
      fetchAuthProviderAvailability.mockReset();
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0',
      });
    });

    it('keeps all providers false before provider verification resolves', () => {
      fetchAuthProviderAvailability.mockReturnValue(new Promise(() => {}));
      render(<OnboardingPage />);

      expect(screen.getByRole('status')).toHaveTextContent('로그인 방법을 확인하고 있어요.');
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apple로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('fails closed and keeps Google button hidden when availability fetch returns null', async () => {
      fetchAuthProviderAvailability.mockResolvedValue(null);
      render(<OnboardingPage />);

      await waitFor(() => expect(fetchAuthProviderAvailability).toHaveBeenCalledOnce());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '현재 사용할 수 있는 로그인 방법을 확인하지 못했어요. 잠시 후 다시 열어 주세요.',
      );
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apple로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    });

    it('fails closed and keeps Google button hidden when availability fetch rejects', async () => {
      fetchAuthProviderAvailability.mockRejectedValue(new Error('Network offline'));
      render(<OnboardingPage />);

      await waitFor(() => expect(fetchAuthProviderAvailability).toHaveBeenCalledOnce());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        '현재 사용할 수 있는 로그인 방법을 확인하지 못했어요. 잠시 후 다시 열어 주세요.',
      );
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    });

    it('maintains provider-aware UI when provider availability check succeeds', async () => {
      fetchAuthProviderAvailability.mockResolvedValue({
        google: true,
        apple: false,
        email: true,
      });
      render(<OnboardingPage />);

      expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers Apple on non-iOS web when it is the only enabled provider and the build gate is on', async () => {
      fetchAuthProviderAvailability.mockResolvedValue({
        google: false,
        apple: true,
        email: true,
      });
      render(<OnboardingPage />);

      expect(await screen.findByRole('button', { name: /Apple로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('separator', { name: '기타 로그인' })).not.toBeInTheDocument();
    });

    it('does not label Google as an alternate when Apple is unavailable', async () => {
      fetchAuthProviderAvailability.mockResolvedValue({
        google: true,
        apple: false,
        email: true,
      });
      render(<OnboardingPage />);

      expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('separator', { name: '기타 로그인' })).not.toBeInTheDocument();
    });

    it('fails closed on re-entering step 0 and prevents stale Google/Apple CTA during pending recheck', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      });
      fetchAuthProviderAvailability.mockResolvedValueOnce({
        google: true,
        apple: true,
        email: true,
      });

      const view = render(<OnboardingPage />);
      expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Apple로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Step exit: Authenticate and advance to role step
      state.authenticatedUser = { id: 'user-reentry', email: 'reentry@example.com', provider: 'google' };
      view.rerender(<OnboardingPage />);

      expect(await screen.findByText(ROLE_STEP)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apple로 계속하기/ })).not.toBeInTheDocument();

      // Next check is pending
      let resolvePending: (val: unknown) => void = () => {};
      fetchAuthProviderAvailability.mockImplementationOnce(
        () => new Promise((resolve) => { resolvePending = resolve; }),
      );

      // User session clears and navigates back to step 0
      state.authenticatedUser = null;
      const { default: userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: '이전 단계' }));

      // Pending re-entry: must fail closed, NO stale CTAs, NO prematurely displayed alert
      expect(screen.queryByText(ROLE_STEP)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apple로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // When recheck settles, providers are rendered
      resolvePending({
        google: true,
        apple: true,
        email: true,
      });

      expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Apple로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('allows retrying provider availability and prevents stale responses from overwriting active retry', async () => {
      fetchAuthProviderAvailability.mockRejectedValueOnce(new Error('Initial failure'));
      const view = render(<OnboardingPage />);

      await waitFor(() => expect(fetchAuthProviderAvailability).toHaveBeenCalledTimes(1));
      const retryButton = await screen.findByRole('button', { name: '다시 시도' });
      expect(retryButton).toBeInTheDocument();
      expect(retryButton.className).toContain('min-h-11');

      let resolveStaleFetch: (val: unknown) => void = () => {};
      let resolveActiveFetch: (val: unknown) => void = () => {};

      fetchAuthProviderAvailability.mockImplementationOnce(
        () => new Promise((resolve) => { resolveStaleFetch = resolve; }),
      );
      fetchAuthProviderAvailability.mockImplementationOnce(
        () => new Promise((resolve) => { resolveActiveFetch = resolve; }),
      );

      const { default: userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();

      // Click retry
      await user.click(retryButton);

      // While retry is pending, CTAs, alert, and retry button are all hidden
      expect(screen.queryByRole('button', { name: /Google로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Apple로 계속하기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();

      // Navigate away and back to step 0 to create a second in-flight active check
      state.authenticatedUser = { id: 'user-retry-stale', email: 'retry@example.com', provider: 'google' };
      view.rerender(<OnboardingPage />);
      expect(await screen.findByText(ROLE_STEP)).toBeInTheDocument();

      state.authenticatedUser = null;
      await user.click(screen.getByRole('button', { name: '이전 단계' }));

      // The earlier stale fetch resolves with failure AFTER cleanup
      resolveStaleFetch(null);

      // Stale response must NOT show the alert or modify pending state
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();

      // Now active fetch resolves with valid google provider
      resolveActiveFetch({
        google: true,
        apple: false,
        email: true,
      });

      expect(await screen.findByRole('button', { name: /Google로 계속하기/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    });
  });
});
