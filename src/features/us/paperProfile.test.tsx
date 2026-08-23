import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, Trip, CoupleEvent } from '@/types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let storeState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: storeState, isReady: true, coupleLifecycle: 'connected' }),
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

function makeRecord(over: Partial<DailyRecord> & { id: string; date: string }): DailyRecord {
  return {
    authorRole: 'gomsin',
    log: '기록 내용',
    time: '12:00',
    isPrivate: false,
    talkAbout: false,
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function baseState(): AppState {
  return {
    authenticatedUser: { id: 'user-me' },
    profile: {
      id: 'user-me',
      myName: '춘향',
      username: 'chunhyang',
      profileCaption: '오늘도 우리답게',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2026-01-01',
        coupleCode: 'ABC',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate: '2025-09-01',
        expectedDischargeDate: '2027-02-28',
        dischargeDateSource: 'manual',
      },
      contact: { enabled: true, weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '10:00', weekendEnd: '21:00' },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
  } as unknown as AppState;
}

describe('PaperProfile (우리 화면)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    storeState = baseState();
  });

  it('상단 영역(헤더, 커플 상태 배너, 통계, 소개)이 렌더된다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('춘향')).toHaveLength(2);
    expect(screen.getByText('@chunhyang')).toBeInTheDocument();
    expect(screen.getByText('오늘도 우리답게')).toBeInTheDocument();
    expect(screen.queryByText('춘향 ♥ 몽룡')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '내 프로필 사진 고르기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기록 남기기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기록 찾기' })).toBeInTheDocument();
  });

  it('기념일이 있으면 profileCaption이 없어도 기본 문구를 유지한다', () => {
    storeState = {
      ...baseState(),
      profile: { ...baseState().profile, profileCaption: undefined },
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText(/일째 같은 하늘 아래/)).toBeInTheDocument();
  });

  it('기념일이 없으면 기본 문구 대신 설정 상태를 정직하게 보여준다', () => {
    storeState = {
      ...baseState(),
      profile: {
        ...baseState().profile,
        username: undefined,
        profileCaption: undefined,
        couple: { ...baseState().profile.couple, anniversaryDate: undefined },
      },
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText('아이디 설정하기')).toBeInTheDocument();
    expect(screen.getByText('기념일 미설정')).toBeInTheDocument();
  });

  it('하이라이트 원본 열기와 별도 편집 버튼을 연결하고 버튼을 중첩하지 않는다', () => {
    const event: CoupleEvent = {
      id: 'visit-first',
      coupleId: 'couple-1',
      createdBy: 'user-me',
      title: '첫 면회',
      eventType: 'visit',
      startDate: '2026-02-01',
      isPrivate: false,
      createdAt: '2026-02-01T00:00:00Z',
    };
    storeState = { ...baseState(), events: [event] };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    const editButton = screen.getByRole('button', { name: '첫 면회 일정 원본 편집' });
    fireEvent.click(editButton);
    expect(mockNavigate).toHaveBeenCalledWith('/schedule');

    fireEvent.click(screen.getByRole('button', { name: '첫 면회 2026-02-01' }));
    expect(mockNavigate).toHaveBeenCalledWith('/story/day/2026-02-01');
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('button')).toBeNull();
    }
  });

  it('게시물 격자 탭은 여행 중인 사진 게시물만 노출하고 누르면 사진 상세를 연다', () => {
    const trip: Trip = {
      id: 'trip-jeju',
      coupleId: 'couple-1',
      createdBy: 'user-me',
      title: '제주 여행',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      status: 'planned',
      createdAt: '2026-08-01T00:00:00Z',
    };

    const normalRecord = makeRecord({ id: 'rec-normal', date: '2026-08-05', log: '평범한 하루' });
    const travelRecord = makeRecord({
      id: 'rec-travel',
      date: '2026-08-11',
      log: '제주도 바다 도착!',
      attachments: [{ type: 'photo', name: '제주도.jpg', url: 'https://example.test/jeju.jpg' }],
    });

    storeState = {
      ...baseState(),
      trips: [trip],
      records: [normalRecord, travelRecord],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    // 여행 중 사진 게시물만 격자에 존재해야 함
    expect(screen.getByTestId('post-tile-rec-travel')).toBeInTheDocument();
    expect(screen.queryByTestId('post-tile-rec-normal')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-tile-rec-travel')).toHaveAttribute('data-kind', 'photo');
    expect(screen.queryByText('평범한 하루')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('post-tile-rec-travel'));
    const viewer = screen.getByTestId('photo-post-viewer');
    expect(viewer).toBeInTheDocument();
    expect(viewer.querySelector('[data-testid="record-attachment"] img[alt="제주도.jpg"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '사진 게시물 닫기' }));
    expect(screen.queryByTestId('photo-post-viewer')).not.toBeInTheDocument();
  });

  it('여행 기록이 없으면 여행 안내 문구가 격자에 노출된다', () => {
    storeState = {
      ...baseState(),
      trips: [],
      records: [makeRecord({ id: 'rec-1', date: '2026-08-05', log: '일상 기록' })],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText(/아직 여행 사진이 없어요/)).toBeInTheDocument();
  });

  it('사진 탭을 누르면 모든 기존 기록을 읽을 수 있고 RecordPage로 이어지는 액션을 제공한다', () => {
    const record1 = makeRecord({ id: 'rec-1', date: '2026-08-01', log: '첫 번째 일상 이야기' });
    const record2 = makeRecord({ id: 'rec-2', date: '2026-08-02', log: '두 번째 이야기' });

    storeState = {
      ...baseState(),
      records: [record1, record2],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    // 사진(기록) 탭 클릭
    const photoTab = screen.getByRole('button', { name: '사진' });
    fireEvent.click(photoTab);

    // 기존 기록 목록이 렌더되고 내용을 읽을 수 있음
    expect(screen.getByTestId('profile-records-list')).toBeInTheDocument();
    expect(screen.getByText('첫 번째 일상 이야기')).toBeInTheDocument();
    expect(screen.getByText('두 번째 이야기')).toBeInTheDocument();

    // 타임라인 전체 보기 버튼 클릭 시 /record 로 이동
    const timelineBtn = screen.getByText('타임라인 전체 보기');
    fireEvent.click(timelineBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/record');

    // 특정 기록 자세히 보기 클릭 시 /record?record=... 로 이동
    const detailButtons = screen.getAllByText('기록 자세히 보기');
    fireEvent.click(detailButtons[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/record?record=rec-2');
  });

  it('여행 탭을 누르면 간단한 여행 목록과 상세 진입을 제공한다', () => {
    const trip: Trip = {
      id: 'trip-jeju',
      coupleId: 'couple-1',
      createdBy: 'user-me',
      title: '제주 여행',
      startDate: '2099-08-10',
      endDate: '2099-08-12',
      status: 'planned',
      createdAt: '2026-08-01T00:00:00Z',
    };
    storeState = { ...baseState(), trips: [trip] };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    const tripTab = screen.getByRole('button', { name: '여행' });
    fireEvent.click(tripTab);

    expect(screen.getByTestId('profile-trips-list')).toBeInTheDocument();
    expect(screen.getByText('제주 여행')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '제주 여행 열기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-jeju');

    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });
});
