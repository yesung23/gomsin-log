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
  retryableFailedFileIndexes?: number[];
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
const updateRecordMedia = vi.fn(
  async (_recordId: string, _changes: { addFiles: File[] }): Promise<MediaResult> => ({
    ok: true,
    failedFiles: [],
  }),
);
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
    updateRecordMedia.mockReset();
    updateRecordMedia.mockResolvedValue({ ok: true, failedFiles: [] });
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

  it('retries only the exact failed file on the same saved record even when basenames match', async () => {
    const first = new File(['first'], 'same-name.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'same-name.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['same-name.jpg'],
      retryableFailedFileIndexes: [1],
      recordId: 'record-1',
    });
    updateRecordMedia.mockResolvedValueOnce({ ok: true, failedFiles: [] });

    const { user } = await submitRecord([first, second]);
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(addRecordWithMedia.mock.calls[0]?.[1]).toEqual([first, second]);
    expect(updateRecordMedia).toHaveBeenCalledWith('record-1', { addFiles: [second] });
    expect(queueRecordForLater).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('keeps the exact failed file available when a same-record retry fails again', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['photo.jpg'],
      retryableFailedFileIndexes: [0],
      recordId: 'record-1',
    });
    updateRecordMedia
      .mockResolvedValueOnce({
        ok: true,
        failedFiles: ['photo.jpg'],
        retryableFailedFileIndexes: [0],
      })
      .mockResolvedValueOnce({ ok: true, failedFiles: [] });

    const { user } = await submitRecord([photo]);
    const retry = await screen.findByRole('button', { name: '사진 다시 올리기' });
    await user.click(retry);
    expect(updateRecordMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '사진 다시 올리기' })).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));
    expect(updateRecordMedia).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('single-flights rapid same-record retry taps', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['photo.jpg'],
      retryableFailedFileIndexes: [0],
      recordId: 'record-1',
    });
    updateRecordMedia.mockImplementationOnce(() => pending.promise);

    await submitRecord([photo]);
    const retry = await screen.findByRole('button', { name: '사진 다시 올리기' });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(updateRecordMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ok: true, failedFiles: [] });
      await pending.promise;
    });
    expect(navigate).toHaveBeenCalledWith('/home');
  });

  it('keeps the exact retry available while offline without issuing a mutation', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['photo.jpg'],
      retryableFailedFileIndexes: [0],
      recordId: 'record-1',
    });

    const { user } = await submitRecord([photo]);
    setOnline(false);
    await user.click(await screen.findByRole('button', { name: '사진 다시 올리기' }));

    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '사진 다시 올리기' })).toBeEnabled();
    expect(toastWarning).toHaveBeenCalledWith('연결되면 사진을 다시 올려 주세요.');
  });

  it('ignores a late same-record retry result after the active couple changes', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const pending = deferred<MediaResult>();
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['photo.jpg'],
      retryableFailedFileIndexes: [0],
      recordId: 'record-1',
    });
    updateRecordMedia.mockImplementationOnce(() => pending.promise);

    const { user, view } = await submitRecord([photo]);
    await user.click(await screen.findByRole('button', { name: '사진 다시 올리기' }));
    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledTimes(1));
    state.profile.couple.coupleId = 'couple-2';
    view.rerender(composer());

    await act(async () => {
      pending.resolve({ ok: true, failedFiles: [] });
      await pending.promise;
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not offer an upload retry when the result lacks exact safe indexes', async () => {
    await reachHeldState('record-1');

    expect(screen.queryByRole('button', { name: '사진 다시 올리기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장된 기록 보기' })).toBeEnabled();
  });
});
