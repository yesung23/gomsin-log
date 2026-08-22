import { Search } from 'lucide-react';
import { FIXTURE_RECORDS } from '../fixtures';

/**
 * 찾기 — 인스타 검색 탭과 같은 구조.
 *
 *     검색 입력 한 줄
 *     3열 격자
 *
 * 인스타와 다른 것은 **추천이 없다는 것**이다. 인스타의 격자는 알고리즘이 고른 남의
 * 게시물이고, 여기 격자는 우리 둘이 남긴 것을 시간순으로 놓은 것뿐이다. 정렬이 시간
 * 하나뿐이라 고를 것이 없고, 고를 것이 없으니 알고리즘이 들어설 자리도 없다.
 *
 * 검색은 **기기 안에서만** 한다. 서버 측 전문 검색은 E2EE 와 양립하지 않으므로 어떤
 * 버전에서도 약속하지 않는다.
 */

/** 인스타 탐색 격자처럼 일부 칸이 2×2로 커진다. 리듬이 생겨야 격자가 표처럼 안 읽힌다. */
const BIG = new Set([2, 11, 17]);

export function InstaSearch() {
  const cells = Array.from({ length: 24 }, (_, index) => {
    const record = FIXTURE_RECORDS[index % FIXTURE_RECORDS.length];
    return { index, record };
  });

  return (
    <div className="notebook min-h-full">
      <div className="px-4 pt-3 pb-2">
        <div className="ink-chip flex items-center gap-2 px-3 py-2.5">
          <Search size={16} className="pen-icon" color="var(--ink-soft)" />
          <span className="print text-[13px]" style={{ color: 'var(--ink-soft)' }}>
            우리가 남긴 것 찾기
          </span>
        </div>
        <p className="print pt-1.5 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          이 기기 안에서만 찾아요. 서버는 우리 글을 읽지 않아요.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-[3px] px-[3px]">
        {cells.map(({ index, record }) => (
          <button
            key={index}
            type="button"
            className="tap flex items-center justify-center overflow-hidden p-1.5"
            style={{
              gridColumn: BIG.has(index) ? 'span 2' : undefined,
              gridRow: BIG.has(index) ? 'span 2' : undefined,
              aspectRatio: BIG.has(index) ? '1 / 1' : '1 / 1',
              border: '1.2px solid var(--ink-faint)',
              borderRadius: index % 2
                ? '8px 2px 10px 2px / 2px 10px 2px 8px'
                : '2px 10px 2px 8px / 10px 2px 8px 2px',
            }}
          >
            {/* 사진이 있으면 사진, 없으면 그날 쓴 글의 앞부분. 빈 칸을 만들지 않는다. */}
            <span
              className="hand line-clamp-4 text-[11px] leading-snug"
              style={{ color: 'var(--ink-soft)' }}
            >
              {record.log.split('\n')[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
