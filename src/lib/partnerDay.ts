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

export interface PartnerDayCheckpoint {
  /**
   * Records this viewer explicitly acknowledged. Identity is the record id
   * (§7.5 "원본 동일성"), never date/time, so an edited record stays acknowledged
   * and a re-dated one is not silently re-surfaced.
   */
  confirmedRecordIds: string[];
  /**
   * Local date of the newest acknowledged record — the window's inclusive lower
   * bound. Inclusive rather than exclusive because more records can arrive later
   * on that same day, and those were never seen.
   */
  confirmedThrough: string;
  /** When the acknowledgement happened. Ordering/diagnostics only. */
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
    return {
      confirmedRecordIds: Array.from(new Set(candidate.confirmedRecordIds)).slice(-500),
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
      confirmedRecordIds: Array.from(new Set(checkpoint.confirmedRecordIds)).slice(-500),
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
  return visibleRecordsForViewer(records, viewer)
    .filter((record) => !isOwnRecord(record, viewer)
      && !record.isPrivate
      && record.date >= since
      && record.date <= until
      && !confirmed.has(record.id))
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

  return {
    confirmedRecordIds: Array.from(new Set([
      ...(previous?.confirmedRecordIds ?? []),
      ...acknowledged.map((record) => record.id),
    ])),
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
