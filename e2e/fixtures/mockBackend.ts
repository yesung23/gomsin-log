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

/** Valid 1x1 PNG used when the app downloads an existing photo for safe re-upload. */
const MOCK_PHOTO_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

export type Scenario = {
  userId: string;
  displayName: string;
  role: 'gomsin' | 'soldier';
  coupleId: string | null;
  /** Whether `get_partner_profile` returns a partner (drives connected vs pending). */
  partnerPresent: boolean;
  /** Active couple_members row returned for the other member when queried. */
  partnerUserId?: string;
  partnerName?: string;
  /** Username projection returned by migration 060 when the partner exists. */
  partnerUsername?: string;
  /** Sanitized migration-063 projection for a gomsin viewing the soldier. */
  partnerMilitary?: {
    branch: string;
    militaryStatus: string;
    enlistmentDate?: string;
    expectedDischargeDate?: string;
    dischargeDate?: string;
    dischargeDateSource: string;
  };
  anniversaryDate?: string;
  records?: RecordRow[];
  /**
   * Rows for `talk_about_marks`.
   *
   * Left unseeded these scenarios returned an empty list unconditionally, which
   * meant no browser test could reach any surface built on a mark -- the list
   * widget's populated state, or 통화 모드 at all. Empty stays the DEFAULT, so
   * every existing scenario behaves exactly as before.
   */
  talkAboutMarks?: unknown[];
  events?: unknown[];
  coupleTasks?: unknown[];
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
  is_profile_post?: boolean;
  reaction?: string | null;
  attachments?: unknown[];
  emotion_flow?: unknown[];
  emotion_updated_at?: string | null;
  created_at?: string;
};

/**
 * The path a signed-URL stub must return.
 *
 * Deliberately does NOT start with `/storage/v1`. supabase-js concatenates its
 * own storage base onto whatever `signedURL` it is given, so the previous stub's
 * `/storage/v1/object/signed-stub` came back out as
 * `https://…/storage/v1/storage/v1/object/signed-stub` -- a 404 in the mock,
 * which the app faithfully reported as `이 파일을 열 수 없어요`.
 *
 * That was invisible for as long as it existed because no scenario had an
 * attachment, so nothing ever followed a signed URL.
 */
function signedStub(path?: string) {
  return path ? `/object/signed-stub?p=${encodeURIComponent(path)}` : '/object/signed-stub';
}

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
  scenario: Scenario
): Promise<{ unrouted: string[]; dailyRecordWrites: Array<Record<string, unknown>> }> {
  const unrouted: string[] = [];
  const dailyRecordWrites: Array<Record<string, unknown>> = [];
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
    if (path === '/auth/v1/settings') {
      return json(route, { external: { google: true, apple: true, email: true } });
    }
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
        const payloads = Array.isArray(body) ? body : [body];
        return rows(route, payloads.map((payload) => ({ id: scenario.userId, ...payload })));
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
      const userFilter = url.searchParams.get('user_id') ?? '';
      if (userFilter.startsWith('neq.')) {
        if (!scenario.partnerPresent || !scenario.partnerUserId) return rows(route, []);
        return rows(route, [{
          couple_id: scenario.coupleId,
          user_id: scenario.partnerUserId,
          joined_at: '2026-01-02T00:00:00Z',
          status: 'active',
        }]);
      }
      return rows(route, [
        { couple_id: scenario.coupleId, user_id: scenario.userId, status: 'active', role: scenario.role },
      ]);
    }

    if (path === '/rest/v1/recovery_identities' && method === 'GET') {
      const failure = failureFor(scenario, 'recovery_identities');
      if (failure) return json(route, failure, failure.status);
      // The browser scenarios do not seed a recovery ceremony. `maybeSingle()`
      // therefore receives PostgREST's contractually correct no-row response,
      // which the repository parses as a missing recovery identity.
      return rows(route, []);
    }

    if (path === '/rest/v1/crypto_write_floor' && method === 'GET') {
      const failure = failureFor(scenario, 'crypto_write_floor');
      if (failure) return json(route, failure, failure.status);
      // No seeded bootstrap/activation means no write-floor row for the
      // requested scope. The repository maps this exact absence to floor 0;
      // returning a fabricated floor would change the security state the browser
      // is meant to exercise.
      return rows(route, []);
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
      const payloads = Array.isArray(body) ? body : [body];
      if (method !== 'GET') {
        // Test-only observation: prove that a connected protection-required
        // save never reaches a plaintext daily_records write.
        for (const p of payloads) dailyRecordWrites.push(p);
      }
      // Migration 032 supplies this server-side DEFAULT for legacy plaintext
      // inserts, and saveRecordToDB selects it to pin the next CAS revision.
      return rows(route, payloads.map((payload) => ({
        ...payload,
        content_revision: Number.isSafeInteger(payload?.content_revision)
          && payload.content_revision >= 1
          ? payload.content_revision
          : 1,
      })));
    }

    /*
      §19 measurement. Accepted and discarded.

      The app emits these on the real product paths, so without this route every
      scenario logged a 500 to the browser console -- and several tests assert
      there are none, correctly. Returning an empty array rather than echoing the
      row is deliberate: nothing reads these back, and a fixture that stored them
      would invite a test to assert on analytics instead of on behaviour.
    */
    if (path === '/rest/v1/product_events') return rows(route, []);
    /*
      `clear_my_unseen` lowers the caller's own delivery flag when the app comes
      into view, and it runs in a browser exactly as it does on a device. Unrouted
      it 404s, `clearOwnUnseen` logs the failure, and the layout matrix -- which
      asserts a clean console on purpose -- goes red across every viewport.

      Accepted and discarded, like `product_events` above. The flag is server
      state with no client-visible effect, so echoing anything back would invite a
      test to assert on delivery bookkeeping instead of on what the person sees.
    */
    if (path === '/rest/v1/rpc/clear_my_unseen') return json(route, null);
    // Push is disabled by default in the active product. A connected account may
    // still carry a token registered by an older build, so the client revokes it
    // once while the authenticated session is valid. The browser fixture accepts
    // and discards that hygiene RPC just like the unseen-flag cleanup above.
    if (path === '/rest/v1/rpc/revoke_my_push_tokens') return json(route, null);
    if (path === '/rest/v1/events') return rows(route, scenario.events ?? []);
    if (path === '/rest/v1/couple_tasks') {
      const failure = failureFor(scenario, 'couple_tasks');
      if (failure) return json(route, failure, failure.status);
      return rows(route, scenario.coupleTasks ?? []);
    }
    if (path === '/rest/v1/trips') return rows(route, scenario.trips ?? []);
    // Migration 058 is additive to the full-state hydration path. Keep the
    // browser fixture additive too: an empty highlight workspace is a valid
    // connected-account response, not an unrouted 500.
    if (path === '/rest/v1/couple_highlights' && method === 'GET') {
      const failure = failureFor(scenario, 'couple_highlights');
      if (failure) return json(route, failure, failure.status);
      return rows(route, []);
    }
    if (path === '/rest/v1/talk_about_marks' && method === 'GET') {
      const failure = failureFor(scenario, 'talk_about_marks');
      if (failure) return json(route, failure, failure.status);
      // `fetchTalkAboutMarksResultFromDB` selects pending metadata rows for the
      // active couple. A scenario that seeds none gets the real empty result; no
      // record content or security authority is fabricated either way, because a
      // mark carries only coordination metadata and the client still resolves the
      // record itself through the normal, authorized path.
      return rows(route, scenario.talkAboutMarks ?? []);
    }
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
    if (
      path === '/rest/v1/cycle_settings'
      || path === '/rest/v1/cycle_entries'
      // V3 owner-only tables.
      || path === '/rest/v1/cycle_periods'
      || path === '/rest/v1/cycle_daily_logs'
      || path === '/rest/v1/cycle_sharing_preferences'
      || path === '/rest/v1/user_sensitive_consents'
    ) {
      return rows(route, []);
    }
    if (path === '/rest/v1/cycle_support_signals') return rows(route, []);

    // ---- RPCs ------------------------------------------------------------
    if (path === '/rest/v1/rpc/get_partner_profile_with_username') {
      const failure = failureFor(scenario, 'get_partner_profile_with_username');
      if (failure) return json(route, failure, failure.status);
      return json(
        route,
        scenario.partnerPresent
          ? [{
            display_name: scenario.partnerName ?? '파트너',
            role: scenario.role === 'gomsin' ? 'soldier' : 'gomsin',
            avatar_path: null,
            username: scenario.partnerUsername ?? null,
          }]
          : [],
      );
    }

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

    if (path === '/rest/v1/rpc/get_partner_service_info') {
      const failure = failureFor(scenario, 'get_partner_service_info');
      if (failure) return json(route, failure, failure.status);
      if (scenario.role !== 'gomsin' || !scenario.partnerPresent || !scenario.partnerMilitary) {
        return json(route, []);
      }
      return json(route, [{
        branch: scenario.partnerMilitary.branch,
        military_status: scenario.partnerMilitary.militaryStatus,
        enlistment_date: scenario.partnerMilitary.enlistmentDate ?? null,
        expected_discharge_date: scenario.partnerMilitary.expectedDischargeDate ?? null,
        discharge_date: scenario.partnerMilitary.dischargeDate ?? null,
        discharge_date_source: scenario.partnerMilitary.dischargeDateSource,
      }]);
    }

    // The partner view calls this on every render, so leaving it unrouted made
    // the mock answer 500 and the app log "Failed to fetch partner cycle
    // projection" — which failed the layout matrix's console-error assertion at
    // every viewport, for the partner role only.
    //
    // Shaped to match 026 rather than invented: the RPC is RETURNS TABLE, so
    // PostgREST sends an array, and it returns NO row when there is no uid, no
    // active couple, or no partner. When a couple does exist it returns exactly
    // one row, all-false here because the scenarios share nothing — every cycle
    // table above answers empty, and consent is never granted.
    //
    // The all-false row is the meaningful case to serve: it exercises the real
    // parsing path in fetchPartnerCycleProjectionFromDB and then renders as an
    // empty projection, whereas returning [] short-circuits to `projection: null`
    // before any of those fields is read.
    if (path === '/rest/v1/rpc/get_partner_cycle_projection') {
      const failure = failureFor(scenario, 'get_partner_cycle_projection');
      if (failure) return json(route, failure, failure.status);
      if (!scenario.coupleId || !scenario.partnerPresent) return json(route, []);
      return json(route, [{
        has_current_period_status: false,
        current_period_active: false,
        has_prediction_window: false,
        prediction_window_start: null,
        prediction_window_end: null,
        has_fertility_window: false,
        fertility_window_start: null,
        fertility_window_end: null,
      }]);
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
    /*
     * `createSignedUrls` (plural) and `createSignedUrl` (singular) are the same
     * endpoint with two different response SHAPES, and this stub only spoke the
     * singular one: `{ signedURL }`.
     *
     * The app uses the plural form (`records.ts signValidatedAttachments`), whose
     * response must be an ARRAY of `{ path, signedUrl, error }`. supabase-js calls
     * `.map()` on it, so an object came back as `data.map is not a function` -- a
     * TypeError, which is not a StorageError, so supabase-js rethrows it instead
     * of returning `{ error }`. It escaped `signValidatedAttachments` (which
     * handles `error` but not a throw), aborted the record load, and surfaced as
     * the full-screen `계정 정보를 확인하지 못했어요 / UNEXPECTED-UNKNOWN` screen.
     *
     * Nothing caught it because no scenario in `e2e/scenarios.ts` had a single
     * attachment: every record ships `attachments: []`, so this branch had never
     * once run. Media was structurally untestable in the browser suite.
     *
     * The singular shape is kept for any caller that asks for one path, so both
     * forms are answered correctly rather than one being traded for the other.
     */
    if (path.startsWith('/storage/v1/object/sign/')) {
      const body = request.postDataJSON?.() as { paths?: unknown[]; expiresIn?: number } | null;
      const paths = Array.isArray(body?.paths) ? (body!.paths as string[]) : null;
      if (paths) {
        return json(
          route,
          paths.map((p) => ({ path: p, signedURL: signedStub(p), error: null })),
        );
      }
      return json(route, { signedURL: signedStub() });
    }
    if (path.startsWith('/storage/v1/object/')) {
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: MOCK_PHOTO_BYTES,
        });
      }
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

  return { unrouted, dailyRecordWrites };
}
