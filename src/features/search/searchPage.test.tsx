import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, MilitaryInfo, CoupleEvent } from '@/types';
import { computeServiceProgress } from '@/lib/milestones';
import { computeServiceLevel } from '@/lib/serviceLevel';
import { localToday } from '@/lib/cycle';

let currentState: AppState;
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true }),
}));

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/CycleSupportSection', () => ({
  CycleSupportSection: ({ mine }: { mine: boolean }) => (
    <div data-testid={mine ? 'cycle-support-mine' : 'cycle-support-partner'}>
      {mine ? '오늘 내 컨디션' : '상대 배려 신호'}
    </div>
  ),
}));

vi.mock('@/components/CycleTrackerSection', () => ({
  CycleTrackerSection: () => <div data-testid="cycle-tracker-section">내 몸의 리듬</div>,
}));

const { SearchPage } = await import('./SearchPage');

const SERVING_MILITARY: MilitaryInfo = {
  branch: 'army',
  militaryStatus: 'serving',
  enlistmentDate: '2025-09-01',
  expectedDischargeDate: '2027-05-31',
  dischargeDateSource: 'manual',
};

function createRecord(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: 'user-me',
    date: '2026-08-20',
    time: '14:30',
    authorRole: 'soldier',
    log: '오늘 첫 외출 나와서 맛있는 거 먹었어',
    isPrivate: false,
    ...over,
  } as DailyRecord;
}

function stateWith({
  role = 'soldier',
  military = SERVING_MILITARY,
  records = [],
  events = [],
}: {
  role?: 'soldier' | 'gomsin';
  military?: MilitaryInfo;
  records?: DailyRecord[];
  events?: CoupleEvent[];
} = {}): AppState {
  return {
    records,
    events,
    trips: [],
    authenticatedUser: { id: 'user-me' },
    profile: {
      id: 'user-me',
      myName: '민우',
      role,
      couple: {
        coupleId: 'couple-1',
        partnerName: '지수',
        coupleCode: 'CP1234',
        connected: true,
        status: 'active',
      },
      military,
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '10:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
  } as unknown as AppState;
}

function renderSearch() {
  return render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentState = stateWith();
});

describe('군화(soldier) 기본 주 콘텐츠', () => {
  it('복무 정보가 있으면 상세 페이지로 들어가지 않아도 진행 정보가 렌더링된다', () => {
    currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
    renderSearch();

    const progress = computeServiceProgress(SERVING_MILITARY, localToday());
    const level = computeServiceLevel(progress);

    expect(screen.getByTestId('soldier-service-info')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 복무 현황 열기' })).not.toBeInTheDocument();
    expect(screen.getByText('내 복무')).toBeInTheDocument();
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(`복무율 ${progress!.percent}%`);
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(`${progress!.elapsedDays}일 경과`);
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(`${progress!.remainingDays}일 남음`);
    expect(screen.getByTestId('service-level')).toHaveTextContent(`복무 레벨 ${level!.level} · ${level!.label}`);
    expect(screen.getByTestId('service-level-guide')).toHaveTextContent(level!.nextLabel!);
    expect(screen.getByText(/평일 18:00–21:00/)).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-tracker-section')).not.toBeInTheDocument();
  });

  it('인라인 복무 정보의 수정 버튼은 /service 로 이동한다', () => {
    currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
    renderSearch();

    fireEvent.click(screen.getByRole('button', { name: '복무 정보 수정' }));
    expect(mockNavigate).toHaveBeenCalledWith('/service');
  });

  it('다음 휴가/면회 일정이 있으면 D-Day 와 일정이 표시된다', () => {
    const events: CoupleEvent[] = [
      {
        id: 'ev-1',
        coupleId: 'couple-1',
        title: '정기 휴가',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        eventType: 'vacation',
        createdBy: 'user-me',
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    ];
    currentState = stateWith({ role: 'soldier', events });
    renderSearch();

    expect(screen.getByTestId('soldier-next-leave')).toBeInTheDocument();
    expect(screen.getByText('다음 휴가')).toBeInTheDocument();
    expect(screen.getByText('정기 휴가')).toBeInTheDocument();
  });

  it('복무 정보가 없거나 unknown 이면 지어내지 않고 /service 연결 입력 상태를 보여준다', () => {
    currentState = stateWith({
      role: 'soldier',
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'manual' },
    });
    renderSearch();

    const editBtn = screen.getByRole('button', { name: '복무 정보 입력하기' });
    expect(editBtn).toBeInTheDocument();
    expect(screen.getByText('입대일과 예상 전역일을 입력하면 남은 복무일과 진척도를 확인할 수 있어요.')).toBeInTheDocument();

    fireEvent.click(editBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/service');
  });

  it('이미 전역한 군화는 복무 정보 입력 상태로 잘못 표시하지 않는다', () => {
    currentState = stateWith({
      role: 'soldier',
      military: {
        branch: 'army',
        militaryStatus: 'discharged',
        enlistmentDate: '2024-01-01',
        expectedDischargeDate: '2025-07-01',
        dischargeDateSource: 'manual',
      },
    });
    renderSearch();

    expect(screen.getByText('전역했어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '복무 정보 입력하기' })).not.toBeInTheDocument();
    expect(screen.getByTestId('service-level')).toHaveTextContent('복무 레벨 5 · 완주');
    expect(screen.getByTestId('service-level-guide')).toHaveTextContent('복무를 마쳤어요.');
  });
});

describe('곰신(gomsin) 기본 주 콘텐츠', () => {
  it('곰신에게는 오늘 내 상태 surface(CycleSupportSection + CycleTrackerSection)가 메인으로 렌더링되고 군화 카드는 뜨지 않는다', () => {
    currentState = stateWith({ role: 'gomsin' });
    renderSearch();

    expect(screen.getByTestId('gomsin-search-surface')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-support-mine')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-tracker-section')).toBeInTheDocument();
    expect(screen.queryByTestId('soldier-search-surface')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /복무 현황 열기/ })).not.toBeInTheDocument();
  });
});

describe('검색 입력 및 네비게이션', () => {
  it('상단 검색창과 기록 남기기 버튼이 상시 존재한다', () => {
    renderSearch();

    expect(screen.getByPlaceholderText('쓴 말이나 날짜로 찾기')).toBeInTheDocument();
    const composeBtn = screen.getByRole('button', { name: '기록 남기기' });
    expect(composeBtn).toBeInTheDocument();

    fireEvent.click(composeBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/compose');
  });

  it('검색어를 입력하면 검색 결과가 표시되고 주 콘텐츠(복무/주기)는 가려진다', () => {
    const records = [
      createRecord({ id: 'rec-1', log: '오늘 면회 와줘서 너무 고마웠어' }),
      createRecord({ id: 'rec-2', log: '점심 든든하게 먹었어' }),
    ];
    currentState = stateWith({ role: 'soldier', records });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '면회' } });

    expect(screen.getByText('1개 찾았어요')).toBeInTheDocument();
    expect(screen.getByText('면회')).toBeInTheDocument();
    expect(screen.queryByTestId('soldier-search-surface')).not.toBeInTheDocument();
  });

  it('검색 결과 항목을 클릭하면 정확한 ?record= id 로 이동한다', () => {
    const records = [
      createRecord({ id: 'rec-special-123', log: '첫 면회 날의 기억' }),
    ];
    currentState = stateWith({ role: 'soldier', records });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '면회' } });

    const item = screen.getByText('면회').closest('button');
    expect(item).not.toBeNull();
    fireEvent.click(item!);

    expect(mockNavigate).toHaveBeenCalledWith('/record?record=rec-special-123');
  });

  it('일치하는 결과가 없으면 0건 안내 메시지를 표시한다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ log: '산책' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '없는단어' } });

    expect(screen.getByText('그 말이 들어간 기록이 없어요')).toBeInTheDocument();
  });

  it('날짜 검색 시 0건이면 날짜용 메시지를 표시한다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ date: '2026-08-20' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '8/14' } });

    expect(screen.getByText('그날은 남긴 것이 없어요')).toBeInTheDocument();
  });

  it('지우기 버튼을 누르면 검색어가 비워지고 다시 역할별 기본 주 콘텐츠가 보인다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ log: '외출' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '외출' } });
    expect(screen.queryByTestId('soldier-search-surface')).not.toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: '지우기' });
    fireEvent.click(clearBtn);

    expect(screen.getByTestId('soldier-search-surface')).toBeInTheDocument();
  });
});

describe('개인정보 보호 필터', () => {
  it('상대방의 비공개(isPrivate: true) 기록은 검색되지 않는다', () => {
    const records = [
      createRecord({
        id: 'partner-private',
        userId: 'partner-user',
        authorRole: 'gomsin',
        log: '상대방의 나만 보기 일기 비밀',
        isPrivate: true,
      }),
      createRecord({
        id: 'partner-public',
        userId: 'partner-user',
        authorRole: 'gomsin',
        log: '상대방의 공개 일기 비밀',
        isPrivate: false,
      }),
    ];
    currentState = stateWith({ role: 'soldier', records });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '비밀' } });

    expect(screen.getByText('1개 찾았어요')).toBeInTheDocument();
    expect(screen.getByText(/상대방의 공개 일기/)).toBeInTheDocument();
    expect(screen.queryByText(/상대방의 나만 보기 일기/)).not.toBeInTheDocument();
  });
});
