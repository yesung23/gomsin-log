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
 *     That is a claim about REWRITING this file, and it does not extend to
 *     RUNNING it twice at once. The cap is judged when candidates are selected
 *     and only closed when `mark_push_delivered` lands, so two overlapping
 *     invocations can each select the same recipient before either has marked,
 *     and each will send. There is no row lock and no advisory lock on that
 *     path: **the database does not prevent concurrent workers.** For LV the
 *     risk is accepted operationally -- exactly one scheduler, no overlapping
 *     invocation -- and the conditions and the evidence they require are owned
 *     by `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` §6-1, not by this file.
 *
 *  4. **It persists no history.** `mark_push_delivered` lowers a flag and stamps
 *     a day boundary. No table gains a row per notification, because §19 forbids
 *     precise timestamps as analytics and a delivery history is the surveillance
 *     surface §16 rules out.
 *
 *     One honest qualification, because "records nothing" would be too strong.
 *     `logEvent` writes a recipient id and an outcome to the platform log, and a
 *     platform log is timestamped by the platform. For as long as that log is
 *     retained, it can answer "was this person notified, and roughly when" --
 *     and since a notification only fires when their partner acted, it can be
 *     read backwards. That is an operations surface, not a product feature: no
 *     client can reach it, nothing in the app queries it, and it holds no
 *     content. It is named here rather than left for someone to find, because
 *     retention of that log is a deployment decision this file cannot make.
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
   *
   * It comes from the DATABASE clock rather than this runtime's. A sender
   * running a few minutes fast would otherwise draw the boundary into the future
   * and swallow every act written in between -- the same bug, sourced from skew.
   */
  decided_at: string;
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
   * `mark_push_delivered()`. Stamps the day and moves the boundary.
   *
   * `decidedAt` is required rather than defaulted, here and in SQL, because the
   * default is exactly what went wrong: a call that omitted it looked correct
   * and silently erased any act shared during the send.
   */
  markDelivered: (userId: string, decidedAt: string) => Promise<void>;
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

  /*
    One recipient's bad minute is not everyone else's.

    Every await below can reject, not merely resolve `{ ok: false }`: `fetch`
    throws on a dropped connection, and an RPC throws when the database refuses.
    Unguarded, the first such rejection ends the whole loop -- so a single failing
    row silently cancels the notification for every person after it in the batch,
    and the larger the batch the more people it takes down. The daily cap then
    ensures they are not retried until the next scheduled run.

    Worse, it is order-dependent: the people already processed keep their
    notification, the rest lose theirs, and which group someone lands in is
    decided by map iteration order. That is an outage that looks like a quiet day.
  */
  for (const [userId, devices] of byUser) {
    let reachedSomewhere = false;

    for (const device of devices) {
      let result: SendResult;
      try {
        result = await deps.deliver(device);
      } catch {
        // A transport that threw is a transport that failed. Same meaning as
        // `{ ok: false }`, and the next run retries it.
        failed += 1;
        continue;
      }

      if (result.tokenGone) {
        // A dead token is not a failure to retry; it is a device that is gone.
        // Leaving it would make this person permanently "failed" and, worse,
        // would keep a stale token addressable if the account ever changed.
        try {
          await deps.dropToken(device.token);
          tokensDropped += 1;
        } catch {
          // The token stays; the next run tries to drop it again. Not being able
          // to delete a row must not cost this person their notification.
          failed += 1;
        }
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

      When the send lands but the flag will not lower, this counts as FAILED
      rather than delivered, and the count is the honest one: the person's turn
      did not complete. It also names the one duplicate this design permits --
      they were notified, `has_unseen` is still raised, and the next run may
      notify them again because the daily cap is stamped by the write that just
      failed. Delivering twice is the lesser error than the alternative, which is
      marking before sending and telling someone they were notified when nothing
      left the building.
    */
    if (reachedSomewhere) {
      try {
        /*
          Every device in this bucket carries the same `decided_at` -- it is one
          value per batch, not per row -- so the first one is the batch's, and
          the boundary is drawn where the decision was made rather than here.
        */
        await deps.markDelivered(userId, devices[0].decided_at);
        delivered += 1;
      } catch {
        failed += 1;
      }
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
