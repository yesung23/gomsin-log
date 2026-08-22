import { describe, it, expect } from 'vitest';
import { buildDiaryMonths, findDiaryMonth } from './diaryMonths';
import type { DailyRecord } from '@/types';

function record(partial: Partial<DailyRecord> & { date: string }): DailyRecord {
  return {
    id: `${partial.date}-${partial.time ?? '09:00'}`,
    date: partial.date,
    time: partial.time ?? '09:00',
    authorRole: 'gomsin',
    log: partial.log ?? '오늘',
    isPrivate: false,
    createdAt: `${partial.date}T00:00:00.000Z`,
    ...partial,
  };
}

describe('한 달치가 하나의 지면이 된다', () => {
  it('최근 달이 먼저 온다', () => {
    const months = buildDiaryMonths([
      record({ date: '2026-06-01' }),
      record({ date: '2026-08-03' }),
      record({ date: '2026-07-11' }),
    ]);
    expect(months.map((month) => month.key)).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('지면 안에서는 오래된 것이 먼저 온다 -- 일기는 위에서 아래로 읽는다', () => {
    const months = buildDiaryMonths([
      record({ date: '2026-08-09', time: '21:00' }),
      record({ date: '2026-08-02', time: '08:00' }),
      record({ date: '2026-08-09', time: '07:30' }),
    ]);
    expect(months[0].records.map((r) => `${r.date} ${r.time}`)).toEqual([
      '2026-08-02 08:00', '2026-08-09 07:30', '2026-08-09 21:00',
    ]);
  });

  it('라벨에 앞의 0을 붙이지 않는다', () => {
    expect(buildDiaryMonths([record({ date: '2026-01-05' })])[0].label).toBe('2026년 1월');
  });

  it('빈 달을 만들지 않는다', () => {
    /*
      6월과 8월 사이에 7월이 비어 있다. 빈 지면을 목록에 두면 "이 달도 꾸며 보세요"가
      되고, 그것은 남기지 않은 것을 결핍으로 만드는 재촉이다 -- §16이 연속 기록을
      금지하는 것과 같은 이유다.
    */
    const months = buildDiaryMonths([record({ date: '2026-06-30' }), record({ date: '2026-08-01' })]);
    expect(months.map((month) => month.key)).toEqual(['2026-08', '2026-06']);
  });

  it('아무것도 없으면 지면도 없다', () => {
    expect(buildDiaryMonths([])).toEqual([]);
  });
});

describe('숫자가 곧 상품 설명이므로 정확해야 한다', () => {
  it('기록 수 · 사진 수 · 남긴 날 수를 따로 센다', () => {
    const months = buildDiaryMonths([
      record({ date: '2026-08-01', time: '09:00', attachments: [{ id: 'a', kind: 'image', path: 'x' }] as never }),
      record({ date: '2026-08-01', time: '20:00' }),
      record({ date: '2026-08-14', attachments: [
        { id: 'b', kind: 'image', path: 'y' }, { id: 'c', kind: 'image', path: 'z' },
      ] as never }),
    ]);
    // 기록 셋, 사진 셋, 그런데 남긴 날은 이틀이다. 셋을 한 숫자로 뭉치면 "8월에 세 번
    // 있었다"와 "사흘 있었다"가 구별되지 않는다.
    expect(months[0].recordCount).toBe(3);
    expect(months[0].photoCount).toBe(3);
    expect(months[0].dayCount).toBe(2);
  });

  it('첨부가 없으면 사진은 0이지 undefined 가 아니다', () => {
    expect(buildDiaryMonths([record({ date: '2026-08-01' })])[0].photoCount).toBe(0);
  });

  it('이 기기가 못 여는 기록도 센다', () => {
    /*
      `contentUnavailable` 은 이 기기에 열쇠가 없다는 뜻이지 그 기록이 없다는 뜻이
      아니다. 세지 않으면 기기를 바꿀 때마다 지난 달의 기록 수가 줄어드는 것처럼 보이고,
      사용자는 자기 기록이 사라졌다고 읽는다.
    */
    const months = buildDiaryMonths([
      record({ date: '2026-08-01', log: '', contentUnavailable: 'key_unavailable' }),
      record({ date: '2026-08-02' }),
    ]);
    expect(months[0].recordCount).toBe(2);
  });

  it('달을 정할 수 없는 날짜는 아무 달에도 넣지 않는다', () => {
    // 아무 달에나 넣으면 그 달의 숫자가 조용히 틀린다. 화면에는 아무 표시도 안 나므로
    // 틀린 채로 팔린다.
    const months = buildDiaryMonths([
      record({ date: '2026-08-01' }),
      record({ date: 'not-a-date' }),
      record({ date: '' }),
    ]);
    expect(months).toHaveLength(1);
    expect(months[0].recordCount).toBe(1);
  });
});

describe('없는 달은 빈 지면이 되지 않는다', () => {
  it('찾으면 준다', () => {
    const months = buildDiaryMonths([record({ date: '2026-08-01' })]);
    expect(findDiaryMonth(months, '2026-08')?.key).toBe('2026-08');
  });

  it('없으면 null 이다', () => {
    // `undefined` 로 흘려보내면 화면이 빈 지면을 그리고, 사용자는 그 달의 기록이
    // 지워졌다고 읽는다.
    expect(findDiaryMonth(buildDiaryMonths([record({ date: '2026-08-01' })]), '2026-07')).toBeNull();
  });
});
