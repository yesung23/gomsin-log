# Implementation Plan

Working branch `kimi/web-release-stabilization` at `7d82e3efd1b17283b0e8f086e94cf97cf268b625`.
Tasks are ordered C1 → C5 so each cluster is independently verifiable and committable, with the
verification gates last.

**Three resolved decisions, now consistent across bugfix.md, design.md and this plan** (each is a
settled decision recorded in all three documents, not an open question this plan resolves alone):

1. **Test baseline is 206 tests across 23 files** (measured on this branch). Recorded in bugfix.md
   clause 2.29(d) and in design.md's Testing Strategy. Every task below uses 206/23 as the number
   that must not regress.
2. **Deletion recovery rests on TWO ranked authorities, not on a flag inside `STORE_KEY`.**
   - **Primary (server, source of truth):** the admin-only Auth flag
     `app_metadata.account_deletion_pending`, written **with the service-role key inside the
     `delete-account` Edge Function** and never writable by any client. It travels with the
     account, so it survives cleared browser storage, a private window and a different device.
   - **Secondary (local, immediate/offline/reload guard only):** a dedicated per-user marker at
     the top-level key `gomsinlog.accountDeletionRecovery.v1.<userId>`, **outside `STORE_KEY`**.
     `carryOverDevicePrefs` (`src/lib/store.tsx:197-203`) is left **exactly as at `7d82e3e`** and
     is **not** extended by this fix, so `STORE_KEY` and the marker cannot disturb each other in
     either direction. The marker is never the sole authority and can never override a `true`
     server flag.

   Marker lifecycle, which every task below must respect: **retained through logout** (logging out
   does not cancel an irreversible deletion), **retained and ignored by other accounts** (a
   different `<userId>` is neither blocked by it nor permitted to delete it), **cleared ONLY after
   confirmed Auth user deletion**, and **malformed ⇒ RECOVERY ACTIVE and never cleared**.
   Detection on login and session restoration uses a `supabase.auth.getUser()` server round-trip,
   **not cached JWT claims**, because `app_metadata` changes do not appear in an already-issued
   token. **Marker loss is never to be called "fail-safe"** — in this spec, in the design, in code
   comments or in tests; the only fail-safe direction is *staying* in recovery.

   **The previously recorded approach — persisting an `accountDeletionRecovery` boolean inside
   `STORE_KEY` via `carryOverDevicePrefs` — is REJECTED as fail-open** and appears nowhere in this
   plan: it was dropped by `loadState`'s `removeItem` on corrupt JSON (`store.tsx:103-116`),
   cleared on logout, and bypassed entirely by clearing site data or changing device, each of which
   hands the user a normal app over deleted data. Recorded in bugfix.md clauses 2.4, 2.5, 2.31-2.38
   and 3.11 and defect clauses 1.25-1.27, and in design.md's Property 1, Property 2, Property 4,
   "Changes Required — C1" items 4-19 and residual-risk item 1. Tasks 3.5 (local marker), 3.6
   (server flag), 3.7 (`getUser()` detection), 3.8 (route gate) and 3.10 (operator note) implement
   it; task 3.13 is the nine-test Deletion-Recovery Suite that proves it.
3. **`brace-expansion` is pinned via `overrides` to 1.1.18 on the 1.x line, registry-verified.**
   npm publishes **1.1.18** on the 1.x line (and 5.0.9 on 5.x), so clause 2.27's "verify against
   the registry first" precondition is satisfied in the affirmative and the acceptance-recording
   fallback does not apply. Recorded in bugfix.md clause 2.27 and design.md Property 11. Stay on
   the 1.x line so `minimatch@3`'s CJS `require` shape is preserved, and require `npm run lint` at
   0 errors / 0 warnings afterwards as the proof. **`npm audit fix --force` is never run.**

Out of scope by requirement (3.20-3.25) and absent from this plan: staging deployment, production
deployment, remote application of migrations `013`/`014`/`015`, Edge Function deployment, setting
`ALLOWED_ORIGINS` in any remote environment, the two-account manual test, and any merge into the
default branch. These are human release gates; task 12 records them as unperformed.

---

- [ ] 1. Write bug condition exploration tests for all five clusters
  - **Property 1: Bug Condition** - Five verified defects are reproduced as counterexamples
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they validate the fixes when they pass later
  - **GOAL**: Surface counterexamples that demonstrate each bug and confirm or refute the root-cause hypotheses in design.md; if a hypothesis is refuted, re-hypothesize before writing any fix
  - **Scoped PBT Approach**: C1/C2 bug conditions are input-domain predicates and are written as property-based tests over generated inputs; C3/C4/C5 are deterministic single-state defects, so scope those properties to the concrete failing cases for reproducibility
  - Split the tests into per-cluster files so each fix commit can flip only its own slice green
  - C1 (design Property 1) — `isBugConditionC1(input) = input.httpStatus <> 200 AND input.body.dataRemoved = TRUE`: mock `supabase.functions.invoke` rejecting with a `FunctionsHttpError` whose `context` is a `Response` of `500 { error, dataRemoved: true, warnings: [] }`; assert `deleteAccountFromDB` yields `status: 'partially_deleted'` with `dataRemoved: true`. Expect FAILURE — unfixed code returns `{ ok: false, warnings: [] }` (`src/lib/supabase.ts:350-353`)
  - C1 containment: populate `records`, `events`, `trips`, `profile.couple`, `profile.military`; run `deleteAccount` against the same mock; assert content cleared while `authenticatedUser` and the three device preferences survive. Expect FAILURE — `store.tsx:1687` returns early before `purgeLocalAccountData`
  - C1 route blocking (clause 2.5): assert that with recovery active, `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips`, `/service` all render the recovery screen. Expect FAILURE — no recovery state exists
  - C1 durability — **a remount/reload after a partial deletion escapes recovery** (clause 1.25): drive a `partially_deleted` response, then remount the provider exactly as a page reload would, re-running hydration from `localStorage`; assert recovery is still active and all eight authenticated routes are still blocked. Expect FAILURE — `saveState` persists only the `carryOverDevicePrefs` whitelist (`store.tsx:128`, `197-203`), no dedicated recovery key exists, so the remount lands on `/` over empty data
  - C1 durability — **no `app_metadata.account_deletion_pending` exists after a failed Auth deletion** (clauses 1.26, 1.27): drive the Edge Function through all three `AUTH_DELETE_ATTEMPTS` failing, then assert the Auth user carries `app_metadata.account_deletion_pending = true`. Expect FAILURE — the function never writes it, and the only marker it does write is cleared again by `cancel_account_deletion` in the `catch` (`index.ts:246`), so no authority anywhere records the outstanding deletion. Record explicitly that this counterexample is what makes any client-only remedy insufficient, since clearing storage, a private window and a different device each bypass a local signal
  - C1 unreadable body (clause 2.2): reject with a `FunctionsFetchError` carrying no `context`; assert `failed` with `dataRemoved: false`. Distinguish this from the C1 case above — unfixed code returns `ok: false` for both, which is precisely the defect
  - C2 (design Property 3) — `isBugConditionC2(input) = origin IS NOT NULL AND origin NOT IN parseAllowedOrigins(env.ALLOWED_ORIGINS)`: assert an `OPTIONS` from `https://evil.example` yields `403` with no `Access-Control-Allow-Origin`. Expect FAILURE — `index.ts:145-147` returns `200 'ok'` with `'*'`
  - C2 `Vary`: assert every response carries `Vary: Origin`. Expect FAILURE — the header is absent entirely
  - C3 (design Properties 5, 6): run `npm run build` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY` all unset and assert a non-zero exit. Expect FAILURE — the build succeeds and emits a permanently demo-mode artifact. Also assert `public/_headers` contains `__SUPABASE_HTTP_SRC__` and `__SUPABASE_CONNECT_SRC__`. Expect FAILURE — verified zero occurrences
  - C4 (design Property 8): run the `isBugConditionC4` regex, **including opacity variants**, over the four guarded files. Expect FAILURE — verified 18 / 2 / 16 / 24 matches in `InstallPromptBanner.tsx`, `CycleSupportSection.tsx`, `RecordPage.tsx`, `TripsPage.tsx`
  - C5 (design Property 10): capture `npm run build` output; assert no mixed static/dynamic import warning for `@/lib/events` or `@capacitor/browser` and no large-chunk warning. Expect FAILURE — two mixed-import warnings plus a ~520 KB / 151 KB gzip chunk
  - Run every test above on UNFIXED code
  - **EXPECTED OUTCOME**: All FAIL (this is correct - it proves the bugs exist)
  - Document each counterexample verbatim, and record whether it confirms or refutes the matching root-cause hypothesis in design.md
  - Mark this task complete when the tests are written, run, and every failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.25, 1.26, 1.27_

- [ ] 2. Write preservation property tests (BEFORE implementing any fix)
  - **Property 2: Preservation** - Non-buggy inputs behave exactly as at `7d82e3e`
  - **IMPORTANT**: Follow observation-first methodology - observe the UNFIXED code, then assert what you observed. Never assert assumed behavior
  - **Baseline**: the measured suite on this branch is **206 tests across 23 files**. Record the exact `npm test` summary line before any source change; this number plus the new suites from clauses 2.15 and 2.22 is what task 9 must confirm
  - Property-based testing is used where the preservation claim is genuinely universal (the C2 method × origin × allowlist cross product, C1 purge completeness over arbitrary populated `AppState`, C3 URL-form acceptance), since it generates many cases automatically and catches edge cases manual tests miss
  - Observe: a `200 { success: true }` deletion runs `purgeLocalAccountData`, signs out, and raises the `media_not_fully_removed` toast when applicable — record the exact observed sequence (design Property 2, clause 3.7)
  - Observe: a failure with `dataRemoved: false` leaves the account fully intact with the generic `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.` toast, no purge, no recovery (clause 2.10)
  - Observe: sign-out and account switch clear `authenticatedUser`, bump the session generation, and set the cache-purged flag (clause 3.7)
  - Observe: demo mode survives refresh via `INITIAL_SESSION`, accepts only invitation code `123456`, activates only when `!supabase`, and strips `blob:` attachment URLs before persisting (clause 3.8)
  - Observe: an allowlisted-origin and an absent-`Origin` `POST` still require a valid bearer token (`401` for missing, invalid, expired) and still run the deletion sequence with its **internal order and per-step semantics preserved** — record preflight, `begin_account_deletion`, `removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` / `MAX_STORAGE_DEPTH = 8`, `prepare_account_deletion`, `deleteUser` with `AUTH_DELETE_ATTEMPTS = 3`, `cancel_account_deletion` cleanup on failure (design Property 4, clause 3.17). **This is deliberately NOT a byte-for-byte claim**: per clause 2.32 and the amended clause 3.17 the sequence is now **preceded by** and **gated on** the `app_metadata.account_deletion_pending = true` write of task 3.6, so what is preserved is the sequence *once entered* — every step and every constant unchanged, no step reordered, removed or given different semantics — while entry itself becomes conditional. Write the assertions so they pin the sequence, not the absence of a preceding write
  - Observe: `purgeLocalAccountData` removes **only** `STORE_KEY_V1` and `STORE_KEY` (`store.tsx:1649-1650`) — the recovery marker key is neither, so a sign-out must leave it in place (design preservation case 15, clause 2.34). Record this before the fix so task 3.5's "leave `purgeLocalAccountData` unchanged" claim is verified, not assumed
  - Observe: `AuthUser.provider` is derived from `sessionUser.app_metadata?.provider` (`store.tsx:397`), so the Edge Function's `updateUserById` write must spread the existing `app_metadata` first or the rendered sign-in provider silently changes (design preservation case 16)
  - Observe and pin byte-for-byte: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()`, `X-DNS-Prefetch-Control: off` (clause 3.10)
  - Observe: with only `VITE_SUPABASE_ANON_KEY` set, `isSupabaseConfigured === true` via the `src/lib/supabase.ts:10` fallback — this fallback is load-bearing and must satisfy the new validation (clause 3.9)
  - Observe and snapshot: the four C4 files rendered in the **light** theme; assert the token values in `src/styles/index.css`, `LIGHT_THEME_COLOR = '#FAF8F5'` and `DARK_THEME_COLOR = '#16181D'` (design Property 9, clauses 3.11, 3.12, 3.13)
  - Observe: `saveEventToDB` / `updateEventInDB` / `deleteEventFromDB` behaviour at `store.tsx:1397`, `1438`, `1479` including guard-rejection and failure paths, and that `Browser.open` fires only under `isNativePlatform()` (clauses 2.24, 2.25)
  - Observe: the injected service-worker manifest enumerates every file under `dist/assets`, and the `SERVICE_WORKER_ASSET_MARKER` / `SERVICE_WORKER_BUILD_ID` guard throws when its markers are missing (clause 3.14)
  - Observe: `react-router` and `react-router-dom` resolve to `7.18.2` and `src/main.tsx` uses `BrowserRouter` in declarative mode with no `loader`, `action`, `useFetcher`, react-router `<Form>`, Framework Mode or RSC (clause 3.15)
  - Write property-based tests capturing the observed behaviour patterns, then run them on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark this task complete when the tests are written, run, and passing on unfixed code, and the 206/23 baseline is recorded
  - _Requirements: 2.10, 2.34, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17_

- [ ] 3. C1 — Fix for partial account deletion being misreported and leaving private data on screen

  - [ ] 3.1 Add the typed outcome union in the new `src/lib/accountDeletion.ts`
    - Declare `AccountDeletionOutcome` as `{ status: 'deleted'; dataRemoved: true; warnings: string[] } | { status: 'partially_deleted'; dataRemoved: true; warnings: string[] } | { status: 'failed'; dataRemoved: false; warnings: string[] }`
    - Add `classifyDeletionSuccess(body)` → `deleted` only when `body.success === true`, else `failed`
    - Add `classifyDeletionErrorBody(body)` → `partially_deleted` when `body.dataRemoved === true`, else `failed`
    - Add `coerceWarnings(body)` mirroring the defensive coercion at `src/lib/supabase.ts:355`
    - Keep the module pure and dependency-free so it is testable without a Supabase client
    - _Bug_Condition: isBugCondition C1 — `input.httpStatus <> 200 AND input.body.dataRemoved = TRUE`_
    - _Expected_Behavior: design Property 1 — truthful three-valued classification; an unreadable body classifies `failed`, never a fabricated partial deletion_
    - _Preservation: design Property 2 — the `deleted` gate stays an explicit `success === true` check, never inferred from the absence of a transport error_
    - _Requirements: 2.1, 2.2_

  - [ ] 3.2 Read the error response body in `deleteAccountFromDB`
    - On `error`, detect `FunctionsHttpError` and `await error.context.json()` inside a `try`; `context` is a `Response` whose body may be consumed only once, so read it exactly once and pass the parsed value onward
    - A relay/fetch error with no `context`, or a parse failure, classifies as `failed` with `dataRemoved: false`
    - Change the signature to `Promise<AccountDeletionOutcome>`; keep the existing explicit `data?.success !== true` check as the `deleted` gate
    - Keep the existing `console.error` calls so operator diagnostics do not regress
    - _Bug_Condition: isBugCondition C1 — the body carrying `dataRemoved: true` is currently discarded at `src/lib/supabase.ts:350-353`_
    - _Expected_Behavior: design Property 1_
    - _Preservation: design Property 2 — success and `dataRemoved: false` paths unchanged_
    - _Requirements: 2.1, 2.2_

  - [ ] 3.3 Add `purgeLocalContentRetainingIdentity` alongside `purgeLocalAccountData`
    - Do NOT modify or replace `purgeLocalAccountData` — sign-out, account switch and fully successful deletion must keep using it unchanged
    - Apply clause 2.4's key-level split exactly: `localStorage.removeItem(STORE_KEY_V1)`; rewrite `STORE_KEY` through the existing `saveState` path; retain `authenticatedUser` and the `sb-*` session keys (no sign-out); clear `records`, `events`, `trips`; reset all five `profile` fields, `setupComplete`, `onboardingStep`, `highlightedRecordId` to `DEFAULT_STATE`; set `isDemoMode: false`
    - Leave `carryOverDevicePrefs` (`store.tsx:197-203`) **exactly as at `7d82e3e`** — the recovery marker does not go through it and is written by task 3.5's helper to its own top-level key, so `STORE_KEY` and the marker cannot disturb each other in either direction (clause 3.11)
    - Replace in-memory state with `{ ...DEFAULT_STATE, isDemoMode: false, ...carryOverDevicePrefs(current), authenticatedUser: current.authenticatedUser }` — because `saveState` (`store.tsx:128`) already persists only the device-preference whitelist for an authenticated session, the in-memory state is where the real exposure lives
    - Set `cachePurgedRef.current = true` and pin `hydratedUserIdRef.current` to the retained user id so the save effect cannot resurrect the cache and the hydration effect cannot re-fetch deleted data
    - Do NOT bump `sessionGenerationRef` — the session is deliberately kept
    - Keep the `isCurrentIdentity(identity)` guard at `store.tsx:1683` exactly as it is, so an account switch mid-flight still cannot clear another account's session
    - _Bug_Condition: isBugCondition C1 — `store.tsx:1687` returns before any purge, so content keeps rendering_
    - _Expected_Behavior: design Property 1 — `localContentPurged() AND identityRetained() AND devicePrefsRetained()`_
    - _Preservation: design Property 2, clauses 3.7, 3.8 — `purgeLocalAccountData`, sign-out, account switch and demo mode untouched_
    - _Requirements: 2.4_

  - [ ] 3.4 Expose `accountDeletionRecovery` state, retry and logout
    - Add `accountDeletionRecovery: { warnings: string[] } | null` to `StoreContextType` (`src/lib/storeContext.ts`) and to the `StoreProvider` value, so every consumer reads one authoritative flag instead of inferring recovery from route or toast state
    - Add `retryAccountDeletion()`; reuse the existing `signOut()` for the logout action
    - Rewrite `deleteAccount` to return `AccountDeletionOutcome`, keeping the demo-mode short-circuit and the `isCurrentIdentity` guard, then branching: `deleted` → existing `purgeLocalAccountData` + `signOut`, **then** `clearRecoveryMarker(userId)` because Auth deletion is now confirmed; `partially_deleted` → `markRecoveryPending(userId)` **first**, then `purgeLocalContentRetainingIdentity` + set recovery; `failed` → return unchanged with no purge, no recovery and no marker
    - Retry semantics: `deleted` clears recovery, purges the retained identity, signs out and clears the marker — this is the **only** branch that clears it, because it is the only branch that confirms Auth deletion; `partially_deleted` or `failed` stays in recovery, **leaves the marker in place**, and re-fetches nothing
    - Keep the `warnings` array **in memory only** — warning strings can name storage paths, and the marker is a boolean carrying no deleted-account content of any kind (clause 2.33)
    - Logout from recovery clears the retained identity and signs out, and must not present the account as successfully deleted
    - _Bug_Condition: isBugCondition C1_
    - _Expected_Behavior: design Property 1 — `recoveryScreenShown()`; clauses 2.6, 2.7, 2.8_
    - _Preservation: design Property 2, clause 2.10 — a `failed` outcome enters no recovery_
    - _Requirements: 2.3, 2.6, 2.7, 2.8, 2.10_

  - [ ] 3.5 Add the dedicated per-user recovery marker helpers in `src/lib/accountDeletion.ts`
    - **DECISION 2, secondary authority.** The **rejected** approach was a boolean inside `STORE_KEY` persisted by widening `carryOverDevicePrefs`; it is **fail-open** — dropped by `loadState`'s `removeItem` on corrupt JSON (`store.tsx:103-116`), cleared on logout, and bypassed by clearing site data or changing device, each of which admits the user to a normal app over deleted data. Do not implement it in any form
    - `carryOverDevicePrefs` (`src/lib/store.tsx:197-203`) is left **exactly as at `7d82e3e`**. Do not add a fourth key to it, and do not route the marker through `saveState`/`loadState`
    - Add to `src/lib/accountDeletion.ts`, keeping the module pure and unit-testable without a store or a Supabase client: `const RECOVERY_KEY_PREFIX = 'gomsinlog.accountDeletionRecovery.v1.'`; `recoveryKeyFor(userId)` → `RECOVERY_KEY_PREFIX + userId`; `markRecoveryPending(userId)` → `localStorage.setItem(recoveryKeyFor(userId), 'true')`; `readRecoveryMarker(userId)` → `'absent' | 'active'`; `clearRecoveryMarker(userId)`
    - **Boolean-only payload.** Never write warnings, storage paths, or any profile, couple, record, event or trip content to this key (clause 2.33)
    - **`readRecoveryMarker` returns `'absent'` only for a genuinely missing key (`getItem` → `null`); every present value returns `'active'`.** A present-but-malformed value — invalid JSON, `{}`, `"true"`, an unexpected type — is **RECOVERY ACTIVE** (clause 2.35). There is no third answer
    - **No parse-and-discard path and NO `removeItem` on any read path.** `readRecoveryMarker` must contain no branch that returns `'absent'` for an unparseable value and no branch that clears or overwrites the key. This is the exact place a well-meaning "clean up bad data" reflex reintroduces the fail-open defect, so carry a comment saying so
    - **Per-user key.** A reader consults only the key for the currently signed-in `userId` and never enumerates `localStorage`, so a different user is neither blocked by another account's marker nor able to delete it (clause 2.34)
    - **`clearRecoveryMarker` is reachable from exactly one place** — the confirmed-Auth-deletion branch of task 3.4. Not logout, not a failed retry, not an account switch, not corruption, not elapsed time. There is no server-confirmed cancellation workflow today and no code path may behave as though one exists
    - **`purgeLocalAccountData` is left unchanged and MUST NOT delete the marker.** It removes `STORE_KEY_V1` and `STORE_KEY` (`store.tsx:1649-1650`) and the marker is neither, so it is already correct by construction — recorded explicitly because it *looks* like an omission. It is not: **logout retains the marker** (clause 2.34), since logging out does not cancel an irreversible deletion, so a purge path that also removed it would reintroduce the fail-open bypass. `signOut` (`store.tsx:1661`) calls `purgeLocalAccountData` and must likewise not touch the key
    - **Never describe marker loss as "fail-safe"** in code, comments or tests. Losing the marker is a *failure*, mitigated only by the server flag of task 3.6; the only fail-safe direction is *staying* in recovery
    - Privacy note to carry in the code comment (clause 2.37): writing `<userId>` into a key that outlives the session **is** persisting a pseudonymous identifier, and the session having already held that UUID does not make retention costless. Justify it narrowly — the minimum identifier necessary to complete the user-requested deletion, required to bind the marker to one account, removed on confirmed Auth deletion — and rely on no "adds no new data category" reasoning
    - Add the fail-closed totality property test: generate arbitrary strings, JSON fragments and non-boolean values as the stored value and assert `readRecoveryMarker` returns `'active'` for **every** present value, `'absent'` only for a missing key, and that no input causes the key to be removed
    - _Bug_Condition: isBugCondition C1 durability — clause 1.25, a reload after partial deletion escapes recovery because nothing outside `STORE_KEY` records it_
    - _Expected_Behavior: design Property 1 — `normalRoutesBlocked()` holds across a reload without waiting on the network; malformed ⇒ ACTIVE and never cleared_
    - _Preservation: design Property 2 and Property 9, clauses 3.7, 3.11 — `purgeLocalAccountData` is unchanged and leaves the marker in place; `carryOverDevicePrefs` is unchanged, so `widgetLayout`, `hasSeenInstallPrompt` and `theme` still survive sign-out and account switches and `prefers-color-scheme` is still honoured_
    - _Requirements: 2.3, 2.4, 2.5, 2.33, 2.34, 2.35, 2.37, 3.11_

  - [ ] 3.6 Write the server-side pending flag in `supabase/functions/delete-account/index.ts`
    - **DECISION 2, primary authority.** Add the admin-only write `app_metadata.account_deletion_pending = true` using the existing service-role client (`index.ts:164-166`) via `admin.auth.admin.updateUserById(userId, { app_metadata: { ...(user.app_metadata ?? {}), account_deletion_pending: true } })`
    - **Placement is load-bearing**: immediately after `const userId = user.id;` (`index.ts:174`) and **BEFORE** the `try` block that opens the deletion sequence (`:178`) — so before the read-only `daily_records` preflight (`:180-185`) and before `begin_account_deletion` (`:191-195`). Clause 2.32 makes the flag a hard gate on *anything* that touches the account, and the preflight also establishes the record-id set the transactional RPC is later held to
    - Being **outside** the `try` is also deliberate: the existing `catch` (`:262`) runs `cancel_account_deletion` and reports `dataRemoved: databasePreparationCompleted` (`:290`), neither of which is the right response to a flag-write failure, so this step returns its own response directly
    - **Spread the existing `app_metadata` first.** The Auth API replaces `app_metadata` wholesale rather than merging, and `store.tsx:397` reads `sessionUser.app_metadata?.provider` to build `AuthUser`, so dropping `provider`/`providers` would silently change the rendered sign-in provider. The `user` object from the `getUser(token)` verification is already in hand
    - Use `app_metadata`, **never `user_metadata`** — the latter is client-writable and would let a browser clear its own recovery flag
    - **On write failure, delete nothing.** Log, then return `{ error, dataRemoved: false, warnings: [] }` with status `500` and the C2-resolved headers, and **do not begin** the preflight, `begin_account_deletion`, `removeAndConfirmRecordMedia`, `prepare_account_deletion` or `deleteUser`. An ambiguous write (timeout) counts as failure of this step, so the worst outcome is a flag set on an account whose data is fully intact — resolved by the next retry, which re-writes the same `true` value idempotently
    - **Failure after the flag is set**: the flag **REMAINS**. Keep the existing `cancel_account_deletion` call in the `catch` (`:269`) exactly as it is and do not confuse it with clearing the pending flag — they are different markers with opposite lifecycles. Prefer the idempotent-retry path; a compensating update is **not required for correctness** and must not be written speculatively. If one is ever written it may clear the flag only on *verified* knowledge that no application data was removed (clause 2.32.1)
    - **Auth deletion success clears the flag implicitly** — the user and its `app_metadata` cease to exist. Do not add a separate flag-clearing call on the success path; it would open a window in which the flag is `false` while the user still exists
    - _Bug_Condition: isBugCondition C1 durability — clauses 1.26, 1.27: data deletion begins with no prior authoritative write that outlives the request, and no server-side record of pending deletion exists anywhere_
    - _Expected_Behavior: design Property 1 and "Changes Required — C1" items 10-12 — clauses 2.31, 2.32, 2.32.1_
    - _Preservation: design Property 4, clause 3.17 — the deletion sequence is preserved **once entered**, with every step and constant unchanged; it is no longer byte-for-byte because it is now preceded by and gated on this write_
    - _Requirements: 2.31, 2.32_

  - [ ] 3.7 Detect recovery with `getUser()` inside the `onAuthStateChange` async body
    - Insert the check in the existing `supabase.auth.onAuthStateChange` subscription (`store.tsx:362`), in the async body for a `session?.user`, **after** `authUser` is built (`:400-405`) and after the `TOKEN_REFRESHED` / `USER_UPDATED` short-circuit (`:407-413`), and **before** the `fetchFullStateFromDB` await (`:423-427`)
    - **Read the local marker synchronously FIRST** for `sessionUser.id`; if it is `'active'`, set `accountDeletionRecovery` immediately, so the `App.tsx` gate is authoritative on first paint with no network time spent
    - **Then the server round-trip**: `supabase.auth.getUser()`, reading `data.user?.app_metadata?.account_deletion_pending`. Do **NOT** read `session.user.app_metadata` — the session's JWT was issued before the flag was written and reports the stale value on exactly the reload that must catch it (clause 2.36). A `true` result sets recovery **regardless** of the local marker or any cached claim, and also writes the local marker so the next reload is instant
    - Wrap the round-trip in the existing `withTimeout(..., AUTH_SYNC_TIMEOUT_MS, ...)` helper from `src/lib/async.ts`, the same mechanism the surrounding code already uses. **The fallback means "no server answer", NOT "not pending"**: the local marker's verdict stands, and the check is retried on the next auth event. An offline user with a marker stays in recovery; an offline user without one is not fabricated into recovery
    - **`setIsAuthChecked(true)` must still run in the `finally`** (`:516-522`) so a hanging or failing `getUser()` cannot deadlock offline startup behind the splash spinner
    - `INITIAL_SESSION` needs no separate handling for a restored session — it arrives with `session?.user` populated and runs this same async body; the no-session `INITIAL_SESSION` branch at `:539` is unchanged, as there is no user to check
    - Retry from the recovery screen needs nothing special: it re-invokes the Edge Function, which re-writes the same `true` flag idempotently
    - _Bug_Condition: isBugCondition C1 durability — clause 1.26, every detection signal at `7d82e3e` is local to one browser profile_
    - _Expected_Behavior: design Property 1 and "Changes Required — C1" items 13-15 — clauses 2.5, 2.31, 2.36_
    - _Preservation: design Property 2, clause 3.8 — the auth bootstrap's existing ordering, the `TOKEN_REFRESHED` / `USER_UPDATED` short-circuit, `fetchFullStateFromDB` under `withTimeout`, and demo mode's `INITIAL_SESSION` refresh survival are unchanged_
    - _Requirements: 2.5, 2.36_

  - [ ] 3.8 Gate routing on recovery in `src/App.tsx`
    - When `accountDeletionRecovery` is non-null, render only the recovery screen for every path except `/auth/callback` and `/legal/:doc`, which must stay reachable
    - Offer exactly two actions: retry deletion, and log out
    - Place the gate **immediately before the existing `authSyncUnavailable` branch** (`App.tsx:80-90`) so it **takes precedence over it**, reusing the established pattern rather than inventing routing: a sync outage must not replace the recovery screen with a retry-sync screen that offers no path to completing the deletion. Both branches stay after the `!isReady` spinner, so no authenticated route can render before `isReady` is true
    - **No override of any kind**: no timeout, no attempt counter, no "continue anyway" affordance and no query parameter re-admits a blocked user to `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips` or `/service` while either authority reports pending (clause 2.32.2)
    - Confirm no purged personal, couple or content data is re-fetched or re-rendered while recovery is active
    - _Bug_Condition: isBugCondition C1 — `App.tsx` currently keeps routing to all authenticated routes_
    - _Expected_Behavior: design Property 1 and "Changes Required — C1" items 16-17 — clauses 2.5, 2.6, 2.32.2_
    - _Preservation: design Property 12 — routing for every non-recovery session is unchanged, and the `authSyncUnavailable` branch still behaves as at `7d82e3e` whenever recovery is inactive_
    - _Requirements: 2.5, 2.6, 2.32_

  - [ ] 3.9 Tell the truth in `src/pages/SettingsPage.tsx`
    - For the `partially_deleted` outcome **only**, replace the generic toast at line 765: state that the user's data has been deleted but the login account has not, and that the deletion must be completed
    - `failed` keeps `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.`; `deleted` keeps its existing `media_not_fully_removed` warning toast
    - _Bug_Condition: isBugCondition C1 — clause 1.3, the generic message claims nothing was deleted_
    - _Expected_Behavior: design Property 1 — clause 2.9_
    - _Preservation: design Property 2, clause 2.10 — the generic message survives for genuine total failure_
    - _Requirements: 2.9, 2.10_

  - [ ] 3.10 Record the operator note in `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`
    - Record that `app_metadata.account_deletion_pending` is now written by the `delete-account` Edge Function with the service-role key, and that it is the **primary authority** for deletion recovery
    - Record that the flag is **intentionally left set on Auth-deletion failure** — that is not a bug to be tidied up, it is what keeps recovery active for an account whose data is already gone
    - Record that an operator who clears it by hand is **re-admitting a user to an app whose data is gone**
    - Record that there is **NO server-confirmed cancellation workflow** today (clause 2.34) and that this fix does not add one, so no operator procedure and no code path may behave as though one exists
    - Do NOT deploy the function and do NOT set anything in a remote environment; those stay operator gates (clauses 3.23, 3.20, 3.21)
    - _Bug_Condition: isBugCondition C1 durability — clause 1.26, no server-side record of pending deletion exists at `7d82e3e`, so no operator guidance exists either_
    - _Expected_Behavior: design Property 13 and "Changes Required — C1" item 19 — operator-facing decisions are recorded where they will be encountered_
    - _Preservation: design Property 14 — deployment, remote configuration and Edge Function deployment stay unperformed_
    - _Requirements: 2.31, 2.34_

  - [ ] 3.11 Verify the C1 bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Partial deletion is classified truthfully and contained
    - **IMPORTANT**: Re-run the SAME C1 tests from task 1 - do NOT write new tests
    - The task 1 tests encode the expected behavior; their passing is what confirms it
    - Includes both durability counterexamples: the remount/reload case, which must now pass because of tasks 3.5 and 3.7, and the `app_metadata.account_deletion_pending` case, which must now pass because of task 3.6
    - **EXPECTED OUTCOME**: Tests PASS (confirms C1 is fixed)
    - _Requirements: Expected Behavior Properties from design (Property 1) — 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.31, 2.32, 2.36_

  - [ ] 3.12 Verify the C1 preservation tests still pass
    - **Property 2: Preservation** - Successful and total-failure deletion paths are unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Pay particular attention to the highest-regression-risk area named in design.md: retaining the session while purging content inverts the existing purge invariant, so assert the hydration and sync effects re-fetch nothing
    - Confirm the two preservation claims the recovery architecture makes explicit: `purgeLocalAccountData` still removes exactly `STORE_KEY_V1` and `STORE_KEY` and leaves the marker in place, and `AuthUser.provider` is unchanged after the Edge Function's `updateUserById` write because the existing `app_metadata` is spread first
    - Confirm the amended clause 3.17 claim as stated, not as it used to read: the deletion sequence is preserved **once entered**, with every step and constant unchanged — it is no longer byte-for-byte, because entry is now gated on task 3.6's write
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)

  - [ ] 3.13 Implement the nine-test Deletion-Recovery Suite (clause 2.38, gate 2.29(k))
    - These nine tests are one suite because each closes a bypass the others leave open; run them as one carried-forward flow (partial deletion → reload → logout → same-user re-login → other-user session → back to the first user) rather than nine isolated snapshots
    - **1 — Marker created on partial deletion**: `deleteAccount` against a `500 { dataRemoved: true }` response creates `gomsinlog.accountDeletionRecovery.v1.<userId>` with a boolean value and **no** warnings, storage paths or profile/couple/record/event/trip content; `STORE_KEY` holds only `carryOverDevicePrefs`; `authenticatedUser` is retained
    - **2 — Logout preserves the marker**: the logout action from the recovery screen runs `purgeLocalAccountData` + `signOut`, `STORE_KEY_V1` and `STORE_KEY` are gone, the marker **still exists**, and the account is not presented as deleted (clauses 2.8, 2.34)
    - **3 — Same-user re-login resumes recovery**: signing back in as the same `<userId>` re-enters the recovery screen with the retry action available, before any `fetchFullStateFromDB` result is applied (clause 2.34)
    - **4 — Other user unblocked, marker intact**: a different `<userId>` on the same browser reaches normal routes, is **not** blocked, and afterwards the first user's marker is still present — not deleted, not overwritten (clause 2.34)
    - **5 — Malformed marker fails closed**: seed the key with invalid JSON, then `{}`, then an unexpected type; each is treated as recovery **ACTIVE** and the key is not cleared or overwritten. Include the **negative assertion that no read path calls `removeItem`** on this key outside confirmed-deletion cleanup, and carry a comment saying this negative is the assertion most likely to be deleted by a well-meaning refactor (clause 2.35)
    - **6 — Clean browser blocked by server metadata**: with no local marker at all, mock `getUser()` to return `app_metadata.account_deletion_pending = true` while the cached session's claims omit it; every normal route is blocked. Assert **PROVENANCE**, not just outcome — the verdict must come from the `getUser()` round-trip and **not** from `session.user.app_metadata`, so the test fails against a stale-JWT implementation that would otherwise give the right answer (clauses 2.31, 2.36)
    - **7 — Pending-flag write failure blocks all data deletion**: with `updateUserById` mocked to fail, assert no `daily_records` preflight, no `begin_account_deletion`, no `removeAndConfirmRecordMedia`, no `prepare_account_deletion` and no `deleteUser`; the response reports `dataRemoved: false`; the account is fully intact (clauses 2.32, 2.32.1)
    - **8 — Retry success deletes Auth BEFORE clearing the marker**: assert the **ordering**, not just the end state — `deleteUser` resolves **before** `clearRecoveryMarker` is called. The marker is gone afterwards; on a retry where `deleteUser` fails it is still present (clauses 2.7, 2.34)
    - **9 — Normal routes inaccessible throughout**: before retry → after a failed retry → after a reload/remount → after logout and re-login as the same user, `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips` and `/service` all render the recovery screen, `/auth/callback` and `/legal/:doc` remain reachable, and no timeout, attempt counter or override re-admits the user (clause 2.32.2)
    - Add the authority-ranking property test alongside the suite: over local marker state (absent, active, malformed) × `getUser()` result (`true`, `false`/absent, unavailable), recovery is active whenever either authority says so, a `true` server result always blocks regardless of the local value, a local `'active'` is never overridden by an unavailable server answer, and the **only** combination admitting normal routing is "no marker, and a server answer that positively reports not pending"
    - Add the offline auth-path test: with the network unavailable, `getUser()` times out through `withTimeout`, `setIsAuthChecked(true)` still runs so the splash screen releases, a local marker still blocks routing, and the absence of a marker does not fabricate recovery
    - **EXPECTED OUTCOME**: all nine tests PASS — this suite is gate 2.29(k)
    - _Bug_Condition: isBugCondition C1 durability — clauses 1.25, 1.26, 1.27_
    - _Expected_Behavior: design Property 1 and the "Deletion-Recovery Suite" table in design.md's Testing Strategy — clauses 2.31-2.38_
    - _Preservation: design Property 2, clauses 2.34, 3.7, 3.11 — logout still uses `purgeLocalAccountData` unchanged and leaves the marker in place; another account is unaffected; device preferences are untouched_
    - Commit C1 as one reviewable change once 3.11, 3.12 and 3.13 all hold
    - _Requirements: 2.29, 2.38_

- [ ] 4. C2 — Fix for the `delete-account` Edge Function accepting any browser origin

  - [ ] 4.1 Add the new shared module `supabase/functions/_shared/cors.ts`
    - `parseAllowedOrigins(raw)` → trimmed, non-empty, de-duplicated exact origins
    - `resolveCors(method, origin, allowlist)` → `{ configured, allowed, headers }`, where `headers` always includes `Vary: Origin` and `configured` is false when the allowlist is empty
    - Exact string equality on the `Origin` value: no wildcards, no suffix matching, and no code path that can emit `Access-Control-Allow-Origin: '*'`
    - `resolveCors` MUST be pure and MUST NOT reference `Deno` at module scope — that is what lets `src/lib/cors.test.ts` import it under vitest/Node. `Deno.env.get('ALLOWED_ORIGINS')` is read in `index.ts` and passed in
    - ESLint does lint `supabase/functions/**`, so the module must be lint-clean
    - _Bug_Condition: isBugCondition C2 — `origin IS NOT NULL AND origin NOT IN parseAllowedOrigins(env.ALLOWED_ORIGINS)`_
    - _Expected_Behavior: design Property 3 — disallowed origins are refused, never reflected_
    - _Preservation: design Property 4 — allowlisted and absent-`Origin` callers keep working_
    - _Requirements: 2.11, 2.12_

  - [ ] 4.2 Implement the decision table in `supabase/functions/delete-account/index.ts`
    - Delete the wildcard `corsHeaders` constant at lines 18-22 and make `jsonResponse` take the resolved headers as a parameter, so a wildcard cannot be reintroduced by forgetting to pass them
    - Apply clause 2.13 rows in this order: read `ALLOWED_ORIGINS`; if unconfigured return `500` for every method (row g, fail closed, no wildcard fallback); then `OPTIONS` → `200` with the exact reflected origin (a), `403` (b), or `200` with no reflection when `Origin` is absent (c); then `POST` → `403` before any auth or admin-client work when the origin is disallowed (e), else fall through (d, f)
    - An allowed preflight advertises methods `POST, OPTIONS` and headers `authorization, apikey, content-type, x-client-info`
    - Send `Vary: Origin` on **every** response — allowed, disallowed, absent-`Origin`, preflight, `401`, `405`, `500` — threading it through `jsonResponse` so this holds structurally
    - Change nothing inside the deletion sequence: the origin gate sits strictly in front of the bearer check at `:152-157`. With task 3.6 in place the final order is **origin gate → bearer verification → pending-flag write → deletion sequence**; C2 contributes nothing to the sequence itself
    - _Bug_Condition: isBugCondition C2 — clauses 1.7, 1.8, 1.9_
    - _Expected_Behavior: design Property 3 — `403`, no `Access-Control-Allow-Origin`, `Vary: Origin`, no account mutation_
    - _Preservation: design Property 4, clause 3.17 — bearer verification still required (`401`), and the deletion sequence is preserved **once entered** with every step and constant unchanged. Not byte-for-byte: clause 2.32 precedes it with the pending-flag write of task 3.6 and gates entry on that write succeeding. C2 reorders, removes and re-semanticises nothing_
    - _Requirements: 2.11, 2.12, 2.13_

  - [ ] 4.3 Add `src/lib/cors.test.ts` asserting every row (a)-(g)
    - Cover all seven rows of the clause 2.13 table explicitly
    - Cover `parseAllowedOrigins` over empty, whitespace-only, single, multiple, duplicate and trailing-comma inputs
    - Assert no code path can emit `'*'`, and assert `Vary: Origin` on `403`, `401`, `405` and `500` responses
    - Add the property-based cross product: method × `Origin` (allowlisted, disallowed, absent, malformed, case-varied, trailing-slash) × allowlist (empty, single, multiple), asserting the invariants that no response contains `'*'`, every response contains `Vary: Origin`, and a disallowed origin never receives a reflected origin
    - Because `vitest.config.ts` sets `globals: false`, import `describe`/`it`/`expect` from `vitest`
    - _Bug_Condition: isBugCondition C2_
    - _Expected_Behavior: design Property 3_
    - _Preservation: design Property 4_
    - _Requirements: 2.15_

  - [ ] 4.4 Document `ALLOWED_ORIGINS` in the deployment checklist
    - In `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` section 5 (line 299), next to `SUPABASE_SERVICE_ROLE_KEY` (line 324), record the exact comma-separated format, the fail-closed `500` behaviour of row (g), and the absent-`Origin` allowance of rows (c) and (f) as an explicit accepted risk with its compensating control — bearer-token verification remains mandatory
    - Do NOT set `ALLOWED_ORIGINS` in any remote environment; that is an operator gate (clause 3.23)
    - _Bug_Condition: isBugCondition C2 — clause 1.10, no allowlist exists to configure_
    - _Expected_Behavior: design Property 13 — operator-facing decisions are recorded_
    - _Preservation: design Property 14 — deployment and remote configuration stay unperformed_
    - _Requirements: 2.14_

  - [ ] 4.5 Verify the C2 bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Disallowed origins are refused, never reflected
    - **IMPORTANT**: Re-run the SAME C2 tests from task 1 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms C2 is fixed)
    - _Requirements: Expected Behavior Properties from design (Property 3) — 2.11, 2.12, 2.13, 2.15_

  - [ ] 4.6 Verify the C2 preservation tests still pass
    - **Property 2: Preservation** - Allowlisted and non-browser callers keep working unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Commit C2 as one reviewable change once 4.5 and 4.6 both hold

- [ ] 5. C3 — Fix for the build shipping no CSP and silently accepting missing Supabase config

  - [ ] 5.1 Add CSP marker tokens to `public/_headers`
    - Add a `Content-Security-Policy` line containing `__SUPABASE_HTTP_SRC__` and `__SUPABASE_CONNECT_SRC__`, leaving the five existing headers byte-identical
    - Rewrite the header comment to record that **this supersedes the earlier deliberate decision to delegate CSP to the hosting platform**: why that decision was made (the project URL is known only at build time), why the reversal is safe now (the build validates and injects that URL), and that platforms ignoring `_headers` still require equivalent configuration
    - Commit markers, never real or placeholder project URLs
    - _Bug_Condition: isBugCondition C3 — clause 1.11, no CSP and no marker token exists_
    - _Expected_Behavior: design Property 6 — a valid build emits a complete, marker-free CSP_
    - _Preservation: design Property 7, clause 3.10 — the five non-CSP headers are byte-identical_
    - _Requirements: 2.16_

  - [ ] 5.2 Add build-environment validation to `vite.config.ts`
    - Add a `validateBuildEnvironment()` plugin scoped to `apply: 'build'` and production mode only, so `vite dev` is unaffected (and `npm test`, which loads the separate `vitest.config.ts`, cannot be affected)
    - Require `VITE_SUPABASE_URL` and either `VITE_SUPABASE_PUBLISHABLE_KEY` **or** the existing `VITE_SUPABASE_ANON_KEY` fallback; fail with a non-zero exit and a message naming the missing variable
    - Validate the URL with `new URL(...)`: reject unparseable values, require `https:` except when the hostname is `localhost` or `127.0.0.1`
    - _Bug_Condition: isBugCondition C3 — `VITE_SUPABASE_URL` empty, both keys empty, or a non-HTTPS/unparseable URL_
    - _Expected_Behavior: design Property 5 — a misconfigured production build cannot produce an artifact_
    - _Preservation: design Property 7, clause 3.9 — the `VITE_SUPABASE_ANON_KEY` fallback satisfies the key requirement_
    - _Requirements: 2.17, 2.18_

  - [ ] 5.3 Inject the validated origins into `dist/_headers`
    - Add an `emitCspHeaders()` plugin that, in `closeBundle`, reads `dist/_headers`, replaces `__SUPABASE_HTTP_SRC__` with the validated `https://` origin and `__SUPABASE_CONNECT_SRC__` with the `https://` origin plus its `wss://` equivalent, then asserts zero markers remain
    - **Plugin order matters**: register `emitCspHeaders()` **before** `injectServiceWorkerManifest()` so its `closeBundle` runs first — that plugin hashes every file in `dist` except `sw.js` to derive `SERVICE_WORKER_BUILD_ID`, and `_headers` is one of them; registering it after would make the build id reflect pre-substitution content
    - _Bug_Condition: isBugCondition C3 (negated branch) — a valid build must emit a marker-free CSP_
    - _Expected_Behavior: design Property 6 — clauses 2.19, 2.30_
    - _Preservation: design Property 7, clause 3.14 — the service-worker manifest still enumerates every asset and its marker guard still throws when markers are missing_
    - _Requirements: 2.19, 2.30_

  - [ ] 5.4 Verify the C3 bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Misconfigured builds fail; valid builds emit a marker-free CSP
    - **IMPORTANT**: Re-run the SAME C3 tests from task 1 - do NOT write new tests
    - Cover each missing-variable combination and each URL form: `https`, `http`, `http://localhost`, `http://127.0.0.1`, unparseable, empty
    - **EXPECTED OUTCOME**: Tests PASS (confirms C3 is fixed)
    - _Requirements: Expected Behavior Properties from design (Properties 5, 6) — 2.16, 2.17, 2.18, 2.19, 2.30_

  - [ ] 5.5 Verify the C3 preservation tests still pass
    - **Property 2: Preservation** - Existing headers, the key fallback, and the SW manifest are unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Commit C3 as one reviewable change once 5.4 and 5.5 both hold — clause 2.16 and clauses 2.18/2.19 must land together, since shipping markers without injection would emit them to production

- [ ] 6. C4 — Fix for light-only hard-coded surfaces breaking the dark theme

  - [ ] 6.1 Convert palette literals to existing theme tokens in the four guarded files
    - `src/components/InstallPromptBanner.tsx` (18 matches), `src/components/CycleSupportSection.tsx` (2), `src/pages/RecordPage.tsx` (16), `src/pages/TripsPage.tsx` (24)
    - Mapping, using only tokens already defined in `src/styles/index.css`: `bg-white`/`bg-gray-50` → `bg-card` or `bg-muted`; `bg-gray-100` → `bg-muted`; `border-gray-100`/`border-gray-200` → `border-border`; `text-gray-900`/`text-gray-800` → `text-foreground` or `text-card-foreground`; `text-gray-700`/`text-gray-600`/`text-gray-500`/`text-gray-400` → `text-muted-foreground`
    - Translucent surfaces become opacity variants of tokens: `bg-white/80` → `bg-card/80`, `bg-white/60` → `bg-card/60`, `bg-white/40` → `bg-card/40` (`RecordPage.tsx:385,390,396`; `CycleSupportSection.tsx:363`) — eliminated, not overridden
    - Accent foregrounds become paired tokens: `bg-coral text-white` → `bg-coral text-coral-foreground` (`CycleSupportSection.tsx:390`), so the exception is legible rather than accidental
    - Add no new tokens; change nothing in `index.css`; do not redesign the light theme
    - _Bug_Condition: isBugCondition C4 — palette-literal surface/border/text utilities including opacity variants, in a guarded file, that are not theme-invariant accent foregrounds_
    - _Expected_Behavior: design Property 8 — `occurrenceCount'(input) = 0`_
    - _Preservation: design Property 9, clauses 3.12, 3.13 — token definitions and the light-theme appearance are untouched_
    - _Requirements: 2.20, 2.21, 2.23_

  - [ ] 6.2 Resolve the three additional matching files explicitly
    - `src/pages/ServicePage.tsx:145,149` — `bg-white/20`, `bg-white/10` over the `from-navy to-navy/80` gradient at `:141`, plus `text-white/10` (`:142`), `text-white/80` (`:159`), `bg-black/25` (`:163`), `text-white/60` (`:169`), `bg-black/50` (`:241`): verify against the dark theme, then either convert or record as theme-invariant accent overlays on a fixed-hue navy surface
    - `src/pages/SchedulePage.tsx:464` — `bg-slate-500` (private-event dot) and `bg-white` (today marker on `bg-coral`): verify and resolve; `bg-black/50` at `:505` is a modal scrim, conventionally theme-invariant
    - `src/pages/OnboardingPage.tsx:624` — `border-white` on a spinner inside a `bg-coral text-white` button, plus `bg-black text-white` at `:402` for the brand-mandated Apple sign-in button: verify and resolve
    - Record the decision and its reason for each file; an unexplained exclusion is not acceptable
    - _Bug_Condition: isBugCondition C4 — three files outside the four named in clause 2.20 match the regex_
    - _Expected_Behavior: design Property 8 — clause 2.22's requirement that guard scope be explicit and reasoned_
    - _Preservation: design Property 9 — light-theme appearance unchanged wherever a conversion is made_
    - _Requirements: 2.22_

  - [ ] 6.3 Add the guard test `src/lib/themeTokens.test.ts`
    - Read the four guarded files from disk, apply the `isBugConditionC4` regex **including opacity variants**, and assert zero matches after subtracting theme-invariant accent foregrounds
    - Make `guardedFiles` an explicit list, carrying the documented reason for every exclusion from task 6.2
    - Assert the exception rule accepts `bg-coral text-coral-foreground` and still rejects `bg-white/60`
    - Add the guard-soundness property test: generated synthetic class strings are flagged for palette literals with and without numeric and opacity suffixes, and never flagged for theme tokens
    - Because `vitest.config.ts` sets `globals: false`, import `describe`/`it`/`expect` from `vitest`
    - _Bug_Condition: isBugCondition C4 — clause 1.18, nothing catches a reintroduced light surface today_
    - _Expected_Behavior: design Property 8 — clause 2.22_
    - _Preservation: design Property 9_
    - _Requirements: 2.22, 2.23_

  - [ ] 6.4 Verify the C4 bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - No palette literal survives in a guarded file
    - **IMPORTANT**: Re-run the SAME C4 tests from task 1 - do NOT write new tests
    - Also mount each of the four components under light and dark and assert readable foreground-on-surface pairings in both
    - **EXPECTED OUTCOME**: Tests PASS (confirms C4 is fixed)
    - _Requirements: Expected Behavior Properties from design (Property 8) — 2.20, 2.21, 2.22, 2.23_

  - [ ] 6.5 Verify the C4 preservation tests still pass
    - **Property 2: Preservation** - The light theme and the token definitions are untouched
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Confirm the light-theme snapshots are identical and `src/styles/index.css`, `LIGHT_THEME_COLOR` and `DARK_THEME_COLOR` are unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Commit C4 as one reviewable change once 6.4 and 6.5 both hold

- [ ] 7. C5 — Fix for unresolved and unrecorded build and dependency hygiene

  - [ ] 7.1 Remove the duplicate dynamic `@/lib/events` imports in `src/lib/store.tsx`
    - Extend the existing static import at line 19 to name `saveEventToDB`, `updateEventInDB` and `deleteEventFromDB`, and remove the `await import('@/lib/events')` calls at lines 1397, 1438 and 1479
    - Keep each call site's surrounding `try`/`catch`, its `isCurrentLinkedCouple` / `isCurrentScope` guard and its return values exactly
    - _Bug_Condition: isBugCondition C5 — `warnings CONTAINS mixedStaticDynamicImport`_
    - _Expected_Behavior: design Property 10 — the warning is removed and observable behaviour is unchanged_
    - _Preservation: design Property 12, clause 2.24 — each call site behaves identically_
    - _Requirements: 2.24_

  - [ ] 7.2 Make the `@capacitor/browser` import static in `src/lib/supabase.ts`
    - Replace the dynamic `await import('@capacitor/browser')` at line 450 with a static `import { Browser } from '@capacitor/browser'`, matching `src/lib/deepLinks.ts:2`
    - No bundle-size regression: `src/main.tsx:9` already statically imports `@/lib/deepLinks`, which statically imports `@capacitor/browser`, so the module is already in the eager graph
    - Leave the `isNativePlatform()` guard that keeps `Browser.open` off the web path untouched
    - _Bug_Condition: isBugCondition C5_
    - _Expected_Behavior: design Property 10_
    - _Preservation: clause 2.25 — the native-platform guard is unchanged_
    - _Requirements: 2.25_

  - [ ] 7.3 Add `manualChunks` vendor splitting in `vite.config.ts`
    - Configure `build.rollupOptions.output.manualChunks` splitting by import identity — react/react-dom/react-router, `@supabase/supabase-js`, `@dnd-kit/*`, `date-fns`, `lucide-react` — sufficient to clear the large-chunk warning
    - Do not change module evaluation order in any observable way
    - **Verify, do not assume**, that `injectServiceWorkerManifest` still enumerates every emitted asset under `dist/assets` recursively so an offline activation finds all new chunks
    - _Bug_Condition: isBugCondition C5 — `warnings CONTAINS largeChunk` (~520 KB / 151 KB gzip)_
    - _Expected_Behavior: design Property 10 — clause 2.26_
    - _Preservation: design Property 7, clause 3.14 — offline activation still resolves every hashed asset_
    - _Requirements: 2.26_

  - [ ] 7.4 Pin `brace-expansion` to 1.1.18 via `overrides`
    - **DECISION 3 — the registry-verification precondition in clause 2.27 is satisfied in the affirmative, and the pin is applied.** npm publishes **1.1.18** on the 1.x line (and 5.0.9 on 5.x), superseding audit section 7-3's "no patched 1.x release exists" conclusion. Clause 2.27's acceptance-recording fallback therefore does not apply; the fix is applied. bugfix.md clause 2.27 and design.md Property 11 record this resolution, while bugfix.md defect clause 1.22 intentionally still describes the pre-fix baseline, because defect clauses describe the code as it stands at `7d82e3e`
    - Add an `overrides` entry pinning `brace-expansion` to **1.1.18**, deliberately staying on the **1.x line** so `minimatch@3`'s CJS `require` shape is preserved. Do not move the `eslint` → `minimatch@3` path onto 5.x, whose changed exports are exactly the lint-breaking risk audit 7-3 identified
    - Run `npm install` to update `package-lock.json` from `1.1.16` to `1.1.18`, and commit the lockfile
    - **Proof of safety: `npm run lint` must report 0 errors and 0 warnings afterwards.** A `brace-expansion` change that breaks `minimatch@3`'s CJS `require` is a regression, not a fix, and must be reverted rather than worked around
    - **Never run `npm audit fix --force`**
    - Record in `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` that the five development-only advisories under GHSA-mh99-v99m-4gvg are resolved by this pin, that the registry check superseded audit 7-3's conclusion, and why the 1.x line was chosen over 5.x
    - _Bug_Condition: isBugCondition C5 — clause 1.22, the advisory is unresolved and the registry claim was unverified_
    - _Expected_Behavior: design Property 11 — clause 2.27, applied because verification confirmed a consumable patched release_
    - _Preservation: clauses 3.15, 3.16 — lint stays at 0/0 and `react-router` stays pinned at `7.18.2`_
    - _Requirements: 2.27, 3.16_

  - [ ] 7.5 Record the react-router conditional acceptance in the deployment checklist
    - In `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`, record GHSA-qwww-vcr4-c8h2 against `react-router` 7.18.2 as a documented conditional acceptance, stating the preconditions that make it inapplicable — a static Vite SPA using `BrowserRouter` only, with no Framework Mode, no RSC, no `loader`, no `action`, no `useFetcher`, no react-router `<Form>` and no server routes
    - State the **invalidation trigger**: adopting any one of those features voids the acceptance and forces re-evaluation
    - Both a blind downgrade to 7.11.0 and a major-version upgrade are forbidden
    - _Bug_Condition: isBugCondition C5 — clause 1.23, the reasoning lives only in the audit document a maintainer has no reason to open_
    - _Expected_Behavior: design Property 13 — operator-facing decisions are recorded where they will be encountered_
    - _Preservation: clause 3.15 — the pin at `7.18.2` and declarative `BrowserRouter` usage are unchanged_
    - _Requirements: 2.28_

  - [ ] 7.6 Verify the C5 bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Build warnings are removed without behavioural change
    - **IMPORTANT**: Re-run the SAME C5 tests from task 1 - do NOT write new tests
    - Assert no remaining `await import('@/lib/events')` or `await import('@capacitor/browser')` in the source, and a build log free of mixed-import and large-chunk warnings
    - **EXPECTED OUTCOME**: Tests PASS (confirms C5 is fixed)
    - _Requirements: Expected Behavior Properties from design (Property 10) — 2.24, 2.25, 2.26_

  - [ ] 7.7 Verify the C5 preservation tests still pass
    - **Property 2: Preservation** - Dependency and lint posture is verified, not assumed
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Confirm the converted call sites behave identically, `Browser.open` still fires only under `isNativePlatform()`, the service-worker manifest lists every emitted chunk, and lint is 0/0
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Commit C5 as one reviewable change once 7.6 and 7.7 both hold

- [ ] 8. Gate 2.29(a)-(c) — install, typecheck, lint
  - Run `npm ci`; it must complete from the committed lockfile, including the `overrides` entry from task 7.4
  - Run `npm run typecheck`; 0 errors
  - Run `npm run lint`; **0 errors and 0 warnings** — this is also the proof required by task 7.4 that the `brace-expansion` pin did not break `minimatch@3`'s CJS `require`
  - Record the exact output of each command
  - _Requirements: 2.29_

- [ ] 9. Gate 2.29(d) — full test suite against the measured baseline
  - Run `npm test`
  - **BASELINE**: **206 tests across 23 files** must continue to pass, plus the new suites from clauses 2.15 (`src/lib/cors.test.ts`) and 2.22 (`src/lib/themeTokens.test.ts`), the tests added in tasks 1 and 2, the marker helper and fail-closed totality tests from task 3.5, and the nine-test Deletion-Recovery Suite from task 3.13
  - Confirm the final count equals the recorded 206/23 baseline plus the new tests, with zero pre-existing tests removed or skipped
  - _Requirements: 2.29_

- [ ] 10. Gate 2.29(e)-(g) — positive build, negative build, marker assertion
  - Positive build: run `npm run build` with non-secret placeholders supplied **for that invocation only** — `VITE_SUPABASE_URL=https://example.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key-not-a-secret`. These must never be written into any tracked file, so clause 2.19's prohibition is not circumvented by the verification itself
  - Assert the positive build succeeds with **no mixed static/dynamic import warning and no large-chunk warning**
  - **Negative build test**: run a production build with the required variables **absent** and assert a non-zero exit code with a message naming the missing variable, proving clause 2.17
  - **Marker assertion**: grep all of `dist/` and assert **zero occurrences** of `__SUPABASE_HTTP_SRC__` and `__SUPABASE_CONNECT_SRC__`, proving clause 2.19
  - Assert `dist/_headers` contains a `Content-Security-Policy` naming the injected `https://` origin and both the `https://` and `wss://` origins in `connect-src`, and that the five non-CSP headers are byte-identical to `7d82e3e`
  - _Requirements: 2.29, 2.30_

- [ ] 11. Gate 2.29(h)-(k) — audit, secret scan, whitespace check, Deletion-Recovery Suite
  - Run `npm audit` and report the output; every remaining advisory must be covered by a recorded decision from task 7.4 (`brace-expansion`, now resolved at 1.1.18) or task 7.5 (react-router conditional acceptance)
  - **Secret scan**: confirm no JWT-shaped strings, no `service_role` values, no real Supabase project URL, no keystore or certificate files, and no tracked `.env`. The build placeholders from task 10 must appear in no tracked file
  - Run `git diff --check`: no whitespace errors and no conflict markers
  - **Gate (k) — Deletion-Recovery Suite**: run the nine tests from task 3.13 and record the result of each: marker created on partial deletion; logout preserves it; same-user re-login resumes recovery; another user unblocked with the first marker intact; malformed marker fails closed, including the negative `removeItem` assertion; clean browser blocked by server metadata with the verdict provably coming from `getUser()`; pending-flag write failure blocks all application-data deletion; retry success deletes the Auth user **before** clearing the marker; normal routes inaccessible throughout
  - _Requirements: 2.29, 2.30, 2.38_

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise
  - Record the results of all **eleven** gates 2.29(a)-(k) for this branch, since no verification result exists for this baseline (clause 1.24)
  - Confirm scope discipline: the branch descends from `7d82e3efd1b17283b0e8f086e94cf97cf268b625` alone, the older divergent 19-commit local branch is neither merged nor cherry-picked, and `capacitor.config.ts`, the `cap:*` scripts and the Android shell are unmodified
  - Report the following as **unperformed human release gates**, not as work done: staging deployment, production deployment, remote application of migrations `013_invitation_hardening.sql` / `014_feature_privacy_and_collaboration.sql` / `015_security_followup.sql` (with the `013 → 014 → 015` order and the ambiguous duplicate `002_*` ordering still flagged), Edge Function deployment, setting `ALLOWED_ORIGINS` in any remote environment, the two-account end-to-end deletion test, and any merge into the default branch
  - Report the deletion-recovery architecture for reviewer sign-off, with its costs stated rather than smoothed over: recovery rests on the **server-authoritative** `app_metadata.account_deletion_pending` flag (task 3.6) plus the **dedicated per-user local marker** outside `STORE_KEY` (task 3.5), with `carryOverDevicePrefs` left exactly as at `7d82e3e`; the earlier `STORE_KEY`-boolean approach is **rejected as fail-open**. Name the accepted residual risks from design.md decision item 1: a new pre-deletion failure mode at the flag write, no compensating update written speculatively, a `getUser()` round-trip on the auth path bounded by `withTimeout`, a pseudonymous UUID retained past logout as the minimum identifier necessary, marker loss being a **failure and never a "fail-safe"**, and the absence of any server-confirmed cancellation workflow (clause 2.34)
  - _Requirements: 2.29, 2.38, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25_
