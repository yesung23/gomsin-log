import type { ReactNode } from 'react';
import { BookOpen, CalendarDays, Heart, Home, User } from 'lucide-react';
import type { BriefingReason } from './fixtures';
import { REASON_LABEL } from './fixtures';

/**
 * Design-system primitives, semantic tokens only.
 *
 * No raw Tailwind palette literal appears here (`bg-pink-500`, `text-white`,
 * `bg-white/60` ...). `src/lib/themeTokens.test.ts` guards production files
 * against exactly those, and the preview holds itself to the same rule so these
 * components can be lifted into `src/` in PR 3 without a rewrite.
 */

const TOUCH = 'min-h-11'; /* 44px */

export function AppBar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 h-13 shrink-0 border-b border-border">
      <span className="text-[17px] font-semibold text-foreground truncate">{title}</span>
      {right ? <span className="text-[13px] text-muted-foreground shrink-0 ml-2">{right}</span> : null}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  rail,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Left coral rail marks the briefing as the judgement surface. */
  rail?: boolean;
}) {
  return (
    <section
      className={[
        'bg-card border border-border rounded-lg overflow-hidden',
        rail ? 'border-l-4 border-l-coral' : '',
      ].join(' ')}
    >
      {title ? (
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
          <h2 className="text-[15px] font-semibold text-foreground truncate">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Text-first badge. Colour is always the second signal, never the only one. */
export function ReasonBadge({ reason }: { reason: BriefingReason }) {
  const tone =
    reason === 'must_talk'
      ? 'bg-coral-strong text-coral-strong-foreground'
      : reason === 'decision'
        ? 'bg-info-surface text-info-foreground'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[12px] font-medium ${tone}`}>
      {REASON_LABEL[reason]}
    </span>
  );
}

export function PrivateBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-warning-surface px-1.5 py-0.5 text-[12px] font-medium text-warning-foreground">
      <span aria-hidden="true">🔒</span>
      나만 보기
    </span>
  );
}

export function PrimaryButton({ label, full }: { label: string; full?: boolean }) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center rounded-md px-4',
        // Mirrors the shipped Button primitive: `--coral-fill` is the pink primary
        // pair, split from `--coral-strong` (which stays dark because it is also
        // coral ink on cards). Using the ink token here painted every captured CTA
        // brick-dark while the app rendered it pink.
        'bg-coral-fill text-coral-fill-foreground',
        'text-[15px] font-semibold min-h-13',
        full ? 'w-full' : '',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function GhostButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md px-3 text-[14px] font-medium text-muted-foreground ${TOUCH}`}
    >
      {label}
    </button>
  );
}

export function Skeleton({ label, lines }: { label: string; lines: number }) {
  return (
    <div className="px-4 py-3" aria-busy="true">
      <p className="text-[13px] text-muted-foreground mb-2">{label}</p>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-4 rounded-sm bg-muted" />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
      {action ? (
        <div className="mt-3">
          <PrimaryButton label={action} />
        </div>
      ) : null}
    </div>
  );
}

/** Errors name the cause, what survived, and the retry -- never "check your internet". */
export function ErrorNote({ message, kept, retry }: { message: string; kept?: string; retry: string }) {
  return (
    <div className="mx-4 my-3 rounded-md border border-border bg-warning-surface px-3 py-2">
      <p className="text-[13px] font-medium text-warning-foreground">{message}</p>
      {kept ? <p className="mt-0.5 text-[12px] text-warning-foreground">{kept}</p> : null}
      <button
        type="button"
        className={`mt-1 text-[13px] font-semibold text-warning-foreground underline ${TOUCH}`}
      >
        {retry}
      </button>
    </div>
  );
}

/*
 * Mirrors the shipped tab bar in `src/components/MobileShell.tsx`.
 *
 * This harness used to draw a 20x20 grey ROUNDED SQUARE in place of every icon,
 * which made all five tabs read as identical boxes in every captured PNG. The
 * app has always rendered real lucide glyphs -- 홈=Home, 기록=BookOpen,
 * 일정=CalendarDays, 우리=Heart, 마이=User -- at 21px, with the active one
 * thickened to 2.2 stroke. A visual review against the old captures would have
 * judged a tab bar the app does not have.
 *
 * Geometry copied from the implementation: 58px + safe-area, `caption` labels,
 * active tint `text-coral-strong`.
 */
const TABS = [
  { label: '홈', Icon: Home },
  { label: '기록', Icon: BookOpen },
  { label: '일정', Icon: CalendarDays },
  { label: '우리', Icon: Heart },
  { label: '마이', Icon: User },
];

export function TabBar({ active }: { active: string }) {
  return (
    <nav className="flex shrink-0 border-t border-border bg-card" style={{ height: 58 }}>
      {TABS.map(({ label, Icon }) => {
        const on = label === active;
        return (
          <button
            key={label}
            type="button"
            aria-current={on ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-w-0 relative ${
              on ? 'text-coral-strong' : 'text-muted-foreground'
            }`}
          >
            <Icon size={21} strokeWidth={on ? 2.2 : 1.8} aria-hidden="true" />
            <span className={`text-[12px] truncate w-full text-center ${on ? 'font-semibold' : 'font-normal'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
