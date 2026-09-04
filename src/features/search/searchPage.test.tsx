import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, MilitaryInfo, CoupleEvent } from '@/types';
import { computeServiceProgress } from '@/lib/milestones';

let currentState: AppState;
const mockNavigate = vi.fn();
const { mockLocalToday } = vi.hoisted(() => ({
  mockLocalToday: vi.fn(() => '2026-08-27'),
}));

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

vi.mock('@/lib/cycle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cycle')>('@/lib/cycle');
  return { ...actual, localToday: mockLocalToday };
});

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
  relationshipContext = 'military',
  military = SERVING_MILITARY,
  partnerMilitary,
  records = [],
  events = [],
}: {
  role?: 'soldier' | 'gomsin';
  relationshipContext?: 'military' | 'general';
  military?: MilitaryInfo;
  partnerMilitary?: MilitaryInfo;
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
        relationshipContext,
        ...(partnerMilitary ? { partnerMilitary } : {}),
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
  mockLocalToday.mockReturnValue('2026-08-27');
  currentState = stateWith();
});

describe('군화(soldier) 기본 주 콘텐츠', () => {
  it('복무 정보가 있으면 압박 장치 없이 날짜 기반 진행 정보 하나를 보여준다', () => {
    currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
    renderSearch();

    const progress = computeServiceProgress(SERVING_MILITARY, '2026-08-27');

    expect(screen.getByTestId('soldier-service-info')).toBeInTheDocument();
    expect(screen.getByTestId('soldier-service-info')).toHaveClass('ink-box');
    expect(screen.getByTestId('soldier-service-info')).not.toHaveClass('bg-card');
    expect(screen.queryByRole('button', { name: '내 복무 현황 열기' })).not.toBeInTheDocument();
    expect(screen.getByText('내 복무')).toBeInTheDocument();
    const summary = screen.getByTestId('service-progress-summary');
    expect(summary).toHaveTextContent(`복무율 ${progress!.percent}%`);
    expect(summary).toHaveTextContent(`${progress!.elapsedDays}일 경과`);
    expect(summary).toHaveTextContent(`${progress!.remainingDays}일 남음`);
    expect(summary.textContent?.match(/복무율 ([\d.]+)%/)?.[1].split('.')[1]?.length ?? 0)
      .toBeLessThanOrEqual(1);

    const progressbar = screen.getByRole('progressbar', { name: '개인 복무 진행률' });
    expect(progressbar).toHaveAttribute('aria-valuenow', String(progress!.percent));
    expect(progressbar).toHaveAttribute('aria-valuetext', `복무율 ${progress!.percent}%`);
    expect(progressbar.firstElementChild)
      .toHaveClass('motion-safe:transition-[width]');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByTestId('service-level')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-exp-readout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-today-exp')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '전체 단계' })).not.toBeInTheDocument();
    expect(screen.queryByText(/EXP|Lv\./)).not.toBeInTheDocument();
    expect(screen.getByText(/평일 18:00–21:00/)).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-tracker-section')).not.toBeInTheDocument();
  });

  it('입대 전에는 전역까지가 아니라 입대까지의 실제 D-day를 보여준다', () => {
    const plannedMilitary: MilitaryInfo = {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2099-01-01',
      expectedDischargeDate: '2100-07-01',
      dischargeDateSource: 'manual',
    };
    currentState = stateWith({ role: 'soldier', military: plannedMilitary });
    renderSearch();

    const progress = computeServiceProgress(plannedMilitary, '2026-08-27');
    expect(progress?.isBeforeEnlistment).toBe(true);
    expect(progress?.daysUntilEnlistment).toBeGreaterThan(0);
    expect(screen.getByText(`입대 D-${progress!.daysUntilEnlistment}`)).toBeInTheDocument();
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(
      `입대까지 ${progress!.daysUntilEnlistment}일`,
    );
    expect(screen.getByTestId('service-status')).toHaveTextContent('입대 예정');
  });

  it('저장된 예정 상태가 늦게 남아 있어도 입대일이 지났으면 날짜와 같은 복무 중 상태를 보여준다', () => {
    currentState = stateWith({
      role: 'soldier',
      military: {
        ...SERVING_MILITARY,
        militaryStatus: 'planned',
      },
    });
    renderSearch();

    expect(screen.getByTestId('service-status')).toHaveTextContent('복무 중');
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent('일 경과');
    expect(screen.queryByText('입대 예정')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('service-status')).toHaveTextContent('전역했어요');
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent('복무율 100%');
    expect(screen.getByRole('progressbar', { name: '개인 복무 진행률' }))
      .toHaveAttribute('aria-valuenow', '100');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
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

  it('곰신은 활성 군인 파트너의 사실 기반 복무 카드를 읽기 전용으로 본다', () => {
    currentState = stateWith({ role: 'gomsin', partnerMilitary: SERVING_MILITARY });
    renderSearch();

    expect(screen.getByText('지수의 복무')).toBeInTheDocument();
    expect(screen.getByTestId('soldier-service-info')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '개인 복무 진행률' })).toBeInTheDocument();
    expect(screen.queryByText(/EXP|Lv\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '복무 정보 수정' })).not.toBeInTheDocument();
  });

  it('상대 복무 표시도 페이지가 만든 같은 오늘 값을 사용한다', () => {
    currentState = stateWith({ role: 'gomsin', partnerMilitary: SERVING_MILITARY });
    renderSearch();

    expect(mockLocalToday).toHaveBeenCalledTimes(1);
  });

  it('파트너 복무 projection이 없으면 날짜나 D-day를 지어내지 않는다', () => {
    currentState = stateWith({ role: 'gomsin' });
    renderSearch();

    expect(screen.queryByTestId('soldier-service-info')).not.toBeInTheDocument();
    expect(screen.queryByText(/의 복무/)).not.toBeInTheDocument();
    expect(screen.getByTestId('cycle-tracker-section')).toBeInTheDocument();
  });

  it('연결이 해제되었거나 미연결 상태면 잔존 partnerMilitary가 있어도 상대 복무 카드를 렌더링하지 않는다', () => {
    const base = stateWith({ role: 'gomsin', partnerMilitary: SERVING_MILITARY });
    currentState = {
      ...base,
      profile: {
        ...base.profile,
        couple: {
          ...base.profile.couple,
          connected: false,
          status: 'disconnected',
          partnerMilitary: SERVING_MILITARY,
        },
      },
    } as unknown as AppState;
    renderSearch();

    expect(screen.queryByTestId('soldier-service-info')).not.toBeInTheDocument();
    expect(screen.queryByText(/의 복무/)).not.toBeInTheDocument();
    expect(screen.getByTestId('cycle-tracker-section')).toBeInTheDocument();
  });

  it('connected가 true여도 status가 pending(또는 비활성)이면 잔존 partnerMilitary가 있어도 상대 복무 카드를 렌더링하지 않는다', () => {
    const base = stateWith({ role: 'gomsin', partnerMilitary: SERVING_MILITARY });
    currentState = {
      ...base,
      profile: {
        ...base.profile,
        couple: {
          ...base.profile.couple,
          connected: true,
          status: 'pending',
          partnerMilitary: SERVING_MILITARY,
        },
      },
    } as unknown as AppState;
    renderSearch();

    expect(screen.queryByTestId('soldier-service-info')).not.toBeInTheDocument();
    expect(screen.queryByText(/의 복무/)).not.toBeInTheDocument();
    expect(screen.getByTestId('cycle-tracker-section')).toBeInTheDocument();
  });
});

describe('일반 커플 기본 주 콘텐츠', () => {
  it('internal soldier 슬롯이어도 복무 UI를 숨기고 역할과 무관한 내 기록·컨디션 도구를 유지한다', () => {
    currentState = stateWith({
      role: 'soldier',
      relationshipContext: 'general',
      partnerMilitary: SERVING_MILITARY,
    });
    renderSearch();

    expect(screen.getByTestId('general-search-surface')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-support-mine')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-support-partner')).toBeInTheDocument();
    expect(screen.getByTestId('cycle-tracker-section')).toBeInTheDocument();
    expect(screen.queryByTestId('soldier-search-surface')).toBeNull();
    expect(screen.queryByTestId('soldier-service-info')).toBeNull();
    expect(screen.queryByText(/복무|입대|전역/)).toBeNull();
  });
});

describe('검색 입력 및 네비게이션', () => {
  it('페이지 제목과 기록 진입점을 같은 상단 landmark에서 제공한다', () => {
    renderSearch();

    const pageHeading = screen.getByRole('heading', { name: '찾기', level: 1 });
    const pageHeader = pageHeading.closest('header');
    const composeButton = screen.getByRole('button', { name: '기록 남기기' });

    expect(pageHeader).not.toBeNull();
    expect(pageHeader).toContainElement(composeButton);
  });

  it('상단 검색창과 기록 남기기 버튼이 상시 존재한다', () => {
    renderSearch();

    const searchRegion = screen.getByRole('search', { name: '기록 찾기' });
    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    expect(searchRegion).toContainElement(input);
    expect(input).toHaveAttribute('aria-describedby', 'record-search-help');
    expect(input).toHaveAttribute('aria-controls', 'record-search-results');
    expect(document.getElementById('record-search-help')).toHaveTextContent(/^기기 안에서만 검색해요$/);
    expect(document.getElementById('record-search-results')).toBeInTheDocument();
    expect(screen.getByTestId('record-search-field')).toHaveStyle({ background: 'var(--paper)' });
    const composeBtn = screen.getByRole('button', { name: '기록 남기기' });
    expect(composeBtn).toBeInTheDocument();
    expect(composeBtn).toHaveClass('press-response', 'h-11', 'w-11');

    fireEvent.click(composeBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/compose');
  });

  it('검색창은 앱의 이름 있는 지우기 버튼만 사용한다', () => {
    renderSearch();

    const input = screen.getByRole('searchbox', { name: '쓴 말이나 날짜로 찾기' });
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.change(input, { target: { value: '면회' } });
    expect(screen.getAllByRole('button', { name: '검색어 지우기' })).toHaveLength(1);
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

    expect(screen.getByRole('status')).toHaveTextContent('1개 찾았어요');
    expect(screen.getByText('면회')).toBeInTheDocument();
    expect(screen.queryByTestId('soldier-search-surface')).not.toBeInTheDocument();
  });

  it('검색 결과 목록을 접근 가능한 이름으로 구분한다', () => {
    const longLog = `면회 ${'아주긴기록문장'.repeat(24)}`;
    currentState = stateWith({
      role: 'soldier',
      records: [createRecord({ id: 'long-record', log: longLog })],
    });
    renderSearch();

    fireEvent.change(screen.getByPlaceholderText('쓴 말이나 날짜로 찾기'), {
      target: { value: '면회' },
    });

    const results = screen.getByRole('list', { name: '검색 결과' });
    expect(results).toHaveTextContent('면회');
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
    expect(item).toHaveClass('press-response-row');
    fireEvent.click(item!);

    expect(mockNavigate).toHaveBeenCalledWith('/record?record=rec-special-123');
  });

  it('일치하는 결과가 없으면 0건 안내 메시지를 표시한다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ log: '산책' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '없는단어' } });

    expect(screen.getByRole('status')).toHaveTextContent('그 말이 들어간 기록이 없어요');
  });

  it('날짜 검색 시 0건이면 날짜용 메시지를 표시한다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ date: '2026-08-20' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '8/14' } });

    expect(screen.getByRole('status')).toHaveTextContent('그날은 남긴 것이 없어요');
  });

  it('지우기 버튼을 누르면 검색어가 비워지고 다시 역할별 기본 주 콘텐츠가 보인다', () => {
    currentState = stateWith({ role: 'soldier', records: [createRecord({ log: '외출' })] });
    renderSearch();

    const input = screen.getByPlaceholderText('쓴 말이나 날짜로 찾기');
    fireEvent.change(input, { target: { value: '외출' } });
    expect(screen.queryByTestId('soldier-search-surface')).not.toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: '검색어 지우기' });
    expect(clearBtn).toHaveClass('press-response', 'h-11', 'w-11');
    fireEvent.click(clearBtn);

    expect(screen.getByTestId('soldier-search-surface')).toBeInTheDocument();
    expect(input).toHaveFocus();
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

describe('복무 진행의 다군 지원', () => {
  it('해군·공군·해병대 등 branch에도 군 명칭과 날짜 기반 진행률을 표시한다', () => {
    const navyMilitary: MilitaryInfo = {
      branch: 'navy',
      militaryStatus: 'serving',
      enlistmentDate: '2025-01-01',
      expectedDischargeDate: '2026-09-01',
      dischargeDateSource: 'manual',
    };
    currentState = stateWith({ role: 'soldier', military: navyMilitary });
    renderSearch();

    expect(screen.getByText(/해군/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '개인 복무 진행률' })).toBeInTheDocument();
    expect(screen.queryByText(/EXP|Lv\./)).not.toBeInTheDocument();
  });
});
