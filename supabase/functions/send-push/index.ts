import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchAccessToken, type ServiceAccount } from './googleAuth.ts';
import {
  NOTIFICATION_BODY,
  NOTIFICATION_ROUTE,
  handleSendPush,
  type PushCandidate,
} from './handler.ts';

/**
 * Thin Deno entrypoint. Every decision lives in `handler.ts` so it is covered by
 * the vitest suite; this file only injects the platform pieces.
 *
 * ## Who may call this
 *
 * A scheduler, with the service key. There is no user-facing path, because
 * "notify my partner" is not an action anyone gets to take. The database refuses
 * regardless -- `push_delivery_candidates()` carries an in-body service-role gate
 * -- so a mis-deployed route fails closed rather than quietly working.
 *
 * ## What the payload may contain
 *
 * One sentence and a route to home. No title that varies, no count, no badge, no
 * record id, no event kind. The body is a CONSTANT imported from the handler
 * rather than assembled here, so there is nowhere in this file that per-kind text
 * could be introduced without deleting that import first.
 *
 * ## Transport
 *
 * FCM v1 for both platforms; Firebase relays to APNs for iOS. One code path, one
 * credential to rotate, one place a delivery bug can live instead of two. The
 * cost is a Firebase project as an iOS prerequisite -- a setup step, not an
 * architectural commitment.
 *
 * DENO RUNTIME: type-checked, UNEXECUTED. No push credential exists in this
 * environment, so delivery itself is verified on real devices -- an external
 * gate this code cannot satisfy on its own.
 */

const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects';

/** FCM verdicts meaning "this token is dead", as opposed to "try again later". */
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);

Deno.serve(async (request: Request) => {
  // Scheduler-only. No CORS surface, because no browser is meant to reach this.
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'E_METHOD_NOT_ALLOWED' }), { status: 405 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let bearer: string;
  let projectId: string;
  try {
    const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
    if (!raw) throw new Error('E_PUSH_NOT_CONFIGURED');
    const account = JSON.parse(raw) as ServiceAccount;
    projectId = Deno.env.get('FCM_PROJECT_ID') ?? account.project_id ?? '';
    if (!projectId) throw new Error('E_PUSH_NOT_CONFIGURED');
    bearer = await fetchAccessToken(account, Math.floor(Date.now() / 1000));
  } catch (error) {
    /*
      Fail closed, and name which failure it was. A misconfigured sender must not
      be indistinguishable from a quiet day with nobody to notify -- that is the
      shape in which push silently stops working for a week.
    */
    const code = error instanceof Error && error.message.startsWith('E_')
      ? error.message
      : 'E_PUSH_AUTH_FAILED';
    return new Response(JSON.stringify({ error: code }), { status: 503 });
  }

  let outcome;
  try {
    outcome = await handleSendPush({
      listCandidates: async () => {
        const { data, error } = await admin.rpc('push_delivery_candidates');
        if (error) throw new Error('E_DB_READ_FAILED');
        return (data ?? []) as PushCandidate[];
      },

      deliver: async (candidate) => {
        const response = await fetch(`${FCM_ENDPOINT}/${projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: candidate.token,
              // One sentence, identical for every event kind. No title, because a
              // title is a second string that could start varying.
              notification: { body: NOTIFICATION_BODY },
              data: { route: NOTIFICATION_ROUTE },
              apns: {
                payload: {
                  aps: {
                    alert: { body: NOTIFICATION_BODY },
                    // No badge. A number on the app icon is a debt counter, which
                    // is the same thing §14.3 forbids inside the payload.
                    sound: 'default',
                  },
                },
              },
            },
          }),
        });

        if (response.ok) return { ok: true };

        const detail = await response.json().catch(() => ({})) as {
          error?: { details?: Array<{ errorCode?: string }> };
        };
        const code = detail.error?.details?.find((d) => d.errorCode)?.errorCode ?? '';
        // 404 is FCM's other way of saying the token no longer exists.
        return {
          ok: false,
          tokenGone: response.status === 404 || DEAD_TOKEN_CODES.has(code),
        };
      },

      markDelivered: async (userId, decidedAt) => {
        /*
          `p_decided_at` is the instant `push_delivery_candidates()` chose this
          batch, carried back unchanged. Passing this runtime's clock instead --
          or letting SQL default it to its own `now()`, which is what shipped
          before 055 -- draws the boundary after the decision and erases anything
          shared in between. See migration 055.
        */
        const { error } = await admin.rpc('mark_push_delivered', {
          p_user_id: userId,
          p_decided_at: decidedAt,
        });
        if (error) throw new Error('E_DB_WRITE_FAILED');
      },

      dropToken: async (dead) => {
        await admin.from('device_push_tokens').delete().eq('token', dead);
      },

      // Ids and outcomes only. Never a token, never user content.
      logEvent: (event, detail) => console.log(JSON.stringify({ event, ...detail })),
    });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('E_')
      ? error.message
      : 'E_PUSH_SEND_FAILED';
    return new Response(JSON.stringify({ error: code }), { status: 503 });
  }

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
