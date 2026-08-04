import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reloadCalls = vi.fn();
/** Result the mocked `reloadEvents` returns; a test can flip it mid-run. */
let reloadResult: { ok: true } | { ok: false; reason: 'forbidden' | 'error' } = { ok: true };
let sharedSyncStatus: 'live' | 'delayed' | 'unavailable' = 'live';
const addEvent = vi.fn();
const deleteEvent = vi.fn();
const toastCalls: { level: string; message: string }[] = [];

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastCalls.push({ level: 'success', message }); },
    error: (message: string) => { toastCalls.push({ level: 'error', message }); },
    warning: (message: string) => { toastCalls.push({ level: 'warning', message }); },
  },
}));

const state = {
  authenticatedUser: { id: 'user-a', provider: 'google' as const },
  profile: {
    myName: '춘향',
    role: 'gomsin' as const,
    couple: {
      coupleId: 'couple-a',
      partnerName: '몽룡',
      anniversaryDate: '2025-01-01',
      coupleCode: '',
      connected: true,
      status: 'active' as const,
    },
    military: {},
    contact: {},
  },
  events: [],
  records: [],
  trips: [],
  setupComplete: true,
  onboardingStep: 0,
  isDemoMode: false,
  widgetLayout: [],
  hasSeenInstallPrompt: false,
  theme: 'light' as const,
};

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state,
    addEvent,
    updateEvent: vi.fn(),
    deleteEvent,
    // Deliberately return a new function on every render, matching the current
    // inline StoreProvider action identity.
    sharedSyncStatus,
    reloadEvents: () => {
      reloadCalls();
      return Promise.resolve(reloadResult);
    },
  }),
}));

const { SchedulePage } = await import('@/pages/SchedulePage');

/** The 일정 추가 label is a <span> inside the button, so resolve the button itself. */
function addEventButton(): HTMLButtonElement {
  const span = screen.getByText('일정 추가');
  const button = span.closest('button');
  if (!button) throw new Error('일정 추가 button not found');
  return button as HTMLButtonElement;
}

async function openCreateModal() {
  // The entry point is disabled until the first load settles.
  await waitFor(() => expect(addEventButton()).toBeEnabled());
  fireEvent.click(addEventButton());
  const title = await screen.findByLabelText(/일정 제목/);
  fireEvent.change(title, { target: { value: '면회' } });
}

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('SchedulePage loading lifecycle', () => {
  beforeEach(() => {
    reloadResult = { ok: true };
    sharedSyncStatus = 'live';
  });

  it('loads once per identity/workspace instead of looping on action identity changes', async () => {
    reloadCalls.mockClear();
    setOnLine(true);
    render(<SchedulePage />);

    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });
});

describe('SchedulePage offline read-only mode', () => {
  beforeEach(() => {
    reloadResult = { ok: true };
    sharedSyncStatus = 'live';
    reloadCalls.mockClear();
    addEvent.mockReset().mockResolvedValue(true);
    deleteEvent.mockReset().mockResolvedValue(true);
    toastCalls.length = 0;
    setOnLine(true);
  });

  it('disables the create entry point while offline', async () => {
    render(<SchedulePage />);
    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();

    expect(addEventButton()).toBeEnabled();

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(addEventButton()).toBeDisabled();
  });

  it('re-enables the create entry point when the connection returns', async () => {
    setOnLine(false);
    render(<SchedulePage />);
    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();
    expect(addEventButton()).toBeDisabled();

    await act(async () => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(addEventButton()).toBeEnabled();
  });

  it('issues no server write for a save attempted while offline', async () => {
    render(<SchedulePage />);
    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();

    await openCreateModal();

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    const submit = screen.getByText('등록하기');
    expect(submit).toBeDisabled();
    fireEvent.click(submit);

    expect(addEvent).not.toHaveBeenCalled();
    expect(toastCalls.some((call) => call.message.includes('인터넷 연결을 확인'))).toBe(false);
  });
});

describe('SchedulePage write integrity', () => {
  beforeEach(() => {
    reloadResult = { ok: true };
    sharedSyncStatus = 'live';
    reloadCalls.mockClear();
    addEvent.mockReset().mockResolvedValue(true);
    deleteEvent.mockReset().mockResolvedValue(true);
    toastCalls.length = 0;
    setOnLine(true);
  });

  it('does not add the event locally when the server refuses the write', async () => {
    addEvent.mockResolvedValue(false);
    render(<SchedulePage />);
    expect(await screen.findByText('공유·개인 일정')).toBeInTheDocument();

    // FLAKE FIX. This used to click as soon as the header existed, but the header
    // renders immediately while the 일정 추가 button stays
    // `disabled={... || loadState !== 'ready' || ...}` until the first events load
    // settles. Usually that microtask won landing before the click; roughly 1 run
    // in 6 it did not, and the modal never opened -- surfacing as the misleading
    // "Unable to find a label with the text of: /일정 제목/".
    //
    // Synchronise on the condition that actually gates the click, exactly as
    // `openCreateModal()` above already does. The assertions below are unchanged.
    await waitFor(() => expect(addEventButton()).toBeEnabled());
    fireEvent.click(addEventButton());
    fireEvent.change(await screen.findByLabelText(/일정 제목/), { target: { value: '거절되는 일정' } });
    await act(async () => {
      fireEvent.click(screen.getByText('등록하기'));
    });

    await waitFor(() => expect(addEvent).toHaveBeenCalled());
    // The list is driven by store state, which the refused write never entered.
    expect(screen.queryByText('거절되는 일정')).not.toBeInTheDocument();
    expect(toastCalls.some((call) => call.level === 'error')).toBe(true);
  });
});

describe('SchedulePage transient quarantine recovery', () => {
  beforeEach(() => {
    reloadCalls.mockClear();
    reloadResult = { ok: true };
    sharedSyncStatus = 'live';
    setOnLine(true);
  });

  it('re-reads once the shared workspace becomes authoritative again', async () => {
    // The store reports `forbidden` while the workspace is quarantined, which is a
    // transient transport state -- not a permissions verdict. A blocked realtime
    // socket used to leave "일정을 볼 권한이 없어요" on screen forever.
    reloadResult = { ok: false, reason: 'forbidden' };
    sharedSyncStatus = 'unavailable';
    const view = render(<SchedulePage />);

    expect(await screen.findByText('일정을 볼 권한이 없어요')).toBeInTheDocument();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));

    // HTTP reconciliation succeeded: the workspace is trustworthy again.
    reloadResult = { ok: true };
    sharedSyncStatus = 'delayed';
    view.rerender(<SchedulePage />);

    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('일정을 볼 권한이 없어요')).not.toBeInTheDocument(),
    );
  });

  it('does not re-read while the workspace stays unavailable', async () => {
    reloadResult = { ok: false, reason: 'forbidden' };
    sharedSyncStatus = 'unavailable';
    const view = render(<SchedulePage />);

    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));
    view.rerender(<SchedulePage />);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });

  it('does not re-read a healthy workspace on a transport flap', async () => {
    sharedSyncStatus = 'live';
    const view = render(<SchedulePage />);
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));

    sharedSyncStatus = 'delayed';
    view.rerender(<SchedulePage />);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    // live -> delayed is not a recovery from quarantine, so nothing is re-read.
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });
});
