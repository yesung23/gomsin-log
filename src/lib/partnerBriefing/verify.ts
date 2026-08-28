/**
 * Partner Briefing Provenance and Semantic Safety Verifier (Gate A6)
 *
 * Verifies untrusted BriefingProviderResult payloads from on-device AI providers.
 *
 * Architectural invariants:
 * 1. Fail-closed: Any structural anomaly, missing/hallucinated ordinals,
 *    stale correlation, invalid text length, duplicate ordinals within a section,
 *    missing input source coverage, or forbidden inference language rejects
 *    the entire provider response.
 * 2. Exact source coverage: The union of all verified section source ordinals
 *    must equal the requested source ordinal set exactly, with zero unknown ordinals.
 * 3. Cross-section overlap permitted: The same known source ordinal may appear
 *    in multiple semantic sections, enabling future multi-section attribution.
 * 4. Synthetic ordinals only: Output verified text and source ordinals only.
 *    Never binds, consumes, or emits real database IDs (recordId, userId, coupleId).
 * 5. Bounded rejection metadata: Invalid outputs return an enumerated reason
 *    and optional section index/ordinal without leaking user content, logs, or keys.
 * 6. Conservative semantic safety: Rejects obvious unsupported psychological,
 *    emotional, relationship, health, or intent speculation (e.g. "우울해 보였다",
 *    "정서적으로 지쳤다", "관계에 불안을 느꼈다", "많이 보고 싶어 한 것 같아요",
 *    "건강이 안 좋아 보였다", "감기인 것 같다", "아픈 듯했다").
 *    Factual reporting (e.g. "오늘 힘들었다고 남겼고 일찍 쉬겠다고 했어요") passes.
 * 7. Zero external runtime dependencies, zero AI prompts, zero fallback generation,
 *    zero persistence, and zero logging.
 */

import { countGraphemes, getUtf8ByteLength } from './chunk';
import type { BriefingProviderErrorCode } from './provider';

/**
 * Configurable limits for verified provider outputs.
 * Required for all verifier calls; no implicit defaults.
 */
export interface BriefingVerifyLimits {
  readonly maxSections: number;
  readonly maxSectionUtf8Bytes: number;
  readonly maxTotalUtf8Bytes: number;
  readonly maxSectionGraphemes?: number;
}

/**
 * Input to verifyBriefingProviderResult.
 */
export interface BriefingVerifyInput {
  readonly expectedRequestId: string;
  readonly requestedSourceOrdinals: readonly number[] | Set<number>;
  readonly providerResult: unknown;
  readonly limits: BriefingVerifyLimits;
}

/**
 * Verified briefing section with synthetic source ordinals only.
 */
export interface VerifiedBriefingSection {
  readonly text: string;
  readonly sourceOrdinals: readonly number[];
}

/**
 * Enumerated reasons for verifier rejection.
 */
export type BriefingVerifyRejectionReason =
  | 'provider_failed'
  | 'correlation_mismatch'
  | 'invalid_structure'
  | 'invalid_section_count'
  | 'invalid_text'
  | 'invalid_ordinals'
  | 'duplicate_ordinal_in_section'
  | 'incomplete_source_coverage'
  | 'forbidden_inference';

/**
 * Bounded rejection metadata emitted when verification fails closed.
 * Contains only the enumerated reason and optional indices.
 * Excludes logs, content, database IDs, URLs, paths, or keys.
 */
export interface BriefingVerifyRejection {
  readonly reason: BriefingVerifyRejectionReason;
  readonly sectionIndex?: number;
  readonly ordinal?: number;
}

export interface BriefingVerifySuccess {
  readonly ok: true;
  readonly sections: readonly VerifiedBriefingSection[];
}

export interface BriefingVerifyFailure {
  readonly ok: false;
  readonly rejection: BriefingVerifyRejection;
}

export type BriefingVerifyResult =
  | BriefingVerifySuccess
  | BriefingVerifyFailure;

const ALLOWED_SUCCESS_ROOT_KEYS = new Set(['ok', 'requestId', 'output']);
const ALLOWED_FAILURE_ROOT_KEYS = new Set(['ok', 'code', 'requestId']);
const ALLOWED_OUTPUT_KEYS = new Set(['sections']);
const ALLOWED_SECTION_KEYS = new Set(['text', 'sourceOrdinals']);
const ALLOWED_LIMIT_KEYS = new Set([
  'maxSections',
  'maxSectionUtf8Bytes',
  'maxTotalUtf8Bytes',
  'maxSectionGraphemes',
]);

const VALID_PROVIDER_ERROR_CODES = new Set<BriefingProviderErrorCode>([
  'busy',
  'quota',
  'timeout',
  'cancelled',
  'malformed',
  'native_error',
]);

function isDisallowedControlCode(code: number): boolean {
  // C0 controls except tab 0x09, newline 0x0A, carriage return 0x0D
  if (code >= 0x00 && code <= 0x1f) {
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      return false;
    }
    return true;
  }
  // DEL 0x7F
  if (code === 0x7f) return true;
  // C1 controls 0x80 - 0x9F
  if (code >= 0x80 && code <= 0x9f) return true;
  return false;
}

export function hasDisallowedControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isDisallowedControlCode(code)) {
      return true;
    }
  }
  return false;
}

const FORBIDDEN_INFERENCE_PATTERNS: readonly RegExp[] = [
  // 1. Explicit psychological / psychiatric / diagnostic speculation
  /정서적/i,
  /심리적/i,
  /우울증/i,
  /공황\s*(장애|발작)/i,
  /조울증/i,
  /번아웃\s*(증후군|상태)/i,
  /트라우마/i,
  /애착\s*(불안|유형)/i,
  /psychological|mental\s*exhaustion|depression|anxiety\s*attack|burnout\s*syndrome/i,

  // 2. Health and physical condition speculation
  /건강이\s*(안\s*좋|나빠|악화|이상|상한)/i,
  /(감기|독감|몸살|두통|복통|질환|병)(인|에\s*걸린|을\s*앓는)?\s*(것\s*(같|같아|같았|같네|같음|은가)|듯)/i,
  /(아픈|아파|아팠)\s*(던\s*것\s*같|던\s*듯|듯|보였|보이|보여|것\s*같|해\s*보)/i,
  /seemed\s+(sick|ill|unwell)/i,
  /(might|seems\s+to)\s+have\s+a\s+cold/i,

  // 3. Relationship speculation / emotion degradation guessing
  /관계에?\s*(불안|위기|소원|회의)/i,
  /관계가\s*(소원|식어|불안|위태|멀어|변했|틀어)/i,
  /애정(도|이\s*(식|떨어|식었|줄었)|을\s*의심)/i,
  /(사랑|마음|호감)이\s*(식|변했|멀어|떠났|줄었)/i,
  /마음의\s*거리/i,
  /relationship\s*insecurity|falling\s*out\s*of\s*love/i,

  // 4. Subjective emotional appearance / inference verbs (~보였다, ~보인다, ~보였어요, ~보이네요, ~듯하다, ~듯했다, ~모양이다)
  /(우울|불안|지침|지친|지쳤|지쳐|외로|초조|서운|허전|공허|답답|괴로|슬픔|슬픈|슬펐|벅찬|속상|피곤)(해|한|한\s*상태로|한\s*것으로)?\s*(보였|보이|보여|듯하|듯했|듯\s*보|모양)/i,
  /seemed\s+(depressed|sad|tired|exhausted|anxious|lonely)/i,

  // 5. Speculative deduction verbs (추측된다, 추정된다, 짐작된다, 사료된다, 여겨진다, 생각된다)
  /(추측(된다|돼|됩니다|했)|추정(된다|돼|됩니다|했)|짐작(된다|돼|됩니다|했)|사료(된다|됩니다)|판단(된다|됩니다))/i,
  /speculate|presume|assume/i,

  // 6. Speculative intent / feeling hedges (~것 같아요, ~것 같다, ~것 같았, ~것 같음, ~듯싶)
  /(보고\s*싶(어|었|었던|은|을)?|사랑하|좋아하|싫어하|원하|바라|생각하|느끼|괴로워|힘들어|지쳐|불안해|우울해|외로워|서운해|속상해)\s*(어|아)?\s*(하|했|했던|하는|한)?\s*(것\s*(같|같아|같았|같네|같음|은가)|듯\s*싶)/i,

  // 7. Direct emotional speculation attribution: "불안을 느꼈다", "우울감을 느꼈다", "외로움을 느꼈다"
  /(우울감|불안감|외로움|소외감|서운함|박탈감|불안|우울|괴로움)\s*(을|를)?\s*(느꼈|느낀|느끼는\s*것|느꼈던)/i,
  /felt\s+(insecure|anxious|depressed|alienated)/i,
];

/**
 * Tests whether text contains unsupported psychological, emotional, relationship,
 * health, or intent inference language.
 */
export function isForbiddenInferenceText(text: string): boolean {
  return FORBIDDEN_INFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isValidVerifyLimits(
  value: unknown,
): value is BriefingVerifyLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length === 0 ||
    keys.some((key) => !ALLOWED_LIMIT_KEYS.has(key))
  ) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const maxSections = candidate.maxSections;
  const maxSectionUtf8Bytes = candidate.maxSectionUtf8Bytes;
  const maxTotalUtf8Bytes = candidate.maxTotalUtf8Bytes;
  const maxSectionGraphemes = candidate.maxSectionGraphemes;

  if (
    !Number.isSafeInteger(maxSections) ||
    (maxSections as number) <= 0 ||
    !Number.isSafeInteger(maxSectionUtf8Bytes) ||
    (maxSectionUtf8Bytes as number) <= 0 ||
    !Number.isSafeInteger(maxTotalUtf8Bytes) ||
    (maxTotalUtf8Bytes as number) <= 0
  ) {
    return false;
  }

  if (
    maxSectionGraphemes !== undefined &&
    (!Number.isSafeInteger(maxSectionGraphemes) ||
      (maxSectionGraphemes as number) <= 0)
  ) {
    return false;
  }

  return true;
}

/**
 * Pure verifier for BriefingProviderResult.
 *
 * Enforces fail-closed correlation, structural invariants, source-set exact
 * coverage, text boundaries, and conservative semantic safety rejection.
 */
export function verifyBriefingProviderResult(
  input: BriefingVerifyInput,
): BriefingVerifyResult {
  const {
    expectedRequestId,
    requestedSourceOrdinals,
    providerResult,
    limits,
  } = input;

  if (!isValidVerifyLimits(limits)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  if (typeof expectedRequestId !== 'string' || expectedRequestId.trim().length === 0) {
    return { ok: false, rejection: { reason: 'correlation_mismatch' } };
  }

  const requestedSet = new Set<number>();
  const rawOrdinals =
    requestedSourceOrdinals instanceof Set
      ? Array.from(requestedSourceOrdinals)
      : requestedSourceOrdinals;

  if (!Array.isArray(rawOrdinals)) {
    return { ok: false, rejection: { reason: 'invalid_ordinals' } };
  }

  for (const ordinal of rawOrdinals) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
      return { ok: false, rejection: { reason: 'invalid_ordinals' } };
    }
    requestedSet.add(ordinal);
  }

  if (!providerResult || typeof providerResult !== 'object' || Array.isArray(providerResult)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const rootRecord = providerResult as Record<string, unknown>;

  if (rootRecord.ok === false) {
    const failureKeys = Object.keys(rootRecord);
    if (failureKeys.some((k) => !ALLOWED_FAILURE_ROOT_KEYS.has(k))) {
      return { ok: false, rejection: { reason: 'invalid_structure' } };
    }
    if (
      typeof rootRecord.code !== 'string' ||
      !VALID_PROVIDER_ERROR_CODES.has(rootRecord.code as BriefingProviderErrorCode)
    ) {
      return { ok: false, rejection: { reason: 'invalid_structure' } };
    }
    if ('requestId' in rootRecord) {
      if (
        typeof rootRecord.requestId !== 'string' ||
        rootRecord.requestId.trim().length === 0
      ) {
        return { ok: false, rejection: { reason: 'invalid_structure' } };
      }
      if (rootRecord.requestId !== expectedRequestId) {
        return { ok: false, rejection: { reason: 'correlation_mismatch' } };
      }
    }
    return { ok: false, rejection: { reason: 'provider_failed' } };
  }

  if (rootRecord.ok !== true) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const rootKeys = Object.keys(rootRecord);
  if (
    rootKeys.length !== ALLOWED_SUCCESS_ROOT_KEYS.size ||
    rootKeys.some((k) => !ALLOWED_SUCCESS_ROOT_KEYS.has(k))
  ) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  if (
    typeof rootRecord.requestId !== 'string' ||
    rootRecord.requestId.trim().length === 0
  ) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  if (rootRecord.requestId !== expectedRequestId) {
    return { ok: false, rejection: { reason: 'correlation_mismatch' } };
  }

  const output = rootRecord.output;
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const outputRecord = output as Record<string, unknown>;
  const outputKeys = Object.keys(outputRecord);
  if (
    outputKeys.length !== ALLOWED_OUTPUT_KEYS.size ||
    outputKeys[0] !== 'sections' ||
    !Array.isArray(outputRecord.sections)
  ) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const rawSections = outputRecord.sections;
  if (rawSections.length === 0 || rawSections.length > limits.maxSections) {
    return { ok: false, rejection: { reason: 'invalid_section_count' } };
  }

  const verifiedSections: VerifiedBriefingSection[] = [];
  const verifiedUnion = new Set<number>();
  let totalUtf8Bytes = 0;

  for (let sectionIndex = 0; sectionIndex < rawSections.length; sectionIndex += 1) {
    const rawSection = rawSections[sectionIndex];
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
      return { ok: false, rejection: { reason: 'invalid_structure', sectionIndex } };
    }

    const sectionRecord = rawSection as Record<string, unknown>;
    const sectionKeys = Object.keys(sectionRecord);
    if (
      sectionKeys.length !== ALLOWED_SECTION_KEYS.size ||
      sectionKeys.some((k) => !ALLOWED_SECTION_KEYS.has(k))
    ) {
      return { ok: false, rejection: { reason: 'invalid_structure', sectionIndex } };
    }

    const text = sectionRecord.text;
    if (typeof text !== 'string') {
      return { ok: false, rejection: { reason: 'invalid_text', sectionIndex } };
    }

    if (text.trim().length === 0 || hasDisallowedControlCharacters(text)) {
      return { ok: false, rejection: { reason: 'invalid_text', sectionIndex } };
    }

    const sectionBytes = getUtf8ByteLength(text);
    if (sectionBytes > limits.maxSectionUtf8Bytes) {
      return { ok: false, rejection: { reason: 'invalid_text', sectionIndex } };
    }

    if (limits.maxSectionGraphemes !== undefined) {
      const graphemeCount = countGraphemes(text);
      if (graphemeCount === null || graphemeCount > limits.maxSectionGraphemes) {
        return { ok: false, rejection: { reason: 'invalid_text', sectionIndex } };
      }
    }

    totalUtf8Bytes += sectionBytes;
    if (totalUtf8Bytes > limits.maxTotalUtf8Bytes) {
      return { ok: false, rejection: { reason: 'invalid_text', sectionIndex } };
    }

    if (isForbiddenInferenceText(text)) {
      return { ok: false, rejection: { reason: 'forbidden_inference', sectionIndex } };
    }

    const sourceOrdinals = sectionRecord.sourceOrdinals;
    if (!Array.isArray(sourceOrdinals) || sourceOrdinals.length === 0) {
      return { ok: false, rejection: { reason: 'invalid_ordinals', sectionIndex } };
    }

    const sectionOrdinalSet = new Set<number>();
    for (const ordinal of sourceOrdinals) {
      if (
        typeof ordinal !== 'number' ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        !requestedSet.has(ordinal)
      ) {
        return {
          ok: false,
          rejection: {
            reason: 'invalid_ordinals',
            sectionIndex,
            ordinal: typeof ordinal === 'number' && Number.isFinite(ordinal) ? ordinal : undefined,
          },
        };
      }

      if (sectionOrdinalSet.has(ordinal)) {
        return {
          ok: false,
          rejection: {
            reason: 'duplicate_ordinal_in_section',
            sectionIndex,
            ordinal,
          },
        };
      }

      sectionOrdinalSet.add(ordinal);
      verifiedUnion.add(ordinal);
    }

    verifiedSections.push({
      text,
      sourceOrdinals: [...sourceOrdinals],
    });
  }

  if (
    verifiedUnion.size !== requestedSet.size ||
    Array.from(requestedSet).some((ord) => !verifiedUnion.has(ord))
  ) {
    return {
      ok: false,
      rejection: { reason: 'incomplete_source_coverage' },
    };
  }

  return {
    ok: true,
    sections: verifiedSections,
  };
}
