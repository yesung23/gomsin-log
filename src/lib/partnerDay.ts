import type { DailyRecord } from '@/types';
import { isOwnRecord, visibleRecordsForViewer, type Viewer } from '@/lib/privacy';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';

/**
 * "마지막 확인 이후 놓친 구간" — the missed-context window for the partner's day.
 *
 * PRODUCT_V3 §6.5 rule 2 states the interval exactly: `마지막 확인점 이후, 없으면
 * 최근 7일, 상한 오늘`. This module owns that one sentence so the two surfaces that
 * claim to describe the partner's day (`PartnerDayTimelineWidget` and the
 * `CareHintWidget` inside the call briefing) cannot drift apart on what "missed"
 * means. An earlier version computed the window inline in each widget and the two
 * disagreed within one release.
 *
 * The checkpoint is deliberately NOT server truth and never affects authorization.
 * It is a device-local read receipt, keyed the same way `callBriefing.ts` and
 * `sensitiveConsent.ts` key theirs: by viewer AND couple. A checkpoint belongs to
 * one person looking at one relationship, so signing in as someone else, or
 * relinking with someone else, must not suppress their unseen context.
 */

/** §6.5: the window when this viewer has no checkpoint at all, today included. */
export const PARTNER_DAY_FALLBACK_DAYS = 7;

/**
 * How many ids a receipt keeps. Both lists are bounded the same way and both
 * evict oldest-first, which is safe in one direction only -- see the note on
 * `observedRecordIds`.
 */
export const CHECKPOINT_ID_LIMIT = 500;

export interface PartnerDayCheckpoint {
  /**
   * Records this viewer explicitly acknowledged. Identity is the record id
   * (§7.5 "원본 동일성"), never date/time, so an edited record stays acknowledged
   * and a re-dated one is not silently re-surfaced.
   */
  confirmedRecordIds: string[];
  /**
   * Shared partner records this viewer was already entitled to SEE when the
   * receipt was written. Not acknowledgement, not authorization, not server
   * truth, and not proof anything was read. It answers exactly one question:
   * was this record already in front of this client at the last checkpoint, or
   * did it show up afterwards?
   *
   * That distinction is what rescues a late arrival. A record composed offline
   * on the 16th and flushed on the 19th carries `date: 2026-08-16`, so a date
   * bound set to the 18th hides it forever even though nobody ever saw it. The
   * same shape occurs with no offline involvement at all when the partner's
   * timezone is behind the viewer's.
   *
   * Deliberately NOT solved by comparing `record.createdAt` against
   * `confirmedAt`: the first is stamped by Postgres and the second by this
   * device, so the comparison mixes two clocks and silently loses records
   * whenever the viewer's device runs ahead of the server. Ids have no clock.
   *
   * Optional. A receipt written before this field existed simply has none, and
   * absence is read as "nothing is known to have been observed", which shows
   * more context rather than less.
   */
  observedRecordIds?: string[];
  /**
   * Local date of the newest acknowledged record — the window's inclusive lower
   * bound. Inclusive rather than exclusive because more records can arrive later
   * on that same day, and those were never seen.
   */
  confirmedThrough: string;
  /**
   * When the acknowledgement happened. DIAGNOSTICS AND ORDERING ONLY.
   *
   * This is a client wall clock and no correctness decision may depend on it.
   * Nothing in this module compares it against a server-generated timestamp.
   */
  confirmedAt: string;
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

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(parseLocalDate(value).getTime());
}

export function readPartnerDayCheckpoint(
  userId: string,
  coupleId: string,
): PartnerDayCheckpoint | null {
  if (typeof localStorage === 'undefined' || !userId || !coupleId) return null;
  try {
    const value = localStorage.getItem(partnerDayCheckpointKey(userId, coupleId));
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.confirmedRecordIds)
      || !candidate.confirmedRecordIds.every((id) => typeof id === 'string')
      || !isValidDateString(candidate.confirmedThrough)
      || typeof candidate.confirmedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.confirmedAt))) return null;
    // Absent or malformed observation is left ABSENT rather than defaulted to an
    // empty array, and the two are not the same thing: absent means "this receipt
    // cannot say what was already visible" and reopens old records, while an empty
    // array is a real snapshot that happened to contain nothing.
    const observed = Array.isArray(candidate.observedRecordIds)
      && candidate.observedRecordIds.every((id) => typeof id === 'string')
      ? Array.from(new Set(candidate.observedRecordIds)).slice(-CHECKPOINT_ID_LIMIT)
      : undefined;
    return {
      confirmedRecordIds: Array.from(new Set(candidate.confirmedRecordIds))
        .slice(-CHECKPOINT_ID_LIMIT),
      ...(observed ? { observedRecordIds: observed } : {}),
      confirmedThrough: candidate.confirmedThrough,
      confirmedAt: candidate.confirmedAt,
    };
  } catch {
    // A corrupt receipt must degrade to "nothing was confirmed", which shows MORE
    // context. Failing the other way would hide records the viewer never saw.
    return null;
  }
}

export function writePartnerDayCheckpoint(
  userId: string,
  coupleId: string,
  checkpoint: PartnerDayCheckpoint,
): boolean {
  if (typeof localStorage === 'undefined'
    || !userId
    || !coupleId
    || !isValidDateString(checkpoint.confirmedThrough)
    || !Number.isFinite(Date.parse(checkpoint.confirmedAt))) return false;
  try {
    localStorage.setItem(partnerDayCheckpointKey(userId, coupleId), JSON.stringify({
      confirmedRecordIds: Array.from(new Set(checkpoint.confirmedRecordIds))
        .slice(-CHECKPOINT_ID_LIMIT),
      ...(checkpoint.observedRecordIds
        ? {
          observedRecordIds: Array.from(new Set(checkpoint.observedRecordIds))
            .slice(-CHECKPOINT_ID_LIMIT),
        }
        : {}),
      confirmedThrough: checkpoint.confirmedThrough,
      confirmedAt: checkpoint.confirmedAt,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The interval, straight from §6.5 rule 2.
 *
 * The upper bound matters as much as the lower one: a record dated in the future
 * — a wrong device clock, or a hand-edited date — is not missed context, and
 * `date >= since` alone would pull it in and pin it to the top of the window.
 */
export function partnerDayWindow(
  checkpoint: PartnerDayCheckpoint | null | undefined,
  todayStr: string,
): PartnerDayWindow {
  if (checkpoint) {
    // A checkpoint dated after today (clock change, restored backup) would
    // silently swallow the whole window, so it cannot raise the lower bound
    // past today.
    return {
      since: checkpoint.confirmedThrough > todayStr ? todayStr : checkpoint.confirmedThrough,
      until: todayStr,
    };
  }
  const start = parseLocalDate(todayStr);
  start.setDate(start.getDate() - (PARTNER_DAY_FALLBACK_DAYS - 1));
  return { since: toLocalDateString(start), until: todayStr };
}

/**
 * Everything this viewer is entitled to see of their partner's shared day.
 *
 * The single privacy gate for this module. Both the missed-context window and the
 * observation snapshot go through it, so a record can never be recorded as
 * "observed" that the viewer was not allowed to see in the first place -- which
 * would put a private record's id into a receipt and let its existence influence
 * what the partner is shown.
 */
export function visibleSharedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
): DailyRecord[] {
  return visibleRecordsForViewer(records, viewer)
    .filter((record) => !isOwnRecord(record, viewer) && !record.isPrivate);
}

/**
 * The partner's shared records this viewer has not yet acknowledged, oldest first.
 *
 * Privacy stays exactly where it already was: `visibleRecordsForViewer` decides
 * what this viewer may see at all, and own/private records are dropped on top of
 * it. Widening the time window must not widen authorization, so nothing here
 * relaxes a predicate — the only additional filters are subtractive.
 */
export function missedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
  todayStr: string,
  checkpoint?: PartnerDayCheckpoint | null,
): DailyRecord[] {
  const { since, until } = partnerDayWindow(checkpoint, todayStr);
  const confirmed = new Set(checkpoint?.confirmedRecordIds ?? []);
  const observed = checkpoint?.observedRecordIds
    ? new Set(checkpoint.observedRecordIds)
    : null;

  return visibleSharedPartnerRecords(records, viewer)
    .filter((record) => {
      // Acknowledged is acknowledged, whatever its date. Checked first so a
      // record can never be reopened by the late-arrival path below.
      if (confirmed.has(record.id)) return false;
      // §6.5 "상한 오늘". Applies to newly observed records too: a future date is
      // not missed context however recently it appeared.
      if (record.date > until) return false;
      if (record.date >= since) return true;

      /*
       * Older than the bound. Ordinarily that means the viewer already had their
       * chance at it, but not if it was not there to be had. A record that was
       * not part of what this client could see at the last checkpoint has never
       * been in front of anyone, so the bound was set without it in view and must
       * not be read as a verdict on it.
       *
       * With no checkpoint at all the fallback window governs alone -- there is no
       * observation to compare against, and reaching further back would defeat
       * §6.5's seven-day rule.
       */
      if (!checkpoint) return false;
      return !observed || !observed.has(record.id);
    })
    .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
}

/**
 * Build the receipt for an explicit acknowledgement of `acknowledged`.
 *
 * Two things set the next lower bound, and the SMALLER of them wins.
 *
 * `acknowledged` is the chronological prefix the viewer actually had on screen,
 * so its newest date is as far as consumption can honestly be claimed.
 *
 * `stillMissed` is everything else in the window -- including records this device
 * cannot decrypt yet, which is why the caller must pass those rather than only the
 * readable remainder. An unreadable record is invisible to the prefix but is NOT
 * consumed, and the bound is date-granular, so advancing past it would hide it for
 * good the moment its key arrived. Concretely: a locked record on the 15th
 * followed by readable ones on the 16th and 17th used to push the bound to the
 * 17th, and the 15th never came back.
 *
 * The bound therefore stops at the earliest thing still outstanding. Acknowledged
 * records are held out by id regardless, so keeping the date back costs at most a
 * second sighting -- and this module's whole rule is that showing a record twice
 * is cheaper than losing one that was never seen.
 */
export function advancePartnerDayCheckpoint(
  previous: PartnerDayCheckpoint | null | undefined,
  acknowledged: DailyRecord[],
  stillMissed: DailyRecord[] = [],
  observable: { records: DailyRecord[]; viewer: Viewer } | null = null,
  now: Date = new Date(),
): PartnerDayCheckpoint | null {
  if (acknowledged.length === 0) return null;
  const newestAcknowledged = acknowledged.reduce(
    (latest, record) => (record.date > latest ? record.date : latest),
    acknowledged[0].date,
  );
  const acknowledgedIds = new Set(acknowledged.map((record) => record.id));
  const outstanding = stillMissed.filter((record) => !acknowledgedIds.has(record.id));
  const earliestOutstanding = outstanding.length > 0
    ? outstanding.reduce(
      (earliest, record) => (record.date < earliest ? record.date : earliest),
      outstanding[0].date,
    )
    : null;

  /*
   * Snapshot, not accumulation: what this client can see RIGHT NOW. Filtered
   * again through the module's own privacy gate rather than trusting the caller,
   * so a private record's id cannot reach the receipt even by mistake.
   *
   * Left undefined when no snapshot is supplied. Absent observation reopens old
   * records, which is the harmless direction; inventing an empty snapshot would
   * instead claim nothing was visible, and inventing a full one would claim
   * everything was.
   */
  const observedRecordIds = observable
    ? Array.from(new Set(
      visibleSharedPartnerRecords(observable.records, observable.viewer)
        .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`))
        .map((record) => record.id),
    )).slice(-CHECKPOINT_ID_LIMIT)
    : undefined;

  return {
    // Capped here as well as on write, so what this render believes and what a
    // reload would believe cannot drift. Both directions of the cap only ever
    // drop an EXCLUSION, so eviction can add a second sighting and never remove
    // a record.
    confirmedRecordIds: Array.from(new Set([
      ...(previous?.confirmedRecordIds ?? []),
      ...acknowledged.map((record) => record.id),
    ])).slice(-CHECKPOINT_ID_LIMIT),
    ...(observedRecordIds ? { observedRecordIds } : {}),
    // Deliberately NOT floored at the previous bound. Acknowledging a late-arriving
    // older record does reopen the days it sits in -- but everything already seen
    // in those days is held out by id, so what comes back is exactly what was never
    // acknowledged. That is the direction this module is required to fail in.
    confirmedThrough: earliestOutstanding && earliestOutstanding < newestAcknowledged
      ? earliestOutstanding
      : newestAcknowledged,
    confirmedAt: now.toISOString(),
  };
}

/**
 * Whether the window in front of the viewer actually spans more than today.
 *
 * Drives copy, not filtering: a window that is technically seven days wide but
 * contains only today's records is a today screen and should say so, while a
 * screen holding Friday's records must not be titled "오늘".
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
