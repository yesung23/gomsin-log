/**
 * Partner Briefing Closed-Extract Verifier and Provenance Gate (Gate A6 Amendment)
 *
 * Verifies untrusted BriefingExtractResult payloads from on-device AI providers.
 *
 * Closed-Extract Invariants (Gate A6 Amendment):
 * 1. Closed-extract selection: The primary verifier (verifyBriefingExtractResult)
 *    verifies ordinal selections only ({ itemOrdinal, candidateOrdinal }[]).
 *    The model never produces, and the verifier never returns or parses, displayable
 *    free-form text, strings, claims, or labels.
 * 2. P1 Mechanical Proof: The closed schema itself is the P1 security boundary.
 *    Exact key allowlists at all levels (root, output, choices) strictly forbid extra
 *    fields (e.g. text, claim, title, label, summary, content, relationship/health speculation).
 * 3. Exact 1:1 request-response mapping: Exactly one choice per requested item in exact
 *    request order (0..N-1). Reject missing, duplicate, reordered, unknown, fractional,
 *    negative, or out-of-range item ordinals.
 * 4. Valid candidate bounds: Selected candidateOrdinal must exist for that exact item (0..K-1).
 * 5. Request fail-closed validation: The requested items themselves are validated fail-closed
 *    (sequential safe integer ordinals, non-empty candidate lists, valid candidate text without
 *    disallowed control codes). The verifier never returns or leaks candidate text.
 * 6. Zero-item behavior: An empty request (requestedItems: []) requires choices: [] with
 *    version: 1, resulting in { ok: true, choices: [] }. Any choices for an empty request reject.
 * 7. Bounded rejection metadata: Rejection returns only enumerated reasons and optional numeric
 *    ordinals without leaking user content, error strings, logs, paths, or keys.
 * 8. Zero dependencies: Zero external runtime dependencies, zero AI prompts, zero fallback
 *    generation, zero persistence, and zero logging.
 */

import type { BriefingExtractRequestItem } from './contract';
import type { BriefingProviderErrorCode } from './provider';

/**
 * Input for verifyBriefingExtractResult.
 */
export interface BriefingExtractVerifyInput {
  readonly expectedRequestId: string;
  readonly requestedItems: readonly BriefingExtractRequestItem[];
  readonly providerResult: unknown;
}

/**
 * Verified ordinal choice produced by the closed extract verifier.
 * Contains only request-local integer indices; zero text, IDs, or timestamps.
 */
export interface VerifiedBriefingChoice {
  readonly itemOrdinal: number;
  readonly candidateOrdinal: number;
}

/**
 * Enumerated reasons for closed-extract verifier rejection.
 */
export type BriefingExtractVerifyRejectionReason =
  | 'provider_failed'
  | 'correlation_mismatch'
  | 'invalid_request'
  | 'invalid_structure'
  | 'invalid_version'
  | 'invalid_choices'
  | 'invalid_ordinals'
  | 'unknown_item'
  | 'unknown_candidate'
  | 'reordered_choices';

/**
 * Bounded rejection metadata for closed extract verification.
 * Contains only the enumerated reason and optional numeric indices.
 * Excludes logs, text content, database IDs, URLs, paths, or keys.
 */
export interface BriefingExtractVerifyRejection {
  readonly reason: BriefingExtractVerifyRejectionReason;
  readonly itemOrdinal?: number;
  readonly candidateOrdinal?: number;
}

/**
 * Successful result from verifyBriefingExtractResult.
 * Contains only verified numeric ordinal choices.
 */
export interface BriefingExtractVerifySuccess {
  readonly ok: true;
  readonly choices: readonly VerifiedBriefingChoice[];
}

/**
 * Failed result from verifyBriefingExtractResult.
 * Contains only bounded rejection metadata.
 */
export interface BriefingExtractVerifyFailure {
  readonly ok: false;
  readonly rejection: BriefingExtractVerifyRejection;
}

/**
 * Discriminated union of verifyBriefingExtractResult outcomes.
 */
export type BriefingExtractVerifyResult =
  | BriefingExtractVerifySuccess
  | BriefingExtractVerifyFailure;

const ALLOWED_EXTRACT_SUCCESS_ROOT_KEYS = new Set(['ok', 'requestId', 'output']);
const ALLOWED_EXTRACT_FAILURE_ROOT_KEYS = new Set(['ok', 'code', 'requestId']);
const ALLOWED_EXTRACT_OUTPUT_KEYS = new Set(['version', 'choices']);
const ALLOWED_EXTRACT_CHOICE_KEYS = new Set(['itemOrdinal', 'candidateOrdinal']);

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

/**
 * Validates the extract selection request fail-closed.
 *
 * Requirements:
 * - expectedRequestId: non-empty trimmed string.
 * - requestedItems: Array of BriefingExtractRequestItem.
 * - item.itemOrdinal: Safe integer exactly matching index (0..N-1).
 * - item.candidates: Non-empty array of BriefingExtractCandidate.
 * - candidate.candidateOrdinal: Safe integer exactly matching index (0..K-1).
 * - candidate.text: Non-empty string without disallowed control characters.
 *
 * The verifier never returns or copies candidate text in its return value.
 */
function validateExtractRequest(
  expectedRequestId: string,
  requestedItems: readonly BriefingExtractRequestItem[],
): BriefingExtractVerifyRejection | null {
  if (typeof expectedRequestId !== 'string' || expectedRequestId.trim().length === 0) {
    return { reason: 'correlation_mismatch' };
  }

  if (!Array.isArray(requestedItems)) {
    return { reason: 'invalid_request' };
  }

  for (let i = 0; i < requestedItems.length; i += 1) {
    const item = requestedItems[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { reason: 'invalid_request', itemOrdinal: i };
    }

    const itemKeys = Object.keys(item);
    if (
      itemKeys.length !== 2 ||
      !itemKeys.includes('itemOrdinal') ||
      !itemKeys.includes('candidates')
    ) {
      return { reason: 'invalid_request', itemOrdinal: i };
    }

    if (!Number.isSafeInteger(item.itemOrdinal) || item.itemOrdinal !== i) {
      return {
        reason: 'invalid_request',
        itemOrdinal:
          typeof item.itemOrdinal === 'number' && Number.isFinite(item.itemOrdinal)
            ? item.itemOrdinal
            : i,
      };
    }

    if (!Array.isArray(item.candidates) || item.candidates.length === 0) {
      return { reason: 'invalid_request', itemOrdinal: i };
    }

    for (let j = 0; j < item.candidates.length; j += 1) {
      const cand = item.candidates[j];
      if (!cand || typeof cand !== 'object' || Array.isArray(cand)) {
        return { reason: 'invalid_request', itemOrdinal: i, candidateOrdinal: j };
      }

      const candKeys = Object.keys(cand);
      if (
        candKeys.length !== 2 ||
        !candKeys.includes('candidateOrdinal') ||
        !candKeys.includes('text')
      ) {
        return { reason: 'invalid_request', itemOrdinal: i, candidateOrdinal: j };
      }

      if (!Number.isSafeInteger(cand.candidateOrdinal) || cand.candidateOrdinal !== j) {
        return {
          reason: 'invalid_request',
          itemOrdinal: i,
          candidateOrdinal:
            typeof cand.candidateOrdinal === 'number' && Number.isFinite(cand.candidateOrdinal)
              ? cand.candidateOrdinal
              : j,
        };
      }

      if (
        typeof cand.text !== 'string' ||
        cand.text.trim().length === 0 ||
        hasDisallowedControlCharacters(cand.text)
      ) {
        return { reason: 'invalid_request', itemOrdinal: i, candidateOrdinal: j };
      }
    }
  }

  return null;
}

/**
 * Closed-Extract Verifier for on-device Partner Briefing (Gate A6 Amendment).
 *
 * Verifies untrusted BriefingExtractResult (or raw provider extract outputs)
 * against the exact requested items.
 *
 * Invariants & P1 Mechanical Proof:
 * 1. Output contains ONLY numeric ordinal choices: { itemOrdinal, candidateOrdinal }[].
 *    Zero generated, free-form, or displayable text fields; zero database IDs.
 * 2. Request validation is fail-closed: items must have sequential ordinals (0..N-1),
 *    non-empty candidate lists with sequential candidate ordinals (0..K-1),
 *    and valid non-control text. The verifier never returns or leaks candidate text.
 * 3. Exact key allowlists at all levels:
 *    - Success root: exactly ['ok', 'requestId', 'output']
 *    - Failure root: only ['ok', 'code', 'requestId']
 *    - Output: exactly ['version', 'choices']
 *    - Choice: exactly ['itemOrdinal', 'candidateOrdinal']
 * 4. Version must be strictly 1.
 * 5. Exactly one choice per requested item in request order (0..N-1).
 *    Missing, duplicate, reordered, unknown, fractional, negative ordinals are rejected.
 * 6. Selected candidate must exist for that exact item (0 <= candidateOrdinal < candidates.length).
 * 7. Zero-item behavior: An empty request (requestedItems: []) requires the provider to return
 *    choices: [] with version: 1, resulting in { ok: true, choices: [] }. Any choices for an
 *    empty request are rejected.
 * 8. Bounded rejection metadata: contains only enumerated reason and optional numeric indices.
 *    Zero user content, logs, or secrets.
 * 9. Zero dependencies, zero persistence, zero network, zero logging.
 */
export function verifyBriefingExtractResult(
  input: BriefingExtractVerifyInput,
): BriefingExtractVerifyResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, rejection: { reason: 'invalid_request' } };
  }

  const { expectedRequestId, requestedItems, providerResult } = input;

  const requestRejection = validateExtractRequest(expectedRequestId, requestedItems);
  if (requestRejection) {
    return { ok: false, rejection: requestRejection };
  }

  if (!providerResult || typeof providerResult !== 'object' || Array.isArray(providerResult)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const rootRecord = providerResult as Record<string, unknown>;

  if (rootRecord.ok === false) {
    const failureKeys = Object.keys(rootRecord);
    if (failureKeys.some((k) => !ALLOWED_EXTRACT_FAILURE_ROOT_KEYS.has(k))) {
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
    rootKeys.length !== ALLOWED_EXTRACT_SUCCESS_ROOT_KEYS.size ||
    rootKeys.some((k) => !ALLOWED_EXTRACT_SUCCESS_ROOT_KEYS.has(k))
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
    outputKeys.length !== ALLOWED_EXTRACT_OUTPUT_KEYS.size ||
    outputKeys.some((k) => !ALLOWED_EXTRACT_OUTPUT_KEYS.has(k))
  ) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  if (outputRecord.version !== 1 || typeof outputRecord.version !== 'number') {
    return { ok: false, rejection: { reason: 'invalid_version' } };
  }

  const rawChoices = outputRecord.choices;
  if (!Array.isArray(rawChoices)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  if (rawChoices.length !== requestedItems.length) {
    return { ok: false, rejection: { reason: 'invalid_choices' } };
  }

  const verifiedChoices: VerifiedBriefingChoice[] = [];

  for (let i = 0; i < requestedItems.length; i += 1) {
    const rawChoice = rawChoices[i];
    if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice)) {
      return { ok: false, rejection: { reason: 'invalid_structure', itemOrdinal: i } };
    }

    const choiceRecord = rawChoice as Record<string, unknown>;
    const choiceKeys = Object.keys(choiceRecord);
    if (
      choiceKeys.length !== ALLOWED_EXTRACT_CHOICE_KEYS.size ||
      choiceKeys.some((k) => !ALLOWED_EXTRACT_CHOICE_KEYS.has(k))
    ) {
      return { ok: false, rejection: { reason: 'invalid_structure', itemOrdinal: i } };
    }

    const itemOrd = choiceRecord.itemOrdinal;
    if (typeof itemOrd !== 'number' || !Number.isSafeInteger(itemOrd)) {
      return {
        ok: false,
        rejection: {
          reason: 'invalid_ordinals',
          itemOrdinal:
            typeof itemOrd === 'number' && Number.isFinite(itemOrd) ? itemOrd : undefined,
        },
      };
    }

    if (itemOrd !== i) {
      if (itemOrd < 0 || itemOrd >= requestedItems.length) {
        return { ok: false, rejection: { reason: 'unknown_item', itemOrdinal: itemOrd } };
      }
      return { ok: false, rejection: { reason: 'reordered_choices', itemOrdinal: itemOrd } };
    }

    const candOrd = choiceRecord.candidateOrdinal;
    if (typeof candOrd !== 'number' || !Number.isSafeInteger(candOrd)) {
      return {
        ok: false,
        rejection: {
          reason: 'invalid_ordinals',
          itemOrdinal: i,
          candidateOrdinal:
            typeof candOrd === 'number' && Number.isFinite(candOrd) ? candOrd : undefined,
        },
      };
    }

    const candidateCount = requestedItems[i].candidates.length;
    if (candOrd < 0 || candOrd >= candidateCount) {
      return {
        ok: false,
        rejection: {
          reason: 'unknown_candidate',
          itemOrdinal: i,
          candidateOrdinal: candOrd,
        },
      };
    }

    verifiedChoices.push({
      itemOrdinal: i,
      candidateOrdinal: candOrd,
    });
  }

  return {
    ok: true,
    choices: verifiedChoices,
  };
}
