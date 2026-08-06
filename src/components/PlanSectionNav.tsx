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
      className="flex gap-2 p-1 rounded-2xl bg-muted"
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
            className={`flex-1 min-h-[44px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground active:scale-95'
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
