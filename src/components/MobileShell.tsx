import { Link, useLocation } from 'react-router-dom';
import { Home, HeartPulse, BookHeart, CalendarDays, CircleUserRound } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { routeAnnouncement } from '@/lib/routeAnnouncement';
import { InstallPromptBanner } from '@/components/InstallPromptBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SharedSyncBanner } from '@/components/SharedSyncBanner';

/**
 * 다섯 칸 — 인스타그램의 자리를 빌리되, 빌릴 것이 없는 칸은 빌리지 않는다.
 *
 *     인스타      홈    검색    만들기(+)   릴스     프로필
 *     곰신로그    홈    나      일기장      일정     우리
 *
 * 자리와 개수가 같아야 손이 기억한다. 인스타를 쓰는 사람은 왼쪽 끝이 홈이고 오른쪽 끝이
 * 자기 프로필이라는 것을 몸으로 안다. 릴스 자리에 일정이 오는 것은 성격이 맞아서다 --
 * 다른 넷은 전부 과거와 현재인데 일정만 미래이고, 인스타에서도 그 칸은 "다른 종류의
 * 것"을 보는 자리다.
 *
 * ## 검색 칸을 빌리지 않은 이유
 *
 * 한 번 빌렸다가 되돌렸다. **인스타에 검색 탭이 있는 이유는 거기에 남의 게시물이 있기
 * 때문이다.** 알고리즘이 고른 모르는 사람들의 것. 이 앱에는 남이 없으므로 탐색 격자에
 * 넣을 것이 우리 둘의 기록밖에 없고, 그것은 `우리` 탭의 하루 격자와 **같은 화면**이다.
 * 고유하게 남는 검색은 탭이 아니라 `우리` 헤더의 돋보기가 됐다(§5.3).
 *
 * ## 가운데는 왜 만들기가 아닌가
 *
 * 기록 진입점을 여기 두는 것도 한 번 짰다. 되돌린 이유는 자리의 값이 다르기 때문이다 --
 * 가운데는 엄지가 가장 쉽게 닿는 칸이고, 기록은 떠 있는 버튼으로 어느 화면에서든 한 번이면
 * 되므로 이 칸을 쓸 이유가 없다(§7.1). 그 자리는 **이 앱이 왜 기록을 쌓게 하는지에 대한
 * 답**이 가져간다: 쌓인 것이 물건이 된다(§5.2).
 *
 * `matchPrefixes` 는 섹션 안에서 움직이는 동안 탭이 꺼지지 않게 한다. 꺼지면 앱이
 * "당신은 아무 데도 없다"고 말한다. 어느 경로도 빠지지 않는다는 것은
 * `settingsRouteReachability.test.tsx` 가 라우터에서 직접 읽어 확인한다.
 */
const TABS = [
  {
    /*
      `/call` 이 여기 걸린다.

      이건 탭 재편이 만든 것이 아니라 **원래부터 어느 탭에도 없었다.** 통화 모드는 홈의
      `이야기할 것` 위젯에서 들어가는데, 들어간 순간 탭바가 전부 꺼졌다.
    */
    to: '/home',
    label: '홈',
    icon: Home,
    matchPrefixes: ['/home', '/', '/call', '/saved'],
  },
  {
    to: '/me',
    label: '나',
    icon: HeartPulse,
    matchPrefixes: ['/me', '/service'],
  },
  {
    /*
      가운데는 이 앱이 왜 기록을 쌓게 하는지에 대한 답이 가져간다: 쌓인 것이 물건이
      된다(§5.5). 한 달치가 지면으로 엮이고, 꾸미고 싶으면 꾸미고, 한 권이 된다.
    */
    to: '/diary',
    label: '일기장',
    icon: BookHeart,
    matchPrefixes: ['/diary'],
  },
  {
    to: '/schedule',
    label: '일정',
    icon: CalendarDays,
    matchPrefixes: ['/schedule', '/trips'],
  },
  {
    /*
      `우리` 가 기록을 보고 찾는 곳 전부를 갖는다.

      하루 격자와 검색(`/search`)과 원본(`/record`), 그리고 `☰` 안의 계정·설정까지.
      §7.1 의 제거 불가 작성 진입점도 여기 있다.
    */
    to: '/us',
    label: '우리',
    icon: CircleUserRound,
    matchPrefixes: ['/us', '/search', '/record', '/compose', '/my', '/settings'],
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
        className="relative w-full max-w-[430px] min-h-screen min-h-[100dvh] shadow-[0_0_60px_-30px_rgba(27,35,64,0.18)] flex flex-col pt-[env(safe-area-inset-top,0px)]"
        style={{
          background: 'var(--paper)',
          ...(tabBarHeight > 0
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
          className="notebook flex-1 pb-20 overflow-y-auto focus:outline-none"
        >
          {/* Shown above every tab, because a stale or withheld shared workspace
              affects the timeline, the calendar and the trip list alike. */}
          <SharedSyncBanner />
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
        <InstallPromptBanner />

        {/* Offline indicator – sits visually above the tab bar */}
        <OfflineBanner />

        {/*
          다섯 칸: 홈 | 찾기 | 남기기 | 일정 | 우리.

          공책을 덮는다 -- 반투명이 아니다. 괘선 위에 떠 있으면 글과 겹쳐 읽히고, 그러면
          탭바가 아니라 얼룩이 된다. 이 바만 종이를 가린다.

          `--paper` 는 아직 옮기지 않은 화면의 `--card` 와 사실상 같은 색이다(낮은 흰색,
          밤은 세 단위 차이). 그래서 이 바는 옛 화면 아래에서도 어색하지 않고, 화면을
          하나씩 옮기는 동안 바를 두 번 고칠 필요가 없다.
        */}
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
                    <Icon
                      size={23}
                      className="pen-icon"
                      color={active ? 'var(--ink)' : 'var(--ink-soft)'}
                      /*
                        인스타는 선택된 홈 아이콘을 채운다. 채움이 있는 아이콘에서만
                        의미가 있으므로 홈에만 준다 -- 달력이나 펜을 채우면 뭉개진다.
                      */
                      fill={active && t.label === '홈' ? 'var(--ink)' : 'none'}
                      aria-hidden="true"
                    />
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
