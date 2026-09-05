/**
 * Partner Briefing Corpus Eligibility Gate (Phase A2)
 *
 * Evaluates whether records supplied from usePartnerDay().surface are eligible
 * to enter the Partner Briefing compression pipeline.
 *
 * Invariants:
 * 1. Fail-closed: if relationship state, viewer identity, or partner identity
 *    cannot be confirmed, the entire corpus is rejected (ok: false).
 * 2. Strict per-record checks: each record must be persisted (id, userId, createdAt),
 *    written by exact partnerUserId, non-private (isPrivate === false), and readable
 *    on this device (contentUnavailable absent).
 * 3. Surface fidelity: does not read state.records, recalculate OUTSTANDING,
 *    filter by date, enforce minimum count, sort, slice, or cap.
 * 4. Bounded rejection metadata: invalid records are excluded and reported as
 *    index + enumerated reason without logs, content, URLs, paths, or keys.
 * 5. In-memory stage: returns accepted DailyRecord references for Phase A3
 *    normalization. NOT a wire or model payload.
 */

import type { CoupleStatus, DailyRecord } from '@/types';
import { isRecordContentAvailable } from '@/lib/recordAvailability';

/**
 * Global rejection reason when the entire corpus fails closed.
 */
export type PartnerBriefingGlobalRejection =
  | 'couple_not_active'
  | 'identity_unresolved';

/**
 * Enumerated reason for excluding a single surface record.
 */
export type PartnerBriefingRecordRejectionReason =
  | 'unpersisted'
  | 'wrong_partner'
  | 'private'
  | 'unreadable';

/**
 * Bounded metadata for an excluded record.
 * Contains only the input surface index and the reason enum.
 * Never includes record text, log, URLs, storage paths, IDs, or key material.
 */
export interface PartnerBriefingRecordRejection {
  readonly index: number;
  readonly reason: PartnerBriefingRecordRejectionReason;
}

/**
 * Input to selectPartnerBriefingCorpus.
 *
 * The surface MUST be passed directly from usePartnerDay().surface.
 */
export interface PartnerBriefingCorpusInput {
  /**
   * Outstanding records supplied by usePartnerDay().surface.
   * Partner Briefing must not query or recalculate outstanding records.
   */
  readonly surface: readonly DailyRecord[];
  /**
   * Canonical viewer user ID (e.g. state.authenticatedUser?.id || profile.id).
   * Must be non-blank and distinct from partnerUserId.
   */
  readonly viewerUserId?: string | null;
  /**
   * Exact partner user ID from active couple membership (profile.couple.partnerUserId).
   * Must be non-blank and distinct from viewerUserId.
   */
  readonly partnerUserId?: string | null;
  /**
   * Whether the couple is actively connected.
   */
  readonly coupleConnected: boolean;
  /**
   * Status of the couple relationship. Must be exactly 'active'.
   */
  readonly coupleStatus?: CoupleStatus | null;
}

/**
 * Result of selectPartnerBriefingCorpus.
 *
 * Discriminated union on `ok`:
 * - ok: true -> accepted DailyRecord references + bounded per-record rejections.
 * - ok: false -> global rejection reason.
 */
export type PartnerBriefingCorpusResult =
  | {
      readonly ok: true;
      /**
       * In-memory references to accepted DailyRecord items from the supplied surface.
       * NOTE: This is an internal JS-only stage, NOT a wire or model payload.
       * Explicit normalization into model-safe events is owned by Phase A3.
       */
      readonly records: readonly DailyRecord[];
      /**
       * Bounded rejection metadata for surface records that failed eligibility.
       * Contains only input index and enumerated reason.
       */
      readonly rejections: readonly PartnerBriefingRecordRejection[];
    }
  | {
      readonly ok: false;
      readonly rejection: PartnerBriefingGlobalRejection;
    };

/**
 * Checks whether a record is persisted on the server.
 * Draft or outbox items lacking non-blank id, userId, or createdAt are rejected.
 */
export function isPersistedRecord(
  record: Pick<DailyRecord, 'id' | 'userId' | 'createdAt'>,
): boolean {
  return (
    typeof record.id === 'string' &&
    record.id.trim().length > 0 &&
    typeof record.userId === 'string' &&
    record.userId.trim().length > 0 &&
    typeof record.createdAt === 'string' &&
    record.createdAt.trim().length > 0
  );
}

/**
 * Evaluates the supplied PartnerDay surface against fail-closed privacy boundaries.
 *
 * Preserves exact surface order without sorting, date truncation, or Top-N limits.
 */
export function selectPartnerBriefingCorpus(
  input: PartnerBriefingCorpusInput,
): PartnerBriefingCorpusResult {
  const { surface, viewerUserId, partnerUserId, coupleConnected, coupleStatus } = input;

  if (coupleConnected !== true || coupleStatus !== 'active') {
    return { ok: false, rejection: 'couple_not_active' };
  }

  const cleanViewerId = viewerUserId?.trim();
  const cleanPartnerId = partnerUserId?.trim();

  if (!cleanViewerId || !cleanPartnerId || cleanViewerId === cleanPartnerId) {
    return { ok: false, rejection: 'identity_unresolved' };
  }

  const accepted: DailyRecord[] = [];
  const rejections: PartnerBriefingRecordRejection[] = [];

  for (let index = 0; index < surface.length; index += 1) {
    const record = surface[index];

    if (!isPersistedRecord(record)) {
      rejections.push({ index, reason: 'unpersisted' });
      continue;
    }

    if (record.userId !== cleanPartnerId) {
      rejections.push({ index, reason: 'wrong_partner' });
      continue;
    }

    if (record.isPrivate !== false) {
      rejections.push({ index, reason: 'private' });
      continue;
    }

    if (!isRecordContentAvailable(record)) {
      rejections.push({ index, reason: 'unreadable' });
      continue;
    }

    accepted.push(record);
  }

  return {
    ok: true,
    records: accepted,
    rejections,
  };
}
