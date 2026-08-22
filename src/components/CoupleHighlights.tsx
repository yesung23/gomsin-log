import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildHighlights } from '@/lib/coupleHighlights';
import { cn } from '@/lib/utils';
import type { CoupleEvent, MilitaryInfo } from '@/types';

/**
 * 하이라이트 줄 — 함께 지나온 것들과, 지금 기다리는 것 하나.
 *
 * 인스타 프로필의 원형 하이라이트 자리를 쓰되 원이 아니라 **종이 라벨**이다. 살짝 기운
 * 사각 스티커가 붙어 있는 모양이며, 남의 식별 표지를 베끼지 않으면서 같은 자리 같은
 * 가로 스크롤을 쓴다.
 *
 * 맨 뒤의 흐린 하나는 아직 오지 않은 것이다. 누를 수 없다 -- 그날의 스토리가 아직
 * 없기 때문이고, 없는 것을 열어 빈 화면을 보여주지 않는 것이 이 앱의 규칙이다.
 */
export function CoupleHighlights({
  anniversaryDate,
  events,
  military,
  todayStr,
}: {
  anniversaryDate?: string;
  events: CoupleEvent[];
  military?: MilitaryInfo;
  todayStr: string;
}) {
  const navigate = useNavigate();
  const highlights = useMemo(
    () => buildHighlights({ anniversaryDate, events, military, todayStr }),
    [anniversaryDate, events, military, todayStr],
  );

  if (highlights.length === 0) return null;

  return (
    <nav aria-label="마일스톤" data-testid="couple-highlights">
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {highlights.map((highlight) => {
          const [, month, day] = highlight.date.split('-');
          const when = `${Number(month)}/${Number(day)}`;
          return (
            <li key={`${highlight.label}-${highlight.date}`} className="shrink-0">
              <button
                type="button"
                disabled={!highlight.reached}
                onClick={() => navigate(`/story/day/${highlight.date}`)}
                aria-label={
                  highlight.reached
                    ? `${highlight.label}, ${when}`
                    : `${highlight.label}, ${highlight.countdown} — 아직 오지 않았어요`
                }
                className={cn(
                  'press-response flex min-h-11 w-20 flex-col items-center justify-center gap-0.5',
                  'rounded-control border px-2 py-2',
                  highlight.reached
                    ? 'border-border bg-card text-foreground'
                    // 아직 오지 않은 것. 연필로 그려 둔 자리처럼 흐리다.
                    : 'border-dashed border-border bg-transparent text-muted-foreground',
                )}
              >
                <span className="text-label font-semibold">{highlight.label}</span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {highlight.reached ? when : highlight.countdown}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
