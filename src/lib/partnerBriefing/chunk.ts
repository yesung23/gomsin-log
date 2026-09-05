/**
 * Partner Briefing deterministic chunker (Gate A4).
 *
 * Provider input is only the deterministic JSON serialization of each model
 * chunk's model-safe events. Sources that cannot be proven safe for both the
 * provider envelope and grapheme limit are returned only as fallback ordinals.
 */

import type {
  BriefingMediaKind,
  BriefingModelSafeEvent,
  BriefingPeriod,
} from './contract';

/**
 * Everything a provider actually enforces on a request, in one place.
 *
 * `maxItems` and `maxCandidatesPerItem` are the STRUCTURAL limits. Both native parsers
 * have always enforced them (`OnDeviceBriefing.maxItems` / `maxCandidatesPerItem` on iOS,
 * `MAX_ITEMS` / `MAX_CANDIDATES_PER_ITEM` on Android) and reject the whole request with
 * `bad_request` when either is exceeded -- but they were never advertised, so the JS
 * batcher could not see them. A single record that segments into 33 sentences produced a
 * request JS considered valid and the device refused outright, and the couple silently
 * got deterministic output on hardware that could have done better.
 *
 * They are part of the envelope rather than JS constants so that iOS and Android may
 * differ, and so a change on one side cannot drift from the batcher.
 */
export interface BriefingProviderEnvelope {
  readonly maxContextUtf8Bytes: number;
  readonly promptOverheadUtf8Bytes: number;
  readonly responseReserveUtf8Bytes: number;
  readonly maxInputTextGraphemes: number;
  readonly maxItems: number;
  readonly maxCandidatesPerItem: number;
}

export interface BriefingModelChunk {
  readonly dayOrdinal: number;
  readonly period: BriefingPeriod;
  readonly sourceOrdinals: readonly number[];
  readonly events: readonly BriefingModelSafeEvent[];
}

export type BriefingChunkRejectionReason =
  | 'invalid_provider_envelope'
  | 'invalid_ordinals'
  | 'invalid_event';

export interface BriefingChunkRejection {
  readonly reason: BriefingChunkRejectionReason;
  readonly index?: number;
}

export type BriefingChunkResult =
  | {
      readonly ok: true;
      readonly modelChunks: readonly BriefingModelChunk[];
      readonly deterministicFallbackSourceOrdinals: readonly number[];
    }
  | {
      readonly ok: false;
      readonly rejection: BriefingChunkRejection;
    };

const encoder = new TextEncoder();
const PERIODS = new Set<BriefingPeriod>([
  'morning',
  'afternoon',
  'evening',
  'night',
]);
const MEDIA_KINDS = new Set<BriefingMediaKind>(['photo', 'video', 'voice']);
const EVENT_KEYS = new Set([
  'ordinal',
  'dayOrdinal',
  'period',
  'text',
  'mediaKinds',
]);
const ENVELOPE_KEYS = new Set([
  'maxContextUtf8Bytes',
  'promptOverheadUtf8Bytes',
  'responseReserveUtf8Bytes',
  'maxInputTextGraphemes',
  'maxItems',
  'maxCandidatesPerItem',
]);

export function isValidProviderEnvelope(
  value: unknown,
): value is BriefingProviderEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== ENVELOPE_KEYS.size ||
    keys.some((key) => !ENVELOPE_KEYS.has(key))
  ) {
    return false;
  }

  const envelope = value as Record<string, unknown>;
  const maxContext = envelope.maxContextUtf8Bytes;
  const promptOverhead = envelope.promptOverheadUtf8Bytes;
  const responseReserve = envelope.responseReserveUtf8Bytes;
  const maxGraphemes = envelope.maxInputTextGraphemes;
  const maxItems = envelope.maxItems;
  const maxCandidatesPerItem = envelope.maxCandidatesPerItem;

  if (
    !Number.isSafeInteger(maxContext) ||
    (maxContext as number) <= 0 ||
    !Number.isSafeInteger(promptOverhead) ||
    (promptOverhead as number) < 0 ||
    !Number.isSafeInteger(responseReserve) ||
    (responseReserve as number) < 0 ||
    !Number.isSafeInteger(maxGraphemes) ||
    (maxGraphemes as number) <= 0 ||
    !Number.isSafeInteger(maxItems) ||
    (maxItems as number) <= 0 ||
    !Number.isSafeInteger(maxCandidatesPerItem) ||
    (maxCandidatesPerItem as number) <= 0
  ) {
    return false;
  }

  return (
    (promptOverhead as number) + (responseReserve as number) <
    (maxContext as number)
  );
}

export function isValidModelSafeEvent(
  value: unknown,
): value is BriefingModelSafeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== EVENT_KEYS.size ||
    keys.some((key) => !EVENT_KEYS.has(key))
  ) {
    return false;
  }

  const event = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(event.ordinal) ||
    (event.ordinal as number) < 0 ||
    !Number.isSafeInteger(event.dayOrdinal) ||
    (event.dayOrdinal as number) < 0 ||
    typeof event.period !== 'string' ||
    !PERIODS.has(event.period as BriefingPeriod) ||
    typeof event.text !== 'string' ||
    !Array.isArray(event.mediaKinds)
  ) {
    return false;
  }

  return event.mediaKinds.every(
    (kind) =>
      typeof kind === 'string' &&
      MEDIA_KINDS.has(kind as BriefingMediaKind),
  );
}

function projectEvent(
  event: BriefingModelSafeEvent,
): BriefingModelSafeEvent {
  return {
    ordinal: event.ordinal,
    dayOrdinal: event.dayOrdinal,
    period: event.period,
    text: event.text,
    mediaKinds: event.mediaKinds,
  };
}

export function serializeModelSafeEvents(
  events: readonly BriefingModelSafeEvent[],
): string {
  return JSON.stringify(events.map(projectEvent));
}

export function getSerializedModelSafeEventsUtf8Bytes(
  events: readonly BriefingModelSafeEvent[],
): number {
  return encoder.encode(serializeModelSafeEvents(events)).length;
}

export function getUtf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function getGraphemeClusters(text: string): string[] | null {
  if (text.length === 0) {
    return [];
  }
  if (typeof Intl.Segmenter !== 'function') {
    return null;
  }

  try {
    const clusters: string[] = [];
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    for (const segment of segmenter.segment(text)) {
      clusters.push(segment.segment);
    }
    return clusters;
  } catch {
    return null;
  }
}

export function countGraphemes(text: string): number | null {
  const clusters = getGraphemeClusters(text);
  return clusters ? clusters.length : null;
}

function availablePayloadBytes(
  envelope: BriefingProviderEnvelope,
): number {
  return (
    envelope.maxContextUtf8Bytes -
    envelope.promptOverheadUtf8Bytes -
    envelope.responseReserveUtf8Bytes
  );
}

function payloadFits(
  events: readonly BriefingModelSafeEvent[],
  envelope: BriefingProviderEnvelope,
): boolean {
  return (
    getSerializedModelSafeEventsUtf8Bytes(events) <=
    availablePayloadBytes(envelope)
  );
}

interface PreparedEvent {
  readonly event: BriefingModelSafeEvent;
  readonly graphemeCount: number;
}

function prepareEvent(
  event: BriefingModelSafeEvent,
  envelope: BriefingProviderEnvelope,
): readonly PreparedEvent[] | null {
  const clusters = getGraphemeClusters(event.text);
  if (clusters === null) {
    return null;
  }

  if (
    clusters.length <= envelope.maxInputTextGraphemes &&
    payloadFits([event], envelope)
  ) {
    return [{ event, graphemeCount: clusters.length }];
  }

  if (clusters.length === 0) {
    return null;
  }

  const prepared: PreparedEvent[] = [];
  let text = '';
  let graphemeCount = 0;

  for (const cluster of clusters) {
    const candidateText = text + cluster;
    const candidate = projectEvent({ ...event, text: candidateText });
    const candidateCount = graphemeCount + 1;

    if (
      candidateCount <= envelope.maxInputTextGraphemes &&
      payloadFits([candidate], envelope)
    ) {
      text = candidateText;
      graphemeCount = candidateCount;
      continue;
    }

    if (text.length > 0) {
      prepared.push({
        event: projectEvent({ ...event, text }),
        graphemeCount,
      });
    }

    const singleClusterEvent = projectEvent({ ...event, text: cluster });
    if (!payloadFits([singleClusterEvent], envelope)) {
      return null;
    }

    text = cluster;
    graphemeCount = 1;
  }

  if (text.length > 0) {
    prepared.push({
      event: projectEvent({ ...event, text }),
      graphemeCount,
    });
  }

  return prepared;
}

export function chunkPartnerBriefingEvents(
  events: readonly BriefingModelSafeEvent[],
  envelope: BriefingProviderEnvelope,
): BriefingChunkResult {
  if (!isValidProviderEnvelope(envelope)) {
    return {
      ok: false,
      rejection: { reason: 'invalid_provider_envelope' },
    };
  }
  if (!Array.isArray(events)) {
    return { ok: false, rejection: { reason: 'invalid_event' } };
  }

  let previousDayOrdinal = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isValidModelSafeEvent(event)) {
      return {
        ok: false,
        rejection: { reason: 'invalid_event', index },
      };
    }
    if (event.ordinal !== index || event.dayOrdinal < previousDayOrdinal) {
      return {
        ok: false,
        rejection: { reason: 'invalid_ordinals', index },
      };
    }
    previousDayOrdinal = event.dayOrdinal;
  }

  const modelChunks: BriefingModelChunk[] = [];
  const deterministicFallbackSourceOrdinals: number[] = [];
  let currentEvents: BriefingModelSafeEvent[] = [];
  let currentGraphemes = 0;
  let currentDayOrdinal = -1;
  let currentPeriod: BriefingPeriod | null = null;

  const flush = () => {
    if (currentEvents.length === 0 || currentPeriod === null) {
      return;
    }
    modelChunks.push({
      dayOrdinal: currentDayOrdinal,
      period: currentPeriod,
      sourceOrdinals: currentEvents.map((event) => event.ordinal),
      events: currentEvents,
    });
    currentEvents = [];
    currentGraphemes = 0;
  };

  for (const event of events) {
    if (
      currentDayOrdinal !== event.dayOrdinal ||
      currentPeriod !== event.period
    ) {
      flush();
      currentDayOrdinal = event.dayOrdinal;
      currentPeriod = event.period;
    }

    const prepared = prepareEvent(event, envelope);
    if (prepared === null) {
      flush();
      deterministicFallbackSourceOrdinals.push(event.ordinal);
      continue;
    }

    if (prepared.length > 1) {
      flush();
      for (const segment of prepared) {
        modelChunks.push({
          dayOrdinal: segment.event.dayOrdinal,
          period: segment.event.period,
          sourceOrdinals: [segment.event.ordinal],
          events: [segment.event],
        });
      }
      continue;
    }

    const candidateEvents = [...currentEvents, prepared[0].event];
    const candidateGraphemes =
      currentGraphemes + prepared[0].graphemeCount;
    if (
      currentEvents.length > 0 &&
      (candidateGraphemes > envelope.maxInputTextGraphemes ||
        !payloadFits(candidateEvents, envelope))
    ) {
      flush();
    }

    currentEvents.push(prepared[0].event);
    currentGraphemes += prepared[0].graphemeCount;
  }

  flush();

  const coveredOrdinals = new Set(deterministicFallbackSourceOrdinals);
  for (const chunk of modelChunks) {
    for (const ordinal of chunk.sourceOrdinals) {
      coveredOrdinals.add(ordinal);
    }
  }
  if (
    coveredOrdinals.size !== events.length ||
    events.some((event) => !coveredOrdinals.has(event.ordinal))
  ) {
    return {
      ok: false,
      rejection: { reason: 'invalid_ordinals' },
    };
  }

  return {
    ok: true,
    modelChunks,
    deterministicFallbackSourceOrdinals,
  };
}
