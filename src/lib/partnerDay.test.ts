import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DailyRecord } from '@/types';
import type { Viewer } from '@/lib/privacy';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';
import {
  PARTNER_DAY_CHECKPOINT_VERSION,
  PARTNER_DAY_DISCOVERY_DAYS,
  acknowledgePartnerDayRecords,
  eligibleSharedPartnerRecords,
  partnerDayCheckpointKey,
  partnerDayDateLabel,
  partnerDayDiscoveryWindow,
  projectPartnerDay,
  readPartnerDayCheckpoint,
  readPartnerDayCheckpointStatus,
  spansBeforeToday,
  writePartnerDayCheckpoint,
  type PartnerDayCheckpoint,
  type PartnerDayContext,
} from '@/lib/partnerDay';

/**
 * ONE PROMISE IS UNDER TEST:
 *
 *   "사용자가 확인 버튼을 누르지 않은 기록은 시간이 지나도 사라지면 안 된다."
 *
 * The two failure directions are not symmetric. Showing a record twice costs a
 * second glance; hiding one the user never confirmed defeats the reason the
 * product exists (PRODUCT_V3 §1.11, "놓친 하루의 맥락을 복구"). Every ambiguous case
 * below therefore resolves towards showing more.
 *
 * Time is modelled by passing a different `todayStr`, never by a clock. Nothing in
 * the module reads one, and these tests must not either.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const COUPLE = 'couple-1';
const TODAY = '2026-08-19';
const VIEWER: Viewer = { userId: ME, role: 'soldier' };

/** Days BACK from TODAY, as a local date string. */
function day(n: number): string {
  const d = parseLocalDate(TODAY);
  d.setDate(d.getDate() - n);
  return toLocalDateString(d);
}

/** Days FORWARD from a date. Used to move the simulated calendar. */
function plusDays(dateStr: string, days: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

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

/** A record dated `n` days before TODAY. */
function at(id: string, n: number, over: Partial<DailyRecord> = {}): DailyRecord {
  return record({ id, date: day(n), createdAt: `${day(n)}T09:00:00.000Z`, ...over });
}

function context(todayStr = TODAY, over: Partial<PartnerDayContext> = {}): PartnerDayContext {
  return { userId: ME, coupleId: COUPLE, viewer: VIEWER, todayStr, ...over };
}

function checkpoint(over: Partial<PartnerDayCheckpoint> = {}): PartnerDayCheckpoint {
  return {
    version: PARTNER_DAY_CHECKPOINT_VERSION,
    confirmedRecordIds: [],
    outstandingRecordIds: [],
    knownRecordIds: [],
    ...over,
  };
}

const ids = (records: DailyRecord[]) => records.map((r) => r.id);

/**
 * A device that actually persists, so a test cannot accidentally pass by holding
 * state React would have dropped.
 *
 * `open` is one app open: project, persist, return the surface. It reads the
 * receipt from storage every time, which is what a cold start does.
 */
function device(userId = ME, coupleId = COUPLE) {
  const key = { userId, coupleId };
  return {
    /**
     * Open the app on `todayStr`. Never writes CONFIRMED.
     *
     * Reads via `readPartnerDayCheckpointStatus` rather than
     * `readPartnerDayCheckpoint`, and threads `status` into `projectPartnerDay`,
     * so a test that corrupts storage or makes it unreadable between opens
     * exercises exactly what `usePartnerDay` does in production -- not a version
     * of this device that happens not to notice. Nothing extra is needed to keep
     * `unavailable` from persisting: `projectPartnerDay` already forces
     * `changed: false` for it, so the `if (projection.changed)` guard below
     * already declines to write, matching the real hook.
     */
    open(records: DailyRecord[], todayStr: string) {
      const { checkpoint: stored, status } = readPartnerDayCheckpointStatus(key);
      const projection = projectPartnerDay(context(todayStr, key), records, stored, status);
      if (projection.changed) writePartnerDayCheckpoint(key, projection.checkpoint);
      return projection;
    },
    /**
     * Press the confirm button on `records`. The only CONFIRMED writer.
     *
     * Blocked while the receipt is `unavailable`, matching `usePartnerDay`'s
     * `acknowledge`: storage cannot currently attest to what is really
     * CONFIRMED, so a write here risks the same silent overwrite the persist
     * path guards against.
     */
    confirm(records: DailyRecord[]) {
      const { checkpoint: stored, status } = readPartnerDayCheckpointStatus(key);
      if (status === 'unavailable') return false;
      const next = acknowledgePartnerDayRecords(stored ?? checkpoint(), records);
      if (!next) return false;
      return writePartnerDayCheckpoint(key, next);
    },
    stored: () => readPartnerDayCheckpoint(key),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

/* ------------------------------------------------------------------------- */
/* THE REGRESSION                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Measured on the pre-replacement tree, this is the defect:
 *
 *   missedPartnerRecords([rec dated day 0], VIEWER, day 8, null) === []
 *
 * The surface for a viewer with no receipt was a rolling seven-day window, so the
 * window was doing the remembering and a window forgets. The record was on screen
 * on day 0, nobody confirmed it, and on day 8 it was gone.
 */
describe('REGRESSION: an unconfirmed record never expires', () => {
  const DAY_0 = TODAY;
  const unconfirmed = record({ id: 'unconfirmed', date: DAY_0, log: '확인 안 한 기록' });

  it('day 0 surface -> no acknowledge -> day 8 -> still reachable', () => {
    const phone = device();

    expect(ids(phone.open([unconfirmed], DAY_0).surface)).toEqual(['unconfirmed']);

    // Eight days pass. The app is opened each day and the button is never pressed.
    for (let d = 1; d <= 8; d += 1) {
      const { surface } = phone.open([unconfirmed], plusDays(DAY_0, d));
      expect(ids(surface), `day ${d}`).toEqual(['unconfirmed']);
    }

    // And nothing was ever confirmed, because nothing was ever pressed.
    expect(phone.stored()?.confirmedRecordIds).toEqual([]);
  });

  it('survives day 8 even if the app is never opened in between', () => {
    // The harder version: no intermediate open to "refresh" anything. The single
    // OUTSTANDING write on day 0 has to be enough.
    const phone = device();
    expect(ids(phone.open([unconfirmed], DAY_0).surface)).toEqual(['unconfirmed']);
    expect(ids(phone.open([unconfirmed], plusDays(DAY_0, 8)).surface)).toEqual(['unconfirmed']);
  });

  for (const days of [30, 400]) {
    it(`survives ${days} days with no acknowledgement`, () => {
      const phone = device();
      phone.open([unconfirmed], DAY_0);
      const { surface } = phone.open([unconfirmed], plusDays(DAY_0, days));
      expect(ids(surface)).toEqual(['unconfirmed']);
      expect(phone.stored()?.confirmedRecordIds).toEqual([]);
    });
  }

  it('only the confirm button retires it, and then it stays retired', () => {
    const phone = device();
    phone.open([unconfirmed], DAY_0);

    expect(phone.confirm([unconfirmed])).toBe(true);
    expect(phone.open([unconfirmed], DAY_0).surface).toEqual([]);
    // Still gone 400 days later, and not re-discovered as a new arrival.
    expect(phone.open([unconfirmed], plusDays(DAY_0, 400)).surface).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* BLOCKER FIX: first-contact classification must use receipt provenance,   */
/* not knownRecordIds.size                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Cold-review blocker.
 *
 * `projectPartnerDay` decided `first-contact` vs `discovery` from
 * `known.size === 0`. That conflates two situations that must NOT be
 * conflated:
 *
 *   1. There genuinely is no usable receipt (or a legacy one with no KNOWN
 *      provenance at all) -- first-contact is correct here.
 *   2. A real v2 receipt exists, and its KNOWN set is legitimately empty
 *      because there were zero eligible records the day it was written --
 *      this is NOT first contact. It is an established relationship that
 *      happened to open on a quiet day.
 *
 * Collapsing (2) into (1) re-runs the bounded discovery-window seed on a
 * device that already has history. Any record older than that window that
 * arrives before the next open is marked KNOWN without ever becoming
 * OUTSTANDING -- known-not-outstanding is the terminal "already dealt with"
 * state, so the record is gone permanently, without anyone confirming
 * anything.
 */
describe('BLOCKER FIX: first-contact is decided by receipt provenance', () => {
  const DAY_0 = TODAY;

  it('day 0 empty receipt -> records arrive unseen -> day 10 open -> all reachable', () => {
    const phone = device();

    // 1) day 0: the viewer opens on a day with nothing to see.
    const opening = phone.open([], DAY_0);
    expect(opening.surface).toEqual([]);
    expect(opening.transition).toBe('first-contact');

    // An empty v2 receipt IS persisted -- this device now has a real receipt,
    // not "no receipt at all".
    const stored = phone.stored();
    expect(stored).not.toBeNull();
    expect(stored?.version).toBe(PARTNER_DAY_CHECKPOINT_VERSION);
    expect(stored?.knownRecordIds).toEqual([]);
    expect(stored?.outstandingRecordIds).toEqual([]);
    expect(stored?.confirmedRecordIds).toEqual([]);

    // 2) days 1-3: the partner writes r1, r2, r3, all older than the 7-day
    // discovery window as measured from day 10.
    const r1 = at('r1', -1, { time: '09:00' }); // day 1
    const r2 = at('r2', -2, { time: '09:00' }); // day 2
    const r3 = at('r3', -3, { time: '09:00' }); // day 3

    // 3) the viewer does not open the app on any of those days -- no `open`
    // call happens for day 1, 2 or 3.

    // 4) day 10: first open since day 0. day10 - 7 + 1 = day 4, so r1/r2/r3
    // (dated day 1-3) are all OUTSIDE a freshly re-seeded discovery window --
    // exactly the shape that used to entomb them as KNOWN-not-OUTSTANDING.
    const day10 = plusDays(DAY_0, 10);
    const { surface, transition } = phone.open([r1, r2, r3], day10);

    expect(transition).toBe('discovery');
    expect(ids(surface).sort()).toEqual(['r1', 'r2', 'r3']);

    // 5) day 11, still no acknowledgement: all three remain reachable.
    const day11 = plusDays(DAY_0, 11);
    expect(ids(phone.open([r1, r2, r3], day11).surface).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('a real v2 receipt with an empty KNOWN set is discovery, not first-contact', () => {
    // The same fact as above, at the unit level: a v2 receipt does not need
    // knownRecordIds to be non-empty to prove it is a real receipt. Its
    // version alone proves it.
    const cp: PartnerDayCheckpoint = {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: [],
      outstandingRecordIds: [],
      knownRecordIds: [],
    };
    const late = at('late', 90);
    const { transition, surface } = projectPartnerDay(context(), [late], cp);
    expect(transition).toBe('discovery');
    expect(ids(surface)).toEqual(['late']);
  });

  it('true no-receipt (stored is null) is still first-contact', () => {
    const all = [at('a', 0), at('b', 3)];
    const { transition, surface } = projectPartnerDay(context(), all, null);
    expect(transition).toBe('first-contact');
    expect(ids(surface).sort()).toEqual(['a', 'b']);
  });

  it('a genuinely legacy v1 receipt with no KNOWN provenance keeps the existing first-contact policy', () => {
    // version 1, no knownRecordIds at all -- the shape a receipt has when it
    // predates KNOWN existing. `readPartnerDayCheckpoint` maps this to
    // knownRecordIds: [] with version staying 1.
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), JSON.stringify({
      confirmedRecordIds: ['gone'],
      outstandingRecordIds: [],
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    }));
    const legacy = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
    expect(legacy.version).toBe(1);
    expect(legacy.knownRecordIds).toEqual([]);

    const all = [at('ancient', 400), at('recent', 2)];
    const { transition, checkpoint: next } = projectPartnerDay(context(), all, legacy);

    // Unchanged from before this fix: a legacy receipt with no KNOWN
    // provenance cannot attest to what this device already knew, so it takes
    // the bounded first-contact seed rather than an unbounded flood.
    expect(transition).toBe('first-contact');
    expect(next.confirmedRecordIds).toContain('gone');
  });

  it('a legacy v1 receipt WITH KNOWN provenance (mapped from observedRecordIds) is discovery', () => {
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), JSON.stringify({
      confirmedRecordIds: ['seen'],
      outstandingRecordIds: ['left'],
      observedRecordIds: ['seen', 'left'],
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    }));
    const legacy = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
    expect(legacy.version).toBe(1);

    const late = at('late', 300);
    const { transition } = projectPartnerDay(context(), [late], legacy);
    expect(transition).toBe('discovery');
  });
});

/* ------------------------------------------------------------------------- */
/* BLOCKER FIX 2: a corrupt receipt must run unbounded recovery, not the     */
/* bounded first-contact seed                                                */
/* ------------------------------------------------------------------------- */

/**
 * Cold-review blocker (I1 NO SILENT LOSS), independent of the classifier above.
 *
 * `readPartnerDayCheckpoint` collapsed "nothing stored" and "a receipt string
 * exists but fails to parse or validate" into the same `null`. Both then took
 * the bounded seven-day first-contact seed. That is correct for genuine first
 * contact -- it is the point of that window -- and wrong for corrupt bytes: a
 * healthy receipt that had a 30-day-old record OUTSTANDING, corrupted on disk
 * and reopened, classified that record as KNOWN only. Gone permanently, with
 * nobody having confirmed anything.
 *
 * Control Tower policy (2026-08-20): missing and corrupt are not the same
 * failure.
 *
 *   MISSING  (readPartnerDayCheckpointStatus: `{ checkpoint: null,
 *             status: 'missing' }`) -- unchanged: bounded 7-day first-contact.
 *   VALID    -- unchanged: discovery, per the suite above.
 *   CORRUPT  (`{ checkpoint: null, status: 'corrupt' }`) -- `recovery`: every
 *             CURRENTLY ELIGIBLE record becomes OUTSTANDING, unbounded by
 *             date. CONFIRMED is not recovered -- it lived only in the bytes
 *             that just failed to parse -- so an already-confirmed record MAY
 *             resurface once. Duplicate resurfacing over silent, permanent
 *             loss is the accepted tradeoff, not an oversight.
 *
 * A read that fails OUTRIGHT (`localStorage.getItem` throwing) is a fourth,
 * separate state -- `unavailable` -- and is NOT tested here. Folding it into
 * either `missing` or `corrupt` was itself the next blocker found; see
 * "BLOCKER FIX 3" below.
 */
describe('BLOCKER FIX 2: a corrupt receipt runs unbounded recovery, not first-contact', () => {
  it('[A] a healthy 30-day-old OUTSTANDING record survives the receipt corrupting and reopening', () => {
    const phone = device();
    // Day 0: nothing to see yet -- a real v2 receipt is written, so this device
    // has genuine discovery provenance from here on, not first-contact.
    expect(phone.open([], TODAY).transition).toBe('first-contact');

    // A record dated 30 days before TODAY arrives afterward. `discovery` is
    // unbounded by date (only `first-contact`'s seed is bounded), so it
    // legitimately becomes OUTSTANDING -- this is the exact healthy-receipt
    // shape the corruption below must not be able to erase.
    const old = at('old-outstanding', 30);
    const discovered = phone.open([old], TODAY);
    expect(discovered.transition).toBe('discovery');
    expect(ids(discovered.surface)).toEqual(['old-outstanding']);

    // The bytes on disk are now corrupted -- not merely absent.
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');

    expect(ids(phone.open([old], TODAY).surface)).toEqual(['old-outstanding']);
  });

  it('[B] recovery is not bounded to the 7-day discovery window', () => {
    // Without the fix this fails: a corrupt receipt fell into the bounded
    // first-contact seed, and a record 30 days old is outside it.
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), 'not even json {{{');
    const veryOld = at('very-old', 30);
    expect(ids(device().open([veryOld], TODAY).surface)).toEqual(['very-old']);
  });

  it('[C] recovery never admits a private, own, or future record', () => {
    const secret = at('secret', 10, { isPrivate: true });
    const mine = at('mine', 10, { userId: ME, authorRole: 'soldier' });
    const future = record({ id: 'future', date: plusDays(TODAY, 3) });
    const shared = at('shared', 10, { time: '10:00' });

    const { surface, checkpoint: cp, transition } =
      projectPartnerDay(context(), [secret, mine, future, shared], null, 'corrupt');

    expect(transition).toBe('recovery');
    expect(ids(surface)).toEqual(['shared']);
    expect(cp.knownRecordIds).toEqual(['shared']);
    expect(cp.outstandingRecordIds).toEqual(['shared']);
  });

  it('[D] a truly absent receipt keeps the existing bounded first-contact policy', () => {
    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status).toEqual({ checkpoint: null, status: 'missing' });

    const old = at('old', 30);
    const recent = at('recent', 2);
    const { surface, transition } = projectPartnerDay(context(), [old, recent], null, 'missing');
    expect(transition).toBe('first-contact');
    // Bounded: the 30-day-old record is outside the window and does not show --
    // this is the pre-existing, intentional first-contact policy, unaffected.
    expect(ids(surface)).toEqual(['recent']);
  });

  it('[E] a valid v2 receipt is reported as valid, and keeps discovery semantics', () => {
    const cp: PartnerDayCheckpoint = {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: ['old-confirmed'],
      outstandingRecordIds: [],
      knownRecordIds: ['old-confirmed'],
    };
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, cp);

    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status.status).toBe('valid');
    expect(status.checkpoint).not.toBeNull();

    const late = at('late', 90);
    const { transition, surface } = projectPartnerDay(
      context(), [late], status.checkpoint, status.status,
    );
    expect(transition).toBe('discovery');
    expect(ids(surface)).toEqual(['late']);
  });

  it('[F] once recovery persists, the record stays reachable through a later, corruption-free open', () => {
    const old = at('old-outstanding', 30);
    const phone = device();
    phone.open([old], TODAY);
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');

    const recovered = phone.open([old], TODAY);
    expect(recovered.transition).toBe('recovery');
    expect(ids(recovered.surface)).toEqual(['old-outstanding']);

    // Recovery changed the checkpoint, so it persisted a VALID v2 receipt --
    // corruption does not recur on the next open.
    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status.status).toBe('valid');
    expect(status.checkpoint?.version).toBe(PARTNER_DAY_CHECKPOINT_VERSION);

    // Unconfirmed, it is still reachable much later -- the ordinary I1 guarantee,
    // now resting on a repaired receipt instead of a corrupt one.
    expect(ids(phone.open([old], plusDays(TODAY, 400)).surface)).toEqual(['old-outstanding']);
  });

  it('[G] acknowledging after recovery moves the record to CONFIRMED normally, and it stays retired', () => {
    const old = at('old-outstanding', 30);
    const phone = device();
    phone.open([old], TODAY);
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');

    const recovered = phone.open([old], TODAY);
    expect(ids(recovered.surface)).toEqual(['old-outstanding']);

    expect(phone.confirm(recovered.surface)).toBe(true);
    expect(phone.open([old], TODAY).surface).toEqual([]);
    expect(phone.stored()?.confirmedRecordIds).toEqual(['old-outstanding']);
    // Stays retired, not re-discovered as a late arrival.
    expect(phone.open([old], plusDays(TODAY, 400)).surface).toEqual([]);
  });

  it('recovery cannot resurrect CONFIRMED -- it lived only in the corrupt bytes', () => {
    // A record confirmed before the corruption is legitimately gone from
    // CONFIRMED after recovery: there is nowhere else it could come from. It
    // resurfaces on the surface instead -- duplicate resurfacing, not loss.
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');
    const wasConfirmed = at('was-confirmed', 30);
    const { checkpoint: cp, surface } =
      projectPartnerDay(context(), [wasConfirmed], null, 'corrupt');
    expect(cp.confirmedRecordIds).toEqual([]);
    expect(ids(surface)).toEqual(['was-confirmed']);
  });

  it("status: 'corrupt' discards a well-formed stored checkpoint passed alongside it", () => {
    // Defensive: `projectPartnerDay`'s contract is that a corrupt status wins
    // over whatever `stored` looks like, so a caller cannot accidentally seed
    // real CONFIRMED/OUTSTANDING/KNOWN from bytes already flagged untrustworthy.
    const untrustworthy: PartnerDayCheckpoint = {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: ['should-not-count'],
      outstandingRecordIds: ['should-not-count'],
      knownRecordIds: ['should-not-count'],
    };
    const eligible = at('eligible', 10);
    const { checkpoint: cp, surface, transition } =
      projectPartnerDay(context(), [eligible], untrustworthy, 'corrupt');

    expect(transition).toBe('recovery');
    expect(cp.confirmedRecordIds).toEqual([]);
    expect(ids(surface)).toEqual(['eligible']);
  });
});

/* ------------------------------------------------------------------------- */
/* BLOCKER FIX 3: an UNREADABLE receipt must never be treated as MISSING --  */
/* it may still be on disk, and the write path can still reach it           */
/* ------------------------------------------------------------------------- */

/**
 * Cold-review blocker (I1 NO SILENT LOSS), found in the fix for BLOCKER FIX 2
 * itself: `getItem` throwing was folded into `missing`, on the reasoning that
 * a backend broken enough to fail reads would likely also fail writes, making
 * the persisted first-contact seed harmless because it could never actually
 * reach disk.
 *
 * That reasoning does not hold. A storage backend can fail reads while writes
 * still succeed -- this is not hypothetical, it is exactly what the wrapper in
 * test [A] below constructs, and real asymmetric failures (a corrupted index,
 * a permissions quirk, certain private-mode edge cases) are plausible in the
 * same shape. When that happens:
 *
 *   1. a healthy receipt with a 30-day-old record OUTSTANDING sits on disk,
 *   2. a read attempt throws -- reported (before this fix) as `missing`,
 *   3. `projectPartnerDay` runs the bounded first-contact seed, which does NOT
 *      include the 30-day-old record (outside the 7-day window),
 *   4. `usePartnerDay`'s persist effect sees `changed: true` and calls
 *      `writePartnerDayCheckpoint`, which succeeds,
 *   5. the real receipt is gone, overwritten by one computed as though it had
 *      never existed. Reachable when reads later recover? No -- the bytes on
 *      disk NOW say the record was already accounted for and never surfaced.
 *
 * `readPartnerDayCheckpointStatus` reports `unavailable` for this case
 * (distinct from `missing`). `projectPartnerDay` gives it the SAME unbounded,
 * fail-open surface as `recovery` -- Control Tower policy is that the SCREEN
 * must not silently hide a record just because storage cannot currently be
 * read -- but forces `changed: false`, so nothing computed while `unavailable`
 * may be persisted. `usePartnerDay` additionally refuses both the persist
 * effect and `acknowledge` outright while this status holds, as a second,
 * independent guard at the call site.
 */
describe("BLOCKER FIX 3: an unreadable receipt is 'unavailable', not 'missing', and is never persisted", () => {
  it('[A] a healthy 30-day-old OUTSTANDING receipt is NOT overwritten when reads throw but writes still succeed', () => {
    const old = at('old-outstanding', 30);
    // A real, healthy v2 receipt with this record legitimately OUTSTANDING.
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: [],
      outstandingRecordIds: ['old-outstanding'],
      knownRecordIds: ['old-outstanding'],
    });
    const bytesBefore = localStorage.getItem(partnerDayCheckpointKey(ME, COUPLE));
    expect(bytesBefore).not.toBeNull();

    // getItem throws; setItem passes straight through to the real store. This
    // is the exact asymmetric failure the previous version of this fix assumed
    // could not happen.
    const real = globalThis.localStorage;
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => { throw new Error('SecurityError'); },
      removeItem: () => {},
      setItem: (k, v) => real.setItem(k, v),
    };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try {
      const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
      expect(status).toEqual({ checkpoint: null, status: 'unavailable' });

      const projection = projectPartnerDay(
        { userId: ME, coupleId: COUPLE, viewer: VIEWER, todayStr: TODAY },
        [old], status.checkpoint, status.status,
      );
      expect(projection.transition).toBe('unavailable');
      // Persistence must not fire: `usePartnerDay`'s persist effect gates on
      // `changed`, so this alone is what keeps the write from ever happening.
      expect(projection.changed).toBe(false);
      if (projection.changed) writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, projection.checkpoint);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }

    const bytesAfter = localStorage.getItem(partnerDayCheckpointKey(ME, COUPLE));
    expect(bytesAfter).toBe(bytesBefore);
  });

  it('[B] the fail-open surface still shows the old eligible record while unavailable, rather than silently hiding it', () => {
    const old = at('old-outstanding', 30);
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: [],
      outstandingRecordIds: [],
      knownRecordIds: [],
    });
    const status: { checkpoint: null; status: 'unavailable' } =
      { checkpoint: null, status: 'unavailable' };
    const projection = projectPartnerDay(
      context(), [old], status.checkpoint, status.status,
    );
    // Fail-open: the screen shows it, exactly as `recovery` would -- storage
    // being unreadable is not evidence the record was already dealt with.
    expect(projection.transition).toBe('unavailable');
    expect(ids(projection.surface)).toEqual(['old-outstanding']);
  });

  it('[C] acknowledging while unavailable writes nothing and confirms nothing', () => {
    const phone = device();
    const old = at('old-outstanding', 30);
    phone.open([old], TODAY);

    const real = globalThis.localStorage;
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => { throw new Error('SecurityError'); },
      removeItem: () => {},
      setItem: (k, v) => real.setItem(k, v),
    };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try {
      const opened = phone.open([old], TODAY);
      expect(opened.transition).toBe('unavailable');
      expect(ids(opened.surface)).toEqual(['old-outstanding']);
      // `device().confirm` mirrors `usePartnerDay`'s `acknowledge`: blocked
      // outright while unavailable.
      expect(phone.confirm(opened.surface)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }

    // Storage is untouched: still the healthy receipt from before the outage,
    // and nothing was ever confirmed.
    const stored = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(stored.status).toBe('valid');
    expect(stored.checkpoint?.confirmedRecordIds).toEqual([]);
  });

  it('[D] once storage becomes readable again, the old OUTSTANDING record is still reachable', () => {
    const old = at('old-outstanding', 30);
    const phone = device();
    phone.open([], TODAY);
    const discovered = phone.open([old], TODAY);
    expect(ids(discovered.surface)).toEqual(['old-outstanding']);

    const real = globalThis.localStorage;
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => { throw new Error('SecurityError'); },
      removeItem: () => {},
      setItem: (k, v) => real.setItem(k, v),
    };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try {
      const opened = phone.open([old], TODAY);
      expect(opened.transition).toBe('unavailable');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }

    // Reads recover, and the receipt on disk was never touched during the outage.
    const recovered = phone.open([old], plusDays(TODAY, 5));
    expect(recovered.transition).toBe('discovery');
    expect(ids(recovered.surface)).toEqual(['old-outstanding']);
  });

  it('[E] a truly missing receipt is unaffected: still bounded first-contact', () => {
    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status.status).toBe('missing');
    const old = at('old', 30);
    const recent = at('recent', 2);
    const { transition, surface } =
      projectPartnerDay(context(), [old, recent], status.checkpoint, status.status);
    expect(transition).toBe('first-contact');
    expect(ids(surface)).toEqual(['recent']);
  });

  it('[F] a corrupt receipt is unaffected: still unbounded recovery, and MAY persist', () => {
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');
    const old = at('old', 30);
    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status.status).toBe('corrupt');
    const projection = projectPartnerDay(context(), [old], status.checkpoint, status.status);
    expect(projection.transition).toBe('recovery');
    expect(projection.changed).toBe(true);
    expect(ids(projection.surface)).toEqual(['old']);
  });

  it('[G] a valid receipt is unaffected: still discovery', () => {
    const cp: PartnerDayCheckpoint = {
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: [],
      outstandingRecordIds: [],
      knownRecordIds: [],
    };
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, cp);
    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status.status).toBe('valid');
    const late = at('late', 90);
    const { transition, surface } =
      projectPartnerDay(context(), [late], status.checkpoint, status.status);
    expect(transition).toBe('discovery');
    expect(ids(surface)).toEqual(['late']);
  });

  it('[H] private, own, and future records never enter the unavailable fail-open surface', () => {
    const secret = at('secret', 10, { isPrivate: true });
    const mine = at('mine', 10, { userId: ME, authorRole: 'soldier' });
    const future = record({ id: 'future', date: plusDays(TODAY, 3) });
    const shared = at('shared', 10, { time: '10:00' });

    const { surface, checkpoint: cp, transition } = projectPartnerDay(
      context(), [secret, mine, future, shared], null, 'unavailable',
    );

    expect(transition).toBe('unavailable');
    expect(ids(surface)).toEqual(['shared']);
    expect(cp.knownRecordIds).toEqual(['shared']);
    expect(cp.outstandingRecordIds).toEqual(['shared']);
  });
});

/* ------------------------------------------------------------------------- */
/* W2: FIRST CONTACT                                                         */
/* ------------------------------------------------------------------------- */

describe('first contact', () => {
  it('window covers the last seven days including today', () => {
    expect(partnerDayDiscoveryWindow(TODAY)).toEqual({ since: day(6), until: TODAY });
    expect(PARTNER_DAY_DISCOVERY_DAYS).toBe(7);
  });

  it('seeds OUTSTANDING from the discovery window and KNOWN from all eligible history', () => {
    const all = [at('ancient', 400), at('old', 7), at('edge', 6), at('today', 0)];
    const { checkpoint: cp, surface, transition } = projectPartnerDay(context(), all, null);

    expect(transition).toBe('first-contact');
    expect(ids(surface)).toEqual(['edge', 'today']);
    expect(cp.outstandingRecordIds.sort()).toEqual(['edge', 'today']);
    // Everything eligible is accounted for, so history cannot later masquerade as
    // a late arrival.
    expect(cp.knownRecordIds.sort()).toEqual(['ancient', 'edge', 'old', 'today']);
  });

  it('writes no CONFIRMED, whatever it finds', () => {
    const all = [at('a', 0), at('b', 3), at('c', 400)];
    expect(projectPartnerDay(context(), all, null).checkpoint.confirmedRecordIds).toEqual([]);
  });

  it('a future-dated record is neither outstanding nor known', () => {
    const future = record({ id: 'future', date: plusDays(TODAY, 3) });
    const { checkpoint: cp, surface } = projectPartnerDay(context(), [future], null);
    expect(surface).toEqual([]);
    expect(cp.knownRecordIds).toEqual([]);
    expect(cp.outstandingRecordIds).toEqual([]);
  });

  it('history outside the window is not pushed at someone opening for the first time', () => {
    const all = Array.from({ length: 300 }, (_, i) => at(`h-${i}`, i + 7));
    const { surface, checkpoint: cp } = projectPartnerDay(context(), all, null);
    expect(surface).toEqual([]);
    expect(cp.knownRecordIds).toHaveLength(300);
  });
});

/* ------------------------------------------------------------------------- */
/* W3: DISCOVERY                                                             */
/* ------------------------------------------------------------------------- */

describe('discovery is additive, idempotent, and unbounded by date', () => {
  const seedKnown = (knownIds: string[], over: Partial<PartnerDayCheckpoint> = {}) =>
    checkpoint({ knownRecordIds: knownIds, ...over });

  it('a record in none of the three sets becomes OUTSTANDING however old it is', () => {
    const known = at('known', 1);
    const late = at('late', 400);
    const cp = seedKnown(['known'], { confirmedRecordIds: ['known'] });

    const { surface, transition } = projectPartnerDay(context(), [known, late], cp);
    expect(transition).toBe('discovery');
    expect(ids(surface)).toEqual(['late']);
  });

  it('is idempotent: projecting a projection changes nothing', () => {
    const all = [at('a', 0), at('b', 2), at('c', 400)];
    const first = projectPartnerDay(context(), all, null);
    const second = projectPartnerDay(context(), all, first.checkpoint);

    expect(second.changed).toBe(false);
    expect(ids(second.surface)).toEqual(ids(first.surface));
    expect(second.checkpoint).toEqual(first.checkpoint);

    // And a third time, so a caller persisting on `changed` cannot loop.
    expect(projectPartnerDay(context(), all, second.checkpoint).changed).toBe(false);
  });

  it('never removes anything from OUTSTANDING', () => {
    const a = at('a', 2);
    const cp = seedKnown(['a', 'other'], { outstandingRecordIds: ['a', 'absent'] });
    const next = projectPartnerDay(context(), [a], cp).checkpoint;
    // `absent` is not in this device's slice right now, and is kept anyway.
    expect(next.outstandingRecordIds.sort()).toEqual(['a', 'absent']);
  });

  it('never removes anything from CONFIRMED', () => {
    const cp = seedKnown(['x'], { confirmedRecordIds: ['x', 'long-gone'] });
    const next = projectPartnerDay(context(), [], cp).checkpoint;
    expect(next.confirmedRecordIds.sort()).toEqual(['long-gone', 'x']);
  });

  it('does not re-surface a confirmed record', () => {
    const a = at('a', 2);
    const cp = seedKnown(['a'], { confirmedRecordIds: ['a'] });
    expect(projectPartnerDay(context(), [a], cp).surface).toEqual([]);
  });

  it('does not re-surface a known record that was never outstanding', () => {
    // Pre-window history recorded at first contact. It was accounted for, so it is
    // not a new arrival -- and it was never put in front of anyone, so it is not
    // outstanding either.
    const old = at('old', 400);
    const cp = seedKnown(['old']);
    expect(projectPartnerDay(context(), [old], cp).surface).toEqual([]);
  });

  it('a legacy receipt with no KNOWN set takes the bounded path, not the flood', () => {
    // An empty KNOWN cannot tell new from accounted-for. Treating it as "knows of
    // nothing" would push two years of history onto the screen at once.
    //
    // `version: 1` here is load-bearing, not decoration: it is what makes this
    // fixture an actual legacy receipt rather than a v2 receipt with an
    // incidentally empty KNOWN set. Those two are NOT the same input anymore --
    // the blocker fix in `projectPartnerDay` distinguishes them by provenance,
    // and a v2 receipt with empty KNOWN is `discovery` (see "BLOCKER FIX" suite
    // above). Without pinning the version, this test was silently exercising
    // that other case under a misleading title.
    const all = [at('ancient', 400), at('recent', 2)];
    const cp = checkpoint({ version: 1, confirmedRecordIds: ['gone'], knownRecordIds: [] });
    const { surface, transition, checkpoint: next } = projectPartnerDay(context(), all, cp);

    expect(transition).toBe('first-contact');
    expect(ids(surface)).toEqual(['recent']);
    // The old CONFIRMED is preserved rather than dropped.
    expect(next.confirmedRecordIds).toContain('gone');
  });
});

/* ------------------------------------------------------------------------- */
/* W4: THE SURFACE                                                           */
/* ------------------------------------------------------------------------- */

describe('the surface is OUTSTANDING ∩ eligible(today)', () => {
  it('shows an outstanding record whatever its age', () => {
    const ancient = at('ancient', 900);
    const cp = checkpoint({ outstandingRecordIds: ['ancient'], knownRecordIds: ['ancient'] });
    expect(ids(projectPartnerDay(context(), [ancient], cp).surface)).toEqual(['ancient']);
  });

  it('withholds a future-dated outstanding record, then shows it when its date arrives', () => {
    // The only way a date removes anything from the surface, and it is temporary.
    const future = record({ id: 'future', date: plusDays(TODAY, 2) });
    const cp = checkpoint({ outstandingRecordIds: ['future'], knownRecordIds: ['future'] });

    expect(projectPartnerDay(context(TODAY), [future], cp).surface).toEqual([]);
    expect(ids(projectPartnerDay(context(plusDays(TODAY, 2)), [future], cp).surface))
      .toEqual(['future']);
  });

  it('is ordered oldest first, the order the day happened in', () => {
    const all = [
      at('third', 0, { time: '21:00' }),
      at('first', 2, { time: '08:00' }),
      at('second', 0, { time: '08:00' }),
    ];
    expect(ids(projectPartnerDay(context(), all, null).surface))
      .toEqual(['first', 'second', 'third']);
  });

  it('is unaffected by how many days pass between opens', () => {
    const all = [at('a', 0), at('b', 1)];
    const phone = device();
    const firstIds = ids(phone.open(all, TODAY).surface);
    for (const gap of [1, 9, 45, 365, 1000]) {
      expect(ids(phone.open(all, plusDays(TODAY, gap)).surface), `gap ${gap}`).toEqual(firstIds);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* W5: ACKNOWLEDGE                                                           */
/* ------------------------------------------------------------------------- */

describe('acknowledgement is the only CONFIRMED writer', () => {
  it('moves exactly the acknowledged ids from OUTSTANDING to CONFIRMED', () => {
    const all = [at('a', 1), at('b', 1, { time: '10:00' }), at('c', 1, { time: '11:00' })];
    const cp = projectPartnerDay(context(), all, null).checkpoint;

    const next = acknowledgePartnerDayRecords(cp, [all[0], all[1]])!;
    expect(next.confirmedRecordIds.sort()).toEqual(['a', 'b']);
    expect(next.outstandingRecordIds).toEqual(['c']);
    // Confirming changes nothing about what this device knows.
    expect(next.knownRecordIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns null when nothing was consumed, so nothing is persisted', () => {
    const cp = checkpoint({ outstandingRecordIds: ['a'], knownRecordIds: ['a'] });
    expect(acknowledgePartnerDayRecords(cp, [])).toBeNull();
    // A record that is not outstanding cannot be confirmed by a caller's argument.
    expect(acknowledgePartnerDayRecords(cp, [at('never-surfaced', 3)])).toBeNull();
  });

  it('cannot confirm a record the state machine never surfaced', () => {
    // CONFIRMED ⊆ surfaced, structurally rather than by the caller behaving.
    const cp = checkpoint({ outstandingRecordIds: ['a'], knownRecordIds: ['a', 'hidden'] });
    const next = acknowledgePartnerDayRecords(cp, [at('a', 1), at('hidden', 1)])!;
    expect(next.confirmedRecordIds).toEqual(['a']);
  });

  it('the unacknowledged remainder of a visible prefix stays reachable', () => {
    const all = Array.from({ length: 20 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, 3, {
      time: `${String(i).padStart(2, '0')}:00`,
    }));
    const { checkpoint: cp, surface } = projectPartnerDay(context(), all, null);

    const next = acknowledgePartnerDayRecords(cp, surface.slice(0, 5))!;
    expect(next.outstandingRecordIds).toHaveLength(15);
    expect(ids(projectPartnerDay(context(), all, next).surface))
      .toEqual(all.slice(5).map((r) => r.id));
  });

  it('partial acknowledgement over many passes drains without ever growing', () => {
    const all = Array.from({ length: 47 }, (_, i) => at(`r-${String(i).padStart(2, '0')}`, i % 7, {
      time: `${String(i % 24).padStart(2, '0')}:00`,
    }));
    const phone = device();
    let previous = Infinity;

    for (let pass = 0; pass < 20; pass += 1) {
      const { surface } = phone.open(all, TODAY);
      expect(surface.length, `pass ${pass} grew`).toBeLessThanOrEqual(previous);
      previous = surface.length;
      if (surface.length === 0) break;
      phone.confirm(surface.slice(0, 5));
    }
    expect(previous).toBe(0);
  });

  it('an acknowledgement 400 days later still works on the original record', () => {
    const old = record({ id: 'old', date: TODAY });
    const phone = device();
    phone.open([old], TODAY);

    const late = plusDays(TODAY, 400);
    const { surface } = phone.open([old], late);
    expect(ids(surface)).toEqual(['old']);
    expect(phone.confirm(surface)).toBe(true);
    expect(phone.open([old], late).surface).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Unreadable records                                                        */
/* ------------------------------------------------------------------------- */

describe('a record this device cannot read', () => {
  it('surfaces, and stays outstanding because it could not be in a readable prefix', () => {
    const locked = at('locked', 1, { contentUnavailable: true, log: '' });
    const readable = at('readable', 1, { time: '10:00' });
    const phone = device();

    const { surface } = phone.open([locked, readable], TODAY);
    expect(ids(surface)).toEqual(['locked', 'readable']);

    // The widget confirms the READABLE prefix, which cannot include `locked`.
    phone.confirm(surface.filter((r) => !r.contentUnavailable));
    expect(ids(phone.open([locked, readable], TODAY).surface)).toEqual(['locked']);
  });

  it('survives 400 days locked, then is confirmable once the key arrives', () => {
    const locked = at('locked', 1, { contentUnavailable: true, log: '' });
    const phone = device();
    phone.open([locked], TODAY);

    const later = plusDays(TODAY, 400);
    expect(ids(phone.open([locked], later).surface)).toEqual(['locked']);

    const unlocked = [{ ...locked, contentUnavailable: undefined, log: '이제 읽혀요' }];
    const { surface } = phone.open(unlocked, later);
    expect(ids(surface)).toEqual(['locked']);
    expect(phone.confirm(surface)).toBe(true);
    expect(phone.open(unlocked, later).surface).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Delete / restore                                                          */
/* ------------------------------------------------------------------------- */

describe('a record that leaves this device and comes back', () => {
  it('is not lost, and is not confirmed by its absence', () => {
    const a = at('a', 2);
    const b = at('b', 2, { time: '10:00' });
    const phone = device();
    phone.open([a, b], TODAY);

    // `b` disappears from this client's slice.
    expect(ids(phone.open([a], TODAY).surface)).toEqual(['a']);
    expect(phone.stored()?.outstandingRecordIds.sort()).toEqual(['a', 'b']);

    // And returns, still unconfirmed.
    expect(ids(phone.open([a, b], TODAY).surface)).toEqual(['a', 'b']);
  });

  it('a confirmed record that is deleted and restored stays confirmed', () => {
    const a = at('a', 2);
    const phone = device();
    phone.open([a], TODAY);
    phone.confirm([a]);

    phone.open([], TODAY);
    expect(phone.open([a], plusDays(TODAY, 30)).surface).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Privacy                                                                   */
/* ------------------------------------------------------------------------- */

describe('privacy is settled before any classification', () => {
  it("never surfaces the partner's private record, in any state", () => {
    const secret = at('secret', 2, { isPrivate: true });
    const states = [
      null,
      checkpoint({ knownRecordIds: ['other'] }),
      checkpoint({ outstandingRecordIds: ['secret'], knownRecordIds: ['secret', 'other'] }),
    ];
    for (const cp of states) {
      expect(projectPartnerDay(context(), [secret], cp).surface).toEqual([]);
    }
  });

  it("never surfaces the viewer's own record", () => {
    const mine = at('mine', 2, { userId: ME, authorRole: 'soldier' });
    expect(projectPartnerDay(context(), [mine], null).surface).toEqual([]);
  });

  it('no private or own id can enter any set in the receipt', () => {
    const shared = at('shared', 2);
    const secret = at('secret', 2, { isPrivate: true, time: '10:00' });
    const mine = at('mine', 2, { userId: ME, authorRole: 'soldier', time: '11:00' });
    const all = [shared, secret, mine];

    const { checkpoint: cp, surface } = projectPartnerDay(context(), all, null);
    expect(cp.knownRecordIds).toEqual(['shared']);
    expect(cp.outstandingRecordIds).toEqual(['shared']);

    const next = acknowledgePartnerDayRecords(cp, all)!;
    expect(next.confirmedRecordIds).toEqual(['shared']);
    expect(ids(surface)).toEqual(['shared']);
  });

  it('a private record changes no count', () => {
    const shared = at('shared', 2);
    const secret = at('secret', 2, { isPrivate: true, time: '10:00' });
    expect(projectPartnerDay(context(), [shared, secret], null).surface)
      .toHaveLength(projectPartnerDay(context(), [shared], null).surface.length);
  });

  it('eligibility excludes future dates as well as private and own records', () => {
    const all = [
      at('ok', 1),
      at('mine', 1, { userId: ME, authorRole: 'soldier' }),
      at('secret', 1, { isPrivate: true }),
      record({ id: 'future', date: plusDays(TODAY, 1) }),
    ];
    expect(ids(eligibleSharedPartnerRecords(all, VIEWER, TODAY))).toEqual(['ok']);
  });
});

/* ------------------------------------------------------------------------- */
/* W6: identity scoping                                                      */
/* ------------------------------------------------------------------------- */

describe('a receipt belongs to one viewer looking at one relationship', () => {
  it("another account's receipt on the same device suppresses nothing", () => {
    const hers = at('hers', 1);
    device('someone-else', COUPLE).open([hers], TODAY);
    device('someone-else', COUPLE).confirm([hers]);

    expect(ids(device(ME, COUPLE).open([hers], TODAY).surface)).toEqual(['hers']);
  });

  it('a receipt from a previous couple suppresses nothing after relinking', () => {
    const rec = at('rec-1', 1);
    device(ME, 'couple-old').open([rec], TODAY);
    device(ME, 'couple-old').confirm([rec]);

    expect(ids(device(ME, 'couple-new').open([rec], TODAY).surface)).toEqual(['rec-1']);
  });

  it('reads and writes nothing without a complete identity', () => {
    const cp = checkpoint({ outstandingRecordIds: ['a'], knownRecordIds: ['a'] });
    expect(readPartnerDayCheckpoint({ userId: '', coupleId: COUPLE })).toBeNull();
    expect(readPartnerDayCheckpoint({ userId: ME, coupleId: '' })).toBeNull();
    expect(writePartnerDayCheckpoint({ userId: '', coupleId: COUPLE }, cp)).toBe(false);
    expect(writePartnerDayCheckpoint({ userId: ME, coupleId: '' }, cp)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* W7: persistence failure                                                   */
/* ------------------------------------------------------------------------- */

describe('persistence failure keeps the records, and retries', () => {
  function withThrowingStorage(run: () => void) {
    const real = globalThis.localStorage;
    const throwing: Storage = {
      length: 0,
      clear: () => {},
      getItem: (key) => real.getItem(key),
      key: (index) => real.key(index),
      removeItem: () => {},
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try { run(); } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
  }

  it('a failed write reports false and stores nothing', () => {
    withThrowingStorage(() => {
      expect(writePartnerDayCheckpoint(
        { userId: ME, coupleId: COUPLE },
        checkpoint({ outstandingRecordIds: ['a'], knownRecordIds: ['a'] }),
      )).toBe(false);
    });
    expect(readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })).toBeNull();
  });

  it('the surface is unchanged by the write failing, and the next open retries', () => {
    const a = at('a', 1);
    let surfaceDuringFailure: string[] = [];

    withThrowingStorage(() => {
      // The projection is computed from records, not from storage, so the screen is
      // correct even when nothing can be saved.
      const projection = projectPartnerDay(context(), [a], null);
      surfaceDuringFailure = ids(projection.surface);
      expect(writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, projection.checkpoint))
        .toBe(false);
    });

    expect(surfaceDuringFailure).toEqual(['a']);
    // Storage recovers: the retry writes the same state, because both transitions
    // are idempotent.
    const phone = device();
    expect(ids(phone.open([a], TODAY).surface)).toEqual(['a']);
    expect(phone.stored()?.outstandingRecordIds).toEqual(['a']);
  });

  it('a failed acknowledgement does not retire the record', () => {
    const a = at('a', 1);
    const phone = device();
    phone.open([a], TODAY);

    withThrowingStorage(() => {
      const stored = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
      const next = acknowledgePartnerDayRecords(stored, [a])!;
      expect(writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, next)).toBe(false);
    });

    // Still outstanding on disk and still on the surface.
    expect(ids(phone.open([a], TODAY).surface)).toEqual(['a']);
    expect(phone.stored()?.confirmedRecordIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Storage shape                                                             */
/* ------------------------------------------------------------------------- */

describe('the stored receipt', () => {
  it('round-trips, carrying its version', () => {
    const cp = checkpoint({
      confirmedRecordIds: ['c'],
      outstandingRecordIds: ['o'],
      knownRecordIds: ['c', 'o', 'k'],
    });
    expect(writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, cp)).toBe(true);
    const read = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
    expect(read.version).toBe(PARTNER_DAY_CHECKPOINT_VERSION);
    expect(read.confirmedRecordIds).toEqual(['c']);
    expect(read.outstandingRecordIds).toEqual(['o']);
    expect(read.knownRecordIds.sort()).toEqual(['c', 'k', 'o']);
  });

  it('carries a v1 observedRecordIds over as KNOWN, because it means the same thing', () => {
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), JSON.stringify({
      confirmedRecordIds: ['seen'],
      outstandingRecordIds: ['left'],
      observedRecordIds: ['seen', 'left', 'history'],
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    }));
    const read = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!;
    expect(read.version).toBe(1);
    expect(read.knownRecordIds.sort()).toEqual(['history', 'left', 'seen']);

    // Which means a v1 receipt does NOT flood: history it knew about stays put, and
    // its outstanding record is still reachable.
    const all = [at('seen', 300), at('left', 300, { time: '10:00' }), at('history', 300, { time: '11:00' })];
    expect(ids(projectPartnerDay(context(), all, read).surface)).toEqual(['left']);
  });

  it('is not rejected because of a malformed or missing timestamp', () => {
    // v1 rejected the whole receipt when `confirmedAt` did not parse, which let a
    // clock decide membership through the back door. Nothing reads it now.
    for (const bad of [undefined, '', 'just now', 42, null]) {
      localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), JSON.stringify({
        confirmedRecordIds: ['x'],
        outstandingRecordIds: ['y'],
        observedRecordIds: ['x', 'y'],
        confirmedAt: bad,
      }));
      const read = readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE });
      expect(read?.outstandingRecordIds, `confirmedAt=${JSON.stringify(bad)}`).toEqual(['y']);
    }
  });

  it('writes no timestamp of any kind', () => {
    writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, checkpoint({
      outstandingRecordIds: ['a'], knownRecordIds: ['a'],
    }));
    const raw = JSON.parse(localStorage.getItem(partnerDayCheckpointKey(ME, COUPLE))!);
    expect(Object.keys(raw).sort()).toEqual([
      'confirmedRecordIds', 'knownRecordIds', 'outstandingRecordIds', 'version',
    ]);
  });

  it('readPartnerDayCheckpoint alone cannot tell a corrupt receipt from a missing one', () => {
    // `readPartnerDayCheckpoint` returns `null` for missing, corrupt AND
    // unavailable alike -- by design, it is a thin projection of
    // `readPartnerDayCheckpointStatus` for callers that do not need the
    // distinction. A caller that DOES need it -- `projectPartnerDay`, via
    // `usePartnerDay` -- must read the full status instead. See
    // "BLOCKER FIX 2" and "BLOCKER FIX 3" above for what the distinction is
    // for: treating a corrupt or unreadable receipt as first-contact bounds
    // recovery to seven days (or, worse, persists over a real receipt) and can
    // silently entomb or overwrite an older OUTSTANDING record.
    // `readPartnerDayCheckpointStatus`, reported as `status: 'corrupt'` here,
    // is what lets `projectPartnerDay` avoid that and take `recovery` instead.
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), '{ not json');
    expect(readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })).toBeNull();

    const status = readPartnerDayCheckpointStatus({ userId: ME, coupleId: COUPLE });
    expect(status).toEqual({ checkpoint: null, status: 'corrupt' });

    const { transition, surface } = projectPartnerDay(
      context(), [at('recent', 2)], status.checkpoint, status.status,
    );
    expect(transition).toBe('recovery');
    expect(ids(surface)).toEqual(['recent']);
  });

  it('rejects a non-array id field rather than trusting it', () => {
    localStorage.setItem(partnerDayCheckpointKey(ME, COUPLE), JSON.stringify({
      confirmedRecordIds: 'not-an-array',
      knownRecordIds: ['a'],
    }));
    expect(readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })).toBeNull();
  });

  it('never caps or compacts the id sets', () => {
    // A dropped id is indistinguishable from an id never seen, so compaction
    // manufactures "never known" verdicts and re-surfaces settled records.
    const all = Array.from({ length: 2500 }, (_, i) => record({
      id: `1f0a2b3c-4d5e-6f70-8192-${String(i).padStart(12, '0')}`,
      date: TODAY,
    }));
    const { checkpoint: cp, surface } = projectPartnerDay(context(), all, null);
    expect(cp.knownRecordIds).toHaveLength(2500);
    expect(cp.outstandingRecordIds).toHaveLength(2500);

    const next = acknowledgePartnerDayRecords(cp, surface)!;
    expect(next.confirmedRecordIds).toHaveLength(2500);
    expect(writePartnerDayCheckpoint({ userId: ME, coupleId: COUPLE }, next)).toBe(true);
    expect(readPartnerDayCheckpoint({ userId: ME, coupleId: COUPLE })!.confirmedRecordIds)
      .toHaveLength(2500);
  });

  for (const n of [500, 2000, 5000]) {
    it(`reports its serialized size at ${n} records`, () => {
      // Diagnostic, deliberately not a threshold: a browser quota is not a product
      // invariant and must not become one.
      const all = Array.from({ length: n }, (_, i) => record({
        id: `1f0a2b3c-4d5e-6f70-8192-${String(i).padStart(12, '0')}`,
        date: TODAY,
      }));
      const cp = projectPartnerDay(context(), all, null).checkpoint;
      console.log(`[storage] ${n} records -> ${JSON.stringify(cp).length} chars`);
      expect(cp.outstandingRecordIds).toHaveLength(n);
    });
  }
});

/* ------------------------------------------------------------------------- */
/* Scale                                                                     */
/* ------------------------------------------------------------------------- */

describe('scale', () => {
  for (const n of [500, 2000]) {
    it(`keeps every unconfirmed record of ${n} reachable across 400 days`, () => {
      const all = Array.from({ length: n }, (_, i) => at(`r-${i}`, i % 7, {
        time: `${String(i % 24).padStart(2, '0')}:00`,
      }));
      const phone = device();
      const firstOpen = phone.open(all, TODAY).surface;
      expect(firstOpen).toHaveLength(n);

      // Confirm a third of them, then jump 400 days.
      phone.confirm(firstOpen.slice(0, Math.floor(n / 3)));
      const later = phone.open(all, plusDays(TODAY, 400)).surface;
      expect(later).toHaveLength(n - Math.floor(n / 3));
    });
  }
});

/* ------------------------------------------------------------------------- */
/* Copy helpers                                                              */
/* ------------------------------------------------------------------------- */

describe('copy helpers', () => {
  it('spansBeforeToday distinguishes a today screen from a multi-day one', () => {
    expect(spansBeforeToday([at('a', 0)], TODAY)).toBe(false);
    expect(spansBeforeToday([at('a', 0), at('b', 1)], TODAY)).toBe(true);
    expect(spansBeforeToday([], TODAY)).toBe(false);
  });

  it('labels older rows with a date, and today with nothing', () => {
    expect(partnerDayDateLabel(TODAY, TODAY)).toBeNull();
    expect(partnerDayDateLabel(day(1), TODAY)).toBe('어제');
    expect(partnerDayDateLabel('2026-08-15', TODAY)).toBe('8월 15일');
  });
});
