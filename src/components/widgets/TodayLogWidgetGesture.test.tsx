import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';

/**
 * H-3: the file picker has to open inside the tap that asked for it.
 *
 * The old code was
 *
 *   setTimeout(() => {
 *     const input = fileInputRef.current;
 *     if (!input) return;
 *     ...
 *     input.click();
 *   }, 50);
 *
 * which moves `click()` into a later macrotask, outside the transient user
 * activation the tap created. Desktop Chrome allows a programmatic file-chooser
 * open anyway; Android WebView and WKWebView gate it on activation, so on the
 * two platforms this release targets the picker simply never appeared. The 50 ms
 * delay was not load-bearing: the `<input type="file">` renders unconditionally,
 * outside the `showInputCard` block, so the ref is already attached when the
 * handler runs.
 *
 * `if (!input) return` was the second half of the bug: a failure to open looked
 * exactly like a user who changed their mind.
 *
 * Real behaviour on device stays a DEVICE GATE (no emulator: `/dev/kvm` is
 * absent). What is testable here is that the click is synchronous with the tap
 * and that the accept/capture attributes are what each button means.
 */

const toastError = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: toastError },
}));

const isNativePlatformMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/lib/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform')>();
  return { ...actual, isNativePlatform: () => isNativePlatformMock() };
});

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
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
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['dday'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    addRecordWithMedia: vi.fn(async () => ({ ok: true, failedFiles: [] as string[] })),
  }),
}));

import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { MICROPHONE_RATIONALE } from '@/lib/nativePermissions';

function renderWidget() {
  return render(
    <MemoryRouter>
      <TodayLogWidget />
    </MemoryRouter>,
  );
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

/** `handleOpenInput`'s body with `//` comments removed. */
function handlerCode(): string {
  const source = readFileSync('src/components/widgets/TodayLogWidget.tsx', 'utf8');
  return source
    .slice(source.indexOf('const handleOpenInput'), source.indexOf('const handleFileSelect'))
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('H-3: the picker opens in the same task as the tap', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toastError.mockReset();
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('clicks the input synchronously for 지금찍기, with no timer in between', () => {
    renderWidget();
    // fireEvent dispatches synchronously and returns before any macrotask runs,
    // so a passing assertion here means no setTimeout was involved.
    fireEvent.click(screen.getByText('지금찍기'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('clicks the input synchronously for 사진 too', () => {
    renderWidget();
    fireEvent.click(screen.getByText('사진'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not open a picker for 한줄, which is a text-only path', () => {
    renderWidget();
    fireEvent.click(screen.getByText('한줄'));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('the source no longer wraps the click in a timer', () => {
    // Belt and braces: the behavioural test above would also pass if a future
    // edit reintroduced a 0 ms timer that jsdom happened to flush early. The
    // gesture requirement is about the task, so pin the code too. Comments are
    // stripped because they explain the old `setTimeout` by name.
    expect(handlerCode()).toContain('input.click();');
    expect(handlerCode()).not.toContain('setTimeout');
  });

  it('the missing-input branch reports the failure instead of returning silently', () => {
    // Not reachable from a render: React keeps the ref pointing at the element
    // even if the DOM node is detached, and the input is rendered
    // unconditionally. So this is asserted at the source level -- the point of
    // the fix is that the branch is no longer a bare `return`.
    const code = handlerCode();
    const branch = code.slice(code.indexOf('if (!input)'), code.indexOf('input.accept'));
    expect(branch).toContain('toast.error(');
    expect(branch).toContain('첨부 창을 열지 못했어요');
    expect(branch).not.toMatch(/if \(!input\) return;/);
  });

  it('PRESERVATION: the tap still reveals the composer', () => {
    renderWidget();
    fireEvent.click(screen.getByText('지금찍기'));
    expect(screen.getByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?')).toBeInTheDocument();
  });
});

describe('H-2: 지금찍기 asks for a photo, not a camcorder', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
    clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('sets capture and an image-only accept list', () => {
    renderWidget();
    fireEvent.click(screen.getByText('지금찍기'));
    const input = fileInput();
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    // With video/* also present Capacitor's file chooser prefers
    // ACTION_VIDEO_CAPTURE, so the "take a photo" button opened a camcorder.
    expect(input.accept).not.toContain('video/');
  });

  it('사진 opens the picker with no capture, offering photos only', () => {
    // §12.4 upload gate: MEDIA_ACCEPT carries no video/audio MIME until the P6
    // encrypted media foundation, so the OS picker cannot offer what the
    // classifier would refuse.
    renderWidget();
    fireEvent.click(screen.getByText('사진'));
    const input = fileInput();
    expect(input.hasAttribute('capture')).toBe(false);
    expect(input.accept).toContain('image/');
    expect(input.accept).not.toContain('video/');
    expect(input.accept).not.toContain('audio/');
  });

  it('clears capture again when switching from 지금찍기 to 사진', () => {
    renderWidget();
    fireEvent.click(screen.getByText('지금찍기'));
    expect(fileInput().getAttribute('capture')).toBe('environment');
    fireEvent.click(screen.getByText('사진'));
    expect(fileInput().hasAttribute('capture')).toBe(false);
  });
});

describe('C-2 (retired with the recorder): no microphone surface in the composer', () => {
  it('renders no microphone rationale anywhere, because nothing records', () => {
    // The voice recorder left with the §12.4 upload gate. A microphone
    // explanation with no microphone feature would itself be misleading UI.
    renderWidget();
    fireEvent.click(screen.getByText('한줄'));
    expect(screen.queryByText(MICROPHONE_RATIONALE)).toBeNull();
  });
});
