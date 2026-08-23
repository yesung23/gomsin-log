import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, CalendarDays, SquarePen } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { searchRecords, excerptAround, type SearchResult } from '@/lib/recordSearch';
import { localToday } from '@/lib/cycle';
import type { DailyRecord } from '@/types';
import { MobileShell } from '@/components/MobileShell';

/**
 * 찾기 — `우리`의 색인.
 *
 * 탭이 아니다. 한 번 탭으로 짰다가 되돌렸다(§5.3): **인스타에 검색 탭이 있는 이유는
 * 거기에 남의 게시물이 있기 때문**이고, 이 앱에는 남이 없다. 그래서 탐색 격자에 넣을
 * 것이 우리 둘의 기록밖에 없었고 그것은 `우리` 탭의 하루 격자와 같은 화면이었다. 격자를
 * 지우고 검색만 남겼다. 종이 일기장 뒤에 붙은 색인과 같은 자리다.
 *
 * ## 이 화면이 지키는 것 셋
 *
 *   1. **기기 안에서만 찾는다.** 서버 측 전문 검색은 E2EE 와 양립하지 않아 어떤 버전에서도
 *      약속하지 않는다(§17). 그런데 클라이언트는 이미 복호화된 기록을 들고 있으므로
 *      검색은 원래부터 기기의 일이다.
 *   2. **최근 검색을 저장하지 않는다.** 자기 일기에서 무엇을 찾았는지는 그 자체로 사적인
 *      사실이고, 폰을 옆에서 보는 사람에게 가장 먼저 읽히는 흔적이다.
 *   3. **입력 전에는 아무것도 그리지 않는다.** 보여줄 만한 것을 억지로 채우면 그것이
 *      곧 `우리` 격자의 복제가 된다. 찾으러 온 사람은 칠 것이 있어서 온 것이다.
 *
 * 한 칸으로 둘을 받는다 -- `8/14` 같은 날짜면 그날을 열고, 아니면 쓴 말에서 찾는다.
 * 토글을 두면 사용자가 무엇을 고를지 먼저 정해야 하는데, 찾을 때 사람은 그냥 기억나는
 * 것을 친다.
 *
 * ## 왜 이 화면에 기록 진입점이 또 있는가
 *
 * §7.1 -- 작성 진입점은 이 탭에 상시 존재하며 제거할 수 없다. 탭바 가운데의 `남기기`가
 * 있는데도 여기 하나를 더 두는 것은 중복이 아니라, **그 계약이 탭바의 생김새에 기대지
 * 않게** 하기 위해서다. 둥근 부유 버튼이 아니라 줄 안의 작은 펜이라 탭바와 자리를 다투지
 * 않는다.
 */

function SearchPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const [query, setQuery] = useState('');

  /*
    내 기록 + 상대가 공유한 것. `RecordPage` 와 같은 필터를 쓴다.

    이걸 빼먹으면 검색이 상대의 `나만 보기` 조각을 찾아 준다 -- 화면에는 어디에도 없는
    글이 검색에서만 나오는 것이고, 그것은 유출이다.
  */
  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: state.profile.id,
      role: state.profile.role,
    }),
    [state.records, state.profile.id, state.profile.role],
  );

  const today = localToday();
  const result = useMemo(() => searchRecords(records, query, today), [records, query, today]);

  const openRecord = (record: DailyRecord) => {
    // §7.5 -- 근사치가 아니라 정확히 그 기록. `?record=` 는 새로고침과 딥링크에도 남는다.
    navigate(`/record?record=${encodeURIComponent(record.id)}`);
  };

  return (
    <div className="min-h-full pb-6">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="ink-chip flex flex-1 items-center gap-2 px-3">
            <Search size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="쓴 말이나 날짜로 찾기"
              aria-label="쓴 말이나 날짜로 찾기"
              enterKeyHint="search"
              type="search"
              className="hand-text min-h-11 w-full flex-1 bg-transparent text-body outline-none placeholder:opacity-45"
              style={{ color: 'var(--ink)' }}
            />
            {query ? (
              <button
                type="button"
                aria-label="지우기"
                onClick={() => setQuery('')}
                className="flex h-11 w-8 items-center justify-center"
              >
                <X size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {/* §7.1. 조건 없이 그린다 -- 이 버튼이 사라지는 상태는 존재하지 않는다. */}
          <button
            type="button"
            aria-label="기록 남기기"
            onClick={() => navigate('/compose')}
            className="ink-chip flex h-11 w-11 items-center justify-center"
          >
            <SquarePen size={18} className="pen-icon" color="var(--ink)" aria-hidden="true" />
          </button>
        </div>

        <p className="pt-1.5 text-caption" style={{ color: 'var(--ink-soft)' }}>
          {/* 왜 기기 안인지 말한다. 제약처럼 보이는 것이 실은 이 구조가 준 것이다. */}
          이 기기 안에서만 찾아요 · 8/14 처럼 날짜로도 찾을 수 있어요
        </p>
      </div>

      {result.kind === 'empty' ? null : <Results result={result} onOpen={openRecord} />}
    </div>
  );
}

function Results({
  result,
  onOpen,
}: {
  result: SearchResult;
  onOpen: (record: DailyRecord) => void;
}) {
  if (result.matches.length === 0) {
    return (
      <p className="px-4 pt-8 text-center text-label" style={{ color: 'var(--ink-soft)' }}>
        {result.kind === 'date' ? '그날은 남긴 것이 없어요' : '그 말이 들어간 기록이 없어요'}
      </p>
    );
  }

  return (
    <div>
      {result.kind === 'date' ? (
        <div className="flex items-center gap-1.5 px-4 pb-2">
          <CalendarDays size={14} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
          <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>
            {result.date} · {result.matches.length}개
          </span>
        </div>
      ) : (
        <p className="px-4 pb-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
          {result.matches.length}개 찾았어요
        </p>
      )}

      <ul className="px-4">
        {result.matches.map((match) => {
          const { before, hit, after } = excerptAround(match);
          const [, month, day] = match.record.date.split('-');
          return (
            <li key={match.record.id}>
              <button
                type="button"
                onClick={() => onOpen(match.record)}
                className="flex w-full flex-col items-start gap-1 py-3 text-left"
              >
                <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                  {Number(month)}월 {Number(day)}일 {match.record.time}
                </span>
                {/*
                  발췌는 원문 그대로다. 앱이 문장을 만들지 않고(§6.2), 찾던 말만 다른 색으로
                  표시해 사용자가 맞는 것을 찾았는지 바로 알게 한다.
                */}
                <span className="hand-text text-body" style={{ color: 'var(--ink)' }}>
                  {result.kind === 'date' ? match.snippet : (
                    <>
                      {before}
                      <mark
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-accent)',
                          fontWeight: 700,
                        }}
                      >
                        {hit}
                      </mark>
                      {after}
                    </>
                  )}
                </span>
              </button>
              <div className="ink-rule" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 탭은 셸 안에 있어야 한다.

 * 셸이 하단 탭바와 스킵 링크와 라우트 안내를 갖는다. 이것 없이 렌더하면 그 탭에 들어간
 * 사람은 탭바가 없어 **빠져나올 수 없다** -- 뒤로 가기 말고는.
 */
export function SearchPage() {
  return (
    <MobileShell>
      <SearchPageBody />
    </MobileShell>
  );
}
