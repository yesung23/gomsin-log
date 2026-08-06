import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

/**
 * Bug condition:
 *   isBugCondition(composer) = a record the user typed is gone after they tapped
 *                              save and the network was not there.
 *
 * Two distinct losses, both measured on the unfixed tree:
 *
 * 1. `navigator.onLine === false`. The composer refused up front with
 *    `OFFLINE_READONLY_MESSAGE`. Honest about the network and wrong about the
 *    record: the text, and any voice memo synthesised into an in-memory `File` by
 *    `stopRecording`, existed nowhere on disk, so closing the app lost them.
 * 2. `navigator.onLine === true` on a flaky connection. The refusal was skipped,
 *    the write was attempted, it failed, and `addRecordWithMedia` returned
 *    `{ ok: false }` with the payload discarded -- reported as an error toast and
 *    nothing else.
 *
 * The composer must now hand case 1 to the outbox without attempting the write, and
 * recognise the `queued` outcome the store returns for case 2. In both, the text
 * leaves the composer because it is no longer unsent work -- and the user is told
 * it is waiting, not that it failed.
 */

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const queueRecordForLater = vi.fn(async () => ({ queued: true }));
const setWidgetLayout = vi.fn();
const setHighlightedRecordId = vi.fn();

let online = true;
const toastLog: { level: string; message: string }[] = [];

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastLog.push({ level: 'success', message }); },
    error: (message: string) => { toastLog.push({ level: 'error', message }); },
    warning: (message: string) => { toastLog.push({ level: 'warning', message }); },
    info: (message: string) => { toastLog.push({ level: 'info', message }); },
  },
}));

vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => online };
});

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
    authenticatedUser: { id: 'user-1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'user-1',
      myName: '춘향',
      role: 'gomsin',
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
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['today_word'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    addRecordWithMedia,
    queueRecordForLater,
    setWidgetLayout,
    setHighlightedRecordId,
    outboxWaiting: 0,
    outboxBlocked: 0,
    retryBlockedRecords: vi.fn(),
  }),
}));

const { TodayLogWidget } = await import('@/components/widgets/TodayLogWidget');

/** Open the text composer and type, exactly as a user would. */
async function typeAndSave(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: /한줄/ }));
  await user.type(await screen.findByLabelText('오늘의 기록'), text);
  await user.click(screen.getByRole('button', { name: /남기기|저장/ }));
}

function messages(level: string): string[] {
  return toastLog.filter((entry) => entry.level === level).map((entry) => entry.message);
}

beforeEach(() => {
  addRecordWithMedia.mockClear();
  queueRecordForLater.mockClear();
  toastLog.length = 0;
  online = true;
  clearAllComposerDrafts();
  clearAllComposerDrafts();
});

describe('offline: the record is stored instead of refused', () => {
  it('does not attempt the write, and queues it', async () => {
    online = false;
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '신호가 없는 곳에서 씀');

    await waitFor(() => expect(queueRecordForLater).toHaveBeenCalledTimes(1));
    // The one connectivity fact the OS is trusted about: no request is fired.
    expect(addRecordWithMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater.mock.calls[0][0]).toMatchObject({ log: '신호가 없는 곳에서 씀' });
  });

  it('tells the user it is waiting, not that it failed', async () => {
    online = false;
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '대기 문구');

    await waitFor(() => expect(messages('success').length).toBe(1));
    expect(messages('success')[0]).toContain('연결되면');
    expect(messages('error')).toEqual([]);
  });

  it('clears the composer, because the text is no longer unsent work', async () => {
    online = false;
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '치워져야 함');

    await waitFor(() => expect(queueRecordForLater).toHaveBeenCalled());
    expect(screen.queryByDisplayValue('치워져야 함')).not.toBeInTheDocument();
  });

  it('keeps everything in the composer when it cannot even be stored', async () => {
    // No IndexedDB, or no local couple space to attach it to. Saying "저장해 뒀어요"
    // here would be the same lie the old code told by a different route.
    online = false;
    queueRecordForLater.mockResolvedValueOnce({ queued: false, error: '임시 보관할 수 없어요.' });
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '보관 실패');

    await waitFor(() => expect(messages('error').length).toBe(1));
    expect(messages('error')[0]).toContain('보관할 수 없어요');
    expect(messages('success')).toEqual([]);
    expect(screen.getByDisplayValue('보관 실패')).toBeInTheDocument();
  });
});

describe('online but unreachable: the store queues, the composer says so', () => {
  it('treats a queued outcome as waiting rather than failed', async () => {
    addRecordWithMedia.mockResolvedValueOnce({
      ok: false, queued: true, failedFiles: [],
    } as never);
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '불안정한 연결');

    await waitFor(() => expect(messages('success').length).toBe(1));
    expect(messages('success')[0]).toContain('연결되면');
    expect(messages('error')).toEqual([]);
    expect(screen.queryByDisplayValue('불안정한 연결')).not.toBeInTheDocument();
  });

  it('PRESERVATION: a definitive failure is still an error, and keeps the text', async () => {
    // A membership rejection is not something to wait for. The store does not queue
    // it, and the composer must not pretend it is on its way.
    addRecordWithMedia.mockResolvedValueOnce({
      ok: false, failedFiles: [], error: '권한이 없어요.',
    } as never);
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '권한 실패');

    await waitFor(() => expect(messages('error').length).toBe(1));
    expect(messages('error')[0]).toBe('권한이 없어요.');
    expect(messages('success')).toEqual([]);
    expect(screen.getByDisplayValue('권한 실패')).toBeInTheDocument();
  });

  it('PRESERVATION: a normal save still reports delivery, not queueing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);

    await typeAndSave(user, '정상 저장');

    await waitFor(() => expect(messages('success').length).toBe(1));
    expect(messages('success')[0]).not.toContain('연결되면');
    expect(queueRecordForLater).not.toHaveBeenCalled();
  });
});
