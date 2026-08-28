/**
 * Partner Briefing Hierarchical Pipeline and Concurrency Controller (Gate A7)
 *
 * Coordinates on-device briefing generation across availability checks, chunking,
 * sequential leaf execution, semantic verification, recursive multi-pass hierarchical reduction,
 * fail-closed fallback, and concurrency cancellation.
 *
 * Architectural invariants:
 * 1. Model-safe payloads: AI sees only synthetic request-local ordinals, coarse periods,
 *    normalized text, and media kinds. Zero real record IDs, user IDs, or exact dates.
 * 2. Conservative limits & no Top-N: Verifier limits are derived directly from capability.
 *    Response reserve is never inflated; timeoutMs is strictly validated.
 * 3. Robust partial failure: A failed/timed-out leaf falls back only for that leaf,
 *    preserving verified sibling leaves.
 * 4. Deterministic provenance: Every section's sourceRecordIds are strictly bound by
 *    TypeScript after all verification completes. Leaf verification uses exact verified
 *    sourceOrdinals directly without double-indexing.
 * 5. Strict reduction progress & no arbitrary depth cap: Reduction termination is guaranteed
 *    by strict node count monotonicity (nextNodes.length < currentNodes.length).
 *    If progress stalls or fails, deterministic group fallback is used with exact source union.
 * 6. Displayed-output generation classification: Generation is strictly based on displayed output.
 *    If a model leaf is replaced by a deterministic group fallback, it does not taint displayed
 *    generation with on_device lineage. If no model output is displayed, generation is 'deterministic'.
 * 7. Long single record fallback deduplication: Fallback text/counts for partitioned/segmented
 *    events use unique source ordinals to prevent over-counting a single record as multiple records.
 * 8. Exact source coverage: The union of all final day sections' actual source ordinals,
 *    and the overview's actual source ordinals, must equal 0..N-1 with zero unknown ordinals.
 * 9. Hardened runtime trust boundaries: Synchronous throws from provider methods (getAvailability,
 *    getCapability, summarize, cancel) are fully isolated and converted to safe fallbacks.
 *    Capability shapes are strictly validated before inspection.
 * 10. Concurrency & zero listener leak: Clean named cleanup for all abort listeners.
 * 11. Zero persistence, zero logging, zero network/server AI.
 */

import {
  PARTNER_BRIEFING_VERSION,
  type BriefingGeneration,
  type BriefingModelSafeEvent,
  type BriefingPeriod,
  type BriefingSourceMapping,
  type PartnerBriefing,
  type PartnerBriefingDay,
  type PartnerBriefingOverview,
  type PartnerBriefingSection,
} from './contract';
import {
  chunkPartnerBriefingEvents,
  isValidProviderEnvelope,
  type BriefingModelChunk,
  type BriefingProviderEnvelope,
} from './chunk';
import type { BriefingDayMapping } from './normalize';
import type {
  BriefingProvider,
  BriefingProviderResult,
} from './provider';
import {
  verifyBriefingProviderResult,
  type BriefingVerifyLimits,
} from './verify';
import {
  formatFallbackOverviewText,
  formatFallbackPeriodText,
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
}
export interface InternalBriefingNode {
  readonly dayOrdinal: number;
  readonly period: BriefingPeriod;
  readonly text: string;
  readonly actualSourceOrdinals: readonly number[];
  readonly hasOnDevice: boolean;
  readonly hasDeterministic: boolean;
  readonly firstSourceOrdinal: number;
}

function isValidOrdinalNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

export function computeSortedUniqueUnion(
  arrays: readonly (readonly number[])[],
): readonly number[] {
  const set = new Set<number>();
  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (isValidOrdinalNumber(item)) {
          set.add(item);
        }
      }
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function areOrdinalSetsEqual(
  a: readonly number[],
  b: readonly number[],
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  for (const item of a) {
    if (!isValidOrdinalNumber(item)) return false;
  }
  for (const item of b) {
    if (!isValidOrdinalNumber(item)) return false;
  }
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== a.length || setB.size !== b.length) {
    return false;
  }
  if (setA.size !== setB.size) {
    return false;
  }
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

/**
 * Derives conservative verification limits from chunk and provider envelope.
 * Response reserve is strictly bounded by provider capability and never inflated.
 */
export function deriveVerifyLimits(
  chunk: BriefingModelChunk,
  envelope: BriefingProviderEnvelope,
): BriefingVerifyLimits | null {
  if (
    !isValidProviderEnvelope(envelope) ||
    !Number.isSafeInteger(envelope.responseReserveUtf8Bytes) ||
    envelope.responseReserveUtf8Bytes <= 0
  ) {
    return null;
  }

  const maxBytes = envelope.responseReserveUtf8Bytes;
  const maxSections = Math.min(
    maxBytes,
    Math.max(1, chunk.events.length * 2),
  );

  return {
    maxSections,
    maxSectionUtf8Bytes: maxBytes,
    maxTotalUtf8Bytes: maxBytes,
    maxSectionGraphemes: envelope.maxInputTextGraphemes,
  };
}

function generateOpaqueRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
 * Executes a provider summarize call with explicit timeout, abort signal handling,
 * cancellation notification on timeout/abort, zero listener leaks, and synchronous throw isolation.
 */
async function executeProviderCallWithTimeout(
  provider: BriefingProvider,
  requestId: string,
  chunk: BriefingModelChunk,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<BriefingProviderResult> {
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
  const abortPromise = new Promise<BriefingProviderResult>((resolve) => {
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

  const timeoutPromise = new Promise<BriefingProviderResult>((resolve) => {
    timer = setTimeout(() => {
      didTimeout = true;
      internalController.abort();
      safeCancel();
      resolve({ ok: false, requestId, code: 'timeout' });
    }, timeoutMs);
  });

  try {
    const summarizePromise = Promise.resolve()
      .then(() =>
        provider.summarize(
          { requestId, chunk },
          { signal: internalController.signal },
        ),
      )
      .catch((): BriefingProviderResult => {
        return {
          ok: false,
          requestId,
          code: internalController.signal.aborted ? 'cancelled' : 'native_error',
        };
      });

    const result = await Promise.race([summarizePromise, timeoutPromise, abortPromise]);
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

/**
 * Recursively reduces a group of internal nodes into exactly one compressed node.
 * Uses provider structured compression where possible, and strictly falls back
 * to deterministic grouping if progress stalls or verification fails.
 */
export async function recursivelyReduceNodeGroup(
  nodes: readonly InternalBriefingNode[],
  targetDayOrdinal: number,
  targetPeriod: BriefingPeriod,
  allEvents: readonly BriefingModelSafeEvent[],
  envelope: BriefingProviderEnvelope,
  provider: BriefingProvider,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fallbackTextFormatter: (events: readonly BriefingModelSafeEvent[]) => string,
): Promise<InternalBriefingNode> {
  const targetSourceUnion = computeSortedUniqueUnion(
    nodes.map((n) => n.actualSourceOrdinals),
  );
  const groupEvents = targetSourceUnion.map((ord) => allEvents[ord]);

  if (nodes.length === 0) {
    return {
      dayOrdinal: targetDayOrdinal,
      period: targetPeriod,
      text: '',
      actualSourceOrdinals: [],
      hasOnDevice: false,
      hasDeterministic: true,
      firstSourceOrdinal: 0,
    };
  }

  if (nodes.length === 1) {
    if (areOrdinalSetsEqual(nodes[0].actualSourceOrdinals, targetSourceUnion)) {
      return nodes[0];
    }
  }

  let currentNodes = [...nodes];

  while (currentNodes.length > 1 && !signal?.aborted) {
    // 1. Synthesize request-local events for the current reduction level
    const childEvents: BriefingModelSafeEvent[] = currentNodes.map((n, idx) => ({
      ordinal: idx,
      dayOrdinal: 0,
      period: 'morning' as BriefingPeriod,
      text: n.text,
      mediaKinds: [],
    }));

    // 2. Chunk request-local events against envelope
    const reduceChunkResult = chunkPartnerBriefingEvents(childEvents, envelope);
    if (
      !reduceChunkResult.ok ||
      reduceChunkResult.modelChunks.length === 0 ||
      reduceChunkResult.modelChunks.length >= currentNodes.length
    ) {
      // Cannot reduce further via model chunks in this pass
      break;
    }

    const passOutputs: InternalBriefingNode[] = [];
    let passFailed = false;

    // 3. Process any deterministic fallback child ordinals (e.g. unsegmented/oversized child)
    for (const fallbackLocalOrd of reduceChunkResult.deterministicFallbackSourceOrdinals) {
      const child = currentNodes[fallbackLocalOrd];
      passOutputs.push({
        dayOrdinal: targetDayOrdinal,
        period: targetPeriod,
        text: child.text,
        actualSourceOrdinals: child.actualSourceOrdinals,
        hasOnDevice: child.hasOnDevice,
        hasDeterministic: child.hasDeterministic,
        firstSourceOrdinal: child.firstSourceOrdinal,
      });
    }

    // 4. Process model reduction chunks sequentially
    for (const redChunk of reduceChunkResult.modelChunks) {
      if (signal?.aborted) {
        passFailed = true;
        break;
      }

      const redRequestId = generateOpaqueRequestId();
      const redResult = await executeProviderCallWithTimeout(
        provider,
        redRequestId,
        redChunk,
        timeoutMs,
        signal,
      );

      const redLimits = deriveVerifyLimits(redChunk, envelope);
      const redVerify = redLimits
        ? verifyBriefingProviderResult({
            expectedRequestId: redRequestId,
            requestedSourceOrdinals: redChunk.sourceOrdinals,
            providerResult: redResult,
            limits: redLimits,
          })
        : { ok: false as const };

      if (redVerify.ok && redVerify.sections.length > 0) {
        // Map local child ordinals back to strictly sorted unique actual source union
        const chunkActualOrds = computeSortedUniqueUnion(
          redChunk.sourceOrdinals.map(
            (localOrd) => currentNodes[localOrd].actualSourceOrdinals,
          ),
        );
        const verifiedSectionsUnion: number[] = [];

        for (const sec of redVerify.sections) {
          const actualOrds = computeSortedUniqueUnion(
            sec.sourceOrdinals.map(
              (localOrd) => currentNodes[localOrd].actualSourceOrdinals,
            ),
          );
          for (const ord of actualOrds) {
            verifiedSectionsUnion.push(ord);
          }
          const hasDeterministic = sec.sourceOrdinals.some(
            (localOrd) => currentNodes[localOrd].hasDeterministic,
          );
          passOutputs.push({
            dayOrdinal: targetDayOrdinal,
            period: targetPeriod,
            text: sec.text,
            actualSourceOrdinals: actualOrds,
            hasOnDevice: true,
            hasDeterministic,
            firstSourceOrdinal: actualOrds[0] ?? 0,
          });
        }

        const chunkVerifiedUnion = computeSortedUniqueUnion([
          verifiedSectionsUnion,
        ]);
        if (!areOrdinalSetsEqual(chunkVerifiedUnion, chunkActualOrds)) {
          // Incomplete source coverage in reduction: mark pass failed
          passFailed = true;
          break;
        }
      } else {
        // Chunk reduction failed: replace with deterministic text for this reduction chunk
        const chunkActualOrds = computeSortedUniqueUnion(
          redChunk.sourceOrdinals.map(
            (localOrd) => currentNodes[localOrd].actualSourceOrdinals,
          ),
        );
        const chunkEvts = chunkActualOrds.map((ord) => allEvents[ord]);
        const fallbackText = fallbackTextFormatter(chunkEvts);
        passOutputs.push({
          dayOrdinal: targetDayOrdinal,
          period: targetPeriod,
          text: fallbackText,
          actualSourceOrdinals: chunkActualOrds,
          hasOnDevice: false,
          hasDeterministic: true,
          firstSourceOrdinal: chunkActualOrds[0] ?? 0,
        });
      }
    }

    // 5. Strict progress & source union integrity checks
    if (passFailed) {
      break;
    }

    passOutputs.sort((a, b) => a.firstSourceOrdinal - b.firstSourceOrdinal);

    // Monotonicity termination: must strictly reduce node count
    if (
      passOutputs.length >= currentNodes.length ||
      passOutputs.length === 0
    ) {
      break;
    }

    const passUnion = computeSortedUniqueUnion(
      passOutputs.map((n) => n.actualSourceOrdinals),
    );
    if (!areOrdinalSetsEqual(passUnion, targetSourceUnion)) {
      break;
    }

    currentNodes = passOutputs;
  }

  if (
    currentNodes.length === 1 &&
    areOrdinalSetsEqual(currentNodes[0].actualSourceOrdinals, targetSourceUnion)
  ) {
    return currentNodes[0];
  }

  // Fallback to single deterministic node for this whole group
  const fallbackText = fallbackTextFormatter(groupEvents);

  return {
    dayOrdinal: targetDayOrdinal,
    period: targetPeriod,
    text: fallbackText,
    actualSourceOrdinals: targetSourceUnion,
    hasOnDevice: false,
    hasDeterministic: true,
    firstSourceOrdinal: targetSourceUnion[0] ?? 0,
  };
}

/**
 * Classifies the overall briefing generation based on displayed section lineages.
 */
export function classifyBriefingGeneration(
  sections: readonly InternalBriefingNode[],
  overviewHasOnDevice: boolean,
  overviewHasDeterministic: boolean,
): BriefingGeneration {
  if (sections.length === 0) {
    return 'deterministic';
  }

  const hasOnDevice =
    overviewHasOnDevice || sections.some((s) => s.hasOnDevice);
  const hasDeterministic =
    overviewHasDeterministic || sections.some((s) => s.hasDeterministic);

  if (hasOnDevice && !hasDeterministic) {
    return 'on_device';
  }
  if (hasOnDevice && hasDeterministic) {
    return 'hybrid';
  }
  return 'deterministic';
}

/**
 * Safely extracts and validates capability envelope without runtime TypeError.
 */
function extractValidEnvelope(capability: unknown): BriefingProviderEnvelope | null {
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

export async function runPartnerBriefingPipeline(
  input: PartnerBriefingPipelineInput,
): Promise<PartnerBriefing> {
  const { events, sources, days, provider, timeoutMs, signal } = input;

  // 1. Fail-closed input and mapping validation
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive safe integer.');
  }

  const { sourceMap, dayMap } = validateBriefingMappings(events, sources, days);

  if (events.length === 0) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  if (signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  // 2. Check provider availability (bounded by timeout/abort, with sync throw isolation)
  const availability = await executeWithBoundedTimeout(
    (s) => provider.getAvailability({ signal: s }),
    timeoutMs,
    signal,
  );

  if (availability !== 'ready' || signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  // 3. Query and strictly validate provider capability envelope (bounded by timeout/abort)
  const rawCapability = await executeWithBoundedTimeout(
    () => provider.getCapability(),
    timeoutMs,
    signal,
  );

  const envelope = extractValidEnvelope(rawCapability);
  if (!envelope || signal?.aborted) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  // 4. Deterministic chunking (Phase A4)
  const chunkResult = chunkPartnerBriefingEvents(events, envelope);
  if (!chunkResult.ok) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  const { modelChunks, deterministicFallbackSourceOrdinals } = chunkResult;
  const leafNodes: InternalBriefingNode[] = [];

  // 5. Process model leaf chunks sequentially
  for (const chunk of modelChunks) {
    const chunkUniqueOrds = computeSortedUniqueUnion([chunk.sourceOrdinals]);
    const chunkUniqueEvents = chunkUniqueOrds.map((ord) => events[ord]);

    if (signal?.aborted) {
      leafNodes.push({
        dayOrdinal: chunk.dayOrdinal,
        period: chunk.period,
        text: formatFallbackPeriodText(chunkUniqueEvents),
        actualSourceOrdinals: chunkUniqueOrds,
        hasOnDevice: false,
        hasDeterministic: true,
        firstSourceOrdinal: chunkUniqueOrds[0] ?? 0,
      });
      continue;
    }

    const requestId = generateOpaqueRequestId();
    const providerResult = await executeProviderCallWithTimeout(
      provider,
      requestId,
      chunk,
      timeoutMs,
      signal,
    );

    const limits = deriveVerifyLimits(chunk, envelope);
    if (!limits) {
      leafNodes.push({
        dayOrdinal: chunk.dayOrdinal,
        period: chunk.period,
        text: formatFallbackPeriodText(chunkUniqueEvents),
        actualSourceOrdinals: chunkUniqueOrds,
        hasOnDevice: false,
        hasDeterministic: true,
        firstSourceOrdinal: chunkUniqueOrds[0] ?? 0,
      });
      continue;
    }

    const verifyResult = verifyBriefingProviderResult({
      expectedRequestId: requestId,
      requestedSourceOrdinals: chunk.sourceOrdinals,
      providerResult,
      limits,
    });

    if (verifyResult.ok) {
      const tempLeafNodes: InternalBriefingNode[] = [];
      const verifiedLeafUnion: number[] = [];

      for (const sec of verifyResult.sections) {
        // sec.sourceOrdinals are exact global source ordinals verified against chunk.sourceOrdinals
        const actualOrds = computeSortedUniqueUnion([sec.sourceOrdinals]);
        for (const ord of actualOrds) {
          verifiedLeafUnion.push(ord);
        }
        tempLeafNodes.push({
          dayOrdinal: chunk.dayOrdinal,
          period: chunk.period,
          text: sec.text,
          actualSourceOrdinals: actualOrds,
          hasOnDevice: true,
          hasDeterministic: false,
          firstSourceOrdinal: actualOrds[0] ?? 0,
        });
      }

      const leafActualUnion = computeSortedUniqueUnion([verifiedLeafUnion]);
      if (areOrdinalSetsEqual(leafActualUnion, chunkUniqueOrds)) {
        for (const node of tempLeafNodes) {
          leafNodes.push(node);
        }
      } else {
        // Incomplete coverage fallback for this leaf
        leafNodes.push({
          dayOrdinal: chunk.dayOrdinal,
          period: chunk.period,
          text: formatFallbackPeriodText(chunkUniqueEvents),
          actualSourceOrdinals: chunkUniqueOrds,
          hasOnDevice: false,
          hasDeterministic: true,
          firstSourceOrdinal: chunkUniqueOrds[0] ?? 0,
        });
      }
    } else {
      // Leaf failure: fallback only for this leaf chunk
      leafNodes.push({
        dayOrdinal: chunk.dayOrdinal,
        period: chunk.period,
        text: formatFallbackPeriodText(chunkUniqueEvents),
        actualSourceOrdinals: chunkUniqueOrds,
        hasOnDevice: false,
        hasDeterministic: true,
        firstSourceOrdinal: chunkUniqueOrds[0] ?? 0,
      });
    }
  }

  // 6. Process deterministic fallback ordinals from chunking (e.g. unsegmented/large)
  if (deterministicFallbackSourceOrdinals.length > 0) {
    const fallbackOrdSet = new Set(deterministicFallbackSourceOrdinals);
    const fallbackEvents = events.filter((e) => fallbackOrdSet.has(e.ordinal));

    const fallbackGroups = new Map<string, BriefingModelSafeEvent[]>();
    for (const fbEvent of fallbackEvents) {
      const key = `${fbEvent.dayOrdinal}_${fbEvent.period}`;
      let grp = fallbackGroups.get(key);
      if (!grp) {
        grp = [];
        fallbackGroups.set(key, grp);
      }
      grp.push(fbEvent);
    }

    for (const grpEvents of fallbackGroups.values()) {
      const actualOrds = computeSortedUniqueUnion([grpEvents.map((e) => e.ordinal)]);
      const uniqueGrpEvents = actualOrds.map((ord) => events[ord]);
      leafNodes.push({
        dayOrdinal: grpEvents[0].dayOrdinal,
        period: grpEvents[0].period,
        text: formatFallbackPeriodText(uniqueGrpEvents),
        actualSourceOrdinals: actualOrds,
        hasOnDevice: false,
        hasDeterministic: true,
        firstSourceOrdinal: actualOrds[0] ?? 0,
      });
    }
  }

  // Sort leaf nodes chronologically by actual first source ordinal
  leafNodes.sort((a, b) => a.firstSourceOrdinal - b.firstSourceOrdinal);

  // 7. Day / Period Section reduction: exactly ONE section per period
  const dayPeriodSections: InternalBriefingNode[] = [];
  const nodesByDayAndPeriod = new Map<string, InternalBriefingNode[]>();

  for (const node of leafNodes) {
    const key = `${node.dayOrdinal}_${node.period}`;
    let list = nodesByDayAndPeriod.get(key);
    if (!list) {
      list = [];
      nodesByDayAndPeriod.set(key, list);
    }
    list.push(node);
  }

  for (const groupNodes of nodesByDayAndPeriod.values()) {
    const periodSectionNode = await recursivelyReduceNodeGroup(
      groupNodes,
      groupNodes[0].dayOrdinal,
      groupNodes[0].period,
      events,
      envelope,
      provider,
      timeoutMs,
      signal,
      formatFallbackPeriodText,
    );
    dayPeriodSections.push(periodSectionNode);
  }

  // Ensure day/period sections are strictly sorted chronologically
  dayPeriodSections.sort((a, b) => a.firstSourceOrdinal - b.firstSourceOrdinal);

  // Verify that all event ordinals (0..N-1) are covered by day/period sections
  const allEventsOrdinalSet = events.map((e) => e.ordinal);
  const daySectionsSourceUnion = computeSortedUniqueUnion(
    dayPeriodSections.map((s) => s.actualSourceOrdinals),
  );

  if (!areOrdinalSetsEqual(daySectionsSourceUnion, allEventsOrdinalSet)) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  // 8. Overview Hierarchical Multi-Pass Reduction
  const overviewNode = await recursivelyReduceNodeGroup(
    dayPeriodSections,
    0,
    'morning',
    events,
    envelope,
    provider,
    timeoutMs,
    signal,
    (evts) => formatFallbackOverviewText(evts, days.length),
  );

  // Verify overview actual source union
  if (!areOrdinalSetsEqual(overviewNode.actualSourceOrdinals, allEventsOrdinalSet)) {
    return generateDeterministicPartnerBriefing({ events, sources, days });
  }

  // 9. Build final PartnerBriefingDay and PartnerBriefingSection structures
  const daysByOrdinal = new Map<number, PartnerBriefingSection[]>();
  for (const sec of dayPeriodSections) {
    let daySecs = daysByOrdinal.get(sec.dayOrdinal);
    if (!daySecs) {
      daySecs = [];
      daysByOrdinal.set(sec.dayOrdinal, daySecs);
    }
    daySecs.push({
      period: sec.period,
      text: sec.text,
      sourceRecordIds: sec.actualSourceOrdinals.map((ord) => sourceMap.get(ord)!),
    });
  }

  const resultDays: PartnerBriefingDay[] = [];
  const allDates: string[] = [];
  const sortedDayOrdinals = Array.from(daysByOrdinal.keys()).sort((a, b) => a - b);

  for (const dayOrdinal of sortedDayOrdinals) {
    const date = dayMap.get(dayOrdinal)!;
    allDates.push(date);
    resultDays.push({
      date,
      sections: daysByOrdinal.get(dayOrdinal)!,
    });
  }

  const overview: PartnerBriefingOverview = {
    text: overviewNode.text,
    sourceRecordIds: overviewNode.actualSourceOrdinals.map((ord) => sourceMap.get(ord)!),
  };

  const generation = classifyBriefingGeneration(
    dayPeriodSections,
    overviewNode.hasOnDevice,
    overviewNode.hasDeterministic,
  );

  return {
    version: PARTNER_BRIEFING_VERSION,
    sourceCount: events.length,
    generation,
    rangeLabel: formatRangeLabelFromDates(allDates),
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
