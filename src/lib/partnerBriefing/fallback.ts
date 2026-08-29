/**
 * Partner Briefing Portable Deterministic Fallback (Gate A7.1)
 *
 * Generates pure, deterministic, exact-source Korean briefing structures and candidate extracts
 * without any external AI models, prompts, sentiment guessing, or psychological inference.
 *
 * Architectural invariants:
 * 1. Exact-source candidate extraction: Candidate text is strictly a non-empty exact substring of the
 *    normalized source text with sequential ordinals (0..K-1). Uses sentence segmentation when available;
 *    if unavailable or throwing, falls back to the whole exact text without truncation.
 * 2. Attributed rendering: Dynamic displayed phrase is an exact source extract enclosed in a fixed
 *    TypeScript template (e.g. “<exact extract>”라고 기록했어요.). Never infers feelings, health, or intent.
 * 3. Media-only & empty records: Formatted with deterministic fixed factual phrases based only on
 *    allowlisted media kinds/counts, or neutral "기록을 남겼어요." when text and media are both absent.
 * 4. Item-level 1:1 representation: Every event is represented by exactly one PartnerBriefingItem
 *    with one exact sourceRecordId inside its JS date/period section. No Top-N, no record dropping.
 * 5. Deterministic whole-window overview: Factual count/media summary with exact union sourceRecordIds.
 * 6. Absence phrase prohibition: For 0 events, text is always the empty string ("") with no debt/absence prose.
 * 7. Exact fail-closed mapping validation: Strict validation of events (0..N-1 ordinals), sources (1:1 unique recordIds),
 *    and days (0..D-1 strictly ascending unique calendar dates).
 * 8. Zero IDs in candidate helpers: AI candidates contain request-local ordinals only; record IDs never cross boundary.
 * 9. Surface fidelity: Never reads state.records, recalculates PartnerDay/OUTSTANDING, or accepts DailyRecord.
 * 10. Zero persistence, zero logging, zero network/server calls.
 */

import {
  PARTNER_BRIEFING_VERSION,
  DEFAULT_BRIEFING_LOCALE,
  type BriefingExtractCandidate,
  type BriefingLocale,
  type BriefingMediaKind,
  type BriefingModelSafeEvent,
  type BriefingPeriod,
  type BriefingSourceMapping,
  type PartnerBriefing,
  type PartnerBriefingDay,
  type PartnerBriefingItem,
  type PartnerBriefingOverview,
  type PartnerBriefingSection,
} from './contract';
import { isValidModelSafeEvent } from './chunk';
import type { BriefingDayMapping } from './normalize';
import { isValidDateString } from './normalize';

export interface ValidatedBriefingMappings {
  readonly sourceMap: Map<number, string>;
  readonly dayMap: Map<number, string>;
}

/**
 * Builds candidate extracts from normalized source text.
 *
 * Invariants:
 * - Every candidate is a non-empty exact substring of the supplied text.
 * - Ordinals are sequential 0..K-1.
 * - Prefers sentence segmentation via Intl.Segmenter('ko', { granularity: 'sentence' }).
 * - If Intl.Segmenter is unavailable or throws, uses the whole exact text as the sole candidate.
 * - Never Array.from-truncates or invents text.
 * - Empty/whitespace-only text returns [].
 * - Contains zero database IDs, user IDs, dates, or timestamps.
 */
export function buildBriefingExtractCandidates(
  sourceText: string,
  contentLocale?: BriefingLocale,
): readonly BriefingExtractCandidate[] {
  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return [];
  }

  const cleanText = sourceText.trim();
  if (cleanText.length === 0) {
    return [];
  }

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(contentLocale, { granularity: 'sentence' });
      const rawSegments = Array.from(segmenter.segment(sourceText));
      const extracted: string[] = [];

      for (const seg of rawSegments) {
        const trimmed = seg.segment.trim();
        if (trimmed.length > 0 && sourceText.includes(trimmed)) {
          extracted.push(trimmed);
        }
      }

      if (extracted.length > 0) {
        return extracted.map((text, candidateOrdinal) => ({
          candidateOrdinal,
          text,
        }));
      }
    }
  } catch {
    // If Intl.Segmenter fails or throws, fall through to whole exact text candidate
  }

  return [
    {
      candidateOrdinal: 0,
      text: cleanText,
    },
  ];
}

/**
 * Formats a TypeScript-owned attributed briefing item text from an exact extract.
 *
 * All words other than the exact extract are fixed template text.
 * Renders source statements as attributed quotes, not app/AI judgments.
 */
export function formatAttributedBriefingItemText(
  extractText: string,
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (locale === 'en') {
    return `They wrote: “${extractText}”`;
  }
  return `“${extractText}”라고 기록했어요.`;
}

/**
 * Formats a deterministic factual item text for media-only or empty records.
 *
 * Based only on allowlisted media kinds/counts, or neutral "기록을 남겼어요."
 */
export function formatMediaItemText(
  mediaKinds: readonly (readonly BriefingMediaKind[] | BriefingMediaKind)[],
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  const parts = formatMediaCounts(mediaKinds, locale);
  if (locale === 'en') {
    if (parts.length === 0) {
      return 'Shared a record.';
    }
    return `Shared ${parts.join(', ')}.`;
  }
  if (parts.length === 0) {
    return '기록을 남겼어요.';
  }
  const joined = parts.join(', ');
  const lastPart = parts[parts.length - 1];
  const particle = lastPart.endsWith('장') ? '을' : '를';
  return `${joined}${particle} 남겼어요.`;
}

/**
 * Formats a deterministic briefing item text for an event.
 *
 * If text is present, extracts the first sentence candidate and formats attributed quote.
 * If text is empty/absent, formats media tally or neutral record notice.
 */
export function formatDeterministicBriefingItemText(
  event: Pick<BriefingModelSafeEvent, 'text' | 'mediaKinds'>,
  presentationLocale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (typeof event.text === 'string' && event.text.trim().length > 0) {
    const candidates = buildBriefingExtractCandidates(event.text);
    if (candidates.length > 0) {
      return formatAttributedBriefingItemText(candidates[0].text, presentationLocale);
    }
  }
  return formatMediaItemText(event.mediaKinds, presentationLocale);
}

/**
 * Validates that all events, sources, and days have exact 1:1 coverage fail-closed.
 */
export function validateBriefingMappings(
  events: readonly BriefingModelSafeEvent[],
  sources: readonly BriefingSourceMapping[],
  days: readonly BriefingDayMapping[],
): ValidatedBriefingMappings {
  if (!Array.isArray(events) || !Array.isArray(sources) || !Array.isArray(days)) {
    throw new Error('Invalid input: events, sources, and days must be arrays.');
  }

  // 1. Validate events
  const eventDayOrdinals = new Set<number>();
  let previousDayOrdinal = -1;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!isValidModelSafeEvent(event)) {
      throw new Error(`Invalid model-safe event at index ${i}.`);
    }
    if (event.ordinal !== i) {
      throw new Error(
        `Event ordinal mismatch: expected ${i}, received ${event.ordinal}.`,
      );
    }
    if (event.dayOrdinal < previousDayOrdinal) {
      throw new Error(
        `Event dayOrdinal must be non-decreasing: index ${i} has ${event.dayOrdinal} after ${previousDayOrdinal}.`,
      );
    }
    previousDayOrdinal = event.dayOrdinal;
    eventDayOrdinals.add(event.dayOrdinal);
  }

  // 2. Validate sources (must match exact 0..N-1 ordinal set with unique recordIds)
  if (sources.length !== events.length) {
    throw new Error(
      `Sources count mismatch: expected ${events.length}, received ${sources.length}.`,
    );
  }

  const sourceMap = new Map<number, string>();
  const seenRecordIds = new Set<string>();

  for (let i = 0; i < sources.length; i += 1) {
    const item = sources[i];
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.ordinal !== 'number' ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 0 ||
      typeof item.recordId !== 'string' ||
      item.recordId.trim().length === 0
    ) {
      throw new Error(`Invalid source mapping entry at index ${i}.`);
    }

    if (sourceMap.has(item.ordinal)) {
      throw new Error(`Duplicate source mapping for ordinal ${item.ordinal}.`);
    }
    if (item.ordinal >= events.length) {
      throw new Error(
        `Extra source mapping ordinal ${item.ordinal} out of range (0..${events.length - 1}).`,
      );
    }

    const cleanRecordId = item.recordId.trim();
    if (seenRecordIds.has(cleanRecordId)) {
      throw new Error(
        `Duplicate recordId "${cleanRecordId}" mapped across multiple ordinals.`,
      );
    }
    seenRecordIds.add(cleanRecordId);
    sourceMap.set(item.ordinal, cleanRecordId);
  }

  for (let i = 0; i < events.length; i += 1) {
    if (!sourceMap.has(i)) {
      throw new Error(`Missing source mapping for event ordinal ${i}.`);
    }
  }

  // 3. Validate days (must match exact distinct dayOrdinal set with strictly ascending unique dates)
  if (days.length !== eventDayOrdinals.size) {
    throw new Error(
      `Days count mismatch: expected ${eventDayOrdinals.size} distinct days, received ${days.length}.`,
    );
  }

  const dayMap = new Map<number, string>();
  const seenDates = new Set<string>();
  let previousDate = '';

  for (let i = 0; i < days.length; i += 1) {
    const item = days[i];
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.dayOrdinal !== 'number' ||
      !Number.isSafeInteger(item.dayOrdinal) ||
      item.dayOrdinal < 0 ||
      !isValidDateString(item.date)
    ) {
      throw new Error(`Invalid day mapping entry at index ${i}.`);
    }

    if (dayMap.has(item.dayOrdinal)) {
      throw new Error(`Duplicate day mapping for dayOrdinal ${item.dayOrdinal}.`);
    }
    if (!eventDayOrdinals.has(item.dayOrdinal)) {
      throw new Error(
        `Extra day mapping for unused dayOrdinal ${item.dayOrdinal}.`,
      );
    }

    if (seenDates.has(item.date)) {
      throw new Error(
        `Duplicate date "${item.date}" mapped across multiple dayOrdinals.`,
      );
    }
    if (previousDate !== '' && item.date <= previousDate) {
      throw new Error(
        `Day mapping dates must be strictly ascending: "${item.date}" after "${previousDate}".`,
      );
    }

    previousDate = item.date;
    seenDates.add(item.date);
    dayMap.set(item.dayOrdinal, item.date);
  }

  for (const dayOrd of eventDayOrdinals) {
    if (!dayMap.has(dayOrd)) {
      throw new Error(`Missing day mapping for event dayOrdinal ${dayOrd}.`);
    }
  }

  return { sourceMap, dayMap };
}

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Formats an ISO date string (YYYY-MM-DD) into standard English date label (e.g. "August 26").
 */
export function formatDateEnglish(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (month >= 1 && month <= 12 && !Number.isNaN(day)) {
      return `${ENGLISH_MONTHS[month - 1]} ${day}`;
    }
  }
  return dateStr;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) into standard Korean date label (e.g. "8월 26일").
 */
export function formatDateKorean(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${Number(parts[1])}월 ${Number(parts[2])}일`;
  }
  return dateStr;
}

/**
 * Formats an ISO date string (YYYY-MM-DD) for the given locale.
 */
export function formatDateForLocale(
  dateStr: string,
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (locale === 'en') {
    return formatDateEnglish(dateStr);
  }
  return formatDateKorean(dateStr);
}

/**
 * Builds a range label from a list of sorted distinct date strings.
 * Single day: "8월 26일" / "August 26"
 * Multi-day: "8월 26일 ~ 8월 27일" / "August 26 – August 27"
 */
export function formatRangeLabelFromDates(
  dates: readonly string[],
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (dates.length === 0) return '';
  const first = formatDateForLocale(dates[0], locale);
  if (dates.length === 1) return first;
  const last = formatDateForLocale(dates[dates.length - 1], locale);
  const separator = locale === 'en' ? ' – ' : ' ~ ';
  return `${first}${separator}${last}`;
}

/**
 * Counts media kinds across events and returns formatted tallies for the given locale.
 */
export function formatMediaCounts(
  mediaKinds: readonly (readonly BriefingMediaKind[] | BriefingMediaKind)[],
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string[] {
  let photoCount = 0;
  let videoCount = 0;
  let voiceCount = 0;

  for (const item of mediaKinds) {
    if (Array.isArray(item)) {
      for (const kind of item) {
        if (kind === 'photo') photoCount += 1;
        else if (kind === 'video') videoCount += 1;
        else if (kind === 'voice') voiceCount += 1;
      }
    } else {
      if (item === 'photo') photoCount += 1;
      else if (item === 'video') videoCount += 1;
      else if (item === 'voice') voiceCount += 1;
    }
  }

  const parts: string[] = [];
  if (locale === 'en') {
    if (photoCount > 0) parts.push(photoCount === 1 ? '1 photo' : `${photoCount} photos`);
    if (videoCount > 0) parts.push(videoCount === 1 ? '1 video' : `${videoCount} videos`);
    if (voiceCount > 0) parts.push(voiceCount === 1 ? '1 voice note' : `${voiceCount} voice notes`);
    return parts;
  }
  if (photoCount > 0) parts.push(`사진 ${photoCount}장`);
  if (videoCount > 0) parts.push(`동영상 ${videoCount}개`);
  if (voiceCount > 0) parts.push(`음성 ${voiceCount}개`);
  return parts;
}

/**
 * Formats a factual count/media summary for a period section.
 * For 0 events, returns empty string (""). Never emits absence or debt phrases.
 */
export function formatFallbackPeriodText(
  events: readonly BriefingModelSafeEvent[],
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (events.length === 0) {
    return '';
  }
  const mediaParts = formatMediaCounts(events.map((e) => e.mediaKinds), locale);
  if (locale === 'en') {
    const recordLabel = events.length === 1 ? '1 record' : `${events.length} records`;
    if (mediaParts.length > 0) {
      return `${recordLabel} (${mediaParts.join(', ')})`;
    }
    return recordLabel;
  }
  if (mediaParts.length > 0) {
    return `기록 ${events.length}개 (${mediaParts.join(', ')})`;
  }
  return `기록 ${events.length}개`;
}

/**
 * Formats a factual overview summary text across the entire briefing corpus.
 * For 0 events, returns empty string (""). Never emits absence or debt phrases.
 */
export function formatFallbackOverviewText(
  events: readonly BriefingModelSafeEvent[],
  dayCount: number,
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): string {
  if (events.length === 0) {
    return '';
  }
  const mediaParts = formatMediaCounts(events.map((e) => e.mediaKinds), locale);
  if (locale === 'en') {
    const recordLabel = events.length === 1 ? '1 record' : `${events.length} records`;
    const mediaSuffix = mediaParts.length > 0 ? ` (${mediaParts.join(', ')})` : '';
    if (dayCount > 1) {
      return `Over ${dayCount} days: ${recordLabel}${mediaSuffix} in total.`;
    }
    return `${recordLabel}${mediaSuffix} in total.`;
  }
  const dayPrefix = dayCount > 1 ? `${dayCount}일 동안 ` : '';
  const mediaSuffix = mediaParts.length > 0 ? ` (${mediaParts.join(', ')})` : '';
  return `${dayPrefix}총 ${events.length}개의 기록${mediaSuffix}이 있습니다.`;
}

export interface FallbackBriefingInput {
  readonly events: readonly BriefingModelSafeEvent[];
  readonly sources: readonly BriefingSourceMapping[];
  readonly days: readonly BriefingDayMapping[];
  readonly locale?: BriefingLocale;
}

/**
 * Generates a complete deterministic PartnerBriefing structure without AI models.
 */
/**
 * One day's events, cut into CONTIGUOUS runs of the same period.
 *
 * Sections used to be keyed by period in a Map, so every event of a given period on a
 * given day collapsed into one section wherever it sat in the day. `night` spans both
 * ends of the clock (00:00-04:59 and 22:00-23:59), so a day with 00:30, 09:00 and 22:30
 * produced a `night` section holding BOTH night records and, because the Map preserved
 * first-insertion order, it rendered ABOVE `morning` -- the day read as
 * night(00:30 + 22:30) then morning(09:00), with the late-evening record shown before the
 * morning one it came eight hours after.
 *
 * Cutting on a period CHANGE instead keeps the day in the order it happened and yields
 * three sections here. Two sections may therefore carry the same `period` value, so no
 * caller may treat that string as a unique key.
 *
 * The event order given is the order used: the pipeline already relies on `events` being
 * in the chronological order `normalizePartnerBriefingCorpus` produced.
 */
export interface BriefingChronologicalRun {
  readonly period: BriefingPeriod;
  readonly events: readonly BriefingModelSafeEvent[];
}

export function groupEventsIntoChronologicalRuns(
  events: readonly BriefingModelSafeEvent[],
): Map<number, BriefingChronologicalRun[]> {
  const runsByDay = new Map<number, BriefingChronologicalRun[]>();

  for (const event of events) {
    let dayRuns = runsByDay.get(event.dayOrdinal);
    if (!dayRuns) {
      dayRuns = [];
      runsByDay.set(event.dayOrdinal, dayRuns);
    }

    const lastRun = dayRuns[dayRuns.length - 1];
    if (lastRun && lastRun.period === event.period) {
      (lastRun.events as BriefingModelSafeEvent[]).push(event);
      continue;
    }
    dayRuns.push({ period: event.period, events: [event] });
  }

  return runsByDay;
}

export function generateDeterministicPartnerBriefing(
  input: FallbackBriefingInput,
): PartnerBriefing {
  const { events, sources, days, locale = DEFAULT_BRIEFING_LOCALE } = input;
  const { sourceMap, dayMap } = validateBriefingMappings(events, sources, days);

  if (events.length === 0) {
    return {
      version: PARTNER_BRIEFING_VERSION,
      sourceCount: 0,
      generation: 'deterministic',
      rangeLabel: '',
      overview: {
        text: '',
        sourceRecordIds: [],
      },
      days: [],
    };
  }

  const runsByDay = groupEventsIntoChronologicalRuns(events);
  const sortedDayOrdinals = Array.from(runsByDay.keys()).sort((a, b) => a - b);
  const resultDays: PartnerBriefingDay[] = [];
  const allDates: string[] = [];

  for (const dayOrdinal of sortedDayOrdinals) {
    const date = dayMap.get(dayOrdinal)!;
    allDates.push(date);
    const sections: PartnerBriefingSection[] = [];

    for (const run of runsByDay.get(dayOrdinal)!) {
      const items: PartnerBriefingItem[] = run.events.map((e) => ({
        parts: [
          {
            text: formatDeterministicBriefingItemText(e, locale),
            sourceRecordId: sourceMap.get(e.ordinal)!,
          },
        ],
      }));

      sections.push({
        period: run.period,
        items,
      });
    }

    resultDays.push({
      date,
      sections,
    });
  }

  const overview: PartnerBriefingOverview = {
    text: formatFallbackOverviewText(events, resultDays.length, locale),
    sourceRecordIds: events.map((e) => sourceMap.get(e.ordinal)!),
  };

  return {
    version: PARTNER_BRIEFING_VERSION,
    sourceCount: events.length,
    generation: 'deterministic',
    rangeLabel: formatRangeLabelFromDates(allDates, locale),
    overview,
    days: resultDays,
  };
}
