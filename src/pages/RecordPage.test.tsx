import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, EmotionFlowItem, TalkAboutMark } from '@/types';

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';

const updateRecord = vi.fn(async () => ({ ok: true as const }));
const deleteRecord = vi.fn(async () => ({ ok: true as const }));
const updateRecordMedia = vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] }));
const setHighlightedRecordId = vi.fn();
// Only exercised by the composer sheet tests below -- RecordPage now embeds
// TodayLogWidget, which needs these from the same store hook.
const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const queueRecordForLater = vi.fn(async () => ({ queued: true }));
const markTalkAbout = vi.fn(async () => ({ ok: true }));
const unmarkTalkAbout = vi.fn(async () => ({ ok: true }));

function flowItem(overrides: Partial<EmotionFlowItem> = {}): EmotionFlowItem {
  return {
    id: 'flow-1',
    group: 'joy',
    displayLabel: '행복',
    sequence: 1,
    source: 'user_confirmed',
    visibility: 'shared',
    ...overrides,
  };
}

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-mine',
    userId: ME,
    date: TODAY,
    time: '10:00',
    authorRole: 'gomsin',
    log: 'hello',
    isPrivate: false,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

let currentMarks: TalkAboutMark[] = [];

function makeState(records: DailyRecord[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
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
    records,
    events: [],
    trips: [],
    talkAboutMarks: currentMarks,
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

let currentState = makeState([]);
/**
 * How fresh the shared workspace on screen is. `live` for every pre-existing
 * scenario; the quarantine window is exercised explicitly below.
 */
let currentSyncStatus: 'live' | 'delayed' | 'unavailable' = 'live';

/** Captured toast messages, so failure copy can be asserted verbatim. */
const toastLog: { level: string; message: string }[] = [];
function toastErrors(): string[] {
  return toastLog.filter((entry) => entry.level === 'error').map((entry) => entry.message);
}

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastLog.push({ level: 'success', message }); },
    error: (message: string) => { toastLog.push({ level: 'error', message }); },
    warning: (message: string) => { toastLog.push({ level: 'warning', message }); },
    info: (message: string) => { toastLog.push({ level: 'info', message }); },
  },
}));

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: currentSyncStatus,
    updateRecord,
    deleteRecord,
    updateRecordMedia,
    setHighlightedRecordId,
    markTalkAbout,
    unmarkTalkAbout,
    resolveTalkAbout: vi.fn(async () => ({ ok: true })),
    addRecordWithMedia,
    queueRecordForLater,
    outboxWaiting: 0,
    outboxBlocked: 0,
    retryBlockedRecords: vi.fn(),
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

/** RecordPage opens on today, so fixtures are dated today via `TODAY`. */
function renderPage(records: DailyRecord[], initialPath = '/records') {
  currentState = makeState(records);
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <RecordPage />
    </MemoryRouter>,
  );
}

/** Click the timeline entry whose visible time label is `time`. */
async function openRecord(user: ReturnType<typeof userEvent.setup>, time: string) {
  await user.click(await screen.findByText(time));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  updateRecord.mockClear();
  deleteRecord.mockClear();
  setHighlightedRecordId.mockClear();
  markTalkAbout.mockClear();
  unmarkTalkAbout.mockClear();
  currentMarks = [];
  currentSyncStatus = 'live';
});

/**
 * PRIORITY 2. The period summary is derived from the records ON SCREEN, and the
 * shared workspace is deliberately hidden while membership is unconfirmed (a ~2s
 * window on every cold load with no realtime socket). During that window
 * `records` is empty for a reason that is NOT "this user has no emotions", yet the
 * section rendered its empty state and told the user exactly that -- contradicting
 * the SharedSyncBanner directly above it. Observed in a real browser as the
 * `healthy` arm of `scratch/p2-states.mjs`.
 */
describe('RecordPage period summary honesty while the workspace is unconfirmed', () => {
  it('does not report an empty period while the shared workspace is hidden', () => {
    currentSyncStatus = 'unavailable';
    renderPage([]);

    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).not.toHaveAttribute('data-state', 'empty');
    expect(section.textContent).not.toContain('아직 오늘의 마음이 없어요');
  });

  it('reports a genuinely empty period once the workspace is live', () => {
    // PRESERVATION: a confirmed workspace with no confirmed emotions IS empty,
    // and saying so is correct.
    currentSyncStatus = 'live';
    renderPage([]);

    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'empty');
  });

  it('still summarises normally when the workspace is only delayed', () => {
    // PRESERVATION: `delayed` means the data on screen is real but possibly
    // stale, so hiding the summary would lose information the user already has.
    currentSyncStatus = 'delayed';
    renderPage([record({ emotionFlow: [
      flowItem({ id: 's1', group: 'sadness', displayLabel: '서운함', sequence: 1 }),
      flowItem({ id: 's2', group: 'love', displayLabel: '애정', sequence: 2 }),
    ] })]);

    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'ready');
  });
});

describe('RecordPage ownership controls', () => {
  it('offers 수정 and 삭제 on a record the viewer authored', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('수정')).toBeInTheDocument();
    expect(screen.getByText('삭제')).toBeInTheDocument();
  });

  it('offers neither on the partner\'s shared record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({ id: 'rec-partner', userId: PARTNER, authorRole: 'soldier', time: '11:00' }),
    ]);
    await openRecord(user, '11:00');

    // The modal is open but has no owner controls.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('수정')).not.toBeInTheDocument();
    expect(screen.queryByText('삭제')).not.toBeInTheDocument();
  });
});

/**
 * P5: a record the viewer is authorized to see but this device cannot decrypt.
 *
 * The failure mode being guarded against is not a blank screen — it is a
 * CONFIDENT blank screen. `(내용 없음)` tells the author they wrote nothing, and
 * offering 수정 on top of that invites them to overwrite content that is still
 * recoverable once the epoch key arrives.
 */
describe('RecordPage: a record whose content cannot be decrypted', () => {
  it('explains the cause instead of claiming the record is empty', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ log: '', contentUnavailable: 'key_unavailable' })]);
    await openRecord(user, '10:00');

    expect(await screen.findByTestId('record-content-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('(내용 없음)')).not.toBeInTheDocument();
  });

  it('distinguishes a key that may still arrive from one that cannot open it', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ log: '', contentUnavailable: 'undecryptable' })]);
    await openRecord(user, '10:00');

    const message = await screen.findByTestId('record-content-unavailable');
    expect(message.textContent).toContain('열 수 없어요');
    // Not the "wait for provisioning" wording, which would be a false promise.
    expect(message.textContent).not.toContain('기기 연결이 끝나면');
  });

  it('withholds 수정 so an unreadable record cannot be overwritten', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ log: '', contentUnavailable: 'key_unavailable' })]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('수정')).not.toBeInTheDocument();
  });

  it('still offers 삭제, which is a legitimate choice for a record you cannot read', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ log: '', contentUnavailable: 'undecryptable' })]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('삭제')).toBeInTheDocument();
  });

  it('leaves a readable record fully editable', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('수정')).toBeInTheDocument();
    expect(screen.queryByTestId('record-content-unavailable')).not.toBeInTheDocument();
  });
});

describe('RecordPage partner privacy sanitisation', () => {
  it('never renders the partner\'s author_only emotion items', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        id: 'rec-partner',
        userId: PARTNER,
        authorRole: 'soldier',
        time: '11:00',
        emotionFlow: [
          flowItem({ id: 'shared-1', group: 'joy', displayLabel: '행복', sequence: 1 }),
          flowItem({
            id: 'private-1',
            group: 'shame',
            displayLabel: '부끄러움',
            sequence: 2,
            visibility: 'author_only',
          }),
        ],
      }),
    ]);
    await openRecord(user, '11:00');

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    // Only the shared label survives `visibleRecordsForViewer`. It now appears in
    // more than one place (the record's insight card AND the derived period
    // summary), so assert presence by count rather than uniqueness.
    expect(screen.getAllByText('행복').length).toBeGreaterThan(0);
    expect(screen.queryByText(/부끄러움/)).not.toBeInTheDocument();
    // The author-only item must not leak through the aggregated period summary
    // either -- it reads the same viewer-filtered records.
    const summary = screen.getByTestId('emotion-flow-summary');
    expect(summary.textContent).not.toContain('부끄러움');
    expect(summary.getAttribute('aria-label')).not.toContain('부끄러움');
  });

  it('does not surface the partner\'s private record in the timeline at all', () => {
    renderPage([
      record({
        id: 'rec-partner-private',
        userId: PARTNER,
        authorRole: 'soldier',
        time: '11:00',
        isPrivate: true,
        log: '군대에서만 아는 이야기',
      }),
    ]);

    expect(screen.queryByText('11:00')).not.toBeInTheDocument();
    expect(screen.queryByText('군대에서만 아는 이야기')).not.toBeInTheDocument();
  });
});

describe('RecordPage editing', () => {
  it('disables 저장 for empty text and never calls updateRecord', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.clear(textarea);

    const save = screen.getByText('저장');
    expect(save).toBeDisabled();
    await user.click(save);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('warns that changing the text clears the previous confirmations', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    expect(
      screen.queryByText('내용을 바꾸면 이전 글에서 고른 마음은 지워져요.'),
    ).not.toBeInTheDocument();

    await user.type(textarea, ' 그리고 조금 더');
    expect(
      await screen.findByText('내용을 바꾸면 이전 글에서 고른 마음은 지워져요.'),
    ).toBeInTheDocument();
  });

  it('clears emotionFlow and emotionUpdatedAt when the text changes', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.clear(textarea);
    await user.type(textarea, 'changed text');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    expect(updateRecord).toHaveBeenCalledWith('rec-mine', {
      log: 'changed text',
      emotionFlow: [],
      emotionUpdatedAt: null,
    });
  });

  it('leaves the emotions alone when the text is saved unchanged', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    const [, updates] = updateRecord.mock.calls[0] as unknown as [string, Partial<DailyRecord>];
    expect(updates).toEqual({ log: 'hello' });
    expect(updates).not.toHaveProperty('emotionFlow');
    expect(updates).not.toHaveProperty('emotionUpdatedAt');
  });
});

describe('RecordPage detail insight card', () => {
  it('renders the flow card for a record with two confirmed emotions', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        emotionFlow: [
          flowItem({ id: 'a', group: 'sadness', displayLabel: '속상함', sequence: 1 }),
          flowItem({ id: 'b', group: 'joy', displayLabel: '행복', sequence: 2 }),
        ],
      }),
    ]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    expect(screen.getByText('속상함 → 행복')).toBeInTheDocument();
    expect(screen.getByText('가장 큰 변화: 속상함 → 행복')).toBeInTheDocument();
    // Detail variant: no composer-only preview notice.
    expect(screen.queryByText(/저장되지 않아요/)).not.toBeInTheDocument();
  });

  it('renders no card for a record with no emotionFlow', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('마음의 흐름')).not.toBeInTheDocument();
  });
});

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
}

describe('RecordPage media editing', () => {
  beforeEach(() => {
    updateRecordMedia.mockClear();
    updateRecordMedia.mockResolvedValue({ ok: true as const, failedFiles: [] as string[] });
    toastLog.length = 0;
    setOnLine(true);
  });

  it('offers per-attachment removal for an own record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        attachments: [
          { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-mine/img.jpg' },
        ],
      }),
    ]);
    await openRecord(user, '10:00');

    const remove = await screen.findByLabelText('첨부 img.jpg 삭제');
    await user.click(remove);

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledWith('rec-mine', {
      removePaths: ['couple-1/rec-mine/img.jpg'],
    }));
  });

  it('offers an add-media control for an own record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('+ 사진 · 영상 · 음성 추가')).toBeInTheDocument();
  });

  it('never offers media controls on the partner\'s record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        id: 'rec-partner',
        userId: PARTNER,
        authorRole: 'soldier',
        time: '11:00',
        attachments: [
          { type: 'photo', name: 'theirs.jpg', path: 'couple-1/rec-partner/theirs.jpg' },
        ],
      }),
    ]);
    await openRecord(user, '11:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByLabelText('첨부 theirs.jpg 삭제')).toBeNull();
    expect(screen.queryByText('+ 사진 · 영상 · 음성 추가')).toBeNull();
  });

  it('offers no removal control for a legacy attachment with no storage path', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        // No `path`: it cannot be addressed in Storage, so it cannot be removed.
        attachments: [{ type: 'photo', name: 'legacy.jpg', url: 'https://example.test/x.jpg' }],
      }),
    ]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByLabelText('첨부 legacy.jpg 삭제')).toBeNull();
  });

  it('disables media controls and the edit/delete actions while offline', async () => {
    const user = userEvent.setup({ delay: null });
    setOnLine(false);
    renderPage([
      record({
        attachments: [
          { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-mine/img.jpg' },
        ],
      }),
    ]);
    await openRecord(user, '10:00');

    expect(await screen.findByLabelText('첨부 img.jpg 삭제')).toBeDisabled();
    expect(screen.getByText('+ 사진 · 영상 · 음성 추가')).toBeDisabled();
  });

  it('reports the store\'s cause-specific message verbatim on failure', async () => {
    const user = userEvent.setup({ delay: null });
    updateRecordMedia.mockResolvedValue({
      ok: false as never,
      failedFiles: [],
      error: '권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    } as never);
    renderPage([
      record({
        attachments: [
          { type: 'photo', name: 'img.jpg', path: 'couple-1/rec-mine/img.jpg' },
        ],
      }),
    ]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByLabelText('첨부 img.jpg 삭제'));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalled());
    // The message must not be replaced by a connection-shaped fallback.
    const errors = toastErrors();
    expect(errors.some((message) => message.includes('권한이 없어요'))).toBe(true);
    expect(errors.every((message) => !message.includes('인터넷'))).toBe(true);
  });
});

describe('RecordPage period summary', () => {
  it('renders the aggregated summary for the visible month', async () => {
    renderPage([
      record({
        emotionFlow: [flowItem({ id: 'a', group: 'joy', displayLabel: '행복', sequence: 1 })],
      }),
    ]);

    const summary = await screen.findByTestId('emotion-flow-summary');
    expect(summary).toHaveAttribute('data-state', 'ready');
    expect(summary.textContent).toContain('2026년 7월');
  });

  it('renders the empty state when no record in the month has confirmed emotions', async () => {
    renderPage([record()]);
    const summary = await screen.findByTestId('emotion-flow-summary');
    expect(summary).toHaveAttribute('data-state', 'empty');
    expect(summary.textContent).toContain('아직 오늘의 마음이 없어요');
  });
});

/**
 * PRODUCT_V3 §7.1.1 / CURRENT_STATE #1: the 기록 tab used to have no way at
 * all to create a record -- only a Home widget the user could remove. The
 * floating "+" button navigated to /home, which showed nothing if that widget
 * was gone. It now opens a composer sheet that lives on this page and cannot
 * be removed by any widget-layout choice.
 */
describe('RecordPage: the composer sheet is a reliable, non-removable entry point', () => {
  beforeEach(() => {
    addRecordWithMedia.mockClear();
    queueRecordForLater.mockClear();
  });

  it('is closed by default and opens from the floating CTA', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([]);

    expect(screen.queryByRole('dialog', { name: '지금의 마음 남기기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /지금의 마음 남기기/ }));
    expect(screen.getByRole('dialog', { name: '지금의 마음 남기기' })).toBeInTheDocument();
  });

  it('is present regardless of the stored widget layout -- it does not read widgetLayout at all', async () => {
    // makeState() always sets widgetLayout: [] (no today_word, no anything).
    // A Home rendering the widget list would show nothing here; this sheet
    // does not consult that list, so it is unaffected.
    const user = userEvent.setup({ delay: null });
    renderPage([]);
    await user.click(screen.getByRole('button', { name: /지금의 마음 남기기/ }));
    const dialog = await screen.findByRole('dialog', { name: '지금의 마음 남기기' });
    expect(dialog).toBeInTheDocument();
    // TodayLogWidget's own capture launcher, present the instant the sheet
    // opens -- before any type is chosen.
    expect(await screen.findByRole('button', { name: '한줄' })).toBeInTheDocument();
  });

  it('saving from the sheet calls the same store write TodayLogWidget always used', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([]);
    await user.click(screen.getByRole('button', { name: /지금의 마음 남기기/ }));
    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await user.type(await screen.findByLabelText('오늘의 기록'), '기록 탭에서 바로 씀');
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    expect(addRecordWithMedia.mock.calls[0][0]).toMatchObject({ log: '기록 탭에서 바로 씀' });
  });

  it('closes itself after a successful save', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([]);
    await user.click(screen.getByRole('button', { name: /지금의 마음 남기기/ }));
    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await user.type(await screen.findByLabelText('오늘의 기록'), '닫혀야 함');
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '지금의 마음 남기기' })).not.toBeInTheDocument());
  });

  it('the X button closes the sheet without saving', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([]);
    await user.click(screen.getByRole('button', { name: /지금의 마음 남기기/ }));
    await user.click(screen.getByRole('button', { name: '닫기' }));

    expect(screen.queryByRole('dialog', { name: '지금의 마음 남기기' })).not.toBeInTheDocument();
    expect(addRecordWithMedia).not.toHaveBeenCalled();
  });
});

/**
 * PRODUCT_V3 §7.5 / CURRENT_STATE #9: the previous addressing mechanism was
 * pure in-memory store state (`state.highlightedRecordId`), set by a widget
 * right before calling `navigate('/record')`. That works only for a
 * same-session click; a reload, a direct URL, or a future notification deep
 * link opened `/record` with no target at all, because nothing survived the
 * navigation except the bare path. `?record=<id>` in the URL is durable
 * across exactly those cases.
 */
describe('RecordPage: durable source addressing via ?record=<id>', () => {
  beforeEach(() => {
    toastLog.length = 0;
  });

  /**
   * This file's `useStore` mock, like the rest of RecordPage.test.tsx, is
   * stateless: `setHighlightedRecordId` is a bare spy, not a store action
   * that actually updates `state.highlightedRecordId`. The downstream
   * date-switch-and-scroll behaviour driven BY `state.highlightedRecordId`
   * is already exercised directly, with a stateful fixture, in
   * `recordJumpToHighlighted.test.tsx`. What is new and untested there is
   * the BRIDGE from the URL into that mechanism -- a fresh mount with no
   * prior in-session click, which is exactly what a reload or a direct link
   * looks like -- so that is what these assert.
   */
  it('a fresh mount with ?record=<id> in the URL resolves the id and bridges into the highlight mechanism', async () => {
    // No prior click happened in this render -- simulating a reload or a
    // direct link, not a same-session navigation.
    renderPage(
      [record({ id: 'rec-mine', time: '10:00' })],
      '/records?record=rec-mine',
    );

    await waitFor(() => expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-mine'));
  });

  it('resolves a target from a different date just as reliably as one from today', async () => {
    renderPage(
      [record({ id: 'rec-other-day', date: '2026-07-15', time: '09:00' })],
      '/records?record=rec-other-day',
    );

    await waitFor(() => expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-other-day'));
  });

  it('a missing target fails safely: one generic message, nothing invented', async () => {
    renderPage([record({ id: 'rec-mine' })], '/records?record=rec-does-not-exist');

    await waitFor(() => expect(toastLog.length).toBeGreaterThan(0));
    expect(toastLog[0].message).toBe('이 기록은 삭제되었어요.');
    // No element was fabricated to scroll to or highlight.
    expect(document.querySelector('.record-highlighted')).not.toBeInTheDocument();
  });

  it('does not judge a missing target while the shared workspace is still confirming', async () => {
    currentSyncStatus = 'unavailable';
    renderPage([], '/records?record=rec-not-loaded-yet');

    // Give any (incorrect) synchronous failure a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastLog).toEqual([]);
  });

  it('no query param at all is simply the ordinary page -- no message, no highlight', async () => {
    renderPage([record({ id: 'rec-mine' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastLog).toEqual([]);
    expect(document.querySelector('.record-highlighted')).not.toBeInTheDocument();
  });
});

/**
 * The mark control on the record itself. PRODUCT_V3 §8 requires that BOTH
 * partners can flag a shared record, so the important assertion here is the
 * one that would have been impossible under the old author-only
 * `daily_records.talk_about`: the control appears on the PARTNER's record.
 */
describe('RecordPage: 이따 이야기하기 on a record', () => {
  it('offers the mark control on the partner\'s shared record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({ id: 'rec-partner', userId: PARTNER, authorRole: 'soldier', time: '11:00' }),
    ]);
    await openRecord(user, '11:00');

    expect(await screen.findByRole('button', { name: /이따 이야기하기/ })).toBeInTheDocument();
  });

  it('offers it on the viewer\'s own shared record too', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('button', { name: /이따 이야기하기/ })).toBeInTheDocument();
  });

  it('never offers it on a private record -- there is nobody to talk to about it', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ isPrivate: true })]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /이따 이야기하기/ })).not.toBeInTheDocument();
  });

  it('marking calls the store action for that exact record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    await user.click(await screen.findByRole('button', { name: /이따 이야기하기/ }));
    await waitFor(() => expect(markTalkAbout).toHaveBeenCalledWith('rec-mine'));
    expect(unmarkTalkAbout).not.toHaveBeenCalled();
  });

  it('an already-marked record offers to unmark instead, and unmarks only the viewer\'s own flag', async () => {
    currentMarks = [{
      id: 'm1',
      recordId: 'rec-mine',
      coupleId: 'couple-1',
      actorUserId: ME,
      createdAt: `${TODAY}T11:00:00.000Z`,
      isCompleted: false,
    }];
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    const control = await screen.findByRole('button', { name: /이따 이야기하기 표시됨/ });
    expect(control).toHaveAttribute('aria-pressed', 'true');

    await user.click(control);
    await waitFor(() => expect(unmarkTalkAbout).toHaveBeenCalledWith('rec-mine'));
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('tells the viewer when the partner has also marked it', async () => {
    currentMarks = [{
      id: 'm1',
      recordId: 'rec-mine',
      coupleId: 'couple-1',
      actorUserId: PARTNER,
      createdAt: `${TODAY}T11:00:00.000Z`,
      isCompleted: false,
    }];
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByText(/몽룡도 이 기록을 표시했어요/)).toBeInTheDocument();
    // The viewer has not marked it themselves, so the control still invites them to.
    expect(screen.getByRole('button', { name: /^이따 이야기하기$/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
