import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CycleSupportSignalsFetchResult } from '@/lib/cycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const loads: Array<ReturnType<typeof deferred<CycleSupportSignalsFetchResult>>> = [];

vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/lib/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cycle')>();
  return {
    ...actual,
    fetchCycleSupportSignalsResultFromDB: () => {
      const request = deferred<CycleSupportSignalsFetchResult>();
      loads.push(request);
      return request.promise;
    },
    createCycleSupportSignalInDB: (...args: unknown[]) => createSignal(...args),
    revokeCycleSupportSignalFromDB: (...args: unknown[]) => revokeSignal(...args),
  };
});

const createSignal = vi.fn();
const revokeSignal = vi.fn();

const { CycleSupportSection } = await import('@/components/CycleSupportSection');

function signal(overrides: Partial<{
  id: string;
  coupleId: string;
  ownerId: string;
  message: string;
  expiresAt: string;
}> = {}) {
  return {
    id: overrides.id || 'signal-1',
    coupleId: overrides.coupleId || 'couple-a',
    ownerId: overrides.ownerId || 'partner-a',
    kind: 'would_like_support' as const,
    message: overrides.message || 'A private message',
    sharedForDate: '2026-08-01',
    expiresAt: overrides.expiresAt || '2026-08-01T01:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('CycleSupportSection identity and expiry isolation', () => {
  beforeEach(() => {
    loads.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores a previous account response after the active identity changes', async () => {
    const view = render(
      <CycleSupportSection role="soldier" authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));

    view.rerender(
      <CycleSupportSection role="soldier" authenticated userId="user-b" coupleId="couple-b" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(2));

    await act(async () => {
      loads[1].resolve({
        ok: true,
        signals: [signal({ id: 'signal-b', coupleId: 'couple-b', ownerId: 'partner-b', message: 'B message' })],
      });
    });
    expect(await screen.findByText('B message')).toBeInTheDocument();

    await act(async () => {
      loads[0].resolve({ ok: true, signals: [signal()] });
    });
    expect(screen.queryByText('A private message')).not.toBeInTheDocument();
    expect(screen.getByText('B message')).toBeInTheDocument();
  });

  it('removes a displayed signal when its local expiry boundary passes', async () => {
    render(
      <CycleSupportSection role="soldier" authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));

    await act(async () => {
      loads[0].resolve({
        ok: true,
        signals: [signal({ message: 'Short-lived', expiresAt: '2026-08-01T00:00:01.000Z' })],
      });
    });
    expect(await screen.findByText('Short-lived')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.queryByText('Short-lived')).not.toBeInTheDocument();
    expect(screen.getByText('오늘 공유된 응원 신호가 없어요.')).toBeInTheDocument();
  });
});

describe('CycleSupportSection write integrity', () => {
  beforeEach(() => {
    loads.length = 0;
    createSignal.mockReset();
    revokeSignal.mockReset();
    // `sharedForDate` is compared against the real Korea date, so the clock must
    // be pinned to the date the fixtures use.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render as the owner (gomsin) with an empty, loaded signal list. */
  async function renderOwnerWithShareForm() {
    const view = render(
      <CycleSupportSection role="gomsin" authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));
    await act(async () => {
      loads[0].resolve({ ok: true, signals: [] });
    });
    expect(await screen.findByText('오늘만 공유하기')).toBeInTheDocument();
    return view;
  }

  it('reports a rejected share as a permission problem, never a connection problem', async () => {
    // A `forbidden` result means the couple link is not usable for this write.
    // The old copy said "연결을 확인해 주세요", which sent the user to retry a
    // request that could never succeed.
    createSignal.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderOwnerWithShareForm();

    fireEvent.change(screen.getByLabelText(/응원 신호 \*/), {
      target: { value: 'would_like_support' },
    });
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The failed write must not appear locally successful.
    expect(screen.queryByText('오늘 공유된 신호')).not.toBeInTheDocument();
    expect(screen.getByText('오늘만 공유하기')).toBeInTheDocument();
  });

  it('reports an expired session as a session problem', async () => {
    createSignal.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    await renderOwnerWithShareForm();

    fireEvent.change(screen.getByLabelText(/응원 신호 \*/), {
      target: { value: 'resting' },
    });
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('세션이 만료되었어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    expect(screen.queryByText('오늘 공유된 신호')).not.toBeInTheDocument();
  });

  it('keeps the shared signal visible when revoking it fails', async () => {
    revokeSignal.mockResolvedValue({ ok: false, reason: 'forbidden' });
    render(
      <CycleSupportSection role="gomsin" authenticated userId="user-a" coupleId="couple-a" connected />,
    );
    await waitFor(() => expect(loads).toHaveLength(1));
    await act(async () => {
      loads[0].resolve({
        ok: true,
        signals: [signal({ ownerId: 'user-a', expiresAt: '2999-01-01T00:00:00.000Z' })],
      });
    });
    expect(await screen.findByText('공유 취소')).toBeInTheDocument();

    fireEvent.click(screen.getByText('공유 취소'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // Local state unchanged: the signal is still shared as far as the server knows.
    expect(screen.getByText('오늘 공유된 신호')).toBeInTheDocument();
  });

  it('adds the signal locally only after the server confirms it', async () => {
    createSignal.mockResolvedValue({
      ok: true,
      signal: signal({ ownerId: 'user-a', expiresAt: '2999-01-01T00:00:00.000Z' }),
    });
    await renderOwnerWithShareForm();

    fireEvent.change(screen.getByLabelText(/응원 신호 \*/), {
      target: { value: 'would_like_support' },
    });
    fireEvent.click(screen.getByText('오늘만 공유하기'));

    expect(await screen.findByText('오늘 공유된 신호')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
