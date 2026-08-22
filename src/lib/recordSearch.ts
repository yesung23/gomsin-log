import type { DailyRecord } from '@/types';

/**
 * 내가 쓴 글에서 찾기 — 기기 안에서만.
 *
 * ## 서버는 이 일을 할 수 없다
 *
 * `PRODUCT_V3` §17: **서버 측 전문 검색은 어떤 버전에서도 약속하지 않는다. E2EE와
 * 양립하지 않는다.** 암호문을 검색하려면 서버가 평문을 알아야 하고, 그 순간 이 제품이
 * 파는 것이 사라진다.
 *
 * 그런데 클라이언트는 이미 복호화된 기록을 손에 들고 있다. 그러니 검색은 **원래부터
 * 기기의 일**이고, 그것이 제약이 아니라 이 구조가 준 것이다.
 *
 * ## 최근 검색어를 저장하지 않는다
 *
 * 인스타에는 `최근 검색`이 있다. 여기엔 만들지 않는다. 자기 일기에서 무엇을 찾았는지는
 * 그 자체로 사적인 사실이고, 폰을 옆에서 보는 사람에게 가장 먼저 읽히는 종류의 흔적이다
 * (§14.3이 잠금화면 문구를 하나로 통일한 것과 같은 생활 조건). 검색어는 화면을 떠나는
 * 순간 사라진다.
 *
 * ## 검색어는 어디에도 실려 나가지 않는다
 *
 * URL 쿼리에 넣지 않고(§14.3 "로그·분석·URL·푸시에 사용자 콘텐츠 평문을 넣지 않는다"),
 * 계측 이벤트로도 보내지 않는다. §19가 허용하는 것은 이벤트 종류와 불투명 id뿐이며,
 * 검색어는 그 어느 쪽도 아니다.
 */

export interface RecordMatch {
  record: DailyRecord;
  /** 매치된 자리. 결과에서 그 부분만 굵게 보여주기 위한 것이며 저장되지 않는다. */
  start: number;
  end: number;
  /** 앞뒤를 잘라낸 발췌. 원문 그대로이며 앱이 문장을 만들지 않는다. */
  snippet: string;
}

export interface SearchResult {
  kind: 'text' | 'date' | 'empty';
  /** 날짜로 읽힌 경우의 `YYYY-MM-DD`. */
  date?: string;
  matches: RecordMatch[];
}

/** 한 번에 보여주는 상한. 무한 목록을 만들지 않는다. */
export const SEARCH_LIMIT = 50;

const SNIPPET_BEFORE = 12;
const SNIPPET_AFTER = 40;

/**
 * 날짜로 읽히는가.
 *
 * 받는 형태를 좁게 유지한다. 넓게 받으면 `3`이 3월 1일이 되고, 사용자는 `3`이 들어간
 * 문장을 찾으려던 것이었는데 엉뚱한 날로 끌려간다. 애매하면 글자로 취급한다.
 */
export function parseSearchDate(query: string, todayStr: string): string | null {
  const text = query.trim();
  const thisYear = todayStr.slice(0, 4);

  // 2026-08-14 / 2026.8.14 / 2026/8/14
  const full = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (full) return iso(full[1], full[2], full[3]);

  // 8월 14일
  const korean = text.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  if (korean) return iso(thisYear, korean[1], korean[2]);

  // 8/14 · 8.14 · 8-14
  const short = text.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (short) return iso(thisYear, short[1], short[2]);

  return null;
}

function iso(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const candidate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 2월 31일 같은 날짜를 통과시키지 않는다. 없는 날로 이동하면 빈 화면이 나온다.
  const parsed = new Date(`${candidate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) || parsed.getDate() !== d ? null : candidate;
}

/**
 * 찾는다.
 *
 * `records`는 **이미 `visibleRecordsForViewer`를 통과한 것**이어야 한다. 여기서 권한을
 * 다시 판정하지 않는다 -- 판정을 두 곳에서 하면 두 곳이 어긋나는 날이 온다. 내 비공개
 * 기록이 결과에 나오는 것은 맞다. 본인에게 본인 기록을 숨기는 것은 프라이버시가 아니다.
 */
export function searchRecords(
  records: DailyRecord[],
  query: string,
  todayStr: string,
): SearchResult {
  const text = query.trim();
  if (!text) return { kind: 'empty', matches: [] };

  const date = parseSearchDate(text, todayStr);
  if (date) {
    const matches = records
      .filter((record) => record.date === date)
      .sort(byNewest)
      .slice(0, SEARCH_LIMIT)
      .map((record) => ({ record, start: 0, end: 0, snippet: firstLine(record.log) }));
    return { kind: 'date', date, matches };
  }

  const needle = text.toLowerCase();
  const matches: RecordMatch[] = [];
  for (const record of [...records].sort(byNewest)) {
    const log = record.log ?? '';
    const at = log.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    matches.push({
      record,
      start: at,
      end: at + text.length,
      snippet: log,
    });
    if (matches.length >= SEARCH_LIMIT) break;
  }
  return { kind: 'text', matches };
}

function byNewest(a: DailyRecord, b: DailyRecord): number {
  return `${b.date}T${b.time || ''}`.localeCompare(`${a.date}T${a.time || ''}`);
}

function firstLine(log: string | undefined): string {
  const first = (log ?? '').split('\n')[0].trim();
  return first || '사진만 남긴 기록';
}

/**
 * 결과 한 줄에 보여줄 발췌를 자른다.
 *
 * 매치된 자리를 가운데 두고 앞뒤를 자른다. 앞에서부터 자르면 긴 글에서 정작 찾던 말이
 * 잘려 나가고, 사용자는 자기가 맞는 것을 찾았는지 알 수 없다.
 */
export function excerptAround(match: RecordMatch): {
  before: string;
  hit: string;
  after: string;
} {
  const { snippet, start, end } = match;
  const from = Math.max(start - SNIPPET_BEFORE, 0);
  const to = Math.min(end + SNIPPET_AFTER, snippet.length);
  return {
    before: (from > 0 ? '…' : '') + snippet.slice(from, start).replace(/\n/g, ' '),
    hit: snippet.slice(start, end),
    after: snippet.slice(end, to).replace(/\n/g, ' ') + (to < snippet.length ? '…' : ''),
  };
}
