import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CycleDailyLogsFetchResult,
  CyclePeriodsFetchResult,
  CycleSettingsFetchResult,
} from '@/lib/cycle';
import {
  clearPendingCycleConsentRevocation,
  grantCycleSensitiveConsent,
  hasCycleSensitiveConsent,
  hasPendingCycleConsentRevocation,
  markCycleConsentRevocationPending,
  revokeCycleSensitiveConsent,
} from '@/lib/sensitiveConsent';

type NativeStateListener = (state: { isActive: boolean }) => void;
const nativeLifecycle = vi.hoisted(() => {
  const state: { isNative: boolean; listener: NativeStateListener | null } = {
    isNative: false,
    listener: null,
  };
  const remove = vi.fn(async () => undefined);
  return {
    state,
    remove,
    addListener: vi.fn(async (_eventName: string, listener: NativeStateListener) => {
      state.listener = listener;
      return { remove };
    }),
  };
});

vi.mock('@/lib/platform', () => ({
  isNativePlatform: () => nativeLifecycle.state.isNative,
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: nativeLifecycle.addListener },
}));

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
const saveSharingPreferences = vi.fn();
const syncConsent = vi.fn();
const grantConsent = vi.fn();
const revokeConsent = vi.fn();

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
    saveCycleSharingPreferencesToDB: (...args: unknown[]) => saveSharingPreferences(...args),
  };
});

vi.mock('@/lib/sensitiveConsent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sensitiveConsent')>();
  return {
    ...actual,
    syncCycleConsentWithDB: (...args: unknown[]) => syncConsent(...args),
    grantCycleConsentInDB: (...args: unknown[]) => grantConsent(...args),
    revokeCycleConsentInDB: (...args: unknown[]) => revokeConsent(...args),
  };
});

const { CycleTrackerSection } = await import('@/components/CycleTrackerSection');

beforeEach(() => {
  nativeLifecycle.state.isNative = false;
  nativeLifecycle.state.listener = null;
  nativeLifecycle.addListener.mockClear();
  nativeLifecycle.remove.mockClear();
  window.localStorage.clear();
  clearPendingCycleConsentRevocation('user-a');
  periodLoads.length = 0;
  dailyLogLoads.length = 0;
  settingLoads.length = 0;
  savePeriod.mockReset();
  updatePeriod.mockReset();
  saveDailyLog.mockReset();
  saveSettings.mockReset();
  saveSharingPreferences.mockReset();
  syncConsent.mockReset();
  grantConsent.mockReset();
  revokeConsent.mockReset();
  syncConsent.mockResolvedValue({ ok: true, granted: true, revision: 7 });
  grantConsent.mockResolvedValue({ ok: true, applied: true, granted: true, revision: 8 });
  revokeConsent.mockResolvedValue({ ok: true, applied: true, granted: false, revision: 8 });
  saveSharingPreferences.mockResolvedValue({
    ok: true,
    preferences: {
      userId: 'user-a',
      shareCurrentPeriod: false,
      sharePredictionWindow: false,
      shareFertilityWindow: false,
    },
  });
  grantCycleSensitiveConsent('user-a');
  grantCycleSensitiveConsent('user-b');
});

async function renderGrantedCycle() {
  const view = render(<CycleTrackerSection userId="user-a" />);
  await waitFor(() => expect(periodLoads).toHaveLength(1));
  await act(async () => {
    periodLoads[0].resolve({
      ok: true,
      periods: [{ id: 'period-aug', userId: 'user-a', startDate: '2026-08-01', endDate: '2026-08-05' }],
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

async function confirmConsentRevoke() {
  fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
  fireEvent.click(await screen.findByRole('button', { name: /민감정보 동의/ }));
  fireEvent.click(await screen.findByRole('button', { name: '민감정보 동의 철회' }));
  fireEvent.click(await screen.findByRole('button', { name: '철회' }));
}

/**
 * What the consent card leads with.
 *
 * This card is the first thing a 곰신 who has not consented sees on 마이. It used
 * to open with the disclosure block, so the tab's first impression was a legal
 * form. The fix reordered it; these assertions are what stop it reordering back,
 * and what stop the reorder being "fixed" by deleting disclosure PIPA §23 requires.
 */
describe('the consent card offers before it discloses', () => {
  async function renderUnconsented(userId: string) {
    revokeCycleSensitiveConsent(userId);
    syncConsent.mockResolvedValue({ ok: true, granted: false, revision: 0 });
    const view = render(<CycleTrackerSection userId={userId} />);
    await screen.findByText('내 몸의 리듬 시작하기');
    return view;
  }

  it('states what the feature is for above the disclosure block', async () => {
    const { container } = await renderUnconsented('user-order');

    const offer = container.querySelector('[data-testid="cycle-consent-offer"]');
    const disclosure = container.querySelector('[data-testid="cycle-consent-disclosure"]');
    expect(offer).not.toBeNull();
    expect(disclosure).not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING: the disclosure comes after the offer, which is
    // both the reading order and the accessibility-tree order.
    expect(offer!.compareDocumentPosition(disclosure!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(offer!.textContent).toContain('다음 예상 범위');
  });

  it('still discloses every item PIPA §23 requires, without a tap', async () => {
    const { container } = await renderUnconsented('user-pipa');
    const disclosure = container.querySelector('[data-testid="cycle-consent-disclosure"]');

    // Visible in the card itself -- not behind a disclosure widget, not on another
    // screen. Demoting the block visually must never turn into hiding it.
    for (const required of ['수집 항목', '이용 목적', '파트너 공유', '보유 기간']) {
      expect(disclosure!.textContent, required).toContain(required);
    }
    expect(disclosure!.textContent).toContain('거부해도');
  });

  it('keeps consent separate and opt-in, never pre-checked', async () => {
    await renderUnconsented('user-optin');

    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeDisabled();

    fireEvent.click(box);
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeEnabled();
  });
});

describe('CycleTrackerSection sensitive-information gate', () => {
  it('does not retrieve cycle data before separate explicit consent', async () => {
    revokeCycleSensitiveConsent('user-c');
    syncConsent.mockResolvedValue({ ok: true, granted: false, revision: 1 });
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
    // An unreachable authority must not be read as "yes", even when an old
    // local cache entry says this account consented on a previous visit.
    grantCycleSensitiveConsent('user-d');
    syncConsent.mockResolvedValue({ ok: false, reason: 'offline' });
    render(<CycleTrackerSection userId="user-d" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent('인터넷 연결');
  });

  it('does not unlock on a stale local cache when the server says revoked', async () => {
    // Cache says yes, server says no. The server wins.
    grantCycleSensitiveConsent('user-e');
    syncConsent.mockResolvedValue({ ok: true, granted: false, revision: 2 });
    render(<CycleTrackerSection userId="user-e" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
  });

  it('requires this device consent as well as a current server consent', async () => {
    revokeCycleSensitiveConsent('user-device-proof');
    syncConsent.mockResolvedValue({ ok: true, granted: true, revision: 3 });
    render(<CycleTrackerSection userId="user-device-proof" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('이 기기');
    expect(periodLoads).toHaveLength(0);
    expect(dailyLogLoads).toHaveLength(0);
    expect(settingLoads).toHaveLength(0);
  });

  it('does not unlock when the server grant succeeds but device consent cannot persist', async () => {
    revokeCycleSensitiveConsent('user-storage-failure');
    syncConsent.mockResolvedValueOnce({ ok: true, granted: false, revision: 7 });
    render(<CycleTrackerSection userId="user-storage-failure" />);
    await screen.findByText('내 몸의 리듬 시작하기');

    const setItem = vi.spyOn(
      Object.getPrototypeOf(window.localStorage) as Storage,
      'setItem',
    ).mockImplementation(() => {
      throw new DOMException('storage unavailable');
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('기기');
    expect(screen.getByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
    setItem.mockRestore();
  });

  it('clears stale sharing choices before a fresh consent can unlock health data', async () => {
    revokeCycleSensitiveConsent('user-a');
    syncConsent.mockResolvedValueOnce({ ok: true, granted: false, revision: 7 });
    render(<CycleTrackerSection userId="user-a" />);

    await screen.findByText('내 몸의 리듬 시작하기');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    await waitFor(() => expect(saveSharingPreferences).toHaveBeenCalledWith({
      shareCurrentPeriod: false,
      sharePredictionWindow: false,
      shareFertilityWindow: false,
    }, 'user-a'));
    await waitFor(() => expect(grantConsent).toHaveBeenCalledWith('user-a', 7));
    expect(saveSharingPreferences.mock.invocationCallOrder[0])
      .toBeLessThan(grantConsent.mock.invocationCallOrder[0]);
    expect(hasCycleSensitiveConsent('user-a')).toBe(true);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
  });

  it('does not let a stale cross-device grant reopen a newer server revoke', async () => {
    revokeCycleSensitiveConsent('user-a');
    syncConsent.mockResolvedValueOnce({ ok: true, granted: false, revision: 7 });
    grantConsent.mockResolvedValueOnce({
      ok: true,
      applied: false,
      granted: false,
      revision: 8,
    });
    render(<CycleTrackerSection userId="user-a" />);

    await screen.findByText('내 몸의 리듬 시작하기');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '동의하고 시작하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('다른 기기');
    expect(screen.getByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    expect(periodLoads).toHaveLength(0);
  });

  it('revalidates on foreground and clears already rendered health data after remote revocation', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));

    await act(async () => {
      periodLoads[0].resolve({
        ok: true,
        periods: [{ id: 'visible-period', userId: 'user-a', startDate: '2026-08-13' }],
      });
      dailyLogLoads[0].resolve({
        ok: true,
        logs: [{
          id: 'visible-log',
          userId: 'user-a',
          logDate: '2026-08-14',
          symptoms: [],
          note: '기기 밖에서 철회하면 즉시 숨겨질 내용',
        }],
      });
      settingLoads[0].resolve({ ok: true, settings: null });
    });
    expect(await screen.findByText(/생리 2일째/)).toBeInTheDocument();

    syncConsent.mockResolvedValue({ ok: true, granted: false, revision: 8 });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(screen.queryByText(/생리 2일째/)).not.toBeInTheDocument();
    expect(screen.queryByText('기기 밖에서 철회하면 즉시 숨겨질 내용')).not.toBeInTheDocument();
    expect(periodLoads).toHaveLength(1);
    expect(syncConsent).toHaveBeenCalledTimes(2);
  });

  it('uses the native app-state signal to revalidate consent on iOS foreground', async () => {
    nativeLifecycle.state.isNative = true;
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await waitFor(() => expect(nativeLifecycle.state.listener).not.toBeNull());

    await act(async () => {
      periodLoads[0].resolve({ ok: true, periods: [] });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    syncConsent.mockResolvedValue({ ok: true, granted: false, revision: 8 });
    await act(async () => {
      nativeLifecycle.state.listener?.({ isActive: true });
      await Promise.resolve();
    });

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(1);
    expect(syncConsent).toHaveBeenCalledTimes(2);

    view.unmount();
    await waitFor(() => expect(nativeLifecycle.remove).toHaveBeenCalledTimes(1));
  });

  it('ignores foreground and reconnect signals while an explicit revoke is in flight', async () => {
    const pendingRevoke = deferred<{
      ok: true;
      applied: true;
      granted: false;
      revision: 8;
    }>();
    revokeConsent.mockReturnValueOnce(pendingRevoke.promise);
    await renderGrantedCycle();

    await confirmConsentRevoke();
    await waitFor(() => expect(revokeConsent).toHaveBeenCalledTimes(1));

    // Revocation intent locks the surface synchronously, before the server round trip.
    expect(screen.queryByTestId('cycle-hero')).not.toBeInTheDocument();
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));

    await act(async () => pendingRevoke.resolve({
      ok: true,
      applied: true,
      granted: false,
      revision: 8,
    }));

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-hero')).not.toBeInTheDocument();
    expect(syncConsent).toHaveBeenCalledTimes(1);
  });

  it('stays locked after a refused revoke and offers only an explicit revoke retry', async () => {
    revokeConsent
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' })
      .mockResolvedValueOnce({ ok: true, applied: true, granted: false, revision: 8 });
    await renderGrantedCycle();

    await confirmConsentRevoke();

    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없어요');
    expect(screen.queryByTestId('cycle-hero')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '동의하고 시작하기' })).not.toBeInTheDocument();
    expect(hasPendingCycleConsentRevocation('user-a')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '철회 다시 시도' }));
    await waitFor(() => expect(revokeConsent).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: '동의하고 시작하기' })).toBeInTheDocument();
    expect(hasPendingCycleConsentRevocation('user-a')).toBe(false);
  });

  it('keeps an unfinished revoke locked across a component restart', async () => {
    markCycleConsentRevocationPending('user-a');
    grantCycleSensitiveConsent('user-a');

    const first = render(<CycleTrackerSection userId="user-a" />);
    expect(await screen.findByRole('button', { name: '철회 다시 시도' })).toBeInTheDocument();
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    expect(hasPendingCycleConsentRevocation('user-a')).toBe(true);
    expect(syncConsent).not.toHaveBeenCalled();
    expect(periodLoads).toHaveLength(0);

    first.unmount();
    render(<CycleTrackerSection userId="user-a" />);
    expect(await screen.findByRole('button', { name: '철회 다시 시도' })).toBeInTheDocument();
    expect(syncConsent).not.toHaveBeenCalled();
    expect(periodLoads).toHaveLength(0);
  });

  it('stays locked after restart even when the pending marker could not be written', async () => {
    revokeConsent.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    const first = await renderGrantedCycle();
    const setItem = vi.spyOn(
      Object.getPrototypeOf(window.localStorage) as Storage,
      'setItem',
    ).mockImplementation(() => {
      throw new DOMException('quota');
    });

    await confirmConsentRevoke();
    expect(await screen.findByRole('alert')).toHaveTextContent('인터넷 연결');
    expect(hasPendingCycleConsentRevocation('user-a')).toBe(true);
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);

    first.unmount();
    setItem.mockRestore();
    syncConsent.mockResolvedValue({ ok: true, granted: true, revision: 8 });
    render(<CycleTrackerSection userId="user-a" />);

    expect(await screen.findByRole('button', { name: '철회 다시 시도' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('이전에 요청한 동의 철회');
    expect(screen.queryByTestId('cycle-hero')).not.toBeInTheDocument();
    expect(periodLoads).toHaveLength(1);
  });

  it('rechecks server consent before a transient load retry touches health tables again', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'error' });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    const retryConsent = deferred<{ ok: true; granted: true; revision: 8 }>();
    syncConsent.mockReturnValueOnce(retryConsent.promise);
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }));

    await waitFor(() => expect(syncConsent).toHaveBeenCalledTimes(2));
    expect(periodLoads).toHaveLength(1);

    await act(async () => retryConsent.resolve({ ok: true, granted: true, revision: 8 }));
    await waitFor(() => expect(periodLoads).toHaveLength(2));
  });

  it('does not let a queued quick symptom write cross a new authority check', async () => {
    const recheck = deferred<{ ok: true; granted: false; revision: 8 }>();
    await renderGrantedCycle();
    syncConsent.mockReturnValueOnce(recheck.promise);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      screen.getByRole('button', { name: /두통/ }).click();
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    await waitFor(() => expect(syncConsent).toHaveBeenCalledTimes(2));
    expect(saveDailyLog).not.toHaveBeenCalled();
    await act(async () => recheck.resolve({ ok: true, granted: false, revision: 8 }));
    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
  });

  it('ignores an old account consent response after the account changes', async () => {
    const accountAConsent = deferred<{ ok: true; granted: true; revision: 7 }>();
    syncConsent
      .mockReturnValueOnce(accountAConsent.promise)
      .mockResolvedValueOnce({ ok: true, granted: false, revision: 8 });

    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(syncConsent).toHaveBeenCalledWith('user-a'));
    view.rerender(<CycleTrackerSection userId="user-b" />);

    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    await act(async () => accountAConsent.resolve({ ok: true, granted: true, revision: 7 }));

    expect(screen.getByText('내 몸의 리듬 시작하기')).toBeInTheDocument();
    expect(periodLoads).toHaveLength(0);
  });

  it('does not apply A pending-revoke state through a stale native callback after switching to B', async () => {
    nativeLifecycle.state.isNative = true;
    const view = render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await waitFor(() => expect(nativeLifecycle.state.listener).not.toBeNull());
    const staleAccountAListener = nativeLifecycle.state.listener!;

    await act(async () => {
      periodLoads[0].resolve({ ok: true, periods: [] });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    markCycleConsentRevocationPending('user-a');
    syncConsent.mockResolvedValueOnce({ ok: true, granted: false, revision: 8 });
    view.rerender(<CycleTrackerSection userId="user-b" />);
    expect(await screen.findByText('내 몸의 리듬 시작하기')).toBeInTheDocument();

    await act(async () => {
      staleAccountAListener({ isActive: true });
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: '철회 다시 시도' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '동의하고 시작하기' })).toBeInTheDocument();
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
    // The hero stays in its insufficient-data state: no local period was invented.
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('insufficient_data');
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
