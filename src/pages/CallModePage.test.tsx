import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, TalkAboutMark } from '@/types';
import { toast } from 'sonner';

/**
 * 통화 모드 — the last arrow of the daily loop, and the three rules it must not break.
 *
 * PRODUCT_V3 §8 (2026-08-21 revision) is unusually specific about what this screen
 * may NOT do, because every one of those is a thing a call screen naturally grows
 * into: dialling, a call log, a batched save. The negative assertions here are the
 * point of the file; the positive ones just prove it works.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-08-21';

const resolveTalkAbout = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
const setHighlightedRecordId = vi.fn();
const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let online = true;
vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => online };
});

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    resolveTalkAbout,
    setHighlightedRecordId,
  }),
}));

const { CallModePage } = await import('@/pages/CallModePage');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '10:00',
    authorRole: 'soldier',
    log: '훈련 끝나고 노을을 봤어',
    isPrivate: false,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

function mark(overrides: Partial<TalkAboutMark> = {}): TalkAboutMark {
  return {
    id: 'mark-1',
    recordId: 'rec-1',
    coupleId: 'couple-1',
    actorUserId: ME,
    createdAt: new Date().toISOString(),
    isCompleted: false,
    ...overrides,
  };
}

function makeState(
  records: DailyRecord[],
  talkAboutMarks: TalkAboutMark[],
  role: 'gomsin' | 'soldier' = 'gomsin',
): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '춘향',
      role,
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks,
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function renderPage(
  records: DailyRecord[],
  marks: TalkAboutMark[],
  role: 'gomsin' | 'soldier' = 'gomsin',
) {
  currentState = makeState(records, marks, role);
  return render(<CallModePage />);
}

/** Three topics, newest mark first, so ordering is deterministic. */
function three() {
  const records = [
    record({ id: 'rec-a', log: '첫째' }),
    record({ id: 'rec-b', log: '둘째' }),
    record({ id: 'rec-c', log: '셋째' }),
  ];
  const marks = [
    mark({ id: 'm-a', recordId: 'rec-a', createdAt: '2026-08-21T12:00:00.000Z' }),
    mark({ id: 'm-b', recordId: 'rec-b', createdAt: '2026-08-21T11:00:00.000Z' }),
    mark({ id: 'm-c', recordId: 'rec-c', createdAt: '2026-08-21T10:00:00.000Z' }),
  ];
  return { records, marks };
}

beforeEach(() => {
  resolveTalkAbout.mockClear();
  resolveTalkAbout.mockResolvedValue({ ok: true });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  setHighlightedRecordId.mockClear();
  navigate.mockClear();
  online = true;
});

describe('what 통화 모드 must never do', () => {
  it('never offers to place a call', () => {
    // §8: the call is the user's to make on whatever they already use. A dialler
    // here would also be the one control on screen that leaves the app entirely.
    const { records, marks } = three();
    const { container } = renderPage(records, marks);

    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.innerHTML).not.toContain('tel:');
  });

  it('records nothing about the call when a topic is completed', async () => {
    /*
      The completion must carry the record id and nothing else. A duration, a
      started-at, or a count would each be a call log -- §19 forbids precise
      timestamps and §16 forbids the surveillance surface they add up to.
    */
    const user = userEvent.setup();
    const { records, marks } = three();
    renderPage(records, marks);

    await user.click(screen.getByTestId('call-mode-complete'));

    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledTimes(1));
    expect(resolveTalkAbout.mock.calls[0]).toEqual(['rec-a']);
  });

  it('treats 다음 as a skip, writing nothing at all', async () => {
    // §8: `다음`은 건너뛰기이며 완료가 아니다.
    const user = userEvent.setup();
    const { records, marks } = three();
    renderPage(records, marks);

    await user.click(screen.getByTestId('call-mode-skip'));
    await user.click(screen.getByTestId('call-mode-skip'));

    expect(resolveTalkAbout).not.toHaveBeenCalled();
    expect(screen.getByText('셋째')).toBeInTheDocument();
  });

  it('does not claim completion after skipping to the end', async () => {
    /*
      Skipping past the last topic leaves every one of them open. Saying "다
      정리했어요" there would be the app asserting something untrue about a
      conversation it cannot observe -- §3.2.
    */
    const user = userEvent.setup();
    const { records, marks } = three();
    renderPage(records, marks);

    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByTestId('call-mode-skip'));
    }

    expect(screen.getByTestId('call-mode-wrapped')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-done')).toBeNull();
    expect(screen.getByText(/아직 3개가 그대로 있어요/)).toBeInTheDocument();
  });
});

describe('one topic at a time', () => {
  it('shows only the current topic, not the list', () => {
    const { records, marks } = three();
    renderPage(records, marks);

    expect(screen.getByText('첫째')).toBeInTheDocument();
    expect(screen.queryByText('둘째')).toBeNull();
    expect(screen.queryByText('셋째')).toBeNull();
  });

  it('advances to the next topic without stepping over one', async () => {
    /*
      The regression this guards: completing removes the topic from the list, so
      the same index already addresses the next one. Advancing the index as well
      would silently skip 둘째.
    */
    const user = userEvent.setup();
    const { records, marks } = three();
    const { rerender } = renderPage(records, marks);

    await user.click(screen.getByTestId('call-mode-complete'));
    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalled());

    // The store would drop the resolved mark; this reproduces that.
    currentState = makeState(records, marks.slice(1));
    rerender(<CallModePage />);

    expect(screen.getByText('둘째')).toBeInTheDocument();
  });

  it('reports position as progress through the list', () => {
    const { records, marks } = three();
    renderPage(records, marks);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
});

describe('each completion stands on its own', () => {
  it('reports a refused write as a failure, never as a completion', async () => {
    /*
      A call ends abruptly, so a completion that silently failed would be
      discovered days later with the topic still sitting in the list.

      Asserted on what the user is TOLD, not on what stays on screen: the store is
      the thing that drops a resolved topic, so with it stubbed the topic remains
      visible either way and an assertion about the screen would pass for a build
      that reported success on every failure.
    */
    const user = userEvent.setup();
    resolveTalkAbout.mockResolvedValue({ ok: false, error: '권한이 없어요.' });
    const { records, marks } = three();
    renderPage(records, marks);

    await user.click(screen.getByTestId('call-mode-complete'));

    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('권한이 없어요.');
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(screen.getByText('첫째')).toBeInTheDocument();
  });

  it('confirms only when the write actually succeeded', async () => {
    const user = userEvent.setup();
    const { records, marks } = three();
    renderPage(records, marks);

    await user.click(screen.getByTestId('call-mode-complete'));

    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('cannot complete while offline, and says why', () => {
    online = true;
    const { records, marks } = three();
    const { rerender } = renderPage(records, marks);
    online = false;
    rerender(<CallModePage />);

    expect(screen.getByTestId('call-mode-complete')).toBeDisabled();
    expect(screen.getAllByText(/오프라인|연결/).length).toBeGreaterThan(0);
    expect(resolveTalkAbout).not.toHaveBeenCalled();
  });
});

describe('the states either side of a topic', () => {
  it('says the list is clear when nothing is marked', () => {
    renderPage([record()], []);
    expect(screen.getByTestId('call-mode-done')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-complete')).toBeNull();
  });

  it('opens for 군화 as well as 곰신', () => {
    // §8: 양쪽 역할 모두 진입할 수 있다.
    const { records, marks } = three();
    renderPage(records, marks, 'soldier');
    expect(screen.getByTestId('call-mode-topic')).toBeInTheDocument();
  });

  it('shows a safe unavailable state, and can still clear it', async () => {
    /*
      §8 keeps the coordination state when the original goes away. The pair can
      still have had the conversation, so the completion has to remain reachable --
      but nothing derived from the record may appear.
    */
    const user = userEvent.setup();
    renderPage([], [mark({ recordId: 'rec-gone' })]);

    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeInTheDocument();
    expect(screen.queryByText('rec-gone')).toBeNull();
    // No 원본 보기 for something there is no original to show.
    expect(screen.queryByText('원본 보기')).toBeNull();

    await user.click(screen.getByTestId('call-mode-complete'));
    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledWith('rec-gone'));
  });

  it('reaches the exact original through the durable route', async () => {
    const user = userEvent.setup();
    const { records, marks } = three();
    renderPage(records, marks);

    await user.click(screen.getByText('원본 보기'));

    expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-a');
    expect(navigate).toHaveBeenCalledWith('/record?record=rec-a');
  });
});
