import { describe, it, expect } from 'vitest';
import { selectOnThisDay, onThisDayLabel } from '@/lib/onThisDay';
import type { DailyRecord } from '@/types';

const record = (over: Partial<DailyRecord> & { date: string }): DailyRecord => ({
  id: `rec-${over.date}-${over.time ?? '09:00'}`,
  authorRole: 'gomsin',
  log: '오늘도 보고 싶어',
  time: '09:00',
  isPrivate: false,
  talkAbout: false,
  ...over,
} as DailyRecord);

const TODAY = '2026-08-23';

describe('오늘과 같은 날짜의 지난 기록을 하나 고른다', () => {
  it('1년 전 오늘이 있으면 그것', () => {
    const found = selectOnThisDay([record({ date: '2025-08-23' })], TODAY);
    expect(found?.yearsAgo).toBe(1);
  });

  /* 멀수록 좋은 것이 아니라 오늘과 이어지는 것이 좋다. */
  it('여러 해에 있으면 가장 가까운 해', () => {
    const found = selectOnThisDay(
      [record({ date: '2023-08-23' }), record({ date: '2025-08-23' })],
      TODAY,
    );
    expect(found?.yearsAgo).toBe(1);
  });

  it('1년 전이 비었으면 그 앞으로 거슬러 간다', () => {
    const found = selectOnThisDay([record({ date: '2023-08-23' })], TODAY);
    expect(found?.yearsAgo).toBe(3);
  });

  /* 하루의 시작이 그날을 대표한다. 마지막 것을 고르면 자기 전에 남긴 짧은 한 줄이
     그해의 그날 전체가 된다. */
  it('그날 여러 개면 첫 기록', () => {
    const found = selectOnThisDay(
      [record({ date: '2025-08-23', time: '23:40' }), record({ date: '2025-08-23', time: '07:10' })],
      TODAY,
    );
    expect(found?.record.time).toBe('07:10');
  });

  it('같은 날짜가 아니면 고르지 않는다', () => {
    expect(selectOnThisDay([record({ date: '2025-08-22' })], TODAY)).toBeNull();
  });

  it('올해 것은 지난 것이 아니다', () => {
    expect(selectOnThisDay([record({ date: TODAY })], TODAY)).toBeNull();
  });

  it('아무것도 없으면 없다', () => {
    expect(selectOnThisDay([], TODAY)).toBeNull();
  });

  /*
    2월 29일. 날짜 객체로 빼면 `2025-02-29` 가 3월 1일로 굴러가 **엉뚱한 날의 기록이
    작년 오늘로 뜬다.** 문자열 열쇠는 아무와도 맞지 않고, 맞지 않는 것이 옳다.
  */
  it('2월 29일에 3월 1일의 기록을 작년 오늘이라고 하지 않는다', () => {
    const found = selectOnThisDay([record({ date: '2023-03-01' })], '2024-02-29');
    expect(found).toBeNull();
  });

  it('2월 29일에 진짜 2월 29일 기록이 있으면 찾는다', () => {
    const found = selectOnThisDay([record({ date: '2020-02-29' })], '2024-02-29');
    expect(found?.yearsAgo).toBe(4);
  });

  /* 10년보다 먼 것은 돌아오지 않는다 -- 무한히 거슬러 올라가지 않는다는 계약이다. */
  it('아주 먼 것은 돌아오지 않는다', () => {
    expect(selectOnThisDay([record({ date: '2010-08-23' })], TODAY)).toBeNull();
  });
});

describe('한 줄에 쓰는 말', () => {
  it('1년', () => {
    expect(onThisDayLabel({ yearsAgo: 1, record: record({ date: '2025-08-23' }) })).toBe('1년 전 오늘');
  });
  it('여러 해', () => {
    expect(onThisDayLabel({ yearsAgo: 3, record: record({ date: '2023-08-23' }) })).toBe('3년 전 오늘');
  });
});
