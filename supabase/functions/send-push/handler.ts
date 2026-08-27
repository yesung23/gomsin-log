/**
 * `send-push` — deliver the one generic notification a recipient is due.
 *
 * The handler is pure and takes its platform pieces as arguments, matching
 * `approve-device` and `delete-account`, so every branch below is reachable from
 * the test suite without a network or a real APNs key.
 *
 * ## What this function is NOT allowed to know
 *
 * PRODUCT_V3 §14.3 does not describe a notification feature; it describes a
 * category of product that must not be buildable. This function is the place
 * where that would be violated first, so the constraints are structural rather
 * than stylistic:
 *
 *  1. **It cannot read content.** Its entire view of the world is
 *     `push_delivery_candidates()`, which returns a user id, a platform, a
 *     token, a decided_at timestamp, and an atomic claim_id. There is no join to
 *     `daily_records` available to it, no event kind in the schema, and no count
 *     anywhere. It cannot describe what happened because it does not know.
 *
 *  2. **Every notification is the same sentence.** Not "usually the same" and
 *     not "the same per kind" -- identical, always. A lock screen is read over a
 *     shoulder, and for this user base a phone observed in a 생활관 is the
 *     default assumption, not the edge case. If a care signal produced different
 *     text from a diary entry, the person glancing across the bunk would learn
 *     something about a stranger's partner's health. `NOTIFICATION_BODY` is a
 *     constant for that reason, and a test asserts it is the only body sent.
 *
 *  3. **It cannot decide who or when.** The daily cap, contact window, and atomic
 *     recipient leases are enforced inside `push_delivery_candidates()`, in the
 *     database via `FOR UPDATE SKIP LOCKED` (migration 066). Concurrent or overlapping
 *     invocations cannot lease or notify the same recipient.
 *
 *  4. **It persists no history.** `mark_push_delivered` lowers a flag, stamps
 *     a day boundary, and clears the lease claim. No table gains a row per notification,
 *     because §19 forbids precise timestamps as analytics and a delivery history
 *     is the surveillance surface §16 rules out.
 *
 *     `logEvent` writes non-identifying device counts and outcomes to the platform
 *     log. It never logs user IDs, tokens, or content.
 *
 * DENO RUNTIME: UNEXECUTED. No Deno toolchain is available in this environment.
 */

/** The only text this service ever sends. See rule 2 above. */
export const NOTIFICATION_BODY = '새로운 소식이 있어요';

/**
 * Where a tap lands: home, always.
 *
 * The payload carries no record id. `INFORMATION_ARCHITECTURE_2026-08-20` §3.1
 * settled this -- a per-record destination would mean the payload named a
 * specific entry, and a notification that can point at one record is a
 * notification that has already told you which one it was about.
 */
export const NOTIFICATION_ROUTE = '/';

export interface PushCandidate {
  user_id: string;
  platform: 'ios' | 'android';
  token: string;
  /**
   * When the database DECIDED this send, not when it is recorded.
   *
   * Identical on every row of one batch -- it is `push_delivery_candidates()`'s
   * own `now()`, handed back so the mark can be written against the instant the
   * notification was actually about. Migration 055 explains why the alternative
   * loses acts; the short version is that anything shared between the decision
   * and the mark falls behind a boundary drawn by a notification that could not
   * have contained it.
   */
  decided_at: string;
  /**
   * Invocation-supplied claim/lease ID (migration 066) held on push_delivery_state.
   */
  claim_id: string;
}

export interface SendResult {
  ok: boolean;
  /** The push service says this token is dead. Distinct from a transient failure. */
  tokenGone?: boolean;
}

export interface SendPushDeps {
  /** `push_delivery_candidates()`. The function's entire view of the world. */
  listCandidates: () => Promise<PushCandidate[]>;
  /** Deliver one notification. The body is not a parameter -- see rule 2. */
  deliver: (candidate: PushCandidate) => Promise<SendResult>;
  /**
   * `mark_push_delivered()`. Stamps the day, moves the boundary, and clears the lease claim.
   */
  markDelivered: (userId: string, decidedAt: string, claimId: string) => Promise<void>;
  /** Explicitly release the lease claim when delivery to all devices fails. */
  releaseClaim: (userId: string, claimId: string) => Promise<void>;
  /** Drop a token the push service has declared dead. */
  dropToken: (token: string) => Promise<void>;
  /** Outcome metadata only. Never user_id, never a token, never user content. */
  logEvent?: (event: string, detail: Record<string, unknown>) => void;
}

export interface SendPushOutcome {
  status: number;
  body: {
    considered: number;
    delivered: number;
    failed: number;
    tokensDropped: number;
  };
}

export async function handleSendPush(deps: SendPushDeps): Promise<SendPushOutcome> {
  const candidates = await deps.listCandidates();

  /*
    Grouped by recipient, because one person may carry several devices and §14.3
    caps SENDS PER PERSON, not per device. Delivering to three devices is one
    notification arriving in three places; delivering three times to one person
    would be three notifications.
  */
  const byUser = new Map<string, PushCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byUser.get(candidate.user_id);
    if (bucket) bucket.push(candidate);
    else byUser.set(candidate.user_id, [candidate]);
  }

  let delivered = 0;
  let failed = 0;
  let tokensDropped = 0;

  for (const [userId, devices] of byUser) {
    if (!devices || devices.length === 0) continue;

    const first = devices[0];
    const claimId = first.claim_id;
    const decidedAt = first.decided_at;

    // Validate that all devices for this recipient share valid, identical claim_id and decided_at
    const isBucketValid =
      typeof claimId === 'string' &&
      claimId.length > 0 &&
      typeof decidedAt === 'string' &&
      decidedAt.length > 0 &&
      devices.every(
        (d) => d.claim_id === claimId && d.decided_at === decidedAt && typeof d.token === 'string' && d.token.length > 0,
      );

    if (!isBucketValid) {
      failed += 1;
      if (typeof claimId === 'string' && claimId.length > 0) {
        try {
          await deps.releaseClaim(userId, claimId);
        } catch {
          // Best effort release
        }
      }
      continue;
    }

    let reachedSomewhere = false;

    for (const device of devices) {
      let result: SendResult;
      try {
        result = await deps.deliver(device);
      } catch {
        failed += 1;
        continue;
      }

      if (result.tokenGone) {
        try {
          await deps.dropToken(device.token);
          tokensDropped += 1;
        } catch {
          failed += 1;
        }
        continue;
      }

      if (result.ok) reachedSomewhere = true;
      else failed += 1;
    }

    if (reachedSomewhere) {
      try {
        await deps.markDelivered(userId, decidedAt, claimId);
        delivered += 1;
      } catch {
        // If FCM succeeded but mark failed, DO NOT release the claim:
        // keeping the lease active avoids immediate replay by overlapping workers.
        failed += 1;
      }
    } else {
      // If delivery failed to all devices, release the claim so the next scheduler run can retry.
      try {
        await deps.releaseClaim(userId, claimId);
      } catch {
        // Best effort release
      }
    }

    deps.logEvent?.('push_attempt', {
      devices: devices.length,
      delivered: reachedSomewhere,
    });
  }

  return {
    status: 200,
    body: { considered: byUser.size, delivered, failed, tokensDropped },
  };
}
