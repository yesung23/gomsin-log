import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reloadCalls = vi.fn();
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
    reloadEvents: () => {
      reloadCalls();
      return Promise.resolve({ ok: true as const });
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

function openCreateModal() {
  fireEvent.click(addEventButton());
  fireEvent.change(screen.getByLabelText(/일정 제목/), { target: { value: '면회' } });
}

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('SchedulePage loading lifecycle', () => {
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

    openCreateModal();

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

    fireEvent.click(addEventButton());
    fireEvent.change(screen.getByLabelText(/일정 제목/), { target: { value: '거절되는 일정' } });
    await act(async () => {
      fireEvent.click(screen.getByText('등록하기'));
    });

    await waitFor(() => expect(addEvent).toHaveBeenCalled());
    // The list is driven by store state, which the refused write never entered.
    expect(screen.queryByText('거절되는 일정')).not.toBeInTheDocument();
    expect(toastCalls.some((call) => call.level === 'error')).toBe(true);
  });
});
