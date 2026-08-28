/**
 * Partner Briefing React Hook (Phase B1)
 *
 * Provides the React interface for GomsinLog Partner Briefing.
 *
 * Invariants:
 * 1. Synchronous Baseline: Generates and returns a safe, deterministic Korean briefing
 *    immediately upon receiving a valid corpus (no loading blank state).
 * 2. Asynchronous Refinement: If an on-device provider is supplied, executes extract selection
 *    in an effect via PartnerBriefingRunner and transparently updates the briefing upon verified completion.
 * 3. Fail-Closed Boundaries: Returns 'disabled' when disabled, 'unavailable' on unresolved couple/identity
 *    or malformed chronology metadata, and 'empty' when no partner records are accepted.
 * 4. Surface Fidelity: Evaluates caller-supplied usePartnerDay().surface directly. Never recalculates OUTSTANDING.
 * 5. Concurrency & Stale Protection: Cancels in-flight runner on unmount, disabled toggle, or input change.
 *    Late/stale provider completions never overwrite current state or cause state updates after unmount.
 * 6. Stable Identity: Avoids re-triggering provider runs when input array/object references change but
 *    semantic normalized event data remains identical.
 * 7. Zero Persistence / Zero Logging: Keeps all state in-memory without localStorage, IndexedDB, files, or network AI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoupleStatus, DailyRecord } from '@/types';
import {
  DEFAULT_BRIEFING_LOCALE,
  type BriefingLocale,
  type PartnerBriefing,
} from './contract';
import { selectPartnerBriefingCorpus } from './corpus';
import {
  normalizePartnerBriefingCorpus,
  type BriefingNormalizeSuccess,
} from './normalize';
import { generateDeterministicPartnerBriefing } from './fallback';
import { PartnerBriefingRunner } from './pipeline';
import type { BriefingProvider } from './provider';

export const DEFAULT_PARTNER_BRIEFING_TIMEOUT_MS = 5000;

export type PartnerBriefingStatus =
  | 'disabled'
  | 'empty'
  | 'unavailable'
  | 'ready';

export interface UsePartnerBriefingInput {
  readonly enabled: boolean;
  readonly surface: readonly DailyRecord[];
  readonly viewerUserId?: string | null;
  readonly partnerUserId?: string | null;
  readonly coupleConnected: boolean;
  readonly coupleStatus?: CoupleStatus | null;
  readonly provider?: BriefingProvider | null;
  readonly timeoutMs?: number;
  readonly locale?: BriefingLocale;
}

export interface UsePartnerBriefingResult {
  readonly status: PartnerBriefingStatus;
  readonly briefing: PartnerBriefing | null;
}

interface SynchronousEvaluation {
  readonly status: PartnerBriefingStatus;
  readonly briefing: PartnerBriefing | null;
  readonly normalized: BriefingNormalizeSuccess | null;
  readonly inputKey: string;
}

function evaluateSynchronousBriefing(
  enabled: boolean,
  surface: readonly DailyRecord[],
  viewerUserId: string | null | undefined,
  partnerUserId: string | null | undefined,
  coupleConnected: boolean,
  coupleStatus: CoupleStatus | null | undefined,
  locale: BriefingLocale = DEFAULT_BRIEFING_LOCALE,
): SynchronousEvaluation {
  if (!enabled) {
    return {
      status: 'disabled',
      briefing: null,
      normalized: null,
      inputKey: 'disabled',
    };
  }

  const corpusResult = selectPartnerBriefingCorpus({
    surface,
    viewerUserId,
    partnerUserId,
    coupleConnected,
    coupleStatus,
  });

  if (!corpusResult.ok) {
    return {
      status: 'unavailable',
      briefing: null,
      normalized: null,
      inputKey: 'unavailable',
    };
  }

  if (corpusResult.records.length === 0) {
    return {
      status: 'empty',
      briefing: null,
      normalized: null,
      inputKey: 'empty',
    };
  }

  const normResult = normalizePartnerBriefingCorpus(corpusResult.records);
  if (!normResult.ok) {
    return {
      status: 'unavailable',
      briefing: null,
      normalized: null,
      inputKey: 'unavailable',
    };
  }

  const baseline = generateDeterministicPartnerBriefing({
    events: normResult.events,
    sources: normResult.sources,
    days: normResult.days,
    locale,
  });

  const inputKey = JSON.stringify({
    locale,
    sources: normResult.sources,
    days: normResult.days,
    events: normResult.events,
  });

  return {
    status: 'ready',
    briefing: baseline,
    normalized: normResult,
    inputKey,
  };
}

export function usePartnerBriefing(
  input: UsePartnerBriefingInput,
): UsePartnerBriefingResult {
  const {
    enabled,
    surface,
    viewerUserId,
    partnerUserId,
    coupleConnected,
    coupleStatus,
    provider,
    timeoutMs,
    locale = DEFAULT_BRIEFING_LOCALE,
  } = input;

  const syncEval = useMemo(() => {
    return evaluateSynchronousBriefing(
      enabled,
      surface,
      viewerUserId,
      partnerUserId,
      coupleConnected,
      coupleStatus,
      locale,
    );
  }, [
    enabled,
    surface,
    viewerUserId,
    partnerUserId,
    coupleConnected,
    coupleStatus,
    locale,
  ]);

  const [refined, setRefined] = useState<{
    inputKey: string;
    briefing: PartnerBriefing;
  } | null>(null);

  const runnerRef = useRef<PartnerBriefingRunner | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = new PartnerBriefingRunner();
  }
  const runner = runnerRef.current;

  const normalizedRef = useRef<BriefingNormalizeSuccess | null>(null);
  normalizedRef.current = syncEval.normalized;

  const effectiveTimeoutMs =
    typeof timeoutMs === 'number' &&
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs > 0
      ? timeoutMs
      : DEFAULT_PARTNER_BRIEFING_TIMEOUT_MS;

  const currentInputKey = syncEval.inputKey;
  const currentStatus = syncEval.status;

  useEffect(() => {
    if (
      !enabled ||
      currentStatus !== 'ready' ||
      !provider ||
      !normalizedRef.current
    ) {
      runner.cancel();
      return;
    }

    const normalized = normalizedRef.current;
    const abortController = new AbortController();
    let isMounted = true;

    const { events, sources, days } = normalized;

    void (async () => {
      try {
        const result = await runner.run({
          events,
          sources,
          days,
          provider,
          timeoutMs: effectiveTimeoutMs,
          signal: abortController.signal,
          locale,
        });

        if (!isMounted || abortController.signal.aborted || !result) {
          return;
        }

        setRefined({
          inputKey: currentInputKey,
          briefing: result,
        });
      } catch {
        // Fallback baseline is preserved on throw
      }
    })();

    return () => {
      isMounted = false;
      abortController.abort();
      runner.cancel();
    };
  }, [
    enabled,
    currentStatus,
    currentInputKey,
    provider,
    effectiveTimeoutMs,
    runner,
    locale,
  ]);

  if (syncEval.status !== 'ready') {
    return {
      status: syncEval.status,
      briefing: null,
    };
  }

  const effectiveBriefing =
    refined && refined.inputKey === syncEval.inputKey
      ? refined.briefing
      : syncEval.briefing;

  return {
    status: 'ready',
    briefing: effectiveBriefing,
  };
}
