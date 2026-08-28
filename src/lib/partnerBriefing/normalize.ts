/**
 * Partner Briefing Normalizer (Phase A3)
 *
 * Converts A2-accepted in-memory DailyRecord references into:
 * 1. Explicit model-safe BriefingModelSafeEvent allowlist objects.
 * 2. JS-only synthetic ordinal -> recordId mappings (BriefingSourceMapping).
 * 3. JS-only synthetic dayOrdinal -> exact calendar date mappings (BriefingDayMapping).
 *
 * Architectural invariants:
 * 1. Strict chronology: sorts ascending by date, then time, then record ID as stable tie-break.
 * 2. Zero leaked metadata: Model-safe events contain strictly { ordinal, dayOrdinal, period, text, mediaKinds }.
 *    Never contains recordId, userId, coupleId, exact date/time, URLs, storage paths, key material, or health data.
 * 3. Safe text normalization: collapses control/separator whitespace into single spaces and trims without
 *    truncating, summarizing, or stripping grapheme sequences (ZWJ/ZWNJ, NFD combining characters).
 * 4. Media kind projection: projects only valid 'photo' | 'video' | 'voice' kinds, deduplicating while preserving order.
 * 5. Fail-closed chronology validation: malformed record ID, invalid date (format or impossible calendar date),
 *    or invalid time returns bounded rejection metadata { index, reason } without dropping records silently.
 * 6. Zero external runtime dependencies or legacy DailySummary imports.
 */

import type { Attachment, DailyRecord } from '@/types';
import type {
  BriefingMediaKind,
  BriefingModelSafeEvent,
  BriefingPeriod,
  BriefingSourceMapping,
} from './contract';

/**
 * JS-only mapping between a synthetic day ordinal and the exact calendar date.
 * Kept strictly on the client side; never sent across the model boundary.
 */
export interface BriefingDayMapping {
  readonly dayOrdinal: number;
  readonly date: string;
}

/**
 * Enumerated reasons for failing normalization on malformed required chronology metadata.
 */
export type BriefingNormalizeRejectionReason =
  | 'invalid_id'
  | 'invalid_date'
  | 'invalid_time';

/**
 * Bounded rejection structure emitted when normalization fails closed.
 * Contains only the input array index and the enumerated reason.
 * Excludes logs, content, IDs, timestamps, URLs, paths, or keys.
 */
export interface BriefingNormalizeRejection {
  readonly index: number;
  readonly reason: BriefingNormalizeRejectionReason;
}

/**
 * Successful normalization result containing model-safe events and JS-only mappings.
 */
export interface BriefingNormalizeSuccess {
  readonly ok: true;
  readonly events: readonly BriefingModelSafeEvent[];
  readonly sources: readonly BriefingSourceMapping[];
  readonly days: readonly BriefingDayMapping[];
}

/**
 * Failed normalization result containing a bounded rejection.
 */
export interface BriefingNormalizeFailure {
  readonly ok: false;
  readonly rejection: BriefingNormalizeRejection;
}

/**
 * Result of normalizePartnerBriefingCorpus.
 *
 * Discriminated union on `ok`:
 * - ok: true -> events, sources, days
 * - ok: false -> bounded rejection { index, reason }
 */
export type BriefingNormalizeResult =
  | BriefingNormalizeSuccess
  | BriefingNormalizeFailure;

/**
 * Validates that a record ID is a non-empty, non-whitespace string.
 */
export function isValidRecordId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Validates that a date string is strict YYYY-MM-DD format AND represents a valid calendar date.
 * Rejects impossible dates (e.g. 2026-02-30, 2026-04-31, 2025-02-29 non-leap year).
 */
export function isValidDateString(date: unknown): date is string {
  if (typeof date !== 'string') return false;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(date);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

/**
 * Validates that a time string is strict HH:mm format with 00-23 hours and 00-59 minutes.
 */
export function isValidTimeString(time: unknown): time is string {
  if (typeof time !== 'string') return false;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/**
 * Maps a strictly validated HH:mm time string into a coarse BriefingPeriod.
 *
 * Boundaries:
 * - night: 00:00-04:59 and 22:00-23:59
 * - morning: 05:00-11:59
 * - afternoon: 12:00-17:59
 * - evening: 18:00-21:59
 */
export function getBriefingPeriod(time: string): BriefingPeriod {
  const hour = parseInt(time.slice(0, 2), 10);
  if ((hour >= 0 && hour <= 4) || (hour >= 22 && hour <= 23)) {
    return 'night';
  }
  if (hour >= 5 && hour <= 11) {
    return 'morning';
  }
  if (hour >= 12 && hour <= 17) {
    return 'afternoon';
  }
  if (hour >= 18 && hour <= 21) {
    return 'evening';
  }
  return 'night';
}

function isControlOrWhitespaceCode(code: number): boolean {
  // C0 controls and ASCII DEL
  if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) return true;
  // C1 controls
  if (code >= 0x80 && code <= 0x9f) return true;
  // ASCII space
  if (code === 0x20) return true;
  // Unicode separators/whitespace (excluding ZWNJ 0x200C and ZWJ 0x200D)
  if (
    code === 0x00a0 ||
    code === 0x1680 ||
    code === 0x200b || // ZERO WIDTH SPACE (separator)
    code === 0x200e || // LEFT-TO-RIGHT MARK (separator)
    code === 0x200f || // RIGHT-TO-LEFT MARK (separator)
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  ) {
    return true;
  }
  return false;
}

/**
 * Normalizes record log text by collapsing control and separator whitespace into single spaces and trimming.
 * Does NOT truncate, summarize, infer, or add fallback prose.
 * Preserves grapheme clusters, ZWJ/ZWNJ emoji sequences, and NFD combining characters.
 */
export function normalizeBriefingText(log?: string | null): string {
  if (typeof log !== 'string' || log.length === 0) {
    return '';
  }

  let result = '';
  let inWhitespace = false;

  for (let i = 0; i < log.length; i += 1) {
    const code = log.charCodeAt(i);
    if (isControlOrWhitespaceCode(code)) {
      if (!inWhitespace && result.length > 0) {
        result += ' ';
        inWhitespace = true;
      }
    } else {
      result += log[i];
      inWhitespace = false;
    }
  }

  if (result.endsWith(' ')) {
    return result.slice(0, -1);
  }
  return result;
}

/**
 * Projects attachments into deduplicated BriefingMediaKind list ('photo' | 'video' | 'voice').
 * Preserves first occurrence order. Ignores unknown types and excludes names, URLs, and storage paths.
 */
export function projectBriefingMediaKinds(
  attachments?: readonly Attachment[] | null,
): readonly BriefingMediaKind[] {
  if (!attachments || !Array.isArray(attachments)) {
    return [];
  }
  const kinds: BriefingMediaKind[] = [];
  for (const att of attachments) {
    if (!att || typeof att !== 'object') continue;
    const type = att.type;
    if (type === 'photo' || type === 'video' || type === 'voice') {
      if (!kinds.includes(type)) {
        kinds.push(type);
      }
    }
  }
  return kinds;
}

/**
 * Normalizes accepted DailyRecord corpus references into model-safe events and JS-only mappings.
 *
 * Invariants:
 * - Requires valid record ID, calendar date, and 24h time for every record; fails closed on malformed metadata.
 * - Sorts chronologically ascending by date, then time, then record ID as tie-break.
 * - Assigns source ordinal 0..N-1 and dayOrdinal 0..D-1 across distinct dates.
 * - Emits model-safe events containing strictly { ordinal, dayOrdinal, period, text, mediaKinds }.
 * - Returns JS-only source mapping (ordinal -> recordId) and day mapping (dayOrdinal -> date).
 */
export function normalizePartnerBriefingCorpus(
  records: readonly DailyRecord[],
): BriefingNormalizeResult {
  // 1. Validate required chronology metadata in original input order
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record || typeof record !== 'object') {
      return { ok: false, rejection: { index: i, reason: 'invalid_id' } };
    }
    if (!isValidRecordId(record.id)) {
      return { ok: false, rejection: { index: i, reason: 'invalid_id' } };
    }
    if (!isValidDateString(record.date)) {
      return { ok: false, rejection: { index: i, reason: 'invalid_date' } };
    }
    if (!isValidTimeString(record.time)) {
      return { ok: false, rejection: { index: i, reason: 'invalid_time' } };
    }
  }

  // 2. Chronological sorting: date ASC -> time ASC -> record.id ASC
  const sorted = [...records].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    if (a.time !== b.time) {
      return a.time < b.time ? -1 : 1;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });

  // 3. Day ordinals and JS-only day mappings across distinct ascending dates
  const distinctDates: string[] = [];
  const dateToDayOrdinal = new Map<string, number>();

  for (const record of sorted) {
    if (!dateToDayOrdinal.has(record.date)) {
      const dayOrdinal = distinctDates.length;
      dateToDayOrdinal.set(record.date, dayOrdinal);
      distinctDates.push(record.date);
    }
  }

  const days: BriefingDayMapping[] = distinctDates.map((date, dayOrdinal) => ({
    dayOrdinal,
    date,
  }));

  // 4. Model-safe event allowlist projection and JS-only source mappings
  const events: BriefingModelSafeEvent[] = [];
  const sources: BriefingSourceMapping[] = [];

  for (let ordinal = 0; ordinal < sorted.length; ordinal += 1) {
    const record = sorted[ordinal];
    const dayOrdinal = dateToDayOrdinal.get(record.date)!;
    const period = getBriefingPeriod(record.time);
    const text = normalizeBriefingText(record.log);
    const mediaKinds = projectBriefingMediaKinds(record.attachments);

    events.push({
      ordinal,
      dayOrdinal,
      period,
      text,
      mediaKinds,
    });

    sources.push({
      ordinal,
      recordId: record.id,
    });
  }

  return {
    ok: true,
    events,
    sources,
    days,
  };
}
