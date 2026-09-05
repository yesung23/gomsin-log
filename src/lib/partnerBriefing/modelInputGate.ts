/**
 * Partner Briefing model-input value gate (P1-1).
 *
 * The normalizer that feeds this pipeline strips every piece of record METADATA before an
 * event is built: no recordId, userId, coupleId, exact timestamp, attachment name, storage
 * path or URL survives `normalizePartnerBriefingCorpus`. What it does not do -- and cannot
 * do by shape alone -- is look at the VALUES the partner typed. `normalizeBriefingText`
 * only collapses control and separator whitespace, so the whole of `record.log` is copied
 * verbatim into the model-safe event's `text`.
 *
 * So a partner who writes such a value into the body of a shared record defeats the metadata
 * allowlist entirely. Reproduced against this pipeline before the gate existed: a shared log
 * containing a Storage signed URL, the canonical `{coupleId}/{recordId}/{file}` object path,
 * and the record/user/couple UUIDs put the token, the host, the object path and all three
 * UUIDs into the provider request. Sentence segmentation in `fallback.ts` does not help --
 * it split the URL across candidates, so the full string vanished from a naive whole-string
 * search while every sensitive component still crossed the native boundary.
 *
 * This module answers one question about one string: does it contain a value that must never
 * reach an AI model. It is deliberately value-shaped rather than entropy-shaped:
 *
 * - Korean prose cannot match any pattern here. Every detector needs either an ASCII
 *   structural marker (`://`, `token=`, `-----BEGIN`) or a long ASCII run, and a Hangul
 *   syllable terminates every ASCII run.
 * - Nothing is redacted, masked or truncated. A partial rewrite would put text in front of
 *   the model that is no longer the exact source, which is the one thing the provenance
 *   contract forbids. The caller routes the whole source to the deterministic exact-source
 *   path instead.
 * - A non-string fails closed rather than being coerced.
 *
 * The cost of a false positive is bounded and non-destructive: that one record is summarized
 * deterministically from its exact source instead of on-device, keeps its `sourceRecordId`,
 * and still navigates to the exact original. The cost of a false negative is a partner's
 * signed URL or key material inside a native model prompt. That asymmetry is why borderline
 * shapes resolve to unsafe.
 */

/**
 * Why a source was withheld from the model. Enumerated, never a message string, so it can be
 * carried in bounded metadata without echoing any part of the offending value.
 */
export type BriefingModelInputRisk =
  | 'invalid_text'
  | 'uuid'
  | 'url'
  | 'storage_path'
  | 'credential'
  | 'key_material'
  | 'opaque_token';

/** Canonical 8-4-4-4-12 UUID: every recordId, userId and coupleId in this schema is one. */
const UUID_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/**
 * Any `scheme://` -- https, http, blob, file, capacitor. A Storage signed URL always carries
 * one, and no Korean sentence contains `://`.
 */
const URL_SCHEME_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** `data:...;base64,` carries no `//`, so it needs its own detector. */
const DATA_URL_PATTERN = /data:[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+;base64,/i;

/** A JWT header segment. Supabase access tokens and signed-URL tokens start this way. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}/;

/**
 * Crypto identifiers that only ever appear as uppercase acronyms in this codebase. Matched
 * case-sensitively and word-bounded so lowercase prose cannot trip them.
 */
const KEY_TOKEN_PATTERN = /(?:^|[^A-Za-z0-9])(?:GLE1|GLK2|PMK|CSK|HRK)(?:[^A-Za-z0-9]|$)/;

/**
 * Long opaque ASCII runs: base64url tokens, raw secrets, opaque object keys. A run must carry
 * BOTH a letter and a digit, so ordinary long words and the repeated-character fixtures the
 * envelope tests rely on ('A'.repeat(500)) are not flagged. `/` is deliberately outside the
 * alphabet: a run containing one is a path, which the path and URL detectors already own.
 *
 * This subsumes a hex-run detector: hex characters are inside this alphabet, and a raw key,
 * digest, nonce or unhyphenated UUID mixes letters and digits. A separate `[0-9a-fA-F]{32,}`
 * rule was tried first and had to go -- 'A' is a hex character, so it flagged the benign
 * `'A'.repeat(500)` fixture the envelope tests are built from, for no security gain.
 */
const OPAQUE_RUN_PATTERN = /[A-Za-z0-9+_=-]{32,}/g;

/**
 * Lowercased substring markers, grouped by the reason they imply so the enumerated risk stays
 * meaningful. `couple-media/` mirrors `MEDIA_BUCKET` in `src/lib/records.ts` and is spelled
 * out rather than imported, because importing it would pull the Supabase client into a module
 * whose whole contract is to have zero external runtime dependencies.
 */
const STORAGE_PATH_MARKERS = [
  'storage/v1/object',
  '/object/sign/',
  '/object/authenticated/',
  '/object/public/',
  'couple-media/',
] as const;

const CREDENTIAL_MARKERS = [
  'access_token',
  'refresh_token',
  'token=',
  'apikey',
  'api_key',
  'x-amz-signature',
  'signature=',
  'authorization:',
  'bearer ',
] as const;

const KEY_MATERIAL_MARKERS = [
  '-----begin',
  'private key',
  'wrappeddek',
  'dekwrapnonce',
  'contentnonce',
] as const;

/** A bare Supabase host, for a path pasted without its scheme. */
const URL_MARKERS = ['supabase.co'] as const;

function containsAny(haystack: string, markers: readonly string[]): boolean {
  return markers.some((marker) => haystack.includes(marker));
}

function hasOpaqueTokenRun(text: string): boolean {
  const runs = text.match(OPAQUE_RUN_PATTERN);
  if (runs === null) {
    return false;
  }
  return runs.some((run) => /[A-Za-z]/.test(run) && /[0-9]/.test(run));
}

/**
 * Returns the first risk found, in a fixed precedence order, or null when the text carries no
 * value that must be withheld from the model. Pure: never mutates, redacts or logs the input.
 */
export function findBriefingModelInputRisk(
  text: unknown,
): BriefingModelInputRisk | null {
  if (typeof text !== 'string') {
    return 'invalid_text';
  }
  if (text.length === 0) {
    return null;
  }

  if (UUID_PATTERN.test(text)) {
    return 'uuid';
  }
  if (URL_SCHEME_PATTERN.test(text) || DATA_URL_PATTERN.test(text)) {
    return 'url';
  }

  const lowered = text.toLowerCase();
  if (containsAny(lowered, URL_MARKERS)) {
    return 'url';
  }
  if (containsAny(lowered, STORAGE_PATH_MARKERS)) {
    return 'storage_path';
  }
  if (containsAny(lowered, CREDENTIAL_MARKERS) || JWT_PATTERN.test(text)) {
    return 'credential';
  }
  if (containsAny(lowered, KEY_MATERIAL_MARKERS) || KEY_TOKEN_PATTERN.test(text)) {
    return 'key_material';
  }
  if (hasOpaqueTokenRun(text)) {
    return 'opaque_token';
  }

  return null;
}

/** Convenience predicate over {@link findBriefingModelInputRisk}. */
export function isBriefingModelInputSafe(text: unknown): boolean {
  return findBriefingModelInputRisk(text) === null;
}

/**
 * The minimum shape this gate needs from a provider request item. Structural rather than an
 * import of `BriefingExtractRequestItem` so the gate cannot drift into depending on the wire
 * contract, and so it can be pointed at anything about to cross the boundary.
 */
export interface BriefingModelInputCandidateLike {
  readonly text: unknown;
}

export interface BriefingModelInputItemLike {
  readonly candidates: readonly BriefingModelInputCandidateLike[];
}

/**
 * Final boundary assertion: the risk carried by an assembled request, or null when every
 * candidate of every item is safe to send.
 *
 * Candidates are substrings of an already-gated source, so in a correct pipeline this always
 * returns null. It exists because "already gated upstream" is an assumption, and this is the
 * last line of TypeScript before the native call. A malformed item or candidate fails closed
 * rather than throwing out of a function whose contract is to answer.
 */
export function findBriefingRequestItemsRisk(
  items: unknown,
): BriefingModelInputRisk | null {
  if (!Array.isArray(items)) {
    return 'invalid_text';
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return 'invalid_text';
    }
    const candidates = (item as BriefingModelInputItemLike).candidates;
    if (!Array.isArray(candidates)) {
      return 'invalid_text';
    }
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        return 'invalid_text';
      }
      const risk = findBriefingModelInputRisk(
        (candidate as BriefingModelInputCandidateLike).text,
      );
      if (risk !== null) {
        return risk;
      }
    }
  }
  return null;
}
