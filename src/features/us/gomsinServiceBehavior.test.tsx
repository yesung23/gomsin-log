import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AppState, MilitaryInfo, PartnerServiceInfo } from '@/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let storeState: AppState;
const updateProfile = vi.fn();
const saveCoupleHighlight = vi.fn();
const deleteCoupleHighlight = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    isReady: true,
    coupleLifecycle: storeState.profile.couple?.connected ? 'connected' : 'disconnected',
    updateProfile,
    saveCoupleHighlight,
    deleteCoupleHighlight,
  }),
}));

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <div data-testid="mobile-shell">{children}</div>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

const { PaperProfile } = await import('@/features/us/PaperProfile');
const { ServiceProgressWidget } = await import('@/lib/widgetComponents');
const { ServicePage } = await import('@/pages/ServicePage');

const PARTNER_MILITARY: PartnerServiceInfo = {
  branch: 'army',
  militaryStatus: 'serving',
  enlistmentDate: '2025-09-01',
  expectedDischargeDate: '2027-02-28',
  dischargeDateSource: 'manual',
};

const SOLDIER_MILITARY: MilitaryInfo = {
  branch: 'airforce',
  militaryStatus: 'serving',
  enlistmentDate: '2025-05-01',
  expectedDischargeDate: '2027-01-31',
  dischargeDateSource: 'calculated',
};

function createGomsinState({
  connected = true,
  status = 'active' as const,
  partnerMilitary = PARTNER_MILITARY as PartnerServiceInfo | undefined,
  caption = '전역까지 (전역)',
} = {}): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'gomsin-1' },
    profile: {
      id: 'gomsin-1',
      myName: '지수',
      username: 'jisoo',
      role: 'gomsin',
      profileCaption: caption,
      couple: {
        coupleId: 'couple-1',
        partnerUserId: 'soldier-1',
        partnerName: '민우',
        anniversaryDate: '2024-01-01',
        coupleCode: 'COUPLE123',
        connected,
        status,
        ...(partnerMilitary ? { partnerMilitary } : {}),
      },
      military: {
        branch: 'army',
        militaryStatus: 'unknown',
        dischargeDateSource: 'unknown',
      },
      contact: {
        enabled: true,
        weekdayStart: '09:00',
        weekdayEnd: '18:00',
        weekendStart: '10:00',
        weekendEnd: '20:00',
      },
    },
    records: [],
    events: [
      {
        id: 'ev-1',
        coupleId: 'couple-1',
        title: '첫 정기휴가',
        startDate: '2026-09-15',
        endDate: '2026-09-20',
        eventType: 'vacation',
        isPrivate: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    trips: [],
    widgetLayout: ['service_progress'],
  } as unknown as AppState;
}

function createSoldierState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'soldier-1' },
    profile: {
      id: 'soldier-1',
      myName: '민우',
      username: 'minwoo',
      role: 'soldier',
      profileCaption: '복무 중 (전역)',
      couple: {
        coupleId: 'couple-1',
        partnerUserId: 'gomsin-1',
        partnerName: '지수',
        anniversaryDate: '2024-01-01',
        coupleCode: 'COUPLE123',
        connected: true,
        status: 'active',
      },
      military: SOLDIER_MILITARY,
      contact: {
        enabled: true,
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
      },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['service_progress'],
  } as unknown as AppState;
}

describe('Gomsin Service Integration & Security Invariants', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    updateProfile.mockReset().mockResolvedValue(true);
    saveCoupleHighlight.mockReset().mockResolvedValue({ ok: true });
    deleteCoupleHighlight.mockReset().mockResolvedValue(true);
    localStorage.clear();
  });

  describe('1. 우리 탭 (/us, PaperProfile / SharedProfile)', () => {
    it('연결된 활성 곰신: 군화 파트너의 전역일로 세 번째 통계 슬롯과 프로필 캡션 (전역) 토큰을 정상 계산한다', () => {
      localStorage.setItem('gomsinlog:third_slot:gomsin-1', 'discharge');
      storeState = createGomsinState({
        connected: true,
        status: 'active',
        partnerMilitary: PARTNER_MILITARY,
        caption: '기다림 (전역)',
      });

      render(
        <MemoryRouter>
          <PaperProfile />
        </MemoryRouter>,
      );

      // 세 번째 통계 슬롯 라벨에 '전역까지'가 표출되어야 함
      expect(screen.getByText('전역까지')).toBeInTheDocument();
      // 파트너 전역일(2027-02-28) 기반 D-Day 숫자가 렌더링됨
      const statButtons = screen.getAllByRole('button');
      const dischargeStatButton = statButtons.find((btn) => btn.textContent?.includes('전역까지'));
      expect(dischargeStatButton).toBeDefined();
      expect(dischargeStatButton?.textContent).toContain('전역까지');
      expect(dischargeStatButton?.textContent).toMatch(/\d+전역까지/);

      // 프로필 캡션의 (전역) 토큰이 파트너 전역 잔여일 숫자로 치환되어 렌더링됨
      expect(screen.getByText(/기다림\s+\d+/)).toBeInTheDocument();
    });

    it('연결 해제된 곰신: 메모리에 잔존 partnerMilitary가 있어도 fail-closed 되어 군 복무 D-Day를 노출하지 않는다', () => {
      localStorage.setItem('gomsinlog:third_slot:gomsin-1', 'discharge');
      storeState = createGomsinState({
        connected: false,
        status: 'disconnected',
        partnerMilitary: PARTNER_MILITARY,
        caption: '기다림 (전역)',
      });

      render(
        <MemoryRouter>
          <PaperProfile />
        </MemoryRouter>,
      );

      // 군 복무 정보가 없으므로 thirdSlot은 기념일 등으로 안전하게 fallback 됨
      expect(screen.queryByText('전역까지')).not.toBeInTheDocument();
      // 캡션도 파트너 군복무 날짜를 이용한 D-Day를 생성하지 않음
      expect(screen.queryByText(/기다림\s+D-\d+/)).not.toBeInTheDocument();
    });
  });

  describe('2. 복무 진행률 위젯 (ServiceProgressWidget)', () => {
    it('연결된 활성 곰신: 파트너의 군복무 진척도와 일수를 렌더링한다', () => {
      storeState = createGomsinState({
        connected: true,
        status: 'active',
        partnerMilitary: PARTNER_MILITARY,
      });

      render(
        <MemoryRouter>
          <ServiceProgressWidget />
        </MemoryRouter>,
      );

      // 빈 상태 문구가 아닌 실제 진행률 텍스트 표출
      expect(screen.queryByText('입대일과 전역일을 입력하면 진행률을 보여드려요.')).not.toBeInTheDocument();
      expect(screen.getByText(/일 \/ \d+일/)).toBeInTheDocument();
      expect(screen.getByText(/% 진행/)).toBeInTheDocument();
    });

    it('연결 해제 / 미연결 곰신: 잔존 partnerMilitary가 있어도 빈 상태를 표출한다', () => {
      storeState = createGomsinState({
        connected: false,
        status: 'disconnected',
        partnerMilitary: PARTNER_MILITARY,
      });

      render(
        <MemoryRouter>
          <ServiceProgressWidget />
        </MemoryRouter>,
      );

      expect(screen.getByText('입대일과 전역일을 입력하면 진행률을 보여드려요.')).toBeInTheDocument();
      expect(screen.queryByText(/% 진행/)).not.toBeInTheDocument();
    });

    it('군화: 본인의 profile.military로 복무 진행률을 렌더링한다', () => {
      storeState = createSoldierState();

      render(
        <MemoryRouter>
          <ServiceProgressWidget />
        </MemoryRouter>,
      );

      expect(screen.queryByText('입대일과 전역일을 입력하면 진행률을 보여드려요.')).not.toBeInTheDocument();
      expect(screen.getByText(/일 \/ \d+일/)).toBeInTheDocument();
    });
  });

  describe('3. 복무 상세 페이지 (/service, ServicePage)', () => {
    it('연결된 활성 곰신: 읽기 전용으로 파트너 복무 현황을 확인하며, 수정 버튼/모달이 존재하지 않는다', () => {
      storeState = createGomsinState({
        connected: true,
        status: 'active',
        partnerMilitary: PARTNER_MILITARY,
      });

      render(
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>,
      );

      // AppBar 타이틀이 파트너 이름으로 표출됨
      expect(screen.getByText('민우의 복무 현황')).toBeInTheDocument();

      // 파트너의 입대일과 전역일 날짜가 렌더링됨
      expect(screen.getByText(/입대\s+2025년 9월 1일/)).toBeInTheDocument();
      expect(screen.getByText(/전역\s+2027년 2월 28일/)).toBeInTheDocument();

      // [보안/권한 격리] 곰신에게는 복무 정보 수정 버튼이 AppBar 및 본문에 일절 노출되지 않음
      expect(screen.queryByRole('button', { name: '복무 정보 수정' })).toBeNull();
      expect(screen.queryByRole('button', { name: '복무 정보 입력하기' })).toBeNull();
      expect(screen.queryByText('복무 정보 수정')).not.toBeInTheDocument();

      // [정직한 연락처 카드] 곰신 본인의 연락 설정을 군화의 연락 시간인 것처럼 속이지 않고 솔직한 안내 메시지 표시
      expect(screen.getByText('연락 가능 시간')).toBeInTheDocument();
      expect(screen.getByText('군화의 연락 가능 시간은 아직 연동되지 않아요.')).toBeInTheDocument();
      expect(screen.queryByText(/09:00 ~ 18:00/)).toBeNull();

      // 공유된 일정(휴가)은 곰신에게도 정상 노출됨
      expect(screen.getByText('첫 정기휴가')).toBeInTheDocument();
      expect(screen.getByText('2026년 9월 15일')).toBeInTheDocument();
    });

    it('연결 해제 / 미연결 곰신: 복무 정보가 없다는 안내만 표출되며, 복무 정보 입력 버튼은 노출되지 않는다', () => {
      storeState = createGomsinState({
        connected: false,
        status: 'disconnected',
        partnerMilitary: PARTNER_MILITARY,
      });

      render(
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>,
      );

      expect(screen.getByText('복무 정보가 아직 없어요')).toBeInTheDocument();
      expect(screen.getByText('군화가 복무 정보를 입력하면 남은 날짜와 복무율을 확인할 수 있어요.')).toBeInTheDocument();

      // 곰신은 자신의 계정에 군복무를 입력할 수 없음
      expect(screen.queryByRole('button', { name: '복무 정보 입력하기' })).toBeNull();
      expect(screen.queryByRole('button', { name: '복무 정보 수정' })).toBeNull();
    });

    it('군화: 본인의 복무 정보 수정이 온전히 보존되며 수정 모달을 통해 저장할 수 있다', async () => {
      storeState = createSoldierState();

      render(
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>,
      );

      // 군화 본인 타이틀
      expect(screen.getByText('민우의 복무 현황')).toBeInTheDocument();

      // 군화에게는 복무 정보 수정 버튼이 노출됨
      const editButton = screen.getByRole('button', { name: '복무 정보 수정' });
      expect(editButton).toBeInTheDocument();

      // 군화 본인의 연락 가능 시간이 정상 표시됨
      expect(screen.getByText(/평일 18:00 ~ 21:00/)).toBeInTheDocument();

      // 수정 버튼 클릭 시 모달이 열림
      fireEvent.click(editButton);
      expect(screen.getByRole('dialog', { name: '복무 정보 수정' })).toBeInTheDocument();

      // 저장하기 클릭 시 updateProfile 호출
      const saveButton = screen.getByRole('button', { name: '저장하기' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(updateProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            military: expect.objectContaining({
              branch: 'airforce',
              militaryStatus: 'serving',
              enlistmentDate: '2025-05-01',
              expectedDischargeDate: '2027-01-31',
            }),
          }),
        );
      });
    });

    it('복무 진행률을 보조 기술에 정확한 수치로 전달한다', () => {
      storeState = createSoldierState();

      render(
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>,
      );

      const progressbar = screen.getByRole('progressbar', { name: '민우 복무 진행률' });
      expect(progressbar).toHaveAttribute('aria-valuemin', '0');
      expect(progressbar).toHaveAttribute('aria-valuemax', '100');
      expect(progressbar).toHaveAttribute('aria-valuenow');
    });

    it('복무 수정으로 포커스를 옮기고 가둔 뒤 연 버튼으로 돌려보낸다', async () => {
      const user = userEvent.setup();
      storeState = createSoldierState();

      render(
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>,
      );

      const opener = screen.getByRole('button', { name: '복무 정보 수정' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog', { name: '복무 정보 수정' });
      expect(screen.getByRole('combobox', { name: '복무 상태' })).toHaveFocus();

      screen.getByRole('combobox', { name: '복무 상태' }).focus();
      await user.tab({ shift: true });
      expect(screen.getByRole('button', { name: '저장하기' })).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(dialog).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
