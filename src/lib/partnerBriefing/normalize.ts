/**
 * Partner Briefing Normalizer (Phase A3)
 *
 * Converts A2-accepted in-memory DailyRecord references into:
 * 1. Explicit model-safe BriefingModelSafeEvent allowlist objects.
 * 2. JS-only synthetic ordinal -> recordId mappings (BriefingSourceMapping).
 * 3. JS-only synthetic dayOrdinal -> exact calendar date mappings (BriefingDayMapping).
 *
 * Architectural invariants:
 * 1. Strict chronology: sorts ascending by date, then exact instant (hour, minute, second,
 *    fractional seconds), then record ID as stable tie-break. `HH:mm` and `HH:mm:00` denote the
 *    same instant and therefore fall through to the record-ID tie-break.
 * 2. Zero leaked metadata: Model-safe events contain strictly { ordinal, dayOrdinal, period, text, mediaKinds }.
 *    Never contains recordId, userId, coupleId, exact date/time, URLs, storage paths, key material, or health data.
 * 3. Safe text normalization: collapses control/separator whitespace into single spaces and trims without
 *    truncating, summarizing, or stripping grapheme sequences (ZWJ/ZWNJ, NFD combining characters).
 * 4. Media kind projection: projects only valid 'photo' | 'video' | 'voice' kinds, deduplicating while preserving order.
 * 5. Fail-closed chronology validation: malformed record ID, invalid date (format or impossible calendar date),
 *    or invalid time returns bounded rejection metadata { index, reason } without dropping records silently.
 * 7. PostgreSQL TIME tolerance: `time` may arrive as `HH:mm`, `HH:mm:ss`, or `HH:mm:ss.fraction`
 *    depending on whether it came from a client-written string or straight out of a `time` column.
 *    All three are accepted and canonicalized to `HH:mm` for period bucketing; seconds and
 *    fractional seconds are kept for ordering only and never reach the model payload.
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
 * A parsed record time, canonicalized for the briefing pipeline.
 *
 * JS-only: this never crosses the model boundary. `canonical` is the only field period
 * bucketing may read; `second` / `fraction` exist purely so that ordering does not lose
 * sub-minute precision that a PostgreSQL `time` column can carry.
 *
 * `fraction` holds the fractional-second digits with trailing zeros stripped, so that
 * `.5`, `.50` and `.500000` compare equal and `09:07`, `09:07:00` and `09:07:00.000`
 * all denote the same instant. At most six digits survive parsing (PostgreSQL's
 * microsecond limit); a longer fraction is rejected outright rather than truncated.
 */
export interface BriefingCanonicalTime {
  /** Canonical `HH:mm`, zero-padded. The sole input to period bucketing. */
  readonly canonical: string;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Fractional-second digits, trailing zeros stripped; '' when absent or all-zero. */
  readonly fraction: string;
}

/**
 * Strict 24h time grammar covering every form a record's `time` can legitimately take:
 * `HH:mm` (written by this app) and `HH:mm:ss` / `HH:mm:ss.fraction` (returned verbatim by
 * PostgREST for a `time` column).
 *
 * The fraction is capped at SIX digits because that is PostgreSQL's own limit: `time` is
 * stored as microseconds since midnight, so no `time` column can produce a seventh digit.
 * An unbounded `\d+` accepted strings the database cannot emit, which means it accepted
 * input from somewhere other than the column this parser exists to read -- and did so
 * silently. Anything longer now fails closed like any other malformed value.
 *
 * Deliberately rejected: single-digit hours (`9:00`), `24:00:00`, out-of-range minutes
 * (`12:60:00`) and seconds (`12:00:60`), an empty fraction (`12:00:00.`), a fraction of
 * seven or more digits (`12:00:00.1234567`), and any timezone suffix (`12:00:00Z`,
 * `12:00:00+09:00`) — a `time with time zone` value has no single meaning here and must
 * fail closed rather than be silently reinterpreted as local time.
 */
const BRIEFING_TIME_PATTERN =
  /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/;

/**
 * Parses and canonicalizes a record time, or returns null if it is not a valid 24h time.
 * Pure: never mutates or reformats the caller's value.
 */
export function parseBriefingTime(time: unknown): BriefingCanonicalTime | null {
  if (typeof time !== 'string') return null;
  const match = BRIEFING_TIME_PATTERN.exec(time);
  if (!match) return null;

  const [, hh, mm, ss, frac] = match;
  return {
    canonical: `${hh}:${mm}`,
    hour: parseInt(hh, 10),
    minute: parseInt(mm, 10),
    second: ss === undefined ? 0 : parseInt(ss, 10),
    fraction: frac === undefined ? '' : frac.replace(/0+$/, ''),
  };
}

/**
 * Validates that a time string is a strict 24h `HH:mm`, `HH:mm:ss`, or `HH:mm:ss.fraction`
 * value with hours 00-23, minutes 00-59, and seconds 00-59.
 */
export function isValidTimeString(time: unknown): time is string {
  return parseBriefingTime(time) !== null;
}

/**
 * Compares two fractional-second digit strings of possibly different precision.
 * Right-padding with zeros makes an equal-length lexicographic compare exact, with no
 * float rounding, across every precision PostgreSQL can emit (one to six digits).
 */
function compareFractionDigits(a: string, b: string): number {
  if (a === b) return 0;
  const width = Math.max(a.length, b.length);
  const paddedA = a.padEnd(width, '0');
  const paddedB = b.padEnd(width, '0');
  if (paddedA === paddedB) return 0;
  return paddedA < paddedB ? -1 : 1;
}

/**
 * Orders two canonical times by exact instant, preserving seconds and fractional precision.
 * Returns 0 for times that denote the same instant across different textual precisions
 * (`09:07` vs `09:07:00`), leaving the caller's record-ID tie-break to stabilize them.
 */
export function compareBriefingTime(
  a: BriefingCanonicalTime,
  b: BriefingCanonicalTime,
): number {
  if (a.hour !== b.hour) return a.hour < b.hour ? -1 : 1;
  if (a.minute !== b.minute) return a.minute < b.minute ? -1 : 1;
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  return compareFractionDigits(a.fraction, b.fraction);
}

/**
 * Maps a valid 24h time string into a coarse BriefingPeriod.
 *
 * The value is parsed through the same canonicalizer as the corpus path, so only the
 * canonical hour is ever read — seconds and fractional seconds cannot influence the bucket,
 * and an unparseable value cannot be coerced into one by a prefix slice.
 *
 * Boundaries:
 * - night: 00:00-04:59 and 22:00-23:59
 * - morning: 05:00-11:59
 * - afternoon: 12:00-17:59
 * - evening: 18:00-21:59
 */
export function getBriefingPeriod(time: string): BriefingPeriod {
  const parsed = parseBriefingTime(time);
  const hour = parsed === null ? Number.NaN : parsed.hour;
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
 * - Accepts `HH:mm`, `HH:mm:ss`, and `HH:mm:ss.fraction` times, so a record read straight out of a
 *   PostgreSQL `time` column is normalized rather than failing the whole corpus closed.
 * - Sorts chronologically ascending by date, then exact instant, then record ID as tie-break.
 * - Assigns source ordinal 0..N-1 and dayOrdinal 0..D-1 across distinct dates.
 * - Emits model-safe events containing strictly { ordinal, dayOrdinal, period, text, mediaKinds }.
 * - Returns JS-only source mapping (ordinal -> recordId) and day mapping (dayOrdinal -> date).
 */
export function normalizePartnerBriefingCorpus(
  records: readonly DailyRecord[],
): BriefingNormalizeResult {
  // 1. Validate required chronology metadata in original input order.
  //    The parsed time is kept alongside the record so the sort below orders by the exact
  //    instant rather than by the raw string, which would place '09:07' before '09:07:00'
  //    on textual length alone instead of tie-breaking them by record ID.
  const entries: Array<{
    readonly record: DailyRecord;
    readonly time: BriefingCanonicalTime;
  }> = [];

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
    const time = parseBriefingTime(record.time);
    if (time === null) {
      return { ok: false, rejection: { index: i, reason: 'invalid_time' } };
    }
    entries.push({ record, time });
  }

  // 2. Chronological sorting: date ASC -> exact instant ASC -> record.id ASC
  const sorted = [...entries].sort((a, b) => {
    if (a.record.date !== b.record.date) {
      return a.record.date < b.record.date ? -1 : 1;
    }
    const byInstant = compareBriefingTime(a.time, b.time);
    if (byInstant !== 0) {
      return byInstant;
    }
    if (a.record.id !== b.record.id) {
      return a.record.id < b.record.id ? -1 : 1;
    }
    return 0;
  });

  // 3. Day ordinals and JS-only day mappings across distinct ascending dates
  const distinctDates: string[] = [];
  const dateToDayOrdinal = new Map<string, number>();

  for (const { record } of sorted) {
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
    const { record, time } = sorted[ordinal];
    const dayOrdinal = dateToDayOrdinal.get(record.date)!;
    // Canonical HH:mm only: a record's seconds must not be able to shift its period, and
    // the exact time must not reach the model-safe event.
    const period = getBriefingPeriod(time.canonical);
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
