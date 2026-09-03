import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    warning: vi.fn(),
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

  it('offers the saved-record list instead of retrying when partial success has no recordId', async () => {
    const failedPhoto = new File(['failed'], 'failed.jpg', { type: 'image/jpeg' });
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['failed.jpg'],
    });

    const user = await reachRetryMode([failedPhoto]);
    expect(screen.getByRole('status')).toHaveTextContent('저장된 기록을 확인');
    expect(screen.queryByRole('button', { name: '사진 다시 올리기' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '저장된 기록 보기' }));

    expect(await screen.findByText('saved records reached')).toBeInTheDocument();
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(queueRecordForLater).not.toHaveBeenCalled();
  });
});
