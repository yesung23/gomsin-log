/**
 * 하루 요약을 온디바이스 모델이 다듬을 때, 무엇이 계약인가.
 *
 * 이 폴더는 `src/lib/onDeviceInference.ts`와 **다른 경계**다. 그쪽은 작성자 본인의 글에서
 * 감정을 읽어 작성자에게 보여 주는 규칙 엔진이고, 여기는 이미 만들어진 사실 기반 요약 줄의
 * **문장만** 다듬는다. 두 기능을 한 모듈에 두면 "감정을 추론하지 않는다"는 이 기능의 계약이
 * 옆 기능의 계약과 섞여 검증할 수 없게 된다. 그래서 재사용하지 않고 분리한다.
 *
 * ## 절대 바뀌지 않는 것들
 *
 * 1. **결정론적 결과가 항상 먼저 존재한다.** `projectStory`가 만든 줄이 화면의 기본값이고,
 *    온디바이스 결과는 준비되었을 때 **텍스트만** 갈아 끼운다. 모델이 없거나 느리거나 틀린
 *    답을 주면 화면은 규칙 결과 그대로다.
 * 2. **모델은 무엇이 중요한지 고르지 않는다.** 어떤 기록이 요약에 들어가는지는
 *    `corpus.ts`가 시간순으로 정한다. 모델은 항목을 추가·삭제·재배열할 수 없다.
 * 3. **정확한 원본 매핑은 모델을 통과하지 않는다.** `recordId`는 모델 payload에 들어가지
 *    않는다. 나가는 것은 서수 index와 정규화된 텍스트뿐이고, 돌아온 index를 JS가 검증한 뒤
 *    원래 `recordId`에 다시 붙인다. 그래서 모델이 무엇을 하든 요약 줄이 다른 기록을 가리킬
 *    수 없다.
 * 4. **서버로 아무것도 가지 않는다.** 이 경로에는 네트워크 호출도, 저장도, 로그도 없다.
 *
 * ## 모델 payload에 들어가지 않는 것 (하나라도 넣으면 계약 위반)
 *
 * `recordId`, `userId`, 날짜, 시각, 첨부 URL/파일명, `emotionFlow`, `emotionAnalysis`,
 * 주기·건강·통증·기분 관련 구조화 필드, 비공개 기록, 상대가 아닌 사람의 기록.
 */

/** Foundation Models 네이티브 호출 한 번에 전달하는 고정 배치 크기. */
export const ON_DEVICE_SUMMARY_BATCH_SIZE = 5;

/** `momentSummaryText`가 이미 지키는 상한. 모델 출력에도 똑같이 강제한다. */
export const MAX_DAILY_SUMMARY_LINE_CHARS = 40;

/**
 * 요약 한 줄. `recordId`는 이 타입을 절대 떠나지 않는다.
 *
 * `time`·`date`는 표시용이며 모델에 가지 않는다.
 */
export interface DailySummaryLine {
  recordId: string;
  text: string;
  time: string;
  date: string;
}

/**
 * 네이티브 경계를 실제로 건너가는 유일한 모양.
 *
 * 필드가 정확히 두 개인 것이 계약이다. 새 필드를 추가하려면 그 필드가 사용자 콘텐츠도
 * 식별자도 아님을 먼저 증명해야 한다 -- `contract.test.ts`가 키 목록을 고정한다.
 */
export interface OnDeviceSummaryItem {
  index: number;
  text: string;
}

export interface DailySummaryBatch {
  lines: DailySummaryLine[];
  items: OnDeviceSummaryItem[];
}

/** 온디바이스 경로가 쓰이지 못한 이유. 콘텐츠 없는 안정 코드만. */
export type OnDeviceSummaryFailure =
  /** 운영 kill switch가 `false`/`0`/`off`로 명시되어 있다. */
  | 'disabled'
  /** 웹 또는 Android. 이 기능에는 Android 구현이 없다. */
  | 'not_ios'
  /** iOS 네이티브지만 플러그인이 등록되지 않았다. */
  | 'plugin_missing'
  /** OS·모델·로케일 중 하나가 지원되지 않는다. */
  | 'unsupported'
  | 'timeout'
  | 'cancelled'
  /** 응답이 왔지만 요청과 짝이 맞지 않는다. */
  | 'rejected'
  | 'native_error';

/** 코퍼스를 만들 수 없어 온디바이스 경로를 아예 시도하지 않은 이유. */
export type DailySummaryCorpusRejection =
  /** 상대 스토리의 오늘 표지가 아니다(mine·archive·highlight). */
  | 'not_partner_today'
  | 'couple_not_active'
  /** viewer 또는 기록의 `userId`가 아직 정해지지 않았다. 작성자 판정을 추측하지 않는다. */
  | 'identity_unresolved'
  /** 여러 날이 밀린 "놓친 하루". 기존 `projectStory` 동작을 그대로 둔다. */
  | 'multi_day'
  /** 순간이 하나 이하. 목차가 목차 노릇을 못 하므로 표지 자체가 없다. */
  | 'too_few_moments';

/**
 * 구분자로 취급할 문자.
 *
 * 정규식 대신 코드포인트로 판정한다. C0/C1 제어문자를 문자 클래스로 적으면
 * `no-control-regex`에 걸리고, 무엇보다 `\s`는 제어문자와 zero-width 문자를 모두 포함하지
 * 않는다 -- zero-width joiner가 남은 문장은 눈에는 정상이고 길이 계산에서는 아니다.
 */
const SEPARATOR_CODE_POINTS = new Set([
  // ZWNJ(0x200c)와 ZWJ(0x200d)는 문자·이모지 결합 의미가 있으므로 보존한다.
  0x200b, 0x200e, 0x200f, // zero-width space와 방향 표시
  0x2028, 0x2029, // line/paragraph separator
  0xfeff, // byte order mark
]);

function isSeparator(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  // C0 (0x00-0x1f), DEL과 C1 (0x7f-0x9f).
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  if (SEPARATOR_CODE_POINTS.has(code)) return true;
  return /\s/.test(character);
}

/**
 * 제어문자를 지우고 공백을 하나로 접는다. **자르지 않는다.**
 *
 * 검증에서 자르지 않는 것이 중요하다. 40자를 넘긴 모델 출력을 조용히 잘라 쓰면 문장이
 * 중간에서 끊긴 채 사실처럼 화면에 남는다. 그런 응답은 잘라 쓰는 대신 배치 전체를 버리고
 * 규칙 결과로 되돌아간다.
 */
export function collapseSummaryText(raw: string): string {
  const words: string[] = [];
  let current = '';
  // `for...of`는 코드포인트 단위로 돈다. 서로게이트 쌍이 쪼개지지 않는다.
  for (const character of raw) {
    if (isSeparator(character)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current) words.push(current);
  return words.join(' ');
}

/**
 * 모델에 보낼 텍스트로 정규화한다. 접고, 넘치면 자른다.
 *
 * `momentSummaryText`와 같은 방식으로 자른다(39자 + `…`). 규칙 결과는 이미 40자 이하이므로
 * 실제로는 멱등이고, 이 함수는 그 불변식이 깨지더라도 40자를 넘는 문장이 경계를 넘지 않게
 * 하는 마지막 관문이다. `Intl.Segmenter`가 없는 환경에서는 grapheme 경계를 안전하게
 * 계산할 수 없으므로 `null`을 반환한다. 호출부는 그 배치의 온디바이스 refinement를 포기하고
 * 이미 화면에 있는 결정론적 요약을 유지해야 한다.
 */
export function normalizeSummaryLineText(raw: string): string | null {
  const collapsed = collapseSummaryText(raw);
  if (collapsed.length <= MAX_DAILY_SUMMARY_LINE_CHARS) return collapsed;
  if (typeof Intl.Segmenter !== 'function') return null;
  const budget = MAX_DAILY_SUMMARY_LINE_CHARS - 1;
  const segments = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(collapsed)]
    .map(({ segment }) => segment);
  let prefix = '';
  for (const segment of segments) {
    if (prefix.length + segment.length > budget) break;
    prefix += segment;
  }
  return `${prefix.trimEnd()}…`;
}

/**
 * 요약 줄 → 네이티브 payload.
 *
 * 서수 index는 배열 위치에서 새로 만든다. 입력 줄의 어떤 식별자도 쓰지 않으므로, 이 함수가
 * `recordId`를 실어 보낼 방법이 구조적으로 없다.
 */
export function buildOnDeviceItems(
  lines: readonly DailySummaryLine[],
): OnDeviceSummaryItem[] {
  const items: OnDeviceSummaryItem[] = [];
  for (const [index, line] of lines.slice(0, ON_DEVICE_SUMMARY_BATCH_SIZE).entries()) {
    const text = normalizeSummaryLineText(line.text);
    if (text === null) return [];
    items.push({ index, text });
  }
  return items;
}

/**
 * 모든 요약 줄을 5개 단위의 고정 배치들로 구성한다.
 *
 * 정규화 실패(Segmenter 부재 등)가 단 한 줄이라도 있으면 null을 반환하여
 * 어떤 배치도 네이티브에 전송되지 않도록 한다.
 */
export function buildAllOnDeviceBatches(
  lines: readonly DailySummaryLine[],
): DailySummaryBatch[] | null {
  const batches: DailySummaryBatch[] = [];
  for (let i = 0; i < lines.length; i += ON_DEVICE_SUMMARY_BATCH_SIZE) {
    const batchLines = lines.slice(i, i + ON_DEVICE_SUMMARY_BATCH_SIZE);
    const items = buildOnDeviceItems(batchLines);
    if (items.length !== batchLines.length) {
      return null;
    }
    batches.push({ lines: batchLines, items });
  }
  return batches;
}
