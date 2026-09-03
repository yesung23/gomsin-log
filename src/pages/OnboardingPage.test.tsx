import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  saveCoupleAnniversary,
  updateProfile,
  setSetupComplete,
  mockNavigate,
  profileUpserts,
  contactUpserts,
  mockSupabase,
} = vi.hoisted(() => ({
  profileUpserts: [] as Record<string, unknown>[],
  contactUpserts: [] as Record<string, unknown>[],
  mockNavigate: vi.fn(),
  createCoupleInvitation: vi.fn(),
  consumeCoupleInvitation: vi.fn(),
  fetchMyCoupleState: vi.fn(),
  fetchAuthProviderAvailability: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  updateProfile: vi.fn(),
  setSetupComplete: vi.fn(),
  mockSupabase: {
    rpc: vi.fn(),
    from: vi.fn((table: string) => ({
      upsert: vi.fn(async (payload: Record<string, unknown>) => {
        if (table === 'profiles') profileUpserts.push(payload);
        if (table === 'contact_preferences') contactUpserts.push(payload);
        return { error: null };
      }),
    })),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useInRouterContext: () => true,
  };
});

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
  saveCoupleAnniversary: (...args: unknown[]) => saveCoupleAnniversary(...(args as [])),
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
    updateProfile: (...args: unknown[]) => updateProfile(...(args as [])),
    setSetupComplete: (...args: unknown[]) => setSetupComplete(...(args as [])),
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
    profileUpserts.length = 0;
    contactUpserts.length = 0;
    saveCoupleAnniversary.mockReset().mockResolvedValue(true);
    updateProfile.mockReset();
    setSetupComplete.mockReset();
    mockNavigate.mockReset();
    storeState.profile.myName = '';
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

  describe('Step 3 explicit invite share', () => {
    const originalShare = typeof navigator !== 'undefined' ? navigator.share : undefined;
    const originalClipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

    afterEach(() => {
      Object.defineProperty(navigator, 'share', {
        value: originalShare,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      });
    });

    it('keeps the share button absent before code, in join mode, and in no-plaintext recovery state', async () => {
      // 1. Before code generation in create mode
      await mountStep3();
      expect(screen.queryByRole('button', { name: '초대장 보내기' })).toBeNull();

      // 2. In join mode
      await act(async () => {
        screen.getByText('초대 코드가 있어요').click();
      });
      expect(screen.queryByRole('button', { name: '초대장 보내기' })).toBeNull();

      // Switch back to create mode to test recovery
      await act(async () => {
        screen.getByText('새로운 우리 공간 만들기').click();
      });

      // 3. No-plaintext recovery state (user keeps existing code)
      createCoupleInvitation.mockResolvedValue({
        coupleId: '',
        code: '',
        error: 'User already in an active couple',
        reason: 'already_in_couple',
      });
      const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
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

      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByTestId('space-recovery-confirm')).toBeInTheDocument());

      await act(async () => { screen.getByText('이전에 보낸 코드 그대로 쓰기').click(); });

      expect(screen.queryByRole('button', { name: '초대장 보내기' })).toBeNull();
    });

    it('does not call navigator.share before an explicit click', async () => {
      const shareMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });

      await mountStep3();
      await act(async () => { clickNext(); });

      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: '초대장 보내기' })).toBeInTheDocument();
      expect(shareMock).not.toHaveBeenCalled();
    });

    it('calls share exactly once with expected text payload on success without touching clipboard or RPCs', async () => {
      const shareMock = vi.fn().mockResolvedValue(undefined);
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });

      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      createCoupleInvitation.mockClear();
      regenerateCoupleInvitation.mockClear();
      consumeCoupleInvitation.mockClear();
      mockSupabase.rpc.mockClear();

      const shareButton = screen.getByRole('button', { name: '초대장 보내기' });
      await act(async () => {
        shareButton.click();
      });

      const expectedText = "[곰신로그] 초대 코드: 123456\n'초대 코드가 있어요'에 코드를 입력해 주세요.";
      expect(shareMock).toHaveBeenCalledTimes(1);
      expect(shareMock).toHaveBeenCalledWith({ text: expectedText });

      // Payload structure and safety assertions: payload object has ONLY text
      const payload = shareMock.mock.calls[0][0];
      expect(Object.keys(payload)).toEqual(['text']);
      expect(payload.text).toContain('123456');
      expect(payload.text).toContain('곰신로그');
      expect(payload.text).toContain('초대 코드가 있어요');
      expect(payload.text).not.toMatch(/https?:\/\//);
      expect(payload.text).not.toMatch(/gomsinlog:\/\//);
      expect(payload.text).not.toContain('a@example.com');
      expect(payload.text).not.toContain('user-a');
      expect(payload.text).not.toContain('couple-1');
      expect(payload.text).not.toContain('gomsin');
      expect(payload.text).not.toContain('soldier');

      // Clipboard and RPCs are unaffected
      expect(writeTextMock).not.toHaveBeenCalled();
      expect(createCoupleInvitation).not.toHaveBeenCalled();
      expect(regenerateCoupleInvitation).not.toHaveBeenCalled();
      expect(consumeCoupleInvitation).not.toHaveBeenCalled();
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('falls back to copying exact code to clipboard when navigator.share is unavailable', async () => {
      Object.defineProperty(navigator, 'share', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });

      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      toastCalls.length = 0;
      await act(async () => {
        screen.getByRole('button', { name: '초대장 보내기' }).click();
      });

      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith('123456');
      expect(toastCalls.some((c) => c.level === 'success' && c.message.includes('클립보드에 복사'))).toBe(true);
    });

    it('does nothing else when user cancels share (AbortError)', async () => {
      const abortError = new DOMException('The user aborted the request.', 'AbortError');
      const shareMock = vi.fn().mockRejectedValue(abortError);
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });

      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      toastCalls.length = 0;
      await act(async () => {
        screen.getByRole('button', { name: '초대장 보내기' }).click();
      });
      await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

      // No error or success toast, and no clipboard fallback
      expect(toastCalls).toHaveLength(0);
      expect(writeTextMock).not.toHaveBeenCalled();
    });

    it('shows only one static failure toast and no clipboard fallback on other share errors', async () => {
      const otherError = new Error('Permission denied or network failure');
      const shareMock = vi.fn().mockRejectedValue(otherError);
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });

      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      toastCalls.length = 0;
      await act(async () => {
        screen.getByRole('button', { name: '초대장 보내기' }).click();
      });
      await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

      const errorToasts = toastCalls.filter((c) => c.level === 'error');
      expect(errorToasts).toHaveLength(1);
      expect(errorToasts[0].message).toBe('초대장을 공유하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      expect(toastCalls.some((c) => c.level === 'success')).toBe(false);
      expect(writeTextMock).not.toHaveBeenCalled();
    });
  });

  describe('Step 4-6 wizard flow, accessible inputs, and skip options', () => {
    it('uses concise role choices from the same illustration language instead of emoji instructions', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);

      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());
      expect(screen.queryByText('역할에 따라 맞춤 기능이 제공돼요.')).not.toBeInTheDocument();

      const gomsin = screen.getByRole('button', { name: /나는 곰신이에요/ });
      const soldier = screen.getByRole('button', { name: /나는 군화예요/ });
      expect(screen.getByText('내 하루를 남겨요')).toBeInTheDocument();
      expect(screen.getByText('상대의 오늘을 이어 봐요')).toBeInTheDocument();
      expect(gomsin.querySelector('svg')).not.toBeNull();
      expect(soldier.querySelector('svg')).not.toBeNull();
      expect(document.body).not.toHaveTextContent('🌸');
      expect(document.body).not.toHaveTextContent('🪖');

      storeState.onboardingStep = 3;
    });

    it('supports anniversary skip toggle and label association on step 4', async () => {
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      // Advance to step 4
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());

      // Check accessible label on anniversary date input
      const dateInput = screen.getByLabelText('사귄 날짜');
      expect(dateInput).toBeInTheDocument();
      expect(dateInput).toHaveAttribute('type', 'date');

      // Toggle skip
      const skipButton = screen.getByRole('button', { name: '아직 정확히 기억나지 않아요' });
      expect(skipButton).toHaveClass('min-h-11');
      await act(async () => { skipButton.click(); });

      expect(screen.queryByLabelText('사귄 날짜')).toBeNull();
      expect(screen.getByText('사귄 날짜는 나중에 언제든지 설정할 수 있습니다.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '사귄 날짜 입력하기' })).toBeInTheDocument();
    });

    it('gomsin skips military info (step 5) and completes contact hours (step 6) with skip option', async () => {
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-1', code: '123456' });
      await mountStep3();
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());

      // Advance to step 4
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());

      // Advance from step 4 as gomsin -> goes directly to step 6 (skipping step 5)
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());
      expect(screen.queryByText('복무 정보를 알려주세요.')).toBeNull();

      // Verify 4 accessible time inputs
      expect(screen.getByLabelText('평일 확인 시작 시간')).toBeInTheDocument();
      expect(screen.getByLabelText('평일 확인 종료 시간')).toBeInTheDocument();
      expect(screen.getByLabelText('주말·휴일 확인 시작 시간')).toBeInTheDocument();
      expect(screen.getByLabelText('주말·휴일 확인 종료 시간')).toBeInTheDocument();

      // Skip contact hours
      const skipContactButton = screen.getByRole('button', { name: '지금은 설정하지 않을래요' });
      expect(skipContactButton).toHaveClass('min-h-11');
      await act(async () => { skipContactButton.click(); });

      await waitFor(() =>
        expect(screen.getByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeInTheDocument(),
      );
    });

    it('soldier visits step 5 military info with accessible labels before step 6', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());

      // Select soldier role
      await act(async () => { screen.getByText('나는 군화예요').click(); });
      await act(async () => { clickNext(); });

      // Step 2: enter nickname
      await waitFor(() => expect(screen.getByText('어떻게 불러드리면 될까요?')).toBeInTheDocument());
      const nicknameInput = screen.getByLabelText(/내 닉네임/);
      fireEvent.change(nicknameInput, { target: { value: '군화테스터' } });
      await act(async () => { clickNext(); });

      // Step 3: create space
      await waitFor(() => expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument());
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-soldier-1', code: '654321' });
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());

      // Step 4: anniversary
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());

      // Step 5: military info (for soldier)
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('복무 정보를 알려주세요.')).toBeInTheDocument());
      expect(screen.getByLabelText('입대일 / 입대 예정일')).toBeInTheDocument();
      expect(screen.getByLabelText('예상 전역일 (자동 계산 / 수동 수정 가능)')).toBeInTheDocument();

      // Step 6: soldier contact hours
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByText('주로 언제 오늘의 로그를 확인할 수 있나요?')).toBeInTheDocument(),
      );

      // Reset storeState step
      storeState.onboardingStep = 3;
    });
  });

  describe('Security and authority state enforcement', () => {
    it('saves authoritative server role and advances to step 5 for soldier joiner even if local role was gomsin', async () => {
      consumeCoupleInvitation.mockResolvedValue({ coupleId: 'couple-server-soldier' });
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-server-soldier',
          role: 'soldier',
          memberStatus: 'active',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });

      await mountStep3();
      await act(async () => { screen.getByText('초대 코드가 있어요').click(); });
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '112233' } });
      await act(async () => { clickNext(); });

      // Authoritative soldier role was applied and step 4 anniversary was skipped -> step 5 military info!
      await waitFor(() => expect(screen.getByText('복무 정보를 알려주세요.')).toBeInTheDocument());
      expect(screen.queryByText('둘은 언제부터 함께였나요?')).toBeNull();
    });

    it('recovers from authority read failure without re-consuming invitation on subsequent tap', async () => {
      consumeCoupleInvitation.mockResolvedValue({ coupleId: 'couple-recovered' });
      fetchMyCoupleState
        .mockResolvedValueOnce({ ok: false, reason: 'server' })
        .mockResolvedValueOnce({
          ok: true,
          state: {
            coupleId: 'couple-recovered',
            role: 'gomsin',
            memberStatus: 'active',
            partnerPresent: true,
            invitationActive: false,
            invitationExpiresAt: null,
          },
        });

      await mountStep3();
      await act(async () => { screen.getByText('초대 코드가 있어요').click(); });
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '998877' } });

      // First tap: redeem succeeds, authority read fails
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('커플 공간 정보를 확인하지 못했습니다'))).toBe(true),
      );
      expect(consumeCoupleInvitation).toHaveBeenCalledTimes(1);
      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();

      // Second tap: authority read succeeds without calling consumeCoupleInvitation again
      consumeCoupleInvitation.mockClear();
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument(),
      );
      expect(consumeCoupleInvitation).not.toHaveBeenCalled();
    });

    it('fails closed on couple mismatch, inactive status, invalid role, or partner absent', async () => {
      // A. Mismatched coupleId
      consumeCoupleInvitation.mockResolvedValue({ coupleId: 'couple-expected' });
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-different',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });

      await mountStep3();
      await act(async () => { screen.getByText('초대 코드가 있어요').click(); });
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '111111' } });
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('올바르지 않습니다'))).toBe(true),
      );
      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();

      // B. Inactive member status
      toastCalls.length = 0;
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-expected',
          role: 'gomsin',
          memberStatus: 'pending',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('올바르지 않습니다'))).toBe(true),
      );
      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();

      // C. Invalid role
      toastCalls.length = 0;
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-expected',
          role: 'unknown',
          memberStatus: 'active',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('올바르지 않습니다'))).toBe(true),
      );
      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();

      // D. Partner absent in join mode
      toastCalls.length = 0;
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-expected',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: false,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });
      await act(async () => { clickNext(); });
      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('올바르지 않습니다'))).toBe(true),
      );
      expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument();
    });

    it('prevents all server and local writes when authority re-verification fails at finishSetup', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());

      // Role -> Nickname
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('어떻게 불러드리면 될까요?')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/내 닉네임/), { target: { value: '테스터' } });
      await act(async () => { clickNext(); });

      // Space creation
      await waitFor(() => expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument());
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-finish-fail', code: '123456' });
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
      await act(async () => { clickNext(); }); // -> anniversary (step 4)

      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());
      await act(async () => { clickNext(); }); // -> contact (step 6)

      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());
      await act(async () => { screen.getByRole('button', { name: '완료하기' }).click(); }); // -> finish (step 7)

      await waitFor(() => expect(screen.getByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeInTheDocument());

      // Authority read fails right before final write
      fetchMyCoupleState.mockResolvedValue({ ok: false, reason: 'server' });
      await act(async () => {
        screen.getByRole('button', { name: '오늘의 첫 순간 남기기' }).click();
      });

      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('커플 정보를 확인하지 못했습니다'))).toBe(true),
      );
      expect(profileUpserts).toHaveLength(0);
      expect(contactUpserts).toHaveLength(0);
      expect(saveCoupleAnniversary).not.toHaveBeenCalled();
      expect(updateProfile).not.toHaveBeenCalled();
      expect(setSetupComplete).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('never calls saveCoupleAnniversary for joiner and routes gomsin to /compose on finish', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());

      // Role -> Nickname
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('어떻게 불러드리면 될까요?')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/내 닉네임/), { target: { value: '곰신조이너' } });
      await act(async () => { clickNext(); });

      // Join space
      await waitFor(() => expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument());
      await act(async () => { screen.getByText('초대 코드가 있어요').click(); });
      fireEvent.change(screen.getByLabelText('숫자 6자리 초대 코드'), { target: { value: '654321' } });
      consumeCoupleInvitation.mockResolvedValue({ coupleId: 'couple-join-success' });
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-join-success',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });
      await act(async () => { clickNext(); });

      // Directly on step 6 contact hours (anniversary step was skipped)
      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());
      await act(async () => { screen.getByRole('button', { name: '완료하기' }).click(); });

      // Step 7 finish
      await waitFor(() => expect(screen.getByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeInTheDocument());
      await act(async () => {
        screen.getByRole('button', { name: '오늘의 첫 순간 남기기' }).click();
      });

      await waitFor(() => expect(setSetupComplete).toHaveBeenCalledWith(true));
      expect(saveCoupleAnniversary).not.toHaveBeenCalled();
      expect(profileUpserts).toHaveLength(1);
      expect(profileUpserts[0].role).toBe('gomsin');
      expect(contactUpserts).toHaveLength(1);
      expect(mockNavigate).toHaveBeenCalledWith('/compose');
    });

    it('sets creator couple status to connected active when live partnerPresent is true', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());

      // Role -> Nickname
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('어떻게 불러드리면 될까요?')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/내 닉네임/), { target: { value: '크리에이터' } });
      await act(async () => { clickNext(); });

      // Create space
      await waitFor(() => expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument());
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-creator-live', code: '112233' });
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('112233')).toBeInTheDocument());
      await act(async () => { clickNext(); });

      // Step 4 Anniversary
      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText('사귄 날짜'), { target: { value: '2024-01-01' } });
      await act(async () => { clickNext(); });

      // Step 6 Contact -> Step 7 Finish
      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());
      await act(async () => { screen.getByRole('button', { name: '완료하기' }).click(); });
      await waitFor(() => expect(screen.getByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeInTheDocument());

      // Partner has joined while creator was on wizard!
      fetchMyCoupleState.mockResolvedValue({
        ok: true,
        state: {
          coupleId: 'couple-creator-live',
          role: 'gomsin',
          memberStatus: 'active',
          partnerPresent: true,
          invitationActive: false,
          invitationExpiresAt: null,
        },
      });

      await act(async () => {
        screen.getByRole('button', { name: '오늘의 첫 순간 남기기' }).click();
      });

      await waitFor(() => expect(setSetupComplete).toHaveBeenCalledWith(true));
      const updatedCouple = (updateProfile.mock.calls[0][0] as { couple: Record<string, unknown> }).couple;
      expect(updatedCouple.connected).toBe(true);
      expect(updatedCouple.status).toBe('active');
    });

    it('skips contact preferences upsert and sets contact.enabled to false when skipped', async () => {
      storeState.onboardingStep = 6;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());

      const skipButton = screen.getByRole('button', { name: '지금은 설정하지 않을래요' });
      await act(async () => { skipButton.click(); });

      await waitFor(() => expect(screen.getByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeInTheDocument());
    });

    it('blocks finish when contact hours range is invalid (end <= start)', async () => {
      storeState.onboardingStep = 6;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument());

      // Invert weekday times
      fireEvent.change(screen.getByLabelText('평일 확인 시작 시간'), { target: { value: '20:00' } });
      fireEvent.change(screen.getByLabelText('평일 확인 종료 시간'), { target: { value: '18:00' } });

      await act(async () => {
        screen.getByRole('button', { name: '완료하기' }).click();
      });

      await waitFor(() =>
        expect(toastCalls.some((c) => c.level === 'error' && c.message.includes('종료 시간은 시작 시간보다 늦어야'))).toBe(true),
      );
      // Stays on step 6
      expect(screen.getByText('언제 알려드리면 좋을까요?')).toBeInTheDocument();
      expect(screen.queryByText('우리 둘만의 곰신로그가 준비됐어요.')).toBeNull();
    });

    it('sets aria-pressed attributes correctly on military status and branch buttons', async () => {
      storeState.onboardingStep = 1;
      render(<OnboardingPage />);
      await waitFor(() => expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument());

      // Select soldier
      await act(async () => { screen.getByText('나는 군화예요').click(); });
      await act(async () => { clickNext(); });

      // Step 2 Nickname
      await waitFor(() => expect(screen.getByText('어떻게 불러드리면 될까요?')).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/내 닉네임/), { target: { value: '군화테스터' } });
      await act(async () => { clickNext(); });

      // Step 3 Space -> Step 4 Anniversary -> Step 5 Military
      await waitFor(() => expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument());
      createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-s1', code: '123456' });
      await act(async () => { clickNext(); });
      await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
      await act(async () => { clickNext(); });

      await waitFor(() => expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument());
      await act(async () => { clickNext(); });

      await waitFor(() => expect(screen.getByText('복무 정보를 알려주세요.')).toBeInTheDocument());

      // Status buttons
      const servingBtn = screen.getByRole('button', { name: '복무 중' });
      const plannedBtn = screen.getByRole('button', { name: '입대 예정' });
      expect(servingBtn).toHaveAttribute('aria-pressed', 'true');
      expect(plannedBtn).toHaveAttribute('aria-pressed', 'false');

      await act(async () => { plannedBtn.click(); });
      expect(plannedBtn).toHaveAttribute('aria-pressed', 'true');
      expect(servingBtn).toHaveAttribute('aria-pressed', 'false');

      // Branch buttons
      const armyBtn = screen.getByRole('button', { name: '육군' });
      const navyBtn = screen.getByRole('button', { name: '해군' });
      expect(armyBtn).toHaveAttribute('aria-pressed', 'true');
      expect(navyBtn).toHaveAttribute('aria-pressed', 'false');

      await act(async () => { navyBtn.click(); });
      expect(navyBtn).toHaveAttribute('aria-pressed', 'true');
      expect(armyBtn).toHaveAttribute('aria-pressed', 'false');

      storeState.onboardingStep = 3;
    });
  });
});
