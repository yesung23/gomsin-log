import { Link, useLocation } from 'react-router-dom';
import { Home, BookOpen, CalendarDays, Heart, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InstallPromptBanner } from '@/components/InstallPromptBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SharedSyncBanner } from '@/components/SharedSyncBanner';

/**
 * Five tabs: 홈 · 기록 · 일정 · 우리 · 마이.
 *
 * 일정 was added because the planning surface was the least reachable part of the
 * app and the most asked-for. Before this, `/schedule` and `/trips` had NO tab at
 * all: the only ways in were a widget the user is free to delete and two buttons
 * on `/us`. That also meant standing on `/trips` highlighted no tab, so the app
 * silently told you that you were nowhere.
 *
 * `matchPrefixes` exists for the same reason: `/trips/:id` and `/schedule` are both
 * "일정", so the tab stays lit while you move around inside the section instead of
 * going dark on a detail screen.
 */
const TABS = [
  {
    to: '/home',
    label: '홈',
    icon: Home,
    matchPrefixes: ['/home', '/'],
  },
  {
    to: '/record',
    label: '기록',
    icon: BookOpen,
    matchPrefixes: ['/record'],
  },
  {
    to: '/schedule',
    label: '일정',
    icon: CalendarDays,
    matchPrefixes: ['/schedule', '/trips'],
  },
  {
    to: '/us',
    label: '우리',
    icon: Heart,
    matchPrefixes: ['/us', '/service'],
  },
  {
    to: '/my',
    label: '마이',
    icon: User,
    matchPrefixes: ['/my', '/settings'],
  },
] as const;

export function MobileShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-muted">
      <div className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]">
        <main className="flex-1 pb-24 overflow-y-auto">
          {/* Shown above every tab, because a stale or withheld shared workspace
              affects the timeline, the calendar and the trip list alike. */}
          <SharedSyncBanner />
          {children}
        </main>

        {/* iOS Safari Standalone Install Banner Prompt */}
        <InstallPromptBanner />

        {/* Offline indicator – sits visually above the tab bar */}
        <OfflineBanner />

        {/* Fixed 5-Tab Navigation Bar (홈 | 기록 | 일정 | 우리 | 마이) */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-card/95 backdrop-blur-md border-t border-border/60 z-50 shadow-lg"
          role="tablist"
          aria-label="하단 내비게이션"
        >
          <ul className="grid grid-cols-5 px-1 pt-2 pb-[max(env(safe-area-inset-bottom,0px),10px)] items-end">
            {TABS.map((t) => {
              // Prefix matching, so a detail screen inside a section keeps its tab
              // lit. `/` is matched exactly: as a prefix it would light every tab.
              const active = t.matchPrefixes.some((prefix) =>
                prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`),
              );
              const Icon = t.icon;

              return (
                <li key={t.to} className="flex justify-center">
                  <Link
                    to={t.to}
                    role="tab"
                    aria-selected={active}
                    aria-label={t.label}
                    className={cn(
                      'flex flex-col items-center py-1 text-center transition-all duration-200 min-h-[48px] justify-center relative w-full rounded-2xl',
                      active
                        ? 'text-coral'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <div className="relative flex items-center justify-center">
                      <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                    </div>

                    <span className={cn('text-[11px] mt-1', active ? 'font-extrabold text-coral' : 'font-medium')}>
                      {t.label}
                    </span>

                    {/* Bottom Active Indicator Line */}
                    {active && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full bg-coral" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
