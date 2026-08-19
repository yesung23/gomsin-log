import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DailyRecord } from '@/types';
import type { Viewer } from '@/lib/privacy';
import { toLocalDateString } from '@/lib/utils';
import {
  advancePartnerDayCheckpoint,
  missedPartnerRecords,
  partnerDayCheckpointKey,
  partnerDayDateLabel,
  partnerDayWindow,
  readPartnerDayCheckpoint,
  spansBeforeToday,
  writePartnerDayCheckpoint,
  type PartnerDayCheckpoint,
} from '@/lib/partnerDay';

/**
 * The contract under test is one sentence of PRODUCT_V3 §6.5:
 *
 *   구간: 마지막 확인점 이후, 없으면 최근 7일, 상한 오늘.
 *
 * Two failure directions are NOT symmetric. Showing a record twice costs the
 * viewer a second glance; hiding one they never saw defeats the reason the
 * product exists ("놓친 하루의 맥락을 복구", §1.11). Every ambiguous case below is
 * therefore asserted to resolve towards showing more, never towards hiding.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const TODAY = '2026-08-19';
const VIEWER: Viewer = { userId: ME, role: 'soldier' };

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

/**
 * A receipt that HAS observed the ids it is given.
 *
 * Most cases below are about the ordinary date window, and the date window only
 * governs records the receipt can attest were already visible. Tests that want
 * the late-arrival branch pass `observedRecordIds` explicitly, or omit it via
 * `legacyCheckpoint` to get the fail-open reading.
 */
function checkpoint(overrides: Partial<PartnerDayCheckpoint> = {}): PartnerDayCheckpoint {
  return {
    confirmedRecordIds: [],
    observedRecordIds: [],
    confirmedThrough: TODAY,
    confirmedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

/** A receipt written before observation existed: it cannot attest to anything. */
function legacyCheckpoint(overrides: Partial<PartnerDayCheckpoint> = {}): PartnerDayCheckpoint {
  const base = checkpoint(overrides);
  delete base.observedRecordIds;
  return base;
}

function observing(ids: string[], overrides: Partial<PartnerDayCheckpoint> = {}) {
  return checkpoint({ observedRecordIds: ids, ...overrides });
}

const ids = (records: DailyRecord[]) => records.map((r) => r.id);

describe('partnerDayWindow: 마지막 확인점 이후, 없으면 최근 7일, 상한 오늘', () => {
  it('falls back to a seven-day window including today when there is no checkpoint', () => {
    expect(partnerDayWindow(null, TODAY)).toEqual({ since: '2026-08-13', until: TODAY });
  });

  it('uses the checkpoint date as an inclusive lower bound', () => {
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2026-08-17' }), TODAY))
      .toEqual({ since: '2026-08-17', until: TODAY });
  });

  it('caps the upper bound at today regardless of the checkpoint', () => {
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2026-07-01' }), TODAY).until)
      .toBe(TODAY);
  });

  it('never lets a future-dated checkpoint swallow the window', () => {
    // A restored backup or a wrong device clock could write tomorrow's date.
    // Clamping to today keeps today's records visible instead of hiding them all.
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2099-01-01' }), TODAY))
      .toEqual({ since: TODAY, until: TODAY });
  });
});

describe('missedPartnerRecords: which records are in the missed window', () => {
  it('no checkpoint: returns the last seven days and nothing older', () => {
    const inside = record({ id: 'inside', date: '2026-08-13' });
    const outside = record({ id: 'outside', date: '2026-08-12' });
    expect(ids(missedPartnerRecords([inside, outside], VIEWER, TODAY, null)))
      .toEqual(['inside']);
  });

  it('today checkpoint: still shows a later record from the same day', () => {
    // The bound is a DATE, so an afternoon record must survive a morning receipt.
    const later = record({ id: 'later', time: '18:00' });
    expect(ids(missedPartnerRecords([later], VIEWER, TODAY, checkpoint())))
      .toEqual(['later']);
  });

  it('yesterday checkpoint: recovers yesterday and today', () => {
    const window = [
      record({ id: 'older', date: '2026-08-17' }),
      record({ id: 'yesterday', date: '2026-08-18' }),
      record({ id: 'today', date: TODAY }),
    ];
    expect(ids(missedPartnerRecords(
      window,
      VIEWER,
      TODAY,
      observing(['older'], { confirmedThrough: '2026-08-18' }),
    ))).toEqual(['yesterday', 'today']);
  });

  it('an older record the receipt never saw is not governed by the date bound', () => {
    // The late-arrival branch. Same window, same bound -- the only difference is
    // that this client had no sight of `older` when the bound was set, so the
    // bound cannot stand as a verdict on it.
    const window = [
      record({ id: 'older', date: '2026-08-17' }),
      record({ id: 'today', date: TODAY }),
    ];
    expect(ids(missedPartnerRecords(
      window,
      VIEWER,
      TODAY,
      observing(['today'], { confirmedThrough: '2026-08-18' }),
    ))).toEqual(['older', 'today']);
  });

  it('a receipt with no observation at all reopens older records rather than hiding them', () => {
    const window = [
      record({ id: 'older', date: '2026-08-17' }),
      record({ id: 'today', date: TODAY }),
    ];
    expect(ids(missedPartnerRecords(
      window,
      VIEWER,
      TODAY,
      legacyCheckpoint({ confirmedThrough: '2026-08-18' }),
    ))).toEqual(['older', 'today']);
  });

  it('three-day-old checkpoint: recovers every day since, oldest first', () => {
    const window = [
      record({ id: 'd3', date: '2026-08-19' }),
      record({ id: 'd1', date: '2026-08-16' }),
      record({ id: 'd2', date: '2026-08-17' }),
    ];
    expect(ids(missedPartnerRecords(window, VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-08-16' }))))
      .toEqual(['d1', 'd2', 'd3']);
  });

  it('checkpoint older than seven days: honours the checkpoint, not the fallback', () => {
    // §6.5 caps the FALLBACK at seven days. An explicit checkpoint is the real
    // lower bound, so a three-week absence still recovers three weeks.
    const old = record({ id: 'old', date: '2026-07-30' });
    expect(ids(missedPartnerRecords([old], VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-07-29' }))))
      .toEqual(['old']);
    expect(ids(missedPartnerRecords([old], VIEWER, TODAY, null))).toEqual([]);
  });

  it('drops records already acknowledged by id, keeping the rest of that day', () => {
    const seen = record({ id: 'seen', time: '09:00' });
    const unseen = record({ id: 'unseen', time: '10:00' });
    const cp = checkpoint({ confirmedRecordIds: ['seen'] });
    expect(ids(missedPartnerRecords([seen, unseen], VIEWER, TODAY, cp))).toEqual(['unseen']);
  });

  it('excludes a future-dated record instead of pinning it to the window', () => {
    // `record.date >= since` alone admitted it. It is not missed context, and it
    // would sort to the end of the timeline claiming to be the latest news.
    const future = record({ id: 'future', date: '2026-08-20' });
    const today = record({ id: 'today' });
    expect(ids(missedPartnerRecords([future, today], VIEWER, TODAY, null))).toEqual(['today']);
    expect(ids(missedPartnerRecords([future, today], VIEWER, TODAY, checkpoint())))
      .toEqual(['today']);
  });

  it('orders by date then time so a multi-day window reads chronologically', () => {
    const window = [
      record({ id: 'today-early', date: TODAY, time: '08:00' }),
      record({ id: 'yesterday-late', date: '2026-08-18', time: '23:00' }),
      record({ id: 'yesterday-early', date: '2026-08-18', time: '07:00' }),
    ];
    expect(ids(missedPartnerRecords(window, VIEWER, TODAY, null)))
      .toEqual(['yesterday-early', 'yesterday-late', 'today-early']);
  });

  describe('widening time must not widen authorization (§6.3)', () => {
    it("never returns the partner's private record, on any day of the window", () => {
      const privateToday = record({ id: 'p-today', isPrivate: true });
      const privateOlder = record({ id: 'p-older', date: '2026-08-15', isPrivate: true });
      expect(missedPartnerRecords([privateToday, privateOlder], VIEWER, TODAY, null)).toEqual([]);
    });

    it("never returns the viewer's own records", () => {
      const mine = record({ id: 'mine', userId: ME, authorRole: 'soldier' });
      expect(missedPartnerRecords([mine], VIEWER, TODAY, null)).toEqual([]);
    });

    it('a private record does not affect the count of what is missed', () => {
      const shared = record({ id: 'shared' });
      const secret = record({ id: 'secret', date: '2026-08-16', isPrivate: true });
      const withSecret = missedPartnerRecords([shared, secret], VIEWER, TODAY, null);
      const withoutSecret = missedPartnerRecords([shared], VIEWER, TODAY, null);
      expect(withSecret.length).toBe(withoutSecret.length);
      expect(ids(withSecret)).toEqual(['shared']);
    });
  });
});

describe('advancePartnerDayCheckpoint: only an explicit acknowledgement moves it', () => {
  it('acknowledging nothing produces no checkpoint at all', () => {
    expect(advancePartnerDayCheckpoint(null, [])).toBeNull();
  });

  it('records the acknowledged ids and the newest acknowledged date', () => {
    const next = advancePartnerDayCheckpoint(null, [
      record({ id: 'a', date: '2026-08-17' }),
      record({ id: 'b', date: '2026-08-18' }),
    ], [], null, new Date('2026-08-19T10:00:00.000Z'));
    expect(next).toEqual({
      confirmedRecordIds: ['a', 'b'],
      confirmedThrough: '2026-08-18',
      confirmedAt: '2026-08-19T10:00:00.000Z',
    });
  });

  it('accumulates ids across acknowledgements', () => {
    const first = advancePartnerDayCheckpoint(null, [record({ id: 'a' })])!;
    const second = advancePartnerDayCheckpoint(first, [record({ id: 'b' })])!;
    expect(second.confirmedRecordIds.sort()).toEqual(['a', 'b']);
  });

  it('lets the bound move back for a late older record, because that direction is safe', () => {
    // This used to be floored at the previous bound to avoid "reopening a settled
    // window". That flooring is what could strand unseen records: the days between
    // the older acknowledgement and the old bound may hold things nobody saw.
    // Reopening them is harmless -- everything actually acknowledged is held out by
    // id -- so what comes back is exactly what was never confirmed.
    const first = advancePartnerDayCheckpoint(null, [record({ id: 'a', date: '2026-08-18' })])!;
    const second = advancePartnerDayCheckpoint(first, [record({ id: 'late', date: '2026-08-15' })])!;
    expect(second.confirmedThrough).toBe('2026-08-15');
    expect(second.confirmedRecordIds.sort()).toEqual(['a', 'late']);

    // The reopened span surfaces the unseen record and NOT the acknowledged ones.
    const seen = record({ id: 'a', date: '2026-08-18' });
    const neverSeen = record({ id: 'unseen', date: '2026-08-16' });
    expect(ids(missedPartnerRecords([seen, neverSeen], VIEWER, TODAY, second)))
      .toEqual(['unseen']);
  });

  it('stops the bound at the earliest record still outstanding', () => {
    const acknowledged = [record({ id: 'r2', date: '2026-08-16' }), record({ id: 'r3', date: '2026-08-17' })];
    const window = [record({ id: 'locked', date: '2026-08-15' }), ...acknowledged];
    const next = advancePartnerDayCheckpoint(null, acknowledged, window)!;
    expect(next.confirmedThrough).toBe('2026-08-15');
  });

  it('advances to the newest acknowledged date when nothing is outstanding', () => {
    const acknowledged = [record({ id: 'r1', date: '2026-08-16' }), record({ id: 'r2', date: '2026-08-17' })];
    const next = advancePartnerDayCheckpoint(null, acknowledged, acknowledged)!;
    expect(next.confirmedThrough).toBe('2026-08-17');
  });

  /**
   * The regression that matters most: acknowledging the visible prefix of a long
   * window must not consume the part the viewer never saw.
   */
  it('acknowledging the visible five of twenty keeps the other fifteen', () => {
    const all = Array.from({ length: 20 }, (_, i) => record({
      id: `rec-${String(i).padStart(2, '0')}`,
      date: '2026-08-17',
      time: `${String(i).padStart(2, '0')}:00`,
    }));
    const window = missedPartnerRecords(all, VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-08-17' }));
    expect(window).toHaveLength(20);

    const visible = window.slice(0, 5);
    const next = advancePartnerDayCheckpoint(checkpoint({ confirmedThrough: '2026-08-17' }), visible)!;
    const remaining = missedPartnerRecords(all, VIEWER, TODAY, next);

    expect(remaining).toHaveLength(15);
    expect(ids(remaining)[0]).toBe('rec-05');
    // Nothing the viewer had not reached was consumed.
    expect(ids(remaining)).not.toContain('rec-04');
  });
});

describe('checkpoint storage is scoped to one viewer and one couple', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('keys by viewer and couple', () => {
    expect(partnerDayCheckpointKey('user-a', 'couple-a'))
      .toBe('gomsinlog.partner-day.v1:user-a:couple-a');
  });

  it('round-trips a checkpoint', () => {
    expect(writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint({ confirmedRecordIds: ['x'] })))
      .toBe(true);
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toEqual({
      confirmedRecordIds: ['x'],
      observedRecordIds: [],
      confirmedThrough: TODAY,
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    });
  });

  it("account A's receipt does not suppress account B on the same device", () => {
    writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint({ confirmedRecordIds: ['x'] }));
    expect(readPartnerDayCheckpoint('user-b', 'couple-a')).toBeNull();
  });

  it("a previous couple's receipt does not suppress a new couple", () => {
    writePartnerDayCheckpoint('user-a', 'couple-old', checkpoint({ confirmedRecordIds: ['x'] }));
    expect(readPartnerDayCheckpoint('user-a', 'couple-new')).toBeNull();
  });

  it('an unlinked viewer with no couple id neither reads nor writes a receipt', () => {
    expect(writePartnerDayCheckpoint('user-a', '', checkpoint())).toBe(false);
    expect(readPartnerDayCheckpoint('user-a', '')).toBeNull();
  });

  it('a corrupt receipt degrades to showing more, not less', () => {
    localStorage.setItem(partnerDayCheckpointKey('user-a', 'couple-a'), 'not json');
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toBeNull();
  });

  it('rejects a stored receipt whose bound is not a real date', () => {
    localStorage.setItem(
      partnerDayCheckpointKey('user-a', 'couple-a'),
      JSON.stringify({ confirmedRecordIds: [], confirmedThrough: 'yesterday', confirmedAt: TODAY }),
    );
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toBeNull();
  });
});

describe('copy inputs: what the window is allowed to claim', () => {
  it('reports a window that reaches before today', () => {
    expect(spansBeforeToday([record({ date: '2026-08-18' })], TODAY)).toBe(true);
  });

  it('reports a today-only window as today-only even though the window is 7 days wide', () => {
    expect(spansBeforeToday([record({ date: TODAY })], TODAY)).toBe(false);
    expect(spansBeforeToday([], TODAY)).toBe(false);
  });

  it('labels today with no date, yesterday as 어제, and older by date', () => {
    expect(partnerDayDateLabel(TODAY, TODAY)).toBeNull();
    expect(partnerDayDateLabel('2026-08-18', TODAY)).toBe('어제');
    expect(partnerDayDateLabel('2026-08-15', TODAY)).toBe('8월 15일');
  });

  it('labels across a month boundary without arithmetic on the string', () => {
    vi.useFakeTimers();
    expect(partnerDayDateLabel('2026-07-31', '2026-08-01')).toBe('어제');
    vi.useRealTimers();
  });
});

describe('local date semantics', () => {
  it('derives the fallback window from the local date, not a UTC instant', () => {
    // Late evening in +09:00 is still the previous UTC day. A UTC-based bound
    // would move the whole window a day and drop the oldest day of it.
    const localDate = toLocalDateString(new Date(2026, 7, 19, 23, 30));
    expect(localDate).toBe('2026-08-19');
    expect(partnerDayWindow(null, localDate).since).toBe('2026-08-13');
  });
});

describe('a record this device cannot read yet is not consumed by acknowledging around it', () => {
  it('still shows a locked older record once its key arrives', () => {
    // The soldier's new device cannot decrypt the 15th yet, so only the 16th and
    // 17th are drawn and only those can be acknowledged. If the bound advanced to
    // the 17th, the 15th would be gone for good the moment provisioning completed.
    const unreadable = record({ id: 'locked', date: '2026-08-15', contentUnavailable: true });
    const r2 = record({ id: 'r2', date: '2026-08-16' });
    const r3 = record({ id: 'r3', date: '2026-08-17' });

    // Exactly what the widget passes: the readable prefix, plus the whole window.
    const next = advancePartnerDayCheckpoint(null, [r2, r3], [unreadable, r2, r3])!;
    expect(next.confirmedThrough).toBe('2026-08-15');

    const afterProvisioning = [{ ...unreadable, contentUnavailable: false }, r2, r3];
    const remaining = missedPartnerRecords(afterProvisioning, VIEWER, TODAY, next);

    expect(ids(remaining)).toEqual(['locked']);
  });

  it('a record arriving later on the confirmed date is still shown', () => {
    // The late-sync case: an offline record uploaded after the acknowledgement,
    // dated the same day the bound sits on. The bound is inclusive for this reason.
    const acked = record({ id: 'acked', date: '2026-08-18', time: '09:00' });
    const next = advancePartnerDayCheckpoint(null, [acked], [acked])!;
    const late = record({ id: 'late', date: '2026-08-18', time: '23:00' });
    expect(ids(missedPartnerRecords([acked, late], VIEWER, TODAY, next))).toEqual(['late']);
  });
});

describe('a record that arrives after the checkpoint, dated before it', () => {
  it('surfaces an offline backlog flushed days later', () => {
    // Composed on the 16th while the partner had no signal, delivered on the 19th.
    // `TodayLogWidget` stamps the compose date, so the row really does say 8/16.
    const r17 = record({ id: 'r17', date: '2026-08-17' });
    const r18 = record({ id: 'r18', date: '2026-08-18' });
    const cp = advancePartnerDayCheckpoint(null, [r17, r18], [r17, r18], {
      records: [r17, r18],
      viewer: VIEWER,
    })!;
    expect(cp.confirmedThrough).toBe('2026-08-18');

    const late16 = record({ id: 'late16', date: '2026-08-16' });
    expect(ids(missedPartnerRecords([r17, r18, late16], VIEWER, TODAY, cp)))
      .toEqual(['late16']);
  });

  it('surfaces a record that was simply missing from the snapshot at acknowledgement', () => {
    // Delayed sync rather than offline composition: the row existed server-side
    // but this client had not received it when the receipt was written.
    const seen = record({ id: 'seen', date: '2026-08-18' });
    const cp = advancePartnerDayCheckpoint(null, [seen], [seen], {
      records: [seen],
      viewer: VIEWER,
    })!;
    const arrivedLate = record({ id: 'arrived-late', date: '2026-08-15' });
    expect(ids(missedPartnerRecords([seen, arrivedLate], VIEWER, TODAY, cp)))
      .toEqual(['arrived-late']);
  });

  it('is unaffected by the viewer device clock being 48 hours out in either direction', () => {
    // The whole point of keying on ids. `confirmedAt` is this device's wall clock
    // and `createdAt` is Postgres's; any comparison between them loses records
    // when the two disagree. Nothing here reads either one.
    const seen = record({ id: 'seen', date: '2026-08-18' });
    const late = record({ id: 'late', date: '2026-08-16', createdAt: '2026-08-16T09:00:00.000Z' });
    const base = new Date('2026-08-18T12:00:00.000Z');
    const skews = [
      base,
      new Date(base.getTime() + 48 * 3600_000),
      new Date(base.getTime() - 48 * 3600_000),
    ];

    const results = skews.map((now) => {
      const cp = advancePartnerDayCheckpoint(
        null, [seen], [seen], { records: [seen], viewer: VIEWER }, now,
      )!;
      return ids(missedPartnerRecords([seen, late], VIEWER, TODAY, cp));
    });

    expect(results).toEqual([['late'], ['late'], ['late']]);
    // And the receipts really did differ, so the invariance is not vacuous.
    expect(new Set(skews.map((d) => d.toISOString())).size).toBe(3);
  });

  it('keeps a late older record after the viewer acknowledges a newer prefix', () => {
    // The interaction that could quietly undo the rescue: acknowledging anything
    // records `late16` as observed, so the rescue path stops applying to it. The
    // date bound has to take over, which it does because `late16` is outstanding.
    const late16 = record({ id: 'late16', date: '2026-08-16' });
    const r19a = record({ id: 'r19a', date: TODAY, time: '09:00' });
    const r19b = record({ id: 'r19b', date: TODAY, time: '10:00' });
    const all = [late16, r19a, r19b];

    const window = missedPartnerRecords(all, VIEWER, TODAY, observing(
      ['r19a', 'r19b'], { confirmedThrough: '2026-08-18' },
    ));
    expect(ids(window)).toEqual(['late16', 'r19a', 'r19b']);

    // The viewer acknowledges only the two newest.
    const next = advancePartnerDayCheckpoint(
      observing(['r19a', 'r19b'], { confirmedThrough: '2026-08-18' }),
      [r19a, r19b],
      window,
      { records: all, viewer: VIEWER },
    )!;

    expect(next.observedRecordIds).toContain('late16');
    // Held back by the outstanding record rather than jumping to the 19th.
    expect(next.confirmedThrough).toBe('2026-08-16');
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, next))).toEqual(['late16']);
  });

  it('does not rescue a future-dated record however newly it appeared', () => {
    const cp = observing(['seen'], { confirmedThrough: '2026-08-18' });
    const future = record({ id: 'future', date: '2026-08-25' });
    expect(ids(missedPartnerRecords([future], VIEWER, TODAY, cp))).toEqual([]);
  });

  it('never rescues a private record, and its existence changes no count', () => {
    const cp = observing([], { confirmedThrough: '2026-08-18' });
    const secret = record({ id: 'secret', date: '2026-08-16', isPrivate: true });
    const shared = record({ id: 'shared', date: '2026-08-16' });

    expect(ids(missedPartnerRecords([secret], VIEWER, TODAY, cp))).toEqual([]);
    expect(missedPartnerRecords([shared, secret], VIEWER, TODAY, cp))
      .toHaveLength(missedPartnerRecords([shared], VIEWER, TODAY, cp).length);
  });

  it("never writes a private or own record's id into the observation snapshot", () => {
    const shared = record({ id: 'shared' });
    const secret = record({ id: 'secret', isPrivate: true });
    const mine = record({ id: 'mine', userId: ME, authorRole: 'soldier' });
    const cp = advancePartnerDayCheckpoint(null, [shared], [shared], {
      records: [shared, secret, mine],
      viewer: VIEWER,
    })!;

    expect(cp.observedRecordIds).toEqual(['shared']);
    expect(cp.observedRecordIds).not.toContain('secret');
    expect(cp.observedRecordIds).not.toContain('mine');
  });

});

/**
 * The receipt has to CONVERGE over the life of a relationship.
 *
 * Both id lists used to be truncated at 500. An id dropped to save space is
 * indistinguishable from one that was never seen, so compaction manufactured
 * "never observed" verdicts, the late-arrival rescue reopened those records, and
 * the bound was dragged back to the oldest of them -- which produced still more
 * evicted ids next pass. Past ~500 shared records the window GREW when the viewer
 * pressed the acknowledge button, and could never be cleared again.
 *
 * These simulate the relationship day by day rather than dropping a pile of
 * records on a cold checkpoint, because that is the only way the receipt actually
 * accumulates past the old cap: from a standing start §6.5's seven-day fallback
 * means barely a week of records ever enters the window, so a bulk fixture
 * exercises none of this. Dates are distinct for the same reason -- the cascade
 * needs somewhere for the bound to be dragged back to.
 */
describe('a long relationship still drains to nothing', () => {
  function dayOffset(n: number): string {
    const d = new Date(Date.UTC(2026, 7, 19));
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Live the relationship one day at a time: records land, the viewer opens the
   * surface and acknowledges until it is empty, then the next day begins.
   *
   * The per-day ceiling is what turns a reopening loop into a deterministic
   * failure instead of a hung CI job: each pass confirms at least one record, so
   * no honest day can need more passes than it has records.
   */
  function liveRelationship(days: number, perDay = 1) {
    const all: DailyRecord[] = [];
    let cp: PartnerDayCheckpoint | null = null;
    let worstDayWindow = 0;
    let grewAfterAck = false;

    for (let day = days - 1; day >= 0; day -= 1) {
      const date = dayOffset(day);
      for (let k = 0; k < perDay; k += 1) {
        all.push(record({
          id: `r-${String(days - day)}-${k}`,
          date,
          time: `0${k}:00`,
          createdAt: `${date}T0${k}:00:00.000Z`,
        }));
      }

      /*
       * Tight on purpose. A day that converges cannot need more passes than it
       * has records to confirm, plus a little slack; anything beyond that is a
       * receipt reopening what it just closed. A generous ceiling would still
       * terminate, but only after quadratic work -- the reopening version of this
       * code ground for minutes instead of failing, which is the worst way for a
       * regression to report. Failing here names the cause directly.
       */
      const ceiling = perDay + 3;
      let previous = Infinity;
      let drained = false;
      for (let pass = 0; pass < ceiling; pass += 1) {
        const missed = missedPartnerRecords(all, VIEWER, date, cp);
        worstDayWindow = Math.max(worstDayWindow, missed.length);
        if (missed.length > previous) grewAfterAck = true;
        previous = missed.length;
        if (missed.length === 0) { drained = true; break; }
        cp = advancePartnerDayCheckpoint(cp, missed.slice(0, 5), missed, {
          records: all, viewer: VIEWER,
        });
      }
      if (!drained) {
        throw new Error(
          `day ${date} (record ${all.length}) did not drain within ${ceiling} passes; `
          + `window still ${previous}. The receipt is reopening records it already closed.`,
        );
      }
    }

    return {
      cp,
      all,
      worstDayWindow,
      grewAfterAck,
      finalWindow: missedPartnerRecords(all, VIEWER, dayOffset(0), cp).length,
    };
  }

  for (const days of [400, 505, 700]) {
    it(`${days} days of records end with an empty window`, () => {
      const { finalWindow, grewAfterAck, cp } = liveRelationship(days);
      expect(finalWindow).toBe(0);
      // The precise symptom of the old cascade: press the button, get more.
      expect(grewAfterAck).toBe(false);
      expect(cp?.confirmedRecordIds).toHaveLength(days);
    });
  }

  it('2000 records converge, and the receipt keeps every id exactly', () => {
    const { finalWindow, cp, grewAfterAck } = liveRelationship(1000, 2);
    expect(finalWindow).toBe(0);
    expect(grewAfterAck).toBe(false);
    expect(cp?.confirmedRecordIds).toHaveLength(2000);
    expect(cp?.observedRecordIds).toHaveLength(2000);
    // Nothing was compacted away at either end.
    expect(cp?.confirmedRecordIds).toContain('r-1-0');
    expect(cp?.confirmedRecordIds).toContain('r-1000-1');

    // Diagnostic, deliberately NOT an assertion threshold: a browser quota is not
    // a product invariant and must not become one. Recorded so the real order of
    // magnitude is on file rather than guessed at.
    console.log(`[diagnostic] serialized receipt at 2000 records: ${JSON.stringify(cp).length} bytes`);
  });

  it('a day never reopens the whole relationship', () => {
    // Under the cap this reached into the hundreds on an ordinary day.
    const { worstDayWindow } = liveRelationship(700);
    expect(worstDayWindow).toBeLessThan(20);
  });

  it('survives a storage round-trip at that size without dropping ids', () => {
    const { cp, all } = liveRelationship(600);
    expect(writePartnerDayCheckpoint('user-a', 'couple-a', cp!)).toBe(true);
    const reloaded = readPartnerDayCheckpoint('user-a', 'couple-a');
    expect(reloaded?.confirmedRecordIds).toHaveLength(600);
    expect(reloaded?.observedRecordIds).toHaveLength(600);
    expect(missedPartnerRecords(all, VIEWER, TODAY, reloaded)).toHaveLength(0);
    localStorage.clear();
  });
});

/**
 * `writePartnerDayCheckpoint` refuses malformed receipts.
 *
 * The read side already rejects them, so a bad write degrades to "no checkpoint"
 * and shows more -- but a receipt that cannot be read back is indistinguishable
 * from a lost acknowledgement, and the write is where that is cheapest to stop.
 * Deleting these guards previously changed no test.
 */
describe('writePartnerDayCheckpoint refuses to persist a malformed receipt', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const cases: Array<[string, string, string, PartnerDayCheckpoint]> = [
    ['an empty user id', '', 'couple-a', checkpoint()],
    ['an empty couple id', 'user-a', '', checkpoint()],
    ['a non-date confirmedThrough', 'user-a', 'couple-a', checkpoint({ confirmedThrough: 'yesterday' })],
    ['an empty confirmedThrough', 'user-a', 'couple-a', checkpoint({ confirmedThrough: '' })],
    ['an impossible calendar date', 'user-a', 'couple-a', checkpoint({ confirmedThrough: '2026-13-45' })],
    ['a non-parsable confirmedAt', 'user-a', 'couple-a', checkpoint({ confirmedAt: 'just now' })],
  ];

  for (const [label, userId, coupleId, cp] of cases) {
    it(`refuses ${label}, and writes nothing`, () => {
      expect(writePartnerDayCheckpoint(userId, coupleId, cp)).toBe(false);
      expect(localStorage.length).toBe(0);
    });
  }

  it('accepts a well-formed receipt, so the refusals above are not vacuous', () => {
    expect(writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint())).toBe(true);
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).not.toBeNull();
  });

  it('reports failure when the storage itself throws, and leaves nothing behind', () => {
    // A real throwing Storage rather than a spy on one method: whether `setItem`
    // is an own property or inherited differs between jsdom builds, and a spy that
    // silently misses turns this into a test that proves the opposite of its name.
    const real = globalThis.localStorage;
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try {
      expect(writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint())).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toBeNull();
  });
});
