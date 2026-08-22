import { describe, it, expect } from 'vitest';
import { buildHighlights } from '@/lib/coupleHighlights';
import type { CoupleEvent, MilitaryInfo } from '@/types';

const TODAY = '2026-08-22';

function event(over: Partial<CoupleEvent> = {}): CoupleEvent {
  return {
    id: 'e1', coupleId: 'c1', title: '면회', eventType: 'visit',
    startDate: '2026-01-10', createdAt: '', ...over,
  } as CoupleEvent;
}

const MILITARY = {
  militaryStatus: 'serving', enlistmentDate: '2025-06-01',
  expectedDischargeDate: '2026-12-01', dischargeDateSource: 'user',
} as MilitaryInfo;

describe('도착한 마일스톤', () => {
  it('사귄 날이 1일이므로 100일은 99일 뒤다', () => {
    const list = buildHighlights({ anniversaryDate: '2025-01-01', events: [], todayStr: TODAY });
    const hundred = list.find((h) => h.label === '100일');
    expect(hundred?.date).toBe('2025-04-10');
    expect(hundred?.reached).toBe(true);
  });

  it('아직 오지 않은 것은 도착으로 세지 않는다', () => {
    const list = buildHighlights({ anniversaryDate: '2026-08-01', events: [], todayStr: TODAY });
    expect(list.filter((h) => h.reached)).toHaveLength(0);
  });

  it('기념일을 정하지 않았으면 날짜 마일스톤이 없다', () => {
    // 지어내지 않는다. DDayWidget 이 지어낸 기념일을 지운 것과 같은 규칙이다.
    expect(buildHighlights({ events: [], todayStr: TODAY })).toEqual([]);
  });

  it('시간순으로 온다', () => {
    const list = buildHighlights({ anniversaryDate: '2023-01-01', events: [], todayStr: TODAY });
    const reached = list.filter((h) => h.reached).map((h) => h.date);
    expect([...reached].sort()).toEqual(reached);
  });
});

describe('첫 것만 담는다', () => {
  it('면회를 여러 번 가도 하이라이트는 하나다', () => {
    /*
      스무 번 갔으면 하이라이트가 스무 개가 되고 목록이 일정 사본이 된다.
      처음이 기억이고 나머지는 일정이다.
    */
    const list = buildHighlights({
      anniversaryDate: '2025-01-01',
      events: [
        event({ id: 'a', startDate: '2026-03-01' }),
        event({ id: 'b', startDate: '2026-05-01' }),
        event({ id: 'c', startDate: '2026-01-10' }),
      ],
      todayStr: TODAY,
    });
    const visits = list.filter((h) => h.label === '첫 면회');
    expect(visits).toHaveLength(1);
    expect(visits[0].date).toBe('2026-01-10');
  });

  it('종류마다 첫 것이 따로 있다', () => {
    const list = buildHighlights({
      events: [event({ eventType: 'visit' }), event({ id: 'v', eventType: 'vacation', startDate: '2026-02-01' })],
      todayStr: TODAY,
    });
    expect(list.map((h) => h.label)).toEqual(expect.arrayContaining(['첫 면회', '첫 휴가']));
  });

  it('기억이 되지 않는 일정은 담지 않는다', () => {
    // 범용 캘린더의 모든 항목이 기억이 되지는 않는다.
    const list = buildHighlights({
      events: [event({ eventType: 'other', startDate: '2026-01-01' }), event({ eventType: 'anniversary', startDate: '2026-02-01' })],
      todayStr: TODAY,
    });
    expect(list).toEqual([]);
  });

  it('아직 오지 않은 일정은 담지 않는다', () => {
    expect(buildHighlights({ events: [event({ startDate: '2026-12-25' })], todayStr: TODAY })).toEqual([]);
  });
});

describe('아직 오지 않은 것 하나', () => {
  it('전역이 있으면 전역이 맨 뒤에 흐리게 온다', () => {
    /*
      인스타 하이라이트는 과거만 담는다. 이 앱은 기다림이 제품이라 아직 오지 않은 것을
      맨 뒤에 놓는다 -- 형태를 가져오되 의미를 뒤집는 자리다.
    */
    const list = buildHighlights({
      anniversaryDate: '2025-01-01', events: [], military: MILITARY, todayStr: TODAY,
    });
    const last = list.at(-1);
    expect(last).toMatchObject({ label: '전역', reached: false });
    expect(last?.countdown).toMatch(/^D-\d+$/);
  });

  it('전역이 없으면 다음 날짜 마일스톤이 온다', () => {
    const list = buildHighlights({ anniversaryDate: '2025-01-01', events: [], todayStr: TODAY });
    const last = list.at(-1);
    expect(last?.reached).toBe(false);
    expect(last?.countdown).toBeTruthy();
  });

  it('전역한 뒤에는 전역이 오지 않는다', () => {
    const discharged = { ...MILITARY, militaryStatus: 'discharged' } as MilitaryInfo;
    const list = buildHighlights({
      anniversaryDate: '2025-01-01', events: [], military: discharged, todayStr: TODAY,
    });
    expect(list.some((h) => h.label === '전역')).toBe(false);
  });

  it('미래는 하나뿐이다', () => {
    // 앞으로 올 모든 것을 늘어놓으면 목록이 계획표가 된다. 이 화면은 축적을 다룬다.
    const list = buildHighlights({
      anniversaryDate: '2025-01-01', events: [], military: MILITARY, todayStr: TODAY,
    });
    expect(list.filter((h) => !h.reached)).toHaveLength(1);
  });
});

describe('관계 점수를 만들지 않는다', () => {
  it('개수나 순위를 라벨에 넣지 않는다', () => {
    const list = buildHighlights({
      anniversaryDate: '2023-01-01', events: [event()], military: MILITARY, todayStr: TODAY,
    });
    for (const h of list) expect(h.label).not.toMatch(/위|등급|점|랭킹|최고/);
  });

  it('상한을 넘지 않는다', () => {
    const list = buildHighlights({
      anniversaryDate: '2010-01-01', events: [], military: MILITARY, todayStr: TODAY, limit: 5,
    });
    expect(list.length).toBeLessThanOrEqual(5);
    // 잘라도 미래는 남는다. 지금 기다리는 것이 사라지면 안 된다.
    expect(list.at(-1)?.reached).toBe(false);
  });
});
