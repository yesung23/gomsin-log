import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DailyRecord } from '@/types';
import type { Viewer } from '@/lib/privacy';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';
import {
  acknowledgePartnerDayRecords,
  eligibleSharedPartnerRecords,
  projectPartnerDay,
  readPartnerDayCheckpoint,
  writePartnerDayCheckpoint,
  type PartnerDayCheckpoint,
  type PartnerDayContext,
} from '@/lib/partnerDay';

/**
 * Long-horizon simulations of the partner-day state machine.
 *
 * The unit tests pin one rule each. This file exists because the defects in this
 * feature were never one rule being wrong -- they were two correct-looking rules
 * interacting over a history longer than any hand-written fixture, and the loss
 * only became visible hundreds of days in.
 *
 * Three actors are simulated, because the failure depends on the user's habits:
 *
 *   diligent  confirms what is on screen most days
 *   partial   confirms one page and leaves the rest
 *   OBSERVER  opens the app constantly and NEVER presses the button
 *
 * The observer is the actor the previous implementation lost data for, and it had
 * no simulation. Its invariant is absolute and needs no accounting: for a viewer
 * who never confirms anything, every record ever surfaced is still surfaced.
 *
 * Every run is seeded, and several seeds run, so a CI failure reproduces exactly
 * and a single lucky seed cannot certify the mechanism.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const COUPLE = 'couple-1';
const VIEWER: Viewer = { userId: ME, role: 'soldier' };
const START = '2024-01-01';

function plusDays(dateStr: string, days: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const context = (todayStr: string): PartnerDayContext => ({
  userId: ME, coupleId: COUPLE, viewer: VIEWER, todayStr,
});

/** Read receipt -> project -> persist. One app open. Never writes CONFIRMED. */
function open(records: DailyRecord[], todayStr: string) {
  const stored = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE });
  const projection = projectPartnerDay(context(todayStr), records, stored);
  if (projection.changed) {
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, projection.checkpoint);
  }
  return projection;
}

/** Press the confirm button. The only CONFIRMED writer. */
function confirm(base: PartnerDayCheckpoint, records: DailyRecord[]): boolean {
  const next = acknowledgePartnerDayRecords(base, records);
  if (!next) return false;
  return writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, next);
}

type Actor = 'diligent' | 'partial' | 'observer';

interface RunResult {
  created: number;
  everSurfaced: Set<string>;
  confirmedIds: Set<string>;
  reachable: Set<string>;
  present: Set<string>;
  /** Surfaced, still present, not confirmed, and NOT reachable. Must be empty. */
  stranded: string[];
  /** Opens where the surface grew with no new record having arrived. Must be 0. */
  grewWithoutArrival: number;
  maxSurface: number;
  maxKnownIds: number;
  coverage: Record<string, number>;
}

/**
 * One seeded relationship over `days`, with the given actor's habits.
 *
 * The generator produces the shapes that actually broke earlier versions: an
 * offline backlog stamped with its compose date, a partner whose device is ahead
 * of the viewer's, records that cannot be decrypted on arrival and unlock later,
 * deletions and restores, days nobody opens the app, and pre-existing history from
 * before the window opens.
 */
function run(seed: number, actor: Actor, days: number): RunResult {
  const rng = makeRng(seed);
  const all: DailyRecord[] = [];
  const deleted = new Set<string>();
  const everSurfaced = new Set<string>();
  /** Records that left this device's slice at some point. */
  const everDeleted = new Set<string>();
  let created = 0;
  let grewWithoutArrival = 0;
  let maxSurface = 0;
  let maxKnownIds = 0;

  /*
   * Counters proving the run reached the states it claims to cover. A category
   * that never fires means this seed proved nothing about it, and a zero fails --
   * that is the only thing that has reliably caught a drifting generator.
   */
  const coverage = {
    forwardDated: 0,
    lateBackdated: 0,
    unreadableOnArrival: 0,
    unlockedLater: 0,
    deleted: 0,
    restored: 0,
    noOpenDay: 0,
    partialConfirm: 0,
    discoveryRescue: 0,
    over500: 0,
    over2000: 0,
    surfaceOlderThanWeek: 0,
  };

  // Pre-existing history: a couple with two years behind them on first open. §6.5
  // caps a receipt-less viewer at seven days, so this is the real shape.
  for (let i = 0; i < 220; i += 1) {
    all.push({
      id: `pre-${i}`,
      userId: PARTNER,
      date: plusDays(START, -(400 - i)),
      time: '09:00',
      authorRole: 'gomsin',
      log: '지난 기록',
      isPrivate: false,
      createdAt: `${plusDays(START, -(400 - i))}T09:00:00.000Z`,
    });
  }

  const presentRecords = () => all.filter((r) => !deleted.has(r.id));

  for (let d = 0; d < days; d += 1) {
    const today = plusDays(START, d);

    // Ordinary records, occasionally a burst.
    const count = rng() < 0.08 ? 5 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 4);
    for (let k = 0; k < count; k += 1) {
      created += 1;
      const unreadable = rng() < 0.04;
      if (unreadable) coverage.unreadableOnArrival += 1;
      all.push({
        id: `r-${created}`,
        userId: PARTNER,
        date: today,
        time: `${String(8 + (k % 14)).padStart(2, '0')}:00`,
        authorRole: 'gomsin',
        log: unreadable ? '' : `순간 ${created}`,
        isPrivate: rng() < 0.05,
        contentUnavailable: unreadable || undefined,
        createdAt: `${today}T09:00:00.000Z`,
      });
    }

    // An offline backlog flushing late, stamped with its compose date.
    if (rng() < 0.05 && d > 10) {
      created += 1;
      all.push({
        id: `late-${created}`,
        userId: PARTNER,
        date: plusDays(today, -(1 + Math.floor(rng() * 60))),
        time: '07:00',
        authorRole: 'gomsin',
        log: '늦게 도착',
        isPrivate: false,
        createdAt: `${today}T09:00:00.000Z`,
      });
      coverage.lateBackdated += 1;
    }

    // A partner whose device is ahead of the viewer's: in local state today, not
    // eligible until later.
    if (rng() < 0.04) {
      created += 1;
      all.push({
        id: `fwd-${created}`,
        userId: PARTNER,
        date: plusDays(today, 1 + Math.floor(rng() * 3)),
        time: '23:30',
        authorRole: 'gomsin',
        log: '앞선 기록',
        isPrivate: false,
        createdAt: `${today}T09:00:00.000Z`,
      });
      coverage.forwardDated += 1;
    }

    // Deletions and restores.
    if (rng() < 0.03 && all.length > 10) {
      const victim = all[Math.floor(rng() * all.length)];
      if (!deleted.has(victim.id)) {
        deleted.add(victim.id);
        everDeleted.add(victim.id);
        coverage.deleted += 1;
      }
    }
    if (rng() < 0.02 && deleted.size > 0) {
      const back = Array.from(deleted)[0];
      deleted.delete(back);
      coverage.restored += 1;
    }

    // A key arrives and unlocks something.
    if (rng() < 0.06) {
      const locked = all.find((r) => r.contentUnavailable);
      if (locked) {
        locked.contentUnavailable = undefined;
        locked.log = '이제 읽혀요';
        coverage.unlockedLater += 1;
      }
    }

    if (all.length > 500) coverage.over500 += 1;
    if (all.length > 2000) coverage.over2000 += 1;

    // Some days nobody opens the app.
    if (rng() < 0.25) { coverage.noOpenDay += 1; continue; }

    const records = presentRecords();
    const first = open(records, today);
    for (const r of first.surface) everSurfaced.add(r.id);
    maxSurface = Math.max(maxSurface, first.surface.length);
    maxKnownIds = Math.max(maxKnownIds, first.checkpoint.knownRecordIds.length);
    if (first.surface.some((r) => r.date < plusDays(today, -7))) {
      coverage.surfaceOlderThanWeek += 1;
    }
    // A record that had to be rescued by discovery: eligible, present, and older
    // than any first-contact window could have reached.
    if (first.transition === 'discovery'
      && first.surface.some((r) => r.date < plusDays(today, -7))) {
      coverage.discoveryRescue += 1;
    }

    /*
     * THE OBSERVER NEVER PRESSES THE BUTTON. Not once, for the whole run.
     */
    if (actor === 'observer') continue;

    const presses = actor === 'diligent' ? 4 : 1;
    let previous = first.surface.length;
    let base = first.checkpoint;
    for (let press = 0; press < presses; press += 1) {
      const projection = open(records, today);
      base = projection.checkpoint;
      for (const r of projection.surface) everSurfaced.add(r.id);
      // The widget confirms the READABLE prefix that was actually on screen.
      const readable = projection.surface.filter((r) => !r.contentUnavailable);
      if (readable.length === 0) break;
      const page = readable.slice(0, 5);
      if (page.length < projection.surface.length) coverage.partialConfirm += 1;
      confirm(base, page);

      const after = open(records, today);
      // Nothing arrived between these two measurements, so the surface must not
      // have grown. This is the assertion an over-eager rediscovery fails.
      if (after.surface.length > previous) grewWithoutArrival += 1;
      previous = after.surface.length;
    }
  }

  const finalDay = plusDays(START, days - 1);
  const stored = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
  const present = new Set(presentRecords().map((r) => r.id));
  const confirmedIds = new Set(stored.confirmedRecordIds);
  const reachable = new Set(
    projectPartnerDay(context(finalDay), presentRecords(), stored).surface.map((r) => r.id),
  );

  /*
   * A record is STRANDED if it was genuinely surfaced, is still on this device,
   * was never confirmed, and is no longer reachable. That is exactly what silent
   * loss looks like, and it is the one thing this file exists to detect.
   *
   * Records that left the device are excluded: absent is not stranded.
   */
  const stranded = [...everSurfaced].filter((id) =>
    present.has(id) && !confirmedIds.has(id) && !reachable.has(id) && !everDeleted.has(id));

  return {
    created,
    everSurfaced,
    confirmedIds,
    reachable,
    present,
    stranded,
    grewWithoutArrival,
    maxSurface,
    maxKnownIds,
    coverage,
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const SEEDS = [20260819, 7, 991];

describe('1000-day seeded simulation', () => {
  for (const seed of SEEDS) {
    it(`strands nothing for a diligent viewer (seed ${seed})`, () => {
      const result = run(seed, 'diligent', 1000);
      expect(result.created).toBeGreaterThan(2000);
      expect(result.stranded).toEqual([]);
      expect(result.grewWithoutArrival).toBe(0);
      expect(result.confirmedIds.size).toBeGreaterThan(500);

      for (const [category, count] of Object.entries(result.coverage)) {
        expect(count, `seed ${seed} never produced: ${category}`).toBeGreaterThan(0);
      }

      console.log(
        `[sim diligent seed=${seed}] created=${result.created} `
        + `surfaced=${result.everSurfaced.size} confirmed=${result.confirmedIds.size} `
        + `reachable=${result.reachable.size} stranded=${result.stranded.length} `
        + `maxSurface=${result.maxSurface} maxKnown=${result.maxKnownIds}`,
      );
      console.log(`[sim diligent coverage] ${JSON.stringify(result.coverage)}`);
    }, 15000);

    it(`strands nothing for a partial-acknowledgement viewer (seed ${seed})`, () => {
      const result = run(seed, 'partial', 1000);
      expect(result.stranded).toEqual([]);
      expect(result.grewWithoutArrival).toBe(0);
      /*
       * A standing backlog must remain, or this run is not testing partial
       * acknowledgement at all.
       *
       * The threshold is deliberately modest, because the first version of this
       * assertion (`> 100`) was arithmetically false and failed on all three
       * seeds. One press confirms a page of 5 and the app is opened ~75% of days,
       * so this actor retires ~3.75 records a day against ~2.95 arrivals: it keeps
       * up on volume. What it cannot retire is the records it can never put in a
       * readable prefix -- undecryptable rows, and anything below the page it
       * pressed on a burst day -- and those are what the measured 44-64 consists
       * of. The unbounded-backlog case is the observer below.
       */
      expect(result.reachable.size).toBeGreaterThan(10);
      expect(result.coverage.partialConfirm).toBeGreaterThan(0);
      // Both directions are exercised: a real backlog AND real progress.
      expect(result.confirmedIds.size).toBeGreaterThan(500);

      console.log(
        `[sim partial seed=${seed}] created=${result.created} `
        + `confirmed=${result.confirmedIds.size} reachable=${result.reachable.size} `
        + `stranded=${result.stranded.length} maxSurface=${result.maxSurface}`,
      );
    });
  }
});

/**
 * THE ACTOR THE PREVIOUS IMPLEMENTATION LOST DATA FOR.
 *
 * Opens the app every day for a thousand days and never confirms anything. The
 * invariant needs no accounting and no exceptions: nothing was confirmed, so
 * everything ever surfaced and still present is still surfaced.
 */
describe('a viewer who opens the app and never acknowledges', () => {
  for (const seed of SEEDS) {
    it(`loses nothing over 1000 days (seed ${seed})`, () => {
      const result = run(seed, 'observer', 1000);

      // Nothing was ever confirmed, because the button was never pressed.
      expect(result.confirmedIds.size).toBe(0);
      expect(result.stranded).toEqual([]);

      // Every surfaced record still on the device is still on the surface.
      const survivors = [...result.everSurfaced].filter((id) => result.present.has(id));
      const missing = survivors.filter((id) => !result.reachable.has(id));
      expect(missing).toEqual([]);
      expect(survivors.length).toBeGreaterThan(1000);

      // The outstanding backlog grows monotonically with what was surfaced -- the
      // counter that would have caught the rolling-window loss immediately.
      expect(result.reachable.size).toBe(survivors.length);

      console.log(
        `[sim observer seed=${seed}] created=${result.created} `
        + `surfaced=${result.everSurfaced.size} survivingOutstanding=${result.reachable.size} `
        + `confirmed=${result.confirmedIds.size} maxSurface=${result.maxSurface}`,
      );
    });
  }

  it('the surviving-outstanding counter only ever grows, day by day', () => {
    // Measured per day rather than at the end, so a mid-run dip cannot be masked
    // by later arrivals. Under the previous rolling window this decreased on day 8.
    const rng = makeRng(4242);
    const all: DailyRecord[] = [];
    let created = 0;
    let previous = 0;
    let daysMeasured = 0;

    for (let d = 0; d < 500; d += 1) {
      const today = plusDays(START, d);
      if (rng() < 0.5) {
        created += 1;
        all.push({
          id: `r-${created}`,
          userId: PARTNER,
          date: today,
          time: '09:00',
          authorRole: 'gomsin',
          log: `순간 ${created}`,
          isPrivate: false,
          createdAt: `${today}T09:00:00.000Z`,
        });
      }
      const { surface, checkpoint } = open(all, today);
      // Never confirms. The surface may only grow.
      expect(surface.length, `day ${d} shrank`).toBeGreaterThanOrEqual(previous);
      previous = surface.length;
      expect(checkpoint.confirmedRecordIds).toEqual([]);
      daysMeasured += 1;
    }

    expect(daysMeasured).toBe(500);
    expect(previous).toBeGreaterThan(100);
  });
});

describe('the eligibility domain bounds every set in the receipt', () => {
  it('KNOWN and OUTSTANDING never range wider than eligible, across a run', () => {
    // OBSERVED ranging wider than the surface is what entombed future-dated
    // records in the previous implementation. Asserted over a whole run rather
    // than at one instant.
    const rng = makeRng(31337);
    const all: DailyRecord[] = [];
    let created = 0;

    for (let d = 0; d < 200; d += 1) {
      const today = plusDays(START, d);
      created += 1;
      all.push({
        id: `r-${created}`,
        userId: PARTNER,
        date: rng() < 0.2 ? plusDays(today, 2) : today,
        time: '09:00',
        authorRole: 'gomsin',
        log: '기록',
        isPrivate: rng() < 0.1,
        createdAt: `${today}T09:00:00.000Z`,
      });

      const { checkpoint, surface } = open(all, today);
      const eligibleIds = new Set(
        eligibleSharedPartnerRecords(all, VIEWER, today).map((r) => r.id),
      );
      // Every id the receipt holds was eligible on the day it was recorded, so no
      // id can be entombed by having been recorded before it was showable.
      for (const id of checkpoint.knownRecordIds) {
        expect(eligibleIds.has(id) || all.some((r) => r.id === id && r.date <= today)).toBe(true);
      }
      for (const r of surface) expect(eligibleIds.has(r.id)).toBe(true);
    }
  });

  it('a future-dated record surfaces on the day it becomes eligible, unconfirmed', () => {
    const today = plusDays(START, 10);
    const arriving = plusDays(today, 3);
    const all: DailyRecord[] = [{
      id: 'ahead',
      userId: PARTNER,
      date: arriving,
      time: '23:30',
      authorRole: 'gomsin',
      log: '앞선 기록',
      isPrivate: false,
      createdAt: `${today}T09:00:00.000Z`,
    }];

    // Opened every day while it is not yet eligible. It must not be entombed.
    for (let d = 0; d < 3; d += 1) {
      expect(open(all, plusDays(today, d)).surface).toEqual([]);
    }
    expect(open(all, arriving).surface.map((r) => r.id)).toEqual(['ahead']);
  });
});
