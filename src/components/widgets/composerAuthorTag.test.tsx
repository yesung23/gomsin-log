import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

/**
 * `ReactionType` is read by five surfaces (PartnerDayTimelineWidget,
 * CallBriefingWidget, briefing.ts, callBriefing.ts, widgetComponents.tsx) but
 * had no write path: `setReaction` was only ever called from draft restore
 * and clear. `상대방의 오늘`'s summary priority (명시 표시 > 작성자 태그 > ...)
 * therefore always fell through the top branch, because nothing could ever
 * populate it. This is the write side.
 */

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));

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
    queueRecordForLater: vi.fn(async () => ({ queued: true })),
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

beforeEach(() => {
  addRecordWithMedia.mockClear();
  clearAllComposerDrafts();
});

describe('composer: author tag picker', () => {
  it('opening the composer offers exactly the four tags every reading surface expects', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));

    const group = screen.getByRole('group', { name: '오늘 하루 태그' });
    expect(group).toBeInTheDocument();
    for (const label of ['좋았어', '이런 일이', '힘들었어', '네 생각났어']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('picking a tag alone (no text) is a valid, savable record', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));

    const saveButton = screen.getByRole('button', { name: /남기기|저장/ });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /좋았어/ }));
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    expect(addRecordWithMedia.mock.calls[0][0]).toMatchObject({ reaction: 'good', log: '' });
  });

  it('a second tap deselects the tag (toggle, not radio-forced)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));

    const good = screen.getByRole('button', { name: /좋았어/ });
    await user.click(good);
    expect(good).toHaveAttribute('aria-pressed', 'true');
    await user.click(good);
    expect(good).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting a different tag replaces the previous one -- exactly one at a time', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));

    await user.click(screen.getByRole('button', { name: /좋았어/ }));
    await user.click(screen.getByRole('button', { name: /힘들었어/ }));
    expect(screen.getByRole('button', { name: /좋았어/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /힘들었어/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the tag clears after a successful save, matching text/attachment behaviour', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await user.click(screen.getByRole('button', { name: /네 생각났어/ }));
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /한줄/ }));
    expect(screen.getByRole('button', { name: /네 생각났어/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a tag is not required -- text alone still saves with no reaction', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /한줄/ }));
    await user.type(screen.getByLabelText('오늘의 기록'), '그냥 하루');
    await user.click(screen.getByRole('button', { name: /남기기|저장/ }));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    expect(addRecordWithMedia.mock.calls[0][0].reaction).toBeUndefined();
  });
});
