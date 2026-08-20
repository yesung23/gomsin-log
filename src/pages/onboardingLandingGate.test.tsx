import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';

/**
 * The first screen a new install sees.
 *
 * Korean law requires the age check and the terms agreement before an account
 * exists, so the gate itself is not negotiable. What was negotiable -- and wrong
 * -- was presenting three sign-in buttons that looked ready, above the
 * requirement, and answering a tap with only a toast at the edge of the screen.
 * On a first run that reads as the app being broken rather than as a step being
 * missed.
 *
 * The gate is asserted from BOTH directions, because the dangerous failure is not
 * a button that refuses too often. It is one that stops refusing.
 */

const signInWithGoogle = vi.fn(async () => ({ error: null }));
const signInWithApple = vi.fn(async () => ({ error: null }));
const signInWithEmail = vi.fn(async () => ({ error: null }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  authRepository: { signInWithGoogle, signInWithApple, signInWithEmail },
  fetchAuthProviderAvailability: async () => ({ google: true, apple: false, email: true }),
  createCoupleInvitation: vi.fn(),
  consumeCoupleInvitation: vi.fn(),
  fetchMyCoupleState: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
  saveCoupleAnniversary: vi.fn(),
  supabase: null,
}));

function makeState(): AppState {
  return {
    setupComplete: false,
    onboardingStep: 0,
    // No session: this is the pre-sign-in landing, which is the only state
    // step 0 is correct for.
    authenticatedUser: undefined,
    profile: {
      id: '', myName: '', role: 'gomsin',
      couple: {
        coupleId: '', partnerName: '', anniversaryDate: '',
        coupleCode: '', connected: false, status: 'pending',
      },
      military: {} as never,
      contact: {} as never,
    },
    records: [], events: [], trips: [],
    widgetLayout: [], hasSeenInstallPrompt: true, theme: 'light',
  };
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    updateProfile: vi.fn(),
    setSetupComplete: vi.fn(),
    setOnboardingStep: vi.fn(),
    recoverExpiredSession: vi.fn(),
  }),
}));

const { OnboardingPage } = await import('@/pages/OnboardingPage');

function renderLanding() {
  return render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
}

const google = () => screen.getByRole('button', { name: /Google로 계속하기/ });
const agreeAll = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('checkbox', { name: /만 14세/ }));
  await user.click(screen.getByRole('checkbox', { name: /이용약관/ }));
};

describe('the sign-in buttons do not claim they will work before they will', () => {
  it('marks them unavailable, and says why, while consent is missing', () => {
    renderLanding();
    expect(google()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('위 두 항목에 동의하면 로그인할 수 있어요.')).toBeInTheDocument();
  });

  it('does not start a sign-in when consent is missing', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(google());
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  /**
   * `aria-disabled`, not `disabled`.
   *
   * A truly disabled button leaves the tab order, so a keyboard or screen-reader
   * user meets a control that is simply absent and is told nothing about why.
   * Staying reachable is what lets the same tap surface the same explanation for
   * everyone, instead of only for people who can see it greyed out.
   */
  it('stays reachable so the reason can be discovered by using it', () => {
    renderLanding();
    expect(google()).not.toBeDisabled();
    expect(google()).toHaveAttribute('aria-describedby', 'legal-gate-reason');
  });

  it('becomes available once both boxes are ticked', async () => {
    const user = userEvent.setup();
    renderLanding();
    await agreeAll(user);

    expect(google()).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('위 두 항목에 동의하면 로그인할 수 있어요.')).not.toBeInTheDocument();

    await user.click(google());
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('requires BOTH, so one tick is not enough', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(screen.getByRole('checkbox', { name: /만 14세/ }));

    expect(google()).toHaveAttribute('aria-disabled', 'true');
    await user.click(google());
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe('email sign-in is gone', () => {
  it('offers no magic-link route, even when the server still reports the provider', () => {
    // The availability mock still says `email: true`. The screen must not offer it
    // anyway -- removing a route is a product decision, not something a server
    // capability flag should be able to undo.
    renderLanding();
    expect(screen.queryByText('이메일로 로그인')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /매직링크/ })).not.toBeInTheDocument();
  });
});

describe('it says what the app is before asking for an account', () => {
  it('names the problem rather than the category', () => {
    renderLanding();
    expect(screen.getByText('답장이 늦어도, 서로의 하루는 놓치지 않도록.')).toBeInTheDocument();
  });

  it('sets the expectation that a partner is needed, before signing in', () => {
    // Someone could previously sign in, pick a role and name themselves before
    // discovering at step 3 that the app is unusable alone.
    renderLanding();
    expect(screen.getByText('상대를 초대하면')).toBeInTheDocument();
  });
});
