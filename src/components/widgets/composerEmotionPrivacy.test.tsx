import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

/**
 * PRODUCT_V3 §13: machine-inferred emotion is private to the author by
 * default. Leaving a suggested chip in place -- the ordinary "write, save"
 * path -- is not an explicit share action, so it must not become partner-
 * visible on its own.
 *
 * Before this change `candidatesToFlowItems` set `visibility: 'shared'` for
 * any non-private record regardless of anything the user did, so a normal
 * shared record always sent its emotion reading to the partner. This test
 * drives the real composer end to end and inspects the exact payload handed
 * to the store, not just the pure emotion-mapping function -- the earlier
 * unit coverage in `emotionRedesign.test.ts` could pass even if the composer
 * never wired the new toggle up to `toFlowItems` at all.
 */

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const queueRecordForLater = vi.fn(async () => ({ queued: true }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
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
    outboxWaiting: 0,
    outboxBlocked: 0,
    retryBlockedRecords: vi.fn(),
  }),
}));

vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => true };
});

const { TodayLogWidget } = await import('@/components/widgets/TodayLogWidget');

/** Text the rule lexicon reliably reads as anger, per emotionCandidates.ts. */
const ANGRY_TEXT = '아 진짜 짜증났어';

function render_() {
  return render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
}

async function typeAndWaitForChip(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: /한줄/ }));
  await user.type(await screen.findByLabelText('오늘의 기록'), text);
  await waitFor(() => expect(screen.getByTestId('emotion-chip-editor')).toBeInTheDocument());
}

beforeEach(() => {
  addRecordWithMedia.mockClear();
  queueRecordForLater.mockClear();
  clearAllComposerDrafts();
});

describe('composer: machine-suggested emotion defaults to author-only', () => {
  it('saving a shared record without touching the share toggle sends no shared emotion', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndWaitForChip(user, ANGRY_TEXT);
    // Default state: not private (공유하기), share toggle not touched.
    expect(screen.getByRole('button', { name: /공유하기/ })).toBeInTheDocument();
    expect(screen.getByTestId('emotion-share-toggle')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.isPrivate).toBe(false);
    expect(draft.emotionFlow.length).toBeGreaterThan(0);
    expect(draft.emotionFlow.every((item: { visibility?: string }) => item.visibility === 'author_only')).toBe(true);
  });

  it('turning the share toggle on makes the emotion partner-visible', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndWaitForChip(user, ANGRY_TEXT);
    await user.click(screen.getByTestId('emotion-share-toggle'));
    expect(screen.getByTestId('emotion-share-toggle')).toBeChecked();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.emotionFlow.length).toBeGreaterThan(0);
    expect(draft.emotionFlow.every((item: { visibility?: string }) => item.visibility === 'shared')).toBe(true);
  });

  it('a private record has no share toggle at all -- there is nothing to share', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndWaitForChip(user, ANGRY_TEXT);
    await user.click(screen.getByRole('button', { name: /공유하기/ }));
    expect(screen.getByRole('button', { name: /나만 보기/ })).toBeInTheDocument();
    expect(screen.queryByTestId('emotion-share-toggle')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.isPrivate).toBe(true);
    expect(draft.emotionFlow.every((item: { visibility?: string }) => item.visibility === 'author_only')).toBe(true);
  });

  it('the share toggle resets after a successful save, so the next record defaults private again', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndWaitForChip(user, ANGRY_TEXT);
    await user.click(screen.getByTestId('emotion-share-toggle'));
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await typeAndWaitForChip(user, ANGRY_TEXT);
    expect(screen.getByTestId('emotion-share-toggle')).not.toBeChecked();
  });
});
