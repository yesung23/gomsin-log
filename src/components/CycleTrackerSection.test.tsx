import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CycleEntriesFetchResult, CycleSettingsFetchResult } from '@/lib/cycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const entryLoads: Array<ReturnType<typeof deferred<CycleEntriesFetchResult>>> = [];
const settingLoads: Array<ReturnType<typeof deferred<CycleSettingsFetchResult>>> = [];

vi.mock('@/lib/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cycle')>();
  return {
    ...actual,
    localToday: () => '2026-08-01',
    fetchCycleEntriesResultFromDB: () => {
      const request = deferred<CycleEntriesFetchResult>();
      entryLoads.push(request);
      return request.promise;
    },
    fetchCycleSettingsResultFromDB: () => {
      const request = deferred<CycleSettingsFetchResult>();
      settingLoads.push(request);
      return request.promise;
    },
  };
});

const { CycleTrackerSection } = await import('@/components/CycleTrackerSection');

describe('CycleTrackerSection identity isolation', () => {
  it('ignores a previous account load that resolves after an account switch', async () => {
    entryLoads.length = 0;
    settingLoads.length = 0;
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(entryLoads).toHaveLength(1));

    view.rerender(<CycleTrackerSection userId="user-b" />);
    await waitFor(() => expect(entryLoads).toHaveLength(2));

    await act(async () => {
      settingLoads[1].resolve({ ok: true, settings: null });
      entryLoads[1].resolve({
        ok: true,
        entries: [{
          id: 'entry-b',
          userId: 'user-b',
          startDate: '2026-08-01',
          notes: 'B only',
          symptoms: [],
        }],
      });
    });
    expect(await screen.findByText('B only')).toBeInTheDocument();

    await act(async () => {
      settingLoads[0].resolve({
        ok: true,
        settings: { userId: 'user-a', averageCycleLength: 31, averagePeriodLength: 6 },
      });
      entryLoads[0].resolve({
        ok: true,
        entries: [{
          id: 'entry-a',
          userId: 'user-a',
          startDate: '2026-08-01',
          notes: 'A secret',
          symptoms: [],
        }],
      });
    });

    expect(screen.queryByText('A secret')).not.toBeInTheDocument();
    expect(screen.getByText('B only')).toBeInTheDocument();
  });
});
