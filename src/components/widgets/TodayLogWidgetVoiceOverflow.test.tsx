import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@/types';

/**
 * M-3: the voice-recording success toast must not fire when the file was dropped.
 *
 * `recorder.onstop` appended the recording with
 *
 *   setPendingFiles((prev) => prev.length >= MAX_ATTACHMENTS ? prev : [...prev, file]);
 *
 * so at the 4-attachment cap the file was silently discarded -- and then
 * `toast.success('음성 기록이 추가되었어요.')` fired UNCONDITIONALLY on the very
 * next line. The user was told their recording had been added while nothing was
 * attached and nothing was saved. The file-select path at the same cap already
 * did the right thing (`toast.info`), so the intended behaviour was documented in
 * the same component.
 */

const MAX_ATTACHMENTS = 4;

const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, info: toastInfo, error: toastError },
}));

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'u1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'u1',
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'c1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
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
    widgetLayout: ['dday'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: makeState(), isReady: true, addRecordWithMedia }),
}));

import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';

class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';

  /** The last constructed recorder, so a test can drive its lifecycle. */
  static last: FakeMediaRecorder | null = null;

  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;

  constructor(_stream: unknown, options: { mimeType: string }) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.last = this;
  }

  start() {
    this.state = 'recording';
  }

  /** Emit one non-empty chunk and then stop, as a real recorder does. */
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function installMediaStubs() {
  FakeMediaRecorder.last = null;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    },
  });
}

function pngFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

/** Open the composer and attach `count` photos through the normal file path. */
async function attachPhotos(user: ReturnType<typeof userEvent.setup>, count: number) {
  await user.click(screen.getByText('한줄'));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(
    input,
    Array.from({ length: count }, (_, i) => pngFile(`p${i}.png`)),
  );
}

async function recordOnce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('음성'));
  await waitFor(() => expect(FakeMediaRecorder.last).not.toBeNull());
  await act(async () => {
    FakeMediaRecorder.last!.stop();
  });
}

function renderWidget() {
  return render(
    <MemoryRouter>
      <TodayLogWidget />
    </MemoryRouter>,
  );
}

describe('M-3: a recording dropped at the attachment cap is not reported as added', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastInfo.mockReset();
    toastError.mockReset();
    addRecordWithMedia.mockClear();
    installMediaStubs();
  });

  it('does not claim success when the cap is already reached', async () => {
    const user = userEvent.setup();
    renderWidget();
    await attachPhotos(user, MAX_ATTACHMENTS);
    expect(await screen.findByText('p3.png')).toBeInTheDocument();

    await recordOnce(user);

    expect(toastSuccess).not.toHaveBeenCalledWith('음성 기록이 추가되었어요.');
  });

  it('says so instead, matching the file-select overflow copy', async () => {
    const user = userEvent.setup();
    renderWidget();
    await attachPhotos(user, MAX_ATTACHMENTS);

    await recordOnce(user);

    expect(toastInfo).toHaveBeenCalledWith(
      `첨부는 한 번에 ${MAX_ATTACHMENTS}개까지 가능해요.`,
    );
  });

  it('really did drop the file, so the toast would have been a lie', async () => {
    const user = userEvent.setup();
    renderWidget();
    await attachPhotos(user, MAX_ATTACHMENTS);

    await recordOnce(user);

    // No fifth attachment appeared in the pending list.
    expect(screen.queryByText(/^음성기록-/)).toBeNull();
  });

  it('PRESERVATION: under the cap it still attaches and still reports success', async () => {
    const user = userEvent.setup();
    renderWidget();
    await attachPhotos(user, MAX_ATTACHMENTS - 1);

    await recordOnce(user);

    expect(toastSuccess).toHaveBeenCalledWith('음성 기록이 추가되었어요.');
    expect(toastInfo).not.toHaveBeenCalled();
    expect(await screen.findByText(/^음성기록-/)).toBeInTheDocument();
  });

  it('PRESERVATION: with nothing attached it still attaches and reports success', async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByText('한줄'));

    await recordOnce(user);

    expect(toastSuccess).toHaveBeenCalledWith('음성 기록이 추가되었어요.');
    expect(await screen.findByText(/^음성기록-/)).toBeInTheDocument();
  });

  it('PRESERVATION: an empty recording still reports its own specific error', async () => {
    const user = userEvent.setup();
    renderWidget();
    await user.click(screen.getByText('한줄'));
    await user.click(screen.getByText('음성'));
    await waitFor(() => expect(FakeMediaRecorder.last).not.toBeNull());

    // Stop without ever emitting a chunk.
    await act(async () => {
      FakeMediaRecorder.last!.state = 'inactive';
      FakeMediaRecorder.last!.onstop?.();
    });

    expect(toastError).toHaveBeenCalledWith('녹음된 소리가 없어요. 다시 시도해 주세요.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
