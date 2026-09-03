import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AppState } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

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
const updateRecordMedia = vi.fn(
  async (_recordId: string, _changes: { addFiles: File[] }): Promise<MediaResult> => ({
    ok: true,
    failedFiles: [],
  }),
);
const queueRecordForLater = vi.fn(async () => ({ queued: true }));
const recordProductEvent = vi.fn(async () => undefined);
const resetEmotionReview = vi.fn();
const toastWarning = vi.fn();

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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: toastWarning,
    error: vi.fn(),
  },
}));

const { ComposePage } = await import('./ComposePage');

function renderComposer() {
  return render(
    <MemoryRouter initialEntries={['/compose']}>
      <Routes>
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/home" element={<p>home reached</p>} />
        <Route path="/record" element={<p>records reached</p>} />
        <Route path="/saved" element={<p>saved records reached</p>} />
      </Routes>
    </MemoryRouter>,
  );
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

async function reachRetryMode(files: File[]) {
  const user = userEvent.setup();
  renderComposer();
  await user.type(screen.getByRole('textbox', { name: '오늘 남길 글' }), '이미 저장될 글');
  await user.upload(photoInput(), files);
  await user.click(screen.getByRole('button', { name: '남기기' }));
  await screen.findByRole('status');
  return user;
}

describe('ComposePage exact-row photo retry', () => {
  beforeEach(() => {
    clearAllComposerDrafts();
    setOnline(true);
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
    toastWarning.mockClear();
  });

  it('reattaches a failed photo to record-1 without creating or counting another record', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    const uploadedPhoto = new File(['uploaded'], 'uploaded.png', { type: 'image/png' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['failed.jpg'],
      recordId: 'record-1',
    });

    const user = await reachRetryMode([failedPhoto, uploadedPhoto]);
    expect(screen.getByAltText('선택한 사진 1')).toBeInTheDocument();
    expect(screen.queryByAltText('선택한 사진 2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));

    await screen.findByText('home reached');
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).toHaveBeenCalledWith('record-1', { addFiles: [failedPhoto] });
    expect(queueRecordForLater).not.toHaveBeenCalled();
    expect(recordProductEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps record-1 and only the still-failed photo through a partial retry and a retry failure', async () => {
    const firstPhoto = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
    const secondPhoto = new File(['second'], 'second.png', { type: 'image/png' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['first.jpg', 'second.png'],
      recordId: 'record-1',
    });
    updateRecordMedia
      .mockResolvedValueOnce({ ok: true, failedFiles: ['second.png'] })
      .mockResolvedValueOnce({
        ok: false,
        failedFiles: ['second.png'],
        error: '사진을 다시 올리지 못했어요.',
      });

    const user = await reachRetryMode([firstPhoto, secondPhoto]);
    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledTimes(1));
    expect(screen.getByAltText('선택한 사진 1')).toBeInTheDocument();
    expect(screen.queryByAltText('선택한 사진 2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledTimes(2));
    expect(updateRecordMedia.mock.calls[0]).toEqual([
      'record-1',
      { addFiles: [firstPhoto, secondPhoto] },
    ]);
    expect(updateRecordMedia.mock.calls[1]).toEqual([
      'record-1',
      { addFiles: [secondPhoto] },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('같은 기록');
    expect(screen.getByAltText('선택한 사진 1')).toBeInTheDocument();
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
  });

  it('does not create, queue, or update anything when the exact-row retry is offline', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['failed.jpg'],
      recordId: 'record-1',
    });

    const user = await reachRetryMode([failedPhoto]);
    setOnline(false);
    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));

    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('같은 기록');
    expect(screen.queryByText('home reached')).not.toBeInTheDocument();
  });

  it('locks non-media controls during retry, but removing the last photo restores an ordinary save', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    addRecordWithMedia
      .mockResolvedValueOnce({
        ok: true,
        failedFiles: ['failed.jpg'],
        recordId: 'record-1',
      })
      .mockResolvedValueOnce({
        ok: true,
        failedFiles: [],
        recordId: 'record-2',
      });

    const user = await reachRetryMode([failedPhoto]);
    expect(screen.getByRole('status')).toHaveTextContent('사진 1장만 같은 기록에 다시 올려요');
    expect(screen.getByRole('textbox', { name: '오늘 남길 글' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '기뻤어' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '우리에게 공유' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /사진 1장 · 더하기/ })).toBeDisabled();

    const remove = screen.getByRole('button', { name: '선택한 사진 1 빼기' });
    expect(remove).not.toBeDisabled();
    await user.click(remove);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '오늘 남길 글' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '사진 더하기' })).not.toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: '오늘 남길 글' }), '새로운 기록');
    await user.click(screen.getByRole('button', { name: '남기기' }));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(2));
    expect(updateRecordMedia).not.toHaveBeenCalled();
  });

  it('keeps removal and ordinary compose disabled until an in-flight media retry settles', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['failed.jpg'],
      recordId: 'record-1',
    });
    let settleRetry: ((result: MediaResult) => void) | undefined;
    updateRecordMedia.mockImplementationOnce(
      () => new Promise((resolve) => {
        settleRetry = resolve;
      }),
    );

    const user = await reachRetryMode([failedPhoto]);
    const remove = screen.getByRole('button', { name: '선택한 사진 1 빼기' });
    expect(remove).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: '사진 다시 올리기' }));
    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledTimes(1));

    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(screen.getByRole('status')).toHaveTextContent('같은 기록');

    const text = screen.getByRole('textbox', { name: '오늘 남길 글' });
    expect(text).toHaveAttribute('readonly');
    await user.type(text, '늦은 성공이 지우면 안 되는 새 글');
    expect(text).toHaveValue('');
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleRetry?.({ ok: true, failedFiles: [] });
    });
    expect(await screen.findByText('home reached')).toBeInTheDocument();
  });

  it('keeps only the first photo when one selection batch contains duplicate basenames', async () => {
    const first = new File(['first'], 'same-name.jpg', { type: 'image/jpeg' });
    const duplicate = new File(['duplicate'], 'same-name.jpg', { type: 'image/jpeg' });
    const user = userEvent.setup();
    renderComposer();

    await user.upload(photoInput(), [first, duplicate]);

    expect(screen.getAllByRole('img', { name: /선택한 사진/ })).toHaveLength(1);
    expect(toastWarning).toHaveBeenCalledWith(
      'same-name.jpg: 같은 이름의 사진은 한 번만 선택할 수 있어요.',
    );

    await user.click(screen.getByRole('button', { name: '남기기' }));
    await screen.findByText('home reached');
    expect(addRecordWithMedia.mock.calls[0]?.[1]).toEqual([first]);
  });

  it('rejects a duplicate basename against existing selection while accepting a new valid photo', async () => {
    const existing = new File(['existing'], 'same-name.jpg', { type: 'image/jpeg' });
    const duplicate = new File(['duplicate'], 'same-name.jpg', { type: 'image/jpeg' });
    const unique = new File(['unique'], 'unique.png', { type: 'image/png' });
    const user = userEvent.setup();
    renderComposer();

    await user.upload(photoInput(), existing);
    await user.upload(photoInput(), [duplicate, unique]);

    expect(screen.getAllByRole('img', { name: /선택한 사진/ })).toHaveLength(2);
    expect(toastWarning).toHaveBeenCalledWith(
      'same-name.jpg: 같은 이름의 사진은 한 번만 선택할 수 있어요.',
    );

    await user.click(screen.getByRole('button', { name: '남기기' }));
    await screen.findByText('home reached');
    expect(addRecordWithMedia.mock.calls[0]?.[1]).toEqual([existing, unique]);
  });

  it('offers the records screen instead of retrying when partial success has no recordId', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['failed.jpg'],
    });

    const user = await reachRetryMode([failedPhoto]);
    expect(screen.getByRole('status')).toHaveTextContent('저장된 기록을 확인');
    expect(screen.queryByRole('button', { name: '사진 다시 올리기' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '저장된 기록 보기' }));

    expect(await screen.findByText('records reached')).toBeInTheDocument();
    expect(screen.queryByText('saved records reached')).not.toBeInTheDocument();
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
  });
});
