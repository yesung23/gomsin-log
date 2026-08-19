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
   * Records that were on the missed surface at the last acknowledgement and were
   * NOT acknowledged -- the remainder past the visible prefix, and anything this
   * device could not decrypt and therefore could not show.
   *
   * These stay reachable on their own account. They do not depend on a date, so
   * nothing about them can be lost by a bound moving.
   */
  outstandingRecordIds: string[];
  /**
   * Every ELIGIBLE shared partner record this client already knew existed when the
   * receipt was written -- authorized, not private, not the viewer's own, and not
   * future-dated.
   *
   * Read the name carefully: it does NOT mean the viewer saw this record on the
   * missed surface. A first-ever visit shows only the seven-day fallback, yet a
   * two-year history that is already in local state is recorded here, and that is
   * deliberate -- without it, every one of those old records would later look like
   * a late arrival and flood the surface the moment a receipt existed. What it
   * claims is narrower and checkable: this client knew of the record.
   *
   * The domain matters as much as the meaning. It is built from
   * `eligibleSharedPartnerRecords`, the same function the surface uses, so it can
   * never range wider than what could have been shown. It previously applied only
   * the privacy gate, which let a future-dated record be recorded as known before
   * it was ever eligible -- and once its date arrived it was unconfirmed, not
   * outstanding, and observed, which means gone for good. That is what tells a genuine late
   * arrival -- an offline backlog stamped with its compose date, or a partner in
   * a timezone behind the viewer -- apart from ordinary history.
   *
   * Deliberately not solved by comparing `record.createdAt` with `confirmedAt`:
   * the first is stamped by Postgres and the second by this device, so the
   * comparison mixes two clocks and loses records whenever the viewer's runs
   * ahead. Ids have no clock.
   */
  observedRecordIds: string[];
  /**
   * When the acknowledgement happened. DIAGNOSTICS AND ORDERING ONLY.
   *
   * A client wall clock. No correctness decision may read it, and nothing here
   * compares it against a server-generated timestamp.
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

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return null;
  return Array.from(new Set(value as string[]));
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

    const confirmed = stringArray(candidate.confirmedRecordIds);
    if (!confirmed
      || typeof candidate.confirmedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.confirmedAt))) return null;

    /*
     * A receipt written before this shape existed has no outstanding or observed
     * set, and there is no honest way to reconstruct them -- so they are left
     * empty, which `missedPartnerRecords` reads as "attests to nothing" and
     * reopens everything unconfirmed once. This local state never shipped, so it
     * gets no migration machinery; it gets the safe direction.
     */
    return {
      confirmedRecordIds: confirmed,
      outstandingRecordIds: stringArray(candidate.outstandingRecordIds) ?? [],
      observedRecordIds: stringArray(candidate.observedRecordIds) ?? [],
      confirmedAt: candidate.confirmedAt,
    };
  } catch {
    // A corrupt receipt degrades to "nothing was confirmed", which shows MORE
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
    || !stringArray(checkpoint.confirmedRecordIds)
    || !stringArray(checkpoint.outstandingRecordIds)
    || !stringArray(checkpoint.observedRecordIds)
    || !Number.isFinite(Date.parse(checkpoint.confirmedAt))) return false;
  try {
    localStorage.setItem(partnerDayCheckpointKey(userId, coupleId), JSON.stringify({
      confirmedRecordIds: Array.from(new Set(checkpoint.confirmedRecordIds)),
      outstandingRecordIds: Array.from(new Set(checkpoint.outstandingRecordIds)),
      observedRecordIds: Array.from(new Set(checkpoint.observedRecordIds)),
      confirmedAt: checkpoint.confirmedAt,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * The window for a viewer with no usable receipt: §6.5's "없으면 최근 7일, 상한 오늘".
 *
 * This is the ONLY place a date decides what is missed. Once a receipt exists the
 * decision is made from record ids, because a date bound cannot express the
 * difference between "already seen this" and "never had the chance" -- and every
 * attempt to make it do so produced a defect. The last one rolled the bound
 * backwards to cover an outstanding record and dragged the entire observed history
 * back onto the screen with it.
 */
export function partnerDayFallbackWindow(todayStr: string): PartnerDayWindow {
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
 * THE eligibility domain: what may appear on this surface, or be recorded as
 * known to it, on a given day.
 *
 * Both `missedPartnerRecords` and the OBSERVED snapshot go through this one
 * function, and that is the whole point of its existing. When the two computed
 * their own domains, OBSERVED ranged wider than the surface: it applied only the
 * privacy gate, so a record withheld for being future-dated was still recorded as
 * "already known". The day its date arrived it was eligible, unconfirmed, not
 * outstanding, and observed -- which means hidden, permanently, without anyone
 * having acknowledged it. Deriving both from one domain makes
 *
 *     OBSERVED ⊆ ELIGIBLE
 *
 * true by construction rather than by two functions agreeing.
 *
 * `todayStr` is passed in, never derived here. It must be the same viewer-local
 * date the surface is already using; computing it from a clock would put a clock
 * back into a correctness decision.
 */
export function eligibleSharedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
  todayStr: string,
): DailyRecord[] {
  // §6.5 "상한 오늘". A date that has not arrived is not missed context, and it is
  // not something this client can claim to have known about either.
  return visibleSharedPartnerRecords(records, viewer)
    .filter((record) => record.date <= todayStr);
}

/**
 * The partner's shared records this viewer has not yet dealt with, oldest first.
 *
 * Three facts are tracked separately because collapsing them is what kept
 * producing defects. A record is CONFIRMED (explicitly acknowledged), OUTSTANDING
 * (already surfaced, not yet acknowledged), or OBSERVED (this client knew of it at
 * the last receipt). A single date lower bound cannot represent all three, and
 * each attempt to make it try lost or resurrected something.
 *
 * Authorization is settled before any of this, so no classification can widen it.
 */
export function missedPartnerRecords(
  records: DailyRecord[],
  viewer: Viewer,
  todayStr: string,
  checkpoint?: PartnerDayCheckpoint | null,
): DailyRecord[] {
  const byTime = (a: DailyRecord, b: DailyRecord) =>
    `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`);

  const eligible = eligibleSharedPartnerRecords(records, viewer, todayStr);

  if (!checkpoint) {
    const { since } = partnerDayFallbackWindow(todayStr);
    return eligible.filter((record) => record.date >= since).sort(byTime);
  }

  const confirmed = new Set(checkpoint.confirmedRecordIds);
  const outstanding = new Set(checkpoint.outstandingRecordIds);
  /*
   * An EMPTY observation attests to nothing, which is exactly the reading a
   * receipt from before this field existed needs: everything unconfirmed comes
   * back once and the next acknowledgement writes a real snapshot. No special
   * case is required for it -- an empty set answers `has()` with false for every
   * id, so the rescue below fires on its own. An earlier version wrote that
   * special case out as a null branch; it could never change any answer.
   */
  const observed = new Set(checkpoint.observedRecordIds);

  return eligible
    .filter((record) => {
      if (confirmed.has(record.id)) return false;
      if (outstanding.has(record.id)) return true;
      if (!observed.has(record.id)) return true;
      // Observed before, never outstanding, never confirmed: this viewer has had
      // it in front of them and moved past it. Nothing may bring it back.
      return false;
    })
    .sort(byTime);
}

/**
 * The receipt after an explicit acknowledgement. The only transition there is.
 *
 * `acknowledged` is the chronological prefix the viewer actually had on screen;
 * `currentMissed` is the whole surface it was a prefix of. Everything in the
 * second that is not in the first stays OUTSTANDING and remains reachable on its
 * own account -- including records this device could not decrypt, which is why
 * the caller passes the full window and not just the readable part.
 *
 * An empty acknowledgement returns `null`: nothing was consumed, so there is no
 * receipt to write. The caller treats a null result as "do not persist, do not
 * advance", which keeps loading or rendering data from ever standing in for a
 * person confirming they read it.
 */
export function advancePartnerDayCheckpoint(
  previous: PartnerDayCheckpoint | null | undefined,
  acknowledged: DailyRecord[],
  currentMissed: DailyRecord[] = [],
  observable: { records: DailyRecord[]; viewer: Viewer; todayStr: string } | null = null,
  now: Date = new Date(),
): PartnerDayCheckpoint | null {
  if (acknowledged.length === 0) return null;

  const acknowledgedIds = new Set(acknowledged.map((record) => record.id));

  return {
    confirmedRecordIds: Array.from(new Set([
      ...(previous?.confirmedRecordIds ?? []),
      ...acknowledgedIds,
    ])),
    outstandingRecordIds: currentMissed
      .map((record) => record.id)
      .filter((id) => !acknowledgedIds.has(id)),
    /*
     * A snapshot of what this client can see now, filtered through this module's
     * own privacy gate rather than trusting the caller -- a private or own record's
     * id must never reach a receipt.
     *
     * Uncapped. Truncating it was a real defect: an id dropped to save space is
     * indistinguishable from one never seen, so compaction manufactured "never
     * observed" verdicts and the surface reopened records the viewer had already
     * dealt with.
     */
    observedRecordIds: observable
      ? Array.from(new Set(
        eligibleSharedPartnerRecords(observable.records, observable.viewer, observable.todayStr)
          .map((record) => record.id),
      ))
      : [],
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
