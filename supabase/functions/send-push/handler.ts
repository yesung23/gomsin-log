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
 *     `push_delivery_candidates()`, which returns a user id, a platform and a
 *     token. There is no join to `daily_records` available to it, no event kind
 *     in the schema, and no count anywhere. It cannot describe what happened
 *     because it does not know.
 *
 *  2. **Every notification is the same sentence.** Not "usually the same" and
 *     not "the same per kind" -- identical, always. A lock screen is read over a
 *     shoulder, and for this user base a phone observed in a 생활관 is the
 *     default assumption, not the edge case. If a care signal produced different
 *     text from a diary entry, the person glancing across the bunk would learn
 *     something about a stranger's partner's health. `NOTIFICATION_BODY` is a
 *     constant for that reason, and a test asserts it is the only body sent.
 *
 *  3. **It cannot decide who or when.** The daily cap and the contact window are
 *     enforced inside `push_delivery_candidates()`, in the database. A rewrite of
 *     this file cannot produce a second send or a 03:00 delivery, because it
 *     never had the authority to.
 *
 *  4. **It records nothing.** `mark_push_delivered` lowers a flag and stamps a
 *     day boundary. There is no delivery log, no receipt and no history, because
 *     §19 forbids precise timestamps as analytics and a delivery history is the
 *     surveillance surface §16 rules out.
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
  /** `mark_push_delivered()`. Lowers the flag and stamps the day. */
  markDelivered: (userId: string) => Promise<void>;
  /** Drop a token the push service has declared dead. */
  dropToken: (token: string) => Promise<void>;
  /** Ids and outcomes only. Never a token, never user content. */
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
    let reachedSomewhere = false;

    for (const device of devices) {
      const result = await deps.deliver(device);

      if (result.tokenGone) {
        // A dead token is not a failure to retry; it is a device that is gone.
        // Leaving it would make this person permanently "failed" and, worse,
        // would keep a stale token addressable if the account ever changed.
        await deps.dropToken(device.token);
        tokensDropped += 1;
        continue;
      }

      if (result.ok) reachedSomewhere = true;
      else failed += 1;
    }

    /*
      The flag is lowered only if the notification actually reached a device.

      The alternative -- marking on attempt -- silently converts a bad network
      minute into "this person was told", and because the daily cap then applies,
      they are not told again until tomorrow. Failing loudly and retrying on the
      next run is the honest direction: at worst the notification arrives later
      in the same contact window.
    */
    if (reachedSomewhere) {
      await deps.markDelivered(userId);
      delivered += 1;
    }

    deps.logEvent?.('push_attempt', {
      user_id: userId,
      devices: devices.length,
      delivered: reachedSomewhere,
    });
  }

  return {
    status: 200,
    body: { considered: byUser.size, delivered, failed, tokensDropped },
  };
}
