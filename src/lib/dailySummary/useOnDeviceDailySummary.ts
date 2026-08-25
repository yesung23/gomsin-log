import { useEffect, useMemo, useState } from 'react';
import type { CoupleStatus, DailyRecord } from '@/types';
import type { StoryMode } from '@/features/story/StoryViewer';
import { buildOnDeviceItems, type DailySummaryLine } from '@/lib/dailySummary/contract';
import { selectDailySummaryCorpus } from '@/lib/dailySummary/corpus';
import { deterministicSummaryLines } from '@/lib/dailySummary/rules';
import {
  cancelOnDeviceSummary,
  isOnDeviceDailySummaryEnabled,
  refineOnDeviceSummary,
} from '@/lib/dailySummary/nativeOnDeviceSummary';
import { verifyAndBindRefinedLines } from '@/lib/dailySummary/verify';

/**
 * 다듬어진 표지 문장, 준비되면.
 *
 * ## 이 훅은 화면의 기본값이 아니다
 *
 * 돌려주는 것은 `recordId → 문장` 덮어쓰기 지도이고, 처음 렌더에서는 **항상 빈 지도**다.
 * `projectStory`가 만든 규칙 결과가 먼저 그려지고, 모델이 계약을 지킨 답을 주면 그때
 * 텍스트만 바뀐다. 그래서 이 훅이 아무 일도 하지 않는 것(웹·Android·미지원·flag off·timeout·
 * 검증 실패)이 곧 정상 동작이다.
 *
 * ## `mode === 'today'`만
 *
 * 상대의 오늘 표지 하나만 대상이다. `mine`은 내가 쓴 글이고, `archive`·`highlight`는 표지가
 * 아예 없다. 여러 날이 밀린 구간은 `corpus.ts`가 `multi_day`로 거른다.
 *
 * ## payload가 같으면 다시 부르지 않는다
 *
 * effect가 의존하는 것은 `payloadKey` -- 내용에서 유도한 **문자열** 하나다. 스토어가 갱신되어
 * `records` 배열의 신원이 바뀌어도 요약 내용이 같으면 문자열이 같고, 추론이 다시 시작되지
 * 않는다. 배열을 의존성에 두면 무관한 스토어 갱신마다 모델을 깨우게 되고, 그것은 배터리와
 * 취소 경합을 동시에 만든다.
 */

const NO_REFINEMENT: ReadonlyMap<string, string> = new Map();

export interface UseOnDeviceDailySummaryInput {
  mode: StoryMode;
  /** 이 스토리가 담은 기록. 이미 권한 판정을 통과한 목록이다. */
  records: readonly DailyRecord[];
  viewerUserId?: string;
  todayStr: string;
  coupleConnected: boolean;
  coupleStatus?: CoupleStatus;
}

export function useOnDeviceDailySummary(
  input: UseOnDeviceDailySummaryInput,
): ReadonlyMap<string, string> {
  const { mode, records, viewerUserId, todayStr, coupleConnected, coupleStatus } = input;
  const [refined, setRefined] = useState<ReadonlyMap<string, string>>(NO_REFINEMENT);

  /*
    내용에서 유도한 키.

    `[recordId, text]` 쌍만 담는다. `time`·`date`는 모델에 가지 않으므로 키에도 넣지 않는다 --
    키에 넣으면 표시 값이 바뀔 때 의미 없이 추론이 다시 돈다.
  */
  const payloadKey = useMemo(() => {
    if (mode !== 'today') return '[]';
    const corpus = selectDailySummaryCorpus({
      records,
      viewerUserId,
      todayStr,
      coupleConnected,
      coupleStatus,
    });
    if (!corpus.ok) return '[]';
    return JSON.stringify(
      deterministicSummaryLines(corpus.records).map((line) => [line.recordId, line.text]),
    );
  }, [mode, records, viewerUserId, todayStr, coupleConnected, coupleStatus]);

  useEffect(() => {
    const pairs = JSON.parse(payloadKey) as [string, string][];
    if (pairs.length === 0) {
      setRefined(NO_REFINEMENT);
      return;
    }
    // flag가 꺼져 있으면 네이티브 경계를 건드리지도 않는다. `refineOnDeviceSummary`가 같은
    // 판정을 다시 하지만, 기본값 OFF에서 브리지 객체조차 만들지 않는 편이 낫다.
    if (!isOnDeviceDailySummaryEnabled()) {
      setRefined(NO_REFINEMENT);
      return;
    }

    const lines: DailySummaryLine[] = pairs.map(([recordId, text]) => ({
      recordId,
      text,
      // 표시용 필드는 이 경로에서 쓰이지 않는다. 덮어쓰기 지도는 `recordId`만으로 만들어진다.
      time: '',
      date: '',
    }));
    const items = buildOnDeviceItems(lines);

    let active = true;
    void (async () => {
      const outcome = await refineOnDeviceSummary(items);
      if (!active) return;
      if (!outcome.ok) {
        setRefined(NO_REFINEMENT);
        return;
      }
      const bound = verifyAndBindRefinedLines(outcome.items, lines, items);
      setRefined(bound.ok ? bound.refined : NO_REFINEMENT);
    })();

    return () => {
      active = false;
      cancelOnDeviceSummary();
    };
  }, [payloadKey]);

  return refined;
}
