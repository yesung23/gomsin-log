/**
 * Partner Briefing Closed-Extract Pipeline and Concurrency Controller (Gate A7.2 - v2 Grouping Plan)
 *
 * Coordinates on-device briefing generation across availability checks, chunking,
 * candidate extraction, deterministic batching with envelope and response reserve proofs,
 * single total run deadline tracking, sequential extract selection execution,
 * closed-schema verification, deterministic fallback, and concurrency cancellation.
 *
 * Architectural invariants:
 * 1. Model-safe payloads: AI sees only request-local item ordinals (0..N-1) and candidate extracts (0..K-1).
 *    Zero real record IDs, user IDs, couple IDs, exact dates/times, media kinds, URLs, paths, or keys cross the boundary.
 * 2. Closed Extract Grouping (v2): The provider returns ONLY UntrustedBriefingGroupPlan (version: 2).
 *    Zero generated, free-form, or displayable text fields whatsoever.
 * 3. Exact Source Provenance: Every dynamic displayed phrase is an exact TypeScript-owned candidate copied from
 *    the normalized source, enclosed in a fixed TypeScript template.
 * 4. Item parts & compression: Groups form a single PartnerBriefingItem with parts: [{ text, sourceRecordId }, ...].
 *    Preserves exact text-to-record binding and source order without Top-N selection loss.
 * 5. Single Run Deadline: timeoutMs is a total wall-clock budget across availability, capability, and all batches.
 *    Recomputes remaining time before each awaited step; once expired, remaining work becomes deterministic.
 * 6. Day and Period Request Isolation: Each provider request contains items from one dayOrdinal + one period only.
 * 7. Long Record Singleton: Long records that cannot safely fit whole as one provider item remain deterministic singletons.
 * 8. Robust Partial Failure: A failed, timed-out, or rejected batch falls back only for that batch;
 *    verified sibling batches remain active, resulting in 'hybrid' generation.
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
  type UntrustedBriefingGroupPlan,
} from './contract';
import {
  chunkPartnerBriefingEvents,
  countGraphemes,
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
import { verifyBriefingExtractResult, type VerifiedBriefingGroup } from './verify';
import {
  findBriefingModelInputRisk,
  findBriefingRequestItemsRisk,
} from './modelInputGate';
import {
  buildBriefingExtractCandidates,
  formatAttributedBriefingItemText,
  formatDeterministicBriefingItemText,
  formatFallbackOverviewText,
  formatRangeLabelFromDates,
  generateDeterministicPartnerBriefing,
  groupEventsIntoChronologicalRuns,
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

/**
 * Conservative grapheme safety margin for JS envelope validation.
 *
 * Unicode grapheme cluster segmentation can differ slightly across runtimes
 * (JavaScript Intl.Segmenter, Swift Character.count, and Android ICU BreakIterator),
 * especially for multi-codepoint sequences such as ZWJ emojis and decomposed (NFD) Hangul.
 *
 * Applying this small margin in JS ensures requests near the provider limit are safely
 * rejected in JS and routed to deterministic fallback rather than hitting a hard native rejection.
 */
export const JS_GRAPHEME_SAFETY_MARGIN = 16;

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
 * Classifies the overall briefing generation based on verified vs eligible text events.
 */
export function classifyBriefingGeneration(
  totalAiEligibleEvents: number,
  verifiedAiEvents: number,
): BriefingGeneration {
  if (totalAiEligibleEvents === 0 || verifiedAiEvents === 0) {
    return 'deterministic';
  }
  if (verifiedAiEvents === totalAiEligibleEvents) {
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
 * Proves whether a set of request items fits within the provider envelope for the actual
 * request serialization, the expected response serialization (v2 grouping plan), AND the
 * provider's aggregate grapheme limit.
 *
 * The grapheme half was missing, and `maxInputTextGraphemes` means different things on the
 * two sides of the bridge if you only read one of them. Both native parsers run a single
 * running total across EVERY candidate text in the WHOLE request
 * (`OnDeviceBriefingPlugin.swift`: `totalGraphemes += text.count` then a bounds guard;
 * `OnDeviceBriefingPlugin.kt`: the same with `engine.countGraphemes`), and reject the
 * entire request the moment it is exceeded. The batcher only ever proved bytes, so it
 * happily assembled a batch that was byte-legal and grapheme-illegal; native then hard-
 * rejected it and the whole batch fell to deterministic output with no signal. This makes
 * the JS check mean exactly what the native check means.
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

  /*
    0. Structural proof, first, and against the limits the DEVICE enforces.

    Step 2 below reads `item.candidates.length`, so a malformed item used to throw a
    TypeError out of a function whose entire contract is to answer true/false. A throw
    here is not fail-closed -- it escapes the batcher instead of sending the segment to
    the deterministic path.

    The count limits are the ones the audit reproduced: a record that segments into 33
    sentences produced an item JS accepted and both native parsers rejected outright
    (`maxCandidatesPerItem` is 32), so a supported device silently fell back to
    deterministic output. Nothing is trimmed to make it fit -- keeping the first 32
    candidates would put a set that is no longer the exact source in front of the model,
    and the caller's deterministic path already handles the record correctly.
  */
  if (items.length === 0 || items.length > envelope.maxItems) {
    return false;
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || typeof item !== 'object' || !Array.isArray(item.candidates)) {
      return false;
    }
    // Both native parsers require `itemOrdinal == parsed.count`, i.e. dense 0..N-1 in
    // array order. An out-of-order ordinal is rejected there, so it must be rejected here.
    if (item.itemOrdinal !== i) {
      return false;
    }
    if (item.candidates.length === 0 || item.candidates.length > envelope.maxCandidatesPerItem) {
      return false;
    }
    for (let c = 0; c < item.candidates.length; c += 1) {
      const candidate = item.candidates[c];
      if (!candidate || typeof candidate !== 'object' || typeof candidate.text !== 'string') {
        return false;
      }
      if (candidate.candidateOrdinal !== c) {
        return false;
      }
      // Native also requires a non-blank text.
      if (candidate.text.trim().length === 0) {
        return false;
      }
    }
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

  // 2. Maximum response JSON UTF-8 bytes proof (v2 group plan).
  // Singleton groups are deliberately budgeted even though the verifier may
  // enforce tighter grouping, so future legal shapes cannot exceed the reserve.
  const expectedResponse: UntrustedBriefingGroupPlan = {
    version: 2,
    groups: items.map((item, idx) => ({
      groupOrdinal: idx,
      choices: [
        {
          itemOrdinal: idx,
          candidateOrdinal: Math.max(0, item.candidates.length - 1),
        },
      ],
    })),
  };
  const responseBytes = getUtf8ByteLength(JSON.stringify(expectedResponse));
  if (responseBytes > envelope.responseReserveUtf8Bytes) {
    return false;
  }

  // 3. Aggregate grapheme proof across every candidate of every item, in the same
  //    order and with the same running-total semantics the native parsers use.
  //    A conservative safety margin is applied in JS so that platform segmentation
  //    differences (e.g. ZWJ emoji sequences, NFD Hangul) near the boundary are rejected
  //    here to deterministic fallback rather than hitting native hard limits.
  const maxAllowedGraphemes = Math.max(
    0,
    envelope.maxInputTextGraphemes - JS_GRAPHEME_SAFETY_MARGIN,
  );
  let totalGraphemes = 0;
  for (const item of items) {
    for (const candidate of item.candidates) {
      const graphemes = countGraphemes(candidate.text);
      // `null` means this runtime has no usable Intl.Segmenter, so the count cannot be
      // proven. Fail closed to the deterministic path rather than guessing a count or
      // trimming the text -- a truncated candidate would no longer be the exact source.
      if (graphemes === null) {
        return false;
      }
      totalGraphemes += graphemes;
      if (totalGraphemes > maxAllowedGraphemes) {
        return false;
      }
    }
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
  if (externalSignal?.aborted || timeoutMs <= 0) {
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
  if (timeoutMs <= 0) {
    return { ok: false, requestId, code: 'timeout' };
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

export interface PreparedExtractSegment {
  readonly segmentId: number;
  readonly sourceOrdinal: number;
  readonly candidates: readonly BriefingExtractCandidate[];
}

export interface ExtractBatch {
  readonly items: readonly BriefingExtractRequestItem[];
  readonly segments: readonly PreparedExtractSegment[];
  readonly dayOrdinal?: number;
  readonly period?: BriefingPeriod;
}

/**
 * Deterministically batches candidate items while proving envelope constraints.
 */
export function batchCandidateSegments(
  segments: readonly PreparedExtractSegment[],
  envelope: BriefingProviderEnvelope,
  metadata?: { dayOrdinal: number; period: BriefingPeriod },
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
          dayOrdinal: metadata?.dayOrdinal,
          period: metadata?.period,
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
      dayOrdinal: metadata?.dayOrdinal,
      period: metadata?.period,
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

  // Track single total run deadline across availability, capability, and all batches
  const startTime = Date.now();
  const getRemainingBudgetMs = (): number => {
    const elapsed = Date.now() - startTime;
    return timeoutMs - elapsed;
  };

  const availBudget = getRemainingBudgetMs();
  if (availBudget <= 0) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  // 2. Check provider availability (bounded by remaining deadline / abort, with sync throw isolation)
  const availability = await executeWithBoundedTimeout(
    (s) => provider.getAvailability({ signal: s, locale }),
    availBudget,
    signal,
  );

  if (availability !== 'ready' || signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  const capBudget = getRemainingBudgetMs();
  if (capBudget <= 0) {
    return generateDeterministicPartnerBriefing({ events, sources, days, locale });
  }

  // 3. Query and strictly validate provider capability envelope (bounded by remaining deadline / abort)
  const rawCapability = await executeWithBoundedTimeout(
    () => provider.getCapability(),
    capBudget,
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

  const { modelChunks, deterministicFallbackSourceOrdinals } = chunkResult;
  const forcedFallbackOrdinals = new Set<number>(deterministicFallbackSourceOrdinals);

  // Identify any event split into multiple segments; force it to stay deterministic singleton
  const eventAppearanceCount = new Map<number, number>();
  for (const chunk of modelChunks) {
    for (const evt of chunk.events) {
      eventAppearanceCount.set(evt.ordinal, (eventAppearanceCount.get(evt.ordinal) ?? 0) + 1);
    }
  }
  for (const [ord, count] of eventAppearanceCount.entries()) {
    if (count > 1) {
      forcedFallbackOrdinals.add(ord);
    }
  }

  // 5. Organize events into contiguous (dayOrdinal, period) runs, preserving chronology.
  //    Keyed by `${day}_${period}` this merged the two halves of a midnight-spanning
  //    `night` into one bucket, so a group could join a 00:30 record to a 22:30 one with
  //    the whole day in between and still look period-isolated.
  const runsByDay = groupEventsIntoChronologicalRuns(events);
  const chronologicalRuns: Array<{
    readonly dayOrdinal: number;
    readonly period: BriefingPeriod;
    readonly events: readonly BriefingModelSafeEvent[];
  }> = [];
  for (const dayOrdinal of Array.from(runsByDay.keys()).sort((a, b) => a - b)) {
    for (const run of runsByDay.get(dayOrdinal)!) {
      chronologicalRuns.push({ dayOrdinal, period: run.period, events: run.events });
    }
  }

  // 6. Build batches per contiguous run to enforce day/period request isolation
  const allBatches: ExtractBatch[] = [];
  const totalAiEligibleOrdinals = new Set<number>();
  let nextSegmentId = 0;

  for (const chronoRun of chronologicalRuns) {
    const { dayOrdinal, period } = chronoRun;
    const periodEvts = chronoRun.events;

    let contiguousRun: PreparedExtractSegment[] = [];

    const flushContiguousRun = () => {
      if (contiguousRun.length === 0) {
        return;
      }

      const segmentsById = new Map(
        contiguousRun.map((segment) => [segment.segmentId, segment]),
      );
      const { batches, unfittableSegmentIds } = batchCandidateSegments(
        contiguousRun,
        envelope,
        { dayOrdinal, period },
      );

      for (const unfittableId of unfittableSegmentIds) {
        const segment = segmentsById.get(unfittableId);
        if (segment) {
          totalAiEligibleOrdinals.delete(segment.sourceOrdinal);
          forcedFallbackOrdinals.add(segment.sourceOrdinal);
        }
      }

      allBatches.push(...batches);
      contiguousRun = [];
    };

    for (const evt of periodEvts) {
      let candidates: readonly BriefingExtractCandidate[] = [];
      if (
        !forcedFallbackOrdinals.has(evt.ordinal) &&
        typeof evt.text === 'string' &&
        evt.text.trim().length > 0 &&
        // P1-1 value gate. The normalizer removes record METADATA but copies the partner's
        // log body verbatim, so a UUID, Storage path, signed URL or key marker typed INTO a
        // shared record would otherwise cross the native boundary as candidate text. A risky
        // source is withheld from the model entirely rather than redacted: it keeps its
        // ordinal and is rendered from its exact source by the deterministic path below, so
        // coverage and provenance are unchanged.
        findBriefingModelInputRisk(evt.text) === null
      ) {
        candidates = buildBriefingExtractCandidates(evt.text, locale);
      }

      if (candidates.length === 0) {
        // A withheld source lands here alongside media-only and empty ones: it is never added
        // to `totalAiEligibleOrdinals`, so it neither reaches a batch nor counts against the
        // verified ratio, and step 8 renders it from its exact source like any other event
        // with no built item.
        flushContiguousRun();
        continue;
      }

      totalAiEligibleOrdinals.add(evt.ordinal);
      contiguousRun.push({
        segmentId: nextSegmentId++,
        sourceOrdinal: evt.ordinal,
        candidates,
      });
    }

    flushContiguousRun();
  }

  // 7. Execute batches sequentially with provider under single total run deadline
  const verifiedGroupsByBatch = new Map<number, readonly VerifiedBriefingGroup[]>();
  const batchSuccess = new Map<number, boolean>();

  for (let batchIdx = 0; batchIdx < allBatches.length; batchIdx += 1) {
    const batch = allBatches[batchIdx];

    if (signal?.aborted) {
      batchSuccess.set(batchIdx, false);
      continue;
    }

    const remainingBudget = getRemainingBudgetMs();
    if (remainingBudget <= 0) {
      batchSuccess.set(batchIdx, false);
      continue;
    }

    const requestId = generateOpaqueRequestId();
    if (!requestId) {
      batchSuccess.set(batchIdx, false);
      continue;
    }

    const request: BriefingExtractRequest = {
      requestId,
      items: batch.items,
    };

    if (!canItemsFitInEnvelope(request.items, envelope, requestId)) {
      batchSuccess.set(batchIdx, false);
      continue;
    }

    /*
      Last line of TypeScript before the native call.

      Every candidate here is a substring of a source the value gate already cleared, so this
      is expected to pass; it is asserted rather than assumed because the batch is assembled
      across several steps and a future change to candidate building must not be able to
      reintroduce P1-1 silently. Failing the batch sends exactly these segments to the
      deterministic exact-source path, which is the same handling as any other batch failure.
    */
    if (findBriefingRequestItemsRisk(request.items) !== null) {
      batchSuccess.set(batchIdx, false);
      continue;
    }

    const providerResult = await executeProviderSelectExtractsWithTimeout(
      provider,
      request,
      remainingBudget,
      signal,
      locale,
    );

    const verifyResult = verifyBriefingExtractResult({
      expectedRequestId: requestId,
      requestedItems: request.items,
      providerResult,
    });

    if (verifyResult.ok) {
      batchSuccess.set(batchIdx, true);
      verifiedGroupsByBatch.set(batchIdx, verifyResult.groups);
    } else {
      batchSuccess.set(batchIdx, false);
    }
  }

  // 8. Build final PartnerBriefing items and hierarchy
  const verifiedOnDeviceOrdinals = new Set<number>();

  const builtItemByStartOrdinal = new Map<
    number,
    { readonly item: PartnerBriefingItem; readonly sourceOrdinals: readonly number[] }
  >();
  for (let batchIdx = 0; batchIdx < allBatches.length; batchIdx += 1) {
    const batch = allBatches[batchIdx];
    const isSuccess = batchSuccess.get(batchIdx) === true;
    const groups = verifiedGroupsByBatch.get(batchIdx);

    if (isSuccess && groups) {
      for (const group of groups) {
        const sourceOrdinals = group.choices.map(
          (choice) => batch.segments[choice.itemOrdinal].sourceOrdinal,
        );
        const parts = group.choices.map((choice) => {
          const seg = batch.segments[choice.itemOrdinal];
          const cand = seg.candidates[choice.candidateOrdinal];
          verifiedOnDeviceOrdinals.add(seg.sourceOrdinal);
          return {
            text: formatAttributedBriefingItemText(cand.text, locale),
            sourceRecordId: sourceMap.get(seg.sourceOrdinal)!,
          };
        });

        builtItemByStartOrdinal.set(sourceOrdinals[0], {
          item: { parts },
          sourceOrdinals,
        });
      }
    } else {
      // Fallback: each segment becomes its own individual item with candidate 0 extract
      for (const seg of batch.segments) {
        builtItemByStartOrdinal.set(seg.sourceOrdinal, {
          item: {
            parts: [
              {
                text: formatAttributedBriefingItemText(seg.candidates[0].text, locale),
                sourceRecordId: sourceMap.get(seg.sourceOrdinal)!,
              },
            ],
          },
          sourceOrdinals: [seg.sourceOrdinal],
        });
      }
    }
  }

  const resultDays: PartnerBriefingDay[] = [];
  const allDates: string[] = [];
  const sortedDayOrdinals = Array.from(runsByDay.keys()).sort((a, b) => a - b);

  for (const dayOrdinal of sortedDayOrdinals) {
    const date = dayMap.get(dayOrdinal)!;
    allDates.push(date);
    const sections: PartnerBriefingSection[] = [];

    // Same contiguous runs the batches were built from, so a verified group always has
    // a run to land in and the day still reads in the order it happened.
    for (const run of runsByDay.get(dayOrdinal)!) {
      const period = run.period;
      const periodEvents = run.events;
      const sectionItems: PartnerBriefingItem[] = [];

      let eventIdx = 0;
      while (eventIdx < periodEvents.length) {
        const evt = periodEvents[eventIdx];
        const built = builtItemByStartOrdinal.get(evt.ordinal);
        const isExactContiguousMatch =
          built !== undefined &&
          built.sourceOrdinals.every(
            (ordinal, offset) => periodEvents[eventIdx + offset]?.ordinal === ordinal,
          );

        if (built && isExactContiguousMatch) {
          sectionItems.push(built.item);
          eventIdx += built.sourceOrdinals.length;
          continue;
        }

        sectionItems.push({
          parts: [
            {
              text: formatDeterministicBriefingItemText(evt, locale),
              sourceRecordId: sourceMap.get(evt.ordinal)!,
            },
          ],
        });
        eventIdx += 1;
      }

      sections.push({
        period,
        items: sectionItems,
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

  const generation = classifyBriefingGeneration(
    totalAiEligibleOrdinals.size,
    verifiedOnDeviceOrdinals.size,
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
