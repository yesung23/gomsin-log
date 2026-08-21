import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

/**
 * PRODUCT_V3 §13: machine-inferred emotion is private to the author by
 * default, and becoming the author's own feeling -- let alone the partner's
 * view of it -- takes an affirmative act, not the absence of a refusal.
 *
 * Two separate defects have been closed here, and this file guards both.
 *
 *  1. `candidatesToFlowItems` once set `visibility: 'shared'` for any
 *     non-private record regardless of what the user did, so every shared
 *     record sent its reading to the partner.
 *  2. It then stamped every surviving candidate `user_confirmed`, so an entry
 *     written and saved without ever opening the feelings row filed the
 *     machine's guess as the author's answer -- and turning the share switch
 *     on published guesses the author had never read.
 *
 * These drive the real composer end to end and inspect the exact payload handed
 * to the store, not just the pure mapping function -- the unit coverage in
 * `emotionRedesign.test.ts` could pass even if the composer never wired the
 * confirmation up to `toFlowItems` at all.
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

/**
 * Write an entry and reach the composition boundary.
 *
 * The blur is the point: the analyser no longer runs on a typing debounce, so a
 * test that only types would assert against a suggestion list the app has
 * deliberately not produced yet.
 */
async function typeAndSettle(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole('button', { name: /한줄/ }));
  await user.type(await screen.findByLabelText('오늘의 기록'), text);
  await user.tab();
  await waitFor(() => expect(screen.getByTestId('emotion-suggestion-review')).toBeInTheDocument());
}

/** Answer every reading the app offered. The "다 맞아요" path, or a single 맞아요. */
async function answerEverySuggestion(user: ReturnType<typeof userEvent.setup>) {
  const confirmAll = screen.queryByTestId('emotion-suggestion-confirm-all');
  if (confirmAll) {
    await user.click(confirmAll);
    return;
  }
  const buttons = screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('data-testid')?.startsWith('emotion-suggestion-confirm-'));
  for (const button of buttons) await user.click(button);
}

beforeEach(() => {
  addRecordWithMedia.mockClear();
  queueRecordForLater.mockClear();
  clearAllComposerDrafts();
});

describe('composer: machine-suggested emotion defaults to author-only', () => {
  it('saving without answering the suggestion stores no emotion at all', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndSettle(user, ANGRY_TEXT);
    // The app has read the entry and is asking about it. Nothing is answered.
    expect(screen.getByTestId('emotion-suggestion-review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /공유하기/ })).toBeInTheDocument();
    expect(screen.getByTestId('emotion-share-toggle')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.isPrivate).toBe(false);
    // A guess nobody agreed with is not this person's feeling.
    expect(draft.emotionFlow).toEqual([]);
  });

  it('turning the share toggle on cannot publish an unanswered reading', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndSettle(user, ANGRY_TEXT);
    await user.click(screen.getByTestId('emotion-share-toggle'));
    expect(screen.getByTestId('emotion-share-toggle')).toBeChecked();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.emotionFlow).toEqual([]);
  });

  it('an answered reading is stored, and stays author-only until the toggle is on', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndSettle(user, ANGRY_TEXT);
    await answerEverySuggestion(user);
    expect(screen.getByTestId('emotion-share-toggle')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.isPrivate).toBe(false);
    expect(draft.emotionFlow.length).toBeGreaterThan(0);
    expect(draft.emotionFlow.every((item: { source?: string }) => item.source === 'user_confirmed')).toBe(true);
    expect(draft.emotionFlow.every((item: { visibility?: string }) => item.visibility === 'author_only')).toBe(true);
  });

  it('an answered reading plus the share toggle is what makes it partner-visible', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndSettle(user, ANGRY_TEXT);
    await answerEverySuggestion(user);
    await user.click(screen.getByTestId('emotion-share-toggle'));

    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const draft = addRecordWithMedia.mock.calls[0][0];
    expect(draft.emotionFlow.length).toBeGreaterThan(0);
    expect(draft.emotionFlow.every((item: { visibility?: string }) => item.visibility === 'shared')).toBe(true);
  });

  it('a private record has no share toggle at all -- there is nothing to share', async () => {
    const user = userEvent.setup();
    render_();

    await typeAndSettle(user, ANGRY_TEXT);
    await answerEverySuggestion(user);
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

    await typeAndSettle(user, ANGRY_TEXT);
    await answerEverySuggestion(user);
    await user.click(screen.getByTestId('emotion-share-toggle'));
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await typeAndSettle(user, ANGRY_TEXT);
    expect(screen.getByTestId('emotion-share-toggle')).not.toBeChecked();
  });
});
