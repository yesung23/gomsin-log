import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import type { SharedSyncStatus } from '@/lib/storeContext';
import type { CoupleLifecycle } from '@/lib/coupleLifecycle';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

let currentState: AppState;
let sharedSyncStatus: SharedSyncStatus;
let coupleLifecycle: CoupleLifecycle;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus,
    coupleLifecycle,
  }),
}));
vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

function baseState(): AppState {
  return {
    setupComplete: true,
    authenticatedUser: { id: 'me' },
    records: [], events: [], trips: [],
    profile: {
      id: 'me',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        coupleCode: '',
        connected: true,
        status: 'active',
        partnerName: '상대',
        partnerUserId: 'partner',
        anniversaryDate: '2026-05-25',
      },
    },
  } as unknown as AppState;
}

const { CompanionGardenPage } = await import('./CompanionGardenPage');

function renderGarden() {
  return render(
    <MemoryRouter initialEntries={['/diary/garden']}>
      <CompanionGardenPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T12:00:00+09:00'));
  navigate.mockReset();
  localStorage.clear();
  currentState = baseState();
  sharedSyncStatus = 'live';
  coupleLifecycle = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('companion garden route authority', () => {
  it('verified active couple + valid anniversary renders the real growth state', () => {
    renderGarden();
    expect(screen.getByRole('heading', { level: 1, name: '우리 정원' })).toBeInTheDocument();
    expect(screen.getByText('함께한 100일')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '든든한 나무' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /친구 들어올리기/ })).toHaveLength(2);
  });

  it.each([undefined, '2026-02-30', 'not-a-date', '2026-12-31'])(
    'missing/future/invalid anniversary (%s) fails closed instead of inventing stage 1',
    (anniversaryDate) => {
      currentState.profile.couple.anniversaryDate = anniversaryDate;
      renderGarden();
      expect(screen.getByText('함께한 날을 설정하면 정원이 자라기 시작해요.')).toBeInTheDocument();
      expect(screen.queryByText(/함께한 \d+일/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /친구 들어올리기/ })).not.toBeInTheDocument();
    },
  );

  it('shared workspace unavailable hides the relationship date and characters', () => {
    sharedSyncStatus = 'unavailable';
    renderGarden();
    expect(screen.getByRole('region', { name: '정원 확인 중' })).toBeInTheDocument();
    expect(screen.getByText('공유 정보를 확인하는 중이에요. 확인되면 정원을 다시 보여드려요.')).toBeInTheDocument();
    expect(screen.queryByText(/함께한 \d+일/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /친구 들어올리기/ })).not.toBeInTheDocument();
  });

  it.each(['unknown', 'personal', 'pending', 'disconnected'] as const)(
    'non-connected server lifecycle %s does not consume cached anniversary date',
    (lifecycle) => {
      coupleLifecycle = lifecycle;
      renderGarden();
      expect(screen.queryByText(/함께한 \d+일/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /친구 들어올리기/ })).not.toBeInTheDocument();
    },
  );

  it('local disconnected state does not consume cached anniversary date', () => {
    currentState.profile.couple.connected = false;
    currentState.profile.couple.status = 'disconnected';
    renderGarden();
    expect(screen.getByText('커플 연결이 확인되면 정원이 자라기 시작해요.')).toBeInTheDocument();
    expect(screen.queryByText(/함께한 \d+일/)).not.toBeInTheDocument();
  });

  it('loads and saves accessories through the real account-scoped page boundary', async () => {
    vi.useRealTimers();
    localStorage.setItem('gomsin.diary.garden.me', JSON.stringify({
      version: 1, peach: 'cap', sage: 'none',
    }));
    const user = userEvent.setup();
    const view = renderGarden();

    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-accessory', 'cap');
    await user.click(screen.getByRole('button', { name: '정원 꾸미기' }));
    await user.click(screen.getByRole('radio', { name: '초록 친구 꽃' }));
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-accessory', 'flower');
    expect(JSON.parse(localStorage.getItem('gomsin.diary.garden.me') || '{}')).toMatchObject({
      version: 1, peach: 'cap', sage: 'flower',
    });

    view.unmount();
    renderGarden();
    expect(screen.getByTestId('garden-companion-peach')).toHaveAttribute('data-accessory', 'cap');
    expect(screen.getByTestId('garden-companion-sage')).toHaveAttribute('data-accessory', 'flower');
  });

  it('back is explicit and returns to diary', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderGarden();
    await user.click(screen.getByRole('button', { name: '이전 화면으로' }));
    expect(navigate).toHaveBeenCalledWith('/diary');
  });

  it('does not create a second main landmark inside MobileShell', () => {
    renderGarden();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: '일기장' })).toHaveAttribute('aria-selected', 'true');
  });
});
