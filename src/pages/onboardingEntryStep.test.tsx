import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('shows the sign-in screen to a visitor who is not signed in', () => {
    render(<OnboardingPage />);
    expect(screen.getByText(SIGN_IN_CTA)).toBeInTheDocument();
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

  it('shows Apple login on iPhone after the server confirms the provider', async () => {
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

    expect(await screen.findByText('Apple로 계속하기')).toBeInTheDocument();
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
    expect(screen.getByText(SIGN_IN_CTA)).toBeInTheDocument();

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
});
