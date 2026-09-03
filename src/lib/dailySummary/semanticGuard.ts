/**
 * 온디바이스 모델 출력의 보수적인 원문 출처 검사.
 *
 * 이것은 자연어 의미 동등성 판정기가 아니다. 현재 40자 입력 단계에서는 모델이 내부 문자,
 * 띄어쓰기, 구두점을 하나도 바꾸지 못하게 하고 바깥 공백 제거와 최종 마침표 하나만 허용한다.
 * 인용부호나 띄어쓰기까지 지운 뒤 비교하면 서로 다른 한국어 문장이 같아질 수 있으므로,
 * 손실 정규화나 휴리스틱 예외 목록을 사용하지 않는다. 조금이라도 증명할 수 없으면 호출부가
 * 이미 가진 결정론적 문장으로 돌아간다.
 */

export type SummaryRewriteRejection = 'unsafe_unicode' | 'not_source_equivalent';

export type SummaryRewriteGuard =
  | { ok: true }
  | { ok: false; rejection: SummaryRewriteRejection };

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

function canAppendFinalPeriod(source: string): boolean {
  const last = [...source].at(-1);
  return last !== undefined && /[\p{Letter}\p{Number}\p{Mark}\p{Symbol}]/u.test(last);
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
  if (canAppendFinalPeriod(normalizedSource)
    && normalizedCandidate === `${normalizedSource}.`) return { ok: true };

  return { ok: false, rejection: 'not_source_equivalent' };
}
