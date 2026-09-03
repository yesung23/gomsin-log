import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';
import {
  clearAllComposerDrafts,
  readComposerDraft,
  writeComposerDraft,
} from '@/lib/composerDraft';

type MediaResult = {
  ok: boolean;
  failedFiles: string[];
  recordId?: string;
  error?: string;
  queued?: boolean;
};

const addRecordWithMedia = vi.fn(
  async (_record: unknown, _files: File[]): Promise<MediaResult> => ({
    ok: true,
    failedFiles: [],
    recordId: 'record-default',
  }),
);
const updateRecordMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const queueRecordForLater = vi.fn(async () => ({ queued: true }));
const recordProductEvent = vi.fn(async () => undefined);
const resetEmotionReview = vi.fn();
const navigate = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();

const state = {
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
    military: {
      branch: 'army',
      militaryStatus: 'unknown',
      dischargeDateSource: 'unknown',
    },
    contact: {
      weekdayStart: '18:00',
      weekdayEnd: '21:00',
      weekendStart: '12:00',
      weekendEnd: '21:00',
      enabled: true,
    },
  },
  records: [],
  events: [],
  trips: [],
  widgetLayout: ['today_word'],
  hasSeenInstallPrompt: true,
  theme: 'light',
} as unknown as AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state,
    addRecordWithMedia,
    updateRecordMedia,
    queueRecordForLater,
  }),
}));

vi.mock('@/lib/productEvents', () => ({ recordProductEvent }));

vi.mock('@/lib/useEmotionCandidates', () => ({
  useEmotionCandidatesAtBoundary: () => ({
    candidates: [],
    analyse: vi.fn(),
    reset: resetEmotionReview,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    warning: toastWarning,
    error: toastError,
  },
}));

const { ComposePage } = await import('./ComposePage');

function composer() {
  return (
    <MemoryRouter initialEntries={['/compose']}>
      <ComposePage />
    </MemoryRouter>
  );
}

function renderComposer() {
  return render(composer());
}

function photoInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('photo input not found');
  return input;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function submitRecord(files: File[] = []) {
  const user = userEvent.setup();
  const view = renderComposer();
  await user.type(screen.getByRole('textbox', { name: '오늘 남길 글' }), '이미 저장될 글');
  if (files.length > 0) await user.upload(photoInput(), files);
  await user.click(screen.getByRole('button', { name: '남기기' }));
  return { user, view };
}

async function reachHeldState(recordId: string | null = 'record-1', files?: File[]) {
  const selectedFiles = files ?? [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })];
  addRecordWithMedia.mockResolvedValueOnce({
    ok: true,
    failedFiles: [selectedFiles[0].name],
    recordId: recordId ?? undefined,
  });
  const rendered = await submitRecord(selectedFiles);
  await screen.findByRole('status');
  return rendered;
}

describe('ComposePage partial-media containment', () => {
  beforeEach(() => {
    clearAllComposerDrafts();
    setOnline(true);
    state.authenticatedUser = { id: 'user-1', email: 'a@b.c', provider: 'google' };
    state.profile.id = 'user-1';
    state.profile.couple.coupleId = 'couple-1';
    addRecordWithMedia.mockReset();
    addRecordWithMedia.mockResolvedValue({
      ok: true,
      failedFiles: [],
      recordId: 'record-default',
    });
    updateRecordMedia.mockClear();
    queueRecordForLater.mockClear();
    recordProductEvent.mockClear();
    resetEmotionReview.mockClear();
    navigate.mockClear();
    toastSuccess.mockClear();
    toastWarning.mockClear();
    toastError.mockClear();
  });

  it('holds a partial success after one create and one product event despite repeated submit clicks', async () => {
    const { user } = await reachHeldState();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('기록은 저장했어요');
    expect(status).toHaveTextContent('사진 일부는 저장 여부를 확인하지 못했어요');
    expect(status).toHaveTextContent('나중에 사진을 다시 선택');

    const submit = screen.getByRole('button', { name: '남기기' });
    expect(submit).toBeDisabled();
    await user.click(submit);
    await user.click(submit);

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
    expect(recordProductEvent).toHaveBeenCalledTimes(1);
  });

  it('never retries an upload when a partial result has commit-unknown shape', async () => {
    const commitUnknown = new File(['unknown'], 'commit-unknown.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['commit-unknown.jpg'],
      recordId: 'record-1',
      error: 'attachment response unavailable',
    });

    await submitRecord([commitUnknown]);
    await screen.findByRole('status');
    await act(async () => Promise.resolve());

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
  });

  it('opens the exact encoded saved-record destination when recordId exists', async () => {
    const { user } = await reachHeldState('record /한글?');

    await user.click(screen.getByRole('button', { name: '저장된 기록 보기' }));

    expect(navigate).toHaveBeenCalledWith(
      '/record?record=record%20%2F%ED%95%9C%EA%B8%80%3F',
    );
  });

  it('falls back to /record when a partial result has no recordId', async () => {
    const { user } = await reachHeldState(null);

    await user.click(screen.getByRole('button', { name: '저장된 기록 보기' }));

    expect(navigate).toHaveBeenCalledWith('/record');
  });

  it('keeps every mutation count unchanged when the held state goes offline', async () => {
    const { user } = await reachHeldState();
    const initialCreateCount = addRecordWithMedia.mock.calls.length;
    const initialEventCount = recordProductEvent.mock.calls.length;
    setOnline(false);

    await user.click(screen.getByRole('button', { name: '남기기' }));
    await act(async () => Promise.resolve());

    expect(addRecordWithMedia).toHaveBeenCalledTimes(initialCreateCount);
    expect(recordProductEvent).toHaveBeenCalledTimes(initialEventCount);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
  });

  it('single-flights two submit clicks in the same frame', async () => {
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockImplementationOnce(() => pending.promise);
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByRole('textbox', { name: '오늘 남길 글' }), '한 번만 저장');
    const submit = screen.getByRole('button', { name: '남기기' });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ok: true, failedFiles: [], recordId: 'record-1' });
      await pending.promise;
    });
  });

  it('does not apply late UI effects or clear the draft after unmount', async () => {
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockImplementationOnce(() => pending.promise);
    const { view } = await submitRecord();
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    expect(readComposerDraft('user-1')?.log).toBe('이미 저장될 글');

    view.unmount();
    await act(async () => {
      pending.resolve({ ok: true, failedFiles: ['photo.jpg'], recordId: 'record-1' });
      await pending.promise;
    });

    expect(readComposerDraft('user-1')?.log).toBe('이미 저장될 글');
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores completion after the authenticated user changes', async () => {
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockImplementationOnce(() => pending.promise);
    const { view } = await submitRecord();
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    state.authenticatedUser = { id: 'user-2', email: 'next@b.c', provider: 'google' };
    state.profile.id = 'user-2';
    view.rerender(composer());
    writeComposerDraft('user-2', { log: '새 사용자의 초안', isPrivate: false });

    await act(async () => {
      pending.resolve({ ok: true, failedFiles: [], recordId: 'record-1' });
      await pending.promise;
    });

    expect(readComposerDraft('user-2')?.log).toBe('새 사용자의 초안');
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores completion when authentication clears before the profile is replaced', async () => {
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockImplementationOnce(() => pending.promise);
    const { view } = await submitRecord();
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    state.authenticatedUser = null;
    view.rerender(composer());
    writeComposerDraft('user-1', { log: '로그아웃 전환 중 초안', isPrivate: false });

    await act(async () => {
      pending.resolve({ ok: true, failedFiles: [], recordId: 'record-1' });
      await pending.promise;
    });

    expect(readComposerDraft('user-1')?.log).toBe('로그아웃 전환 중 초안');
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores completion after the active couple changes without clearing its new draft', async () => {
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockImplementationOnce(() => pending.promise);
    const { view } = await submitRecord();
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    state.profile.couple.coupleId = 'couple-2';
    view.rerender(composer());
    writeComposerDraft('user-1', { log: '새 커플 문맥의 초안', isPrivate: true });

    await act(async () => {
      pending.resolve({ ok: true, failedFiles: ['photo.jpg'], recordId: 'record-1' });
      await pending.promise;
    });

    expect(readComposerDraft('user-1')?.log).toBe('새 커플 문맥의 초안');
    expect(recordProductEvent).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not reconcile or retry two selected files that share a basename', async () => {
    const first = new File(['first'], 'same-name.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'same-name.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['same-name.jpg'],
      recordId: 'record-1',
    });

    await submitRecord([first, second]);
    await screen.findByRole('status');

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(addRecordWithMedia.mock.calls[0]?.[1]).toEqual([first, second]);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: /선택한 사진/ })).not.toBeInTheDocument();
  });
});
