import type {
  Branch,
  CoupleEvent,
  DailyRecord,
  EventType,
  MilitaryInfo,
  Role,
} from '@/types';
import {
  BRANCH_SERVICE_MONTHS,
  addDays,
  addMonths,
  daysBetweenLocal,
  localToday,
  parseLocalDate,
  toLocalDateString,
} from '@/lib/utils';

/**
 * insights.ts
 *
 * 홈 위젯 / 복무 현황 화면이 사용하는 "계산" 로직을 한곳에 모았습니다.
 * 모든 함수는 실제 저장된 상태(profile, records, events)만 입력으로 받으며
 * 예시값이나 임의의 상수를 반환하지 않습니다. 데이터가 없으면 null 또는
 * hasData: false 를 반환해서 화면이 빈 상태(입력 유도)를 보여줄 수 있게 합니다.
 */

export const BRANCH_LABELS: Record<Branch, string> = {
  army: '육군',
  navy: '해군',
  airforce: '공군',
  marine: '해병대',
  reserve: '상근예비역',
  social_service: '사회복무요원',
  other: '기타',
};

export function today(): string {
  return toLocalDateString(localToday());
}

// ==========================================
// 복무 진행률
// ==========================================

export type ServicePhase = 'unknown' | 'before' | 'serving' | 'discharged';

export interface ServiceProgress {
  hasData: boolean;
  phase: ServicePhase;
  enlistmentDate?: string;
  dischargeDate?: string;
  /** 입대일 ~ 전역일 총 일수 */
  totalDays: number;
  /** 오늘까지 복무한 일수 (0 이상) */
  elapsedDays: number;
  /** 전역까지 남은 일수 (0 이상) */
  remainingDays: number;
  /** 복무율 0~100 */
  percent: number;
  /** 카드에 그대로 출력할 수 있는 요약 문구 */
  headline: string;
  caption: string;
}

const EMPTY_SERVICE_PROGRESS: ServiceProgress = {
  hasData: false,
  phase: 'unknown',
  totalDays: 0,
  elapsedDays: 0,
  remainingDays: 0,
  percent: 0,
  headline: '복무 정보 미설정',
  caption: '입대일을 입력하면 복무율이 계산돼요',
};

export function computeServiceProgress(
  military?: MilitaryInfo,
  todayStr: string = today(),
): ServiceProgress {
  if (!military) return EMPTY_SERVICE_PROGRESS;

  const enlistmentDate = military.enlistmentDate;
  const dischargeDate =
    military.dischargeDate ||
    military.expectedDischargeDate ||
    (enlistmentDate && military.branch && BRANCH_SERVICE_MONTHS[military.branch]
      ? addMonths(enlistmentDate, BRANCH_SERVICE_MONTHS[military.branch])
      : undefined);

  if (!enlistmentDate || !dischargeDate) return EMPTY_SERVICE_PROGRESS;

  const totalDays = daysBetweenLocal(enlistmentDate, dischargeDate);
  if (totalDays <= 0) return EMPTY_SERVICE_PROGRESS;

  const rawElapsed = daysBetweenLocal(enlistmentDate, todayStr);
  const elapsedDays = Math.min(Math.max(rawElapsed, 0), totalDays);
  const remainingDays = Math.max(daysBetweenLocal(todayStr, dischargeDate), 0);
  const percent = Math.min(Math.max((elapsedDays / totalDays) * 100, 0), 100);

  if (military.militaryStatus === 'discharged' || remainingDays === 0) {
    return {
      hasData: true,
      phase: 'discharged',
      enlistmentDate,
      dischargeDate,
      totalDays,
      elapsedDays: totalDays,
      remainingDays: 0,
      percent: 100,
      headline: '전역 완료 🎉',
      caption: `${dischargeDate} 전역`,
    };
  }

  if (rawElapsed < 0) {
    const daysToEnlist = daysBetweenLocal(todayStr, enlistmentDate);
    return {
      hasData: true,
      phase: 'before',
      enlistmentDate,
      dischargeDate,
      totalDays,
      elapsedDays: 0,
      remainingDays,
      percent: 0,
      headline: `입대까지 D-${daysToEnlist}`,
      caption: `${enlistmentDate} 입대 예정`,
    };
  }

  return {
    hasData: true,
    phase: 'serving',
    enlistmentDate,
    dischargeDate,
    totalDays,
    elapsedDays,
    remainingDays,
    percent,
    headline: `전역까지 D-${remainingDays}`,
    caption: `복무 ${elapsedDays}일째 · ${percent.toFixed(1)}% 진행`,
  };
}

// ==========================================
// 진급 예정일 (표준 진급 소요기간 기준)
// ==========================================

/**
 * 병 진급 소요기간(누적 개월): 이병 0, 일병 2, 상병 8, 병장 14.
 * 부대 사정에 따라 실제 진급일은 달라질 수 있어 "예상"으로만 사용합니다.
 */
const RANK_STEPS: { rank: string; monthsFromEnlistment: number }[] = [
  { rank: '이병', monthsFromEnlistment: 0 },
  { rank: '일병', monthsFromEnlistment: 2 },
  { rank: '상병', monthsFromEnlistment: 8 },
  { rank: '병장', monthsFromEnlistment: 14 },
];

const RANKLESS_BRANCHES: Branch[] = ['social_service', 'other'];

export interface RankMilestone {
  rank: string;
  date: string;
  achieved: boolean;
  dDay: number;
}

export interface RankTimeline {
  hasData: boolean;
  milestones: RankMilestone[];
  currentRank?: string;
  next?: RankMilestone;
}

export function computeRankTimeline(
  military?: MilitaryInfo,
  todayStr: string = today(),
): RankTimeline {
  const enlistmentDate = military?.enlistmentDate;
  if (!enlistmentDate || !military || RANKLESS_BRANCHES.includes(military.branch)) {
    return { hasData: false, milestones: [] };
  }

  const milestones: RankMilestone[] = RANK_STEPS.map((step) => {
    const date = step.monthsFromEnlistment === 0
      ? enlistmentDate
      : addMonths(enlistmentDate, step.monthsFromEnlistment);
    return {
      rank: step.rank,
      date,
      achieved: daysBetweenLocal(date, todayStr) >= 0,
      dDay: daysBetweenLocal(todayStr, date),
    };
  });

  const achieved = milestones.filter((m) => m.achieved);
  return {
    hasData: true,
    milestones,
    currentRank: achieved.length > 0 ? achieved[achieved.length - 1].rank : undefined,
    next: milestones.find((m) => !m.achieved),
  };
}

// ==========================================
// 일정 (기념일 / 휴가 · 면회)
// ==========================================

export interface UpcomingEvent {
  event: CoupleEvent;
  dDay: number;
  ongoing: boolean;
}

/**
 * 오늘 이후(진행 중 포함) 일정을 가까운 순서로 반환합니다.
 */
export function getUpcomingEvents(
  events: CoupleEvent[],
  options: { types?: EventType[]; limit?: number; todayStr?: string } = {},
): UpcomingEvent[] {
  const todayStr = options.todayStr || today();
  const filtered = events
    .filter((e) => !options.types || options.types.includes(e.eventType))
    .filter((e) => (e.endDate || e.startDate) >= todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((event) => ({
      event,
      dDay: daysBetweenLocal(todayStr, event.startDate),
      ongoing: event.startDate <= todayStr && (event.endDate || event.startDate) >= todayStr,
    }));

  return typeof options.limit === 'number' ? filtered.slice(0, options.limit) : filtered;
}

/** 다음 만남(면회 · 휴가 · 여행) */
export function getNextMeetup(
  events: CoupleEvent[],
  todayStr: string = today(),
): UpcomingEvent | null {
  const [next] = getUpcomingEvents(events, {
    types: ['visit', 'vacation', 'trip'],
    limit: 1,
    todayStr,
  });
  return next || null;
}

export interface AnniversaryInfo {
  label: string;
  date: string;
  dDay: number;
  /** 100일 단위 기념일인지, 주년인지, 직접 등록한 일정인지 */
  kind: 'milestone' | 'yearly' | 'event';
}

/**
 * 사귄 날짜 기준 100일 단위 기념일 / 주년 / 직접 등록한 기념일 일정 중
 * 가장 먼저 다가오는 것을 반환합니다.
 */
export function getNextAnniversary(
  anniversaryDate: string | undefined,
  events: CoupleEvent[] = [],
  todayStr: string = today(),
): AnniversaryInfo | null {
  const candidates: AnniversaryInfo[] = [];

  if (anniversaryDate) {
    const daysConnected = daysBetweenLocal(anniversaryDate, todayStr) + 1;

    if (daysConnected > 0) {
      // 100일 단위: 연결 N일째가 되는 날 = 사귄 날짜 + (N - 1)일
      // 오늘이 정확히 100일째면 오늘을 D-Day로 보여준다 (지나치지 않음).
      const nextMilestone = Math.ceil(daysConnected / 100) * 100;
      candidates.push({
        label: `${nextMilestone}일`,
        date: addDays(anniversaryDate, nextMilestone - 1),
        dDay: nextMilestone - daysConnected,
        kind: 'milestone',
      });

      // 주년
      const start = parseLocalDate(anniversaryDate);
      const todayDate = parseLocalDate(todayStr);
      let years = todayDate.getFullYear() - start.getFullYear();
      let yearlyDate = addMonths(anniversaryDate, years * 12);
      if (daysBetweenLocal(todayStr, yearlyDate) <= 0) {
        years += 1;
        yearlyDate = addMonths(anniversaryDate, years * 12);
      }
      if (years > 0) {
        candidates.push({
          label: `${years}주년`,
          date: yearlyDate,
          dDay: daysBetweenLocal(todayStr, yearlyDate),
          kind: 'yearly',
        });
      }
    }
  }

  const [nextEvent] = getUpcomingEvents(events, {
    types: ['anniversary'],
    limit: 1,
    todayStr,
  });
  if (nextEvent) {
    candidates.push({
      label: nextEvent.event.title,
      date: nextEvent.event.startDate,
      dDay: nextEvent.dDay,
      kind: 'event',
    });
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0];
}

// ==========================================
// 기록 기반 인사이트
// ==========================================

/** 내가 볼 수 있는 기록(내 기록 + 상대의 공유 기록)만 남깁니다. */
export function visibleRecords(records: DailyRecord[], role: Role): DailyRecord[] {
  return records.filter((r) => r.authorRole === role || !r.isPrivate);
}

function chronological(records: DailyRecord[]): DailyRecord[] {
  return [...records].sort(
    (a, b) =>
      new Date(`${a.date}T${a.time || '00:00'}`).getTime() -
      new Date(`${b.date}T${b.time || '00:00'}`).getTime(),
  );
}

export interface MemoryResult {
  label: string;
  record: DailyRecord;
  photoUrl?: string;
  totalCount: number;
}

/**
 * "추억 다시보기": 과거의 오늘(N년 전 / 한 달 전) 기록을 찾고,
 * 없으면 최근이 아닌 과거 기록 중 하나를 보여줍니다.
 */
export function getMemory(
  records: DailyRecord[],
  role: Role,
  todayStr: string = today(),
): MemoryResult | null {
  const past = visibleRecords(records, role).filter((r) => r.date < todayStr);
  if (past.length === 0) return null;

  const [, month, day] = todayStr.split('-');
  const todayYear = Number(todayStr.split('-')[0]);

  const pick = (candidates: DailyRecord[], label: string): MemoryResult | null => {
    if (candidates.length === 0) return null;
    const withPhoto = candidates.find((r) =>
      r.attachments?.some((a) => a.type === 'photo' && a.url),
    );
    const record = withPhoto || chronological(candidates)[0];
    return {
      label,
      record,
      photoUrl: record.attachments?.find((a) => a.type === 'photo' && a.url)?.url,
      totalCount: candidates.length,
    };
  };

  // 1. N년 전 오늘
  for (let yearsAgo = 1; yearsAgo <= 10; yearsAgo += 1) {
    const target = `${todayYear - yearsAgo}-${month}-${day}`;
    const found = pick(
      past.filter((r) => r.date === target),
      `${yearsAgo}년 전 오늘`,
    );
    if (found) return found;
  }

  // 2. 한 달 전 오늘
  const monthAgo = addMonths(todayStr, -1);
  const monthAgoResult = pick(
    past.filter((r) => r.date === monthAgo),
    '한 달 전 오늘',
  );
  if (monthAgoResult) return monthAgoResult;

  // 3. 일주일 이상 지난 기록 중 가장 최근 날짜
  const weekAgo = addDays(todayStr, -7);
  const older = past.filter((r) => r.date <= weekAgo);
  const pool = older.length > 0 ? older : past;
  const latestDate = pool.reduce((acc, r) => (r.date > acc ? r.date : acc), pool[0].date);
  const daysAgo = daysBetweenLocal(latestDate, todayStr);
  return pick(
    pool.filter((r) => r.date === latestDate),
    daysAgo >= 365 ? `${Math.floor(daysAgo / 365)}년 전` : `${daysAgo}일 전`,
  );
}

export interface ConditionResult {
  hasData: boolean;
  emoji: string;
  label: string;
  detail: string;
  recordCount: number;
  emotionLabels: string[];
  lastRecordId?: string;
}

/**
 * 오늘 내가 남긴 기록에서 컨디션을 요약합니다. (리액션 + 확정한 감정 흐름 기반)
 */
export function computeTodayCondition(
  records: DailyRecord[],
  role: Role,
  todayStr: string = today(),
): ConditionResult {
  const mine = chronological(
    records.filter((r) => r.date === todayStr && r.authorRole === role),
  );

  const emotionLabels = mine
    .flatMap((r) => r.emotionFlow || [])
    .filter((f) => f.source === 'user_confirmed')
    .map((f) => f.displayLabel);

  if (mine.length === 0) {
    return {
      hasData: false,
      emoji: '➕',
      label: '아직 기록 없음',
      detail: '오늘의 컨디션을 남겨보세요',
      recordCount: 0,
      emotionLabels: [],
    };
  }

  const last = mine[mine.length - 1];
  const reactions = new Set(mine.map((r) => r.reaction).filter(Boolean));

  let emoji = '✍️';
  let label = '기록 중';
  if (reactions.has('hard')) {
    emoji = '🥹';
    label = '조금 힘든 날';
  } else if (reactions.has('good')) {
    emoji = '😊';
    label = '기분 좋은 날';
  } else if (reactions.has('thought_of_you')) {
    emoji = '💌';
    label = '보고 싶은 날';
  } else if (reactions.has('event')) {
    emoji = '💬';
    label = '이야기가 많은 날';
  }

  const detail = emotionLabels.length > 0
    ? emotionLabels.slice(0, 3).join(' → ')
    : `오늘 ${mine.length}개의 순간을 남겼어요`;

  return {
    hasData: true,
    emoji,
    label,
    detail,
    recordCount: mine.length,
    emotionLabels,
    lastRecordId: last.id,
  };
}

export interface EnergyResult {
  /** 0~100 */
  level: number;
  label: string;
  hasData: boolean;
}

/**
 * 상대가 오늘 공유한 기록의 양과 리액션으로 에너지를 추정합니다.
 * (임의 상수가 아니라 공유된 기록 수 · 리액션에서만 도출)
 */
export function computeEnergy(sharedRecords: DailyRecord[]): EnergyResult {
  if (sharedRecords.length === 0) {
    return { level: 0, label: '아직 공유된 기록이 없어요', hasData: false };
  }

  const hasHard = sharedRecords.some((r) => r.reaction === 'hard');
  const hasGood = sharedRecords.some(
    (r) => r.reaction === 'good' || r.reaction === 'thought_of_you',
  );

  // 기본: 기록 수 기반(1개 40% ~ 4개 이상 100%)
  let level = Math.min(100, 25 + sharedRecords.length * 15);
  if (hasHard) level = Math.max(25, level - 30);
  if (hasGood) level = Math.min(100, level + 10);

  const label = hasHard
    ? '조금 힘든 일이 있었어요 🥹'
    : hasGood
    ? '기분 좋은 상태예요 😊'
    : '평온하게 하루를 보내고 있어요 ✨';

  return { level, label, hasData: true };
}


// ==========================================
// 화면에서 쓰는 기록 선택자 (프라이버시 경계 포함)
// ==========================================

/**
 * "오늘 타임라인"에 보여줄 기록.
 * 내 기록 전부 + 상대의 공유 기록만. 상대의 비공개 기록은 절대 포함하지 않는다.
 */
export function selectTodayTimeline(
  records: DailyRecord[],
  role: Role,
  todayStr: string = today(),
): DailyRecord[] {
  return chronological(
    records.filter(
      (r) => r.date === todayStr && (r.authorRole === role || !r.isPrivate),
    ),
  );
}

/**
 * 상대가 오늘 공유한 기록만. (브리핑 · 에너지 · 요약의 유일한 입력)
 * 내 기록과 상대의 비공개 기록은 제외한다.
 */
export function selectPartnerSharedToday(
  records: DailyRecord[],
  role: Role,
  todayStr: string = today(),
): DailyRecord[] {
  return chronological(
    records.filter(
      (r) => r.date === todayStr && r.authorRole !== role && !r.isPrivate,
    ),
  );
}

// ==========================================
// 나만의 메모: 사용자별 격리
// ==========================================

export interface MemoOwnership {
  myMemo: string;
  myMemoOwnerId: string | null;
}

/**
 * 메모는 기기 localStorage에만 저장되므로, 같은 기기를 다른 계정이 쓰면
 * 이전 사용자의 메모가 보일 수 있습니다. 소유자가 바뀌면 메모를 비웁니다.
 *
 * - 소유자가 같으면 유지
 * - 소유자가 다르면(로그아웃→다른 계정, 데모→실계정 포함) 비움
 */
export function resolveMemoOwnership(
  prev: { myMemo?: string; myMemoOwnerId?: string | null },
  currentUserId: string | null,
): MemoOwnership {
  const prevOwner = prev.myMemoOwnerId ?? null;
  if (prevOwner === currentUserId) {
    return { myMemo: prev.myMemo || '', myMemoOwnerId: currentUserId };
  }
  return { myMemo: '', myMemoOwnerId: currentUserId };
}

// ==========================================
// 사귄 날짜(기념일) 편집 검증 · 재계산
// ==========================================

export type AnniversaryRejection = 'empty' | 'malformed' | 'future';

export function validateAnniversary(
  dateStr: string,
  todayStr: string = today(),
): { ok: true; value: string } | { ok: false; reason: AnniversaryRejection } {
  if (!dateStr) return { ok: false, reason: 'empty' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, reason: 'malformed' };
  if (dateStr > todayStr) return { ok: false, reason: 'future' };
  return { ok: true, value: dateStr };
}

/**
 * 사귄 날짜 기준 "함께한 지 N일째". 미설정이면 null (예시 날짜를 만들지 않는다).
 */
export function daysTogether(
  anniversaryDate: string | undefined,
  todayStr: string = today(),
): number | null {
  if (!anniversaryDate) return null;
  return daysBetweenLocal(anniversaryDate, todayStr) + 1;
}
