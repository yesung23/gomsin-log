import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { AppState } from '@/types';

/**
 * M-7: the install banner must not appear inside the installed native app.
 *
 * `InstallPromptBanner` decided entirely from web signals -- a UA sniff for
 * iOS/Android, a `beforeinstallprompt` listener, and a `display-mode: standalone`
 * check -- and never consulted `isNativePlatform()`. Inside the Capacitor WebView
 * every one of those signals points the wrong way:
 *
 *   - `androidScheme: 'https'` means `display-mode` is NOT standalone, so the
 *     early return never fires;
 *   - `beforeinstallprompt` is a Chrome-for-web event and never arrives;
 *   - the UA still contains "Android" (or iPhone), so the platform branch matches.
 *
 * The result was an "install this app" card rendered on top of the already
 * installed app, telling the user to open Chrome's ⋮ menu or Safari's share
 * sheet. It is rendered unconditionally from `MobileShell`, so it reached every
 * tab. `main.tsx` already gates the service worker on `isNativePlatform()`.
 */

const mockIsNativePlatform = vi.hoisted(() => vi.fn());

vi.mock('@/lib/platform', () => ({
  isNativePlatform: mockIsNativePlatform,
  authRedirectUrl: () => 'https://example.test/auth/callback',
  NATIVE_URL_SCHEME: 'gomsinlog',
}));

const setHasSeenInstallPrompt = vi.fn();

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
    authenticatedUser: { id: 'u1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'u1',
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'c1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    // One record + setupComplete + not-yet-seen is exactly the arming condition.
    records: [
      {
        id: 'r1',
        date: '2026-03-01',
        time: '10:00',
        authorRole: 'gomsin',
        log: '기록',
        attachments: [],
        isPrivate: false,
        emotionFlow: [],
        userId: 'u1',
      },
    ],
    events: [],
    trips: [],
    widgetLayout: ['dday'],
    hasSeenInstallPrompt: false,
    theme: 'light',
    ...overrides,
  } as AppState;
}

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    setHasSeenInstallPrompt,
  }),
}));

import { InstallPromptBanner } from '@/components/InstallPromptBanner';

/** The UA the Capacitor Android WebView reports. */
const ANDROID_WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

/**
 * Reproduce the Capacitor WebView environment: NOT standalone (androidScheme is
 * https) and no `beforeinstallprompt`.
 */
function setNotStandalone() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

async function renderBanner() {
  // Mount first so the effects (and their timer) are registered, THEN advance.
  // Advancing inside the mounting `act` would run before effects flush.
  const { container } = render(<InstallPromptBanner />);
  await act(async () => {
    // The banner arms itself behind a 2s timer.
    await vi.advanceTimersByTimeAsync(2500);
  });
  return container;
}

describe('M-7: InstallPromptBanner is web-only', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    currentState = state();
    setHasSeenInstallPrompt.mockReset();
    mockIsNativePlatform.mockReset();
    setNotStandalone();
  });

  it('renders nothing inside the native Android shell', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    setUserAgent(ANDROID_WEBVIEW_UA);
    const container = await renderBanner();
    expect(container.firstChild).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing inside the native iOS shell', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    setUserAgent(IOS_UA);
    const container = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('never shows the install copy or the store instructions natively', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    setUserAgent(ANDROID_WEBVIEW_UA);
    const container = await renderBanner();
    expect(container.textContent).not.toContain('곰신로그를 앱으로 설치해보세요');
    expect(container.textContent).not.toContain('홈 화면에 추가');
    expect(container.textContent).not.toContain('앱 설치');
  });

  it('does not even consume the one-shot dismissal flag natively', async () => {
    // Otherwise the native build would silently burn a web user's prompt.
    mockIsNativePlatform.mockReturnValue(true);
    setUserAgent(ANDROID_WEBVIEW_UA);
    await renderBanner();
    expect(setHasSeenInstallPrompt).not.toHaveBeenCalled();
  });

  it('ignores beforeinstallprompt natively, so nothing can arm it later', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    setUserAgent(ANDROID_WEBVIEW_UA);
    const container = await renderBanner();
    await act(async () => {
      window.dispatchEvent(new Event('beforeinstallprompt'));
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(container.firstChild).toBeNull();
  });

  it('PRESERVATION: the iOS web banner still appears with its share-sheet steps', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    setUserAgent(IOS_UA);
    const container = await renderBanner();
    expect(container.textContent).toContain('곰신로그를 앱으로 설치해보세요');
    expect(container.textContent).toContain('홈 화면에 추가');
  });

  it('PRESERVATION: the Android web banner still appears', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    setUserAgent(ANDROID_WEBVIEW_UA);
    const container = await renderBanner();
    expect(container.textContent).toContain('곰신로그를 앱으로 설치해보세요');
  });

  it('PRESERVATION: on web it still respects the already-dismissed flag', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    setUserAgent(IOS_UA);
    currentState = state({ hasSeenInstallPrompt: true });
    const container = await renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('PRESERVATION: on web it still stays hidden before the first record', async () => {
    mockIsNativePlatform.mockReturnValue(false);
    setUserAgent(IOS_UA);
    currentState = state({ records: [] });
    const container = await renderBanner();
    expect(container.firstChild).toBeNull();
  });
});

describe('M-7: the guard is wired to the shared platform helper', () => {
  it('imports isNativePlatform rather than re-sniffing Capacitor', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/InstallPromptBanner.tsx'),
      'utf8',
    );
    expect(source).toContain("import { isNativePlatform } from '@/lib/platform';");
    expect(source).toContain('isNativePlatform()');
  });
});
