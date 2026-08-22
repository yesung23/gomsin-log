import { describe, it, expect } from 'vitest';
import { buildCoupleStats, togetherDays, photoCount } from '@/lib/coupleStats';
import type { CoupleEvent, DailyRecord, MilitaryInfo } from '@/types';

/*
  프로필의 세 숫자.

  단언의 절반은 "0을 보여주지 않는다"이다. 없는 것을 0으로 적으면 앱이 사용자 관계에
  대해 거짓을 말하게 된다 -- 지어낸 기념일을 지웠던 M-1과 같은 이유다.
*/

const TODAY = '2026-08-22';

function event(over: Partial<CoupleEvent> = {}): CoupleEvent {
  return {
    id: 'e1', coupleId: 'c1', title: '면회', eventType: 'visit',
    startDate: '2026-09-03', createdAt: '', ...over,
  } as CoupleEvent;
}

const MILITARY: MilitaryInfo = {
  militaryStatus: 'serving',
  enlistmentDate: '2025-06-01',
  expectedDischargeDate: '2026-12-01',
  dischargeDateSource: 'user',
} as MilitaryInfo;

describe('함께한 날', () => {
  it('사귄 날이 1일이다', () => {
    expect(togetherDays('2026-08-22', TODAY)).toBe(1);
    expect(togetherDays('2026-08-20', TODAY)).toBe(3);
  });

  it('정하지 않았으면 0이 아니라 없음이다', () => {
    expect(togetherDays(undefined, TODAY)).toBeNull();
    const [first] = buildCoupleStats({ events: [], todayStr: TODAY, thirdSlot: 'anniversary' });
    expect(first.value).toBe('—');
    expect(first.hint).toBeTruthy();
  });
});

describe('만남까지', () => {
  it('가장 가까운 만남을 센다', () => {
    const [, meeting] = buildCoupleStats({
      anniversaryDate: '2025-08-22',
      events: [event({ id: 'far', startDate: '2026-10-01' }), event({ id: 'near', startDate: '2026-08-27' })],
      todayStr: TODAY, thirdSlot: 'anniversary',
    });
    expect(meeting).toMatchObject({ value: 'D-5', label: '만남까지' });
  });

  it('만남 종류만 센다', () => {
    // 범용 캘린더가 아니다. 기념일이나 기타 일정은 "만남"이 아니다.
    const [, meeting] = buildCoupleStats({
      events: [event({ eventType: 'anniversary', startDate: '2026-08-25' })],
      todayStr: TODAY, thirdSlot: 'anniversary',
    });
    expect(meeting.value).toBe('미정');
  });

  it('오늘이면 D-0이 아니라 오늘이라고 한다', () => {
    const [, meeting] = buildCoupleStats({
      events: [event({ startDate: TODAY })], todayStr: TODAY, thirdSlot: 'anniversary',
    });
    expect(meeting.value).toBe('오늘');
  });

  it('없으면 0이 아니라 미정이고, 더하러 갈 길을 준다', () => {
    const [, meeting] = buildCoupleStats({ events: [], todayStr: TODAY, thirdSlot: 'anniversary' });
    expect(meeting.value).toBe('미정');
    expect(meeting.href).toBe('/schedule');
  });
});

describe('세 번째 칸은 고를 수 있다', () => {
  it('전역까지를 고르면 남은 날을 센다', () => {
    const [, , third] = buildCoupleStats({
      events: [], military: MILITARY, todayStr: TODAY, thirdSlot: 'discharge',
    });
    expect(third.label).toBe('전역까지');
    expect(Number(third.value)).toBeGreaterThan(0);
  });

  it('예정된 만남 수를 고를 수 있다', () => {
    const [, , third] = buildCoupleStats({
      events: [event({ id: 'a', startDate: '2026-08-27' }), event({ id: 'b', startDate: '2026-09-20' })],
      todayStr: TODAY, thirdSlot: 'meetings',
    });
    expect(third).toMatchObject({ value: '2', label: '예정된 만남' });
  });

  it('군 정보가 없으면 조용히 기념일로 바뀐다', () => {
    // 빈 칸이 셋 중 하나를 차지하지 않게 한다.
    const [, , third] = buildCoupleStats({
      anniversaryDate: '2025-08-22', events: [], todayStr: TODAY, thirdSlot: 'discharge',
    });
    expect(third.label).not.toBe('전역까지');
    expect(third.value).toMatch(/^D-\d+$/);
  });

  it('전역한 뒤에도 조용히 다음 기다림으로 바뀐다', () => {
    /*
      축하 팝업도 리텐션 유도도 없다. 전역은 이 제품의 이유가 사라지는 날이고,
      그 전환은 한 칸이 조용히 다른 것으로 바뀌는 것으로 충분하다.
    */
    const discharged: MilitaryInfo = {
      ...MILITARY, enlistmentDate: '2024-01-01', expectedDischargeDate: '2025-07-01',
    } as MilitaryInfo;
    const [, , third] = buildCoupleStats({
      anniversaryDate: '2025-08-22', events: [], military: discharged,
      todayStr: TODAY, thirdSlot: 'discharge',
    });
    expect(third.label).not.toBe('전역까지');
  });

  it('아무것도 없으면 사실대로 비운다', () => {
    const [, , third] = buildCoupleStats({ events: [], todayStr: TODAY, thirdSlot: 'discharge' });
    expect(third.value).toBe('—');
    expect(third.hint).toBeTruthy();
  });
});

describe('없는 것', () => {
  it('관계 점수나 순위를 만들지 않는다', () => {
    const stats = buildCoupleStats({
      anniversaryDate: '2025-08-22', events: [event()], military: MILITARY,
      todayStr: TODAY, thirdSlot: 'discharge',
    });
    for (const stat of stats) {
      expect(stat.label).not.toMatch(/점수|랭킹|순위|등급|퍼센트|%/);
    }
  });

  it('세 칸뿐이다', () => {
    // 인스타의 통계 줄은 균등 3분할이다. 넷이 되면 그 문법이 깨진다.
    expect(buildCoupleStats({ events: [], todayStr: TODAY, thirdSlot: 'anniversary' })).toHaveLength(3);
  });
});

describe('사진 수', () => {
  it('사진만 세고 영상·음성은 세지 않는다', () => {
    const records = [
      { attachments: [{ type: 'photo' }, { type: 'photo' }] },
      { attachments: [{ type: 'voice' }] },
      { attachments: undefined },
    ] as DailyRecord[];
    expect(photoCount(records)).toBe(2);
  });
});
