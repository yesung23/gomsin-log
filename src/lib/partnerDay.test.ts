import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DailyRecord } from '@/types';
import type { Viewer } from '@/lib/privacy';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';
import {
  advancePartnerDayCheckpoint,
  eligibleSharedPartnerRecords,
  missedPartnerRecords,
  partnerDayCheckpointKey,
  partnerDayDateLabel,
  partnerDayFallbackWindow,
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

/** A receipt in the current shape. Defaults attest to nothing. */
function checkpoint(overrides: Partial<PartnerDayCheckpoint> = {}): PartnerDayCheckpoint {
  return {
    confirmedRecordIds: [],
    outstandingRecordIds: [],
    observedRecordIds: [],
    confirmedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

/** Shorthand: this receipt had already seen exactly these ids. */
function observing(observedRecordIds: string[], overrides: Partial<PartnerDayCheckpoint> = {}) {
  return checkpoint({ observedRecordIds, ...overrides });
}

const ids = (records: DailyRecord[]) => records.map((r) => r.id);


/** Days back from TODAY, as a local date string. */
function day(n: number): string {
  const d = parseLocalDate(TODAY);
  d.setDate(d.getDate() - n);
  return toLocalDateString(d);
}

function at(id: string, n: number, over: Partial<DailyRecord> = {}): DailyRecord {
  return record({ id, date: day(n), createdAt: `${day(n)}T09:00:00.000Z`, ...over });
}

/** Acknowledge the readable prefix until the surface is empty or the ceiling trips. */
function drain(all: DailyRecord[], cp: PartnerDayCheckpoint | null, todayStr = TODAY) {
  let current = cp;
  let grew = false;
  let previous = Infinity;
  const ceiling = all.length + 2;
  for (let pass = 0; pass < ceiling; pass += 1) {
    const missed = missedPartnerRecords(all, VIEWER, todayStr, current);
    if (missed.length > previous) grew = true;
    previous = missed.length;
    const readable = missed.filter((r) => !r.contentUnavailable);
    if (readable.length === 0) {
      return { cp: current, remaining: missed.length, grew, passes: pass };
    }
    current = advancePartnerDayCheckpoint(current, readable.slice(0, 5), missed, {
      records: all, viewer: VIEWER, todayStr,
    });
  }
  return {
    cp: current,
    remaining: missedPartnerRecords(all, VIEWER, todayStr, current).length,
    grew,
    passes: ceiling,
  };
}

describe('§6.5 fallback: the only place a date decides anything', () => {
  it('covers the last seven days including today, and nothing older', () => {
    expect(partnerDayFallbackWindow(TODAY)).toEqual({ since: day(6), until: TODAY });
  });

  it('with no receipt, shows the fallback window only', () => {
    const all = [at('old', 7), at('edge', 6), at('today', 0)];
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, null))).toEqual(['edge', 'today']);
  });

  it('never surfaces a future-dated record, receipt or not', () => {
    const future = record({ id: 'future', date: '2026-08-25' });
    expect(missedPartnerRecords([future], VIEWER, TODAY, null)).toEqual([]);
    expect(missedPartnerRecords([future], VIEWER, TODAY, observing([]))).toEqual([]);
    // Not even when it is outstanding: a date that has not arrived is not missed.
    expect(missedPartnerRecords([future], VIEWER, TODAY, checkpoint({
      outstandingRecordIds: ['future'],
    }))).toEqual([]);
  });
});

describe('the three states are distinct', () => {
  const seen = at('seen', 10);
  const left = at('left', 10, { time: '10:00' });
  const gone = at('gone', 10, { time: '11:00' });
  const all = [seen, left, gone];

  const cp = checkpoint({
    confirmedRecordIds: ['gone'],
    outstandingRecordIds: ['left'],
    observedRecordIds: ['seen', 'left', 'gone'],
  });

  it('CONFIRMED is never shown', () => {
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, cp))).not.toContain('gone');
  });

  it('OUTSTANDING is shown however old it is', () => {
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, cp))).toContain('left');
  });

  it('OBSERVED but neither outstanding nor confirmed stays gone', () => {
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, cp))).not.toContain('seen');
  });

  it('a record in none of the three sets is a new arrival and is shown', () => {
    const late = at('late', 300);
    expect(ids(missedPartnerRecords([...all, late], VIEWER, TODAY, cp))).toContain('late');
  });
});

describe('acknowledgement never resurrects history', () => {
  /** Two years already on the client, of which only this week was ever surfaced. */
  function longRelationship() {
    const all: DailyRecord[] = [];
    for (let d = 730; d >= 7; d -= 1) all.push(at(`h-${d}`, d));
    for (let d = 6; d >= 0; d -= 1) all.push(at(`w-${d}`, d));
    return all;
  }

  it('the reported 3 -> 1270 flood does not happen', () => {
    const all = longRelationship();
    // First-ever visit: the fallback exposes one week; acknowledge it away.
    const first = drain(all, null);
    expect(first.remaining).toBe(0);

    // Next day: two new records, plus one late arrival dated 300 days ago that
    // this device cannot decrypt -- so it can never be part of a visible prefix.
    all.push(at('new-1', 0, { time: '12:00' }));
    all.push(at('new-2', 0, { time: '13:00' }));
    all.push(at('late-300', 300, { contentUnavailable: true }));

    const before = missedPartnerRecords(all, VIEWER, TODAY, first.cp);
    expect(before).toHaveLength(3);

    const readable = before.filter((r) => !r.contentUnavailable);
    const next = advancePartnerDayCheckpoint(first.cp, readable, before, {
      records: all, viewer: VIEWER, todayStr: TODAY,
    });
    const after = missedPartnerRecords(all, VIEWER, TODAY, next);

    // Only the undecryptable record remains. The ~700 historical records that were
    // observed but never outstanding stay where they were.
    expect(ids(after)).toEqual(['late-300']);
  });

  it('the undecryptable record survives until it can be read, then clears', () => {
    const all = longRelationship();
    const first = drain(all, null);
    all.push(at('locked', 300, { contentUnavailable: true }));

    let cp = first.cp;
    for (let pass = 0; pass < 3; pass += 1) {
      const missed = missedPartnerRecords(all, VIEWER, TODAY, cp);
      expect(ids(missed)).toEqual(['locked']);
      // Nothing readable to acknowledge, so nothing may advance.
      expect(advancePartnerDayCheckpoint(cp, [], missed, { records: all, viewer: VIEWER, todayStr: TODAY }))
        .toBeNull();
      cp = cp!;
    }

    // The key arrives.
    const unlocked = all.map((r) => (r.id === 'locked' ? { ...r, contentUnavailable: false } : r));
    const done = drain(unlocked, cp);
    expect(done.remaining).toBe(0);
    expect(done.grew).toBe(false);
  });
});

describe('invariant: acknowledgement may not grow the surface', () => {
  it('holds across partial acknowledgement of twenty same-date records', () => {
    const all = Array.from({ length: 20 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, 3, {
      time: `${String(i).padStart(2, '0')}:00`,
    }));
    const result = drain(all, null);
    expect(result.grew).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('holds across a multi-day window acknowledged five at a time', () => {
    const all: DailyRecord[] = [];
    for (let d = 6; d >= 0; d -= 1) {
      for (let k = 0; k < 4; k += 1) all.push(at(`d${d}-${k}`, d, { time: `0${k}:00` }));
    }
    const result = drain(all, null);
    expect(result.grew).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('the unacknowledged remainder of a visible prefix stays reachable', () => {
    const all = Array.from({ length: 20 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, 3, {
      time: `${String(i).padStart(2, '0')}:00`,
    }));
    const missed = missedPartnerRecords(all, VIEWER, TODAY, null);
    const next = advancePartnerDayCheckpoint(null, missed.slice(0, 5), missed, {
      records: all, viewer: VIEWER, todayStr: TODAY,
    })!;
    expect(next.outstandingRecordIds).toHaveLength(15);
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, next))).toEqual(
      all.slice(5).map((r) => r.id),
    );
  });
});

describe('late arrivals', () => {
  it('an old-date record absent from the last snapshot surfaces', () => {
    const seen = at('seen', 2);
    const cp = observing(['seen'], { confirmedRecordIds: ['seen'] });
    const late = at('late', 90);
    expect(ids(missedPartnerRecords([seen, late], VIEWER, TODAY, cp))).toEqual(['late']);
  });

  it('is unaffected by the viewer device clock being 48 hours out either way', () => {
    // Nothing reads `confirmedAt`; this proves the receipts differ and the answer
    // does not.
    const seen = at('seen', 2);
    const late = at('late', 90);
    const base = new Date('2026-08-19T12:00:00.000Z');
    const clocks = [base, new Date(base.getTime() + 172800000), new Date(base.getTime() - 172800000)];

    const results = clocks.map((now) => {
      const cp = advancePartnerDayCheckpoint(null, [seen], [seen], {
        records: [seen], viewer: VIEWER,
      }, now)!;
      return ids(missedPartnerRecords([seen, late], VIEWER, TODAY, cp));
    });
    expect(results).toEqual([['late'], ['late'], ['late']]);
    expect(new Set(clocks.map((d) => d.toISOString())).size).toBe(3);
  });

  it('a record deleted and later restored is never lost', () => {
    const a = at('a', 2);
    const b = at('b', 2, { time: '10:00' });
    const missed = missedPartnerRecords([a, b], VIEWER, TODAY, null);
    const cp = advancePartnerDayCheckpoint(null, [a], missed, { records: [a, b], viewer: VIEWER, todayStr: TODAY })!;
    expect(cp.outstandingRecordIds).toEqual(['b']);

    // `b` disappears from this client's slice, then comes back.
    expect(ids(missedPartnerRecords([a], VIEWER, TODAY, cp))).toEqual([]);
    expect(ids(missedPartnerRecords([a, b], VIEWER, TODAY, cp))).toEqual(['b']);
  });
});

describe('the empty acknowledgement contract', () => {
  it('returns null, so nothing is persisted and nothing advances', () => {
    // The documented no-op. A caller that acknowledges nothing has consumed
    // nothing, and `if (next && write(next))` therefore skips both.
    expect(advancePartnerDayCheckpoint(null, [])).toBeNull();
    expect(advancePartnerDayCheckpoint(observing(['x']), [])).toBeNull();
    expect(advancePartnerDayCheckpoint(observing(['x']), [], [at('y', 1)], {
      records: [at('y', 1)], viewer: VIEWER, todayStr: TODAY,
    })).toBeNull();
  });
});

describe('privacy is settled before any classification', () => {
  it("never returns the partner's private records, at any state", () => {
    const secret = at('secret', 2, { isPrivate: true });
    for (const cp of [null, observing([]), checkpoint({ outstandingRecordIds: ['secret'] })]) {
      expect(missedPartnerRecords([secret], VIEWER, TODAY, cp)).toEqual([]);
    }
  });

  it("never returns the viewer's own records", () => {
    const mine = at('mine', 2, { userId: ME, authorRole: 'soldier' });
    expect(missedPartnerRecords([mine], VIEWER, TODAY, null)).toEqual([]);
  });

  it('a private record changes no count', () => {
    const shared = at('shared', 2);
    const secret = at('secret', 2, { isPrivate: true, time: '10:00' });
    expect(missedPartnerRecords([shared, secret], VIEWER, TODAY, null))
      .toHaveLength(missedPartnerRecords([shared], VIEWER, TODAY, null).length);
  });

  it('no private or own id can enter the observed or outstanding sets', () => {
    const shared = at('shared', 2);
    const secret = at('secret', 2, { isPrivate: true, time: '10:00' });
    const mine = at('mine', 2, { userId: ME, authorRole: 'soldier', time: '11:00' });
    const all = [shared, secret, mine];
    const missed = missedPartnerRecords(all, VIEWER, TODAY, null);
    const cp = advancePartnerDayCheckpoint(null, missed, missed, {
      records: all, viewer: VIEWER, todayStr: TODAY,
    })!;
    expect(cp.observedRecordIds).toEqual(['shared']);
    expect(cp.outstandingRecordIds).toEqual([]);
    expect(cp.confirmedRecordIds).toEqual(['shared']);
  });
});

describe('a receipt from the previous shape fails open', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reopens everything unconfirmed rather than hiding it', () => {
    localStorage.setItem(partnerDayCheckpointKey('user-a', 'couple-a'), JSON.stringify({
      confirmedRecordIds: ['old-confirmed'],
      confirmedThrough: TODAY,
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    }));
    const legacy = readPartnerDayCheckpoint('user-a', 'couple-a')!;
    expect(legacy.outstandingRecordIds).toEqual([]);
    expect(legacy.observedRecordIds).toEqual([]);

    const all = [at('old-confirmed', 400), at('ancient', 400, { time: '10:00' })];
    // The confirmed one stays confirmed; everything else comes back once.
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, legacy))).toEqual(['ancient']);
  });
});

/**
 * The eligibility domain is shared, so OBSERVED can never range wider than the
 * surface. When the two computed their own domains a future-dated record was
 * recorded as "already known" while being correctly withheld, and the day its date
 * arrived it was eligible, unconfirmed, not outstanding, and observed -- gone for
 * good, with nobody having acknowledged it.
 */
describe('a future-dated record is withheld, not entombed', () => {
  it('surfaces on the day it becomes eligible, having never been acknowledged', () => {
    const rToday = record({ id: 'rToday', date: '2026-08-19' });
    const rFuture = record({ id: 'rFuture', date: '2026-08-20' });
    const all = [rToday, rFuture];

    const missed = missedPartnerRecords(all, VIEWER, '2026-08-19', null);
    expect(ids(missed)).toEqual(['rToday']);

    const cp = advancePartnerDayCheckpoint(null, missed, missed, {
      records: all, viewer: VIEWER, todayStr: '2026-08-19',
    })!;
    // It was never eligible, so the receipt may not claim to have known it.
    expect(cp.observedRecordIds).toEqual(['rToday']);

    // The next day. No new sync, no new arrival -- only `todayStr` moved.
    expect(ids(missedPartnerRecords(all, VIEWER, '2026-08-20', cp))).toEqual(['rFuture']);
  });

  it('needs no synchronisation event: the record was already in local state', () => {
    const future = record({ id: 'future', date: '2026-08-22' });
    const today = record({ id: 'today', date: '2026-08-19' });
    const all = [today, future];
    let cp = advancePartnerDayCheckpoint(null, [today], [today], {
      records: all, viewer: VIEWER, todayStr: '2026-08-19',
    })!;

    // Two days pass with the same `all` array.
    expect(missedPartnerRecords(all, VIEWER, '2026-08-20', cp)).toEqual([]);
    expect(missedPartnerRecords(all, VIEWER, '2026-08-21', cp)).toEqual([]);
    expect(ids(missedPartnerRecords(all, VIEWER, '2026-08-22', cp))).toEqual(['future']);

    // And only an explicit acknowledgement retires it.
    const missed = missedPartnerRecords(all, VIEWER, '2026-08-22', cp);
    cp = advancePartnerDayCheckpoint(cp, missed, missed, {
      records: all, viewer: VIEWER, todayStr: '2026-08-22',
    })!;
    expect(missedPartnerRecords(all, VIEWER, '2026-08-22', cp)).toEqual([]);
  });

  /**
   * STATE_MACHINE_LEVEL_ONLY. The record edit form writes only `log`, so a record
   * cannot be re-dated through the product today. Asserted at this level because
   * the state machine must not depend on that remaining true.
   */
  it('an outstanding record pushed out of eligibility is not silently retired', () => {
    const a = record({ id: 'a', date: '2026-08-19', time: '09:00' });
    const b = record({ id: 'b', date: '2026-08-19', time: '10:00' });
    const missed = missedPartnerRecords([a, b], VIEWER, '2026-08-19', null);
    let cp = advancePartnerDayCheckpoint(null, [a], missed, {
      records: [a, b], viewer: VIEWER, todayStr: '2026-08-19',
    })!;
    expect(cp.outstandingRecordIds).toEqual(['b']);

    // `b` is re-dated into the future and a further acknowledgement happens.
    const bFuture = { ...b, date: '2026-08-25' };
    const later = [a, bFuture];
    const nowMissed = missedPartnerRecords(later, VIEWER, '2026-08-20', cp);
    expect(nowMissed).toEqual([]);
    const c = record({ id: 'c', date: '2026-08-20' });
    const withC = [a, bFuture, c];
    const missedWithC = missedPartnerRecords(withC, VIEWER, '2026-08-20', cp);
    cp = advancePartnerDayCheckpoint(cp, missedWithC, missedWithC, {
      records: withC, viewer: VIEWER, todayStr: '2026-08-20',
    })!;
    // It was out of the domain, so it cannot have been recorded as observed.
    expect(cp.observedRecordIds).not.toContain('b');

    // When its date arrives it is reachable again, never having been confirmed.
    expect(ids(missedPartnerRecords(withC, VIEWER, '2026-08-25', cp))).toEqual(['b']);
  });
});

describe('historical-known is not the same as a late arrival', () => {
  it('pre-fallback history stays put, while a genuinely new old record surfaces', () => {
    // Two years already in local state; the first visit shows only the fallback.
    const all: DailyRecord[] = [];
    for (let d = 730; d >= 7; d -= 1) all.push(at(`old-${d}`, d));
    for (let d = 6; d >= 0; d -= 1) all.push(at(`week-${d}`, d));

    const first = drain(all, null);
    expect(first.remaining).toBe(0);
    // The old records ARE recorded as known -- that is what stops them later
    // masquerading as late arrivals.
    expect(first.cp!.observedRecordIds).toContain('old-730');

    // oldExisting: present before the receipt, outside the fallback.
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, first.cp))).toEqual([]);

    // oldLate: absent at the receipt, arriving now with a date in the same range.
    const oldLate = at('old-late', 400);
    expect(ids(missedPartnerRecords([...all, oldLate], VIEWER, TODAY, first.cp)))
      .toEqual(['old-late']);
  });
});

describe('a malformed confirmedAt is rejected on read', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  for (const bad of [undefined, '', 'just now', 42, null]) {
    it(`rejects confirmedAt = ${JSON.stringify(bad)}, degrading to no receipt`, () => {
      localStorage.setItem(partnerDayCheckpointKey('u', 'c'), JSON.stringify({
        confirmedRecordIds: ['x'],
        outstandingRecordIds: [],
        observedRecordIds: ['x'],
        confirmedAt: bad,
      }));
      // No receipt means the fallback window, which shows MORE, not less.
      expect(readPartnerDayCheckpoint('u', 'c')).toBeNull();
    });
  }

  it('accepts a well-formed one, so the rejections above are not vacuous', () => {
    expect(writePartnerDayCheckpoint('u', 'c', checkpoint())).toBe(true);
    expect(readPartnerDayCheckpoint('u', 'c')).not.toBeNull();
  });
});

describe('an empty observation attests to nothing', () => {
  it('reopens everything unconfirmed rather than hiding it', () => {
    const cp = checkpoint({ confirmedRecordIds: ['seen'], observedRecordIds: [] });
    const all = [at('seen', 300), at('never', 300, { time: '10:00' })];
    expect(ids(missedPartnerRecords(all, VIEWER, TODAY, cp))).toEqual(['never']);
  });
});

/**
 * A deterministic thousand-day simulation.
 *
 * The unit tests above each pin one rule. This exists because the defects in this
 * module were never one rule being wrong -- they were two correct-looking rules
 * interacting over a history longer than any fixture. Both blockers found by
 * review (a bound rolling backwards, and id compaction) needed hundreds of days to
 * become visible, and neither would have been caught by a scenario anyone thought
 * to write by hand.
 *
 * Seeded so a CI failure reproduces exactly.
 */
describe('1000-day seeded relationship simulation', () => {
  function makeRng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it('never strands a record, and acknowledgement never grows the surface', () => {
    const SEED = 20260819;
    const rng = makeRng(SEED);
    const DAYS = 1000;

    const all: DailyRecord[] = [];
    const deleted = new Set<string>();
    let cp: PartnerDayCheckpoint | null = null;
    let created = 0;
    let grewWithoutArrival = 0;
    let maxWindow = 0;
    /*
     * The simulation is only worth its runtime if it actually reaches the states
     * it claims to cover, and the previous version did not: its late-arrival
     * generator could only ever emit OLDER dates, so across 2906 records it
     * produced not one forward-dated record -- exactly the axis on which the
     * implementation was broken. Counting the categories and failing on a zero
     * turns "the generator drifted" from a silent pass into a red test.
     */
    const seen = {
      forwardDated: 0,
      lateOld: 0,
      unreadableToReadable: 0,
      partialAck: 0,
      noOpenGap: 0,
      deleteReappear: 0,
      over500: 0,
      over2000: 0,
    };

    const visibleTo = () => all.filter((r) => !deleted.has(r.id));

    for (let d = DAYS - 1; d >= 0; d -= 1) {
      const today = day(d);
      let arrivedToday = 0;

      // Ordinary records, occasionally a burst.
      const count = rng() < 0.08 ? 5 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 4);
      for (let k = 0; k < count; k += 1) {
        created += 1;
        all.push(record({
          id: `r-${created}`,
          date: today,
          time: `${String(8 + k).padStart(2, '0')}:00`,
          createdAt: `${today}T09:00:00.000Z`,
          // Some records cannot be decrypted when they land.
          contentUnavailable: rng() < 0.04,
        }));
        arrivedToday += 1;
      }

      // An offline backlog flushing late, stamped with its compose date. `day()`
      // counts BACKWARDS from TODAY, so a larger argument is an older date --
      // getting that backwards is what made the previous generator emit nothing
      // forward-dated.
      if (rng() < 0.05 && d < DAYS - 30) {
        const back = 1 + Math.floor(rng() * 60);
        created += 1;
        all.push(record({
          id: `late-${created}`,
          date: day(Math.min(DAYS - 1, d + back)),
          time: '07:00',
          createdAt: `${today}T09:00:00.000Z`,
        }));
        seen.lateOld += 1;
        arrivedToday += 1;
      }

      // A partner whose device is ahead of the viewer's -- a timezone difference,
      // a fast clock, or a compose landing across the viewer's local midnight.
      // The record is in local state today but is not eligible until later.
      if (rng() < 0.04 && d > 3) {
        created += 1;
        all.push(record({
          id: `fwd-${created}`,
          date: day(d - (1 + Math.floor(rng() * 3))),
          time: '23:30',
          createdAt: `${today}T09:00:00.000Z`,
        }));
        seen.forwardDated += 1;
      }

      // A record the partner deletes, and sometimes restores later.
      if (rng() < 0.03 && all.length > 10) {
        const victim = all[Math.floor(rng() * all.length)];
        deleted.add(victim.id);
      }
      if (rng() < 0.02 && deleted.size > 0) {
        const back = Array.from(deleted)[0];
        deleted.delete(back);
        seen.deleteReappear += 1;
        arrivedToday += 1;
      }

      // A key arrives and unlocks something.
      if (rng() < 0.06) {
        const locked = all.find((r) => r.contentUnavailable);
        if (locked) {
          locked.contentUnavailable = false;
          seen.unreadableToReadable += 1;
        }
      }

      if (all.length > 500) seen.over500 += 1;
      if (all.length > 2000) seen.over2000 += 1;

      // Some days nobody opens the app.
      if (rng() < 0.25) { seen.noOpenGap += 1; continue; }

      const records = visibleTo();
      let previous = missedPartnerRecords(records, VIEWER, today, cp).length;
      maxWindow = Math.max(maxWindow, previous);

      // One or two presses, so a remainder is routinely left outstanding.
      const presses = rng() < 0.5 ? 1 : 2;
      for (let press = 0; press < presses; press += 1) {
        const missed = missedPartnerRecords(records, VIEWER, today, cp);
        const readable = missed.filter((r) => !r.contentUnavailable);
        if (readable.length === 0) break;
        // A press that cannot clear the window leaves a remainder outstanding.
        if (readable.length > 5 || missed.length > readable.length) seen.partialAck += 1;
        const next = advancePartnerDayCheckpoint(cp, readable.slice(0, 5), missed, {
          records, viewer: VIEWER,
        });
        if (next) cp = next;

        const after = missedPartnerRecords(records, VIEWER, today, cp).length;
        // Nothing new arrived between these two measurements, so the surface must
        // not have grown. This is the assertion the 3 -> 295 defect fails.
        if (after > previous) grewWithoutArrival += 1;
        previous = after;
      }
    }

    expect(created).toBeGreaterThan(2500);
    expect(grewWithoutArrival).toBe(0);

    // A category that never fired means this run proved nothing about it. Failing
    // here is the point: it stops a drifting generator from reporting a pass it
    // did not earn.
    for (const [category, count] of Object.entries(seen)) {
      expect(count, `simulation never produced: ${category}`).toBeGreaterThan(0);
    }

    /*
     * Full accounting. Every authorized, non-future, currently-present record must
     * be either confirmed or still reachable -- never in neither state, which is
     * what silent loss looks like.
     */
    const confirmed = new Set(cp!.confirmedRecordIds);
    // Anything still future-dated on the final day is legitimately not yet missed,
    // so it is excluded from the accounting rather than counted as stranded.
    const finalEligible = eligibleSharedPartnerRecords(visibleTo(), VIEWER, day(0));
    const reachable = new Set(ids(missedPartnerRecords(visibleTo(), VIEWER, day(0), cp)));
    const stranded = finalEligible.filter((r) => !confirmed.has(r.id) && !reachable.has(r.id));

    console.log(
      `[simulation seed=${SEED}] records=${created} present=${visibleTo().length} `
      + `confirmed=${confirmed.size} reachable=${reachable.size} stranded=${stranded.length} `
      + `maxWindow=${maxWindow} receipt=${JSON.stringify(cp).length}B`,
    );
    console.log(`[simulation coverage] ${JSON.stringify(seen)}`);

    expect(stranded).toEqual([]);
  });
});

describe('serialized receipt size', () => {
  it('is reported at 500, 2000 and 5000 records', () => {
    // Diagnostic, deliberately not a threshold: a browser quota is not a product
    // invariant and must not become one.
    for (const n of [500, 2000, 5000]) {
      const all = Array.from({ length: n }, (_, i) => record({
        // 36 characters, the shape a server-generated uuid actually has.
        id: `1f0a2b3c-4d5e-6f70-8192-${String(i).padStart(12, '0')}`,
        date: TODAY,
      }));
      const cp = advancePartnerDayCheckpoint(null, all, all, { records: all, viewer: VIEWER, todayStr: TODAY })!;
      console.log(`[storage] ${n} records -> ${JSON.stringify(cp).length} chars`);
      expect(cp.confirmedRecordIds).toHaveLength(n);
    }
  });
});
