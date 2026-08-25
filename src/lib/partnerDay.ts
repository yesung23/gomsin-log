import type { DailyRecord } from '@/types';
import { isOwnRecord, visibleRecordsForViewer, type Viewer } from '@/lib/privacy';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';

/**
 * 상대방의 놓친 하루 — which of the partner's shared records this viewer still
 * has to deal with.
 *
 * ONE RULE GOVERNS THIS MODULE:
 *
 *   A record the user has not pressed the confirm button on must never stop
 *   being reachable, however much time passes.
 *
 * The previous implementation could not keep that promise, and the reason is
 * worth stating precisely because every repair to it failed the same way. It had
 * no transition for "surfaced but not acknowledged". A viewer with no receipt got
 * a rolling seven-day window, so the window itself was doing the remembering --
 * and a window computed from today's date forgets by design. Day 0 showed a
 * record; day 8 did not; nobody confirmed anything.
 *
 * The replacement makes memory explicit and additive. Three sets, ids only:
 *
 *   CONFIRMED    the user pressed the button on this record. Written by exactly
 *                one function, `acknowledgePartnerDayRecords`, and by nothing
 *                else, ever.
 *   OUTSTANDING  this record was put in front of the user and not confirmed. It
 *                stays here until the button retires it. No date, no age, no cap
 *                and no cleanup can remove it.
 *   KNOWN        this device knows this record exists. Its only job is to tell a
 *                record this device has already accounted for apart from one
 *                arriving now.
 *
 * The surface is `OUTSTANDING ∩ eligible(today)`. A date is read in exactly one
 * place -- deciding whether a record is eligible at all -- and in exactly two
 * ways: the viewer may not see the partner's private or own records, and a
 * record dated after today has not happened yet. Nothing else is a date
 * decision.
 *
 * A receipt read comes back one of four ways, and none of them are the same
 * failure. Genuinely nothing stored is first contact, bounded to a seven-day
 * discovery window by design. A receipt STRING that exists and fails to parse
 * or validate is corrupt: nothing in it can be trusted, including a date
 * bound, so it takes `recovery` instead -- every currently eligible record
 * becomes OUTSTANDING, unbounded by date. A read that fails OUTRIGHT
 * (`localStorage.getItem` throwing) is neither: it proves nothing about
 * whether a real receipt exists underneath, so it takes the SAME unbounded
 * surface as `recovery` but may never be written back -- a storage backend
 * whose reads throw while its writes still succeed would otherwise silently
 * overwrite a real receipt with one computed as if it never existed.
 * Collapsing any of these into first-contact was a launch blocker each time:
 * it silently entombed an OUTSTANDING record older than seven days, or
 * clobbered a healthy receipt outright. See `readPartnerDayCheckpointStatus`
 * and `projectPartnerDay`.
 *
 * Deliberately absent, each having been the cause of a real defect:
 *
 *   - a date cursor or `confirmedThrough`
 *   - a date floor of any kind on membership
 *   - an id cap or compaction (a dropped id is indistinguishable from an id
 *     never seen, so compaction manufactures "never known" verdicts)
 *   - `createdAt` compared against a device timestamp (two clocks, one of which
 *     the server owns)
 *   - any server clock reading
 *   - mount, render, load or timer treated as consumption
 *   - any automatic write to CONFIRMED
 *
 * The checkpoint is device-local, never server truth, and never affects
 * authorization. It is keyed by viewer AND couple, so signing in as someone else
 * or relinking cannot suppress a different person's unseen context.
 */

/** Current on-disk shape. Bumped only when the payload's meaning changes. */
export const PARTNER_DAY_CHECKPOINT_VERSION = 2;

/**
 * How far back a device looks on FIRST CONTACT, and only then.
 *
 * PRODUCT_V3 §6.5: `마지막 확인점 이후, 없으면 최근 7일, 상한 오늘`. This is the
 * "없으면 최근 7일" clause and it applies once per device-relationship, at the
 * single moment there is no receipt at all. It bounds how much of a long history
 * a first open puts in front of someone; it is not a retention rule, and after
 * that first moment nothing in this module consults it again.
 */
export const PARTNER_DAY_DISCOVERY_DAYS = 7;

export interface PartnerDayCheckpoint {
  /** On-disk shape marker, so a future change can be told apart from corruption. */
  version: number;
  /**
   * Records the user explicitly confirmed. Identity is the record id
   * (PRODUCT_V3 §7.5 "원본 동일성"), so editing a record leaves it confirmed and
   * re-dating one does not silently re-surface it.
   */
  confirmedRecordIds: string[];
  /**
   * Records that have been put in front of the user and not confirmed.
   *
   * This is the set that carries the product promise. Membership is decided by
   * nothing but the two transitions that add to it and the one that removes from
   * it, so no amount of elapsed time can empty it.
   */
  outstandingRecordIds: string[];
  /**
   * Records this device knows exist.
   *
   * Read the name literally. It does NOT claim the user saw the record; it claims
   * this device accounted for it. Without it, history already in local state
   * would look like a fresh arrival every time the app opened.
   */
  knownRecordIds: string[];
}

/**
 * Everything a partner-day computation needs, in one value.
 *
 * Bundled rather than passed as four arguments because the defect class this
 * module keeps producing is two parts of the same operation disagreeing about
 * who is looking, at which relationship, on what day. Eligibility and
 * persistence both read this one object, so they cannot drift: the storage key
 * comes from `userId`/`coupleId`, the privacy gate from `viewer`, and the
 * eligibility bound from `todayStr`.
 *
 * `todayStr` is supplied by the caller and never derived here. A clock read
 * inside this module would be a second source of "today" for the same closure.
 */
export interface PartnerDayContext {
  /** The account looking. Half of the storage identity. */
  userId: string;
  /** The relationship being looked at. The other half. */
  coupleId: string;
  /** Privacy identity, for the eligibility gate. */
  viewer: Viewer;
  /** The viewer's local date, `YYYY-MM-DD`. Used for eligibility and nothing else. */
  todayStr: string;
}

/** Which transition produced a projection. Diagnostic and test-facing. */
export type PartnerDayTransition =
  /** No usable receipt: seed OUTSTANDING from the discovery window. */
  | 'first-contact'
  /** A receipt that can attest to what this device knew: additive discovery. */
  | 'discovery'
  /**
   * A receipt STRING exists and failed to parse or validate. Distinct from
   * `first-contact`: nothing in a corrupt receipt can be trusted, including a
   * date bound, so every currently eligible record becomes OUTSTANDING,
   * unbounded by date -- not just the last seven days. See `projectPartnerDay`.
   */
  | 'recovery'
  /**
   * The read ITSELF failed (`localStorage.getItem` threw) -- there may be a
   * perfectly healthy receipt on disk that this device simply could not read
   * right now. The surface shown is the SAME shape as `recovery` (every
   * eligible record), but nothing about it may be written back: an
   * asymmetric storage failure (reads throw, writes still succeed) can
   * otherwise overwrite a real receipt with a checkpoint computed as if it
   * did not exist. See `projectPartnerDay` and `usePartnerDay`.
   */
  | 'unavailable';

export interface PartnerDayProjection {
  /** The state implied by what this device can now see. */
  checkpoint: PartnerDayCheckpoint;
  /** `OUTSTANDING ∩ eligible(today)`, oldest first. What the user is shown. */
  surface: DailyRecord[];
  /** Whether `checkpoint` differs from the stored one and so needs persisting. */
  changed: boolean;
  /** Which transition ran. */
  transition: PartnerDayTransition;
}

export interface PartnerDayWindow {
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  since: string;
  /** Inclusive upper bound: today. §6.5 "상한 오늘". */
  until: string;
}

export function partnerDayCheckpointKey(userId: string, coupleId: string): string {
  return `gomsinlog.partner-day.v1:${userId}:${coupleId}`;
}

/** De-duplicated string array, or `null` when the value is not one. */
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return null;
  return Array.from(new Set(value as string[]));
}

/**
 * The four ways a receipt read can come out, and they are not interchangeable
 * (Control Tower cold review, 2026-08-20 and 2026-08-21, invariant I1 NO
 * SILENT LOSS):
 *
 *   `missing`     nothing is stored, or storage/identity is not ready: genuine
 *                 first contact. The bounded seven-day discovery window is the
 *                 correct, intentional policy here -- it is not a safety
 *                 fallback, and widening it would flood every real first open
 *                 with two years of history.
 *
 *   `valid`       a receipt was read and parses and validates.
 *
 *   `corrupt`     a receipt STRING exists at this key and fails to parse or
 *                 pass schema validation. Nothing in it can be trusted,
 *                 including a date bound, so the bounded window is WRONG here
 *                 -- it is exactly what silently entombed a healthy 30-day-old
 *                 OUTSTANDING record the first time this was reviewed. See
 *                 `projectPartnerDay`'s `recovery` transition.
 *
 *   `unavailable` the read ITSELF failed (`localStorage.getItem` threw). This
 *                 is NOT `missing` and NOT `corrupt`: there may be a perfectly
 *                 healthy receipt on disk that could not be read right now, and
 *                 there is no way to tell that apart from genuine absence by
 *                 reading alone. Reporting it as `missing` was itself a
 *                 blocker: `projectPartnerDay` would run the bounded
 *                 first-contact seed exactly as if nothing were stored, and if
 *                 the SAME storage backend can still WRITE even though it
 *                 cannot READ -- a real, reproducible asymmetric failure, not a
 *                 hypothetical -- persisting that seed silently overwrites the
 *                 real receipt with one computed as if it never existed. See
 *                 `projectPartnerDay`'s `unavailable` transition and
 *                 `usePartnerDay`, which additionally refuses to persist or
 *                 acknowledge anything while this status holds.
 */
export type PartnerDayReceiptStatus = 'missing' | 'valid' | 'corrupt' | 'unavailable';

/** `readPartnerDayCheckpoint`'s full answer: the checkpoint, and which of the four `PartnerDayReceiptStatus` states produced it. */
export interface PartnerDayReceiptRead {
  /** The usable checkpoint. Non-null only when `status === 'valid'`. */
  checkpoint: PartnerDayCheckpoint | null;
  status: PartnerDayReceiptStatus;
}

export function readPartnerDayCheckpointStatus(
  context: Pick<PartnerDayContext, 'userId' | 'coupleId'>,
): PartnerDayReceiptRead {
  const { userId, coupleId } = context;
  if (typeof localStorage === 'undefined' || !userId || !coupleId) {
    return { checkpoint: null, status: 'missing' };
  }

  let value: string | null;
  try {
    value = localStorage.getItem(partnerDayCheckpointKey(userId, coupleId));
  } catch {
    // `getItem` itself failed: this proves nothing about whether a real
    // receipt exists. NOT `missing` -- see the type doc above.
    return { checkpoint: null, status: 'unavailable' };
  }
  if (!value) return { checkpoint: null, status: 'missing' };

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return { checkpoint: null, status: 'corrupt' };
    const candidate = parsed as Record<string, unknown>;

    const confirmed = stringArray(candidate.confirmedRecordIds);
    if (!confirmed) return { checkpoint: null, status: 'corrupt' };

    /*
     * v1 receipts called this `observedRecordIds` and meant the same thing this
     * module means by KNOWN: ids this device had accounted for. The rename is
     * honest, so the value carries over rather than being discarded -- dropping
     * it would make a long history look like a flood of new arrivals.
     *
     * v1 also carried `confirmedAt`, and v1 REJECTED the whole receipt when that
     * timestamp was malformed. That is a clock deciding membership through the
     * back door, so the field is not read at all here and is not written back.
     */
    const known = stringArray(candidate.knownRecordIds)
      ?? stringArray(candidate.observedRecordIds)
      ?? [];

    return {
      checkpoint: {
        version: typeof candidate.version === 'number' ? candidate.version : 1,
        confirmedRecordIds: confirmed,
        outstandingRecordIds: stringArray(candidate.outstandingRecordIds) ?? [],
        knownRecordIds: known,
      },
      status: 'valid',
    };
  } catch {
    // JSON.parse threw: the bytes are there and are not JSON. Corrupt, not absent.
    return { checkpoint: null, status: 'corrupt' };
  }
}

/**
 * Read the stored receipt, or `null` when there is not a usable one.
 *
 * A thin projection of `readPartnerDayCheckpointStatus` for callers -- and the
 * many existing tests -- that only need the checkpoint and do not need to tell
 * absence from corruption apart. `projectPartnerDay` needs that distinction and
 * takes `readPartnerDayCheckpointStatus`'s full result instead.
 */
export function readPartnerDayCheckpoint(
  context: Pick<PartnerDayContext, 'userId' | 'coupleId'>,
): PartnerDayCheckpoint | null {
  return readPartnerDayCheckpointStatus(context).checkpoint;
}

export function writePartnerDayCheckpoint(
  context: Pick<PartnerDayContext, 'userId' | 'coupleId'>,
  checkpoint: PartnerDayCheckpoint,
): boolean {
  const { userId, coupleId } = context;
  if (typeof localStorage === 'undefined'
    || !userId
    || !coupleId
    || !stringArray(checkpoint.confirmedRecordIds)
    || !stringArray(checkpoint.outstandingRecordIds)
    || !stringArray(checkpoint.knownRecordIds)) return false;
  try {
    localStorage.setItem(partnerDayCheckpointKey(userId, coupleId), JSON.stringify({
      version: PARTNER_DAY_CHECKPOINT_VERSION,
      confirmedRecordIds: Array.from(new Set(checkpoint.confirmedRecordIds)),
      outstandingRecordIds: Array.from(new Set(checkpoint.outstandingRecordIds)),
      knownRecordIds: Array.from(new Set(checkpoint.knownRecordIds)),
    }));
    return true;
  } catch {
    /*
     * A full or blocked storage. The caller must NOT advance its in-memory state
     * on `false`: the screen and the disk would then disagree, and a reload would
     * be the thing that loses the records. Keep showing them and let the next
     * computation retry -- both transitions are idempotent, so a retry that
     * finally succeeds writes exactly the same thing.
     */
    return false;
  }
}

/**
 * The FIRST CONTACT window: §6.5's "없으면 최근 7일, 상한 오늘".
 *
 * The only date range in this module, and it is consulted once per
 * device-relationship. Once a receipt exists, membership is decided from ids.
 */
export function partnerDayDiscoveryWindow(todayStr: string): PartnerDayWindow {
  const start = parseLocalDate(todayStr);
  start.setDate(start.getDate() - (PARTNER_DAY_DISCOVERY_DAYS - 1));
  return { since: toLocalDateString(start), until: todayStr };
}

/**
 * The privacy gate: what this viewer is entitled to see of the partner's day.
 *
 * Authorization is settled before any of the state machine runs, so no
 * classification below can widen it, and no private or own record's id can reach
 * a receipt.
 */
export function visibleSharedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
): DailyRecord[] {
  return visibleRecordsForViewer(records, viewer)
    .filter((record) => !isOwnRecord(record, viewer) && !record.isPrivate);
}

/**
 * THE eligibility domain. Everything -- the surface, both transitions, and the
 * KNOWN snapshot -- ranges over this one function.
 *
 * That single sourcing is the point. When the surface and the receipt computed
 * their own domains, a future-dated record was correctly withheld from the
 * screen while still being written down as already accounted for, and the day
 * its date arrived it was unconfirmed, not outstanding, and known: gone, with
 * nobody having confirmed anything.
 */
export function eligibleSharedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
  todayStr: string,
): DailyRecord[] {
  // §6.5 "상한 오늘". A date that has not arrived is not missed context, and this
  // device may not claim to have accounted for it either.
  return visibleSharedPartnerRecords(records, viewer)
    .filter((record) => record.date <= todayStr);
}

/** Chronological order, the order the partner's day actually happened in. */
function byTime(a: DailyRecord, b: DailyRecord): number {
  const aChronology = `${a.date} ${a.time || ''}`;
  const bChronology = `${b.date} ${b.time || ''}`;
  if (aChronology < bChronology) return -1;
  if (aChronology > bChronology) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Set equality, ignoring order. Used only to decide whether a write is needed. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

/**
 * Decide what this device now knows, and what to put in front of the user.
 *
 * Two transitions, chosen by one question: can the stored receipt attest to what
 * this device already knew? That question is answered by PROVENANCE -- whether
 * a real v2 receipt exists at all -- never by whether its KNOWN set happens to be
 * empty.
 *
 * `known.size === 0` used to decide this directly, and that was the cold-review
 * blocker: a genuine v2 receipt can legitimately have an empty KNOWN set, because
 * the day it was written there were zero eligible records to know about. Reading
 * that as "no receipt" re-ran the bounded discovery-window seed on a device that
 * already had a real receipt. Any record older than the window that arrived
 * before the next open was then marked KNOWN without ever becoming OUTSTANDING --
 * and KNOWN-without-OUTSTANDING is the terminal "already dealt with" state, so
 * the record was gone permanently, without anyone confirming anything.
 *
 * FIRST CONTACT (`stored` is absent, or it is a legacy receipt with no KNOWN
 * provenance at all -- see below) seeds OUTSTANDING from the discovery window and
 * records the whole eligible history as KNOWN. The two differ on purpose: history
 * older than the
 * window is accounted for without being pushed at someone opening the app for
 * the first time, which is §6.5's rule.
 *
 * "No KNOWN provenance" is a fact about the STORED SHAPE, not about the size of
 * a set computed from it: `stored.version` is below `PARTNER_DAY_CHECKPOINT_VERSION`
 * (a v1 receipt) AND its KNOWN set is empty once the v1→v2 field rename is
 * applied. `readPartnerDayCheckpoint` maps a v1 `observedRecordIds` onto
 * `knownRecordIds`, so a v1 receipt that DID carry that field still has real
 * provenance and takes the discovery path below; only a v1 receipt with neither
 * field -- the shape a receipt has when it predates KNOWN existing at all -- has
 * none. Either way, this path keeps whatever CONFIRMED and OUTSTANDING the legacy
 * receipt already had, because the alternative, treating an empty KNOWN as "knows
 * of nothing", would dump two years of history onto the screen at once.
 *
 * DISCOVERY is additive and unbounded by date. Any eligible record that is not
 * confirmed, not outstanding and not known becomes OUTSTANDING, whatever its
 * date. This is what rescues a genuine late arrival -- an offline backlog stamped
 * with its compose date, or a partner in a timezone ahead -- and it needs no
 * clock comparison to do it, because an id either was accounted for or was not.
 *
 * Neither transition writes CONFIRMED. Running this function is not consumption:
 * mounting a widget, loading records or re-rendering can only ever make records
 * MORE reachable here, never less.
 *
 * Idempotent: projecting a projection reports `changed: false` and the same
 * surface. The caller relies on that to avoid a write loop, and a test pins it.
 */
export function projectPartnerDay(
  context: PartnerDayContext,
  records: DailyRecord[],
  stored: PartnerDayCheckpoint | null | undefined,
  /**
   * Which of the four `PartnerDayReceiptStatus` states produced `stored`.
   * Pass `readPartnerDayCheckpointStatus(...).status` here.
   *
   * Omitted, it is inferred from `stored` alone (`'valid'` if present,
   * `'missing'` otherwise) -- exactly the only two states this function
   * recognized before `corrupt` and `unavailable` existed, so every call site
   * written before those states existed is unaffected by their addition.
   */
  receiptStatus?: PartnerDayReceiptStatus,
): PartnerDayProjection {
  const status: PartnerDayReceiptStatus = receiptStatus ?? (stored ? 'valid' : 'missing');
  const { viewer, todayStr } = context;
  const eligible = eligibleSharedPartnerRecords(records, viewer, todayStr);

  /*
   * Only a `valid` read may seed real state. `corrupt` bytes cannot attest to
   * ANYTHING they appear to contain -- not CONFIRMED, not OUTSTANDING, not
   * KNOWN. An `unavailable` read has not been read AT ALL -- `stored` here is
   * necessarily `null` by construction from `readPartnerDayCheckpointStatus`,
   * but this still discards a caller-supplied `stored` defensively, so nothing
   * upstream can accidentally seed real state alongside a status that says it
   * should not be trusted.
   */
  const effectiveStored = status === 'valid' ? (stored ?? null) : null;

  const confirmed = new Set(effectiveStored?.confirmedRecordIds ?? []);
  const outstanding = new Set(effectiveStored?.outstandingRecordIds ?? []);
  const known = new Set(effectiveStored?.knownRecordIds ?? []);

  /*
   * PROVENANCE, not set size, decides first-contact.
   *
   * `unavailable`: the read itself failed -- `unavailable`, below, regardless
   * of what `stored` looks like. This is checked FIRST, ahead of `corrupt`:
   * both are read-layer failures rather than content the receipt provably
   * had, but `unavailable` additionally must never be persisted (see
   * `usePartnerDay`), which `corrupt` may be, once repaired into a fresh valid
   * receipt. Reporting an `unavailable` read as `missing` was itself a
   * blocker (Control Tower cold review, 2026-08-21): a healthy receipt with a
   * 30-day-old record OUTSTANDING, momentarily unreadable on a backend whose
   * writes still succeed even though its reads throw, took the bounded
   * first-contact seed and then PERSISTED it -- silently overwriting the real
   * receipt with one computed as if it had never existed.
   *
   * `corrupt`: a receipt STRING exists and failed to parse or validate --
   * `recovery`, below, regardless of what `stored` looks like. A corrupt
   * receipt is `!effectiveStored` in exactly the same way a genuinely absent
   * one is, and the bounded first-contact seed is only correct for the absent
   * case. Collapsing the two was the FIRST launch blocker this module had
   * (Control Tower cold review, 2026-08-20): the same "KNOWN but never
   * OUTSTANDING again" loss, caused by corrupt bytes rather than an unreadable
   * store.
   *
   * `effectiveStored` absent and status is `missing`: no receipt exists at
   * all -- first-contact.
   *
   * `stored.version < PARTNER_DAY_CHECKPOINT_VERSION`: a legacy (v1) receipt.
   * Whether IT attests to anything depends on whether it ever had a KNOWN-shaped
   * field, which is exactly what `known.size === 0` tests for a v1 receipt only,
   * because a v1 receipt with real provenance had its `observedRecordIds` mapped
   * onto `knownRecordIds` during read and so is non-empty here. A v1 receipt can
   * legitimately be empty-and-real too (an old receipt from a quiet first day),
   * but the existing compatibility policy already treats a legacy receipt with
   * nothing to attest to as first-contact, and that is unchanged.
   *
   * `stored.version === PARTNER_DAY_CHECKPOINT_VERSION`: a genuine v2 receipt.
   * Its mere existence IS the provenance -- it was written by THIS module's own
   * write path, which always runs discovery or first-contact seeding before
   * persisting, so an empty KNOWN set on a v2 receipt means "verified: nothing
   * was eligible when this was written", not "attests to nothing". This is the
   * fix: discovery, never first-contact, regardless of set size.
   */
  const isLegacyWithNoProvenance = !!effectiveStored
    && effectiveStored.version < PARTNER_DAY_CHECKPOINT_VERSION
    && known.size === 0;
  const transition: PartnerDayTransition =
    status === 'unavailable' ? 'unavailable'
      : status === 'corrupt' ? 'recovery'
        : (!effectiveStored || isLegacyWithNoProvenance) ? 'first-contact' : 'discovery';

  if (transition === 'recovery' || transition === 'unavailable') {
    /*
     * Fail-open, identically for both: neither a corrupt receipt nor a read
     * that failed outright can attest to anything, including a date bound, so
     * this is NOT the bounded first-contact seed -- every currently eligible
     * record becomes OUTSTANDING, whatever its date. `confirmed` is already
     * empty (see `effectiveStored` above) -- CONFIRMED lived only in a receipt
     * this call cannot see, and there is nowhere else it could come from, so
     * it is legitimately empty here, not merely unpopulated. A record
     * confirmed before this may resurface once. Duplicate resurfacing over
     * silent, permanent loss is the accepted tradeoff (Control Tower policy),
     * not an oversight.
     *
     * The two transitions differ only in what `usePartnerDay` is allowed to do
     * with the result afterward -- `recovery`'s checkpoint may be persisted,
     * `unavailable`'s must not be, because a `corrupt` read has actually seen
     * the (broken) bytes while an `unavailable` one has seen nothing at all
     * and cannot rule out a real receipt sitting untouched underneath.
     */
    for (const record of eligible) {
      outstanding.add(record.id);
      known.add(record.id);
    }
  } else if (transition === 'first-contact') {
    const { since } = partnerDayDiscoveryWindow(todayStr);
    for (const record of eligible) {
      if (record.date >= since && !confirmed.has(record.id)) outstanding.add(record.id);
      known.add(record.id);
    }
  } else {
    for (const record of eligible) {
      const accountedFor = confirmed.has(record.id)
        || outstanding.has(record.id)
        || known.has(record.id);
      if (!accountedFor) outstanding.add(record.id);
      // Additive: KNOWN only ever grows, so nothing can be un-accounted-for and
      // then re-discovered in a loop.
      known.add(record.id);
    }
  }

  const checkpoint: PartnerDayCheckpoint = {
    version: PARTNER_DAY_CHECKPOINT_VERSION,
    confirmedRecordIds: Array.from(confirmed),
    outstandingRecordIds: Array.from(outstanding),
    knownRecordIds: Array.from(known),
  };

  /*
   * `unavailable` is forced to `false` here rather than left to fall out of
   * the comparison below, and on purpose: `usePartnerDay`'s persist effect
   * gates purely on `changed`, so this is what makes "never persist an
   * unavailable read" true by construction rather than by a caller
   * remembering a separate check. `effectiveStored` is `null` for
   * `unavailable` exactly like a genuinely missing receipt, so the comparison
   * below would otherwise report `true` and hand the caller a checkpoint that
   * looks exactly as safe to write as a real first-contact result -- which is
   * the overwrite this state exists to prevent.
   */
  const changed = transition === 'unavailable' ? false : (
    !effectiveStored
    || effectiveStored.version !== PARTNER_DAY_CHECKPOINT_VERSION
    || !sameIds(effectiveStored.confirmedRecordIds, checkpoint.confirmedRecordIds)
    || !sameIds(effectiveStored.outstandingRecordIds, checkpoint.outstandingRecordIds)
    || !sameIds(effectiveStored.knownRecordIds, checkpoint.knownRecordIds)
  );

  /*
   * THE SURFACE. `OUTSTANDING ∩ eligible(today)` and nothing else.
   *
   * No date lower bound appears here. A record outstanding since day 0 is on this
   * list on day 8, day 30 and day 400, because the only thing that removes it is
   * the user pressing the button.
   */
  const surface = eligible
    .filter((record) => outstanding.has(record.id))
    .sort(byTime);

  return { checkpoint, surface, changed, transition };
}

/**
 * THE ONLY WRITER OF CONFIRMED.
 *
 * Called from the confirm button's handler and from nowhere else. Not an effect,
 * not a loader, not a timer, not a navigation.
 *
 * `acknowledged` is the prefix the user actually had on screen. Anything else on
 * the surface stays OUTSTANDING and remains reachable on its own account --
 * including a record this device cannot decrypt, which is why it could not have
 * been part of the prefix in the first place.
 *
 * Returns `null` when nothing was consumed, so a caller that acknowledges an
 * empty list persists nothing and advances nothing.
 *
 * A record can only be confirmed if it is currently OUTSTANDING. That keeps the
 * invariant CONFIRMED ⊆ (ids that were surfaced) true structurally: a caller
 * cannot confirm a record the state machine never put in front of anyone, however
 * it computed its argument.
 */
export function acknowledgePartnerDayRecords(
  checkpoint: PartnerDayCheckpoint,
  acknowledged: DailyRecord[],
): PartnerDayCheckpoint | null {
  const outstanding = new Set(checkpoint.outstandingRecordIds);
  const consumed = acknowledged
    .map((record) => record.id)
    .filter((id) => outstanding.has(id));
  if (consumed.length === 0) return null;

  for (const id of consumed) outstanding.delete(id);

  return {
    version: PARTNER_DAY_CHECKPOINT_VERSION,
    confirmedRecordIds: Array.from(new Set([...checkpoint.confirmedRecordIds, ...consumed])),
    outstandingRecordIds: Array.from(outstanding),
    // Confirming does not change what this device knows about.
    knownRecordIds: Array.from(new Set(checkpoint.knownRecordIds)),
  };
}

/**
 * Whether the window in front of the user actually spans more than today.
 *
 * Drives copy, not filtering: a screen holding Friday's records must not be
 * titled "오늘".
 */
export function spansBeforeToday(records: DailyRecord[], todayStr: string): boolean {
  return records.some((record) => record.date < todayStr);
}

/**
 * Date context for one row of a multi-day window.
 *
 * `HH:MM` alone is a lie across days — 18:20 reads as this evening whether it was
 * today or last Tuesday. Today stays bare so the ordinary single-day case is not
 * made noisier, and older rows carry the project's date style (`8월 15일`, as in
 * `cyclePartnerMessage.ts`).
 */
export function partnerDayDateLabel(date: string, todayStr: string): string | null {
  if (date === todayStr) return null;
  const yesterday = parseLocalDate(todayStr);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === toLocalDateString(yesterday)) return '어제';
  const [, month, day] = date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}
