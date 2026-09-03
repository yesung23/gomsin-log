import { useEffect, useMemo, useState } from 'react';
import type { CoupleStatus, DailyRecord } from '@/types';
import type { StoryMode } from '@/features/story/StoryViewer';
import {
  buildOnDeviceItems,
  MAX_DAILY_SUMMARY_EXCERPT_CHARS,
  MAX_DAILY_SUMMARY_MODEL_CANDIDATES,
  type OnDeviceSummaryFailure,
  type DailySummaryRefinementReason,
  type DailySummaryRefinementStatus,
} from '@/lib/dailySummary/contract';
import { selectDailySummaryCorpus } from '@/lib/dailySummary/corpus';
import { deterministicSummaryLines } from '@/lib/dailySummary/rules';
import {
  cancelOnDeviceSummary,
  onDeviceSummaryGate,
  preflightOnDeviceSummary,
  refineOnDeviceSummary,
} from '@/lib/dailySummary/nativeOnDeviceSummary';
import { verifyAndBindRefinedLines } from '@/lib/dailySummary/verify';

/**
 * 다듬어진 표지 문장, 사용자가 요청했고 계약 검증까지 끝났을 때만.
 *
 * 규칙 결과는 항상 먼저 그려진다. 이 훅은 스토리를 열었다는 이유만으로 모델을 실행하지
 * 않는다. `requestVersion`이 증가할 때만 현재 deterministic corpus를 온디바이스 모델에
 * 전달하고, 실패·timeout·미지원이면 텍스트를 건드리지 않은 채 규칙 결과를 유지한다.
 */

const NO_REFINEMENT: ReadonlyMap<string, string> = new Map();
const RETRYABLE_FAILURES = new Set<OnDeviceSummaryFailure>([
  'model_not_ready',
  'timeout',
  'cancelled',
  'native_error',
]);

export interface UseOnDeviceDailySummaryInput {
  mode: StoryMode;
  /** 이 스토리가 담은 기록. 이미 권한 판정을 통과한 목록이다. */
  records: readonly DailyRecord[];
  viewerUserId?: string;
  partnerUserId?: string;
  todayStr: string;
  coupleConnected: boolean;
  coupleStatus?: CoupleStatus;
  /** 0이면 실행하지 않는다. 사용자가 AI 버튼을 누를 때마다 증가시킨다. */
  requestVersion?: number;
}

export interface UseOnDeviceDailySummaryResult {
  refined: ReadonlyMap<string, string>;
  status: DailySummaryRefinementStatus;
  reason?: DailySummaryRefinementReason;
  canRequest: boolean;
}

export function useOnDeviceDailySummary(
  input: UseOnDeviceDailySummaryInput,
): UseOnDeviceDailySummaryResult {
  const {
    mode,
    records,
    viewerUserId,
    partnerUserId,
    todayStr,
    coupleConnected,
    coupleStatus,
    requestVersion = 0,
  } = input;
  const [preflight, setPreflight] = useState<{
    payloadKey: string;
    status: 'idle' | 'checking' | 'ready' | 'unavailable';
    reason?: OnDeviceSummaryFailure;
  }>({ payloadKey: '[]', status: 'idle' });
  const [result, setResult] = useState<{
    payloadKey: string;
    requestVersion: number;
    values: ReadonlyMap<string, string>;
    status: DailySummaryRefinementStatus;
    reason?: OnDeviceSummaryFailure;
  }>({ payloadKey: '[]', requestVersion: 0, values: NO_REFINEMENT, status: 'idle' });

  const corpus = useMemo(() => {
    if (mode !== 'today') {
      return { ok: false, rejection: 'not_partner_today' } as const;
    }
    return selectDailySummaryCorpus({
      records,
      viewerUserId,
      partnerUserId,
      todayStr,
      coupleConnected,
      coupleStatus,
    });
  }, [mode, records, viewerUserId, partnerUserId, todayStr, coupleConnected, coupleStatus]);

  const summaryLines = useMemo(
    () => corpus.ok ? deterministicSummaryLines(corpus.records) : [],
    [corpus],
  );

  /*
    내용에서 유도한 키.

    모델 입력과 로컬 재결합에 필요한 값만 담는다. `time`·`date`는 모델에 가지 않으므로
    키에도 넣지 않는다.
    스토어의 무관한 갱신으로 records 배열 신원만 바뀌어도 같은 요약을 다시 만들지 않는다.
  */
  const payloadKey = useMemo(() => {
    return JSON.stringify(summaryLines.map((line) => [
      line.recordId,
      line.text,
      line.sourceText,
      line.sourceWasTruncated,
    ]));
  }, [summaryLines]);

  const nativeGate = onDeviceSummaryGate();

  /*
    중요도 선별이 아니라 UTF-16 길이 하나만 보는 기계적 필터다.

    attachment-only/짧은 본문은 즉시 그려진 기준선에 그대로 남고 네이티브 경계에는 가지
    않는다. 후보가 여섯 개 이상이면 일부만 고르지 않고 모델 호출 전체를 생략한다.
  */
  const candidateLines = useMemo(
    () => summaryLines.filter((line) => (
      line.sourceText !== null
      && line.sourceText.length > MAX_DAILY_SUMMARY_EXCERPT_CHARS
    )),
    [summaryLines],
  );
  const candidateItems = useMemo(
    () => buildOnDeviceItems(candidateLines),
    [candidateLines],
  );
  const tooManyCandidates = candidateLines.length > MAX_DAILY_SUMMARY_MODEL_CANDIDATES;
  const candidatePayloadReady = candidateLines.length > 0
    && !tooManyCandidates
    && candidateItems.length === candidateLines.length;

  /*
    CTA 이전의 콘텐츠 없는 preflight.

    payloadKey는 로컬 stale-result 구분에만 쓰며 native에는 전달하지 않는다. 네이티브가 보는
    것은 고정 로케일뿐이다. 후보가 없거나 출시 상한을 넘으면 이 확인조차 하지 않는다.
  */
  useEffect(() => {
    let active = true;

    if (!corpus.ok || !candidatePayloadReady) {
      setPreflight({ payloadKey, status: 'idle' });
      return () => { active = false; };
    }
    if (nativeGate !== 'ready') {
      setPreflight({ payloadKey, status: 'unavailable', reason: nativeGate });
      return () => { active = false; };
    }

    setPreflight({ payloadKey, status: 'checking' });
    void preflightOnDeviceSummary().then((outcome) => {
      if (!active) return;
      setPreflight(outcome.ok
        ? { payloadKey, status: 'ready' }
        : { payloadKey, status: 'unavailable', reason: outcome.reason });
    });

    return () => { active = false; };
  }, [candidatePayloadReady, corpus.ok, nativeGate, payloadKey]);

  useEffect(() => {
    const preflightReady = preflight.payloadKey === payloadKey && preflight.status === 'ready';
    if (
      requestVersion <= 0
      || !corpus.ok
      || !candidatePayloadReady
      || nativeGate !== 'ready'
      || !preflightReady
    ) {
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'idle', reason: undefined });
      return;
    }

    let active = true;
    setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'running', reason: undefined });

    const fallback = (reason: OnDeviceSummaryFailure) => {
      if (!active) return;
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'fallback', reason });
    };

    void (async () => {
      // 출시 검증 범위는 긴 문장 최대 다섯 개, 정확히 한 번의 native generation이다.
      const outcome = await refineOnDeviceSummary(candidateItems);
      if (!active) return;
      if (!outcome.ok) {
        fallback(outcome.reason);
        return;
      }
      const bound = verifyAndBindRefinedLines(outcome.items, candidateLines, candidateItems);
      if (!bound.ok || bound.refined.size !== candidateLines.length) {
        fallback('rejected');
        return;
      }
      setResult({
        payloadKey,
        requestVersion,
        values: bound.refined,
        status: 'applied',
        reason: undefined,
      });
    })();

    return () => {
      active = false;
      cancelOnDeviceSummary();
    };
  }, [
    candidateItems,
    candidateLines,
    candidatePayloadReady,
    corpus.ok,
    nativeGate,
    payloadKey,
    preflight.payloadKey,
    preflight.status,
    requestVersion,
  ]);

  // payload나 요청 번호가 바뀐 렌더에서는 이전 모델 결과를 즉시 숨긴다.
  if (!corpus.ok) {
    return {
      refined: NO_REFINEMENT,
      status: 'unavailable',
      reason: corpus.rejection,
      canRequest: false,
    };
  }
  if (candidateLines.length === 0 || !candidatePayloadReady) {
    if (tooManyCandidates) {
      return {
        refined: NO_REFINEMENT,
        status: 'unavailable',
        reason: 'too_many_candidates',
        canRequest: false,
      };
    }
    return {
      refined: NO_REFINEMENT,
      status: 'idle',
      canRequest: false,
    };
  }
  if (nativeGate !== 'ready') {
    return {
      refined: NO_REFINEMENT,
      status: 'unavailable',
      reason: nativeGate,
      canRequest: false,
    };
  }
  if (preflight.payloadKey !== payloadKey || preflight.status === 'checking' || preflight.status === 'idle') {
    return {
      refined: NO_REFINEMENT,
      status: 'idle',
      canRequest: false,
    };
  }
  if (preflight.status === 'unavailable') {
    return {
      refined: NO_REFINEMENT,
      status: 'unavailable',
      reason: preflight.reason,
      canRequest: false,
    };
  }
  if (result.payloadKey !== payloadKey || result.requestVersion !== requestVersion) {
    return {
      refined: NO_REFINEMENT,
      status: requestVersion > 0 ? 'running' : 'idle',
      canRequest: requestVersion === 0,
    };
  }
  return {
    refined: result.values,
    status: result.status,
    reason: result.reason,
    canRequest: result.status === 'idle'
      || (result.status === 'fallback'
        && result.reason !== undefined
        && RETRYABLE_FAILURES.has(result.reason)),
  };
}
