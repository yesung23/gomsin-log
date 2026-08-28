import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, MilitaryInfo, CoupleEvent } from '@/types';
import { computeServiceExp, formatExpNumber, formatExpPercent, serviceDateAtMs } from '@/lib/serviceLevel';

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
  partnerMilitary,
  records = [],
  events = [],
}: {
  role?: 'soldier' | 'gomsin';
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
  currentState = stateWith();
});

describe('군화(soldier) 기본 주 콘텐츠', () => {
  it('복무 정보가 있으면 상세 페이지로 들어가지 않아도 진행 정보가 렌더링된다', () => {
    currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
    renderSearch();

    const exp = computeServiceExp(SERVING_MILITARY);

    expect(screen.getByTestId('soldier-service-info')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '내 복무 현황 열기' })).not.toBeInTheDocument();
    expect(screen.getByText('내 복무')).toBeInTheDocument();
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(
      new RegExp(`복무율 \\d+\\.\\d{4}%`),
    );
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(`${exp!.elapsedDays}일 경과`);
    expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(`${exp!.remainingDays}일 남음`);
    expect(screen.getByTestId('service-level')).toHaveTextContent(
      exp!.isPreEnlistment ? '입대 대기' : `${exp!.levelBadge} ${exp!.tier.label}`,
    );
    expect(screen.getByTestId('service-level-guide')).toHaveTextContent(`다음 Lv.${exp!.level + 1}까지`);
    const tierToggle = screen.getByRole('button', { name: '전체 단계' });
    expect(tierToggle).toHaveAttribute('aria-expanded', 'false');
    expect(tierToggle).toHaveAttribute('aria-controls', 'service-tier-rail');
    expect(tierToggle).toHaveClass('min-h-11');
    expect(document.getElementById('service-tier-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('service-tier-rail')).not.toBeInTheDocument();
    fireEvent.click(tierToggle);
    expect(tierToggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('service-tier-rail')).toBeInTheDocument();
    expect(screen.getByTestId('service-tier-rail')).toBeInTheDocument();
    expect(screen.getByTestId('service-tier-step-1')).toHaveTextContent('신병');
    expect(screen.getByTestId('service-tier-step-2')).toHaveTextContent('일초');
    expect(screen.getByTestId('service-tier-step-3')).toHaveTextContent('일꺾');
    expect(screen.getByTestId('service-tier-step-4')).toHaveTextContent('일말');
    expect(screen.getByTestId('service-tier-step-5')).toHaveTextContent('상초');
    expect(screen.getByTestId('service-tier-step-6')).toHaveTextContent('상꺾');
    expect(screen.getByTestId('service-tier-step-7')).toHaveTextContent('왕고');
    fireEvent.click(screen.getByRole('button', { name: '단계 접기' }));
    expect(document.getElementById('service-tier-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('service-tier-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('service-exp-readout')).toBeInTheDocument();
    expect(screen.getByTestId('service-today-exp')).toBeInTheDocument();
    expect(screen.getByText(/평일 18:00–21:00/)).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-tracker-section')).not.toBeInTheDocument();
  });

  it('입대 전에는 전역까지가 아니라 입대까지의 실제 D-day를 보여준다', () => {
    const nowMs = Date.parse('2026-08-27T03:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const plannedMilitary: MilitaryInfo = {
      branch: 'army',
      militaryStatus: 'serving',
      enlistmentDate: '2099-01-01',
      expectedDischargeDate: '2100-07-01',
      dischargeDateSource: 'manual',
    };
    currentState = stateWith({ role: 'soldier', military: plannedMilitary });
    const view = renderSearch();

    try {
      const exp = computeServiceExp(plannedMilitary, nowMs);
      expect(exp?.isBeforeEnlistment).toBe(true);
      expect(exp?.daysUntilEnlistment).toBeGreaterThan(0);
      expect(screen.getByText(`입대 D-${exp!.daysUntilEnlistment}`)).toBeInTheDocument();
      expect(screen.getByTestId('service-progress-summary')).toHaveTextContent(
        `입대까지 ${exp!.daysUntilEnlistment}일`,
      );
      expect(screen.getByTestId('service-level-guide')).toHaveTextContent(
        `입대까지 ${exp!.daysUntilEnlistment}일`,
      );
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
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
    expect(screen.getByTestId('service-level')).toHaveTextContent('MAX 왕고');
    expect(screen.getByTestId('service-level-guide')).toHaveTextContent('복무를 마쳤어요.');
  });

  it('복무 레벨 7단계(신병·일초·일꺾·일말·상초·상꺾·왕고) 레일에서 현재 단계와 이전 단계를 구분한다', () => {
    // 2025-09-01 입대, 2027-05-31 전역 (총 637일)
    // today가 2026-08-24 기준 약 357일 경과 (56% -> 상병)
    currentState = stateWith({
      role: 'soldier',
      military: {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate: '2025-09-01',
        expectedDischargeDate: '2027-05-31',
        dischargeDateSource: 'manual',
      },
    });
    renderSearch();

    const exp = computeServiceExp(currentState.profile.military);
    expect(screen.getByTestId('service-level')).toHaveTextContent(`${exp!.levelBadge} ${exp!.tier.label}`);
    expect(document.getElementById('service-tier-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('service-tier-rail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '전체 단계' }));
    expect(document.getElementById('service-tier-rail')).toBeInTheDocument();
    expect(screen.getByTestId('service-tier-rail')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '현재 복무 레벨 경험치 진행률' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '개인 복무 진행률' })).toHaveAttribute('aria-valuenow');

    const step4 = screen.getByTestId('service-tier-step-4');
    expect(step4).toHaveTextContent('일말');
    expect(screen.getByTestId('service-tier-description')).toHaveTextContent('실제 행정 진급·관계 점수가 아니에요');
  });

  it('일꺾 전환은 번개 연출 상태를 내보낸다', () => {
    vi.useFakeTimers();
    try {
      const enlistmentDate = '2025-01-01';
      const expectedDischargeDate = '2026-07-02';
      const military: MilitaryInfo = {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate,
        expectedDischargeDate,
        dischargeDateSource: 'calculated',
      };
      const startMs = serviceDateAtMs(enlistmentDate)!;
      const totalMs = 547 * 86400 * 1000;
      currentState = stateWith({ role: 'soldier', military });
      vi.setSystemTime(startMs + totalMs * 0.24);
      renderSearch();

      vi.setSystemTime(startMs + totalMs * 0.25);
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('service-feedback')).toHaveTextContent('일꺾 달성');
      expect(screen.getByTestId('service-feedback')).toHaveAttribute('data-tier-effect', 'bent');
    } finally {
      vi.useRealTimers();
    }
  });

  it('전역한 군화는 계급 경험치 프로그레스바를 별도로 노출하지 않고 전역 완료 상태를 제공한다', () => {
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

    expect(screen.getByTestId('service-level')).toHaveTextContent('MAX 왕고');
    expect(screen.queryByRole('progressbar', { name: '현재 복무 레벨 경험치 진행률' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('service-today-exp')).not.toBeInTheDocument();
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

  it('곰신은 활성 군인 파트너의 복무를 같은 레벨별 EXP 카드로 보되 수정할 수 없다', () => {
    currentState = stateWith({ role: 'gomsin', partnerMilitary: SERVING_MILITARY });
    renderSearch();

    expect(screen.getByText('지수의 복무')).toBeInTheDocument();
    expect(screen.getByTestId('soldier-service-info')).toBeInTheDocument();
    expect(screen.getByTestId('service-exp-readout')).toHaveTextContent('EXP');
    expect(screen.queryByRole('button', { name: '복무 정보 수정' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: '전체 단계' });
    expect(toggle).toHaveClass('min-h-11');
    fireEvent.click(toggle);
    expect(screen.getByTestId('service-tier-step-7')).toHaveTextContent('왕고');
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

describe('복무 EXP 실시간 및 다군 지원', () => {
  it('화면을 보고 있는 동안 실제 시간 1초마다 EXP가 1씩 오른다', () => {
    vi.useFakeTimers();
    try {
      const startMs = serviceDateAtMs(SERVING_MILITARY.enlistmentDate!)!;
      vi.setSystemTime(startMs + 12_345_000);
      currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
      renderSearch();

      const readout = screen.getByTestId('service-exp-readout');
      expect(readout).toHaveTextContent(formatExpNumber(12_345));

      act(() => vi.advanceTimersByTime(1000));
      expect(readout).toHaveTextContent(formatExpNumber(12_346));
    } finally {
      vi.useRealTimers();
    }
  });

  it('해군·공군·해병대 등 다군 branch에 대해 각 군 명칭과 레벨/경험치를 정상 렌더링한다', () => {
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
    expect(screen.getByTestId('service-exp-readout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '전체 단계' }));
    expect(screen.getByTestId('service-tier-step-7')).toHaveTextContent('왕고');
  });

  it('실시간 EXP 영역에 정수 EXP 카운터와 소수점 4자리 퍼센트가 표기된다', () => {
    currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
    renderSearch();

    const readout = screen.getByTestId('service-exp-readout');
    expect(readout).toBeInTheDocument();
    // EXP formatted with / and %
    expect(readout).toHaveTextContent(/EXP/);
    expect(readout).toHaveTextContent(/%/);
  });

  it('누적 전체 EXP 대신 현재 복무 레벨 안에서 채운 EXP를 표시한다', () => {
    vi.useFakeTimers();
    try {
      const startMs = serviceDateAtMs(SERVING_MILITARY.enlistmentDate!)!;
      const totalSec = computeServiceExp(SERVING_MILITARY, startMs)!.totalSec;
      const sampleMs = startMs + totalSec * 0.2 * 1000;
      vi.setSystemTime(sampleMs);
      currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
      renderSearch();

      const exp = computeServiceExp(SERVING_MILITARY, sampleMs)!;
      const readout = screen.getByTestId('service-exp-readout');
      expect(readout).toHaveTextContent(new RegExp(
        `${formatExpNumber(exp.intoLevelSec)}\\s*/\\s*${formatExpNumber(exp.secPerLevel)} EXP`,
      ));
      expect(readout).toHaveTextContent(formatExpPercent(exp.levelExpPercent, 4));
      expect(screen.getByTestId('service-progress-summary')).toHaveTextContent('복무율 20.0000%');
    } finally {
      vi.useRealTimers();
    }
  });

  it('레벨업 경계에서 분자·분모와 경험치 바가 새 숫자 레벨(Lv.N+1) 기준으로 리셋된다', () => {
    vi.useFakeTimers();
    try {
      const startMs = serviceDateAtMs(SERVING_MILITARY.enlistmentDate!)!;
      const initialExp = computeServiceExp(SERVING_MILITARY, startMs)!;
      const secPerLevel = initialExp.secPerLevel;

      // 레벨 1 완료 1초 직전
      vi.setSystemTime(startMs + (secPerLevel - 0.5) * 1000);
      currentState = stateWith({ role: 'soldier', military: SERVING_MILITARY });
      renderSearch();

      expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.1');
      expect(screen.getByTestId('service-level-guide')).toHaveTextContent('다음 Lv.2까지');

      // 1초 뒤 Lv.2 달성 -> 경험치 바 및 분자 리셋
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('service-level')).toHaveTextContent('Lv.2');
      expect(screen.getByTestId('service-level-guide')).toHaveTextContent('다음 Lv.3까지');
      const newExp = computeServiceExp(SERVING_MILITARY, startMs + (secPerLevel + 0.5) * 1000)!;
      const readout = screen.getByTestId('service-exp-readout');
      expect(readout).toHaveTextContent(new RegExp(`${formatExpNumber(newExp.intoLevelSec)}\\s*/\\s*${formatExpNumber(newExp.secPerLevel)} EXP`));
      expect(readout).toHaveTextContent(formatExpPercent(newExp.levelExpPercent, 4));
    } finally {
      vi.useRealTimers();
    }
  });

  it('화면이 숨겨지면 EXP ticker를 멈추고 다시 보이면 즉시 재개한다', () => {
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    try {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      const view = renderSearch();
      expect(setIntervalSpy).toHaveBeenCalled();

      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(clearIntervalSpy).toHaveBeenCalled();

      const intervalsBeforeResume = setIntervalSpy.mock.calls.length;
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(intervalsBeforeResume);

      view.unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
      vi.restoreAllMocks();
    }
  });
});
