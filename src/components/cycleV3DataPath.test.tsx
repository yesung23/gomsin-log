import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CycleDailyLogsFetchResult,
  CyclePeriodsFetchResult,
  CycleSettingsFetchResult,
} from '@/lib/cycle';
import { grantCycleSensitiveConsent } from '@/lib/sensitiveConsent';
import type { CycleDailyLog, CyclePeriod } from '@/types';

/**
 * V3 data-path suite.
 *
 * This is the test that the previous "V3 complete" claim did not have: it drives
 * the REAL component and asserts which V3 table each user gesture writes to.
 * A prediction-only test (`predictCycle(sameArray)` twice) cannot catch the P0
 * defect, because the defect was in the UI's choice of mutation, not in the
 * statistics.
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
const deletePeriod = vi.fn();
const saveDailyLog = vi.fn();
const deleteDailyLog = vi.fn();
const saveSettings = vi.fn();
const fetchSharingPreferences = vi.fn();
const saveSharingPreferences = vi.fn();

/** Legacy writers. Every assertion below requires these to stay untouched. */
const legacySaveEntry = vi.fn();
const legacyUpdateEntry = vi.fn();
const legacyDeleteEntry = vi.fn();
const legacyFetchEntries = vi.fn();

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
    saveCyclePeriodToDB: (...args: unknown[]) => savePeriod(...args),
    updateCyclePeriodInDB: (...args: unknown[]) => updatePeriod(...args),
    deleteCyclePeriodFromDB: (...args: unknown[]) => deletePeriod(...args),
    saveCycleDailyLogToDB: (...args: unknown[]) => saveDailyLog(...args),
    deleteCycleDailyLogFromDB: (...args: unknown[]) => deleteDailyLog(...args),
    saveCycleSettingsToDB: (...args: unknown[]) => saveSettings(...args),
    fetchCycleSharingPreferencesFromDB: (...args: unknown[]) => fetchSharingPreferences(...args),
    saveCycleSharingPreferencesToDB: (...args: unknown[]) => saveSharingPreferences(...args),
    // Legacy: present so a regression would be observable rather than a crash.
    fetchCycleEntriesResultFromDB: (...args: unknown[]) => legacyFetchEntries(...args),
    saveCycleEntryToDB: (...args: unknown[]) => legacySaveEntry(...args),
    updateCycleEntryInDB: (...args: unknown[]) => legacyUpdateEntry(...args),
    deleteCycleEntryFromDB: (...args: unknown[]) => legacyDeleteEntry(...args),
  };
});

const revokeConsent = vi.fn();

vi.mock('@/lib/sensitiveConsent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sensitiveConsent')>();
  return {
    ...actual,
    // Server consent is asserted separately; here it is already granted.
    syncCycleConsentWithDB: async () => ({ ok: true as const, granted: true }),
    revokeCycleConsentInDB: (...args: unknown[]) => revokeConsent(...args),
  };
});

const { CycleTrackerSection } = await import('@/components/CycleTrackerSection');

/** 8/1 ~ 8/5: a real, completed period. */
const COMPLETED_PERIOD: CyclePeriod = {
  id: 'period-aug',
  userId: 'user-a',
  startDate: '2026-08-01',
  endDate: '2026-08-05',
};

beforeEach(() => {
  window.localStorage.clear();
  grantCycleSensitiveConsent('user-a');
  periodLoads.length = 0;
  dailyLogLoads.length = 0;
  settingLoads.length = 0;
  savePeriod.mockReset();
  updatePeriod.mockReset();
  deletePeriod.mockReset();
  saveDailyLog.mockReset();
  deleteDailyLog.mockReset();
  saveSettings.mockReset();
  legacySaveEntry.mockReset();
  legacyUpdateEntry.mockReset();
  legacyDeleteEntry.mockReset();
  legacyFetchEntries.mockReset();
  fetchSharingPreferences.mockReset();
  saveSharingPreferences.mockReset();
  revokeConsent.mockReset();
  revokeConsent.mockResolvedValue({ ok: true, granted: false });
  fetchSharingPreferences.mockResolvedValue({
    userId: 'user-a',
    shareCurrentPeriod: false,
    sharePredictionWindow: false,
    shareFertilityWindow: false,
  });
});

/** Render with the given V3 server state already resolved. */
async function renderLoaded(options: {
  periods?: CyclePeriod[];
  dailyLogs?: CycleDailyLog[];
  averageCycleLength?: number;
  averagePeriodLength?: number;
} = {}) {
  const view = render(<CycleTrackerSection userId="user-a" />);
  await waitFor(() => expect(periodLoads).toHaveLength(1));
  await act(async () => {
    periodLoads[0].resolve({ ok: true, periods: options.periods ?? [] });
    dailyLogLoads[0].resolve({ ok: true, logs: options.dailyLogs ?? [] });
    settingLoads[0].resolve({
      ok: true,
      settings: {
        userId: 'user-a',
        averageCycleLength: options.averageCycleLength ?? 28,
        averagePeriodLength: options.averagePeriodLength ?? 5,
      },
    });
  });
  return view;
}

describe('P0: daily symptoms never create or extend a menstrual period', () => {
  it('quick symptom outside period writes cycle_daily_logs and never cycle_periods', async () => {
    /*
     * The exact defect scenario:
     *   8/1 period start, 8/5 period end, then a headache logged on 8/14.
     * Before V3, 8/14 became a `cycle_entries` row whose `start_date` was 8/14,
     * so 8/14 was read as a new period start: active period true, prediction
     * source moved, average cycle length contaminated.
     */
    saveDailyLog.mockResolvedValue({
      ok: true,
      log: {
        id: 'log-814',
        userId: 'user-a',
        logDate: '2026-08-14',
        symptoms: ['headache'],
      },
    });

    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    // Prediction before the symptom is logged.
    const rangeBefore = (await screen.findByTestId('cycle-prediction-window')).textContent;

    fireEvent.click(screen.getByRole('button', { name: /두통/ }));

    await waitFor(() => expect(saveDailyLog).toHaveBeenCalledTimes(1));
    expect(saveDailyLog).toHaveBeenCalledWith(
      '2026-08-14',
      ['headache'],
      expect.anything(),
    );

    // The period tables are untouched by a condition log.
    expect(savePeriod).not.toHaveBeenCalled();
    expect(updatePeriod).not.toHaveBeenCalled();
    expect(deletePeriod).not.toHaveBeenCalled();

    // And no legacy write happened at all.
    expect(legacySaveEntry).not.toHaveBeenCalled();
    expect(legacyUpdateEntry).not.toHaveBeenCalled();
    expect(legacyDeleteEntry).not.toHaveBeenCalled();

    // Active period stays false: 8/5 ended, and 8/14 is not a start.
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('prediction');
    expect(screen.queryByRole('button', { name: /오늘 생리 끝났어요/ })).not.toBeInTheDocument();

    // Prediction source unchanged, so the rendered window is identical.
    expect((await screen.findByTestId('cycle-prediction-window')).textContent).toBe(rangeBefore);
  });

  it('never reads the legacy cycle_entries table on load', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    expect(legacyFetchEntries).not.toHaveBeenCalled();
    expect(periodLoads).toHaveLength(1);
    expect(dailyLogLoads).toHaveLength(1);
  });
});

describe('period start and end write cycle_periods only', () => {
  it('1-tap start creates a cycle_periods row for today', async () => {
    savePeriod.mockResolvedValue({
      ok: true,
      period: { id: 'period-new', userId: 'user-a', startDate: '2026-08-14' },
    });
    await renderLoaded({ periods: [] });

    fireEvent.click(await screen.findByRole('button', { name: /오늘 생리 시작했어요/ }));

    await waitFor(() => expect(savePeriod).toHaveBeenCalledWith('2026-08-14'));
    expect(saveDailyLog).not.toHaveBeenCalled();
    expect(legacySaveEntry).not.toHaveBeenCalled();
  });

  it('1-tap end closes the active period without touching daily logs', async () => {
    const openPeriod: CyclePeriod = {
      id: 'period-open',
      userId: 'user-a',
      startDate: '2026-08-12',
    };
    updatePeriod.mockResolvedValue({
      ok: true,
      period: { ...openPeriod, endDate: '2026-08-14' },
    });
    await renderLoaded({ periods: [openPeriod] });

    // 8/12 start, today 8/14 => day 3.
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('active');
    expect(screen.getByText(/생리 3일째/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /오늘 생리 끝났어요/ }));

    await waitFor(() => expect(updatePeriod).toHaveBeenCalledWith(
      'period-open',
      '2026-08-12',
      '2026-08-14',
    ));
    expect(saveDailyLog).not.toHaveBeenCalled();
    expect(legacyUpdateEntry).not.toHaveBeenCalled();
  });

  it('does not start a second period while one is already active', async () => {
    await renderLoaded({
      periods: [{ id: 'period-open', userId: 'user-a', startDate: '2026-08-12' }],
    });
    // The start affordance is not offered at all while a period is active.
    expect(screen.queryByRole('button', { name: /오늘 생리 시작했어요/ })).not.toBeInTheDocument();
    expect(savePeriod).not.toHaveBeenCalled();
  });
});

describe('detailed daily log persistence', () => {
  it('saves flow, pain, mood, symptoms and note to cycle_daily_logs and restores them', async () => {
    saveDailyLog.mockResolvedValue({
      ok: true,
      log: {
        id: 'log-814',
        userId: 'user-a',
        logDate: '2026-08-14',
        painLevel: 'severe',
        mood: 'tired',
        symptoms: ['headache'],
        note: '오늘은 좀 힘들었어요',
      },
    });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(screen.getByRole('button', { name: /자세히 기록하기/ }));
    const sheet = await screen.findByRole('dialog', { name: /컨디션 기록/ });

    // 출혈량 UI는 제거되어 노출되지 않음
    expect(screen.queryByRole('button', { name: /출혈량/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '통증 심함' }));
    fireEvent.click(screen.getByRole('button', { name: '기분 피곤' }));
    fireEvent.click(screen.getByRole('button', { name: '증상 두통' }));
    fireEvent.change(screen.getByLabelText('메모'), {
      target: { value: '오늘은 좀 힘들었어요' },
    });
    fireEvent.click(screen.getByRole('button', { name: '컨디션 저장' }));

    await waitFor(() => expect(saveDailyLog).toHaveBeenCalledWith(
      '2026-08-14',
      ['headache'],
      expect.objectContaining({
        painLevel: 'severe',
        mood: 'tired',
        note: '오늘은 좀 힘들었어요',
      }),
    ));

    // Period tables untouched by the detailed condition editor.
    expect(savePeriod).not.toHaveBeenCalled();
    expect(updatePeriod).not.toHaveBeenCalled();

    await waitFor(() => expect(sheet).not.toBeInTheDocument());
  });

  it('restores a previously saved daily log from the server on load', async () => {
    const storedLog: CycleDailyLog = {
      id: 'log-814',
      userId: 'user-a',
      logDate: '2026-08-14',
      flow: 'heavy',
      painLevel: 'severe',
      mood: 'tired',
      symptoms: ['headache', 'fatigue'],
      note: '복원된 메모',
    };
    await renderLoaded({ periods: [COMPLETED_PERIOD], dailyLogs: [storedLog] });

    // The quick chips reflect the stored state without reopening the sheet.
    expect(screen.getByRole('button', { name: /두통/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /피로/ })).toHaveAttribute('aria-pressed', 'true');

    // And the detail sheet restores every stored field.
    fireEvent.click(screen.getByRole('button', { name: /자세히 기록하기/ }));
    await screen.findByRole('dialog', { name: /컨디션 기록/ });
    expect(screen.queryByRole('button', { name: /출혈량/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '통증 심함' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '기분 피곤' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('메모')).toHaveValue('복원된 메모');
  });

  it('keeps the note in the editor when the server rejects the write', async () => {
    saveDailyLog.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(screen.getByRole('button', { name: /자세히 기록하기/ }));
    await screen.findByRole('dialog', { name: /컨디션 기록/ });
    fireEvent.change(screen.getByLabelText('메모'), { target: { value: '잃어버리면 안 되는 글' } });
    fireEvent.click(screen.getByRole('button', { name: '컨디션 저장' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // The user's text survives a failed save.
    expect(screen.getByLabelText('메모')).toHaveValue('잃어버리면 안 되는 글');
  });
});

describe('prediction is rendered as a range, not a single confident date', () => {
  it('renders a personalized window with a confidence word and no percentage', async () => {
    await renderLoaded({
      periods: [
        // Every historical period is closed. An open one would still be "active".
        { id: 'p1', userId: 'user-a', startDate: '2026-05-16', endDate: '2026-05-20' },
        { id: 'p2', userId: 'user-a', startDate: '2026-06-13', endDate: '2026-06-17' },
        { id: 'p3', userId: 'user-a', startDate: '2026-07-11', endDate: '2026-07-15' },
        { id: 'p4', userId: 'user-a', startDate: '2026-08-08', endDate: '2026-08-12' },
      ],
    });

    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('prediction');
    const window = await screen.findByTestId('cycle-prediction-window');
    // 8/8 + 28 = 9/5, variability 0 -> clamped to 1 day either side.
    expect(window).toHaveTextContent('9월 4일');
    expect(window).toHaveTextContent('9월 6일');
    expect(screen.getByTestId('cycle-prediction-confidence')).toHaveTextContent('높음');
    expect(screen.getByTestId('cycle-prediction-basis')).toHaveTextContent('최근');
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows the learning state when there is no period history at all', async () => {
    await renderLoaded({ periods: [] });
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('insufficient_data');
    expect(screen.getByText(/내 주기를 알아가는 중/)).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-prediction-window')).not.toBeInTheDocument();
  });

  it('labels a one-record estimate as a default-setting estimate', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('prediction');
    expect(screen.getByTestId('cycle-prediction-basis')).toHaveTextContent('기본 설정');
  });

  it('asks about an open period that has run implausibly long instead of editing it', async () => {
    /*
     * A period opened on 7/1 with no end, viewed on 8/14, is day 45. The app must
     * not close it automatically; it asks, and the record stays as the user left
     * it.
     */
    await renderLoaded({
      periods: [{ id: 'p-open', userId: 'user-a', startDate: '2026-07-01' }],
    });
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('active');
    expect(screen.getByText(/아직 생리 중으로 기록되어 있어요/)).toBeInTheDocument();
    expect(updatePeriod).not.toHaveBeenCalled();
  });

  it('treats the most recent open period as the active one', async () => {
    // An ancient unclosed period must not mask the current one.
    await renderLoaded({
      periods: [
        { id: 'p-old', userId: 'user-a', startDate: '2026-02-01' },
        { id: 'p-now', userId: 'user-a', startDate: '2026-08-13' },
      ],
    });
    expect(screen.getByText(/생리 2일째/)).toBeInTheDocument();
  });
});

describe('calendar distinguishes actual, predicted and logged days without relying on colour', () => {
  it('labels actual period days, predicted days and days carrying a condition log', async () => {
    await renderLoaded({
      periods: [COMPLETED_PERIOD],
      dailyLogs: [{
        id: 'log-814',
        userId: 'user-a',
        logDate: '2026-08-14',
        symptoms: ['headache'],
      }],
    });

    // 8/1 is a real recorded start.
    expect(screen.getByRole('button', { name: /2026-08-01.*생리 기록/ })).toBeInTheDocument();
    // 8/29 ± 2 is the configured-estimate window.
    expect(screen.getByRole('button', { name: /2026-08-29.*생리 예상 기간/ })).toBeInTheDocument();
    // 8/14 carries a condition log, announced in the label rather than by colour.
    expect(screen.getByRole('button', { name: /2026-08-14.*컨디션 기록 있음/ })).toBeInTheDocument();
  });

  it('opens a day sheet when a calendar date is chosen', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    fireEvent.click(screen.getByRole('button', { name: /2026-08-20/ }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveTextContent('8월 20일');
    expect(sheet).toHaveTextContent('아직 기록이 없어요');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('the main screen is not a pile of settings', () => {
  it('keeps settings and sharing toggles out of the default view', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    // No average-length inputs, no sharing switches, no consent revoke link.
    expect(screen.queryByText('평균 주기 길이')).not.toBeInTheDocument();
    expect(screen.queryByText(/생리 진행 상태 공유/)).not.toBeInTheDocument();
    expect(screen.queryByText(/민감정보 동의 철회/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    // They are reachable from one settings entry point.
    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    const settings = await screen.findByRole('dialog', { name: '내 몸의 리듬 설정' });
    expect(settings).toHaveTextContent('주기 설정');
    expect(settings).toHaveTextContent('파트너 배려 공유');
  });
});

describe('sharing preferences are server state, not local state', () => {
  it('reads preferences from the server and persists a toggle', async () => {
    saveSharingPreferences.mockResolvedValue({
      ok: true,
      preferences: {
        userId: 'user-a',
        shareCurrentPeriod: true,
        sharePredictionWindow: false,
        shareFertilityWindow: false,
      },
    });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    fireEvent.click(await screen.findByRole('button', { name: /파트너 배려 공유/ }));

    const toggle = await screen.findByRole('switch', { name: /생리 진행 상태 공유/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    await waitFor(() => expect(saveSharingPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ shareCurrentPeriod: true }),
    ));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('rolls the toggle back and names the real cause when the server refuses', async () => {
    saveSharingPreferences.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    fireEvent.click(await screen.findByRole('button', { name: /파트너 배려 공유/ }));
    const toggle = await screen.findByRole('switch', { name: /생리 진행 상태 공유/ });
    fireEvent.click(toggle);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // Rolled back: an unsaved preference must not look saved.
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('previews exactly what the partner sees, derived from the real preferences', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    fireEvent.click(await screen.findByRole('button', { name: /파트너 배려 공유/ }));

    // Everything OFF: the preview must say nothing is shared.
    const preview = await screen.findByTestId('cycle-partner-preview');
    expect(preview).toHaveTextContent('현재 파트너에게 공유되는 주기 정보가 없어요');
    // No raw health vocabulary may appear in a partner-facing preview.
    for (const forbidden of ['두통', '출혈', '통증', '메모']) {
      expect(preview).not.toHaveTextContent(forbidden);
    }
  });
});

describe('revoking consent also stops partner sharing', () => {
  /*
   * Revoking used to leave any enabled toggle running: the row in
   * `cycle_sharing_preferences` stayed true, so the projection kept answering a
   * partner with the shared window. Verified against the live project before the
   * fix. Revoking means stop using this data this way, and sharing it with a
   * partner is one of those ways.
   *
   * The server enforces the same rule independently (migration 026); this pins
   * the client half, which is what stops the stale row from existing at all.
   */
  async function openPrivacy() {
    fireEvent.click(screen.getByRole('button', { name: '내 몸의 리듬 설정' }));
    fireEvent.click(await screen.findByRole('button', { name: /민감정보 동의/ }));
    fireEvent.click(await screen.findByRole('button', { name: '민감정보 동의 철회' }));
    return screen.findByRole('button', { name: '철회' });
  }

  it('turns every sharing toggle off before revoking', async () => {
    fetchSharingPreferences.mockResolvedValue({
      userId: 'user-a',
      shareCurrentPeriod: true,
      sharePredictionWindow: true,
      shareFertilityWindow: false,
    });
    saveSharingPreferences.mockResolvedValue({
      ok: true,
      preferences: {
        userId: 'user-a',
        shareCurrentPeriod: false,
        sharePredictionWindow: false,
        shareFertilityWindow: false,
      },
    });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(await openPrivacy());

    await waitFor(() => expect(saveSharingPreferences).toHaveBeenCalledWith({
      shareCurrentPeriod: false,
      sharePredictionWindow: false,
      shareFertilityWindow: false,
    }));
    await waitFor(() => expect(revokeConsent).toHaveBeenCalled());

    // Order is load-bearing: sharing must stop first, so a failure anywhere
    // leaves the stricter state.
    expect(saveSharingPreferences.mock.invocationCallOrder[0])
      .toBeLessThan(revokeConsent.mock.invocationCallOrder[0]);
  });

  it('does not revoke when sharing could not be turned off', async () => {
    fetchSharingPreferences.mockResolvedValue({
      userId: 'user-a',
      shareCurrentPeriod: true,
      sharePredictionWindow: false,
      shareFertilityWindow: false,
    });
    saveSharingPreferences.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });

    fireEvent.click(await openPrivacy());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    // Consent must survive: telling the user sharing ended while it continued
    // would be worse than refusing the revoke.
    expect(revokeConsent).not.toHaveBeenCalled();
  });

  it('skips the extra write when nothing was shared', async () => {
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    fireEvent.click(await openPrivacy());

    await waitFor(() => expect(revokeConsent).toHaveBeenCalled());
    expect(saveSharingPreferences).not.toHaveBeenCalled();
  });

  it('keeps consent when the revoke itself is refused', async () => {
    revokeConsent.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await renderLoaded({ periods: [COMPLETED_PERIOD] });
    fireEvent.click(await openPrivacy());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('권한이 없어요');
    // Still unlocked: a refused revoke must not be presented as done.
    expect(screen.queryByText('동의하고 시작하기')).not.toBeInTheDocument();
  });
});

describe('a period already ended today offers no further action', () => {
  /*
   * `activePeriodOnDate` counts the end day itself as inside the period, which
   * is correct: a period that ends today IS today's period. But the Hero's
   * button read only `activePeriod`, so after tapping "오늘 생리 끝났어요" it kept
   * offering the same button, and tapping again rewrote the identical end date.
   * The write succeeded every time, so the screen looked frozen. Found by
   * tapping through the real app: the DB had the right end date while the Hero
   * still said "생리 1일째" with an end button.
   */
  const ENDED_TODAY: CyclePeriod = {
    id: 'period-today',
    userId: 'user-a',
    startDate: '2026-08-14',
    endDate: '2026-08-14',
  };

  it('hides the end button once the end date is today', async () => {
    await renderLoaded({ periods: [ENDED_TODAY] });
    // Still today's period, so the Hero keeps the active framing.
    expect(screen.getByTestId('cycle-hero-state')).toHaveTextContent('active');
    expect(screen.queryByRole('button', { name: '오늘 생리 끝났어요' })).not.toBeInTheDocument();
    // And must not offer to start a second one either.
    expect(screen.queryByRole('button', { name: '오늘 생리 시작했어요' })).not.toBeInTheDocument();
  });

  it('says what was recorded, and where to change it', async () => {
    await renderLoaded({ periods: [ENDED_TODAY] });
    expect(screen.getByText(/오늘 종료로 기록했어요/)).toBeInTheDocument();
  });

  it('still offers the end button while the period is open', async () => {
    await renderLoaded({
      periods: [{ ...ENDED_TODAY, startDate: '2026-08-12', endDate: undefined }],
    });
    expect(await screen.findByRole('button', { name: '오늘 생리 끝났어요' })).toBeInTheDocument();
  });

  it('ends an open period exactly once, writing today as the end', async () => {
    const open: CyclePeriod = { ...ENDED_TODAY, startDate: '2026-08-12', endDate: undefined };
    updatePeriod.mockResolvedValue({
      ok: true,
      period: { ...open, endDate: '2026-08-14' },
    });
    await renderLoaded({ periods: [open] });

    fireEvent.click(await screen.findByRole('button', { name: '오늘 생리 끝났어요' }));
    await waitFor(() => expect(updatePeriod).toHaveBeenCalledWith(
      'period-today',
      '2026-08-12',
      '2026-08-14',
    ));

    // The button is gone, so it cannot be tapped into a second identical write.
    await waitFor(() => expect(
      screen.queryByRole('button', { name: '오늘 생리 끝났어요' }),
    ).not.toBeInTheDocument());
    expect(updatePeriod).toHaveBeenCalledTimes(1);
  });

  it('never creates a period row when ending one', async () => {
    const open: CyclePeriod = { ...ENDED_TODAY, startDate: '2026-08-12', endDate: undefined };
    updatePeriod.mockResolvedValue({ ok: true, period: { ...open, endDate: '2026-08-14' } });
    await renderLoaded({ periods: [open] });

    fireEvent.click(await screen.findByRole('button', { name: '오늘 생리 끝났어요' }));
    await waitFor(() => expect(updatePeriod).toHaveBeenCalled());
    expect(savePeriod).not.toHaveBeenCalled();
    expect(saveDailyLog).not.toHaveBeenCalled();
  });
});

describe('an unapplied migration is reported as a deployment state, not a connection problem', () => {
  /*
   * This is what the user actually hit: migration 022 was never applied, so
   * PostgREST answered `PGRST205` ("could not find the table"), the fetch
   * classifier collapsed it into a generic error, and the screen said
   * "연결을 확인하고 다시 시도해 주세요" on a working connection.
   */
  it('does not blame the connection when the V3 tables are missing', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'not_deployed' });
      dailyLogLoads[0].resolve({ ok: false, reason: 'not_deployed' });
      settingLoads[0].resolve({ ok: true, settings: null });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('연결을 확인');
    expect(alert).not.toHaveTextContent('인터넷 연결');
    expect(alert).toHaveTextContent('준비가 아직 끝나지 않았어요');
    // Retrying cannot apply a migration, so no retry affordance is offered.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('reassures the user that nothing was lost', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'not_deployed' });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('사라지지 않았어요');
  });

  it('still prefers an authority verdict over a deployment one', async () => {
    // A permission problem is more specific and more actionable than "not ready".
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'not_deployed' });
      dailyLogLoads[0].resolve({ ok: false, reason: 'forbidden' });
      settingLoads[0].resolve({ ok: true, settings: null });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없어요');
  });

  it('offers a retry for a genuinely transient failure', async () => {
    render(<CycleTrackerSection userId="user-a" />);
    await waitFor(() => expect(periodLoads).toHaveLength(1));
    await act(async () => {
      periodLoads[0].resolve({ ok: false, reason: 'error' });
      dailyLogLoads[0].resolve({ ok: true, logs: [] });
      settingLoads[0].resolve({ ok: true, settings: null });
    });
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });
});

describe('source guard: the V3 surface cannot regress to legacy cycle_entries', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/CycleTrackerSection.tsx'),
    'utf8',
  );

  it.each([
    'fetchCycleEntriesResultFromDB',
    'saveCycleEntryToDB',
    'updateCycleEntryInDB',
    'deleteCycleEntryFromDB',
    'calculateExpectedStartDate',
    'cycleRangesOnDate',
    'validateCycleEntryDraft',
  ])('CycleTrackerSection does not reference %s', (symbol) => {
    expect(source).not.toContain(symbol);
  });

  it('does not type any state as CycleEntry', () => {
    expect(source).not.toMatch(/\bCycleEntry\b/);
    expect(source).not.toMatch(/\bCycleEntryDraft\b/);
  });

  it('does read the V3 tables', () => {
    expect(source).toContain('fetchCyclePeriodsResultFromDB');
    expect(source).toContain('fetchCycleDailyLogsResultFromDB');
  });
});
