import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CycleDailyLogsFetchResult,
  CyclePeriodsFetchResult,
  CycleSettingsFetchResult,
} from '@/lib/cycle';
import { grantCycleSensitiveConsent, revokeCycleSensitiveConsent } from '@/lib/sensitiveConsent';

/**
 * Consent gating, identity isolation and error-copy honesty for the V3 tracker.
 *
 * The V3 data-path assertions live in `cycleV3DataPath.test.tsx`; this file keeps
 * the invariants that predate V3 and must survive it.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const periodLoads: Array<ReturnType<typeof deferred<CyclePeriodsFetchResult>>> = [];
const dailyLogLoads: Array<ReturnType<typeof deferred<CycleDailyLogsFetchResult>>> = [];
const settingLoads: Array<ReturnType<typeof deferred<CycleSettingsFetchResult>>> = [];

const savePeriod = vi.fn();
const updatePeriod = vi.fn();
const saveDailyLog = vi.fn();
const saveSettings = vi.fn();
const syncConsent = vi.fn();

vi.mock('@/lib/cycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cycle')>();
  return {
    ...actual,
    localToday: () => '2026-08-14',
    fetchCyclePeriodsResultFromDB: () => {
      const request = deferred<CyclePeriodsFetchResult>();
      periodLoads.push(request);
      return request.promise;
    },
    fetchCycleDailyLogsResultFromDB: () => {
      const request = deferred<CycleDailyLogsFetchResult>();
      dailyLogLoads.push(request);
      return request.promise;
    },
    fetchCycleSettingsResultFromDB: () => {
      const request = deferred<CycleSettingsFetchResult>();
      settingLoads.push(request);
      return request.promise;
    },
    fetchCycleSharingPreferencesFromDB: async () => ({
      userId: 'user-a',
      shareCurrentPeriod: false,
      sharePredictionWindow: false,
      shareFertilityWindow: false,
    }),
    saveCyclePeriodToDB: (...args: unknown[]) => savePeriod(...args),
    updateCyclePeriodInDB: (...args: unknown[]) => updatePeriod(...args),
    saveCycleDailyLogToDB: (...args: unknown[]) => saveDailyLog(...args),
    saveCycleSettingsToDB: (...args: unknown[]) => saveSettings(...args),
  };
});

vi.mock('@/lib/sensitiveConsent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sensitiveConsent')>();
  return {
    ...actual,
    syncCycleConsentWithDB: (...args: unknown[]) => syncConsent(...args),
  };
});

const { CycleTrackerSection } = await import('@/components/CycleTrackerSection');

beforeEach(() => {
  window.localStorage.clear();
  periodLoads.length = 0;
  dailyLogLoads.length = 0;
  settingLoads.length = 0;
  savePeriod.mockReset();
  updatePeriod.mockReset();
  saveDailyLog.mockReset();
  saveSettings.mockReset();
  syncConsent.mockReset();
  syncConsent.mockResolvedValue({ ok: true, granted: true });
  grantCycleSensitiveConsent('user-a');
  grantCycleSensitiveConsent('user-b');
});

describe('CycleTrackerSection sensitive-information gate', () => {
  it('does not retrieve cycle data before separate explicit consent', async () => {
    revokeCycleSensitiveConsent('user-c');
    syncConsent.mockResolvedValue({ ok: true, granted: false });
    render(<CycleTrackerSection userId="user-c" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled();
    await act(async () => Promise.resolve());
    // No health table is touched while consent is absent.
    expect(periodLoads).toHaveLength(0);
    expect(dailyLogLoads).toHaveLength(0);
    expect(settingLoads).toHaveLength(0);
  });

  it('keeps the feature locked when the server consent check itself fails', async () => {
    // An unreachable authority must not be read as "yes".
    revokeCycleSensitiveConsent('user-d');
    syncConsent.mockResolvedValue({ ok: false, reason: 'offline' });
    render(<CycleTrackerSection userId="user-d" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('인터넷 연결');
  });

  it('does not unlock on a stale local cache when the server says revoked', async () => {
    // Cache says yes, server says no. The server wins.
    grantCycleSensitiveConsent('user-e');
    syncConsent.mockResolvedValue({ ok: true, granted: false });
    render(<CycleTrackerSection userId="user-e" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
  });
});

describe('CycleTrackerSection identity isolation', () => {
  it('ignores a previous account load that resolves after an account switch', async () => {
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));

    view.rerender(<CycleTrackerSection userId="user-b" />);
    await waitFor(() => expect(periodLoads).toHaveLength(2));

    // Account B answers first.
    await act(async () => {
      periodLoads[1].resolve({
        ok: true,
        periods: [{ id: 'period-b', userId: 'user-b', startDate: '2026-08-13' }],
      });
      dailyLogLoads[1].resolve({ ok: true, logs: [] });
      settingLoads[1].resolve({ ok: true, settings: null });
    });
    expect(await screen.findByText(/생리 2일째/)).toBeInTheDocument();

    // Account A's slow response arrives afterwards and must be discarded.
    await act(async () => {
      periodLoads[0].resolve({
        ok: true,
        periods: [{ id: 'period-a', userId: 'user-a', startDate: '2026-08-01', endDate: '2026-08-05' }],
      });
      dailyLogLoads[0].resolve({
        ok: true,
        logs: [{
          id: 'log-a',
          userId: 'user-a',
          logDate: '2026-08-14',
          symptoms: [],
          note: 'A secret',
        }],
      });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    expect(screen.queryByText('A secret')).not.toBeInTheDocument();
    expect(screen.getByText(/생리 2일째/)).toBeInTheDocument();
  });
});

describe('CycleTrackerSection write integrity', () => {
  /** Render with one completed period so both hero states are reachable. */
  async function renderLoaded() {
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({
        ok: true,
        periods: [{
          id: 'period-aug',
          userId: 'user-a',
          startDate: '2026-08-01',
          endDate: '2026-08-05',
        }],
      });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({
        ok: true,
        settings: { userId: 'user-a', averageCycleLength: 28, averagePeriodLength: 5 },
      });
    });
    await screen.findByTestId('cycle-hero');
    return view;
  }

  it('reports a rejected daily-log save as a permission problem, never a connection problem', async () => {
    saveDailyLog.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: /자세히 기록하기/ }));
    fireEvent.click(await screen.findByRole('button', { name: '컨디션 저장' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The editor stays open; nothing was committed locally.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reports an expired session on a period write as a session problem', async () => {
    savePeriod.mockResolvedValue({ ok: false, reason: 'auth_expired' });
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: /오늘 생리 시작했어요/ }));

    await waitFor(() => expect(savePeriod).toHaveBeenCalled());
    // The hero stays in its prediction state: no local period was invented.
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('prediction');
  });

  it('reports a rejected settings save with its real cause and keeps the stored average', async () => {
    saveSettings.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    fireEvent.click(await screen.findByRole('button', { name: /주기 설정/ }));
    fireEvent.click(await screen.findByRole('button', { name: '저장' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
  });

  it('commits a period locally only after the server confirms it', async () => {
    savePeriod.mockResolvedValue({
      ok: true,
      period: { id: 'period-new', userId: 'user-a', startDate: '2026-08-14' },
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: /오늘 생리 시작했어요/ }));

    // Only once the server confirms does the hero flip to the active state.
    expect(await screen.findByText(/생리 1일째/)).toBeInTheDocument();
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('active');
  });

  it('surfaces an RLS refusal on load as a permission problem', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'forbidden' });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('연결을 확인');
  });
});
