/**
 * The name of the screen a path leads to, for announcing a route change.
 *
 * A single-page app replaces the document without a page load, so a screen
 * reader is told nothing: moving between 홈 · 찾기 · 남기기 · 일정 · 우리 produced no
 * announcement at all and left focus wherever the previous screen had it. This is
 * the copy an `aria-live` region reads out, and it is a pure function so the
 * mapping can be tested without a router.
 *
 * Kept deliberately close to the tab labels in `MobileShell`, so what is
 * announced matches what is on screen. Prefix-matched for the same reason the
 * tab highlight is: `/trips/:id` is still 일정.
 *
 * 탭이 없어진 화면도 여기 남는다. `/record` 는 `찾기` 의 결과와 탭바 가운데가 데려가는
 * 곳이고 `/my` 는 `우리 → ☰` 안에 있다 -- 탭을 잃은 것이지 화면을 잃은 것이 아니므로,
 * 도착했을 때 이름이 불려야 하는 것은 그대로다.
 */
const ROUTES: { prefix: string; name: string; exact?: boolean }[] = [
  { prefix: '/', name: '홈', exact: true },
  { prefix: '/home', name: '홈' },
  { prefix: '/record', name: '기록' },
  { prefix: '/compose', name: '오늘 남기기' },
  { prefix: '/search', name: '찾기' },
  { prefix: '/me', name: '나' },
  { prefix: '/diary/garden', name: '우리 정원' },
  { prefix: '/diary', name: '일기장' },
  { prefix: '/shop', name: '상점' },
  { prefix: '/saved', name: '이야기할 것' },
  { prefix: '/schedule', name: '일정' },
  { prefix: '/trips', name: '일정' },
  { prefix: '/us', name: '우리' },
  { prefix: '/service', name: '군 복무 정보' },
  { prefix: '/my', name: '마이' },
  { prefix: '/settings', name: '설정' },
  { prefix: '/onboarding', name: '시작하기' },
  { prefix: '/legal', name: '약관 및 정책' },
  { prefix: '/support', name: '고객지원' },
  { prefix: '/auth/callback', name: '로그인 처리 중' },
];

export function routeScreenName(pathname: string): string | null {
  for (const route of ROUTES) {
    if (route.exact ? pathname === route.prefix : pathname === route.prefix
      || pathname.startsWith(`${route.prefix}/`)) {
      return route.name;
    }
  }
  return null;
}

/**
 * What the live region says, or `null` when the path is not a known screen.
 *
 * Returning `null` rather than a guess is deliberate: announcing "페이지" for an
 * unrecognised path would be noise, and a wrong screen name is worse than
 * silence.
 */
export function routeAnnouncement(pathname: string): string | null {
  const name = routeScreenName(pathname);
  return name === null ? null : `${name} 화면입니다`;
}
