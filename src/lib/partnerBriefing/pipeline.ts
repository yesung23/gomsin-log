/**
 * Partner Briefing Closed-Extract Pipeline and Concurrency Controller (Gate A7.2)
 *
 * Coordinates on-device briefing generation across availability checks, chunking,
 * candidate extraction, deterministic batching with envelope and response reserve proofs,
 * sequential extract selection execution, closed-schema verification, deterministic fallback,
 * and concurrency cancellation.
 *
 * Architectural invariants:
 * 1. Model-safe payloads: AI sees only request-local item ordinals (0..N-1) and candidate extracts (0..K-1).
 *    Zero real record IDs, user IDs, couple IDs, exact dates/times, media kinds, URLs, paths, or keys cross the boundary.
 * 2. Closed Extract Selection: The provider returns ONLY UntrustedBriefingExtractPlan choices.
 *    Zero generated, free-form, or displayable text fields whatsoever.
 * 3. Exact Source Provenance: Every dynamic displayed phrase is an exact TypeScript-owned candidate copied from
 *    the normalized source, enclosed in a fixed TypeScript template.
 * 4. Item-Level 1:1 Representation: Every source event is represented by exactly one PartnerBriefingItem
 *    with its exact sourceRecordId. No Top-N, no record dropping, no selection bias.
 * 5. Deterministic Batching & Budget Proofs: Before every provider call, both request JSON UTF-8 bytes and
 *    expected response JSON UTF-8 bytes are proven to fit within the provider envelope.
 * 6. Robust Partial Failure: A failed, timed-out, or rejected batch falls back only for that batch;
 *    verified sibling choices remain active, resulting in 'hybrid' generation.
 * 7. Long Single Record Combination: Long records split into multiple segments retain their source mapping
 *    and combine back into exactly one final item using fixed TS templates.
 * 8. Deterministic Overview: Whole-window counts and media summary with exact union sourceRecordIds.
 * 9. Hardened Runtime Trust Boundaries: Synchronous throws from provider methods are fully isolated.
 * 10. Concurrency & Stale Rejection: PartnerBriefingRunner ensures older runs cannot overwrite newer runs,
 *     and external abort returns null immediately.
 * 11. Zero persistence, zero logging, zero network/server AI.
 */

import {
  DEFAULT_BRIEFING_LOCALE,
  PARTNER_BRIEFING_VERSION,
  type BriefingExtractCandidate,
  type BriefingExtractRequestItem,
  type BriefingGeneration,
  type BriefingLocale,
  type BriefingModelSafeEvent,
  type BriefingPeriod,
  type BriefingSourceMapping,
  type PartnerBriefing,
  type PartnerBriefingDay,
  type PartnerBriefingItem,
  type PartnerBriefingOverview,
  type PartnerBriefingSection,
  type UntrustedBriefingExtractPlan,
} from './contract';
import {
  chunkPartnerBriefingEvents,
  getUtf8ByteLength,
  isValidProviderEnvelope,
  type BriefingProviderEnvelope,
} from './chunk';
import type { BriefingDayMapping } from './normalize';
import type {
  BriefingExtractRequest,
  BriefingExtractResult,
  BriefingProvider,
} from './provider';
import { verifyBriefingExtractResult } from './verify';
import {
  buildBriefingExtractCandidates,
  formatAttributedBriefingItemText,
  formatDeterministicBriefingItemText,
  formatFallbackOverviewText,
  formatRangeLabelFromDates,
  generateDeterministicPartnerBriefing,
  validateBriefingMappings,
} from './fallback';

export interface PartnerBriefingPipelineInput {
  readonly events: readonly BriefingModelSafeEvent[];
  readonly sources: readonly BriefingSourceMapping[];
  readonly days: readonly BriefingDayMapping[];
  readonly provider: BriefingProvider;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly locale?: BriefingLocale;
}

const FIXED_PLACEHOLDER_REQUEST_ID = '00000000-0000-0000-0000-000000000000';

function generateOpaqueRequestId(): string | null {
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      const generated = cryptoObj.randomUUID();
      if (typeof generated === 'string' && generated.trim().length > 0) {
        return generated;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Classifies the overall briefing generation based on verified vs eligible text segments.
 */
export function classifyBriefingGeneration(
  totalAiEligibleSegments: number,
  verifiedAiSegments: number,
): BriefingGeneration {
  if (totalAiEligibleSegments === 0 || verifiedAiSegments === 0) {
    return 'deterministic';
  }
  if (verifiedAiSegments === totalAiEligibleSegments) {
    return 'on_device';
  }
  return 'hybrid';
}

/**
 * Safely extracts and validates capability envelope without runtime TypeError.
 */
export function extractValidEnvelope(capability: unknown): BriefingProviderEnvelope | null {
  if (
    !capability ||
    typeof capability !== 'object' ||
    Array.isArray(capability)
  ) {
    return null;
  }

  const capRecord = capability as Record<string, unknown>;
  const keys = Object.keys(capRecord);

  // Case 1: Wrapped capability { envelope: ... }
  if (keys.length === 1 && keys[0] === 'envelope') {
    if (isValidProviderEnvelope(capRecord.envelope)) {
      return capRecord.envelope;
    }
    return null;
  }

  // Case 2: Direct envelope
  if (isValidProviderEnvelope(capability)) {
    return capability;
  }

  return null;
}

/**
 * Proves whether a set of request items fits within the provider envelope for BOTH
 * actual request serialization and expected response serialization.
 */
export function canItemsFitInEnvelope(
  items: readonly BriefingExtractRequestItem[],
  envelope: BriefingProviderEnvelope,
  requestId: string = FIXED_PLACEHOLDER_REQUEST_ID,
): boolean {
  if (!isValidProviderEnvelope(envelope) || !Array.isArray(items)) {
    return false;
  }

  const availableRequestBytes =
    envelope.maxContextUtf8Bytes -
    envelope.promptOverheadUtf8Bytes -
    envelope.responseReserveUtf8Bytes;

  if (availableRequestBytes <= 0) {
    return false;
  }

  // 1. Actual nested request JSON UTF-8 bytes proof
  const request: BriefingExtractRequest = {
    requestId,
    items,
  };
  const requestBytes = getUtf8ByteLength(JSON.stringify(request));
  if (requestBytes > availableRequestBytes) {
    return false;
  }

  // 2. Expected response JSON UTF-8 bytes proof
  const expectedResponse: UntrustedBriefingExtractPlan = {
    version: 1,
    choices: items.map((item, idx) => ({
      itemOrdinal: idx,
      candidateOrdinal: Math.max(0, item.candidates.length - 1),
    })),
  };
  const responseBytes = getUtf8ByteLength(JSON.stringify(expectedResponse));
  if (responseBytes > envelope.responseReserveUtf8Bytes) {
    return false;
  }

  return true;
}

/**
 * Executes an async operation with bounded timeout and abort signal, with zero listener leaks
 * and full isolation against synchronous throws.
 */
async function executeWithBoundedTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T> | T,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T | null> {
  if (externalSignal?.aborted) {
    return null;
  }

  const internalController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  let resolveAbortPromise: (() => void) | null = null;
  const abortPromise = new Promise<null>((resolve) => {
    resolveAbortPromise = () => resolve(null);
  });

  const onExternalAbort = () => {
    internalController.abort();
    if (resolveAbortPromise) {
      resolveAbortPromise();
    }
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      internalController.abort();
      resolve(null);
    }, timeoutMs);
  });

  try {
    const opPromise = Promise.resolve()
      .then(() => fn(internalController.signal))
      .catch(() => null);
    const result = await Promise.race([opPromise, timeoutPromise, abortPromise]);
    return result;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Executes a provider selectExtracts call with explicit timeout, abort signal handling,
 * cancellation notification on timeout/abort, zero listener leaks, and synchronous throw isolation.
 */
async function executeProviderSelectExtractsWithTimeout(
  provider: BriefingProvider,
  request: BriefingExtractRequest,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  locale?: BriefingLocale,
): Promise<BriefingExtractResult> {
  const { requestId } = request;
  if (externalSignal?.aborted) {
    return { ok: false, requestId, code: 'cancelled' };
  }

  const internalController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let didTimeout = false;

  const safeCancel = () => {
    void Promise.resolve()
      .then(() => provider.cancel(requestId))
      .catch(() => undefined);
  };

  let resolveAbortPromise: (() => void) | null = null;
  const abortPromise = new Promise<BriefingExtractResult>((resolve) => {
    resolveAbortPromise = () => {
      resolve({ ok: false, requestId, code: 'cancelled' });
    };
  });

  const onExternalAbort = () => {
    internalController.abort();
    safeCancel();
    if (resolveAbortPromise) {
      resolveAbortPromise();
    }
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutPromise = new Promise<BriefingExtractResult>((resolve) => {
    timer = setTimeout(() => {
      didTimeout = true;
      internalController.abort();
      safeCancel();
      resolve({ ok: false, requestId, code: 'timeout' });
    }, timeoutMs);
  });

  try {
    const callPromise = Promise.resolve()
      .then(() =>
        provider.selectExtracts(request, {
          signal: internalController.signal,
          locale,
        }),
      )
      .catch((): BriefingExtractResult => {
        return {
          ok: false,
          requestId,
          code: internalController.signal.aborted ? 'cancelled' : 'native_error',
        };
      });

    const result = await Promise.race([callPromise, timeoutPromise, abortPromise]);
    return result;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    if (didTimeout) {
      safeCancel();
    }
  }
}

interface PreparedExtractSegment {
  readonly segmentId: number;
  readonly sourceOrdinal: number;
  readonly candidates: readonly BriefingExtractCandidate[];
}

interface ExtractBatch {
  readonly items: readonly BriefingExtractRequestItem[];
  readonly segments: readonly PreparedExtractSegment[];
}

/**
 * Deterministically batches candidate items while proving envelope constraints.
 */
export function batchCandidateSegments(
  segments: readonly PreparedExtractSegment[],
  envelope: BriefingProviderEnvelope,
): {
  readonly batches: readonly ExtractBatch[];
  readonly unfittableSegmentIds: ReadonlySet<number>;
} {
  const batches: ExtractBatch[] = [];
  const unfittableSegmentIds = new Set<number>();
  let currentBatchItems: BriefingExtractRequestItem[] = [];
  let currentBatchSegments: PreparedExtractSegment[] = [];

  for (const segment of segments) {
    const candidateItem: BriefingExtractRequestItem = {
      itemOrdinal: currentBatchItems.length,
      candidates: segment.candidates,
    };

    const testItems = [...currentBatchItems, candidateItem];

    if (canItemsFitInEnvelope(testItems, envelope, FIXED_PLACEHOLDER_REQUEST_ID)) {
      currentBatchItems.push(candidateItem);
      currentBatchSegments.push(segment);
    } else {
      if (currentBatchItems.length > 0) {
        batches.push({
          items: currentBatchItems,
          segments: currentBatchSegments,
        });
        currentBatchItems = [];
        currentBatchSegments = [];
      }

      const singleItem: BriefingExtractRequestItem = {
        itemOrdinal: 0,
        candidates: segment.candidates,
      };

      if (canItemsFitInEnvelope([singleItem], envelope, FIXED_PLACEHOLDER_REQUEST_ID)) {
        currentBatchItems.push(singleItem);
        currentBatchSegments.push(segment);
      } else {
        unfittableSegmentIds.add(segment.segmentId);
      }
    }
  }

  if (currentBatchItems.length > 0) {
    batches.push({
      items: currentBatchItems,
      segments: currentBatchSegments,
    });
  }

  return { batches, unfittableSegmentIds };
}

export async function runPartnerBriefingPipeline(
  input: PartnerBriefingPipelineInput,
): Promise<PartnerBriefing> {
  const {
    events,
    sources,
    days,
    provider,
    timeoutMs,
    signal,
    locale = DEFAULT_BRIEFING_LOCALE,
  } = input;

  // 1. Fail-closed input and mapping validation
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive safe integer.');
  }

  const { sourceMap, dayMap } = validateBriefingMappings(events, sources, days);

  if (events.length === 0) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  if (signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  // 2. Check provider availability (bounded by timeout/abort, with sync throw isolation)
  const availability = await executeWithBoundedTimeout(
    (s) => provider.getAvailability({ signal: s, locale }),
    timeoutMs,
    signal,
  );

  if (availability !== 'ready' || signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  // 3. Query and strictly validate provider capability envelope (bounded by timeout/abort)
  const rawCapability = await executeWithBoundedTimeout(
    () => provider.getCapability(),
    timeoutMs,
    signal,
  );

  const envelope = extractValidEnvelope(rawCapability);
  if (!envelope || signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  // 4. Deterministic chunking (Phase A4)
  const chunkResult = chunkPartnerBriefingEvents(events, envelope);
  if (!chunkResult.ok) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  const { modelChunks } = chunkResult;

  // 5. Prepare candidate segments from model chunks
  const eligibleSegments: PreparedExtractSegment[] = [];
  const segmentsBySourceOrdinal = new Map<number, PreparedExtractSegment[]>();
  let nextSegmentId = 0;

  for (const chunk of modelChunks) {
    for (const evt of chunk.events) {
      if (typeof evt.text === 'string' && evt.text.trim().length > 0) {
        const candidates = buildBriefingExtractCandidates(evt.text);
        if (candidates.length > 0) {
          const seg: PreparedExtractSegment = {
            segmentId: nextSegmentId++,
            sourceOrdinal: evt.ordinal,
            candidates,
          };
          eligibleSegments.push(seg);

          let list = segmentsBySourceOrdinal.get(evt.ordinal);
          if (!list) {
            list = [];
            segmentsBySourceOrdinal.set(evt.ordinal, list);
          }
          list.push(seg);
        }
      }
    }
  }

  // 6. Deterministically batch candidate items
  const { batches, unfittableSegmentIds } = batchCandidateSegments(
    eligibleSegments,
    envelope,
  );

  const verifiedSegmentExtracts = new Map<number, string>();
  const segmentUsedOnDevice = new Map<number, boolean>();

  for (const unfittableId of unfittableSegmentIds) {
    const seg = eligibleSegments.find((s) => s.segmentId === unfittableId);
    if (seg && seg.candidates.length > 0) {
      verifiedSegmentExtracts.set(seg.segmentId, seg.candidates[0].text);
      segmentUsedOnDevice.set(seg.segmentId, false);
    }
  }

  // 7. Execute batches sequentially with provider
  for (const batch of batches) {
    if (signal?.aborted) {
      for (const seg of batch.segments) {
        verifiedSegmentExtracts.set(seg.segmentId, seg.candidates[0].text);
        segmentUsedOnDevice.set(seg.segmentId, false);
      }
      continue;
    }

    const requestId = generateOpaqueRequestId();
    if (!requestId) {
      // Fail-closed: do not transmit execution-time metadata if safe UUID is unavailable
      for (const seg of batch.segments) {
        verifiedSegmentExtracts.set(seg.segmentId, seg.candidates[0].text);
        segmentUsedOnDevice.set(seg.segmentId, false);
      }
      continue;
    }

    const request: BriefingExtractRequest = {
      requestId,
      items: batch.items,
    };

    if (!canItemsFitInEnvelope(request.items, envelope, requestId)) {
      // Conservative safety gate on real requestId serialization
      for (const seg of batch.segments) {
        verifiedSegmentExtracts.set(seg.segmentId, seg.candidates[0].text);
        segmentUsedOnDevice.set(seg.segmentId, false);
      }
      continue;
    }

    const providerResult = await executeProviderSelectExtractsWithTimeout(
      provider,
      request,
      timeoutMs,
      signal,
      locale,
    );

    const verifyResult = verifyBriefingExtractResult({
      expectedRequestId: requestId,
      requestedItems: request.items,
      providerResult,
    });

    if (verifyResult.ok) {
      for (const choice of verifyResult.choices) {
        const seg = batch.segments[choice.itemOrdinal];
        const selectedCandidate = seg.candidates[choice.candidateOrdinal];
        verifiedSegmentExtracts.set(seg.segmentId, selectedCandidate.text);
        segmentUsedOnDevice.set(seg.segmentId, true);
      }
    } else {
      // Batch failure: fallback to candidate 0 for only this batch
      for (const seg of batch.segments) {
        verifiedSegmentExtracts.set(seg.segmentId, seg.candidates[0].text);
        segmentUsedOnDevice.set(seg.segmentId, false);
      }
    }
  }

  // 8. Build final PartnerBriefing items and hierarchy
  // Group events by dayOrdinal, then by period
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

  const resultDays: PartnerBriefingDay[] = [];
  const allDates: string[] = [];
  const sortedDayOrdinals = Array.from(eventsByDay.keys()).sort((a, b) => a - b);

  for (const dayOrdinal of sortedDayOrdinals) {
    const date = dayMap.get(dayOrdinal)!;
    allDates.push(date);
    const dayGroup = eventsByDay.get(dayOrdinal)!;
    const sections: PartnerBriefingSection[] = [];

    for (const [period, periodEvents] of dayGroup.entries()) {
      const items: PartnerBriefingItem[] = periodEvents.map((evt) => {
        const segs = segmentsBySourceOrdinal.get(evt.ordinal);
        if (segs && segs.length > 0) {
          const itemText = segs
            .map((s) => {
              const extract =
                verifiedSegmentExtracts.get(s.segmentId) ?? s.candidates[0].text;
              return formatAttributedBriefingItemText(extract, locale);
            })
            .join(' ');
          return {
            text: itemText,
            sourceRecordId: sourceMap.get(evt.ordinal)!,
          };
        }

        // Media-only, empty, or fallback without AI segments
        return {
          text: formatDeterministicBriefingItemText(evt, locale),
          sourceRecordId: sourceMap.get(evt.ordinal)!,
        };
      });

      sections.push({
        period,
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

  const totalAiEligibleSegments = eligibleSegments.length;
  let verifiedAiSegments = 0;
  for (const seg of eligibleSegments) {
    if (segmentUsedOnDevice.get(seg.segmentId) === true) {
      verifiedAiSegments += 1;
    }
  }

  const generation = classifyBriefingGeneration(
    totalAiEligibleSegments,
    verifiedAiSegments,
  );

  return {
    version: PARTNER_BRIEFING_VERSION,
    sourceCount: events.length,
    generation,
    rangeLabel: formatRangeLabelFromDates(allDates, locale),
    overview,
    days: resultDays,
  };
}

/**
 * Concurrency runner for Partner Briefing.
 *
 * Automatically cancels prior in-flight runs when a new run starts,
 * and rejects stale/late completion.
 */
export class PartnerBriefingRunner {
  private currentController: AbortController | null = null;
  private currentRunId = 0;

  /**
   * Runs the partner briefing pipeline, automatically cancelling any in-flight run.
   * Immediately resolves to null on external abort even if the provider hangs.
   */
  async run(
    input: Omit<PartnerBriefingPipelineInput, 'signal'> & { signal?: AbortSignal },
  ): Promise<PartnerBriefing | null> {
    if (this.currentController) {
      this.currentController.abort();
    }

    const runId = ++this.currentRunId;
    const controller = new AbortController();
    this.currentController = controller;

    const externalSignal = input.signal;
    if (externalSignal?.aborted) {
      return null;
    }

    let resolveAbortPromise: (() => void) | null = null;
    const abortPromise = new Promise<null>((resolve) => {
      resolveAbortPromise = () => resolve(null);
    });

    const onExternalAbort = () => {
      controller.abort();
      if (resolveAbortPromise) {
        resolveAbortPromise();
      }
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const pipelinePromise = runPartnerBriefingPipeline({
        ...input,
        signal: controller.signal,
      });

      const result = await Promise.race([pipelinePromise, abortPromise]);

      if (runId !== this.currentRunId || controller.signal.aborted || !result) {
        return null;
      }

      return result;
    } catch (err) {
      if (runId !== this.currentRunId || controller.signal.aborted) {
        return null;
      }
      throw err;
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      if (this.currentController === controller) {
        this.currentController = null;
      }
    }
  }

  /**
   * Cancels the active run if any.
   */
  cancel(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.currentRunId++;
  }

  /**
   * Returns whether a run is currently in progress.
   */
  isRunning(): boolean {
    return this.currentController !== null;
  }
}
