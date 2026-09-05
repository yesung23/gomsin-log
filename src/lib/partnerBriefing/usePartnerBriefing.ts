/**
 * Partner Briefing React Hook (Phase B1)
 *
 * Provides the React interface for GomsinLog Partner Briefing.
 *
 * Invariants:
 * 1. Synchronous Baseline: Generates and returns a safe, deterministic Korean briefing
 *    immediately upon receiving a valid corpus (no loading blank state).
 * 2. Explicit Asynchronous Refinement: A content-free availability preflight opens the CTA; only a
 *    user request executes extract selection through PartnerBriefingRunner and verified output may replace it.
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

export type PartnerBriefingRefinementStatus =
  | 'idle'
  | 'running'
  | 'applied'
  | 'fallback'
  | 'unavailable';

export interface UsePartnerBriefingInput {
  readonly enabled: boolean;
  readonly surface: readonly DailyRecord[];
  readonly viewerUserId?: string | null;
  readonly partnerUserId?: string | null;
  readonly coupleConnected: boolean;
  readonly coupleStatus?: CoupleStatus | null;
  readonly provider?: BriefingProvider | null;
  /** 0에서는 모델을 실행하지 않는다. 사용자의 명시적 요청마다 증가시킨다. */
  readonly requestVersion?: number;
  readonly timeoutMs?: number;
  readonly locale?: BriefingLocale;
}

export interface UsePartnerBriefingResult {
  readonly status: PartnerBriefingStatus;
  readonly briefing: PartnerBriefing | null;
  readonly refinementStatus: PartnerBriefingRefinementStatus;
  readonly canRequestRefinement: boolean;
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
    requestVersion = 0,
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

  const [refinement, setRefinement] = useState<{
    inputKey: string;
    requestVersion: number;
    status: Exclude<PartnerBriefingRefinementStatus, 'idle' | 'unavailable'>;
    briefing: PartnerBriefing | null;
  } | null>(null);
  const [preflight, setPreflight] = useState<{
    inputKey: string;
    provider: BriefingProvider | null;
    locale: BriefingLocale;
    status: 'idle' | 'checking' | 'ready' | 'unavailable';
  }>({
    inputKey: '',
    provider: null,
    locale,
    status: 'idle',
  });

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
  const requestedInputRef = useRef({ requestVersion: 0, inputKey: '' });
  if (requestVersion > requestedInputRef.current.requestVersion) {
    requestedInputRef.current = { requestVersion, inputKey: currentInputKey };
  }
  const requestMatchesCurrentInput = requestVersion > 0
    && requestedInputRef.current.requestVersion === requestVersion
    && requestedInputRef.current.inputKey === currentInputKey;
  const completedRequestsRef = useRef(new Set<string>());

  /*
    CTA를 열기 전 콘텐츠 없는 지원 확인.

    기기/모델 지원 여부만 묻고 기록 본문·식별자·날짜는 보내지 않는다. 웹, 미지원
    네이티브 브리지, 준비되지 않은 모델에서는 버튼 자체를 숨겨 사용자가 실패를 먼저
    경험하지 않게 한다. 실제 생성 시점에는 runner가 같은 경계를 다시 확인한다.
  */
  useEffect(() => {
    if (
      !enabled
      || currentStatus !== 'ready'
      || !provider
      || !normalizedRef.current
    ) {
      setPreflight({
        inputKey: currentInputKey,
        provider: provider ?? null,
        locale,
        status: 'idle',
      });
      return;
    }

    const abortController = new AbortController();
    let active = true;
    setPreflight({
      inputKey: currentInputKey,
      provider,
      locale,
      status: 'checking',
    });

    void Promise.resolve()
      .then(() => provider.getAvailability({
        signal: abortController.signal,
        locale,
      }))
      .then((availability) => {
        if (!active || abortController.signal.aborted) return;
        setPreflight({
          inputKey: currentInputKey,
          provider,
          locale,
          status: availability === 'ready' ? 'ready' : 'unavailable',
        });
      })
      .catch(() => {
        if (!active || abortController.signal.aborted) return;
        setPreflight({
          inputKey: currentInputKey,
          provider,
          locale,
          status: 'unavailable',
        });
      });

    return () => {
      active = false;
      abortController.abort();
    };
  }, [enabled, currentInputKey, currentStatus, locale, provider]);

  const preflightReady = preflight.inputKey === currentInputKey
    && preflight.provider === provider
    && preflight.locale === locale
    && preflight.status === 'ready';

  useEffect(() => {
    if (
      !enabled ||
      currentStatus !== 'ready' ||
      !provider ||
      !normalizedRef.current ||
      !preflightReady ||
      !requestMatchesCurrentInput
    ) {
      runner.cancel();
      return;
    }

    const requestKey = `${requestVersion}:${currentInputKey}`;
    if (completedRequestsRef.current.has(requestKey)) return;

    const normalized = normalizedRef.current;
    const abortController = new AbortController();
    let isMounted = true;

    const { events, sources, days } = normalized;

    setRefinement({
      inputKey: currentInputKey,
      requestVersion,
      status: 'running',
      briefing: null,
    });

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

        if (!isMounted || abortController.signal.aborted) {
          return;
        }
        completedRequestsRef.current.add(requestKey);

        const refined = result !== null && result.generation !== 'deterministic';
        setRefinement({
          inputKey: currentInputKey,
          requestVersion,
          status: refined ? 'applied' : 'fallback',
          briefing: refined ? result : null,
        });
      } catch {
        if (!isMounted || abortController.signal.aborted) return;
        completedRequestsRef.current.add(requestKey);
        setRefinement({
          inputKey: currentInputKey,
          requestVersion,
          status: 'fallback',
          briefing: null,
        });
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
    preflightReady,
    requestVersion,
    requestMatchesCurrentInput,
    effectiveTimeoutMs,
    runner,
    locale,
  ]);

  if (syncEval.status !== 'ready') {
    return {
      status: syncEval.status,
      briefing: null,
      refinementStatus: 'unavailable',
      canRequestRefinement: false,
    };
  }

  const activeRefinement = refinement
    && refinement.inputKey === syncEval.inputKey
    && refinement.requestVersion === requestVersion
      ? refinement
      : null;
  const effectiveBriefing =
    activeRefinement?.briefing
      ? activeRefinement.briefing
      : syncEval.briefing;
  const preflightMatches = preflight.inputKey === syncEval.inputKey
    && preflight.provider === provider
    && preflight.locale === locale;
  const refinementAvailable = Boolean(
    provider
    && syncEval.normalized
    && preflightMatches
    && preflight.status === 'ready',
  );
  const refinementUnavailable = !provider
    || !syncEval.normalized
    || (preflightMatches && preflight.status === 'unavailable');
  const refinementStatus: PartnerBriefingRefinementStatus = refinementUnavailable
    ? 'unavailable'
    : !refinementAvailable
      ? 'idle'
    : !requestMatchesCurrentInput
      ? 'idle'
      : activeRefinement?.status ?? 'running';

  return {
    status: 'ready',
    briefing: effectiveBriefing,
    refinementStatus,
    canRequestRefinement: refinementAvailable
      && (refinementStatus === 'idle' || refinementStatus === 'fallback'),
  };
}
