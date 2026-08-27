import { Link, useLocation } from 'react-router-dom';
import { Home, Search, BookHeart, CalendarDays } from 'lucide-react';
import { InkCircle, PenFace } from '@/components/paper';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { routeAnnouncement } from '@/lib/routeAnnouncement';
import { InstallPromptBanner } from '@/components/InstallPromptBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SharedSyncBanner } from '@/components/SharedSyncBanner';

/**
 * 하단 탭바 — 인스타그램의 5칸 그대로.
 *
 *     인스타      홈    검색    만들기(+)   릴스     프로필
 *     곰신로그    홈    찾기    남기기      일정     우리
 *
 * 자리와 개수가 같아야 손이 기억한다. 인스타를 쓰는 사람은 왼쪽 끝이 홈이고 가운데가
 * 만들기이며 오른쪽 끝이 자기 프로필이라는 것을 몸으로 안다. **그 기억을 그대로 쓰는
 * 것이 이 앱이 인스타 문법을 빌리는 이유다.**
 *
 * 릴스 자리에 일정이 오는 것은 성격이 맞아서다. 다른 넷은 전부 과거와 현재인데 -- 기록·
 * 탐색·작성·축적 -- 일정만 미래다. 인스타에서도 그 칸은 "다른 종류의 것"을 보는 자리다.
 *
 * 가운데 `+` 는 테두리가 있는 사각형이다. 인스타의 만들기 버튼도 그렇고, 무엇보다 이
 * 앱에서 **기록 진입점은 제거할 수 없는 계약**(§7.1)이라 눈에 띄어야 한다.
 *
 * ## 한 번 다른 다섯을 시도했고 되돌렸다
 *
 * `홈 · 나 · 일기장 · 일정 · 우리` 로 바꾼 적이 있다. 각 칸의 내용은 여전히 앱 안에
 * 있지만 -- `나` 는 `우리` 의 통계와 `/service` 로, `일기장` 은 `우리` 의 격자와
 * `기억 만들기` 로 -- **자리를 바꾼 대가가 너무 컸다.** 인스타를 쓰는 사람이 손으로
 * 아는 다섯 자리를 바꾸면 문법을 빌려온 이유 자체가 사라진다.
 *
 * `matchPrefixes` 는 섹션 안에서 움직이는 동안 탭이 꺼지지 않게 한다. 꺼지면 앱이
 * "당신은 아무 데도 없다"고 말한다. 어느 경로도 빠지지 않는다는 것은
 * `settingsRouteReachability.test.tsx` 가 라우터에서 직접 읽어 확인한다.
 */
const TABS = [
  {
    /*
      `/call` 과 `/saved` 가 여기 걸린다. 홈 헤더의 두 아이콘에서 들어가는 곳이므로
      들어가 있는 동안에도 홈이 켜져 있어야 한다.
    */
    to: '/home',
    label: '홈',
    icon: Home,
    matchPrefixes: ['/home', '/', '/call', '/saved'],
  },
  {
    /*
      `/record` 가 여기 걸린다. 검색 결과가 데려가는 곳이 원본이므로, 원본을 보는 동안
      켜져 있어야 하는 것은 그리로 온 문이다.
    */
    to: '/search',
    label: '찾기',
    icon: Search,
    matchPrefixes: ['/search', '/record'],
  },
  {
    /*
      가운데는 여태 남긴 기록들을 월별로 모아 읽고 꾸미는 일기장이다.
      상점(/shop)도 일기장에서 진입하므로 같은 탭에 걸린다.
    */
    to: '/diary',
    label: '일기장',
    icon: BookHeart,
    matchPrefixes: ['/diary', '/shop'],
  },
  {
    to: '/schedule',
    label: '일정',
    icon: CalendarDays,
    matchPrefixes: ['/schedule', '/trips'],
  },
  {
    /*
      인스타의 프로필 탭은 자기 아바타다. 여기서는 커플 아바타이고, `나` 와 `일기장` 이
      가졌던 것 -- 복무·주기·컨디션과 월별 지면 -- 이 이 안에 있다.
    */
    to: '/us',
    label: '우리',
    icon: null,
    matchPrefixes: ['/us', '/me', '/service', '/my', '/settings'],
  },
] as const;

export interface MobileShellProps {
  children: ReactNode;
  /**
   * Hide bottom navigation and tab-specific banners on public utility routes
   * (/support, /legal/:doc) so unauthenticated users do not see authenticated app tabs.
   */
  hideNav?: boolean;
}

export function MobileShell({ children, hideNav = false }: MobileShellProps) {
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
   * `6px + 44px + max(env(safe-area-inset-bottom,0px),8px)`, so that constant was
   * only ever correct on a device WITH a home indicator: at inset 0 the banner sat
   * 10px inside the bar. Measured in headless Chromium at 320x568 and 390x844 with
   * the browser offline, the banner overlapped `nav[role=tablist]` by 320x10px and
   * 390x10px respectively.
   *
   * Measuring instead of guessing means the next change to the bar's padding cannot
   * silently reintroduce the overlap -- and it is why the 2026-08-08 revision could
   * take the bar from 70px of chrome down to 58px (표면·컨트롤 규칙 asks for
   * 56-60px plus the inset) without touching the banner or the floating CTAs.
   */
  useEffect(() => {
    if (hideNav) {
      setTabBarHeight(0);
      return;
    }
    const nav = navRef.current;
    if (!nav) return;
    const apply = () => setTabBarHeight(nav.getBoundingClientRect().height);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [hideNav]);

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
        /*
          Astryx components read their colour, type and spacing from tokens that
          `src/styles/astryx-gomsin.css` scopes to this attribute. It sits on the
          frame rather than on <html> so the mapping travels with the phone
          surface, and so a screen rendered outside the shell cannot pick up
          component theming it has no frame for.

          OnboardingPage hand-copies this frame (it must not show a tab bar) and
          therefore carries the same attribute; the two are checked against each
          other by `src/lib/astryxFoundation.test.ts`.
        */
        data-astryx-theme="gomsin"
        className="relative h-screen h-[100dvh] w-full max-w-[430px] overflow-hidden shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]"
        style={{
          background: 'var(--paper)',
          ...(hideNav
            ? ({ '--gomsin-tabbar-height': '0px' } as CSSProperties)
            : tabBarHeight > 0
              ? ({ '--gomsin-tabbar-height': `${tabBarHeight}px` } as CSSProperties)
              : {}),
        }}
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

        {/*
          종이가 여기 깔린다 (2026-08-23).

          화면마다 `.notebook` 을 붙이면 내용이 짧은 화면에서 종이가 내용 높이에서 끝나고
          그 아래가 검게 끊긴다. 스크롤 영역 자체가 공책이면 어느 화면이든 끝까지 종이다.
        */}
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            'notebook min-h-0 flex-1 overflow-y-auto focus:outline-none',
            hideNav ? 'pb-[max(env(safe-area-inset-bottom,0px),1.5rem)]' : 'pb-20',
          )}
        >
          {/* Shown above every tab, because a stale or withheld shared workspace
              affects the timeline, the calendar and the trip list alike. */}
          {!hideNav && <SharedSyncBanner />}
          {children}
        </main>

        {/*
          떠 있던 기록 버튼은 **스토리 레일의 `+` 로 옮겨갔다** (2026-08-23).

          인스타에는 떠 있는 버튼이 없다. 만들기는 탭바 가운데이거나 자기 스토리 링에
          붙은 `+` 이고, 이 앱은 후자를 쓴다 -- 홈 맨 왼쪽 링이 내 스토리이고 거기 `+` 가
          붙는다. 산호빛 원이 종이 위에 떠 있으면 그것 하나가 이 화면에서 유일하게 앱처럼
          보이는 물건이 된다.

          §7.1 의 제거 불가 진입점은 사라지지 않았다. 홈의 레일 `+`, `우리` 헤더의 펜,
          `찾기` 의 펜이 그것을 나눠 진다 -- `composeFromAnywhere.test.tsx` 가 센다.
        */}

        {/* iOS Safari Standalone Install Banner Prompt */}
        {!hideNav && <InstallPromptBanner />}

        {/* Offline indicator – sits visually above the tab bar */}
        {!hideNav && <OfflineBanner />}

        {/*
          다섯 칸: 홈 | 찾기 | 남기기 | 일정 | 우리.

          공책을 덮는다 -- 반투명이 아니다. 괘선 위에 떠 있으면 글과 겹쳐 읽히고, 그러면
          탭바가 아니라 얼룩이 된다. 이 바만 종이를 가린다.

          `--paper` 는 아직 옮기지 않은 화면의 `--card` 와 사실상 같은 색이다(낮은 흰색,
          밤은 세 단위 차이). 그래서 이 바는 옛 화면 아래에서도 어색하지 않고, 화면을
          하나씩 옮기는 동안 바를 두 번 고칠 필요가 없다.
        */}
        {!hideNav && (
        <nav
          ref={navRef}
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50"
          style={{
            background: 'var(--paper)',
            borderTop: 'var(--stroke) solid var(--ink-faint)',
          }}
          role="tablist"
          aria-label="하단 내비게이션"
        >
          <ul className="grid grid-cols-5 px-1 pb-[max(env(safe-area-inset-bottom,0px),8px)] items-stretch">
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
                      /*
                        `press-response` 는 그대로 둔다.

                        탭바는 이 앱에서 가장 많이 눌리는 컨트롤이고, 예전에는 눌림에
                        아무 답이 없었다 -- 느린 경로에서는 손가락에서 한참 뒤에야
                        반응해 탭이 씹힌 것처럼 읽히고 다시 눌리게 된다. `:active` 는
                        포인터가 내려가는 순간 걸리므로 바가 먼저 답하고 경로는 올 때
                        온다.
                      */
                      'press-response flex items-center justify-center w-full min-h-11 py-3',
                    )}
                  >
                    {Icon ? (
                      <Icon
                        size={23}
                        className="pen-icon"
                        color={active ? 'var(--ink)' : 'var(--ink-soft)'}
                        /*
                          인스타는 선택된 홈 아이콘을 채운다. 채움이 있는 아이콘에서만
                          의미가 있으므로 홈에만 준다 -- 달력이나 사각형을 채우면 뭉개진다.
                        */
                        fill={active && t.label === '홈' ? 'var(--ink)' : 'none'}
                        aria-hidden="true"
                      />
                    ) : (
                      /* 인스타의 프로필 탭은 자기 아바타다. 여기서는 커플 아바타. */
                      <InkCircle size={26} ring={active ? 'seen' : 'none'}>
                        <PenFace size={18} />
                      </InkCircle>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        )}
      </div>
    </div>
  );
}
