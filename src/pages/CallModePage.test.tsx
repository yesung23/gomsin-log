import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
let sharedSyncStatus: 'live' | 'delayed' | 'unavailable' = 'live';
let talkAboutSyncStatus: 'ready' | 'unavailable' = 'ready';
vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => online };
});

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus,
    talkAboutSyncStatus,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  resolveTalkAbout.mockClear();
  resolveTalkAbout.mockResolvedValue({ ok: true });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  setHighlightedRecordId.mockClear();
  navigate.mockClear();
  online = true;
  sharedSyncStatus = 'live';
  talkAboutSyncStatus = 'ready';
});

describe('what 통화 모드 must never do', () => {
  it('keeps the full-screen controls inside the iPhone safe areas', () => {
    const { records, marks } = three();
    const { container } = renderPage(records, marks);
    const frame = container.firstElementChild;

    expect(frame).toHaveClass('pt-[env(safe-area-inset-top,0px)]');
    expect(frame).toHaveClass('pb-[env(safe-area-inset-bottom,0px)]');
  });

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

  it('deduplicates two actors marking the same exact record', () => {
    renderPage([record()], [
      mark({ actorUserId: ME }),
      mark({ id: 'partner-mark', actorUserId: PARTNER }),
    ]);

    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getAllByText('훈련 끝나고 노을을 봤어')).toHaveLength(1);
  });

  it('keeps the exact current record when realtime reorders or prepends topics', async () => {
    const { records, marks } = three();
    const { rerender } = renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-skip'));
    expect(screen.getByText('둘째')).toBeInTheDocument();

    const newRecord = record({ id: 'rec-new', log: '방금 추가됨' });
    const partnerJoinedCurrent = mark({
      id: 'partner-on-b',
      recordId: 'rec-b',
      actorUserId: PARTNER,
      createdAt: '2026-08-21T14:00:00.000Z',
    });
    const newMark = mark({
      id: 'm-new',
      recordId: 'rec-new',
      createdAt: '2026-08-21T15:00:00.000Z',
    });
    currentState = makeState([...records, newRecord], [newMark, partnerJoinedCurrent, ...marks]);
    rerender(<CallModePage />);

    expect(screen.getByText('둘째')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('call-mode-complete'));
    expect(resolveTalkAbout).toHaveBeenCalledWith('rec-b');
  });

  it('does not silently replace the current topic when its source disappears', async () => {
    const { records, marks } = three();
    const { rerender } = renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-skip'));
    expect(screen.getByText('둘째')).toBeInTheDocument();

    currentState = makeState(
      records.filter((entry) => entry.id !== 'rec-b'),
      marks.filter((entry) => entry.recordId !== 'rec-b'),
    );
    rerender(<CallModePage />);

    expect(screen.getByTestId('call-mode-current-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('셋째')).not.toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-complete')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('call-mode-skip'));
    expect(screen.getByText('셋째')).toBeInTheDocument();
  });

  it('advances without skipping when a previously skipped topic resolves elsewhere', async () => {
    const { records, marks } = three();
    const { rerender } = renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-skip'));
    expect(screen.getByText('둘째')).toBeInTheDocument();

    currentState = makeState(records, marks.slice(1));
    rerender(<CallModePage />);

    expect(screen.getByText('둘째')).toBeInTheDocument();
  });

  it('shows the same exact source again when it receives a new mark generation', async () => {
    const onlyRecord = record({ id: 'only', log: '다시 꺼낸 이야기' });
    const firstMark = mark({
      id: 'mark-old',
      recordId: 'only',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    const { rerender } = renderPage([onlyRecord], [firstMark]);

    await userEvent.click(screen.getByTestId('call-mode-complete'));
    await waitFor(() => expect(screen.getByTestId('call-mode-done')).toBeInTheDocument());

    currentState = makeState([onlyRecord], [mark({
      id: 'mark-new',
      recordId: 'only',
      createdAt: '2026-08-21T11:00:00.000Z',
    })]);
    rerender(<CallModePage />);

    await waitFor(() => expect(screen.getByText('다시 꺼낸 이야기')).toBeInTheDocument());
    expect(screen.queryByTestId('call-mode-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('call-mode-complete')).toBeInTheDocument();
  });

  it('suppresses the same settled mark generation when an old snapshot arrives again', async () => {
    const onlyRecord = record({ id: 'only', log: '이미 정리한 이야기' });
    const oldMark = mark({
      id: 'mark-old',
      recordId: 'only',
      createdAt: '2026-08-21T10:00:00.000Z',
    });
    const { rerender } = renderPage([onlyRecord], [oldMark]);

    await userEvent.click(screen.getByTestId('call-mode-complete'));
    await waitFor(() => expect(screen.getByTestId('call-mode-done')).toBeInTheDocument());

    currentState = makeState([onlyRecord], [{ ...oldMark }]);
    rerender(<CallModePage />);

    expect(screen.getByTestId('call-mode-done')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-topic')).not.toBeInTheDocument();
  });
});

describe('each completion stands on its own', () => {
  it('single-flights same-frame completion and blocks next until a failed write settles', async () => {
    const pending = deferred<{ ok: boolean; error?: string }>();
    resolveTalkAbout.mockImplementationOnce(() => pending.promise);
    const { records, marks } = three();
    renderPage(records, marks);

    const complete = screen.getByTestId('call-mode-complete');
    const skip = screen.getByTestId('call-mode-skip');
    fireEvent.click(complete);
    fireEvent.click(complete);
    fireEvent.click(skip);

    expect(resolveTalkAbout).toHaveBeenCalledTimes(1);
    expect(resolveTalkAbout).toHaveBeenCalledWith('rec-a');
    expect(complete).toBeDisabled();
    expect(skip).toBeDisabled();
    expect(screen.getByText('첫째')).toBeInTheDocument();

    pending.resolve({ ok: false, error: '잠시 실패했어요.' });
    await waitFor(() => expect(complete).not.toBeDisabled());
    expect(skip).not.toBeDisabled();
    expect(screen.getByText('첫째')).toBeInTheDocument();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('잠시 실패했어요.');

    fireEvent.click(complete);
    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledTimes(2));
  });

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

  it('advances a committed topic but reports delayed reconciliation instead of full success', async () => {
    resolveTalkAbout.mockResolvedValueOnce({ ok: true, syncPending: true });
    const { records, marks } = three();
    renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-complete'));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('저장은 됐지만 화면 반영이 늦어지고 있어요'),
    ));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText('둘째')).toBeInTheDocument();
  });

  it('handles an unexpected rejected write and restores both controls', async () => {
    resolveTalkAbout.mockRejectedValueOnce(new Error('network exploded'));
    const { records, marks } = three();
    renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-complete'));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByTestId('call-mode-complete')).not.toBeDisabled();
    expect(screen.getByTestId('call-mode-skip')).not.toBeDisabled();
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
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

  it('hides missing, private, and unreadable originals without disclosing mark existence', () => {
    renderPage([
      record({ id: 'rec-private', isPrivate: true, log: '비공개 원문' }),
      record({
        id: 'rec-locked',
        date: '2026-09-01',
        contentUnavailable: 'key_unavailable',
        log: '',
      }),
    ], [
      mark({ id: 'missing-mark', recordId: 'rec-gone' }),
      mark({ id: 'private-mark', recordId: 'rec-private' }),
      mark({ id: 'locked-mark', recordId: 'rec-locked' }),
    ]);

    expect(screen.getByTestId('call-mode-done')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-topic')).not.toBeInTheDocument();
    expect(screen.queryByText(/비공개 원문|2026-09-01|몽룡|원본 보기|rec-gone/)).not.toBeInTheDocument();
  });

  it('does not call a quarantined shared workspace done', () => {
    sharedSyncStatus = 'unavailable';
    renderPage([], []);

    expect(screen.getByTestId('call-mode-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-complete')).not.toBeInTheDocument();
  });

  it('does not call a failed talk-about slice done while shared records remain live', () => {
    talkAboutSyncStatus = 'unavailable';
    renderPage([], []);

    expect(screen.getByTestId('call-mode-unavailable')).toBeInTheDocument();
    expect(screen.getByText(/책갈피 목록을 아직 확인하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-done')).not.toBeInTheDocument();
  });

  it('does not call a disappeared final topic resolved after an explicit next action', async () => {
    const onlyRecord = record({ id: 'only', log: '마지막 이야기' });
    const onlyMark = mark({ id: 'only-mark', recordId: 'only' });
    const { rerender } = renderPage([onlyRecord], [onlyMark]);

    currentState = makeState([], []);
    rerender(<CallModePage />);
    await userEvent.click(screen.getByTestId('call-mode-skip'));

    expect(screen.getByTestId('call-mode-changed')).toBeInTheDocument();
    expect(screen.queryByTestId('call-mode-done')).not.toBeInTheDocument();
    expect(resolveTalkAbout).not.toHaveBeenCalled();
  });

  it('moves focus and announces the exact topic after an explicit transition', async () => {
    const { records, marks } = three();
    renderPage(records, marks);

    await userEvent.click(screen.getByTestId('call-mode-skip'));

    const heading = screen.getByRole('heading', { name: '둘째' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(/둘째|2번째/);
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
