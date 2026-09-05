import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const nativeAppleLoginAvailable = vi.hoisted(() => ({ value: false }));

vi.mock('@/lib/appleAuth', () => ({
  isNativeAppleLoginAvailable: () => nativeAppleLoginAvailable.value,
  consumeAppleNameCandidate: () => null,
  subscribeAppleNameCandidate: () => () => {},
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  authRepository: { signInWithGoogle, signInWithApple, signInWithEmail },
  fetchAuthProviderAvailability: async () => ({ google: true, apple: true, email: true }),
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

const google = () => screen.findByRole('button', { name: /Google로 계속하기/ });
const agreeAll = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('checkbox', { name: /만 14세/ }));
  await user.click(screen.getByRole('checkbox', { name: /이용약관/ }));
};

describe('the sign-in buttons do not claim they will work before they will', () => {
  it('marks them unavailable, and says why, while consent is missing', async () => {
    renderLanding();
    expect(await google()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('위 두 항목에 동의하면 로그인할 수 있어요.')).toHaveClass('sr-only');
  });

  it('does not start a sign-in when consent is missing', async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(await google());
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
  it('stays reachable so the reason can be discovered by using it', async () => {
    renderLanding();
    const btn = await google();
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-describedby', 'legal-gate-reason');
  });

  it('becomes available once both boxes are ticked', async () => {
    const user = userEvent.setup();
    renderLanding();
    const btn = await google();
    await agreeAll(user);

    expect(btn).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('위 두 항목에 동의하면 로그인할 수 있어요.')).not.toBeInTheDocument();

    await user.click(btn);
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('requires BOTH, so one tick is not enough', async () => {
    const user = userEvent.setup();
    renderLanding();
    const btn = await google();
    await user.click(screen.getByRole('checkbox', { name: /만 14세/ }));

    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await user.click(btn);
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
  it('uses the approved favicon mark on the same paper surface as the signed-in app', () => {
    renderLanding();

    const mark = screen.getByRole('img', { name: '곰신로그 브랜드 마크' });
    expect(mark).toHaveAttribute('src', '/favicon.svg');
    expect(mark).toHaveAttribute('data-brand-mark', 'true');
    expect(mark.closest('[data-astryx-theme="gomsin"]')).toHaveClass('paper-texture-layer');
  });

  it('names the problem rather than the category', () => {
    renderLanding();
    expect(screen.getByText('답장이 늦어도, 서로의 하루를 이어 둘만의 기억으로 남겨요.')).toBeInTheDocument();
    expect(screen.queryByText('함께하지 못한 하루를 서로 이어주고, 둘만의 기억으로 남겨요.')).not.toBeInTheDocument();
    expect(screen.queryByText('답장이 늦어도, 서로의 하루는 놓치지 않도록.')).not.toBeInTheDocument();
  });

  it('sets the expectation that a partner is needed, before signing in', () => {
    // Someone could previously sign in, pick a role and name themselves before
    // discovering at step 3 that the app is unusable alone.
    renderLanding();
    expect(screen.getByText('가입 후 상대를 초대해 함께 사용해요.')).toBeInTheDocument();
    expect(screen.queryByText('상대를 초대하면')).not.toBeInTheDocument();
  });
});

describe('Apple sign-in on iOS obeys the legal consent gate', () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'true');
    nativeAppleLoginAvailable.value = true;
    signInWithApple.mockReset().mockResolvedValue({ error: null });
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('marks Apple button unavailable and does not call signInWithApple before legal consent', async () => {
    const user = userEvent.setup();
    renderLanding();
    const appleBtn = await screen.findByRole('button', { name: /Apple로 계속하기/ });

    expect(appleBtn).toHaveAttribute('aria-disabled', 'true');
    expect(appleBtn).not.toBeDisabled();
    expect(appleBtn).toHaveAttribute('aria-describedby', 'legal-gate-reason');

    await user.click(appleBtn);
    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it('calls signInWithApple once both legal checkboxes are checked', async () => {
    const user = userEvent.setup();
    renderLanding();
    const appleBtn = await screen.findByRole('button', { name: /Apple로 계속하기/ });
    await agreeAll(user);

    expect(appleBtn).toHaveAttribute('aria-disabled', 'false');
    await user.click(appleBtn);
    expect(signInWithApple).toHaveBeenCalledTimes(1);
  });

  it('keeps double taps single-flight while the Apple request is pending', async () => {
    let resolveSignIn!: (value: { error: null }) => void;
    signInWithApple.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSignIn = resolve;
    }));
    const user = userEvent.setup();
    renderLanding();
    const appleBtn = await screen.findByRole('button', { name: /Apple로 계속하기/ });
    await agreeAll(user);

    fireEvent.click(appleBtn);
    fireEvent.click(appleBtn);

    expect(signInWithApple).toHaveBeenCalledTimes(1);
    expect(appleBtn).toBeDisabled();
    resolveSignIn({ error: null });
    await waitFor(() => expect(appleBtn).not.toBeDisabled());
  });

  it('blocks Apple sign-in when only age is confirmed without terms agreement', async () => {
    const user = userEvent.setup();
    renderLanding();
    const appleBtn = await screen.findByRole('button', { name: /Apple로 계속하기/ });
    await user.click(screen.getByRole('checkbox', { name: /만 14세/ }));

    expect(appleBtn).toHaveAttribute('aria-disabled', 'true');
    await user.click(appleBtn);
    expect(signInWithApple).not.toHaveBeenCalled();
  });
});
