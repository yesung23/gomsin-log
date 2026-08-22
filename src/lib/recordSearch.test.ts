import { describe, it, expect } from 'vitest';
import {
  searchRecords, parseSearchDate, excerptAround, SEARCH_LIMIT,
} from '@/lib/recordSearch';
import type { DailyRecord } from '@/types';

const TODAY = '2026-08-22';

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner', date: TODAY, time: '09:00',
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false, ...over,
  } as DailyRecord;
}

describe('글에서 찾기', () => {
  it('쓴 말의 일부로 그 기록을 찾는다', () => {
    const records = [
      record({ id: 'a', log: '오늘 시험 끝났어 생각보다 잘 봤어' }),
      record({ id: 'b', log: '점심은 친구랑 먹었어' }),
    ];
    const result = searchRecords(records, '시험', TODAY);
    expect(result.kind).toBe('text');
    expect(result.matches.map((m) => m.record.id)).toEqual(['a']);
  });

  it('여러 줄 안쪽도 찾는다', () => {
    const records = [record({ id: 'a', log: '첫 줄\n둘째 줄에 면회 얘기가 있어' })];
    expect(searchRecords(records, '면회', TODAY).matches).toHaveLength(1);
  });

  it('최신이 먼저 온다', () => {
    const records = [
      record({ id: 'old', date: '2026-08-01', log: '면회 갔다' }),
      record({ id: 'new', date: '2026-08-20', log: '면회 얘기' }),
    ];
    expect(searchRecords(records, '면회', TODAY).matches.map((m) => m.record.id))
      .toEqual(['new', 'old']);
  });

  it('빈 검색어는 아무것도 찾지 않는다', () => {
    // 빈 입력에 전체를 쏟아내면 목록이 결과인지 아닌지 알 수 없다.
    expect(searchRecords([record()], '   ', TODAY)).toMatchObject({ kind: 'empty', matches: [] });
  });

  it('상한을 넘지 않는다', () => {
    // 무한 목록을 만들지 않는다.
    const records = Array.from({ length: SEARCH_LIMIT + 20 }, (_, i) =>
      record({ id: `r${i}`, time: `${String(i % 24).padStart(2, '0')}:00`, log: '면회' }));
    expect(searchRecords(records, '면회', TODAY).matches).toHaveLength(SEARCH_LIMIT);
  });

  it('없으면 없다고 한다', () => {
    expect(searchRecords([record()], '없는말', TODAY).matches).toEqual([]);
  });
});

describe('날짜로 찾기', () => {
  it('여러 형태를 받는다', () => {
    expect(parseSearchDate('2026-08-14', TODAY)).toBe('2026-08-14');
    expect(parseSearchDate('2026.8.14', TODAY)).toBe('2026-08-14');
    expect(parseSearchDate('8월 14일', TODAY)).toBe('2026-08-14');
    expect(parseSearchDate('8/14', TODAY)).toBe('2026-08-14');
  });

  it('애매하면 글자로 취급한다', () => {
    /*
      넓게 받으면 `3`이 3월 1일이 되고, 사용자는 `3`이 들어간 문장을 찾으려던 것이었는데
      엉뚱한 날로 끌려간다.
    */
    expect(parseSearchDate('3', TODAY)).toBeNull();
    expect(parseSearchDate('시험', TODAY)).toBeNull();
    expect(parseSearchDate('8월', TODAY)).toBeNull();
  });

  it('없는 날짜를 통과시키지 않는다', () => {
    // 2월 31일로 이동하면 빈 화면이 나온다.
    expect(parseSearchDate('2026-02-31', TODAY)).toBeNull();
    expect(parseSearchDate('13/1', TODAY)).toBeNull();
  });

  it('그날의 기록만 모은다', () => {
    const records = [
      record({ id: 'that-day', date: '2026-08-14', log: '그날' }),
      record({ id: 'other', date: '2026-08-15', log: '다른 날' }),
    ];
    const result = searchRecords(records, '8/14', TODAY);
    expect(result).toMatchObject({ kind: 'date', date: '2026-08-14' });
    expect(result.matches.map((m) => m.record.id)).toEqual(['that-day']);
  });
});

describe('발췌는 찾던 말을 가운데 둔다', () => {
  it('긴 글에서도 매치가 잘려 나가지 않는다', () => {
    /*
      앞에서부터 자르면 긴 글에서 정작 찾던 말이 사라지고, 사용자는 자기가 맞는 것을
      찾았는지 알 수 없다.
    */
    const long = `${'가'.repeat(200)}면회${'나'.repeat(200)}`;
    const [match] = searchRecords([record({ log: long })], '면회', TODAY).matches;
    const { before, hit, after } = excerptAround(match);
    expect(hit).toBe('면회');
    expect(before.startsWith('…')).toBe(true);
    expect(after.endsWith('…')).toBe(true);
    expect((before + hit + after).length).toBeLessThan(80);
  });

  it('발췌는 원문 그대로다', () => {
    // 앱이 문장을 만들지 않는다(§6.2 서사 창작 금지).
    const [match] = searchRecords([record({ log: '오늘 시험 끝났어' })], '시험', TODAY).matches;
    const { before, hit, after } = excerptAround(match);
    expect(`${before}${hit}${after}`).toBe('오늘 시험 끝났어');
  });

  it('줄바꿈은 한 줄로 편다', () => {
    const [match] = searchRecords([record({ log: '첫 줄\n면회 얘기\n셋째' })], '면회', TODAY).matches;
    const { before, after } = excerptAround(match);
    expect(before).not.toContain('\n');
    expect(after).not.toContain('\n');
  });
});

describe('검색어가 새어 나가지 않는다', () => {
  it('결과가 검색어를 들고 다니지 않는다', () => {
    /*
      §14.3 -- 로그·분석·URL·푸시에 사용자 콘텐츠 평문을 넣지 않는다. 결과 객체에
      검색어 필드가 있으면 그것이 다음 사람에게 URL 이나 이벤트로 실려 나갈 자리가 된다.
    */
    const result = searchRecords([record()], '시험', TODAY);
    expect(Object.keys(result).sort()).toEqual(['kind', 'matches']);
  });

  it('소스에 최근 검색 저장이 없다', async () => {
    /*
      인스타에는 최근 검색이 있다. 여기엔 만들지 않는다 -- 자기 일기에서 무엇을 찾았는지는
      그 자체로 사적인 사실이고, 폰을 옆에서 보는 사람에게 가장 먼저 읽히는 흔적이다.
    */
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/recordSearch.ts', 'utf8'));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|recentSearch|history/i);
  });
});
