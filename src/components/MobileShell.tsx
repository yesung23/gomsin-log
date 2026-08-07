import { Link, useLocation } from 'react-router-dom';
import { Home, BookOpen, CalendarDays, Heart, User } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { routeAnnouncement } from '@/lib/routeAnnouncement';
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
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The measured height of the tab bar, published to the bottom-pinned layers. */
  const [tabBarHeight, setTabBarHeight] = useState(0);
  /** The first render is not a navigation, so it must not steal focus. */
  const isFirstRender = useRef(true);

  /**
   * Publish the tab bar's real height as `--gomsin-tabbar-height`.
   *
   * The offline banner used to clear the bar with a hardcoded
   * `calc(env(safe-area-inset-bottom,0px)+60px)`. The bar's height is
   * `8px + 48px + max(env(safe-area-inset-bottom,0px),10px)`, so that constant was
   * only ever correct on a device WITH a home indicator: at inset 0 the banner sat
   * 10px inside the bar. Measured in headless Chromium at 320x568 and 390x844 with
   * the browser offline, the banner overlapped `nav[role=tablist]` by 320x10px and
   * 390x10px respectively.
   *
   * Measuring instead of guessing means the next change to the bar's padding cannot
   * silently reintroduce the overlap.
   */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const apply = () => setTabBarHeight(nav.getBoundingClientRect().height);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  /**
   * Tell a screen reader the screen changed, and put focus at the top of it.
   *
   * Without this, moving between tabs announced nothing and left focus wherever
   * the previous screen had it -- usually on a tab in the bar at the bottom, so
   * the next Tab press walked backwards through the navigation instead of into
   * the content the user just asked for. WCAG 2.1 SC 4.1.3 and SC 2.4.3.
   *
   * The announcement is re-armed through an empty string first: navigating
   * `/trips` -> `/trips/1` yields the same text, and an `aria-live` region whose
   * content does not change is not re-read.
   */
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const message = routeAnnouncement(pathname);
    setAnnouncement('');
    if (message) {
      const armed = window.setTimeout(() => setAnnouncement(message), 50);
      mainRef.current?.focus();
      mainRef.current?.scrollTo?.({ top: 0 });
      return () => window.clearTimeout(armed);
    }
    mainRef.current?.focus();
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center bg-muted">
      <div
        className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] bg-background shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]"
        style={
          tabBarHeight > 0
            ? ({ '--gomsin-tabbar-height': `${tabBarHeight}px` } as CSSProperties)
            : undefined
        }
      >
        {/*
          First focusable element on every screen. The tab bar is the LAST thing
          in the DOM, so without this a keyboard user had no way past the content
          to the navigation except tabbing through all of it.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[70] focus:top-2 focus:left-2 focus:px-4 focus:py-3 focus:rounded-2xl focus:bg-card focus:text-foreground focus:border focus:border-coral focus:font-bold focus:shadow-lg"
        >
          본문으로 건너뛰기
        </a>

        {/* Route changes are announced here. Visually hidden, never empty of purpose. */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 pb-24 overflow-y-auto focus:outline-none"
        >
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
          ref={navRef}
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
