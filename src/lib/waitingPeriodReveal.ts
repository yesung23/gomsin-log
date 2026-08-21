import type { DailyRecord } from '@/types';

/**
 * PRODUCT_V3 §7.6 — records written before the partner arrived.
 *
 * A couple space exists from the moment an invite code is minted, so entries
 * accumulate for days before anyone can read them. §7.6 forbids sharing those
 * automatically when the partner joins and requires the app to ASK ONCE, turning
 * over only what the author picks.
 *
 * ## Why there is no "already asked" flag anywhere
 *
 * The obvious way to implement "once" is to remember having asked. That would
 * mean a new persisted fact -- either a column nobody needs after the first week,
 * or an entry on the device-preference whitelist that is pinned by a test
 * BECAUSE anything on it survives a purge and outlives account deletion.
 *
 * Neither is worth it, because the join time already answers the question.
 * `couple_members.joined_at` is canonical, it has existed since migration 001,
 * and an active member may read the partner's row. So "once" is expressed as a
 * WINDOW measured from that fact: the prompt is offered in the days right after
 * connecting, and then it stops. Nothing is written to make that true.
 *
 * What the window is NOT: a deadline on the records. They stay private and stay
 * turnable-over from the record itself, forever. The window only bounds the
 * unprompted offer, which is the part §7.6 asks to happen once.
 *
 * ## Why the candidate set is what it is
 *
 * A private record written before the join. That set includes entries someone
 * deliberately kept private during the wait, and it cannot distinguish them --
 * nothing recorded WHY a record is private. Showing them anyway is the safe
 * direction and the one §7.6 describes: it asks, and the default answer is no.
 * Deciding for the user in either direction is what the section forbids.
 */

/** How long after connecting the app offers the prompt without being asked. */
export const REVEAL_WINDOW_DAYS = 7;

export interface RevealCandidate {
  recordId: string;
  date: string;
  time: string;
  /** The author's own text, shown so they can decide. Never leaves the device. */
  preview: string;
}

export interface RevealOffer {
  /** Whether to show the prompt at all. */
  offered: boolean;
  candidates: RevealCandidate[];
}

/**
 * What to offer, given the records this client already holds.
 *
 * Pure, and takes `now` so the window boundary is testable rather than being a
 * thing that only misbehaves at midnight.
 *
 * `partnerJoinedAt` being absent means the join time is not known yet -- a fetch
 * still in flight, or an older row. Offering nothing is the correct answer to
 * "should I ask?" when the app cannot tell which records predate the partner:
 * the alternative is asking about entries written after they arrived, which
 * would be the app inventing a waiting period that did not happen.
 */
export function buildRevealOffer(input: {
  records: DailyRecord[];
  /** Absent before the profile has an id; nothing is offered without one. */
  viewerUserId: string | undefined;
  partnerJoinedAt: string | undefined;
  now?: Date;
}): RevealOffer {
  const { records, viewerUserId, partnerJoinedAt } = input;
  const now = input.now ?? new Date();

  if (!partnerJoinedAt || !viewerUserId) return { offered: false, candidates: [] };

  const joined = Date.parse(partnerJoinedAt);
  if (!Number.isFinite(joined)) return { offered: false, candidates: [] };

  const elapsedDays = (now.getTime() - joined) / 86_400_000;
  // A negative elapsed time means the clocks disagree. Not an error worth
  // surfacing, but not a reason to prompt either.
  if (elapsedDays < 0 || elapsedDays > REVEAL_WINDOW_DAYS) {
    return { offered: false, candidates: [] };
  }

  const candidates = records
    .filter((record) => (
      record.userId === viewerUserId
      && record.isPrivate === true
      // `createdAt` rather than the record's own date: someone can back-date an
      // entry, and what decides this is when it was WRITTEN relative to the join.
      && Number.isFinite(Date.parse(record.createdAt))
      && Date.parse(record.createdAt) < joined
    ))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((record) => ({
      recordId: record.id,
      date: record.date,
      time: record.time,
      preview: record.log?.trim()
        || (record.attachments?.length ? '사진으로 남긴 순간' : '남긴 순간'),
    }));

  return { offered: candidates.length > 0, candidates };
}
