import { describe, expect, it } from 'vitest';
import {
  computeEnergy,
  computeRankTimeline,
  computeServiceProgress,
  computeTodayCondition,
  daysTogether,
  getMemory,
  getNextAnniversary,
  getNextMeetup,
  getUpcomingEvents,
  resolveMemoOwnership,
  selectPartnerSharedToday,
  selectTodayTimeline,
  validateAnniversary,
  visibleRecords,
} from '@/lib/insights';
import { DEFAULT_STATE } from '@/lib/store';
import type { CoupleEvent, DailyRecord, MilitaryInfo, Role } from '@/types';

/**
 * 고정 기준일. 시간이 흘러도 결과가 변하지 않도록 모든 계산에 명시적으로 전달합니다.
 */
const TODAY = '2026-08-05';

function rec(over: Partial<DailyRecord> & { id: string }): DailyRecord {
  return {
    date: TODAY,
    time: '12:00',
    authorRole: 'gomsin',
    log: '',
    isPrivate: false,
    createdAt: `${over.date || TODAY}T12:00:00.000Z`,
    ...over,
  };
}

function evt(over: Partial<CoupleEvent> & { id: string }): CoupleEvent {
  return {
    coupleId: 'couple-1',
    createdBy: 'user-1',
    title: '일정',
    eventType: 'other',
    startDate: TODAY,
    isPrivate: false,
    createdAt: `${TODAY}T00:00:00.000Z`,
    ...over,
  };
}

const SERVING: MilitaryInfo = {
  branch: 'army',
  militaryStatus: 'serving',
  enlistmentDate: '2026-02-05',
  expectedDischargeDate: '2027-08-05',
  dischargeDateSource: 'calculated',
};

// =====================================================================
// 복무 진행률 / D-Day
// =====================================================================

describe('computeServiceProgress', () => {
  it('입대일과 전역일로 복무율·경과일·남은일을 계산한다', () => {
    const p = computeServiceProgress(SERVING, TODAY);
    expect(p.hasData).toBe(true);
    expect(p.phase).toBe('serving');
    expect(p.totalDays).toBe(546);
    expect(p.elapsedDays).toBe(181);
    expect(p.remainingDays).toBe(365);
    expect(p.percent).toBeCloseTo((181 / 546) * 100, 6);
    expect(p.headline).toBe('전역까지 D-365');
    expect(p.caption).toContain('복무 181일째');
  });

  it('전역일이 없으면 군종 복무기간으로 계산한다', () => {
    const p = computeServiceProgress(
      {
        branch: 'airforce', // 21개월
        militaryStatus: 'serving',
        enlistmentDate: '2026-02-05',
        dischargeDateSource: 'calculated',
      },
      TODAY,
    );
    expect(p.hasData).toBe(true);
    expect(p.dischargeDate).toBe('2027-11-05');
  });

  it('입대 전이면 입대 D-Day를 안내하고 복무율은 0이다', () => {
    const p = computeServiceProgress(
      { ...SERVING, militaryStatus: 'planned', enlistmentDate: '2026-09-04', expectedDischargeDate: '2028-03-04' },
      TODAY,
    );
    expect(p.phase).toBe('before');
    expect(p.headline).toBe('입대까지 D-30');
    expect(p.percent).toBe(0);
    expect(p.elapsedDays).toBe(0);
  });

  it('전역 이후에는 100%로 고정하고 남은 일수는 0이다', () => {
    const p = computeServiceProgress(
      { ...SERVING, militaryStatus: 'discharged' },
      TODAY,
    );
    expect(p.phase).toBe('discharged');
    expect(p.percent).toBe(100);
    expect(p.remainingDays).toBe(0);
  });

  it('전역일이 지났으면 상태가 serving이어도 100%로 처리한다', () => {
    const p = computeServiceProgress(
      { ...SERVING, enlistmentDate: '2024-01-01', expectedDischargeDate: '2025-07-01' },
      TODAY,
    );
    expect(p.percent).toBe(100);
    expect(p.remainingDays).toBe(0);
  });

  // 빈 상태: 예시 날짜를 만들어내지 않는다
  it('복무 정보가 없으면 hasData=false이고 날짜를 만들어내지 않는다', () => {
    const none = computeServiceProgress(undefined, TODAY);
    expect(none.hasData).toBe(false);
    expect(none.enlistmentDate).toBeUndefined();
    expect(none.dischargeDate).toBeUndefined();
    expect(none.percent).toBe(0);
    expect(none.totalDays).toBe(0);

    const unknown = computeServiceProgress(
      { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
      TODAY,
    );
    expect(unknown.hasData).toBe(false);
    expect(unknown.enlistmentDate).toBeUndefined();
  });

  it('군종이 기타(복무기간 0)이고 전역일도 없으면 계산하지 않는다', () => {
    const p = computeServiceProgress(
      { branch: 'other', militaryStatus: 'serving', enlistmentDate: '2026-02-05', dischargeDateSource: 'unknown' },
      TODAY,
    );
    expect(p.hasData).toBe(false);
  });
});

describe('computeRankTimeline', () => {
  it('표준 진급 소요기간(0·2·8·14개월)으로 진급 예정일을 만든다', () => {
    const t = computeRankTimeline(SERVING, TODAY);
    expect(t.hasData).toBe(true);
    expect(t.milestones.map((m) => [m.rank, m.date])).toEqual([
      ['이병', '2026-02-05'],
      ['일병', '2026-04-05'],
      ['상병', '2026-10-05'],
      ['병장', '2027-04-05'],
    ]);
    expect(t.currentRank).toBe('일병');
    expect(t.next?.rank).toBe('상병');
    expect(t.next?.dDay).toBe(61);
    expect(t.milestones.filter((m) => m.achieved)).toHaveLength(2);
  });

  it('사회복무요원·기타는 진급 개념이 없어 hasData=false', () => {
    for (const branch of ['social_service', 'other'] as const) {
      expect(
        computeRankTimeline({ ...SERVING, branch }, TODAY).hasData,
      ).toBe(false);
    }
  });

  it('입대일이 없으면 진급 타임라인을 만들지 않는다', () => {
    expect(
      computeRankTimeline({ ...SERVING, enlistmentDate: undefined }, TODAY),
    ).toEqual({ hasData: false, milestones: [] });
  });
});

// =====================================================================
// 기념일 선택
// =====================================================================

describe('getNextAnniversary', () => {
  it('100일 단위 기념일을 사귄 날짜 기준으로 계산한다', () => {
    // 2026-06-01 시작 → TODAY는 66일째 → 다음은 100일(= 시작일 + 99일)
    const a = getNextAnniversary('2026-06-01', [], TODAY);
    expect(a).toEqual({
      label: '100일',
      date: '2026-09-08',
      dDay: 34,
      kind: 'milestone',
    });
  });

  it('주년이 100일 단위보다 가까우면 주년을 선택한다', () => {
    const a = getNextAnniversary('2024-08-20', [], TODAY);
    expect(a?.kind).toBe('yearly');
    expect(a?.label).toBe('2주년');
    expect(a?.date).toBe('2026-08-20');
    expect(a?.dDay).toBe(15);
  });

  it('직접 등록한 기념일 일정이 가장 가까우면 그것을 선택한다', () => {
    const a = getNextAnniversary(
      '2026-06-01',
      [evt({ id: 'e1', title: '첫 데이트 기념일', eventType: 'anniversary', startDate: '2026-08-10' })],
      TODAY,
    );
    expect(a?.kind).toBe('event');
    expect(a?.label).toBe('첫 데이트 기념일');
    expect(a?.dDay).toBe(5);
  });

  it('기념일이 아닌 일정 종류는 후보로 쓰지 않는다', () => {
    const a = getNextAnniversary(
      '2026-06-01',
      [evt({ id: 'e1', title: '면회', eventType: 'visit', startDate: '2026-08-06' })],
      TODAY,
    );
    expect(a?.kind).toBe('milestone');
  });

  it('오늘이 기념일이면 dDay는 0이다', () => {
    // 100일째가 오늘이 되도록: 시작일 + 99일 = TODAY
    const a = getNextAnniversary('2026-04-28', [], TODAY);
    expect(a?.label).toBe('100일');
    expect(a?.dDay).toBe(0);
    expect(a?.date).toBe(TODAY);
  });

  // 빈 상태: 사귄 날짜가 없으면 예시 날짜를 만들지 않는다
  it('사귄 날짜가 없고 기념일 일정도 없으면 null', () => {
    expect(getNextAnniversary(undefined, [], TODAY)).toBeNull();
    expect(getNextAnniversary('', [], TODAY)).toBeNull();
  });

  it('사귄 날짜가 없어도 등록된 기념일 일정은 사용한다', () => {
    const a = getNextAnniversary(
      undefined,
      [evt({ id: 'e1', title: '기념일', eventType: 'anniversary', startDate: '2026-08-09' })],
      TODAY,
    );
    expect(a?.kind).toBe('event');
    expect(a?.dDay).toBe(4);
  });
});

describe('daysTogether / validateAnniversary', () => {
  it('사귄 날짜 당일은 1일째로 센다', () => {
    expect(daysTogether(TODAY, TODAY)).toBe(1);
    expect(daysTogether('2026-08-04', TODAY)).toBe(2);
  });

  it('미설정이면 null이며 임의 값으로 대체하지 않는다', () => {
    expect(daysTogether(undefined, TODAY)).toBeNull();
    expect(daysTogether('', TODAY)).toBeNull();
  });

  it('편집 저장 시 빈 값·형식 오류·미래 날짜를 거부한다', () => {
    expect(validateAnniversary('', TODAY)).toEqual({ ok: false, reason: 'empty' });
    expect(validateAnniversary('2026/08/01', TODAY)).toEqual({ ok: false, reason: 'malformed' });
    expect(validateAnniversary('2026-08-06', TODAY)).toEqual({ ok: false, reason: 'future' });
  });

  it('오늘까지의 날짜는 허용하고 값을 그대로 돌려준다', () => {
    expect(validateAnniversary(TODAY, TODAY)).toEqual({ ok: true, value: TODAY });
    expect(validateAnniversary('2020-01-01', TODAY)).toEqual({ ok: true, value: '2020-01-01' });
  });

  it('편집 후 함께한 날짜와 다음 기념일이 새 날짜로 재계산된다', () => {
    const before = validateAnniversary('2026-06-01', TODAY);
    expect(before.ok).toBe(true);
    expect(daysTogether('2026-06-01', TODAY)).toBe(66);
    expect(getNextAnniversary('2026-06-01', [], TODAY)?.label).toBe('100일');

    // 사용자가 날짜를 더 과거로 수정
    const after = validateAnniversary('2024-03-01', TODAY);
    expect(after.ok).toBe(true);
    expect(daysTogether('2024-03-01', TODAY)).toBe(888);
    const nextAfter = getNextAnniversary('2024-03-01', [], TODAY);
    expect(nextAfter?.label).toBe('900일');
    expect(nextAfter?.dDay).toBe(12);
  });
});

// =====================================================================
// 다가오는 휴가 / 면회 / 여행 선택
// =====================================================================

describe('getUpcomingEvents / getNextMeetup', () => {
  const events = [
    evt({ id: 'past', title: '지난 면회', eventType: 'visit', startDate: '2026-07-01' }),
    evt({ id: 'vac', title: '정기 휴가', eventType: 'vacation', startDate: '2026-08-20', endDate: '2026-08-24' }),
    evt({ id: 'visit', title: '주말 면회', eventType: 'visit', startDate: '2026-08-17' }),
    evt({ id: 'anniv', title: '기념일', eventType: 'anniversary', startDate: '2026-08-10' }),
    evt({ id: 'ongoing', title: '진행 중 여행', eventType: 'trip', startDate: '2026-08-03', endDate: '2026-08-07' }),
  ];

  it('지난 일정은 제외하고 시작일 순으로 정렬한다', () => {
    const upcoming = getUpcomingEvents(events, { todayStr: TODAY });
    expect(upcoming.map((u) => u.event.id)).toEqual(['ongoing', 'anniv', 'visit', 'vac']);
  });

  it('종료일이 오늘 이후면 진행 중으로 표시한다', () => {
    const [first] = getUpcomingEvents(events, { todayStr: TODAY });
    expect(first.event.id).toBe('ongoing');
    expect(first.ongoing).toBe(true);
    expect(first.dDay).toBe(-2);
  });

  it('종류 필터와 개수 제한이 적용된다', () => {
    const leaves = getUpcomingEvents(events, {
      types: ['visit', 'vacation'],
      todayStr: TODAY,
    });
    expect(leaves.map((u) => u.event.id)).toEqual(['visit', 'vac']);
    expect(getUpcomingEvents(events, { todayStr: TODAY, limit: 2 })).toHaveLength(2);
  });

  it('다음 만남은 면회·휴가·여행 중 가장 가까운 것이며 기념일은 제외한다', () => {
    const next = getNextMeetup(events, TODAY);
    expect(next?.event.id).toBe('ongoing');
    const withoutTrip = getNextMeetup(
      events.filter((e) => e.id !== 'ongoing'),
      TODAY,
    );
    expect(withoutTrip?.event.id).toBe('visit');
    expect(withoutTrip?.dDay).toBe(12);
  });

  // 빈 상태
  it('일정이 없으면 빈 배열과 null을 반환한다', () => {
    expect(getUpcomingEvents([], { todayStr: TODAY })).toEqual([]);
    expect(getNextMeetup([], TODAY)).toBeNull();
    expect(getNextMeetup([events[0]], TODAY)).toBeNull(); // 지난 일정만 있는 경우
  });
});

// =====================================================================
// 기록 가시성 (프라이버시 경계)
// =====================================================================

describe('기록 가시성', () => {
  const records = [
    rec({ id: 'mine-public', authorRole: 'gomsin', isPrivate: false, time: '09:00' }),
    rec({ id: 'mine-private', authorRole: 'gomsin', isPrivate: true, time: '10:00' }),
    rec({ id: 'partner-public', authorRole: 'soldier', isPrivate: false, time: '11:00' }),
    rec({ id: 'partner-private', authorRole: 'soldier', isPrivate: true, time: '12:00' }),
    rec({ id: 'yesterday-partner', authorRole: 'soldier', isPrivate: false, date: '2026-08-04' }),
  ];

  it('곰신 시점: 내 비공개는 보이고 상대 비공개는 보이지 않는다', () => {
    const ids = visibleRecords(records, 'gomsin').map((r) => r.id);
    expect(ids).toContain('mine-private');
    expect(ids).not.toContain('partner-private');
  });

  it('군화 시점: 내 비공개는 보이고 상대 비공개는 보이지 않는다', () => {
    const ids = visibleRecords(records, 'soldier').map((r) => r.id);
    expect(ids).toContain('partner-private');
    expect(ids).not.toContain('mine-private');
  });

  it('오늘 타임라인은 당일 + 내 기록 + 상대 공유 기록만 포함한다', () => {
    const ids = selectTodayTimeline(records, 'gomsin', TODAY).map((r) => r.id);
    expect(ids).toEqual(['mine-public', 'mine-private', 'partner-public']);
    expect(ids).not.toContain('partner-private');
    expect(ids).not.toContain('yesterday-partner');
  });

  it('오늘 타임라인은 시간순으로 정렬된다', () => {
    const times = selectTodayTimeline(records, 'gomsin', TODAY).map((r) => r.time);
    expect(times).toEqual([...times].sort());
  });

  it('상대 공유 기록 선택자는 내 기록과 상대 비공개를 모두 제외한다', () => {
    const forSoldier = selectPartnerSharedToday(records, 'soldier', TODAY).map((r) => r.id);
    expect(forSoldier).toEqual(['mine-public']);

    const forGomsin = selectPartnerSharedToday(records, 'gomsin', TODAY).map((r) => r.id);
    expect(forGomsin).toEqual(['partner-public']);
  });

  it('군화가 남긴 비공개 기록은 곰신의 브리핑 입력에 절대 들어가지 않는다', () => {
    const onlyPartnerPrivate = [
      rec({ id: 'p1', authorRole: 'soldier', isPrivate: true }),
    ];
    expect(selectPartnerSharedToday(onlyPartnerPrivate, 'gomsin', TODAY)).toEqual([]);
    expect(computeEnergy(selectPartnerSharedToday(onlyPartnerPrivate, 'gomsin', TODAY)).hasData).toBe(
      false,
    );
  });
});

// =====================================================================
// 오늘의 컨디션 / 에너지 — 사용한 기록 수와 표시 개수가 일치해야 한다
// =====================================================================

describe('computeTodayCondition', () => {
  it('내가 오늘 남긴 기록만 세고 표시 개수가 사용한 기록 수와 같다', () => {
    const records = [
      rec({ id: 'a', authorRole: 'gomsin', time: '09:00' }),
      rec({ id: 'b', authorRole: 'gomsin', time: '10:00', isPrivate: true }),
      rec({ id: 'c', authorRole: 'soldier', time: '11:00' }), // 상대 기록 → 제외
      rec({ id: 'd', authorRole: 'gomsin', date: '2026-08-04' }), // 어제 → 제외
    ];
    const c = computeTodayCondition(records, 'gomsin', TODAY);
    expect(c.hasData).toBe(true);
    expect(c.recordCount).toBe(2);
    expect(c.detail).toBe('오늘 2개의 순간을 남겼어요');
    expect(c.lastRecordId).toBe('b');
  });

  it('리액션 우선순위: 힘들었어가 가장 먼저 반영된다', () => {
    const c = computeTodayCondition(
      [
        rec({ id: 'a', reaction: 'good' }),
        rec({ id: 'b', reaction: 'hard' }),
      ],
      'gomsin',
      TODAY,
    );
    expect(c.label).toBe('조금 힘든 날');
    expect(c.emoji).toBe('🥹');
  });

  it('확정한 감정 흐름만 상세 문구로 사용한다', () => {
    const c = computeTodayCondition(
      [
        rec({
          id: 'a',
          emotionFlow: [
            { sequence: 1, group: 'joy', displayLabel: '기쁨', source: 'user_confirmed' },
            { sequence: 2, group: 'fatigue', displayLabel: '피로', source: 'rule_suggested' },
          ],
        }),
      ],
      'gomsin',
      TODAY,
    );
    expect(c.emotionLabels).toEqual(['기쁨']);
    expect(c.detail).toBe('기쁨');
  });

  it('오늘 기록이 없으면 hasData=false이고 개수는 0이다', () => {
    const c = computeTodayCondition([], 'gomsin', TODAY);
    expect(c.hasData).toBe(false);
    expect(c.recordCount).toBe(0);
    expect(c.emotionLabels).toEqual([]);
  });
});

describe('computeEnergy', () => {
  it('공유 기록이 없으면 hasData=false, level=0 (임의값 없음)', () => {
    expect(computeEnergy([])).toEqual({
      level: 0,
      label: '아직 공유된 기록이 없어요',
      hasData: false,
    });
  });

  it('기록 수에 따라 단조 증가하고 100을 넘지 않는다', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => rec({ id: `r${i}` }));
    expect(computeEnergy(mk(1)).level).toBe(40);
    expect(computeEnergy(mk(2)).level).toBe(55);
    expect(computeEnergy(mk(10)).level).toBe(100);
  });

  it('힘들었어 리액션은 에너지를 낮추고 최소 25를 유지한다', () => {
    const hard = computeEnergy([rec({ id: 'a', reaction: 'hard' })]);
    expect(hard.level).toBe(25);
    expect(hard.label).toContain('힘든');
  });
});

// =====================================================================
// 추억 다시보기
// =====================================================================

describe('getMemory', () => {
  it('N년 전 오늘 기록을 우선 찾는다', () => {
    const m = getMemory(
      [
        rec({ id: 'old', date: '2025-08-05', log: '작년 오늘' }),
        rec({ id: 'older', date: '2024-08-05', log: '재작년 오늘' }),
        rec({ id: 'today', date: TODAY }),
      ],
      'gomsin',
      TODAY,
    );
    expect(m?.label).toBe('1년 전 오늘');
    expect(m?.record.id).toBe('old');
  });

  it('사진이 있는 기록을 우선 고르고 photoUrl을 노출한다', () => {
    const m = getMemory(
      [
        rec({ id: 'text', date: '2025-08-05', log: '글만' }),
        rec({
          id: 'photo',
          date: '2025-08-05',
          attachments: [{ type: 'photo', name: 'p.jpg', url: 'https://example.test/p.jpg' }],
        }),
      ],
      'gomsin',
      TODAY,
    );
    expect(m?.record.id).toBe('photo');
    expect(m?.photoUrl).toBe('https://example.test/p.jpg');
    expect(m?.totalCount).toBe(2);
  });

  it('N년 전 기록이 없으면 한 달 전 오늘로 대체한다', () => {
    const m = getMemory([rec({ id: 'mo', date: '2026-07-05' })], 'gomsin', TODAY);
    expect(m?.label).toBe('한 달 전 오늘');
  });

  it('상대의 비공개 기록은 추억으로 노출하지 않는다', () => {
    const m = getMemory(
      [rec({ id: 'secret', date: '2025-08-05', authorRole: 'soldier', isPrivate: true })],
      'gomsin',
      TODAY,
    );
    expect(m).toBeNull();
  });

  it('내 비공개 기록은 내 추억으로 볼 수 있다', () => {
    const m = getMemory(
      [rec({ id: 'mine', date: '2025-08-05', authorRole: 'gomsin', isPrivate: true })],
      'gomsin',
      TODAY,
    );
    expect(m?.record.id).toBe('mine');
  });

  it('과거 기록이 없으면 null (오늘 기록만 있는 경우 포함)', () => {
    expect(getMemory([], 'gomsin', TODAY)).toBeNull();
    expect(getMemory([rec({ id: 'today', date: TODAY })], 'gomsin', TODAY)).toBeNull();
  });
});

// =====================================================================
// 나만의 메모: 기기 저장 + 사용자별 격리
// =====================================================================

describe('resolveMemoOwnership', () => {
  it('같은 사용자면 메모를 유지한다', () => {
    expect(
      resolveMemoOwnership({ myMemo: '면회 준비물', myMemoOwnerId: 'user-a' }, 'user-a'),
    ).toEqual({ myMemo: '면회 준비물', myMemoOwnerId: 'user-a' });
  });

  it('다른 계정이 같은 기기에 로그인하면 이전 메모를 비운다', () => {
    expect(
      resolveMemoOwnership({ myMemo: '비밀 메모', myMemoOwnerId: 'user-a' }, 'user-b'),
    ).toEqual({ myMemo: '', myMemoOwnerId: 'user-b' });
  });

  it('로그아웃(소유자 없음) 시 로그인 사용자의 메모를 남기지 않는다', () => {
    expect(
      resolveMemoOwnership({ myMemo: '비밀 메모', myMemoOwnerId: 'user-a' }, null),
    ).toEqual({ myMemo: '', myMemoOwnerId: null });
  });

  it('데모(소유자 없음) 메모는 실계정 로그인 시 넘어가지 않는다', () => {
    expect(
      resolveMemoOwnership({ myMemo: '데모 메모', myMemoOwnerId: null }, 'user-a'),
    ).toEqual({ myMemo: '', myMemoOwnerId: 'user-a' });
  });

  it('로그아웃 상태에서 작성한 메모는 로그아웃 상태에서 유지된다', () => {
    expect(resolveMemoOwnership({ myMemo: '로컬 메모', myMemoOwnerId: null }, null)).toEqual({
      myMemo: '로컬 메모',
      myMemoOwnerId: null,
    });
  });

  it('소유자 정보가 없는 과거 상태는 안전하게 비운다', () => {
    expect(resolveMemoOwnership({ myMemo: '이전 버전 메모' }, 'user-a')).toEqual({
      myMemo: '',
      myMemoOwnerId: 'user-a',
    });
  });
});

// =====================================================================
// 예시(가짜) 날짜 회귀 방지
// =====================================================================

describe('기본 상태에 예시 날짜가 없다', () => {
  it('신규 사용자 기본 상태에는 기념일·입대일·전역일이 비어 있다', () => {
    expect(DEFAULT_STATE.profile.couple.anniversaryDate).toBeUndefined();
    expect(DEFAULT_STATE.profile.military.enlistmentDate).toBeUndefined();
    expect(DEFAULT_STATE.profile.military.expectedDischargeDate).toBeUndefined();
    expect(DEFAULT_STATE.profile.military.dischargeDate).toBeUndefined();
    expect(DEFAULT_STATE.profile.military.militaryStatus).toBe('unknown');
    expect(DEFAULT_STATE.profile.military.dischargeDateSource).toBe('unknown');
  });

  it('기본 상태의 메모는 비어 있고 소유자가 없다', () => {
    expect(DEFAULT_STATE.myMemo).toBe('');
    expect(DEFAULT_STATE.myMemoOwnerId).toBeNull();
  });

  it('기본 상태로는 어떤 D-Day도 계산되지 않는다', () => {
    expect(computeServiceProgress(DEFAULT_STATE.profile.military, TODAY).hasData).toBe(false);
    expect(
      getNextAnniversary(DEFAULT_STATE.profile.couple.anniversaryDate, DEFAULT_STATE.events, TODAY),
    ).toBeNull();
    expect(daysTogether(DEFAULT_STATE.profile.couple.anniversaryDate, TODAY)).toBeNull();
  });
});

describe('역할별 계산이 대칭적으로 동작한다', () => {
  const roles: Role[] = ['gomsin', 'soldier'];
  it('두 역할 모두 자기 기록만 컨디션에 사용한다', () => {
    const records = [
      rec({ id: 'g', authorRole: 'gomsin' }),
      rec({ id: 's', authorRole: 'soldier' }),
    ];
    for (const role of roles) {
      const c = computeTodayCondition(records, role, TODAY);
      expect(c.recordCount).toBe(1);
      expect(c.lastRecordId).toBe(role === 'gomsin' ? 'g' : 's');
    }
  });
});
