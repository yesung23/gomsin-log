import type { BrowserContext, Route } from '@playwright/test';

/**
 * A deterministic stand-in for GoTrue + PostgREST, installed per browser context.
 *
 * This is BROWSER-WITH-MOCKS, not real Supabase E2E. Nothing here proves an RLS
 * policy: every authorization answer below is one this file decided to give. What
 * it does prove is everything jsdom cannot -- real layout at real viewports, real
 * hit-testing, real focus order, real CSS, real bundle, real router, and the real
 * store reacting to real HTTP shapes.
 *
 * The endpoint list mirrors `fetchFullStateResultFromDB` (src/lib/sync.ts:95+) and
 * the invitation functions in src/lib/supabase.ts, so a change in what the app
 * actually requests will surface here as an unrouted request rather than as a
 * silently green test -- `failOnUnroutedSupabaseCall` enforces that.
 */

export const SUPABASE_URL = 'https://example.supabase.co';
/** supabase-js derives its storage key from the project ref (first host label). */
export const AUTH_STORAGE_KEY = 'sb-example-auth-token';

export type Scenario = {
  userId: string;
  displayName: string;
  role: 'gomsin' | 'soldier';
  coupleId: string | null;
  /** Whether `get_partner_profile` returns a partner (drives connected vs pending). */
  partnerPresent: boolean;
  partnerName?: string;
  anniversaryDate?: string;
  records?: RecordRow[];
  events?: unknown[];
  trips?: unknown[];
  /** Server verdict for `redeem_invitation`. */
  redeemResult?:
    | { ok: true; coupleId: string }
    | { ok: false; errorCode: string };
  /** Force a specific table/rpc to fail, to prove honest error copy. */
  failures?: Partial<Record<string, { status: number; code: string; message: string }>>;
  invitationActive?: boolean;
  invitationExpiresAt?: string | null;
  /**
   * No `profiles` row yet, i.e. a genuinely new account.
   *
   * `fetchFullStateResultFromDB` treats a SUCCESSFUL EMPTY profile lookup as the
   * only proof of a new account (a failed lookup must never become onboarding),
   * so this is the one switch that puts the app into the onboarding wizard.
   */
  newAccount?: boolean;
  /** Server verdict for `create_couple_and_invitation`. */
  createCoupleId?: string;
};

/**
 * The REAL `daily_records` column names (migration 001:129-140).
 *
 * Getting these wrong is not a harmless fixture detail: `record_date` is mapped
 * to `DailyRecord.date` and `RecordPage` does `record.date.split('-')`, so a
 * fixture using `date` instead of `record_date` crashes the whole page through
 * the ErrorBoundary and looks exactly like a product bug. All three are
 * `NOT NULL` in the schema, so that crash is NOT reachable through the real
 * backend -- which is why the fixture has to speak the database's column names.
 */
export type RecordRow = {
  id: string;
  user_id: string;
  couple_id: string;
  record_date: string;
  record_time: string;
  log_text: string;
  is_private: boolean;
  reaction?: string | null;
  attachments?: unknown[];
  emotion_flow?: unknown[];
  emotion_updated_at?: string | null;
  created_at?: string;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Range': '0-0/*',
    },
    body: JSON.stringify(body),
  });
}

/**
 * PostgREST returns a bare object (not an array) when the client asked for one
 * via `.single()` / `.maybeSingle()`. Honouring that is what makes supabase-js
 * parse the response instead of throwing.
 */
function rows(route: Route, list: unknown[]) {
  const accept = route.request().headers()['accept'] || '';
  if (accept.includes('pgrst.object')) {
    if (list.length === 0) {
      // What PostgREST really sends for a 0-row single(): 406 with this code.
      return json(route, { code: 'PGRST116', message: 'no rows', details: null, hint: null }, 406);
    }
    return json(route, list[0]);
  }
  return json(route, list);
}

function failureFor(scenario: Scenario, key: string) {
  return scenario.failures?.[key];
}

/** A session shaped like the one supabase-js persists, valid far into the future. */
export function seededSession(scenario: Scenario) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  return {
    access_token: `e2e-access-${scenario.userId}`,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: expiresAt,
    refresh_token: `e2e-refresh-${scenario.userId}`,
    user: authUser(scenario),
  };
}

function authUser(scenario: Scenario) {
  return {
    id: scenario.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${scenario.userId}@example.test`,
    app_metadata: {},
    user_metadata: { full_name: scenario.displayName },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/**
 * Minimal Phoenix/Realtime channel server.
 *
 * Without this the socket never opens, the store correctly fails closed, and
 * `sharedSyncStatus` stays `unavailable` -- which HIDES the shared workspace and
 * makes the partner-visibility and record surfaces unreachable. Mocking the
 * subscribe handshake is therefore what makes the connected half of the matrix
 * testable at all.
 *
 * Only the handshake is implemented: `phx_join` -> ok, plus the `system`
 * "Subscribed" frame supabase-realtime v2 waits for before reporting SUBSCRIBED,
 * heartbeats, and `access_token` refreshes. No row-level events are pushed.
 */
export async function installMockRealtime(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      let message: { topic?: string; event?: string; ref?: string | null };
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      const { topic, event, ref } = message;
      const ok = (overrideTopic?: string) =>
        ws.send(
          JSON.stringify({
            topic: overrideTopic ?? topic,
            event: 'phx_reply',
            payload: { status: 'ok', response: {} },
            ref: ref ?? null,
          }),
        );

      if (event === 'heartbeat') return ok('phoenix');
      if (event === 'phx_join') {
        ok();
        ws.send(
          JSON.stringify({
            topic,
            event: 'system',
            payload: {
              status: 'ok',
              extension: 'postgres_changes',
              message: 'Subscribed to PostgreSQL',
            },
            ref: null,
          }),
        );
        return;
      }
      if (event === 'access_token' || event === 'phx_leave') return ok();
    });
  });
}

export async function installMockBackend(
  context: BrowserContext,
  scenario: Scenario,
): Promise<{ unrouted: string[] }> {
  const unrouted: string[] = [];
  await installMockRealtime(context);

  // Seed the session BEFORE any app script runs, so the very first
  // `onAuthStateChange` already has an authenticated identity.
  //
  // `hasSeenInstallPrompt` is also seeded: the PWA install banner is a fixed
  // overlay, and leaving it up makes every click in the lower half of the screen
  // a hit-testing coin flip. It is one of the three device preferences the store
  // deliberately carries across accounts (store.tsx carryOverDevicePrefs), so
  // this is the app's own supported way to express "already dismissed".
  await context.addInitScript(
    ([authKey, session, stateKey, prefs]) => {
      window.localStorage.setItem(authKey as string, JSON.stringify(session));
      window.localStorage.setItem(stateKey as string, JSON.stringify(prefs));
    },
    [
      AUTH_STORAGE_KEY,
      seededSession(scenario),
      'gomsinlog.state.v2',
      { hasSeenInstallPrompt: true, theme: 'light', widgetLayout: ['today_word', 'dday'] },
    ] as const,
  );

  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
        body: '',
      });
    }

    // ---- GoTrue ----------------------------------------------------------
    if (path === '/auth/v1/user') return json(route, authUser(scenario));
    if (path === '/auth/v1/token') return json(route, seededSession(scenario));
    if (path === '/auth/v1/logout') return json(route, {});

    // ---- PostgREST tables ------------------------------------------------
    if (path === '/rest/v1/profiles') {
      const failure = failureFor(scenario, 'profiles');
      if (failure) return json(route, failure, failure.status);
      // A brand-new account: the row does not exist yet. Writes still succeed, so
      // the wizard can complete.
      if (scenario.newAccount && method === 'GET') return rows(route, []);
      if (method !== 'GET') {
        const body = request.postDataJSON();
        return rows(route, Array.isArray(body) ? body : [body]);
      }
      return rows(route, [
        {
          id: scenario.userId,
          display_name: scenario.displayName,
          role: scenario.role,
          avatar_path: null,
          onboarding_completed_at: '2026-01-02T00:00:00Z',
          military_info: {
            branch: 'army',
            militaryStatus: 'serving',
            enlistmentDate: '2025-03-10',
            expectedDischargeDate: '2026-09-09',
            dischargeDateSource: 'calculated',
          },
        },
      ]);
    }

    if (path === '/rest/v1/couple_members') {
      const failure = failureFor(scenario, 'couple_members');
      if (failure) return json(route, failure, failure.status);
      if (!scenario.coupleId) return rows(route, []);
      return rows(route, [
        { couple_id: scenario.coupleId, status: 'active', role: scenario.role },
      ]);
    }

    if (path === '/rest/v1/couples') {
      return rows(route, [
        {
          id: scenario.coupleId,
          anniversary_date: scenario.anniversaryDate ?? '2025-01-01',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]);
    }

    if (path === '/rest/v1/contact_preferences') {
      return rows(route, [
        {
          user_id: scenario.userId,
          weekday_start: '18:00',
          weekday_end: '21:00',
          weekend_start: '12:00',
          weekend_end: '21:00',
        },
      ]);
    }

    if (path === '/rest/v1/daily_records') {
      const failure = failureFor(scenario, 'daily_records');
      if (failure) return json(route, failure, failure.status);
      if (method === 'GET') return rows(route, scenario.records ?? []);
      // Writes echo the payload back, as PostgREST does with `return=representation`.
      const body = request.postDataJSON();
      return rows(route, Array.isArray(body) ? body : [body]);
    }

    if (path === '/rest/v1/events') return rows(route, scenario.events ?? []);
    if (path === '/rest/v1/trips') return rows(route, scenario.trips ?? []);
    if (path === '/rest/v1/trip_items' || path === '/rest/v1/trip_checklists') {
      const failure = failureFor(scenario, path.replace('/rest/v1/', ''));
      if (failure) return json(route, failure, failure.status);
      if (method === 'GET') return rows(route, []);
      if (method === 'DELETE') return rows(route, [{ id: 'deleted' }]);
      // Inserts/updates use `.select().single()`, so the row has to come back or
      // the app correctly reports a failure. Echoing the payload with a
      // server-assigned id is what PostgREST actually does.
      const body = request.postDataJSON();
      const payload = Array.isArray(body) ? body[0] : body;
      return rows(route, [{
        id: `srv-${Math.abs(JSON.stringify(payload).length)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...payload,
      }]);
    }
    if (path === '/rest/v1/cycle_settings' || path === '/rest/v1/cycle_entries') {
      return rows(route, []);
    }
    if (path === '/rest/v1/cycle_support_signals') return rows(route, []);

    // ---- RPCs ------------------------------------------------------------
    if (path === '/rest/v1/rpc/get_partner_profile') {
      const failure = failureFor(scenario, 'get_partner_profile');
      if (failure) return json(route, failure, failure.status);
      return json(
        route,
        scenario.partnerPresent
          ? [{ display_name: scenario.partnerName ?? '파트너' }]
          : [],
      );
    }

    if (path === '/rest/v1/rpc/get_my_active_couple_id') {
      return json(route, scenario.coupleId);
    }

    if (path === '/rest/v1/rpc/get_my_couple_state') {
      const failure = failureFor(scenario, 'get_my_couple_state');
      if (failure) return json(route, failure, failure.status);
      // `parseRemoteCoupleState` rejects an array outright (coupleLifecycle.ts:47),
      // so this RPC must answer with a bare object the way a `RETURNS TABLE`
      // single-row function does through PostgREST's object accept header.
      return json(route, {
        couple_id: scenario.coupleId,
        role: scenario.role,
        member_status: scenario.coupleId ? 'active' : null,
        partner_present: scenario.partnerPresent,
        invitation_active: scenario.invitationActive ?? !scenario.partnerPresent,
        invitation_expires_at:
          scenario.invitationExpiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      });
    }

    if (path === '/rest/v1/rpc/redeem_invitation') {
      // `redeem_invitation` is `RETURNS JSONB` (015:100) and the client parser
      // rejects an array outright, so this must be a BARE object. Wrapping it in
      // an array makes the app say "migration 015 is required", which is correct
      // behaviour for an unrecognised shape and would look like a product bug.
      // `ok` is REQUIRED: `parseInvitationRedemptionResult` rejects a payload
      // whose `ok` is not a boolean, and an unparseable payload is reported as
      // "migration 015 is not deployed" -- correct for a real shape mismatch, and
      // indistinguishable from a product bug if the fixture is wrong.
      const verdict = scenario.redeemResult;
      if (!verdict) {
        return json(route, { ok: false, error_code: 'invalid_or_expired', couple_id: null });
      }
      return json(
        route,
        verdict.ok
          ? { ok: true, error_code: null, couple_id: verdict.coupleId }
          : { ok: false, error_code: verdict.errorCode, couple_id: null },
      );
    }

    if (path === '/rest/v1/rpc/create_couple_and_invitation') {
      const failure = failureFor(scenario, 'create_couple_and_invitation');
      if (failure) return json(route, failure, failure.status);
      return json(route, scenario.createCoupleId ?? 'couple-created-by-e2e');
    }

    if (path === '/rest/v1/contact_preferences' && method !== 'GET') {
      const body = request.postDataJSON();
      return rows(route, Array.isArray(body) ? body : [body]);
    }

    if (path === '/rest/v1/couples' && method !== 'GET') {
      const body = request.postDataJSON();
      return rows(route, Array.isArray(body) ? body : [body]);
    }

    if (path === '/rest/v1/rpc/regenerate_invitation') {
      const failure = failureFor(scenario, 'regenerate_invitation');
      if (failure) return json(route, failure, failure.status);
      return json(route, true);
    }

    // ---- Storage ---------------------------------------------------------
    if (path.startsWith('/storage/v1/object/sign/')) {
      return json(route, { signedURL: `/storage/v1/object/signed-stub` });
    }
    if (path.startsWith('/storage/v1/object/')) {
      const failure = failureFor(scenario, 'storage_upload');
      if (failure) return json(route, failure, failure.status);
      if (method === 'POST' || method === 'PUT') {
        return json(route, { Key: path.replace('/storage/v1/object/', '') });
      }
      if (method === 'DELETE') return json(route, []);
      return json(route, []);
    }

    if (path.startsWith('/realtime/')) return route.abort();

    unrouted.push(`${method} ${path}`);
    return json(route, { message: `unrouted in mock backend: ${method} ${path}` }, 500);
  });

  return { unrouted };
}
