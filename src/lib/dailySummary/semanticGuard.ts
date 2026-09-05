/**
 * 온디바이스 모델 출력의 보수적인 원문 출처 검사.
 *
 * 이것은 자연어 의미 동등성 판정기가 아니다. 모델이 내부 문자, 띄어쓰기, 구두점을 하나도
 * 바꾸지 못하게 하고, 짧은 원문은 바깥 공백 제거 외에는 글자 하나도 추가하지 못하게 한다.
 * 인용부호나 띄어쓰기까지 지운 뒤 비교하면 서로 다른 한국어 문장이 같아질 수 있으므로,
 * 손실 정규화나 휴리스틱 예외 목록을 사용하지 않는다. 조금이라도 증명할 수 없으면 호출부가
 * 이미 가진 결정론적 문장으로 돌아간다.
 */

export type SummaryRewriteRejection = 'unsafe_unicode' | 'not_source_equivalent';

export type SummaryRewriteGuard =
  | { ok: true }
  | { ok: false; rejection: SummaryRewriteRejection };

export type SummaryExcerptRejection =
  | 'unsafe_unicode'
  | 'truncated_source'
  | 'empty_excerpt'
  | 'excerpt_too_short'
  | 'excerpt_too_long'
  | 'not_contiguous'
  | 'not_word_boundary'
  | 'segmenter_unavailable'
  | 'not_trailing_sentence'
  | 'unbalanced_delimiters'
  | 'decorated_too_long'
  | 'not_source_equivalent';

export type SummaryExcerptGuard =
  | { ok: true; text: string }
  | { ok: false; rejection: SummaryExcerptRejection };

function hasBrokenSurrogate(raw: string): boolean {
  for (let index = 0; index < raw.length; index += 1) {
    const unit = raw.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = raw.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

function isUnsafeCodePoint(code: number): boolean {
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  if (code === 0x00ad || code === 0x061c || code === 0xfffd) return true;
  // ZWNJ/ZWJ는 문자·이모지 결합에 쓰이는 정상 코드포인트다. 눈에 보이지 않는 공백과
  // 방향 제어만 막고, 두 joiner는 아래 exact 비교에 그대로 포함한다.
  if (code === 0x200b || code === 0x200e || code === 0x200f) return true;
  if (code >= 0x2028 && code <= 0x202e) return true;
  if (code >= 0x2060 && code <= 0x206f) return true;
  if (code === 0xfeff) return true;
  if (code >= 0xe000 && code <= 0xf8ff) return true;
  if (code >= 0xf0000 && code <= 0xffffd) return true;
  if (code >= 0x100000 && code <= 0x10fffd) return true;
  if (code >= 0xfdd0 && code <= 0xfdef) return true;
  return (code & 0xffff) === 0xfffe || (code & 0xffff) === 0xffff;
}

function isSafeUnicode(raw: string): boolean {
  if (hasBrokenSurrogate(raw)) return false;
  for (const character of raw) {
    const code = character.codePointAt(0);
    if (code === undefined || isUnsafeCodePoint(code)) return false;
  }
  return true;
}

function normalizedEdgeText(raw: string): string {
  return raw.normalize('NFC').trim();
}

function hasGraphemeBoundaries(source: string, start: number, end: number): boolean {
  if (typeof Intl.Segmenter !== 'function') return false;
  const boundaries = new Set<number>([source.length]);
  for (const segment of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(source)) {
    boundaries.add(segment.index);
  }
  return boundaries.has(start) && boundaries.has(end);
}

const OPEN_TO_CLOSE = new Map<string, string>([
  ['(', ')'], ['[', ']'], ['{', '}'], ['<', '>'],
  ['〈', '〉'], ['《', '》'], ['「', '」'], ['『', '』'], ['【', '】'],
  ['‘', '’'], ['“', '”'],
]);
const CLOSE_DELIMITERS = new Set(OPEN_TO_CLOSE.values());
const SYMMETRIC_QUOTES = new Set(["'", '"']);
const TRAILING_CLOSERS = new Set([...CLOSE_DELIMITERS, ...SYMMETRIC_QUOTES]);

function hasBalancedDelimiters(raw: string): boolean {
  const stack: string[] = [];
  for (const character of raw) {
    const close = OPEN_TO_CLOSE.get(character);
    if (close) {
      stack.push(close);
      continue;
    }
    if (CLOSE_DELIMITERS.has(character)) {
      if (stack.pop() !== character) return false;
      continue;
    }
    if (SYMMETRIC_QUOTES.has(character)) {
      if (stack.at(-1) === character) stack.pop();
      else stack.push(character);
    }
  }
  return stack.length === 0;
}

function hasTerminalSentencePunctuation(raw: string): boolean {
  const characters = [...raw.trimEnd()];
  while (characters.length > 0 && TRAILING_CLOSERS.has(characters.at(-1)!)) characters.pop();
  return /[.!?。！？…]/u.test(characters.at(-1) ?? '');
}

function sentenceStarts(source: string): Set<number> | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  try {
    const starts = new Set<number>();
    const segments = new Intl.Segmenter('ko', { granularity: 'sentence' }).segment(source);
    for (const segment of segments) {
      const leadingWhitespace = segment.segment.match(/^\s*/u)?.[0].length ?? 0;
      starts.add(segment.index + leadingWhitespace);
    }
    return starts;
  } catch {
    return null;
  }
}

/**
 * Native를 부르기 전에 full source에 현재 허용된 trailing-sentence 후보가
 * 적어도 하나 있는지만 확인한다. 의미 동등성 증명이 아니라, 검증 불가능한
 * 입력을 native에 보내지 않기 위한 보수적 자격 검사다.
 */
export function isSummarySourceEligible(source: string): boolean {
  if (!isSafeUnicode(source)) return false;
  const normalizedSource = normalizedEdgeText(source);
  if (normalizedSource.length <= 40 || !hasBalancedDelimiters(normalizedSource)) return false;
  const starts = sentenceStarts(normalizedSource);
  if (starts === null) return false;
  for (const start of starts) {
    if (start <= 0) continue;
    const suffix = normalizedSource.slice(start);
    if (suffix.length < 8 || suffix.length > 39) continue;
    if (!hasTerminalSentencePunctuation(suffix)) continue;
    if (!hasBalancedDelimiters(suffix)) continue;
    if (hasGraphemeBoundaries(normalizedSource, start, normalizedSource.length)) return true;
  }
  return false;
}

/**
 * 긴 원문에서 모델이 고를 수 있는 것은 원문의 exact contiguous excerpt뿐이다.
 * 이 함수가 반환하는 text는 사용자에게 보일 최종 문자열이며, 말줄임표는 모델 응답이 아니다.
 */
export function guardSummaryExcerpt(
  source: string,
  candidate: string,
  sourceWasTruncated = false,
): SummaryExcerptGuard {
  if (!isSafeUnicode(source) || !isSafeUnicode(candidate)) {
    return { ok: false, rejection: 'unsafe_unicode' };
  }
  if (sourceWasTruncated) return { ok: false, rejection: 'truncated_source' };

  const normalizedSource = normalizedEdgeText(source);
  const normalizedCandidate = normalizedEdgeText(candidate);
  if (!normalizedSource || !normalizedCandidate) {
    return { ok: false, rejection: 'empty_excerpt' };
  }

  if (normalizedSource.length <= 40) {
    if (normalizedCandidate === normalizedSource) {
      return { ok: true, text: normalizedSource };
    }
    return { ok: false, rejection: 'not_source_equivalent' };
  }

  if (normalizedCandidate.length < 8) return { ok: false, rejection: 'excerpt_too_short' };
  if (normalizedCandidate.length > 40) return { ok: false, rejection: 'excerpt_too_long' };

  if (!normalizedSource.endsWith(normalizedCandidate)) {
    return { ok: false, rejection: 'not_trailing_sentence' };
  }
  const start = normalizedSource.length - normalizedCandidate.length;
  const end = normalizedSource.length;
  if (start <= 0) return { ok: false, rejection: 'not_trailing_sentence' };
  if (!hasGraphemeBoundaries(normalizedSource, start, end)) {
    return { ok: false, rejection: 'not_word_boundary' };
  }
  if (!hasBalancedDelimiters(normalizedSource) || !hasBalancedDelimiters(normalizedCandidate)) {
    return { ok: false, rejection: 'unbalanced_delimiters' };
  }
  const starts = sentenceStarts(normalizedSource);
  if (starts === null) return { ok: false, rejection: 'segmenter_unavailable' };
  if (!starts.has(start) || !hasTerminalSentencePunctuation(normalizedCandidate)) {
    return { ok: false, rejection: 'not_trailing_sentence' };
  }
  const decorated = `…${normalizedCandidate}`;
  if (decorated.length > 40) return { ok: false, rejection: 'decorated_too_long' };
  return { ok: true, text: decorated };
}

export function guardSummaryRewrite(source: string, candidate: string): SummaryRewriteGuard {
  if (!isSafeUnicode(source) || !isSafeUnicode(candidate)) {
    return { ok: false, rejection: 'unsafe_unicode' };
  }

  const normalizedSource = normalizedEdgeText(source);
  const normalizedCandidate = normalizedEdgeText(candidate);
  if (normalizedSource.length === 0 || normalizedCandidate.length === 0) {
    return { ok: false, rejection: 'not_source_equivalent' };
  }

  if (normalizedCandidate === normalizedSource) return { ok: true };

  return { ok: false, rejection: 'not_source_equivalent' };
}
