import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';

/**
 * M-1 (continued): the onboarding wizard must not pre-fill the fabricated
 * service period either.
 *
 * `militaryInfoProvenance.test.tsx` closed two doors on the invented
 * `2025-03-10` / `2026-09-09` pair: `sync.ts` no longer substitutes it for a
 * null `military_info`, and `DEFAULT_STATE` no longer seeds it. A third door was
 * left open, and it is the worst of the three because it writes to the SERVER.
 *
 * The wizard's step 5 declares itself optional -- "전역 D-Day 및 복무 진행률에
 * 사용돼요. (나중에 입력 가능)" -- and yet its two date fields were initialised to
 * exactly those literals, with `dischargeDateSource` initialised to
 * `'calculated'`. A 군화 who reads that line, touches nothing and taps 다음 has
 * the pair persisted by `finishSetup` into `profiles.military_info`.
 *
 * That reproduces both lies M-1 documents, and makes the earlier fix moot:
 * `sync.ts` never needs to invent a service period for this account because
 * onboarding already stored the invention. Every dependent surface then renders
 * a specific D-Day and a specific 복무율 with a 자동 계산 badge, for a user who
 * never stated an enlistment date.
 *
 * Absent must stay absent: no dates, and provenance `'unknown'` rather than a
 * `'calculated'` claim about a derivation that never happened.
 */

const FABRICATED_ENLISTMENT = '2025-03-10';
const FABRICATED_DISCHARGE = '2026-09-09';

const { mockSupabase, profileUpserts, contactUpserts, createCoupleInvitation, fetchMyCoupleState } = vi.hoisted(() => {
  const profileUpserts: Record<string, unknown>[] = [];
  const contactUpserts: Record<string, unknown>[] = [];
  return {
    profileUpserts,
    contactUpserts,
    fetchMyCoupleState: vi.fn(),
    createCoupleInvitation: vi.fn(),
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
  consumeCoupleInvitation: vi.fn(),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
  fetchAuthProviderAvailability: vi.fn().mockResolvedValue({
    google: true,
    apple: false,
    email: true,
  }),
  regenerateCoupleInvitation: vi.fn(),
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
  authenticatedUser: { id: 'user-soldier', email: 's@example.com', provider: 'google' as const },
  // Role lives in the wizard's own state, so the service step is only reachable
  // by actually choosing 군화 -- which is what a real run does.
  onboardingStep: 1,
  profile: {
    myName: '',
    role: 'soldier' as const,
    couple: { partnerName: '', coupleCode: '', connected: false, status: 'pending' as const },
    military: {},
    contact: {},
  },
};

const updateProfile = vi.fn();
const setSetupComplete = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    updateProfile: (...args: unknown[]) => updateProfile(...(args as [])),
    setSetupComplete: (...args: unknown[]) => setSetupComplete(...(args as [])),
    setOnboardingStep: vi.fn(),
    recoverExpiredSession: vi.fn(),
  }),
}));

const { OnboardingPage } = await import('@/pages/OnboardingPage');

function clickByText(label: string) {
  const buttons = Array.from(document.querySelectorAll('button'));
  const button = buttons.find((candidate) => candidate.textContent?.trim() === label);
  if (!button) {
    throw new Error(
      `button not found: ${label} — available: ${JSON.stringify(
        buttons.map((b) => b.textContent?.trim()),
      )}`,
    );
  }
  act(() => { button.click(); });
}

/** Tap the step's primary forward CTA, whatever this step happens to call it. */
function advance() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const forward = buttons.find((candidate) => {
    const text = candidate.textContent?.trim();
    return text === '다음' || text === '완료하기';
  });
  if (!forward) {
    throw new Error(
      `no forward CTA — available: ${JSON.stringify(buttons.map((b) => b.textContent?.trim()))}`,
    );
  }
  act(() => { forward.click(); });
}

function clickContaining(fragment: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes(fragment),
  );
  if (!button) throw new Error(`button not found containing: ${fragment}`);
  act(() => { button.click(); });
}

function setInput(input: HTMLInputElement, value: string) {
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
}

/** Walk 군화 from role selection to the service step. */
async function reachServiceStep() {
  render(<OnboardingPage />);
  await waitFor(() =>
    expect(screen.getByText('곰신로그를 어떻게 사용할까요?')).toBeInTheDocument(),
  );

  clickContaining('나는 군화예요');
  advance(); // -> nickname

  await waitFor(() =>
    expect(document.querySelector('input[type="text"]')).toBeTruthy(),
  );
  setInput(document.querySelector('input[type="text"]') as HTMLInputElement, '몽룡');
  advance(); // -> couple space

  await waitFor(() =>
    expect(screen.getByText('우리 둘만의 로그를 시작해볼까요?')).toBeInTheDocument(),
  );
  advance(); // mints the invitation code, stays on step 3
  await waitFor(() => expect(createCoupleInvitation).toHaveBeenCalled());
  advance(); // -> anniversary

  await waitFor(() =>
    expect(screen.getByText('둘은 언제부터 함께였나요?')).toBeInTheDocument(),
  );
  advance(); // 군화 -> service step

  await waitFor(() =>
    expect(screen.getByText('복무 정보를 알려주세요.')).toBeInTheDocument(),
  );
}

/** From the service step to the end, finishing the wizard. */
async function finishFromServiceStep() {
  advance(); // -> contact hours
  await waitFor(() =>
    expect(screen.getByText('주로 언제 오늘의 로그를 확인할 수 있나요?')).toBeInTheDocument(),
  );
  advance(); // -> done
  await waitFor(() => expect(screen.getByText(/준비됐어요/)).toBeInTheDocument());
  clickByText('오늘의 로그 기다리기'); // finishSetup
  await waitFor(() => expect(profileUpserts.length).toBeGreaterThan(0));
}

/**
 * The service step declares itself optional ("나중에 입력 가능"), so touching
 * neither date field is a supported path -- and the one that must not fabricate.
 */
async function completeAsSoldierWithoutTouchingDates() {
  await reachServiceStep();
  await finishFromServiceStep();
}

describe('M-1: onboarding does not pre-fill a fabricated service period', () => {
  beforeEach(() => {
    toastCalls.length = 0;
    profileUpserts.length = 0;
    contactUpserts.length = 0;
    updateProfile.mockReset();
    setSetupComplete.mockReset();
    storeState.profile.myName = '';
    createCoupleInvitation.mockReset().mockResolvedValue({
      coupleId: 'couple-1',
      code: '123456',
      expiresAt: null,
    });
    fetchMyCoupleState.mockReset().mockResolvedValue({
      ok: true,
      state: {
        coupleId: 'couple-1',
        role: 'soldier',
        memberStatus: 'active',
        partnerPresent: false,
        invitationActive: true,
        invitationExpiresAt: null,
      },
    });
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not offer either fabricated literal as a starting value', async () => {
    await reachServiceStep();
    const dateValues = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="date"]'),
    ).map((input) => input.value);

    expect(dateValues).not.toContain(FABRICATED_ENLISTMENT);
    expect(dateValues).not.toContain(FABRICATED_DISCHARGE);
  });

  it('persists no enlistment date when the author never entered one', async () => {
    await completeAsSoldierWithoutTouchingDates();
    const military = profileUpserts[0].military_info as Record<string, unknown>;
    expect(military.enlistmentDate).toBeUndefined();
  });

  it('persists no discharge date when the author never entered one', async () => {
    await completeAsSoldierWithoutTouchingDates();
    const military = profileUpserts[0].military_info as Record<string, unknown>;
    expect(military.expectedDischargeDate).toBeUndefined();
  });

  it('never sends either fabricated literal to the server', async () => {
    await completeAsSoldierWithoutTouchingDates();
    const serialized = JSON.stringify(profileUpserts[0]);
    expect(serialized).not.toContain(FABRICATED_ENLISTMENT);
    expect(serialized).not.toContain(FABRICATED_DISCHARGE);
  });

  it("does not claim a discharge date was 'calculated' when none exists", async () => {
    await completeAsSoldierWithoutTouchingDates();
    const military = profileUpserts[0].military_info as Record<string, unknown>;
    expect(military.dischargeDateSource).toBe('unknown');
  });

  it('mirrors the same absent service period into local state', async () => {
    await completeAsSoldierWithoutTouchingDates();
    const mirrored = updateProfile.mock.calls[0][0] as {
      military: Record<string, unknown>;
    };
    expect(mirrored.military.enlistmentDate).toBeUndefined();
    expect(mirrored.military.expectedDischargeDate).toBeUndefined();
    expect(mirrored.military.dischargeDateSource).toBe('unknown');
  });

  it('PRESERVATION: a real enlistment date is still saved, and still derives a discharge date', async () => {
    await reachServiceStep();

    // 육군 18개월: 2026-03-02 + 18 months
    const enlistment = document.querySelectorAll<HTMLInputElement>('input[type="date"]')[0];
    setInput(enlistment, '2026-03-02');

    await waitFor(() => {
      const discharge = document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1];
      expect(discharge.value).toBe('2027-09-02');
    });

    await finishFromServiceStep();

    const military = profileUpserts[0].military_info as Record<string, unknown>;
    expect(military.enlistmentDate).toBe('2026-03-02');
    expect(military.expectedDischargeDate).toBe('2027-09-02');
    // Derived from a real branch and a real enlistment date, so the claim is true.
    expect(military.dischargeDateSource).toBe('calculated');
  });

  /**
   * Mirrors the existing `sync.ts no longer contains either literal` guard so a
   * future edit cannot quietly reintroduce the pair through the wizard. Scoped
   * to the declarations for the same reason that guard is: the comment
   * explaining the fix names the literals, the initialisers must not.
   */
  it('the wizard declares both date fields empty, not with the fabricated pair', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/OnboardingPage.tsx'),
      'utf8',
    );
    const enlistmentDecl = source.slice(
      source.indexOf('const [enlistmentDate, setEnlistmentDate]'),
    ).split('\n')[0];
    const dischargeDecl = source.slice(
      source.indexOf('const [expectedDischargeDate, setExpectedDischargeDate]'),
    ).split('\n')[0];

    expect(enlistmentDecl).toContain("useState('')");
    expect(dischargeDecl).toContain("useState('')");
    expect(enlistmentDecl).not.toContain(FABRICATED_ENLISTMENT);
    expect(dischargeDecl).not.toContain(FABRICATED_DISCHARGE);
  });
});
