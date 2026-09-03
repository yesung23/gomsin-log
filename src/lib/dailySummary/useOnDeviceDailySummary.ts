import { useEffect, useMemo, useState } from 'react';
import type { CoupleStatus, DailyRecord } from '@/types';
import type { StoryMode } from '@/features/story/StoryViewer';
import {
  buildAllOnDeviceBatches,
  MAX_DAILY_SUMMARY_MODEL_RECORDS,
  type OnDeviceSummaryFailure,
  type DailySummaryRefinementReason,
  type DailySummaryRefinementStatus,
  type DailySummaryLine,
} from '@/lib/dailySummary/contract';
import { selectDailySummaryCorpus } from '@/lib/dailySummary/corpus';
import { deterministicSummaryLines } from '@/lib/dailySummary/rules';
import {
  cancelOnDeviceSummary,
  onDeviceSummaryGate,
  ON_DEVICE_SUMMARY_TIMEOUT_MS,
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
  'model_unavailable',
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

  useEffect(() => {
    const serialized = JSON.parse(payloadKey) as [string, string, string | null, boolean][];
    if (serialized.length === 0 || requestVersion <= 0) {
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'idle', reason: undefined });
      return;
    }
    if (nativeGate !== 'ready') {
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'idle', reason: undefined });
      return;
    }
    if (serialized.some(([, , sourceText]) => sourceText === null)) {
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'idle', reason: undefined });
      return;
    }

    const lines: DailySummaryLine[] = serialized.map(([recordId, text, sourceText, sourceWasTruncated]) => ({
      recordId,
      text,
      sourceText,
      sourceWasTruncated,
      // 표시용 필드는 이 경로에서 쓰이지 않는다. 덮어쓰기 지도는 `recordId`만으로 만들어진다.
      time: '',
      date: '',
    }));

    const batches = buildAllOnDeviceBatches(lines);
    if (!batches) {
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'fallback', reason: 'rejected' });
      return;
    }

    let active = true;
    setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'running', reason: undefined });

    const fallback = (reason: OnDeviceSummaryFailure) => {
      if (!active) return;
      setResult({ payloadKey, requestVersion, values: NO_REFINEMENT, status: 'fallback', reason });
    };

    void (async () => {
      const merged = new Map<string, string>();
      for (const batch of batches) {
        if (!active) return;
        // Every batch gets its own native timeout. With at most 20 records this remains bounded,
        // while a slow first batch cannot steal the budget from a later independent batch.
        const outcome = await refineOnDeviceSummary(batch.items, { timeoutMs: ON_DEVICE_SUMMARY_TIMEOUT_MS });
        if (!active) return;
        if (!outcome.ok) {
          fallback(outcome.reason);
          return;
        }
        const bound = verifyAndBindRefinedLines(outcome.items, batch.lines, batch.items);
        if (!bound.ok) {
          fallback('rejected');
          return;
        }
        for (const [recordId, refinedText] of bound.refined.entries()) {
          merged.set(recordId, refinedText);
        }
      }
      if (!active) return;
      if (merged.size === lines.length) {
        setResult({ payloadKey, requestVersion, values: merged, status: 'applied', reason: undefined });
      } else {
        fallback('rejected');
      }
    })();

    return () => {
      active = false;
      cancelOnDeviceSummary();
    };
  }, [nativeGate, payloadKey, requestVersion]);

  // payload나 요청 번호가 바뀐 렌더에서는 이전 모델 결과를 즉시 숨긴다.
  if (!corpus.ok) {
    return {
      refined: NO_REFINEMENT,
      status: 'unavailable',
      reason: corpus.rejection,
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
  if (summaryLines.length > MAX_DAILY_SUMMARY_MODEL_RECORDS) {
    return {
      refined: NO_REFINEMENT,
      status: 'unavailable',
      reason: 'too_many_records',
      canRequest: false,
    };
  }
  if (summaryLines.some((line) => line.sourceText === null)) {
    return {
      refined: NO_REFINEMENT,
      status: 'idle',
      canRequest: false,
    };
  }
  if (result.payloadKey !== payloadKey || result.requestVersion !== requestVersion) {
    return {
      refined: NO_REFINEMENT,
      status: requestVersion > 0 ? 'running' : 'idle',
      canRequest: requestVersion <= 0,
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
