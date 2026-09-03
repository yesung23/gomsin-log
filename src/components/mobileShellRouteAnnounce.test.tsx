import { lazy, StrictMode, Suspense } from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The behavioural half of `accessibilityInvariants.test.ts`.
 *
 * That suite pins the attributes in source. This one drives the real component:
 * clicks a tab, and asserts that the live region actually says the new screen's
 * name and that focus actually lands in `<main>` instead of staying on the tab in
 * the bar at the bottom.
 *
 * Before the fix a tab change announced nothing at all, and focus stayed on the
 * tab, so the next Tab press walked backwards through the navigation rather than
 * into the content the user had just asked for. WCAG 2.1 SC 4.1.3 and SC 2.4.3.
 */

const routeAnnouncementProbe = vi.hoisted(() => ({
  returnSentinelForExcludedRoutes: false,
}));

vi.mock('@/lib/routeAnnouncement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/routeAnnouncement')>();

  return {
    ...actual,
    routeAnnouncement: (pathname: string) => (
      routeAnnouncementProbe.returnSentinelForExcludedRoutes
      && (pathname === '/call' || pathname.startsWith('/story/'))
        ? '제외 계약 검증용 화면입니다'
        : actual.routeAnnouncement(pathname)
    ),
  };
});

vi.mock('@/components/InstallPromptBanner', () => ({ InstallPromptBanner: () => null }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/SharedSyncBanner', () => ({ SharedSyncBanner: () => null }));

const [{ MobileShell }, { RouteAccessibilityManager }] = await Promise.all([
  import('@/components/MobileShell'),
  import('@/components/RouteAccessibilityManager'),
]);

function LocationDisplay() {
  const { pathname, search, hash } = useLocation();
  return <span data-testid="current-path">{pathname}{search}{hash}</span>;
}

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RouteAccessibilityManager>
        <MobileShell>
          <LocationDisplay />
          <p>본문</p>
        </MobileShell>
      </RouteAccessibilityManager>
    </MemoryRouter>,
  );
}

function HomeRoute() {
  const navigate = useNavigate();

  return (
    <MobileShell>
      <h1>홈</h1>
      <LocationDisplay />
      <button type="button" onClick={() => navigate('/home?filter=mine#today')}>
        같은 화면 상태 변경
      </button>
      <button type="button" onClick={() => navigate('/')}>온보딩으로 이동</button>
      <button type="button" onClick={() => navigate('/support')}>고객지원으로 이동</button>
      <button type="button" onClick={() => navigate('/story/partner')}>스토리로 이동</button>
      <button type="button" onClick={() => navigate('/call')}>통화로 이동</button>
    </MobileShell>
  );
}

function SearchRoute() {
  const navigate = useNavigate();

  return (
    <MobileShell>
      <h1>찾기</h1>
      <button type="button" onClick={() => navigate(-1)}>뒤로</button>
      <button type="button" onClick={() => navigate('/schedule')}>일정으로 이동</button>
    </MobileShell>
  );
}

function ScheduleRoute() {
  const navigate = useNavigate();

  return (
    <MobileShell>
      <h1>일정</h1>
      <button type="button" onClick={() => navigate('/trips/abc-123')}>여행 상세</button>
    </MobileShell>
  );
}

function TripRoute() {
  return (
    <MobileShell>
      <h1>여행 상세</h1>
    </MobileShell>
  );
}

function SupportRoute() {
  return (
    <MobileShell hideNav>
      <h1>고객지원</h1>
    </MobileShell>
  );
}

function StoryOwnedRoute() {
  return (
    <MobileShell hideNav>
      <h1>스토리 자체 화면</h1>
    </MobileShell>
  );
}

function CallOwnedRoute() {
  return (
    <MobileShell hideNav>
      <h1>통화 자체 화면</h1>
    </MobileShell>
  );
}

function SetupIncompleteRoute() {
  return (
    <main tabIndex={-1}>
      <h1>시작하기</h1>
    </main>
  );
}

function renderSeparateShellRoutes(
  initialEntries: string[] = ['/home'],
  initialIndex = initialEntries.length - 1,
  strict = false,
) {
  const app = (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <RouteAccessibilityManager>
        <Routes>
          <Route path="/home" element={<HomeRoute />} />
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/schedule" element={<ScheduleRoute />} />
          <Route path="/trips/:id" element={<TripRoute />} />
          <Route path="/support" element={<SupportRoute />} />
          <Route path="/story/partner" element={<StoryOwnedRoute />} />
          <Route path="/call" element={<CallOwnedRoute />} />
          <Route path="/" element={<SetupIncompleteRoute />} />
        </Routes>
      </RouteAccessibilityManager>
    </MemoryRouter>
  );

  return render(strict ? <StrictMode>{app}</StrictMode> : app);
}

describe('MobileShell announces the screen and moves focus on navigation', () => {
  it('announces forward navigation when each route mounts its own MobileShell', async () => {
    const user = userEvent.setup();
    renderSeparateShellRoutes();
    const liveRegion = screen.getByRole('status');

    expect(screen.getAllByRole('status')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: '찾기' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('찾기 화면입니다');
    });
    expect(screen.getByRole('status')).toBe(liveRegion);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('focuses and scrolls only the new main with auto behavior even under reduced motion', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    try {
      renderSeparateShellRoutes();
      const homeMain = screen.getByRole('heading', { name: '홈' }).closest('main');
      expect(homeMain).not.toBeNull();
      const homeFocus = vi.spyOn(homeMain!, 'focus');

      fireEvent.click(screen.getByRole('tab', { name: '찾기' }));

      const searchMain = screen.getByRole('heading', { name: '찾기' }).closest('main');
      expect(searchMain).not.toBeNull();
      const searchFocus = vi.spyOn(searchMain!, 'focus');
      const searchScroll = vi.fn();
      Object.defineProperty(searchMain, 'scrollTo', {
        configurable: true,
        value: searchScroll,
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(homeMain?.isConnected).toBe(false);
      expect(homeFocus).not.toHaveBeenCalled();
      expect(searchFocus).toHaveBeenCalledTimes(1);
      expect(searchFocus).toHaveBeenCalledWith({ preventScroll: true });
      expect(searchScroll).toHaveBeenCalledTimes(1);
      expect(searchScroll).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(document.activeElement).toBe(searchMain);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('announces and focuses the newly mounted main on browser POP/back', async () => {
    const user = userEvent.setup();
    renderSeparateShellRoutes(['/home', '/search']);

    expect(screen.getByRole('status').textContent).toBe('');
    await user.click(screen.getByRole('button', { name: '뒤로' }));

    const homeMain = screen.getByRole('heading', { name: '홈' }).closest('main');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('홈 화면입니다');
      expect(document.activeElement).toBe(homeMain);
    });
  });

  it('keeps a StrictMode direct load silent without focus or scroll', async () => {
    vi.useFakeTimers();
    try {
      renderSeparateShellRoutes(['/home'], 0, true);
      const main = screen.getByRole('heading', { name: '홈' }).closest('main');
      expect(main).not.toBeNull();
      const focus = vi.spyOn(main!, 'focus');
      const scroll = vi.fn();
      Object.defineProperty(main, 'scrollTo', { configurable: true, value: scroll });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByRole('status').textContent).toBe('');
      expect(focus).not.toHaveBeenCalled();
      expect(scroll).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(main);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores query and hash changes when the pathname stays the same', async () => {
    vi.useFakeTimers();
    try {
      renderSeparateShellRoutes();
      const main = screen.getByRole('heading', { name: '홈' }).closest('main');
      expect(main).not.toBeNull();
      const focus = vi.spyOn(main!, 'focus');
      const scroll = vi.fn();
      Object.defineProperty(main, 'scrollTo', { configurable: true, value: scroll });

      fireEvent.click(screen.getByRole('button', { name: '같은 화면 상태 변경' }));
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByTestId('current-path')).toHaveTextContent('/home?filter=mine#today');
      expect(screen.getByRole('status').textContent).toBe('');
      expect(focus).not.toHaveBeenCalled();
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the persistent live region for distinct paths with the same text', async () => {
    vi.useFakeTimers();
    try {
      renderSeparateShellRoutes();
      const liveRegion = screen.getByRole('status');
      const observedText: string[] = [];
      const observer = new MutationObserver(() => {
        observedText.push(liveRegion.textContent ?? '');
      });
      observer.observe(liveRegion, { childList: true, characterData: true, subtree: true });

      fireEvent.click(screen.getByRole('tab', { name: '일정' }));
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      expect(liveRegion.textContent).toBe('일정 화면입니다');

      fireEvent.click(screen.getByRole('button', { name: '여행 상세' }));
      expect(liveRegion.textContent).toBe('');
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(liveRegion.textContent).toBe('일정 화면입니다');
      expect(observedText.filter((text) => text === '일정 화면입니다')).toHaveLength(2);
      expect(observedText).toContain('');
      observer.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits through Suspense until the destination main is mounted and registered', async () => {
    vi.useFakeTimers();
    try {
      let resolveSearchRoute!: (module: { default: typeof SearchRoute }) => void;
      const searchRouteModule = new Promise<{ default: typeof SearchRoute }>((resolve) => {
        resolveSearchRoute = resolve;
      });
      const LazySearchRoute = lazy(() => searchRouteModule);

      render(
        <MemoryRouter initialEntries={['/home']}>
          <RouteAccessibilityManager>
            <Suspense fallback={<p>찾기 불러오는 중</p>}>
              <Routes>
                <Route path="/home" element={<HomeRoute />} />
                <Route path="/search" element={<LazySearchRoute />} />
              </Routes>
            </Suspense>
          </RouteAccessibilityManager>
        </MemoryRouter>,
      );

      const oldMain = screen.getByRole('heading', { name: '홈' }).closest('main');
      expect(oldMain).not.toBeNull();
      const oldFocus = vi.spyOn(oldMain!, 'focus');

      fireEvent.click(screen.getByRole('tab', { name: '찾기' }));
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByRole('status').textContent).toBe('');
      expect(oldFocus).not.toHaveBeenCalled();

      await act(async () => {
        resolveSearchRoute({ default: SearchRoute });
        await searchRouteModule;
      });

      const searchMain = screen.getByRole('heading', { name: '찾기' }).closest('main');
      expect(searchMain).not.toBeNull();
      const searchFocus = vi.spyOn(searchMain!, 'focus');
      const searchScroll = vi.fn();
      Object.defineProperty(searchMain, 'scrollTo', {
        configurable: true,
        value: searchScroll,
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(searchFocus).toHaveBeenCalledTimes(1);
      expect(searchScroll).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
      expect(screen.getByRole('status')).toHaveTextContent('찾기 화면입니다');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a stale registered target so rapid navigation acts only on the final route', async () => {
    vi.useFakeTimers();
    try {
      renderSeparateShellRoutes();

      fireEvent.click(screen.getByRole('tab', { name: '찾기' }));
      const searchMain = screen.getByRole('heading', { name: '찾기' }).closest('main');
      expect(searchMain).not.toBeNull();
      const searchFocus = vi.spyOn(searchMain!, 'focus');
      const searchScroll = vi.fn();
      Object.defineProperty(searchMain, 'scrollTo', {
        configurable: true,
        value: searchScroll,
      });

      fireEvent.click(screen.getByRole('button', { name: '일정으로 이동' }));
      const scheduleMain = screen.getByRole('heading', { name: '일정' }).closest('main');
      expect(scheduleMain).not.toBeNull();
      const scheduleFocus = vi.spyOn(scheduleMain!, 'focus');
      const scheduleScroll = vi.fn();
      Object.defineProperty(scheduleMain, 'scrollTo', {
        configurable: true,
        value: scheduleScroll,
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(searchFocus).not.toHaveBeenCalled();
      expect(searchScroll).not.toHaveBeenCalled();
      expect(scheduleFocus).toHaveBeenCalledTimes(1);
      expect(scheduleScroll).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent('일정 화면입니다');
      expect(document.activeElement).toBe(scheduleMain);
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the MobileShell-based support route', async () => {
    const user = userEvent.setup();
    renderSeparateShellRoutes();

    await user.click(screen.getByRole('button', { name: '고객지원으로 이동' }));

    const supportMain = screen.getByRole('heading', { name: '고객지원' }).closest('main');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('고객지원 화면입니다');
      expect(document.activeElement).toBe(supportMain);
    });
  });

  it('does not call setup-incomplete pathname / home when no MobileShell main registers', async () => {
    vi.useFakeTimers();
    try {
      renderSeparateShellRoutes();
      fireEvent.click(screen.getByRole('button', { name: '온보딩으로 이동' }));

      const onboardingMain = screen.getByRole('heading', { name: '시작하기' }).closest('main');
      expect(onboardingMain).not.toBeNull();
      const focus = vi.spyOn(onboardingMain!, 'focus');
      const scroll = vi.fn();
      Object.defineProperty(onboardingMain, 'scrollTo', {
        configurable: true,
        value: scroll,
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByRole('status').textContent).toBe('');
      expect(focus).not.toHaveBeenCalled();
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['스토리로 이동', '스토리 자체 화면'],
    ['통화로 이동', '통화 자체 화면'],
  ])('leaves the %s destination to its own accessibility owner', async (buttonName, heading) => {
    vi.useFakeTimers();
    routeAnnouncementProbe.returnSentinelForExcludedRoutes = true;
    try {
      renderSeparateShellRoutes();
      fireEvent.click(screen.getByRole('button', { name: buttonName }));

      const ownedMain = screen.getByRole('heading', { name: heading }).closest('main');
      expect(ownedMain).not.toBeNull();
      const focus = vi.spyOn(ownedMain!, 'focus');
      const scroll = vi.fn();
      Object.defineProperty(ownedMain, 'scrollTo', {
        configurable: true,
        value: scroll,
      });

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(screen.getByRole('status').textContent).toBe('');
      expect(focus).not.toHaveBeenCalled();
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      routeAnnouncementProbe.returnSentinelForExcludedRoutes = false;
      vi.useRealTimers();
    }
  });

  it('says nothing on the first render, which is not a navigation', () => {
    renderShell('/home');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces the new screen after a tab change', async () => {
    const user = userEvent.setup();
    renderShell('/home');

    await user.click(screen.getByRole('tab', { name: '찾기' }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('찾기 화면입니다');
    });
  });

  it('가운데 일기장 탭을 클릭하면 /diary 경로로 이동하고 탭이 활성화된다', async () => {
    const user = userEvent.setup();
    renderShell('/home');

    const diaryTab = screen.getByRole('tab', { name: '일기장' });
    expect(diaryTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('current-path').textContent).toBe('/home');

    await user.click(diaryTab);

    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe('/diary');
      expect(diaryTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('status').textContent).toBe('일기장 화면입니다');
    });
  });

  it('moves focus into main, off the tab that was clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderShell('/home');

    const tab = screen.getByRole('tab', { name: '일정' });
    await user.click(tab);

    const main = container.querySelector('#main-content');
    await waitFor(() => {
      expect(document.activeElement).toBe(main);
    });
    expect(document.activeElement).not.toBe(tab);
  });

  it('offers the skip link as the first focusable element, pointing at main', async () => {
    const user = userEvent.setup();
    const { container } = renderShell('/home');

    await user.tab();

    const skip = screen.getByRole('link', { name: '본문으로 건너뛰기' });
    expect(document.activeElement).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(container.querySelector('#main-content')).not.toBeNull();
  });

  it('다섯 칸이 전부 접근성 이름을 갖는다', () => {
    /*
      2026-08-22 개정으로 탭바에서 눈으로 읽는 글자가 사라졌다 -- 인스타의 근육 기억을
      빌리기 위해서다. 그 순간 `aria-label` 은 보조 표시가 아니라 **유일한 이름**이 됐고,
      하나라도 빠지면 그 칸은 스크린리더에게 목적지 없는 링크가 된다.

      소스 문자열이 아니라 렌더해서 센다. `label:` 이 테이블에 있다는 사실은 그것이 실제로
      `aria-label` 로 나갔다는 뜻이 아니다.
    */
    renderShell('/home');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.getAttribute('aria-label')))
      .toEqual(['홈', '찾기', '일기장', '일정', '우리']);
  });

  it('PRESERVATION: the tab bar still lights the section it is in', () => {
    renderShell('/trips/abc');
    // `/trips/:id` is inside 일정, and the highlight must survive a detail screen.
    expect(screen.getByRole('tab', { name: '일정' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '홈' })).toHaveAttribute('aria-selected', 'false');
  });

  it('PRESERVATION: children still render inside main', () => {
    const { container } = renderShell('/home');
    expect(container.querySelector('#main-content')?.textContent).toContain('본문');
  });

  it('keeps the app frame fixed while main owns vertical scrolling', () => {
    const { container } = renderShell('/home');
    const main = container.querySelector('#main-content');
    const frame = main?.parentElement;

    expect(frame?.className).toContain('h-[100dvh]');
    expect(frame?.className).toContain('overflow-hidden');
    expect(main?.className).toContain('min-h-0');
    expect(main?.className).toContain('overflow-y-auto');
  });
});
