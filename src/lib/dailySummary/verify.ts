import {
  MAX_DAILY_SUMMARY_LINE_CHARS,
  collapseSummaryText,
  type DailySummaryLine,
  type OnDeviceSummaryItem,
} from '@/lib/dailySummary/contract';
import { guardSummaryRewrite } from '@/lib/dailySummary/semanticGuard';

/**
 * 모델 출력을 믿지 않는 자리.
 *
 * 네이티브에서 돌아온 값은 **검증되지 않은 입력**으로 다룬다. 여기서 통과한 것만 화면에
 * 닿고, 하나라도 걸리면 배치 전체를 버린다 -- 부분 수용은 "5줄 중 3줄만 다듬어졌다"는 상태를
 * 만들고, 그 상태에서 어느 줄이 모델을 통과했는지 나중에 아무도 알 수 없다.
 *
 * ## 무엇을 거부하는가
 *
 * - 배열이 아니다
 * - 개수가 다르다 (항목 추가·삭제)
 * - index가 정수가 아니다
 * - index가 범위를 벗어난다 (환각한 index)
 * - index가 중복된다
 * - index가 원래 위치와 다르다 (재배열)
 * - 텍스트가 문자열이 아니다
 * - 공백을 접은 뒤 비어 있다
 * - 공백을 접은 뒤 40자를 넘는다
 *
 * ## index를 `recordId`로 되돌리는 유일한 곳
 *
 * `bindRefinedTexts`는 검증을 통과한 텍스트를 **원래 배열 위치의** `recordId`에 붙인다.
 * 모델이 준 index는 이 시점에 이미 "i와 같다"가 증명되었으므로, 매핑에 모델의 값을 쓰지 않고
 * 위치를 쓴다. 그래서 모델은 매핑에 영향을 줄 수 없다.
 */

export type RefineRejection =
  | 'not_an_array'
  | 'count_mismatch'
  | 'malformed_item'
  | 'index_not_integer'
  | 'index_out_of_range'
  | 'duplicate_index'
  | 'reordered'
  | 'text_not_a_string'
  | 'empty_text'
  | 'text_too_long'
  | 'semantic_mismatch';

export type RefineVerification =
  | { ok: true; texts: string[] }
  | { ok: false; rejection: RefineRejection };

export function verifyRefinedItems(
  raw: unknown,
  expected: readonly OnDeviceSummaryItem[],
): RefineVerification {
  if (!Array.isArray(raw)) return { ok: false, rejection: 'not_an_array' };
  if (raw.length !== expected.length) return { ok: false, rejection: 'count_mismatch' };

  const seen = new Set<number>();
  const texts: string[] = [];

  for (let position = 0; position < raw.length; position += 1) {
    const item = raw[position] as unknown;
    if (typeof item !== 'object' || item === null) {
      return { ok: false, rejection: 'malformed_item' };
    }
    const { index, text } = item as { index?: unknown; text?: unknown };

    if (typeof index !== 'number' || !Number.isInteger(index)) {
      return { ok: false, rejection: 'index_not_integer' };
    }
    // 환각한 index(`9`)와 누락(`0..n-1` 중 하나가 빠짐)은 둘 다 여기서 잡힌다: 개수가 이미
    // 같으므로 하나가 빠지면 다른 하나가 범위를 벗어나거나 중복된다.
    if (index < 0 || index >= expected.length) {
      return { ok: false, rejection: 'index_out_of_range' };
    }
    if (seen.has(index)) return { ok: false, rejection: 'duplicate_index' };
    seen.add(index);
    if (index !== position) return { ok: false, rejection: 'reordered' };

    if (typeof text !== 'string') return { ok: false, rejection: 'text_not_a_string' };
    // 정상적인 조합형 입력(NFD)은 허용하되 화면에는 일관된 NFC 문자열만 전달한다.
    const collapsed = collapseSummaryText(text).normalize('NFC');
    if (collapsed.length === 0) return { ok: false, rejection: 'empty_text' };
    // 잘라서 쓰지 않는다. 40자를 넘긴 응답은 계약을 지키지 않은 응답이다.
    if (collapsed.length > MAX_DAILY_SUMMARY_LINE_CHARS) {
      return { ok: false, rejection: 'text_too_long' };
    }
    // 길이·형식만 맞는 문장도 사실을 지어낼 수 있다. raw 후보를 그대로 검사하므로 zero-width나
    // 제어문자를 collapse가 지워 안전해 보이게 만드는 우회도 통과하지 못한다.
    if (!guardSummaryRewrite(expected[position].text, text).ok) {
      return { ok: false, rejection: 'semantic_mismatch' };
    }
    texts.push(collapsed);
  }

  return { ok: true, texts };
}

/** 검증된 텍스트를 **배열 위치로** 원래 `recordId`에 다시 붙인다. */
export function bindRefinedTexts(
  lines: readonly DailySummaryLine[],
  texts: readonly string[],
): ReadonlyMap<string, string> {
  const bound = new Map<string, string>();
  if (lines.length !== texts.length) return bound;
  lines.forEach((line, index) => {
    if (!line.recordId) return;
    bound.set(line.recordId, texts[index]);
  });
  return bound;
}

export type RefinedBinding =
  | { ok: true; refined: ReadonlyMap<string, string> }
  | { ok: false; rejection: RefineRejection };

/** 검증 + 재결합. 호출부가 두 단계를 따로 쓰는 일이 없도록 하나로 묶어 둔다. */
export function verifyAndBindRefinedLines(
  raw: unknown,
  lines: readonly DailySummaryLine[],
  expected: readonly OnDeviceSummaryItem[],
): RefinedBinding {
  const verified = verifyRefinedItems(raw, expected);
  if (!verified.ok) return verified;
  return { ok: true, refined: bindRefinedTexts(lines, verified.texts) };
}
