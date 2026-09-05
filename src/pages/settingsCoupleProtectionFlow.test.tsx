import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  loadFacts: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
  installRuntime: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  userId: 'aaaaaaaa-0000-4000-8000-00000000000a',
  isDeviceProtectionEnabled: true,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ContactHoursSection', () => ({ ContactHoursSection: () => null }));
vi.mock('@/components/HandwritingSection', () => ({ HandwritingSection: () => null }));
vi.mock('@/components/NotificationPreferencesSection', () => ({
  NotificationPreferencesSection: () => null,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
  consumeCoupleInvitation: vi.fn(),
  createCoupleInvitation: vi.fn(),
  regenerateCoupleInvitation: vi.fn(),
}));

vi.mock('@/app/e2ee/settingsFacts', () => ({
  activeCoupleScopeId: () => '11111111-0000-4000-8000-000000000001',
  loadSettingsBootstrapFacts: mocks.loadFacts,
}));

vi.mock('@/app/e2ee/coupleProtectionFlow', () => ({
  prepareCoupleProtectionCeremony: mocks.prepare,
  confirmCoupleProtectionCeremony: mocks.confirm,
}));

vi.mock('@/app/e2ee/runtimeSession', () => ({
  E2EE_RUNTIME_INSTALLATION_ID: 'settings-test-installation',
  installE2eeRuntimeForAuthenticatedSession: mocks.installRuntime,
}));

vi.mock('@/app/e2ee/featureFlag', () => ({
  isDeviceProtectionEnabled: () => mocks.isDeviceProtectionEnabled,
}));
vi.mock('@/app/e2ee/protectedLocalState', () => ({
  createProtectedE2eeLocalState: async () => ({}),
}));
vi.mock('@/data/e2ee/SupabaseE2eeRepository', () => ({
  createSupabaseE2eeRepository: () => ({}),
}));
vi.mock('@/app/e2ee/deviceProtectionFlow', () => ({
  getDeviceProtectionPorts: () => ({ deviceKeys: {}, localKeys: {} }),
  createDeviceProtectionFlow: () => ({}),
}));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      authenticatedUser: { id: mocks.userId, email: 'a@example.test' },
      profile: {
        id: 'aaaaaaaa-0000-4000-8000-00000000000a',
        myName: '춘향',
        role: 'gomsin',
        couple: {
          coupleId: '11111111-0000-4000-8000-000000000001',
          partnerName: '몽룡',
          connected: true,
          status: 'active',
          anniversaryDate: '2025-01-01',
          coupleCode: '',
        },
        military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
        contact: {
          weekdayStart: '18:00', weekdayEnd: '21:00',
          weekendStart: '12:00', weekendEnd: '21:00', enabled: true,
        },
      },
      records: [],
      events: [],
      trips: [],
      widgetLayout: [],
      theme: 'light',
    },
    updateProfile: vi.fn(),
    disconnect: vi.fn(),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
    deleteRecord: vi.fn(),
    setTheme: vi.fn(),
    invitationExpiresAt: null,
    refreshCoupleLifecycle: vi.fn(),
    recoverExpiredSession: vi.fn(),
    setPartnerUsername: vi.fn(),
  }),
}));

const { SettingsPage } = await import('./SettingsPage');

const baseCeremony = {
  pairingId: 'pairing-1',
  coupleId: '11111111-0000-4000-8000-000000000001',
  ownUserId: 'aaaaaaaa-0000-4000-8000-00000000000a',
  partnerUserId: 'bbbbbbbb-0000-4000-8000-00000000000b',
  ownDeviceId: 'device-a',
  transcript: {},
  transcriptHash: new Uint8Array(32),
  ownSide: {},
  partnerSide: {},
  sas: '142 857 309 624',
  expiresAtMs: Date.now() + 300_000,
  ownConfirmed: false,
  partnerConfirmed: false,
  cryptoActive: false,
  canonicalOwner: true,
};

describe('Settings two-account record-protection flow', () => {
  beforeEach(() => {
    mocks.loadFacts.mockReset();
    mocks.prepare.mockReset();
    mocks.confirm.mockReset();
    mocks.installRuntime.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.userId = 'aaaaaaaa-0000-4000-8000-00000000000a';
    mocks.isDeviceProtectionEnabled = true;
    mocks.loadFacts
      .mockResolvedValueOnce({ status: 'PAIRING_REQUIRED' })
      .mockResolvedValue({ status: 'PROTECTED' });
    mocks.prepare
      .mockResolvedValueOnce(baseCeremony)
      .mockResolvedValueOnce({
        ...baseCeremony,
        ownConfirmed: true,
        partnerConfirmed: true,
      });
    mocks.confirm
      .mockResolvedValueOnce({ ...baseCeremony, ownConfirmed: true })
      .mockResolvedValueOnce({
        ...baseCeremony,
        ownConfirmed: true,
        partnerConfirmed: true,
        cryptoActive: true,
      });
    mocks.installRuntime.mockResolvedValue({
      status: 'installed',
      coupleProtection: 'activated',
    });
  });

  it('renders the SAS, waits after one confirmation, then closes only after verified activation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    const start = await screen.findByRole('button', { name: /둘의 기록 보호 연결/ });
    await user.click(start);

    const dialog = await screen.findByRole('dialog', { name: '둘의 보호 코드 확인' });
    expect(screen.getByTestId('couple-protection-sas')).toHaveTextContent('142 857 309 624');
    expect(dialog).toHaveTextContent('내 기기 확인 전');
    expect(dialog).toHaveTextContent('상대 기기 확인 전');

    await user.click(screen.getByRole('button', { name: '코드가 같아요' }));
    expect(await screen.findByRole('button', { name: '상태 새로고침' })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: '둘의 보호 코드 확인' }))
      .toHaveTextContent('상대 기기 확인 전');
    expect(mocks.installRuntime).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '내 확인을 저장했어요. 상대방의 확인을 기다릴게요.',
    );

    await user.click(screen.getByRole('button', { name: '상태 새로고침' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '둘의 보호 코드 확인' })).toBeNull();
    });
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.installRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenLastCalledWith('둘의 기록 보호를 연결했어요.');
  });

  it('discards the previous account ceremony immediately when the authenticated identity changes', async () => {
    const user = userEvent.setup();
    const rendered = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: /둘의 기록 보호 연결/ }));
    expect(await screen.findByRole('dialog', { name: '둘의 보호 코드 확인' })).toBeVisible();

    mocks.userId = 'bbbbbbbb-0000-4000-8000-00000000000b';
    rendered.rerender(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '둘의 보호 코드 확인' })).toBeNull();
    });
    expect(screen.queryByTestId('couple-protection-sas')).toBeNull();
  });

  it('does not render device protection section or entry points and skips bootstrap when disabled', () => {
    mocks.isDeviceProtectionEnabled = false;
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('device-protection')).toBeNull();
    expect(screen.queryByRole('heading', { name: '기록 보호' })).toBeNull();
    expect(screen.queryByRole('button', { name: /둘의 기록 보호 연결/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /보호 설정 시작/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /기록 보호 복구/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '둘의 보호 코드 확인' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /기록 보호|복구 수단/ })).toBeNull();
    expect(mocks.loadFacts).not.toHaveBeenCalled();
  });

  it('renders device protection section and performs bootstrap when enabled', async () => {
    mocks.isDeviceProtectionEnabled = true;
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('device-protection')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '기록 보호' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /둘의 기록 보호 연결/ })).toBeInTheDocument();
    expect(mocks.loadFacts).toHaveBeenCalledWith({
      userId: mocks.userId,
      coupleId: '11111111-0000-4000-8000-000000000001',
      supabaseClient: expect.anything(),
    });
  });
});
