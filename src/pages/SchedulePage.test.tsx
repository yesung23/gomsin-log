import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/**
 * `일정 추가` 는 글자가 없는 펜 아이콘이다 (2026-08-23).
 *
 * V4가 채운 알약을 걷어내고 달 헤더 오른쪽의 `+` 로 옮겼다 -- 프리뷰가 그렇고, 종이 위에서
 * 채운 알약은 그 화면에서 유일하게 앱처럼 보이는 물건이 된다. 그래서 글자로 찾을 수 없고
 * **접근성 이름**으로 찾는다. 글자가 없어진 뒤에는 그것이 이 컨트롤의 유일한 이름이므로,
 * 이 쿼리가 실패한다는 것은 스크린리더도 이 버튼을 못 찾는다는 뜻이다.
 */
function addEventButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '일정 추가' }) as HTMLButtonElement;
}

/**
 * `일정 추가` 는 폼이 아니라 **날짜 고르기**를 연다 (2026-08-22).
 *
 * 예전에는 화면에 선택돼 있던 하루로 폼이 바로 열렸다. 휴가 3박 4일을 넣으려면 폼 안에서
 * 종료일을 따로 입력해야 했고, 달력을 보면서 고를 수 있는데도 날짜를 타이핑하게 만드는
 * 순서였다. 이제 달력에서 고르고 `다음` 을 눌러야 폼이 온다.
 */
async function pickDay() {
  await waitFor(() => expect(addEventButton()).toBeEnabled());
  fireEvent.click(addEventButton());
  /*
    날짜를 박지 않는다. 이 스위트에는 고정 시계가 없어서 달력이 **실행하는 날의 달**을
    그리고, 하드코딩한 날짜는 그 달이 지나면 조용히 사라진다. 고르는 동안 날짜 칸의
    접근성 이름은 `YYYY-MM-DD` 뿐이므로 그중 첫 칸을 집는다.
  */
  const days = await screen.findAllByRole('button', { name: /^\d{4}-\d{2}-\d{2}(, 선택됨)?$/ });
  fireEvent.click(days[0]);
  fireEvent.click(screen.getByText('다음'));
}

async function openCreateModal() {
  await pickDay();
  const title = await screen.findByLabelText(/일정 제목/);
  fireEvent.change(title, { target: { value: '면회' } });
}

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}


/**
 * The page now renders `PlanSectionNav`, which navigates between 일정 and 여행, so
 * it needs a router in scope exactly as it has in the app. Rendering bare made
 * `useNavigate()` throw before any assertion ran.
 */
function renderSchedulePage() {
  return render(
    <MemoryRouter>
      <SchedulePage />
    </MemoryRouter>,
  );
}

describe('SchedulePage loading lifecycle', () => {
  beforeEach(() => {
    reloadResult = { ok: true };
    sharedSyncStatus = 'live';
  });

  it('loads once per identity/workspace instead of looping on action identity changes', async () => {
    reloadCalls.mockClear();
    setOnLine(true);
    renderSchedulePage();

    expect(await screen.findByRole('button', { name: '일정 추가' })).toBeInTheDocument();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });

  it('페이지 제목과 일정 추가를 같은 상단 landmark에서 제공한다', async () => {
    setOnLine(true);
    renderSchedulePage();

    const pageHeading = screen.getByRole('heading', { name: '우리의 계획', level: 1 });
    const pageHeader = pageHeading.closest('header');
    const createButton = await screen.findByRole('button', { name: '일정 추가' });

    expect(pageHeader).not.toBeNull();
    expect(pageHeader).toContainElement(createButton);
  });

  it('uses the calendar state itself instead of a persistent instruction paragraph', async () => {
    setOnLine(true);
    renderSchedulePage();

    await waitFor(() => expect(addEventButton()).toBeEnabled());
    expect(screen.queryByText(/일정 추가를 누른 뒤 날짜를/)).not.toBeInTheDocument();

    fireEvent.click(addEventButton());
    expect(screen.getByText('날짜를 골라 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  it('선택한 날짜와 다가오는 일정 영역을 제목으로 탐색할 수 있다', async () => {
    setOnLine(true);
    renderSchedulePage();

    await screen.findByRole('button', { name: '일정 추가' });

    expect(screen.getByRole('region', { name: /\d{2}-\d{2} 일정/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '다가오는 일정' })).toBeInTheDocument();
  });

  it('오늘 날짜를 색과 별개인 달력 의미로 알린다', async () => {
    setOnLine(true);
    renderSchedulePage();

    await screen.findByRole('button', { name: '일정 추가' });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    expect(screen.getByRole('button', { name: new RegExp(`^${today},`) }))
      .toHaveAttribute('aria-current', 'date');
  });

  it('keeps keyboard focus inside the event dialog and restores its opener', async () => {
    setOnLine(true);
    renderSchedulePage();
    const trigger = await screen.findByRole('button', { name: '이 날짜에 추가' });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    fireEvent.click(trigger);

    expect(await screen.findByLabelText(/일정 제목/)).toHaveFocus();
    const first = screen.getByRole('button', { name: '닫기' });
    const last = screen.getByRole('button', { name: '등록하기' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '새 일정 추가' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
    renderSchedulePage();
    expect(await screen.findByRole('button', { name: '일정 추가' })).toBeInTheDocument();

    expect(addEventButton()).toBeEnabled();

    await act(async () => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(addEventButton()).toBeDisabled();
  });

  it('re-enables the create entry point when the connection returns', async () => {
    setOnLine(false);
    renderSchedulePage();
    expect(await screen.findByRole('button', { name: '일정 추가' })).toBeInTheDocument();
    expect(addEventButton()).toBeDisabled();

    await act(async () => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(addEventButton()).toBeEnabled();
  });

  it('issues no server write for a save attempted while offline', async () => {
    renderSchedulePage();
    expect(await screen.findByRole('button', { name: '일정 추가' })).toBeInTheDocument();

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
    renderSchedulePage();
    expect(await screen.findByRole('button', { name: '일정 추가' })).toBeInTheDocument();

    // FLAKE FIX. This used to click as soon as the header existed, but the header
    // renders immediately while the 일정 추가 button stays
    // `disabled={... || loadState !== 'ready' || ...}` until the first events load
    // settles. Usually that microtask won landing before the click; roughly 1 run
    // in 6 it did not, and the modal never opened -- surfacing as the misleading
    // "Unable to find a label with the text of: /일정 제목/".
    //
    // Synchronise on the condition that actually gates the click, exactly as
    // `openCreateModal()` above already does. The assertions below are unchanged.
    await pickDay();
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
    const view = renderSchedulePage();

    expect(await screen.findByText('일정을 볼 권한이 없어요')).toBeInTheDocument();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));

    // HTTP reconciliation succeeded: the workspace is trustworthy again.
    reloadResult = { ok: true };
    sharedSyncStatus = 'delayed';
    view.rerender(<MemoryRouter><SchedulePage /></MemoryRouter>);

    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('일정을 볼 권한이 없어요')).not.toBeInTheDocument(),
    );
  });

  it('does not re-read while the workspace stays unavailable', async () => {
    reloadResult = { ok: false, reason: 'forbidden' };
    sharedSyncStatus = 'unavailable';
    const view = renderSchedulePage();

    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));
    view.rerender(<MemoryRouter><SchedulePage /></MemoryRouter>);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });

  it('does not re-read a healthy workspace on a transport flap', async () => {
    sharedSyncStatus = 'live';
    const view = renderSchedulePage();
    await waitFor(() => expect(reloadCalls).toHaveBeenCalledTimes(1));

    sharedSyncStatus = 'delayed';
    view.rerender(<MemoryRouter><SchedulePage /></MemoryRouter>);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    // live -> delayed is not a recovery from quarantine, so nothing is re-read.
    expect(reloadCalls).toHaveBeenCalledTimes(1);
  });
});
