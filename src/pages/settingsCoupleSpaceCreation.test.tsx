import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, Role } from '@/types';

/**
 * A user with no couple space must be able to CREATE one, not only join someone
 * else's code.
 *
 * `createCoupleInvitation` had exactly one caller in the whole app -- the
 * onboarding wizard -- so the ability to make a space disappeared the moment
 * onboarding finished. Meanwhile `CoupleStatusBanner` told a `personal` user
 * "우리 공간을 만들거나 초대 코드를 입력해 보세요" and a `disconnected` user
 * "다시 연결하려면 새 공간을 만들거나 상대방의 초대 코드를 입력해 주세요", and
 * sent both to /settings with a "다시 연결하기" button.
 *
 * /settings rendered a join form and nothing else. So the banners promised a
 * choice the app could not honour, and a user who disconnected was permanently
 * dependent on the other person to mint a code. That is a feature that is
 * unreachable in normal navigation.
 */

const navigate = vi.hoisted(() => vi.fn());
const createCoupleInvitation = vi.hoisted(() => vi.fn());
const consumeCoupleInvitation = vi.hoisted(() => vi.fn());
const regenerateCoupleInvitation = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const refreshCoupleLifecycle = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: null,
  createCoupleInvitation,
  consumeCoupleInvitation,
  regenerateCoupleInvitation,
}));

const currentRole: Role = 'gomsin';

/** A signed-in account with NO couple space -- `personal` or post-disconnect. */
function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'u1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'u1',
      myName: '춘향',
      role: currentRole,
      couple: {
        // The condition under test: no space at all.
        coupleId: undefined,
        partnerName: '',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: false,
        status: 'pending',
      },
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['today_word'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    updateProfile,
    disconnect: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
    deleteRecord: vi.fn(),
    setTheme: vi.fn(),
    invitationExpiresAt: null,
    refreshCoupleLifecycle,
    recoverExpiredSession: vi.fn(),
    exportMyData: vi.fn(),
  }),
}));

const { SettingsPage } = await import('@/pages/SettingsPage');

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

const CREATE_LABEL = '새 우리 공간 만들기';

describe('a user with no couple space can create one from settings', () => {
  beforeEach(() => {
    navigate.mockReset();
    createCoupleInvitation.mockReset();
    updateProfile.mockReset();
    refreshCoupleLifecycle.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it('offers the create affordance alongside the join form', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: CREATE_LABEL })).toBeTruthy();
    // Both halves of the choice the banners promise are present.
    expect(screen.getByRole('button', { name: '초대 코드로 연결하기' })).toBeTruthy();
  });

  it('mints a space and adopts the returned id and code', async () => {
    createCoupleInvitation.mockResolvedValue({ coupleId: 'couple-new', code: '123456' });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: CREATE_LABEL }));

    await waitFor(() => expect(createCoupleInvitation).toHaveBeenCalledWith(currentRole, 'military'));
    const [patch] = updateProfile.mock.calls[0] as [{ couple: Record<string, unknown> }];
    expect(patch.couple.coupleId).toBe('couple-new');
    expect(patch.couple.coupleCode).toBe('123456');
    // Pending, not connected: the partner has not joined yet.
    expect(patch.couple.connected).toBe(false);
    expect(patch.couple.status).toBe('pending');
    // No invented partner.
    expect(patch.couple.partnerName).toBe('');
    // The authoritative expiry is re-read so the code section can show a real
    // deadline rather than only "24시간 동안 유효".
    expect(refreshCoupleLifecycle).toHaveBeenCalled();
  });

  it('reports a failure and adopts nothing', async () => {
    createCoupleInvitation.mockResolvedValue({
      coupleId: '',
      code: '',
      error: '커플 공간을 만들지 못했어요. 권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: CREATE_LABEL }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      '커플 공간을 만들지 못했어요. 권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    ));
    expect(updateProfile).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not fire twice while the first request is still in flight', async () => {
    let release: (value: unknown) => void = () => {};
    createCoupleInvitation.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: CREATE_LABEL }));
    await waitFor(() => expect(createCoupleInvitation).toHaveBeenCalledTimes(1));
    // The button reports the in-flight state and is disabled, so a second tap
    // cannot mint a second couple space.
    const busy = screen.getByRole('button', { name: '만드는 중...' });
    expect(busy).toBeDisabled();

    release({ coupleId: 'couple-new', code: '123456' });
    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(createCoupleInvitation).toHaveBeenCalledTimes(1);
  });
});

describe('the banners that promise a create action point somewhere real', () => {
  const banner = readFileSync(
    resolve(process.cwd(), 'src/components/CoupleStatusBanner.tsx'),
    'utf8',
  );
  const settings = readFileSync(resolve(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');

  it('the banner still sends personal and disconnected users to /settings', () => {
    // If this ever changes, the destination asserted below is the wrong one.
    expect(banner).toContain("navigate('/settings')");
    expect(banner).toContain('우리 공간을 만들거나');
    expect(banner).toContain('새 공간을 만들거나');
  });

  it('settings calls createCoupleInvitation, so the promise can be kept', () => {
    // The regression this file exists for: the import did not exist at all, and
    // the only caller in the app was the onboarding wizard.
    expect(settings).toContain('createCoupleInvitation');
    expect(settings).toContain(CREATE_LABEL);
  });

  it('the create affordance is not gated on a role', () => {
    const at = settings.indexOf(CREATE_LABEL);
    expect(at).toBeGreaterThan(-1);
    const section = settings.slice(Math.max(0, at - 1500), at);
    expect(section).not.toContain("role === 'soldier'");
    expect(section).not.toContain("role === 'gomsin'");
  });
});
