import type { CoupleInfo } from '@/types';

/**
 * The five states a couple space can actually be in, as the USER experiences it.
 *
 * The persisted `CoupleStatus` (`'pending' | 'active' | 'disconnected'`) is
 * deliberately left alone -- 448 existing tests depend on it and it is what the
 * server rows model. This is a DERIVED view that adds the two distinctions the
 * persisted shape cannot express:
 *
 *  - `personal` vs `pending`: both looked like "not connected", so a creator
 *    holding a live invitation was shown personal-mode copy telling them to
 *    enter a code -- the one thing `redeem_invitation` rejects for them.
 *  - `unknown`: the question could not be answered. It is a first-class variant
 *    for the same reason `DeletionStatus.unknown` is: an unanswered question must
 *    never be rendered as an authoritative negative.
 */
export type CoupleLifecycle =
  /** No couple space at all. Safe to offer both "create" and "join". */
  | 'personal'
  /** A space exists, the partner has not joined yet. Never offer "join". */
  | 'pending'
  /** Both partners present. */
  | 'connected'
  /** A space existed and was disconnected. */
  | 'disconnected'
  /** Could not be determined. MUST NOT be shown as `personal`. */
  | 'unknown';

/**
 * What `public.get_my_couple_state()` (migration 016) returns.
 *
 * It never contains an invitation code or a code hash -- only whether one is
 * outstanding and when it expires.
 */
export type RemoteCoupleState = {
  coupleId: string | null;
  role: string | null;
  memberStatus: string | null;
  partnerPresent: boolean;
  invitationActive: boolean;
  invitationExpiresAt: string | null;
};

/** Parse the RPC's JSONB payload without trusting any field. */
export function parseRemoteCoupleState(value: unknown): RemoteCoupleState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  // `couple_id` is the only field whose absence is meaningful, so it must be
  // present and either a string or an explicit null.
  if (!('couple_id' in row)) return null;
  const coupleId = row.couple_id;
  if (coupleId !== null && typeof coupleId !== 'string') return null;
  const expiresAt = row.invitation_expires_at;
  return {
    coupleId: coupleId ?? null,
    role: typeof row.role === 'string' ? row.role : null,
    memberStatus: typeof row.member_status === 'string' ? row.member_status : null,
    partnerPresent: row.partner_present === true,
    invitationActive: row.invitation_active === true,
    invitationExpiresAt: typeof expiresAt === 'string' ? expiresAt : null,
  };
}

/**
 * Derive the lifecycle.
 *
 * `remote === undefined` means "not asked yet / could not ask", which is exactly
 * `unknown`; it is NOT an excuse to fall back to the local guess, because local
 * state can be a stale `pending` from before a partner joined. The local snapshot
 * is only consulted for the one thing the server cannot know: whether this device
 * still believes it is disconnected.
 */
export function deriveCoupleLifecycle(
  remote: RemoteCoupleState | null | undefined,
  local: CoupleInfo | undefined,
): CoupleLifecycle {
  if (remote === undefined) return 'unknown';

  if (remote === null || !remote.coupleId) {
    /**
     * The server is definite: this account is in no couple space.
     *
     * `disconnected` requires POSITIVE evidence that a space was known -- a local
     * `coupleId`. `status: 'disconnected'` alone is NOT evidence: `sync.ts` uses it
     * as the default for an account that has never had a couple at all, so keying
     * on it told brand-new users "커플 공간 연결이 해제되었어요" about a space they
     * never had.
     */
    return local?.coupleId ? 'disconnected' : 'personal';
  }

  if (remote.memberStatus && remote.memberStatus !== 'active') return 'disconnected';
  return remote.partnerPresent ? 'connected' : 'pending';
}

/**
 * Merge a server answer into local couple state.
 *
 * Contract, in order of precedence:
 *
 * 1. An `unknown` answer (`remote === undefined`) returns `local` UNCHANGED. This
 *    is the invariant that stops a failed check from wiping a valid couple space.
 * 2. A definite answer wins over local belief.
 * 3. The plaintext `coupleCode` is preserved while -- and only while -- it is
 *    still useful: the same couple id, and no partner yet. The server stores only
 *    a hash, so this device is the only place the code exists; dropping it on a
 *    routine refresh is what left creators with an unrecoverable invitation.
 */
export function mergeCoupleState(
  local: CoupleInfo,
  remote: RemoteCoupleState | null | undefined,
): CoupleInfo {
  if (remote === undefined) return local;

  if (remote === null || !remote.coupleId) {
    const cleared = { ...local };
    delete cleared.partnerUserId;
    delete cleared.partnerJoinedAt;
    delete cleared.partnerMilitary;
    return {
      ...cleared,
      coupleId: undefined,
      partnerName: '',
      coupleCode: '',
      connected: false,
      status: 'disconnected',
    };
  }

  const sameCouple = local.coupleId === remote.coupleId;
  const keepsVerifiedPartner = sameCouple
    && remote.partnerPresent
    && (!remote.memberStatus || remote.memberStatus === 'active');
  const base = { ...local };
  if (!keepsVerifiedPartner) {
    delete base.partnerUserId;
    delete base.partnerJoinedAt;
    delete base.partnerMilitary;
  }
  /**
   * The cached plaintext is only worth keeping while it can still be redeemed.
   *
   * `invitationActive` is the server's own verdict, computed in
   * `get_my_couple_state()` as "an invitation row exists that is unused AND
   * unexpired" (016). Consulting it -- rather than only `partnerPresent` -- is
   * what stops a lapsed or already-consumed code from being displayed as if a
   * partner could still type it in. It is also why this does not compare the
   * expiry against the local clock: the authoritative answer is already here.
   */
  const keepCode = sameCouple && !remote.partnerPresent && remote.invitationActive;

  return {
    ...base,
    coupleId: remote.coupleId,
    // The partner's display name comes from `get_partner_profile`, not from here.
    partnerName: remote.partnerPresent ? local.partnerName : '',
    coupleCode: keepCode ? local.coupleCode : '',
    connected: remote.partnerPresent,
    status: remote.memberStatus && remote.memberStatus !== 'active'
      ? 'disconnected'
      : remote.partnerPresent ? 'active' : 'pending',
  };
}

/** Has the outstanding invitation already lapsed? */
export function isInvitationExpired(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return false;
  return deadline <= now.getTime();
}

/**
 * Human-readable remaining validity, e.g. `약 5시간 남음`.
 *
 * Rounded deliberately: a to-the-second countdown on a 24-hour code invites the
 * user to watch it rather than send it.
 */
export function invitationExpiryLabel(
  expiresAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!expiresAt) return null;
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return null;
  const remainingMs = deadline - now.getTime();
  if (remainingMs <= 0) return '만료됨';
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `약 ${hours}시간 남음`;
  const minutes = Math.max(1, Math.round(remainingMs / (60 * 1000)));
  return `약 ${minutes}분 남음`;
}
