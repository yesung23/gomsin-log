import type { CoupleStatus, DailyRecord } from '@/types';
import { isOwnRecord } from '@/lib/privacy';
import { isRecordContentAvailable } from '@/lib/recordAvailability';
import type { DailySummaryCorpusRejection } from '@/lib/dailySummary/contract';

/**
 * 온디바이스 모델이 볼 수 있는 기록의 전부.
 *
 * 이 파일이 프라이버시 경계다. 여기서 통과시킨 기록의 텍스트만 모델에 들어가므로, 판정은
 * **fail-closed**다 -- 조건을 확인할 수 없으면 코퍼스를 만들지 않고 규칙 결과를 그대로 쓴다.
 * "일단 넣고 나중에 지운다"가 불가능한 종류의 결정이기 때문이다.
 *
 * ## 통과 조건 (전부 만족해야 한다)
 *
 * - 커플이 **active**하다 (`connected && status === 'active'`)
 * - viewer의 `userId`와 기록의 `userId`가 모두 정해져 있다
 * - **상대가 쓴** 기록이다 (내 기록은 넣지 않는다)
 * - `isPrivate === false`
 * - 이 기기가 실제로 **읽을 수 있다** (`contentUnavailable` 없음)
 * - 서버에 **저장된** 기록이다 (`id`·`userId`·`createdAt` 전부 존재)
 * - `date`가 **정확히** `todayStr`다
 *
 * ## 왜 `role` fallback을 쓰지 않는가
 *
 * `isOwnRecord`는 `userId`가 없을 때 `authorRole`로 작성자를 추측한다. 그 추측은 화면 표시에는
 * 충분하지만 여기서는 아니다 -- 역할이 같은 두 계정이나 아직 세션과 맞춰지지 않은 프로필에서
 * 내 기록을 상대 기록으로 오판하면 내 글이 모델에 들어간다. 그래서 `userId`가 없으면
 * `identity_unresolved`로 끝낸다.
 *
 * ## 왜 draft/outbox를 따로 걸러내는가
 *
 * 전송 대기 기록은 계정별 IndexedDB outbox에 있고 `state.records`에는 들어오지 않는다
 * (`store.tsx`는 서버 응답을 받은 뒤에만 `records`에 커밋한다). 그래도 `createdAt`·`userId`를
 * 명시적으로 요구한다. "지금 구조상 도달할 수 없다"에 의존하면 나중에 낙관적 삽입이 하나
 * 생기는 날 미저장 기록이 조용히 모델에 들어간다.
 */

export interface DailySummaryCorpusInput {
  /** 이미 권한 판정을 통과한, 이 스토리가 담은 기록 전부. */
  records: readonly DailyRecord[];
  /** 보는 사람. `userId`가 없으면 판정하지 않는다. */
  viewerUserId?: string;
  /** active couple membership에서 직접 확인한 현재 상대. 없으면 판정하지 않는다. */
  partnerUserId?: string;
  todayStr: string;
  coupleConnected: boolean;
  coupleStatus?: CoupleStatus;
}

export type DailySummaryCorpus =
  | { ok: true; records: DailyRecord[] }
  | { ok: false; rejection: DailySummaryCorpusRejection };

/** 서버에 실제로 저장된 행인가. draft·outbox 항목은 이 세 값을 함께 갖지 못한다. */
export function isPersistedRecord(record: DailyRecord): boolean {
  return !!record.id && !!record.userId && !!record.createdAt;
}

export function selectDailySummaryCorpus(input: DailySummaryCorpusInput): DailySummaryCorpus {
  const { records, viewerUserId, partnerUserId, todayStr, coupleConnected, coupleStatus } = input;

  // 연결이 끊긴/보류 중인 관계의 기록을 다듬지 않는다. `settingsFacts.ts`와 같은 판정이다.
  if (!coupleConnected || coupleStatus !== 'active') {
    return { ok: false, rejection: 'couple_not_active' };
  }
  if (!viewerUserId || !partnerUserId || partnerUserId === viewerUserId) {
    return { ok: false, rejection: 'identity_unresolved' };
  }
  if (!todayStr) return { ok: false, rejection: 'identity_unresolved' };

  /*
    여러 날이 밀렸으면 손대지 않는다.

    "놓친 하루"는 날짜 경계를 넘는 구간이고, 그 표지는 여러 날의 사실을 한 목록으로 세운다.
    오늘 하루만 다듬도록 범위를 정한 결정이므로, 오늘이 아닌 기록이 **하나라도** 섞여 있으면
    코퍼스를 만들지 않고 기존 `projectStory` 결과를 그대로 둔다. 오늘 것만 골라내는 것은
    화면에 보이는 목록과 다듬어진 목록이 어긋나게 만든다.
  */
  if (records.some((record) => record.date !== todayStr)) {
    return { ok: false, rejection: 'multi_day' };
  }

  const eligible = records.filter((record) => (
    isPersistedRecord(record)
    // active membership에서 확인한 정확한 현재 상대만 허용한다. "내가 아님"은 충분하지 않다.
    && record.userId === partnerUserId
    && !isOwnRecord(record, { userId: viewerUserId })
    && !record.isPrivate
    && isRecordContentAvailable(record)
    && record.date === todayStr
  ));

  // 순간이 하나 이하면 `projectStory`가 애초에 표지를 만들지 않는다. 다듬을 표지가 없다.
  if (eligible.length <= 1) return { ok: false, rejection: 'too_few_moments' };

  const chronological = [...eligible].sort((a, b) => (
    // `projectStory`를 먹이는 정렬과 같은 규칙. 동시각은 id로 안정화한다.
    (a.time || '').localeCompare(b.time || '') || a.id.localeCompare(b.id)
  ));

  return { ok: true, records: chronological };
}
