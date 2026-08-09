import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, Role } from '@/types';
import {
  __composerDraftCountForTest,
  clearAllComposerDrafts,
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from '@/lib/composerDraft';

/**
 * An unsent composer draft must survive navigation and must never be written at
 * rest.
 *
 * Switching tabs unmounts the composer, so the text was silently thrown away --
 * and adding a fifth tab made that glance more likely, not less. The stash fixes
 * that in memory only: the diary body is the most sensitive text in the app, and
 * for an authenticated user browser storage is a strict device-preference
 * whitelist precisely so nothing content-bearing outlives a purge.
 */

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
let currentRole: Role = 'gomsin';
let userId = 'user-1';

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: userId, email: 'a@b.c', provider: 'google' },
    profile: {
      id: userId,
      myName: '춘향',
      role: currentRole,
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
      contact: { weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '12:00', weekendEnd: '21:00', enabled: true },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['today_word'],
    soldierWidgetLayout: ['today_word'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    addRecordWithMedia,
    setWidgetLayout: vi.fn(),
    setHighlightedRecordId: vi.fn(),
  }),
}));

const { TodayLogWidget } = await import('@/components/widgets/TodayLogWidget');

const PLACEHOLDER = '지금 이 순간, 어떤 생각을 하고 있나요?';
const DRAFT_TEXT = '오늘 진짜 힘들었는데 네 생각하니까 나아졌어';

function renderComposer() {
  return render(<MemoryRouter><TodayLogWidget /></MemoryRouter>);
}

describe('the draft stash itself', () => {
  beforeEach(() => clearAllComposerDrafts());
  afterEach(() => clearAllComposerDrafts());

  it('round-trips a meaningful draft', () => {
    writeComposerDraft('u1', { log: '안녕', isPrivate: true, reaction: 'good' });
    expect(readComposerDraft('u1')).toEqual({ log: '안녕', isPrivate: true, reaction: 'good' });
  });

  it('does not keep a draft that holds nothing a save could persist', () => {
    writeComposerDraft('u1', { log: '   ', isPrivate: false });
    expect(readComposerDraft('u1')).toBeNull();
    expect(__composerDraftCountForTest()).toBe(0);
  });

  it('keeps a reaction-only draft, because that is still a choice', () => {
    writeComposerDraft('u1', { log: '', isPrivate: false, reaction: 'hard' });
    expect(readComposerDraft('u1')?.reaction).toBe('hard');
  });

  it('isolates drafts per user so an account switch cannot leak unsent words', () => {
    writeComposerDraft('u1', { log: '내 비밀', isPrivate: true });
    expect(readComposerDraft('u2')).toBeNull();
  });

  it('ignores a missing user id instead of creating a shared bucket', () => {
    writeComposerDraft(undefined, { log: '떠도는 글', isPrivate: false });
    expect(__composerDraftCountForTest()).toBe(0);
    expect(readComposerDraft(undefined)).toBeNull();
  });

  it('clears one user, and clears everything on a purge', () => {
    writeComposerDraft('u1', { log: 'a', isPrivate: false });
    writeComposerDraft('u2', { log: 'b', isPrivate: false });
    clearComposerDraft('u1');
    expect(readComposerDraft('u1')).toBeNull();
    expect(readComposerDraft('u2')).not.toBeNull();
    clearAllComposerDrafts();
    expect(__composerDraftCountForTest()).toBe(0);
  });
});

describe('the composer restores an unsent draft', () => {
  beforeEach(() => {
    clearAllComposerDrafts();
    addRecordWithMedia.mockClear();
    currentRole = 'gomsin';
    userId = 'user-1';
  });
  afterEach(() => clearAllComposerDrafts());

  it('keeps the text when the composer unmounts and comes back', async () => {
    const user = userEvent.setup();
    const first = renderComposer();

    await user.click(screen.getByText('한줄'));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), DRAFT_TEXT);
    await waitFor(() => expect(readComposerDraft('user-1')?.log).toBe(DRAFT_TEXT));

    // This is what switching tabs does.
    first.unmount();

    renderComposer();
    // Reopened on its own, so a restored draft is not hidden behind a collapsed card.
    const restored = await screen.findByPlaceholderText(PLACEHOLDER);
    expect((restored as HTMLTextAreaElement).value).toBe(DRAFT_TEXT);
  });

  it('restores 나만 보기 along with the text, not just the words', async () => {
    const user = userEvent.setup();
    const first = renderComposer();

    await user.click(screen.getByText('한줄'));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), '비밀 기록');
    await user.click(screen.getByText('공유하기'));
    await waitFor(() => expect(readComposerDraft('user-1')?.isPrivate).toBe(true));

    first.unmount();
    renderComposer();
    // The privacy choice is part of the draft: restoring the words but sharing
    // them would be worse than losing them.
    expect(await screen.findByText('나만 보기')).toBeInTheDocument();
  });

  it('drops the draft once the record is actually saved', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByText('한줄'));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), DRAFT_TEXT);
    await waitFor(() => expect(readComposerDraft('user-1')).not.toBeNull());

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    await waitFor(() => expect(readComposerDraft('user-1')).toBeNull());
  });

  it('keeps the draft when the save FAILS, so nothing is lost', async () => {
    addRecordWithMedia.mockResolvedValueOnce({
      ok: false, failedFiles: [], error: '권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    } as never);
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByText('한줄'));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), DRAFT_TEXT);
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    expect(readComposerDraft('user-1')?.log).toBe(DRAFT_TEXT);
  });

  it('never shows one account the draft another account was writing', async () => {
    const user = userEvent.setup();
    const first = renderComposer();
    await user.click(screen.getByText('한줄'));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), '첫 계정의 글');
    await waitFor(() => expect(readComposerDraft('user-1')).not.toBeNull());
    first.unmount();

    // A different signed-in identity.
    userId = 'user-2';
    renderComposer();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    await user.click(screen.getByText('한줄'));
    expect((await screen.findByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value).toBe('');
  });
});
