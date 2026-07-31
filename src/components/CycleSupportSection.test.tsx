import { act, render, screen, waitFor } from '@testing-library/react';
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
    createCycleSupportSignalInDB: vi.fn(),
    revokeCycleSupportSignalFromDB: vi.fn(),
  };
});

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
