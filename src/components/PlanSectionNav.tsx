import { CalendarDays, Plane } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Sub-navigation for the 일정 tab: 일정 ↔ 여행.
 *
 * 여행 was the least discoverable feature in the app. It had no tab, and the only
 * ways in were a home widget the user is free to delete and one button on /us. The
 * request was to make it obvious, so the planning tab now owns both halves of
 * "our plans" and this bar makes the pair visible from either side.
 *
 * Rendered on both /schedule and /trips so the two never feel like separate
 * destinations you have to navigate back out of.
 *
 * 2026-08-08 visual revision: tightened from rounded-2xl to rounded-surface for
 * the container and rounded-control for tabs; used text-label token; ensured 44px
 * hit targets for each tab button.
 */
export function PlanSectionNav({ active }: { active: 'schedule' | 'trips' }) {
  const navigate = useNavigate();

  /**
   * `ariaLabel` differs from the visible text on purpose.
   *
   * The bottom bar already exposes a tab named 일정, so a screen-reader user
   * moving through the page would hear "일정, tab" twice with no way to tell the
   * section switcher from the app-level tab. Naming these by what they list
   * removes the collision without changing what the eye reads.
   */
  const items = [
    { key: 'schedule' as const, to: '/schedule', label: '일정', ariaLabel: '일정 목록', icon: CalendarDays },
    { key: 'trips' as const, to: '/trips', label: '여행', ariaLabel: '여행 목록', icon: Plane },
  ];

  return (
    <div
      role="tablist"
      aria-label="계획 종류"
      /*
        인스타 프로필의 탭 줄과 같은 문법 (2026-08-23).

        알약 모양 스위처를 걷어냈다. 종이 위에서 채운 알약은 그 화면에서 유일하게 앱처럼
        보이는 물건이 되고, 그 하나 때문에 나머지가 전부 인쇄된 것처럼 읽힌다. 대신
        선택된 쪽 아래에 잉크로 밑줄을 긋는다.
      */
      className="flex"
      style={{ borderBottom: 'var(--stroke) solid var(--ink-faint)' }}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={item.ariaLabel}
            onClick={() => !isActive && navigate(item.to)}
            className="press-response-row flex-1 min-h-11 text-label font-semibold flex items-center justify-center gap-1.5"
            style={{
              color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
              borderBottom: isActive ? 'var(--stroke-bold) solid var(--ink)' : undefined,
            }}
          >
            <Icon size={15} className="pen-icon" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
