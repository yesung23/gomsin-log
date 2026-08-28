/**
 * Partner Briefing Portable Deterministic Fallback (Gate A7)
 *
 * Generates pure, deterministic, fact-only Korean briefing structures
 * without any external AI models, prompts, sentiment guessing, or psychological inference.
 *
 * Architectural invariants:
 * 1. Zero AI inference: Summaries are strictly factual counts and media tallies (e.g. "기록 3개 (사진 2장, 음성 1개)").
 * 2. Absence phrase prohibition: For 0 events, text is always the empty string ("") with no debt/absence prose.
 * 3. Exact fail-closed mapping validation: Strict validation of events (0..N-1 ordinals), sources (1:1 unique recordIds),
 *    and days (0..D-1 strictly ascending unique calendar dates).
 * 4. Exact provenance: All sourceRecordIds are bound strictly via TypeScript JS-only mappings.
 * 5. Surface fidelity: Never reads state.records, recalculates PartnerDay/OUTSTANDING, or accepts DailyRecord.
 * 6. Zero persistence, zero logging, zero network/server calls.
 */

import {
  PARTNER_BRIEFING_VERSION,
  type BriefingMediaKind,
  type BriefingModelSafeEvent,
  type BriefingPeriod,
  type BriefingSourceMapping,
  type PartnerBriefing,
  type PartnerBriefingDay,
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
 * Builds a range label from a list of sorted distinct date strings.
 * Single day: "8월 26일", Multi-day: "8월 26일 ~ 8월 27일".
 */
export function formatRangeLabelFromDates(dates: readonly string[]): string {
  if (dates.length === 0) return '';
  if (dates.length === 1) return formatDateKorean(dates[0]);
  return `${formatDateKorean(dates[0])} ~ ${formatDateKorean(dates[dates.length - 1])}`;
}

/**
 * Counts media kinds across events and returns formatted Korean tallies.
 */
export function formatMediaCounts(
  mediaKinds: readonly (readonly BriefingMediaKind[] | BriefingMediaKind)[],
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
): string {
  if (events.length === 0) {
    return '';
  }
  const mediaParts = formatMediaCounts(events.map((e) => e.mediaKinds));
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
): string {
  if (events.length === 0) {
    return '';
  }
  const mediaParts = formatMediaCounts(events.map((e) => e.mediaKinds));
  const dayPrefix = dayCount > 1 ? `${dayCount}일 동안 ` : '';
  const mediaSuffix = mediaParts.length > 0 ? ` (${mediaParts.join(', ')})` : '';
  return `${dayPrefix}총 ${events.length}개의 기록${mediaSuffix}이 있습니다.`;
}

export interface FallbackBriefingInput {
  readonly events: readonly BriefingModelSafeEvent[];
  readonly sources: readonly BriefingSourceMapping[];
  readonly days: readonly BriefingDayMapping[];
}

/**
 * Generates a complete deterministic PartnerBriefing structure without AI models.
 */
export function generateDeterministicPartnerBriefing(
  input: FallbackBriefingInput,
): PartnerBriefing {
  const { events, sources, days } = input;
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

  // Group events by dayOrdinal, then by period, preserving event chronology
  const eventsByDay = new Map<number, Map<BriefingPeriod, BriefingModelSafeEvent[]>>();
  for (const event of events) {
    let dayGroup = eventsByDay.get(event.dayOrdinal);
    if (!dayGroup) {
      dayGroup = new Map<BriefingPeriod, BriefingModelSafeEvent[]>();
      eventsByDay.set(event.dayOrdinal, dayGroup);
    }
    let periodList = dayGroup.get(event.period);
    if (!periodList) {
      periodList = [];
      dayGroup.set(event.period, periodList);
    }
    periodList.push(event);
  }

  const sortedDayOrdinals = Array.from(eventsByDay.keys()).sort((a, b) => a - b);
  const resultDays: PartnerBriefingDay[] = [];
  const allDates: string[] = [];

  for (const dayOrdinal of sortedDayOrdinals) {
    const date = dayMap.get(dayOrdinal)!;
    allDates.push(date);
    const dayGroup = eventsByDay.get(dayOrdinal)!;
    const sections: PartnerBriefingSection[] = [];

    for (const [period, periodEvents] of dayGroup.entries()) {
      sections.push({
        period,
        text: formatFallbackPeriodText(periodEvents),
        sourceRecordIds: periodEvents.map((e) => sourceMap.get(e.ordinal)!),
      });
    }

    resultDays.push({
      date,
      sections,
    });
  }

  const overview: PartnerBriefingOverview = {
    text: formatFallbackOverviewText(events, resultDays.length),
    sourceRecordIds: events.map((e) => sourceMap.get(e.ordinal)!),
  };

  return {
    version: PARTNER_BRIEFING_VERSION,
    sourceCount: events.length,
    generation: 'deterministic',
    rangeLabel: formatRangeLabelFromDates(allDates),
    overview,
    days: resultDays,
  };
}
