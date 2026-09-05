/**
 * Partner Briefing Closed-Extract Verifier and Provenance Gate (Gate A6 Amendment - v2 Group Plan)
 *
 * Verifies untrusted BriefingExtractResult payloads from on-device AI providers.
 *
 * Closed-Extract Invariants (v2 Group Plan):
 * 1. Closed-extract selection: The primary verifier (verifyBriefingExtractResult)
 *    verifies ordinal group selections only (UntrustedBriefingGroupPlan: { version: 2, groups: [...] }).
 *    The model never produces, and the verifier never returns or parses, displayable
 *    free-form text, strings, claims, or labels.
 * 2. P1 Mechanical Proof: The closed schema itself is the P1 security boundary.
 *    Exact key allowlists at all levels (root, output, group, choice) strictly forbid extra
 *    fields (e.g. text, claim, title, label, summary, content, relationship/health speculation).
 * 3. Group and item partition constraints:
 *    - For N requested items (0..N-1), flattening all choices across all groups in order
 *      must yield exactly itemOrdinal = 0..N-1 with no missing, duplicate, reordered,
 *      unknown, fractional, or negative item ordinals.
 *    - Each group's groupOrdinal must be a safe integer exactly matching its index in the groups array (0..G-1).
 *    - Selected candidateOrdinal must exist on that requested item (0..K-1).
 *    - For N = 0: groups must be [] (empty array).
 *    - For N = 1: exactly 1 group containing exactly 1 choice.
 *    - For N >= 2: every group must have size between 2 and 4 (choices.length in 2..4).
 *      Singleton groups (size 1) or oversized groups (> 4) are strictly rejected.
 * 4. Request fail-closed validation: The requested items themselves are validated fail-closed
 *    (sequential safe integer ordinals, non-empty candidate lists, valid candidate text without
 *    disallowed control codes). The verifier never returns or leaks candidate text.
 * 5. Bounded rejection metadata: Rejection returns only enumerated reasons and optional numeric
 *    indices without leaking user content, error strings, logs, paths, or keys.
 * 6. Zero dependencies: Zero external runtime dependencies, zero AI prompts, zero fallback
 *    generation, zero persistence, and zero logging.
 */

import type {
  BriefingExtractRequestItem,
  UntrustedBriefingChoice,
  UntrustedBriefingGroup,
} from './contract';
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
export type VerifiedBriefingChoice = UntrustedBriefingChoice;

/**
 * Verified group of choices preserving compression boundaries.
 */
export type VerifiedBriefingGroup = UntrustedBriefingGroup;

/**
 * Enumerated reasons for closed-extract verifier rejection.
 */
export type BriefingExtractVerifyRejectionReason =
  | 'provider_failed'
  | 'correlation_mismatch'
  | 'invalid_request'
  | 'invalid_structure'
  | 'invalid_version'
  | 'invalid_groups'
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
  readonly groupOrdinal?: number;
  readonly itemOrdinal?: number;
  readonly candidateOrdinal?: number;
}

/**
 * Successful result from verifyBriefingExtractResult.
 * Contains verified groups preserving compression boundaries.
 */
export interface BriefingExtractVerifySuccess {
  readonly ok: true;
  readonly groups: readonly VerifiedBriefingGroup[];
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
const ALLOWED_EXTRACT_OUTPUT_KEYS = new Set(['version', 'groups']);
const ALLOWED_EXTRACT_GROUP_KEYS = new Set(['groupOrdinal', 'choices']);
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
 * Closed-Extract Verifier for on-device Partner Briefing (v2 Group Plan).
 *
 * Verifies untrusted BriefingExtractResult (or raw provider extract outputs)
 * against the exact requested items.
 *
 * Invariants & P1 Mechanical Proof:
 * 1. Output contains ONLY numeric ordinal groups: { groupOrdinal, choices: { itemOrdinal, candidateOrdinal }[] }[].
 *    Zero generated, free-form, or displayable text fields; zero database IDs.
 * 2. Request validation is fail-closed: items must have sequential ordinals (0..N-1),
 *    non-empty candidate lists with sequential candidate ordinals (0..K-1),
 *    and valid non-control text. The verifier never returns or leaks candidate text.
 * 3. Exact key allowlists at all levels:
 *    - Success root: exactly ['ok', 'requestId', 'output']
 *    - Failure root: only ['ok', 'code', 'requestId']
 *    - Output: exactly ['version', 'groups']
 *    - Group: exactly ['groupOrdinal', 'choices']
 *    - Choice: exactly ['itemOrdinal', 'candidateOrdinal']
 * 4. Version must be strictly 2.
 * 5. Group constraints:
 *    - N = 0: groups must be [].
 *    - N = 1: exactly 1 group of size 1.
 *    - N >= 2: all groups must have size between 2 and 4 (choices.length in 2..4). Singletons rejected.
 * 6. Flattened itemOrdinals across all groups must equal exactly 0..N-1 in order.
 * 7. Selected candidate must exist for that exact item (0 <= candidateOrdinal < candidates.length).
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

  if (outputRecord.version !== 2) {
   return { ok: false, rejection: { reason: 'invalid_version' } };
 }

 const rawGroups = outputRecord.groups;
  if (!Array.isArray(rawGroups)) {
    return { ok: false, rejection: { reason: 'invalid_structure' } };
  }

  const requestCount = requestedItems.length;

  if (requestCount === 0) {
    if (rawGroups.length !== 0) {
      return { ok: false, rejection: { reason: 'invalid_groups' } };
    }
    return { ok: true, groups: [] };
  }

  const verifiedGroups: VerifiedBriefingGroup[] = [];
  let currentExpectedItemOrdinal = 0;

  for (let g = 0; g < rawGroups.length; g += 1) {
    const rawGroup = rawGroups[g];
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
      return { ok: false, rejection: { reason: 'invalid_structure', groupOrdinal: g } };
    }

    const groupRecord = rawGroup as Record<string, unknown>;
    const groupKeys = Object.keys(groupRecord);
    if (
      groupKeys.length !== ALLOWED_EXTRACT_GROUP_KEYS.size ||
      groupKeys.some((k) => !ALLOWED_EXTRACT_GROUP_KEYS.has(k))
    ) {
      return { ok: false, rejection: { reason: 'invalid_structure', groupOrdinal: g } };
    }

    const groupOrd = groupRecord.groupOrdinal;
    if (typeof groupOrd !== 'number' || !Number.isSafeInteger(groupOrd) || groupOrd !== g) {
      return {
        ok: false,
        rejection: {
          reason: 'invalid_ordinals',
          groupOrdinal:
            typeof groupOrd === 'number' && Number.isFinite(groupOrd) ? groupOrd : g,
        },
      };
    }

    const rawChoices = groupRecord.choices;
    if (!Array.isArray(rawChoices)) {
      return { ok: false, rejection: { reason: 'invalid_structure', groupOrdinal: g } };
    }

    // Group size constraints:
    // If requestCount === 1, exactly 1 group with size 1.
    // If requestCount >= 2, every group must have choices.length between 2 and 4.
    if (requestCount === 1) {
      if (rawGroups.length !== 1 || rawChoices.length !== 1) {
        return { ok: false, rejection: { reason: 'invalid_groups', groupOrdinal: g } };
      }
    } else {
      // requestCount >= 2
      if (rawChoices.length < 2 || rawChoices.length > 4) {
        return { ok: false, rejection: { reason: 'invalid_groups', groupOrdinal: g } };
      }
    }

    const verifiedChoices: VerifiedBriefingChoice[] = [];

    for (let c = 0; c < rawChoices.length; c += 1) {
      const rawChoice = rawChoices[c];
      if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice)) {
        return {
          ok: false,
          rejection: {
            reason: 'invalid_structure',
            groupOrdinal: g,
            itemOrdinal: currentExpectedItemOrdinal,
          },
        };
      }

      const choiceRecord = rawChoice as Record<string, unknown>;
      const choiceKeys = Object.keys(choiceRecord);
      if (
        choiceKeys.length !== ALLOWED_EXTRACT_CHOICE_KEYS.size ||
        choiceKeys.some((k) => !ALLOWED_EXTRACT_CHOICE_KEYS.has(k))
      ) {
        return {
          ok: false,
          rejection: {
            reason: 'invalid_structure',
            groupOrdinal: g,
            itemOrdinal: currentExpectedItemOrdinal,
          },
        };
      }

      const itemOrd = choiceRecord.itemOrdinal;
      if (typeof itemOrd !== 'number' || !Number.isSafeInteger(itemOrd)) {
        return {
          ok: false,
          rejection: {
            reason: 'invalid_ordinals',
            groupOrdinal: g,
            itemOrdinal:
              typeof itemOrd === 'number' && Number.isFinite(itemOrd) ? itemOrd : undefined,
          },
        };
      }

      /*
        Bounds BEFORE the ordinal is ever used as an index.

        This check used to live inside the `itemOrd !== currentExpectedItemOrdinal`
        branch, which meant an out-of-range ordinal that HAPPENED to equal the expected
        one skipped it entirely. `currentExpectedItemOrdinal` advances with every consumed
        choice, so an untrusted plan that returns more choices than were requested walks it
        past the end: with two requested items, a plan carrying itemOrdinal 2 satisfied the
        equality test, fell through, and hit `requestedItems[2].candidates` below --
        a TypeError thrown out of a verifier whose entire contract is to return a bounded
        rejection. Nothing caught it at the call site, so one malformed batch destroyed the
        whole run, including batches that had already verified cleanly.
      */
      if (itemOrd < 0 || itemOrd >= requestCount) {
        return {
          ok: false,
          rejection: {
            reason: 'unknown_item',
            groupOrdinal: g,
            itemOrdinal: itemOrd,
          },
        };
      }

      if (itemOrd !== currentExpectedItemOrdinal) {
        return {
          ok: false,
          rejection: {
            reason: 'reordered_choices',
            groupOrdinal: g,
            itemOrdinal: itemOrd,
          },
        };
      }

      const candOrd = choiceRecord.candidateOrdinal;
      if (typeof candOrd !== 'number' || !Number.isSafeInteger(candOrd)) {
        return {
          ok: false,
          rejection: {
            reason: 'invalid_ordinals',
            groupOrdinal: g,
            itemOrdinal: itemOrd,
            candidateOrdinal:
              typeof candOrd === 'number' && Number.isFinite(candOrd) ? candOrd : undefined,
          },
        };
      }

      const candidateCount = requestedItems[itemOrd].candidates.length;
      if (candOrd < 0 || candOrd >= candidateCount) {
        return {
          ok: false,
          rejection: {
            reason: 'unknown_candidate',
            groupOrdinal: g,
            itemOrdinal: itemOrd,
            candidateOrdinal: candOrd,
          },
        };
      }

      verifiedChoices.push({
        itemOrdinal: itemOrd,
        candidateOrdinal: candOrd,
      });

      currentExpectedItemOrdinal += 1;
    }

    verifiedGroups.push({
      groupOrdinal: g,
      choices: verifiedChoices,
    });
  }

  // Ensure all items were covered (no missing items at the end)
  if (currentExpectedItemOrdinal !== requestCount) {
    return { ok: false, rejection: { reason: 'invalid_choices' } };
  }

  return {
    ok: true,
    groups: verifiedGroups,
  };
}
