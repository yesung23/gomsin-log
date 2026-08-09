import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * Onboarding step 3: the creator must never dead-end.
 *
 * `create_couple_and_invitation` inserts the creator's `active` membership BEFORE
 * onboarding writes the `profiles` row. Abandoning onboarding after step 3
 * therefore left a real couple space with no profile, so the next launch treated
 * the account as new, restarted onboarding, and the RPC raised
 * `User already in an active couple`. The only visible outcome was that raw error
 * in a toast, with no affordance of any kind.
 */

const {
  createCoupleInvitation,
  consumeCoupleInvitation,
  fetchMyCoupleState,
  fetchAuthProviderAvailability,
  regenerateCoupleInvitation,
  mockSupabase,
} = vi.hoisted(() => ({
  createCoupleInvitation: vi.fn(),
  consumeCoupleInvitation: vi.fn(),
  fetchMyCoupleState: vi.fn(),
  fetchAuthProviderAvailability: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
  mockSupabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: {
    signInWithGoogle: vi.fn().mockResolvedValue({}),
    signInWithApple: vi.fn().mockResolvedValue({}),
    signInWithEmail: vi.fn().mockResolvedValue({}),
  },
  createCoupleInvitation: (...args: unknown[]) => createCoupleInvitation(...(args as [])),
  consumeCoupleInvitation: (...args: unknown[]) => consumeCoupleInvitation(...(args as [])),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
  fetchAuthProviderAvailability: (...args: unknown[]) => fetchAuthProviderAvailability(...(args as [])),
  regenerateCoupleInvitation: (...args: unknown[]) => regenerateCoupleInvitation(...(args as [])),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/accountDeletion', () => ({
  serverCallBlockedByPendingDeletion: vi.fn().mockResolvedValue(false),
}));

const toastCalls: { level: string; message: string }[] = [];
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastCalls.push({ level: 'success', message }); },
    error: (message: string) => { toastCalls.push({ level: 'error', message }); },
    warning: (message: string) => { toastCalls.push({ level: 'warning', message }); },
  },
}));

const storeState = {
  authenticatedUser: { id: 'user-a', email: 'a@example.com', provider: 'google' as const },
  onboardingStep: 3,
  profile: {
    myName: '',
    role: 'gomsin' as const,
    couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' as const },
    military: {},
    contact: {},
  },
};

const recoverExpiredSession = vi.fn();
const setOnboardingStep = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    updateProfile: vi.fn(),
    setSetupComplete: vi.fn(),
    setOnboardingStep: (...args: unknown[]) => setOnboardingStep(...(args as [])),
    recoverExpiredSession: (...args: unknown[]) => recoverExpiredSession(...(args as [])),
  }),
}));

const { OnboardingPage } = await import('@/pages/OnboardingPage');

/** Render step 3 (couple space) directly. */
async function mountStep3() {
  render(<OnboardingPage />);
  await waitFor(() =>
    expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument(),
  );
}

function clickNext() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const next = buttons.find((button) => button.textContent?.trim() === '다음');
  if (!next) throw new Error('next button not found');
  next.click();
}

describe('OnboardingPage step 3 - couple space', () => {
  beforeEach(() => {
    toastCalls.length = 0;
    createCoupleInvitation.mockReset();
    consumeCoupleInvitation.mockReset();
    recoverExpiredSession.mockReset().mockResolvedValue(true);
    setOnboardingStep.mockReset();
    fetchMyCoupleState.mockReset();
    fetchAuthProviderAvailability.mockReset().mockResolvedValue({
      google: true,
      apple: false,
      email: true,
    });
    regenerateCoupleInvitation.mockReset();
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not render a code-entry input while in create mode', async () => {
    await mountStep3();
    // Create is the default mode. Offering a code field here invites the creator
    // to redeem their own code, which the server rejects as `self_invitation`.
    expect(screen.queryByLabelText('숫자 6자리 초대 코드')).toBeNull();
  });

  it('renders the code-entry input only after switching to join mode', async () => {
    await mountStep3();
    await act(async () => {
      screen.getByText('초대 코드가 있어요').click();
    });
    expect(screen.getByLabelText('숫자 6자리 초대 코드')).toBeInTheDocument();
  });

  it('shows a freshly created invitation code', async () => {
    createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });
    await mountStep3();

    await act(async () => { clickNext(); });

    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
    expect(screen.queryByLabelText('숫자 6자리 초대 코드')).toBeNull();
  });

  it('stays on step 3 after minting a code so the creator can read it', async () => {
    createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });
    await mountStep3();

    await act(async () => { clickNext(); });

    // Previously the same tap generated the code AND advanced, so the code block
    // and its copy button were rendered and discarded within one frame.
    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
    expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();
    expect(screen.getByLabelText('초대 코드 복사')).toBeInTheDocument();

    // A second tap continues past step 3.
    await act(async () => { clickNext(); });
    await waitFor(() =>
      expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument(),
    );
  });

  it('recovers into the existing space and regenerates a code when already in a couple', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '',
      code: '',
      error: 'User already in an active couple',
      // The data layer now classifies this once, next to the RPC that raises it.
      reason: 'already_in_couple',
    });
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    fetchMyCoupleState
      .mockResolvedValueOnce({
        ok: true,
        state: {
          coupleId: 'couple-existing',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: false,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      })
      .mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-existing',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: false,
          invitationActive: true,
          invitationExpiresAt: expiresAt,
        },
      });
    regenerateCoupleInvitation.mockResolvedValue({ code: '654321' });

    await mountStep3();
    await act(async () => { clickNext(); });

    // The recovered space is adopted and a usable code is displayed instead of a
    // raw server error.
    await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());
    expect(regenerateCoupleInvitation).toHaveBeenCalledTimes(1);
    expect(toastCalls.some((call) => call.message.includes('이미 만든 공간을 찾아'))).toBe(true);
    // The raw RPC message never reaches the user.
    expect(toastCalls.every((call) => !call.message.includes('already in an active couple'))).toBe(true);
  });

  it('renders the invitation expiry next to a recovered code', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '', code: '', error: 'User already in an active couple',
      reason: 'already_in_couple',
    });
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-existing',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: false,
        invitationActive: true,
        invitationExpiresAt: expiresAt,
      },
    });
    regenerateCoupleInvitation.mockResolvedValue({ code: '654321' });

    await mountStep3();
    await act(async () => { clickNext(); });
    // This fixture has a LIVE invitation, so regenerating now requires the user's
    // explicit consent (DEF-06) -- the code it invalidates may already have been
    // sent. The assertions below are unchanged.
    await waitFor(() =>
      expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());
    await act(async () => { screen.getByText('새 코드 발급하기').click(); });

    await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText(/시간 남음/)).toBeInTheDocument(),
    );
  });

  it('continues without a code when recovery finds an already connected space', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '', code: '', error: 'User already in an active couple',
      reason: 'already_in_couple',
    });
    fetchMyCoupleState.mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-existing',
        role: 'gomsin',
        memberStatus: 'active',
        partnerPresent: true,
        invitationActive: false,
        invitationExpiresAt: null,
      },
    });

    await mountStep3();
    await act(async () => { clickNext(); });

    await waitFor(() =>
      expect(toastCalls.some((call) => call.message.includes('이미 연결된 커플 공간'))).toBe(true),
    );
    // Nothing to invite anyone to, so no code is minted.
    expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
  });

  it('reports a retryable message when the existing space cannot be read', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '', code: '', error: 'User already in an active couple',
      reason: 'already_in_couple',
    });
    fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });

    await mountStep3();
    await act(async () => { clickNext(); });

    await waitFor(() =>
      expect(
        toastCalls.some((call) =>
          call.message.includes('이미 만들어진 커플 공간이 있는데 정보를 확인하지 못했어요'),
        ),
      ).toBe(true),
    );
    expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
  });

  it('still reports an unrelated creation failure as-is', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '', code: '', error: '초대 코드를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });

    await mountStep3();
    await act(async () => { clickNext(); });

    await waitFor(() =>
      expect(toastCalls.some((call) => call.level === 'error')).toBe(true),
    );
    // Not an already-in-couple error, so no recovery is attempted.
    expect(fetchMyCoupleState).not.toHaveBeenCalled();
    expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
  });

  /**
   * DEF-06. Recovery regenerated unconditionally, with only a success toast. If
   * the creator had already sent the code, that silently broke it: migration 015
   * keeps at most one unused hash, so minting a new one invalidates the old.
   */
  describe('an existing space whose invitation is still live', () => {
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    function seedLiveInvitation() {
      createCoupleInvitation.mockResolvedValue({
        coupleId: '', code: '', error: 'User already in an active couple',
        reason: 'already_in_couple',
      });
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-existing',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: false,
          invitationActive: true,
          invitationExpiresAt: expiresAt,
        },
      });
    }

    it('asks before invalidating a code that may already be with the partner', async () => {
      seedLiveInvitation();
      await mountStep3();
      await act(async () => { clickNext(); });

      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());
      // The decisive assertion: nothing was invalidated.
      expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
      expect(screen.getByText('이미 만든 우리 공간이 있어요')).toBeInTheDocument();
      // And it says what the consequence is, in the same terms the banner uses.
      expect(screen.getByTestId('space-recovery-confirm').textContent)
        .toContain('이전에 보낸 코드는 사용할 수 없게 돼요');
      expect(screen.getByText('새 코드 발급하기')).toBeInTheDocument();
      expect(screen.getByText('이전에 보낸 코드 그대로 쓰기')).toBeInTheDocument();
    });

    it('regenerates only after the user accepts the consequence', async () => {
      seedLiveInvitation();
      regenerateCoupleInvitation.mockResolvedValue({ code: '654321' });
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());

      await act(async () => { screen.getByText('새 코드 발급하기').click(); });

      await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());
      expect(regenerateCoupleInvitation).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('space-recovery-confirm')).toBeNull();
    });

    it('keeps the sent code and adopts the space when the user declines', async () => {
      seedLiveInvitation();
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());

      await act(async () => { screen.getByText('이전에 보낸 코드 그대로 쓰기').click(); });

      expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
      expect(screen.queryByTestId('space-recovery-confirm')).toBeNull();
      // No code is displayed, because this device does not have one -- and the
      // page must not pretend otherwise.
      expect(screen.queryByLabelText('초대 코드 복사')).toBeNull();
    });

    it('does not re-create the space after the user declined, and advances', async () => {
      seedLiveInvitation();
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());
      await act(async () => { screen.getByText('이전에 보낸 코드 그대로 쓰기').click(); });
      createCoupleInvitation.mockClear();

      await act(async () => { clickNext(); });

      // The space already exists; asking the server to create it again would only
      // raise "already in an active couple" a second time.
      expect(createCoupleInvitation).not.toHaveBeenCalled();
      expect(screen.queryByText('우리 둘만의 로그를 시작해볼까요?')).toBeNull();
    });

    it('refuses to advance while the decision is outstanding', async () => {
      seedLiveInvitation();
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());

      await act(async () => { clickNext(); });

      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();
      expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
      expect(toastCalls.some((call) =>
        call.message.includes('어떻게 할지 먼저 선택해 주세요'))).toBe(true);
    });
  });

  /**
   * DEF-06. `setOnboardingStep` was defined, exposed on the store context and
   * read back at mount, but no product code ever called it -- so it was a dead
   * write path and leaving onboarding always restarted at step 0.
   */
  it('mirrors the current step into the store', async () => {
    await mountStep3();
    expect(setOnboardingStep).toHaveBeenCalledWith(3);
  });

  /**
   * DEF-04. `not_authenticated` used to be shown as "잠시 후 다시 시도해 주세요",
   * so the user retried a code that was never the problem and the dead session
   * was never refreshed or ended.
   */
  it('routes an expired session from redemption to the store recovery', async () => {
    consumeCoupleInvitation.mockResolvedValue({
      error: '초대 코드를 확인하지 못했습니다. 세션이 만료되었어요. 다시 로그인해 주세요.',
      reason: 'auth_expired',
    });

    await mountStep3();
    await act(async () => {
      screen.getByText('초대 코드가 있어요').click();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '123456' } });
    });
    await act(async () => { clickNext(); });

    await waitFor(() => expect(recoverExpiredSession).toHaveBeenCalledTimes(1));
    expect(toastCalls.some((call) => call.message.includes('세션이 만료되었어요'))).toBe(true);
  });

  it('does not touch the session when the code itself was rejected', async () => {
    consumeCoupleInvitation.mockResolvedValue({
      error: '유효하지 않거나 만료된 초대 코드입니다. (유효기간: 24시간)',
    });

    await mountStep3();
    await act(async () => {
      screen.getByText('초대 코드가 있어요').click();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '123456' } });
    });
    await act(async () => { clickNext(); });

    await waitFor(() => expect(toastCalls.some((call) => call.level === 'error')).toBe(true));
    // Signing the user out over a mistyped code would be a far worse failure.
    expect(recoverExpiredSession).not.toHaveBeenCalled();
  });
});
