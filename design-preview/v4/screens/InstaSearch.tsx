import { useMemo, useState } from 'react';
import { Search, X, CalendarDays } from 'lucide-react';
import { searchRecords, excerptAround } from '@/lib/recordSearch';
import type { DailyRecord } from '@/types';
import { FIXTURE_RECORDS, TODAY } from '../fixtures';

/**
 * 찾기 — 인스타 검색 탭과 같은 구조, 다른 경제.
 *
 *     검색 입력 한 줄
 *     3열 격자 (입력이 비었을 때)
 *     결과 목록 (입력이 있을 때)
 *
 * ## 인스타와 다른 것 셋
 *
 *   1. **추천이 없다.** 인스타의 격자는 알고리즘이 고른 남의 게시물이고, 여기 격자는
 *      우리 둘이 남긴 것의 시간순이다. 정렬이 하나뿐이라 알고리즘이 들어설 자리가 없다.
 *   2. **기기 안에서만 찾는다.** 서버 측 전문 검색은 E2EE 와 양립하지 않아 어떤 버전에서도
 *      약속하지 않는다(§17). 그런데 클라이언트는 이미 복호화된 기록을 들고 있으므로
 *      검색은 원래부터 기기의 일이다.
 *   3. **최근 검색을 저장하지 않는다.** 자기 일기에서 무엇을 찾았는지는 그 자체로 사적인
 *      사실이고, 폰을 옆에서 보는 사람에게 가장 먼저 읽히는 흔적이다.
 *
 * 한 칸으로 둘을 받는다 -- `8/14` 같은 날짜면 그날을 열고, 아니면 쓴 말에서 찾는다.
 * 토글을 두면 사용자가 무엇을 고를지 먼저 정해야 하는데, 찾을 때 사람은 그냥 기억나는
 * 것을 친다.
 */

/** 인스타 탐색 격자처럼 일부 칸이 2×2로 커진다. 리듬이 생겨야 격자가 표처럼 안 읽힌다. */
const BIG = new Set([2, 11, 17]);

const RECORDS = FIXTURE_RECORDS as unknown as DailyRecord[];

export function InstaSearch() {
  const [query, setQuery] = useState('');
  const result = useMemo(() => searchRecords(RECORDS, query, TODAY), [query]);

  return (
    <div className="notebook min-h-full pb-6">
      <div className="px-4 pt-3 pb-2">
        <div className="ink-chip flex items-center gap-2 px-3">
          <Search size={16} className="pen-icon" color="var(--ink-soft)" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="쓴 말이나 날짜로 찾기"
            aria-label="쓴 말이나 날짜로 찾기"
            enterKeyHint="search"
            className="hand min-h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:opacity-45"
            style={{ color: 'var(--ink)' }}
          />
          {query ? (
            <button
              type="button" aria-label="지우기" onClick={() => setQuery('')}
              className="tap flex h-11 w-8 items-center justify-center"
            >
              <X size={16} className="pen-icon" color="var(--ink-soft)" />
            </button>
          ) : null}
        </div>
        <p className="print pt-1.5 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          {/* 왜 기기 안인지 말한다. 제약처럼 보이는 것이 실은 이 구조가 준 것이다. */}
          이 기기 안에서만 찾아요 · 8/14 처럼 날짜로도 찾을 수 있어요
        </p>
      </div>

      {result.kind === 'empty' ? <ExploreGrid /> : <Results result={result} />}
    </div>
  );
}

function Results({ result }: { result: ReturnType<typeof searchRecords> }) {
  if (result.matches.length === 0) {
    return (
      <p className="print px-4 pt-8 text-center text-[13px]" style={{ color: 'var(--ink-soft)' }}>
        {result.kind === 'date' ? '그날은 남긴 것이 없어요' : '그 말이 들어간 기록이 없어요'}
      </p>
    );
  }

  return (
    <div>
      {result.kind === 'date' ? (
        <div className="flex items-center gap-1.5 px-4 pb-2">
          <CalendarDays size={14} className="pen-icon" color="var(--ink-soft)" />
          <span className="print text-[12px]" style={{ color: 'var(--ink-soft)' }}>
            {result.date} · {result.matches.length}개
          </span>
        </div>
      ) : (
        <p className="print px-4 pb-2 text-[12px]" style={{ color: 'var(--ink-soft)' }}>
          {result.matches.length}개 찾았어요
        </p>
      )}

      <ul className="px-4">
        {result.matches.map((match) => {
          const { before, hit, after } = excerptAround(match);
          const [, month, day] = match.record.date.split('-');
          return (
            <li key={match.record.id}>
              <button type="button" className="tap flex w-full flex-col items-start gap-1 py-3 text-left">
                <span className="print text-[11px] tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                  {Number(month)}월 {Number(day)}일 {match.record.time}
                </span>
                {/*
                  발췌는 원문 그대로다. 앱이 문장을 만들지 않고(§6.2), 찾던 말만 굵게
                  표시해 사용자가 맞는 것을 찾았는지 바로 알게 한다.
                */}
                <span className="hand text-[15px]" style={{ color: 'var(--ink)' }}>
                  {result.kind === 'date' ? match.snippet : (
                    <>
                      {before}
                      <mark style={{ background: 'transparent', color: 'var(--accent)', fontWeight: 700 }}>
                        {hit}
                      </mark>
                      {after}
                    </>
                  )}
                </span>
              </button>
              <div className="ink-rule" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExploreGrid() {
  const cells = Array.from({ length: 24 }, (_, index) => ({
    index,
    record: RECORDS[index % RECORDS.length],
  }));

  return (
    <div className="grid grid-cols-3 gap-[3px] px-[3px]">
      {cells.map(({ index, record }) => (
        <button
          key={index}
          type="button"
          className="tap flex items-center justify-center overflow-hidden p-1.5"
          style={{
            gridColumn: BIG.has(index) ? 'span 2' : undefined,
            gridRow: BIG.has(index) ? 'span 2' : undefined,
            aspectRatio: '1 / 1',
            border: '1.2px solid var(--ink-faint)',
            borderRadius: index % 2
              ? '8px 2px 10px 2px / 2px 10px 2px 8px'
              : '2px 10px 2px 8px / 10px 2px 8px 2px',
          }}
        >
          {/* 사진이 있으면 사진, 없으면 그날 쓴 글의 앞부분. 빈 칸을 만들지 않는다. */}
          <span className="hand line-clamp-4 text-[11px] leading-snug" style={{ color: 'var(--ink-soft)' }}>
            {record.log.split('\n')[0]}
          </span>
        </button>
      ))}
    </div>
  );
}
