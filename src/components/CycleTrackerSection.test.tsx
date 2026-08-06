import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    saveCycleEntryToDB: (...args: unknown[]) => saveEntry(...args),
    updateCycleEntryInDB: (...args: unknown[]) => updateEntry(...args),
    deleteCycleEntryFromDB: (...args: unknown[]) => deleteEntry(...args),
    saveCycleSettingsToDB: (...args: unknown[]) => saveSettings(...args),
  };
});

const saveEntry = vi.fn();
const updateEntry = vi.fn();
const deleteEntry = vi.fn();
const saveSettings = vi.fn();

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

describe('CycleTrackerSection write integrity', () => {
  beforeEach(() => {
    entryLoads.length = 0;
    settingLoads.length = 0;
    saveEntry.mockReset();
    updateEntry.mockReset();
    deleteEntry.mockReset();
    saveSettings.mockReset();
  });

  /** Render with one existing entry already loaded. */
  async function renderLoaded() {
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(entryLoads).toHaveLength(1));
    await act(async () => {
      settingLoads[0].resolve({
        ok: true,
        settings: { userId: 'user-a', averageCycleLength: 28, averagePeriodLength: 5 },
      });
      entryLoads[0].resolve({
        ok: true,
        entries: [{
          id: 'entry-a',
          userId: 'user-a',
          startDate: '2026-08-01',
          notes: 'Existing note',
          symptoms: [],
        }],
      });
    });
    expect(await screen.findByText('Existing note')).toBeInTheDocument();
    return view;
  }

  it('reports a rejected entry save as a permission problem, never a connection problem', async () => {
    // The old copy was "입력 내용과 연결을 확인해 주세요", which blamed the user's
    // input and their network for what is an RLS/permission verdict.
    saveEntry.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded();

    fireEvent.click(screen.getByText('기록 추가'));
    fireEvent.click(await screen.findByText('저장'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The form stays open and no new entry appears: nothing was committed locally.
    expect(screen.getByText('개인 기록 추가')).toBeInTheDocument();
  });

  it('reports an expired session on save as a session problem', async () => {
    saveEntry.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    await renderLoaded();

    fireEvent.click(screen.getByText('기록 추가'));
    fireEvent.click(await screen.findByText('저장'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('세션이 만료되었어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
  });

  it('keeps the entry when deleting it fails', async () => {
    deleteEntry.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded();

    fireEvent.click(screen.getByLabelText('기록 수정'));
    expect(await screen.findByText('개인 기록 수정')).toBeInTheDocument();
    // The delete control is the icon-only button inside the edit form.
    const deleteButton = screen.getByText('개인 기록 수정')
      .closest('div')?.parentElement
      ?.querySelector('button.text-destructive') as HTMLButtonElement;
    fireEvent.click(deleteButton);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // Local state unchanged: the entry the server still holds is still listed, so
    // its edit affordance is still rendered. (The note text itself appears twice
    // while the form is open -- once in the list, once in the textarea -- so the
    // per-entry control is the unambiguous signal.)
    expect(screen.getByLabelText('기록 수정')).toBeInTheDocument();
    expect(screen.getAllByText('Existing note').length).toBeGreaterThan(0);
  });

  it('reports a rejected settings save with its real cause and keeps the stored average', async () => {
    saveSettings.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded();

    fireEvent.click(screen.getByText('평균 길이 저장'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The stored average is what the server confirmed, so it must not move.
    expect(screen.getByText('저장된 평균 기간: 5일')).toBeInTheDocument();
  });

  it('commits an entry locally only after the server confirms it', async () => {
    saveEntry.mockResolvedValue({
      ok: true,
      entry: {
        id: 'entry-new',
        userId: 'user-a',
        startDate: '2026-08-01',
        notes: 'Confirmed note',
        symptoms: [],
      },
    });
    await renderLoaded();

    fireEvent.click(screen.getByText('기록 추가'));
    fireEvent.click(await screen.findByText('저장'));

    expect(await screen.findByText('Confirmed note')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
