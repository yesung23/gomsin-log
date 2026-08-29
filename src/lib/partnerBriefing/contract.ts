/**
 * Partner Briefing Domain and Wire Contract (Phase A1 Amendment - v2 Grouping Plan)
 *
 * Defines the minimal pure TypeScript domain contract, model-safe wire payloads,
 * untrusted provider extract plans, and verified domain results for GomsinLog Partner Briefing.
 *
 * Architectural invariants:
 * 1. Model-safe request items and candidates never contain recordId, userId, coupleId,
 *    exact date/time, URLs, storage paths, or key material.
 * 2. Candidate text is a TypeScript-owned exact-source extract.
 * 3. The provider produces NO generated or displayable text fields. It only selects
 *    request-local integer ordinals (itemOrdinal and candidateOrdinal) organized into groups
 *    (version 2 UntrustedBriefingGroupPlan).
 * 4. Actual record IDs (sourceRecordId) are bound strictly by TypeScript after
 *    provenance verification, and never cross the model boundary.
 * 5. Exact calendar dates exist only in JS/domain final results; native AI
 *    payloads use synthetic request-local ordinals and coarse periods only.
 * 6. Every exact source record extract is preserved in order via `parts` within
 *    each PartnerBriefingItem ({ parts: [{ text, sourceRecordId }] }).
 * 7. Structured cycle/bleeding/pain/symptom/health fields are strictly excluded upstream
 *    from AI processing. Partner-shared readable non-private general record.log text
 *    is allowed exclusively on-device; no server AI, analytics, or persistent AI storage.
 * 8. Zero external runtime dependencies or legacy DailySummary imports.
 */

export const PARTNER_BRIEFING_VERSION = 1 as const;

/**
 * Wire format version for untrusted model extract grouping plans.
 */
export const PARTNER_BRIEFING_PLAN_VERSION = 2 as const;

/**
 * Supported locale for Partner Briefing presentation and fallback formatting.
 * - 'ko': Korean (default)
 * - 'en': English
 */
export type BriefingLocale = 'ko' | 'en';

export const DEFAULT_BRIEFING_LOCALE: BriefingLocale = 'ko';

/**
 * Provenance classification of the overall briefing output.
 * - 'on_device': Every displayed item is verified model candidate selection.
 * - 'hybrid': Verified model selections and deterministic fallback items coexist.
 * - 'deterministic': No model selection is displayed (100% deterministic fallback).
 */
export type BriefingGeneration = 'on_device' | 'hybrid' | 'deterministic';

/**
 * Coarse time-of-day period used across model payloads and domain presentation.
 */
export type BriefingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Media kinds attached to a source record, stripped of names, paths, and URLs.
 * Compatible with DailyRecord attachment kinds ('photo' | 'video' | 'voice').
 */
export type BriefingMediaKind = 'photo' | 'video' | 'voice';

/**
 * JS-only mapping between a synthetic source ordinal and the actual record ID.
 * Kept strictly on the client side; never sent across the model boundary.
 */
export interface BriefingSourceMapping {
  readonly ordinal: number;
  readonly recordId: string;
}

/**
 * Model-safe event payload used in internal normalization and chunking.
 *
 * Explicit allowlist: exactly { ordinal, dayOrdinal, period, text, mediaKinds }.
 * Does not extend DailyRecord and contains no user/couple/record IDs,
 * exact timestamps/dates, storage paths, URLs, or cryptographic material.
 */
export interface BriefingModelSafeEvent {
  readonly ordinal: number;
  readonly dayOrdinal: number;
  readonly period: BriefingPeriod;
  readonly text: string;
  readonly mediaKinds: readonly BriefingMediaKind[];
}

/**
 * Provider-safe extract candidate.
 *
 * Invariants:
 * - Candidate `text` is a TypeScript-owned exact-source extract.
 * - `candidateOrdinal` is a request-local integer index (0..K-1).
 * - Contains zero database IDs, user/couple IDs, dates/times, URLs, paths, or E2EE/auth fields.
 */
export interface BriefingExtractCandidate {
  readonly candidateOrdinal: number;
  readonly text: string;
}

/**
 * Provider-safe extract request item.
 *
 * Invariants:
 * - `itemOrdinal` is a request-local integer index (0..N-1).
 * - `candidates` is an array of candidate extracts derived from the exact source.
 * - The AI provider only selects candidate ordinals for each item ordinal.
 * - Actual record IDs are bound only in TypeScript and never cross the model boundary.
 * - Contains zero database IDs, user/couple IDs, dates/times, URLs, paths, or E2EE/auth fields.
 */
export interface BriefingExtractRequestItem {
  readonly itemOrdinal: number;
  readonly candidates: readonly BriefingExtractCandidate[];
}

/**
 * Untrusted provider choice selecting one candidate for a requested item.
 *
 * Invariants:
 * - Contains only request-local integer ordinals (`itemOrdinal` and `candidateOrdinal`).
 * - Contains NO generated/displayable text, strings, claims, or labels.
 */
export interface UntrustedBriefingChoice {
  readonly itemOrdinal: number;
  readonly candidateOrdinal: number;
}

/**
 * Untrusted provider group containing choices for contiguous items.
 *
 * Invariants:
 * - `groupOrdinal` is a request-local integer index (0..G-1).
 * - `choices` is an array of untrusted ordinal selections for items in this group.
 * - Contains NO generated, free-form, or displayable text fields whatsoever.
 */
export interface UntrustedBriefingGroup {
  readonly groupOrdinal: number;
  readonly choices: readonly UntrustedBriefingChoice[];
}

/**
 * Untrusted provider output grouping plan (v2).
 *
 * Invariants:
 * - `version` is strictly 2.
 * - `groups` is an array of untrusted group ordinal selections from the model.
 * - The provider only groups and selects ordinals from the TypeScript-supplied candidate list.
 * - Contains NO generated, free-form, or displayable text fields whatsoever.
 */
export interface UntrustedBriefingGroupPlan {
  readonly version: 2;
  readonly groups: readonly UntrustedBriefingGroup[];
}

export type UntrustedBriefingExtractPlan = UntrustedBriefingGroupPlan;

/**
 * Verified single source record extract part.
 *
 * Invariants:
 * - `text`: Attributed/extractive text derived from candidate extract or deterministic fallback.
 * - `sourceRecordId`: Exactly one real record ID, bound strictly in TypeScript after
 *   provenance verification. Never crosses the model boundary.
 */
export interface PartnerBriefingItemPart {
  readonly text: string;
  readonly sourceRecordId: string;
}

/**
 * Verified briefing item (potentially grouping multiple contiguous source extracts).
 *
 * Invariants:
 * - `parts`: Non-empty array of exact source record extract parts.
 * - Exact extract-to-original pairing is explicitly maintained per part.
 */
export interface PartnerBriefingItem {
  readonly parts: readonly PartnerBriefingItemPart[];
}

/**
 * Verified briefing overview with bound source record IDs.
 * Deterministic whole-window summary with exact union provenance.
 */
export interface PartnerBriefingOverview {
  readonly text: string;
  /**
   * Bound by TypeScript after provenance verification.
   * Represents the exact union of all source record IDs across the briefing.
   * Never generated by AI.
   */
  readonly sourceRecordIds: readonly string[];
}

/**
 * Verified briefing period section with bound source record IDs.
 */
export interface PartnerBriefingSection {
  readonly period: BriefingPeriod;
  /**
   * Verified items in this period section, each bound to one exact source record ID.
   */
  readonly items: readonly PartnerBriefingItem[];
}

/**
 * Verified briefing day grouping with bound sections.
 */
export interface PartnerBriefingDay {
  /**
   * Exact ISO date string (e.g. 'YYYY-MM-DD').
   * Managed strictly within JS/domain logic and never exposed to the AI model.
   */
  readonly date: string;
  readonly sections: readonly PartnerBriefingSection[];
}

/**
 * Final verified Partner Briefing domain result.
 */
export interface PartnerBriefing {
  readonly version: 1;
  readonly sourceCount: number;
  readonly generation: BriefingGeneration;
  readonly rangeLabel: string;
  readonly overview: PartnerBriefingOverview;
  readonly days: readonly PartnerBriefingDay[];
}
