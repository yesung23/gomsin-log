# Web Release Stabilization Bugfix Design

## Overview

This design fixes the five defect clusters that block the 곰신로그 web release, on the working
branch `kimi/web-release-stabilization` at `7d82e3efd1b17283b0e8f086e94cf97cf268b625`.

| ID | Defect | Fix strategy in one line |
| --- | --- | --- |
| C1 | Partial account deletion is misreported and leaves private data on screen | Read the error response body, classify the outcome into a typed union, purge in-memory content while retaining identity, route to a recovery screen, and make that recovery **durable and server-authoritative** via an admin-only `app_metadata` flag backed by a dedicated per-user local marker |
| C2 | `delete-account` Edge Function accepts any browser origin | Replace the wildcard with a fail-closed `ALLOWED_ORIGINS` allowlist in a new shared module, always sending `Vary: Origin` |
| C3 | Build ships no CSP and silently accepts missing Supabase config | Add build-time environment validation and marker-token CSP injection into `dist/_headers` |
| C4 | Light-only hard-coded surfaces break dark theme | Convert palette literals (including opacity variants) to existing theme tokens in four files, guarded by a new test |
| C5 | Build and dependency hygiene unresolved and unrecorded | Remove duplicate dynamic imports, add `manualChunks`, pin `brace-expansion` to the registry-verified `1.1.18` on the 1.x line, and record dependency decisions |

Every fix is a defect repair, not a redesign. C4 changes consumers only and never touches token
definitions. C2 adds a gate in front of the deletion sequence and changes nothing inside it. C5
must be behaviour-neutral by construction. C1 is the one cluster that adds a durable server-side
write, and it does so because clause 2.31 requires an authority that survives clearing browser
storage, a private window and a change of device.

**Deletion recovery rests on two ranked authorities (2.5, 2.31, 2.33).** The **primary** authority
is the Auth user's admin-only `app_metadata.account_deletion_pending`, written with the
service-role key inside the Edge Function and never writable by a client. The **secondary**
authority is a dedicated per-user local marker at
`gomsinlog.accountDeletionRecovery.v1.<userId>`, which exists only to make blocking instant,
offline-capable and reload-proof. The secondary authority can never override a `true` primary
result, is never the sole authority, and every ambiguous state resolves toward *staying* in
recovery. The earlier design — a boolean inside `STORE_KEY`, cleared on logout, dropped when
`STORE_KEY` was corrupt — is **rejected as fail-open** and no longer appears anywhere in this
document.

**Verified baseline.** `git branch --show-current` reports `kimi/web-release-stabilization`
and `git log --oneline -1` reports `7d82e3e fix: harden offline updates and fail-closed sync`,
so the branch and baseline named in the requirements are the ones this design targets.

## Glossary

- **Bug_Condition (C)** — the predicate selecting inputs that trigger a defect. There are five,
  `isBugConditionC1` … `isBugConditionC5`, each defined in Bug Details below.
- **Property (P)** — the required behaviour of the fixed system for inputs satisfying C.
- **Preservation** — for every input where no bug condition holds, `F(X) = F'(X)`; the observable
  behaviour of the code at `7d82e3e` is unchanged.
- **F** — the code at `7d82e3e`. **F'** — the code after this fix.
- **`deleteAccountFromDB`** — the client function at `src/lib/supabase.ts:343` that invokes the
  Edge Function and today returns `{ ok: boolean; warnings: string[] }`.
- **`deleteAccount`** — the store action at `src/lib/store.tsx:1672` that calls
  `deleteAccountFromDB` and then `purgeLocalAccountData`.
- **`purgeLocalAccountData`** — the existing full purge at `src/lib/store.tsx:1641`. It clears
  `authenticatedUser`, removes both store keys, bumps the session generation, sets
  `cachePurgedRef`, and retains only `carryOverDevicePrefs` (`store.tsx:197-203`).
- **`dataRemoved`** — the Edge Function response field at
  `supabase/functions/delete-account/index.ts:290`. It carries `databasePreparationCompleted`,
  meaning server-side data is gone even though HTTP status is 500.
- **`accountDeletionRecovery`** — new store state indicating a partial deletion is outstanding.
  Derived from the two ranked authorities below, never from route or toast state.
- **`account_deletion_pending`** — the **primary authority** (2.31): an admin-only boolean in the
  Auth user's `app_metadata`, written with the service-role key inside the Edge Function and
  never writable by the client. It travels with the account, so it survives cleared storage, a
  private window and a different device.
- **Recovery marker** — the **secondary authority** (2.33): a boolean at the dedicated top-level
  `localStorage` key `gomsinlog.accountDeletionRecovery.v1.<userId>`. It lives **outside**
  `STORE_KEY` and is **not** part of `carryOverDevicePrefs`. Its only job is immediate, offline,
  pre-network-round-trip blocking. It is never the sole authority.
- **`begin_account_deletion` / `cancel_account_deletion`** — the pre-existing, *non-durable*
  server marker RPCs (`index.ts:181`, `:194`, `:246`). They exist to close migration 015's
  Storage upload race, and `cancel_account_deletion` clears the marker again in the `catch`, so
  they are **not** a record of pending deletion. `account_deletion_pending` is a separate,
  durable flag with a different lifecycle and must not be confused with them.
- **`getUser()`** — `supabase.auth.getUser()`, a server round-trip that returns freshly read user
  metadata. Required by 2.36 because `app_metadata` changes do **not** appear in an
  already-issued JWT, so `session.user.app_metadata` from a cached token can be stale.
- **Palette literal** — a Tailwind utility naming a fixed hue from the default palette, such as
  `bg-white`, `bg-gray-50`, or the opacity variant `bg-white/60`.
- **Theme token** — a utility resolving to a CSS custom property defined in
  `src/styles/index.css`, such as `bg-card`, `text-muted-foreground`, `border-border`.
- **Theme-invariant accent foreground** — foreground text on a fixed-hue accent surface where the
  paired foreground token is white in both themes, e.g. `--coral-foreground`
  (`index.css:57` light, `:89` dark).
- **Marker token** — `__SUPABASE_HTTP_SRC__` / `__SUPABASE_CONNECT_SRC__`, committed placeholders
  in `public/_headers` that the build replaces with the validated project origin.

---

## Bug Details

### Bug Condition C1 — Partial deletion is misreported

The bug manifests when the Edge Function returns a non-2xx response whose body carries
`dataRemoved: true`. `deleteAccountFromDB` (`src/lib/supabase.ts:350-353`) branches on the
transport `error` object, logs it, and returns `{ ok: false, warnings: [] }`, discarding the body.
`deleteAccount` (`store.tsx:1685`) then returns at `if (!result.ok) return result;` before
reaching `purgeLocalAccountData`, so in-memory `AppState` stays populated and keeps rendering.

**Formal Specification:**
```
FUNCTION isBugConditionC1(input)
  INPUT: input of type DeleteAccountResponse
  OUTPUT: boolean

  RETURN input.httpStatus <> 200
         AND input.body.dataRemoved = TRUE
END FUNCTION
```

#### C1 durability sub-condition — the outstanding deletion is undetectable

Requirements 1.25-1.27 add a second, independent facet of C1: even once the outcome *is*
classified correctly, nothing records it durably. `saveState` persists only the
`carryOverDevicePrefs` whitelist (`store.tsx:128`, `197-203`), so a reload escapes the recovery
screen into a signed-in app over deleted data; and the only server-side marker in the flow
(`begin_account_deletion`) is cleared again by `cancel_account_deletion` in the `catch`
(`index.ts:246`) precisely so uploads are not permanently blocked — so it is not a record of
pending deletion either. The Auth user carries no `app_metadata.account_deletion_pending` at
`7d82e3e`, and the Edge Function begins removing application data **before** writing any state
that outlives the request.

```
FUNCTION isBugConditionC1Durable(input)
  INPUT: input of type RecoveryDetectionAttempt
  OUTPUT: boolean

  // An outstanding deletion exists, but no authority can report it.
  RETURN applicationDataRemoved(input.userId)
         AND authUserStillExists(input.userId)
         AND NOT serverPendingFlagSet(input.userId)      // 1.26, 1.27
         AND NOT durableLocalMarkerPresent(input.userId)  // 1.25
END FUNCTION
```

This sub-condition is what makes a *local-only* remedy insufficient: it is satisfied by clearing
browser storage, by a private window, and by signing in from a different device.

#### C1 tri-state sub-condition — a check that could not complete reads as a negative answer

Requirement 1.28 names a third facet, independent of both the misclassification above and the
durability gap: at `7d82e3e` **no tri-state representation of deletion status exists at all**, so an
authoritative check that fails, times out or cannot be attempted offline is indistinguishable from
one that completed and answered "not pending". The verified facts behind that claim:

- `src/lib/accountDeletion.ts` does not exist — `src/lib/` contains no deletion module of any kind.
- `StoreContextType` (`src/lib/storeContext.ts:12-47`) exposes no deletion-status value. Its only
  availability-shaped fields are `authSyncUnavailable: boolean` (`storeContext.ts:16`) and
  `sharedSyncStatus: SharedSyncStatus` (`storeContext.ts:17`, the union `'live' | 'delayed' |
  'unavailable'` at `storeContext.ts:10`) — both of which describe *sync* health, not whether a
  deletion is outstanding.
- `deleteAccountFromDB` returns `Promise<{ ok: boolean; warnings: string[] }>`
  (`src/lib/supabase.ts:343`) and `deleteAccount` returns the same shape (`store.tsx:1672`). A
  two-valued `ok` has no room for "could not determine".
- `src/App.tsx` routes on the restored session alone (`App.tsx:94-118`), admitting `/`, `/home`,
  `/record`, `/schedule`, `/service`, `/us`, `/my`, `/settings`, `/trips`
  (`App.tsx:105-114`) with no deletion-status input at all.
- The only fallback vocabulary on the auth path is
  `withTimeout(fetchFullStateFromDB(sessionUser.id), AUTH_SYNC_TIMEOUT_MS, FULL_STATE_UNAVAILABLE)`
  (`store.tsx:423-427`), and `withTimeout` (`src/lib/async.ts:7-32`) resolves the *caller's own
  fallback value* on both timeout and rejection. There is no channel through which "no answer" can
  travel separately from "a negative answer", so every failure path collapses into the same
  falsy/absent value and is silently treated as permission to proceed.

```
FUNCTION isBugConditionC1TriState(input)
  INPUT: input of type DeletionStatusEvaluation
  OUTPUT: boolean

  // The authoritative question was asked and went unanswered ...
  RETURN input.authoritativeCheckAttempted
         AND NOT input.authoritativeAnswerReceived        // failed, timed out, or offline
         AND NOT positiveLocalMarkerPresent(input.userId)
         // ... yet its outcome is indistinguishable from an authoritative negative, because
         // no representation exists anywhere that could hold the difference (1.28).
         AND representationOf(input.outcome) = representationOf(AUTHORITATIVE_NOT_PENDING)
         AND permitsNormalRouting(input.outcome)
END FUNCTION
```

Note the shape of that predicate. The defect is **not** that a check failed — checks fail, and
`withTimeout` exists precisely because they do. The defect is that the failure and the negative
answer **share one representation**, so no downstream code *can* tell them apart even if it wanted
to, and neither logs nor persisted state retain any trace that the question went unanswered. That is
why the remedy in 2.39-2.43 is a change of **type**, not an added `if`.

### Bug Condition C2 — Any browser origin is accepted

`supabase/functions/delete-account/index.ts:18-22` declares a wildcard `corsHeaders` constant,
returned on every response through `jsonResponse` (`:44`) and on the preflight (`:145-147`). No
`Vary: Origin` is sent and no allowlist exists to configure.

**Formal Specification:**
```
FUNCTION isBugConditionC2(input)
  INPUT: input of type EdgeFunctionRequest
  OUTPUT: boolean

  RETURN input.headers.origin IS NOT NULL
         AND input.headers.origin NOT IN parseAllowedOrigins(env.ALLOWED_ORIGINS)
END FUNCTION
```

### Bug Condition C3 — Missing CSP and silently accepted misconfiguration

`src/lib/supabase.ts:9-10` defaults both `VITE_SUPABASE_URL` and the key to `''`, and
`vite.config.ts` performs no environment validation, so `npm run build` succeeds with no
configuration and emits a permanently demo-mode artifact. `public/_headers` contains no CSP and
no marker token; its header comment states CSP is deliberately delegated to the platform.

**Formal Specification:**
```
FUNCTION isBugConditionC3(input)
  INPUT: input of type ProductionBuildEnvironment
  OUTPUT: boolean

  RETURN input.VITE_SUPABASE_URL IS EMPTY
         OR (input.VITE_SUPABASE_PUBLISHABLE_KEY IS EMPTY
             AND input.VITE_SUPABASE_ANON_KEY IS EMPTY)
         OR NOT isHttpsOrLocalhost(input.VITE_SUPABASE_URL)
END FUNCTION
```

### Bug Condition C4 — Palette literals defeat the dark theme

A class-name occurrence in a guarded file names a fixed palette hue instead of a theme token.
Audit item 21 records that opacity variants such as `bg-white/60` defeated the earlier
`!important` palette remap, so bare-colour detection alone is insufficient.

**Formal Specification:**
```
FUNCTION isBugConditionC4(input)
  INPUT: input of type ClassNameOccurrence
  OUTPUT: boolean

  RETURN input.utility MATCHES
    /^(bg|border|divide|from|to|via|ring|text|placeholder|shadow)-(white|black|gray|slate|zinc|neutral|stone)(-[0-9]{2,3})?(\/[0-9]{1,3})?$/
    AND input.file IN guardedFiles
    AND NOT isThemeInvariantAccentForeground(input)
END FUNCTION
```

### Bug Condition C5 — Build warnings and unrecorded dependency decisions

`npm run build` emits mixed static/dynamic import warnings for `@/lib/events` and
`@capacitor/browser`, plus a large-chunk warning, because `vite.config.ts` declares no
`manualChunks`. Five development-only advisories and the react-router acceptance are unrecorded
in the deployment checklist.

**Formal Specification:**
```
FUNCTION isBugConditionC5(input)
  INPUT: input of type ProductionBuildOutput
  OUTPUT: boolean

  RETURN input.warnings CONTAINS mixedStaticDynamicImport
         OR input.warnings CONTAINS largeChunk
END FUNCTION
```

### Examples

**C1**
- Auth deletion fails all three `AUTH_DELETE_ATTEMPTS`; the function clears the marker and
  returns `500 { error, dataRemoved: true, warnings: [] }`. *Expected:* outcome
  `partially_deleted`, screen cleared, recovery shown. *Actual:* toast
  `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.` and the user's records, events, trips,
  couple and military profile still on screen.
- Storage listing fails before `prepare_account_deletion` commits; the function returns
  `500 { dataRemoved: false }`. *Expected:* account fully intact, generic retry message.
  *Actual:* same generic message — correct by accident, indistinguishable from the case above.
- Response body is unreadable (relay failure, empty body). *Expected:* classified `failed`, no
  purge. *Actual:* `{ ok: false }` — same collapse.
- Edge case: user switches to account B while A's deletion is in flight. *Expected:*
  `isCurrentIdentity` guard (`store.tsx:1682`) still prevents clearing B's session.
- Durability: the user refreshes the page after a partial deletion. *Expected:* the recovery
  screen is re-entered before any route renders. *Actual:* nothing was persisted, so the reload
  lands on `/` over empty data (1.25).
- Durability: the user logs out from the recovery screen and signs back in as the same account.
  *Expected:* recovery resumes with the retry action available (2.34). *Actual:* a normal
  signed-in app with no data and no explanation.
- Durability: the user clears site data, or opens a private window, or signs in on a phone.
  *Expected:* `getUser()` reports `app_metadata.account_deletion_pending = true` and every normal
  route stays blocked (2.31, 2.36). *Actual:* no server-side record exists to consult (1.26).
- Durability edge case: the local marker contains `"true"`, `{}`, or invalid JSON. *Expected:*
  treated as recovery ACTIVE and left in place (2.35). *Rejected alternative:* deleting it, which
  hands the user a normal app over deleted data.

**C2**
- `https://evil.example` fetches `POST /delete-account` with a stolen bearer token in a
  cross-origin `fetch`. *Expected:* `403`, no `Access-Control-Allow-Origin`. *Actual:* `200` with
  `Access-Control-Allow-Origin: '*'`, so the page reads the deletion result.
- A shared cache stores one origin's CORS decision. *Expected:* `Vary: Origin` prevents reuse.
  *Actual:* no `Vary` header at all.
- `OPTIONS` preflight from an unknown origin. *Expected:* `403`. *Actual:* `200 'ok'` with the
  wildcard, approving the origin unconditionally.
- Edge case: `ALLOWED_ORIGINS` unset. *Expected:* `500` configuration error, fail closed.

**C3**
- `npm run build` with no Supabase variables. *Expected:* non-zero exit naming the missing
  variable. *Actual:* success, publishable artifact that is permanently demo mode.
- `VITE_SUPABASE_URL=http://prod.supabase.co`. *Expected:* rejected as non-HTTPS. *Actual:*
  passed straight to `createClient`.
- Deployed `dist`. *Expected:* `_headers` carries a CSP naming the project's `https:` and `wss:`
  origins. *Actual:* only the five non-CSP headers.
- Edge case: `VITE_SUPABASE_URL=http://localhost:54321`. *Expected:* accepted — local Supabase is
  a legitimate development target.

**C4**
- Dark theme, install banner: `bg-gray-50` surface with `text-gray-900` body
  (`InstallPromptBanner.tsx:65,71-108`). *Expected:* `bg-card` / `text-card-foreground`.
  *Actual:* light card with near-invisible text.
- Dark theme, cycle support signal: `bg-white/60` (`CycleSupportSection.tsx:363`). *Expected:*
  `bg-card/60`. *Actual:* translucent light wash over a dark background.
- Dark theme, record page: `bg-white/80`, `bg-white/60`, `bg-white/40` (`RecordPage.tsx:385,390,396`).
  *Expected:* opacity variants of `bg-card`. *Actual:* light panels with dark-on-dark text.
- Edge case: `bg-coral text-white` (`CycleSupportSection.tsx:390`). *Expected:* permitted as a
  theme-invariant accent foreground, but rewritten to `text-coral-foreground` so intent is
  legible — `--coral-foreground` is white in both themes.

**C5**
- `@/lib/events` is imported statically at `store.tsx:19` and dynamically at `1397`, `1438`,
  `1479`. *Expected:* one static import, no warning. *Actual:* warning, and the dynamic chunk is
  inlined so the split achieves nothing.
- `@capacitor/browser` is static at `deepLinks.ts:2` and dynamic at `supabase.ts:450`.
  *Expected:* one static import. *Actual:* the same warning.
- `npm run build` chunk size. *Expected:* no large-chunk warning. *Actual:* 520 KB / 151 KB gzip
  in one chunk.
- Edge case: `brace-expansion@1.1.16` under `eslint → minimatch@3`. *Expected:* an `overrides`
  pin to the patched `1.1.18` on the 1.x line. *Actual:* the lockfile sits at `1.1.16`. Registry
  verification is now complete and affirmative — npm publishes `1.1.18` on 1.x (and `5.0.9` on
  5.x) — so audit section 7-3's "no patched 1.x exists" conclusion is stale.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Schedule, trips, cycle tracking, records with attachments, couple invitation/link/disconnect
  and shared-sync status behave exactly as at `7d82e3e` (requirements 3.1-3.6).
- Sign-out, account switch and **fully successful** deletion continue to use
  `purgeLocalAccountData` unchanged, including clearing `authenticatedUser`, bumping the session
  generation, and setting the cache-purged flag (3.7).
- Demo mode survives refresh via `INITIAL_SESSION`, accepts only invitation code `123456`,
  activates only when `!supabase`, and strips `blob:` URLs before persisting (3.8).
- The `VITE_SUPABASE_ANON_KEY` fallback at `src/lib/supabase.ts:10` keeps working, and the new
  build validation treats it as satisfying the key requirement (3.9).
- The five existing non-CSP headers in `_headers` are delivered byte-identically (3.10).
- `prefers-color-scheme` is honoured for a device that never chose a theme, and `widgetLayout`,
  `hasSeenInstallPrompt`, `theme` survive sign-out and account switches (3.11).
- Token values in `src/styles/index.css`, `LIGHT_THEME_COLOR = '#FAF8F5'` and
  `DARK_THEME_COLOR = '#16181D'` are unchanged; no token is added, renamed or redefined (3.12).
- Every surface touched by C4 looks the same in the **light** theme as it does today (3.13).
- An offline service-worker activation finds every hashed asset, and the
  `SERVICE_WORKER_ASSET_MARKER` / `SERVICE_WORKER_BUILD_ID` guard still throws when its markers
  are missing (3.14).
- `react-router`/`react-router-dom` stay pinned at `7.18.2` and `src/main.tsx` keeps using
  `BrowserRouter` in declarative mode (3.15).
- `npm run lint` still exits with 0 errors and 0 warnings after any dependency change (3.16).
- A valid `POST` from an allowlisted origin with a valid bearer token still runs the deletion
  sequence with its **internal order and per-step semantics preserved**: record preflight,
  `begin_account_deletion`, `removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` /
  `MAX_STORAGE_DEPTH = 8`, `prepare_account_deletion`, then `deleteUser` with
  `AUTH_DELETE_ATTEMPTS = 3` and `cancel_account_deletion` cleanup on failure — every constant
  and every step unchanged (3.17). **This is no longer a byte-for-byte guarantee, and this design
  does not pretend otherwise.** Per 2.32 and the amended 3.17, the whole sequence is now
  **preceded** by the admin-only `app_metadata.account_deletion_pending = true` write, and entry
  into the sequence is **gated** on that write succeeding: if the flag write fails, the
  preflight-through-`deleteUser` sequence does not begin at all. What is preserved is the sequence
  *once entered*; what changed is that entry is conditional and preceded by a durable server-side
  write. No step is reordered, removed or given different semantics.

**Scope:**
All inputs where no bug condition holds are completely unaffected. This includes:
- Successful deletions (`200 { success: true }`) and genuine total failures
  (`dataRemoved: false`) — neither enters recovery.
- Same-origin browser requests from an allowlisted origin, and non-browser authenticated clients
  with no `Origin` header, which still require a valid bearer token.
- Builds with valid configuration, and `vite dev` / `vitest`, which are not production builds.
- Light-theme rendering, and every file outside the four guarded files.
- All runtime behaviour of the four call sites whose dynamic imports become static.

**Out of scope, reported as release gates, not attempted (3.18-3.25):** the divergent 19-commit
local branch is not merged; Android/native work stays deferred; staging and production deploys,
remote migrations `013/014/015`, Edge Function deployment, the two-account manual test, and any
merge to the default branch are all left unperformed.

**Note:** the expected correct behaviour for buggy inputs is defined below in Correctness
Properties. This section states only what must not change.

---

## Hypothesized Root Cause

### C1 — Boolean return shape erases a three-valued server outcome

1. **Lossy error handling.** `supabase-js` surfaces a non-2xx response as a `FunctionsHttpError`
   whose body is only reachable through `error.context` (a `Response`). `deleteAccountFromDB`
   never touches `context`, so `dataRemoved` is unreachable by construction, not by oversight.
2. **Insufficient return type.** `{ ok: boolean; warnings: string[] }` cannot express three
   outcomes. `deleted`, `partially_deleted` and `failed` all collapse into `ok: false` or
   `ok: true`. `src/lib/accountDeletion.ts` does not exist.
3. **Purge coupled to total success.** `store.tsx:1685` gates `purgeLocalAccountData` on
   `result.ok`, so the one path that clears the exposure is the one path a partial deletion never
   takes.
4. **No recovery state.** Neither `StoreContextType` (`src/lib/storeContext.ts:12-39`) nor
   `StoreProvider` exposes any recovery flag, so `App.tsx` has nothing to branch on and keeps
   rendering all ten authenticated routes.
5. **Purge is all-or-nothing.** `purgeLocalAccountData` always clears `authenticatedUser`. A
   partial deletion needs the opposite: clear content, keep identity, because the identity is
   what the retry needs.
6. **No durable record exists on either side, and the write happens too late to help.** On the
   client, `saveState` persists only the device-preference whitelist for an authenticated session
   (`store.tsx:128`, `197-203`), so recovery state cannot survive a reload. On the server, the
   Edge Function's ordering is the real defect: the read-only preflight (`index.ts:167`),
   `begin_account_deletion` (`:181`), `removeAndConfirmRecordMedia` (`:190`),
   `prepare_account_deletion` (`:212`) and `deleteUser` (`:232`) all run with **no prior
   authoritative write that outlives the request**, and the one marker that does get written is
   deliberately cleared again by `cancel_account_deletion` in the `catch` (`:246`) so that
   migration 015's Storage INSERT policy cannot permanently block a still-live account. That
   cleanup is correct for its own purpose and must stay; the missing piece is a *separate*
   durable flag with the opposite lifecycle (1.26, 1.27).
7. **A local-only remedy cannot close the hole, and the obvious local remedy is fail-open.**
   Any client-side signal is bypassed by clearing storage or changing device. Worse, the
   previously-considered form of that signal — a boolean inside `STORE_KEY` — would be dropped by
   `loadState`'s existing `removeItem` on corrupt JSON (`store.tsx:103-116`) and cleared on
   logout, both of which **admit the user to a normal app over deleted data**. The root cause is
   therefore the absence of a *server* authority, not the absence of a client flag.

### C2 — Wildcard chosen for convenience, with no configuration surface

1. **Module-level wildcard constant.** `corsHeaders` at `:18` is a single frozen object reused by
   `jsonResponse` and the preflight, so there is no per-request decision point to extend.
2. **Preflight approves before authenticating.** `:145-147` returns `200 'ok'` for any `OPTIONS`,
   independent of `Origin`.
3. **No `Vary`.** Nothing in the function varies its response on `Origin`, so caches are free to
   cross-serve.
4. **No allowlist plumbing.** `supabase/functions/_shared/` does not exist, and
   `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` section 5 (line 299, service-role key at line
   324) documents only `SUPABASE_SERVICE_ROLE_KEY`.

### C3 — Empty-string defaults make misconfiguration indistinguishable from demo mode

1. **Defaults hide absence.** `|| ''` at `supabase.ts:9-10` converts "not configured" into a
   valid-looking empty string; `isSupabaseConfigured` then silently selects demo mode, which is a
   legitimate state for development and an invisible catastrophe for a release build.
2. **No build-time validation.** `vite.config.ts` has exactly one plugin,
   `injectServiceWorkerManifest`, and no environment check.
3. **No URL validation.** Nothing parses `VITE_SUPABASE_URL` or checks its scheme.
4. **CSP deliberately delegated.** The `public/_headers` comment records a *decision*, not a
   mistake: the project URL is only known at build time. Reversing it therefore requires
   build-time injection to exist first, which is why 2.18/2.19 must land with 2.16.

### C4 — Consumers were written before the token system, and opacity variants evade detection

1. **Pre-token markup.** The four files hard-code the light palette directly, so they cannot
   respond to `--card` / `--foreground` flipping under `.dark`.
2. **Opacity variants defeat remapping.** Audit item 21: `bg-white/60` composes a colour at use
   site, so a palette-level `!important` remap cannot reach it. Verified counts of matching
   utilities: `InstallPromptBanner.tsx` 18, `CycleSupportSection.tsx` 2, `RecordPage.tsx` 16,
   `TripsPage.tsx` 24.
3. **Legitimate exceptions exist in the same files.** `bg-coral text-white`
   (`CycleSupportSection.tsx:390`) is correct today because `--coral-foreground` is white in both
   themes. A guard without an exception rule would either fail on correct code or be weakened
   until it catches nothing.
4. **No guard.** `src/lib/themeTokens.test.ts` does not exist, so any change reintroduces the
   defect silently.

### C5 — Duplicate import styles and a stale audit conclusion on `brace-expansion`

1. **Redundant dynamic imports.** `store.tsx` already imports `@/lib/events` statically at line
   19, so the three `await import('@/lib/events')` calls add a warning and no benefit. Same for
   `@capacitor/browser`, static at `deepLinks.ts:2` and dynamic at `supabase.ts:450`.
2. **No chunk strategy.** `vite.config.ts` declares no `build.rollupOptions.output.manualChunks`,
   so React, Supabase, dnd-kit, date-fns and lucide-react all land in one chunk.
3. **Stale audit conclusion, now superseded by registry verification.** Audit section 7-3
   concluded no patched 1.x exists and rejected an `overrides` bump because `minimatch@3` uses CJS
   `require` while 5.x changed its exports. Registry verification has since been performed and is
   affirmative: npm publishes `brace-expansion` **1.1.18** on the 1.x line and `5.0.9` on 5.x. So
   7-3's premise — not its export-shape reasoning — is stale; the lockfile resolves to `1.1.16`
   only because no pin was ever applied. The residual root cause is therefore a missing
   `overrides` entry, not an unverifiable claim.
4. **Decisions recorded in the wrong document.** The react-router acceptance lives only in
   `docs/kiro/RELEASE_AUDIT_2026-07-31.md`, which a maintainer changing dependencies has no
   reason to open.

---

## Correctness Properties

Property 1: Bug Condition - Partial deletion is classified truthfully and contained

_For any_ deletion response where `isBugConditionC1` holds (non-2xx status carrying
`dataRemoved: true`), the fixed `deleteAccount` SHALL return an outcome whose status is
`partially_deleted` with `dataRemoved: true`, SHALL purge all in-memory and on-disk personal,
couple, content and cache data while retaining only the authenticated identity, the three device
preferences (`widgetLayout`, `hasSeenInstallPrompt`, `theme`) and the dedicated per-user recovery
marker at `gomsinlog.accountDeletionRecovery.v1.<userId>`, SHALL set `accountDeletionRecovery`,
and SHALL block every authenticated route in favour of a recovery screen offering exactly retry
and logout. A response body that cannot be read or parsed SHALL instead be classified `failed`
with `dataRemoved: false`.

Route blocking SHALL hold under **two ranked authorities** (2.5), and each of the following is a
distinct guarantee that SHALL hold independently:

- **Across a page reload.** The local marker is read from its own top-level key before any route
  renders, so a refresh re-enters the recovery screen without waiting on the network. It lives
  **outside** `STORE_KEY` and is **not** in `carryOverDevicePrefs`, so rewriting, clearing or
  corrupting `STORE_KEY` cannot affect blocking.
- **Across logout and re-login as the same user.** Logout ends the session but SHALL NOT clear
  the marker (2.34), and signing back in as the same user SHALL resume recovery with the retry
  action available.
- **On a clean browser, a private window, or a different device.** Where no local marker exists,
  the **server** flag alone SHALL block routing: detection SHALL use a `supabase.auth.getUser()`
  round-trip rather than cached session claims, because `app_metadata` changes do not appear in
  an already-issued JWT, and a `true` result SHALL block routing regardless of any cached claim
  or local value (2.31, 2.36).

Ambiguity SHALL resolve toward *staying* in recovery. A malformed, unparseable or unexpectedly
typed local marker SHALL be treated as recovery **ACTIVE** and SHALL NOT be cleared or
overwritten (2.35); dropping it is rejected as fail-open, and neither its loss nor its damage
SHALL be described as fail-safe. `loadState`'s existing `removeItem` on corrupt `STORE_KEY`
SHALL continue to apply to `STORE_KEY` only and SHALL NOT be applied to the marker. Normal
routing SHALL NEVER be silently re-admitted while the server pending flag remains set — no
timeout, no attempt counter and no client-side override (2.32.2). The marker SHALL be cleared
**only** after confirmed Auth user deletion: a successful retry (2.7) clears it precisely because
it confirms that deletion, while logout (2.8), a failed retry (2.6), an account switch, corruption
and elapsed time SHALL NOT. A different user signing in SHALL ignore a marker bound to another
`<userId>`, SHALL NOT be blocked by it, and SHALL NOT delete it.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Successful and total-failure deletion paths are unchanged

_For any_ deletion response where `isBugConditionC1` does NOT hold — a `200 { success: true }`
success, or a failure with `dataRemoved: false` — the fixed code SHALL produce the same result as
the original: success still runs `purgeLocalAccountData` and signs out with the existing
media-warning toast, and total failure still leaves the account fully intact, performs no purge,
does not enter recovery, and shows the existing generic retry message. Sign-out and account
switching SHALL continue to use `purgeLocalAccountData` unchanged — including clearing
`authenticatedUser`, bumping the session generation and setting the cache-purged flag — and
demo-mode deletion SHALL continue to purge locally and report success.

Two consequences of the recovery architecture are stated explicitly so this preservation claim is
not overread. First, `purgeLocalAccountData` SHALL NOT delete the recovery marker: it removes
`STORE_KEY_V1` and `STORE_KEY` and the marker is neither, which is exactly the behaviour 2.34
requires, since logout must retain it. Second, the server-side deletion sequence is preserved
**once entered** but is no longer byte-for-byte: per 2.32 and the amended 3.17 it is now preceded
by the `app_metadata.account_deletion_pending = true` write and its entry is gated on that write
succeeding. Every step inside the sequence, and every constant governing it, is unchanged.

**Validates: Requirements 2.10, 3.7, 3.8**

Property 3: Bug Condition - Disallowed origins are refused, never reflected

_For any_ Edge Function request where `isBugConditionC2` holds (an `Origin` header not on the
`ALLOWED_ORIGINS` allowlist), the fixed function SHALL respond `403` with no
`Access-Control-Allow-Origin` header, SHALL include `Vary: Origin`, and SHALL perform no account
mutation — for `POST` the refusal SHALL occur before any authentication or admin-client work.
When `ALLOWED_ORIGINS` is unset or empty the function SHALL fail closed with `500` for every
method rather than falling back to a wildcard, and SHALL never emit
`Access-Control-Allow-Origin: '*'` under any condition.

**Validates: Requirements 2.11, 2.12, 2.13, 2.15**

Property 4: Preservation - Allowlisted and non-browser callers keep working unchanged

_For any_ Edge Function request where `isBugConditionC2` does NOT hold — an allowlisted `Origin`,
or an absent `Origin` from a non-browser client — the fixed function SHALL produce the same
outcome as the original: bearer-token verification is still required (`401` for a missing,
invalid or expired token), and a verified caller still runs the existing deletion sequence with
its **internal order and per-step semantics preserved**, including the read-only record preflight,
`begin_account_deletion`, `removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` /
`MAX_STORAGE_DEPTH = 8`, `prepare_account_deletion`, `deleteUser` with
`AUTH_DELETE_ATTEMPTS = 3`, and `cancel_account_deletion` cleanup on failure. An allowed preflight
SHALL still advertise methods `POST, OPTIONS` and headers
`authorization, apikey, content-type, x-client-info`.

**This is deliberately no longer a byte-for-byte guarantee.** C2 changes nothing inside the
sequence, but C1's clause 2.32 amends it in exactly one way: the sequence is now **preceded** by
the admin-only `app_metadata.account_deletion_pending = true` write, and entry into it is
**gated** on that write succeeding — a failed flag write means the preflight-through-`deleteUser`
sequence SHALL NOT begin, and the response SHALL report `dataRemoved: false` with the account
fully intact. What is preserved is the sequence once entered; no step is reordered, removed or
given different semantics, and the pending flag's own lifecycle afterwards (it **REMAINS** set on
Auth-deletion failure) is governed by 2.32 and 2.34.

**Validates: Requirements 2.13, 3.17**

Property 5: Bug Condition - A misconfigured production build cannot produce an artifact

_For any_ production build environment where `isBugConditionC3` holds (`VITE_SUPABASE_URL` empty,
both key variables empty, or a URL that is not HTTPS and not `localhost`/`127.0.0.1`, or not a
parseable absolute URL), the fixed build SHALL exit non-zero with a message naming the offending
variable and SHALL NOT leave a publishable artifact.

**Validates: Requirements 2.17, 2.18**

Property 6: Bug Condition - A valid build emits a complete, marker-free CSP

_For any_ production build environment where `isBugConditionC3` does NOT hold, the fixed build
SHALL emit `dist/_headers` containing a `Content-Security-Policy` directive whose sources include
the validated `https://` project origin and both the `https://` and corresponding `wss://` origin
in `connect-src`, and `dist/` SHALL contain zero occurrences of `__SUPABASE_HTTP_SRC__` or
`__SUPABASE_CONNECT_SRC__`. No real project URL or secret SHALL appear in any tracked file — the
markers, not the values, are what is committed.

**Validates: Requirements 2.16, 2.19, 2.30**

Property 7: Preservation - Existing headers, the key fallback, and the SW manifest are unchanged

_For any_ build or runtime input where `isBugConditionC3` does NOT hold, the fixed code SHALL
produce the same result as the original for everything outside the CSP line: `_headers` still
delivers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()` and
`X-DNS-Prefetch-Control: off`; a build with only `VITE_SUPABASE_ANON_KEY` still succeeds and the
client still uses that fallback; and the service worker still receives a manifest enumerating
every emitted asset, with its marker guard still throwing when markers are absent.

**Validates: Requirements 3.9, 3.10, 3.14**

Property 8: Bug Condition - No palette literal survives in a guarded file

_For any_ class-name occurrence where `isBugConditionC4` holds (a palette-literal surface, border
or text utility, including opacity variants, in `src/components/InstallPromptBanner.tsx`,
`src/components/CycleSupportSection.tsx`, `src/pages/RecordPage.tsx` or
`src/pages/TripsPage.tsx`, and not a theme-invariant accent foreground), the occurrence count in
the fixed code SHALL be zero, replaced by an existing theme token from `src/styles/index.css`;
translucent surfaces SHALL use an opacity variant of a token such as `bg-card/60`; and a
theme-invariant accent foreground SHALL be expressed as the paired foreground token such as
`text-coral-foreground` on `bg-coral`.

**Validates: Requirements 2.20, 2.21, 2.22, 2.23**

Property 9: Preservation - The light theme and the token definitions are untouched

_For any_ rendering input where `isBugConditionC4` does NOT hold, the fixed code SHALL render the
same result as the original: every surface touched by C4 looks as it does today in the light
theme, the light and dark token values in `src/styles/index.css` are byte-identical, no token is
added, renamed or redefined, `LIGHT_THEME_COLOR = '#FAF8F5'` and `DARK_THEME_COLOR = '#16181D'`
are unchanged, `prefers-color-scheme` is still honoured for a device with no stored preference,
and the three device preferences still survive sign-out and account switches.

**Validates: Requirements 3.11, 3.12, 3.13**

Property 10: Bug Condition - Build warnings are removed without behavioural change

_For any_ production build output where `isBugConditionC5` holds, the fixed build SHALL emit no
mixed static/dynamic import warning and no large-chunk warning, and its observable runtime
behaviour SHALL equal that of the original build — the `@/lib/events` call sites behave
identically, `Browser.open` stays behind the unchanged `isNativePlatform()` guard, and
`manualChunks` SHALL NOT change module evaluation order in any observable way.

**Validates: Requirements 2.24, 2.25, 2.26**

Property 11: Preservation - Dependency and lint posture is verified, not assumed

_For any_ dependency-resolution input, the fixed repository SHALL keep `react-router` and
`react-router-dom` pinned at `7.18.2` with `BrowserRouter` in declarative mode, SHALL keep
`npm run lint` at 0 errors and 0 warnings, and SHALL pin `brace-expansion` via `overrides` to
`1.1.18` — the npm-registry verification precondition is satisfied in the affirmative, so the
acceptance-recording fallback no longer applies and the lockfile SHALL NOT remain at `1.1.16`.
The pin SHALL stay on the 1.x line so `minimatch@3`'s CJS `require` shape is preserved, and
`npm run lint` at 0 errors and 0 warnings is the empirical proof that it is. The repository SHALL
NOT run `npm audit fix --force`, and SHALL record the react-router GHSA-qwww-vcr4-c8h2
conditional acceptance with its invalidation trigger in the deployment checklist.

**Validates: Requirements 2.27, 2.28, 3.15, 3.16**

Property 12: Preservation - Product functionality is untouched

_For any_ product interaction where no bug condition holds, the fixed code SHALL behave exactly as
at `7d82e3e`: schedule events (monthly calendar, six event types, multi-day ranges, D-Day,
author-only private events, active-couple sharing); the trips planner (trips, per-day items,
manual places, memos, `http(s)` links, checklists, joint editing, date-ranged record views); cycle
tracking and the opt-in minimal support signal (start, end, symptoms, memos, settings, private
calendar, next-start estimate, same-day and 24-hour bounds, 80-character message, immediate
withdrawal); record creation with photo, video and voice attachments through the two-phase upload,
still preserving body text when an attachment fails and still storing paths rather than expiring
signed URLs; couple functionality (invitation creation, redemption throttling, `pending` link
cancellation, disconnect, role switch, membership revocation, and `live`/`delayed`/`unavailable`
shared-sync status with its banner and retry); and `author_only` emotion filtering both before
write and defensively on read.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 13: Bug Condition - Operator-facing decisions are recorded and gates are executed

_For any_ deployment or review of this fix, the fixed repository SHALL document `ALLOWED_ORIGINS`
in `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` section 5 alongside `SUPABASE_SERVICE_ROLE_KEY` —
its exact comma-separated format, the fail-closed behaviour when unset, and the absent-`Origin`
allowance as an explicit accepted risk — and SHALL have executed and recorded all twelve
verification gates 2.29(a)-(l) on the working branch: `npm ci`, `npm run typecheck` at 0 errors,
`npm run lint` at 0 errors and 0 warnings, `npm test` over the full suite, `npm run build` with
non-secret placeholders and no import or chunk warnings, a negative build exiting non-zero, zero
marker tokens in `dist/`, a reported `npm audit` with every advisory covered by a recorded
decision, a clean secret scan, a clean `git diff --check`, the Deletion-Recovery Suite of
gate (k) — all nine tests required by 2.38 — passing, and the Tri-State Verification Suite of
gate (l) — all five tests required by 2.48 — passing.

**Validates: Requirements 2.14, 2.29**

Property 14: Preservation - Scope discipline holds and out-of-scope gates stay unperformed

_For any_ assessment of the delivered branch, the fixed repository SHALL preserve the declared
scope: the branch descends from `7d82e3efd1b17283b0e8f086e94cf97cf268b625` alone with the older
divergent 19-commit local branch neither merged nor cherry-picked wholesale; `capacitor.config.ts`,
the `cap:*` scripts and the Android shell are unmodified and no unrelated product feature is added;
and staging deployment, production deployment, remote application of migrations
`013_invitation_hardening.sql` / `014_feature_privacy_and_collaboration.sql` /
`015_security_followup.sql` (with the `013 → 014 → 015` order and the ambiguous duplicate `002_*`
ordering still flagged in the checklist), Edge Function deployment, setting `ALLOWED_ORIGINS` in any
remote environment, the two-account end-to-end deletion test, and any merge into the default branch
all remain unperformed and reported as human gates.

**Validates: Requirements 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25**

Property 15: Bug Condition - Deletion status is tri-state, and `unknown` is never `clear`

_For any_ evaluation of deletion status from the pair (local-marker state, authoritative `getUser()`
outcome), the fixed `classifyDeletionStatus` resolver SHALL return **exactly one** of `pending`,
`clear` or `unknown`: the classification is **total** — each of the nine combinations of marker state
(absent, valid positive, malformed) × authoritative outcome (`pending`, not pending, cannot complete)
maps to some state — and **mutually exclusive** — none maps to two. Evaluation SHALL be ordered so
that a positive local marker, **including a malformed, unparseable or wrongly-typed one**, outranks a
`clear` server answer: the pair (marker present, server reports not pending) resolves to `pending`,
because the marker is cleared only after confirmed Auth user deletion and a `clear` answer is not
that confirmation. Cached session claims SHALL never produce `clear`.

_For any_ input classified `pending`, the fixed code SHALL block every normal application route —
`/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips`, `/service` — and render the
recovery screen **always and unconditionally, including during offline startup** where no server
round-trip is possible; `pending` derived from the local marker alone SHALL block **before the first
render** and SHALL NOT wait on the network, so no window exists in which a `pending` device shows the
normal app. _For any_ malformed marker, classification SHALL be `pending` and **no read path** — the
status evaluator, `loadState`, a migration, a startup sanity check or an error handler — SHALL
remove, overwrite, normalise or repair it; reading is strictly non-destructive, `loadState`'s
existing `removeItem` (`store.tsx:103-116`) continuing to apply to `STORE_KEY` alone, and removal
occurring solely on the confirmed-Auth-deletion write path.

_For any_ input classified `clear`, the fixed code SHALL permit normal routing and normal application
behaviour exactly as at `7d82e3e` for a signed-in account with no deletion outstanding.

_For any_ input classified `unknown`, the value SHALL NOT be represented, stored, cached, serialized
or logged as `clear`, as `false`, as `null`, or by omitting the field, and the distinction SHALL
survive **in the type** rather than in prose: a three-variant discriminated union declared in
`src/lib/accountDeletion.ts` and exposed through `StoreContextType`, with exhaustiveness enforced at
compile time by a `never`-checked switch, and with `boolean`, `boolean | null`, `boolean | undefined`,
optional fields and nullable flags defaulted to `false` all rejected — a representation that collapses
`unknown` into `clear` SHALL fail to type-check. Every cache, persisted value, telemetry event and log
line recording deletion status SHALL emit a **distinct token** for `unknown`.

_For any_ `unknown` with no positive recovery evidence, the fixed code MAY continue through the
existing offline path, preserving the offline-first behaviour of `7d82e3e`. This is a **deliberate
availability tradeoff and explicitly NOT a fail-closed guarantee**, and it SHALL NOT be named or
described as safe, fail-safe or verified in this spec, the design, code comments or test names. It
SHALL NOT be treated as settled: `unknown` SHALL NOT be cached as a resolved answer, SHALL NOT be
promoted to `clear` by elapsed time, retry-count exhaustion or an unrelated successful request, and
SHALL NOT be skipped on later attempts — every transition out of `unknown` SHALL come from an
authoritative answer or a positive local marker and from nothing else.

_For any_ server synchronization or server mutation about to be issued while status is `unknown`, the
authoritative check SHALL be **retried first, before the request is sent**. _For any_ such retry that
returns `pending`, the fixed code SHALL abort that synchronization or mutation with **none of its
writes applied** — no server state modified and no queued mutation delivered — purge local account
content immediately, and enter recovery, all **before** the attempt is allowed to proceed; the attempt
SHALL NOT be permitted to run first and be reconciled afterwards, and aborting SHALL NOT be deferred
to the next cycle.

**Validates: Requirements 2.39, 2.40, 2.41, 2.42, 2.43, 2.44, 2.45, 2.46, 2.47, 2.48**

---

## Fix Implementation

### Changes Required — C1

**New file**: `src/lib/accountDeletion.ts`

Pure, dependency-free classification so it is testable without a Supabase client:

```
TYPE AccountDeletionOutcome =
  | { status: 'deleted';            dataRemoved: true;  warnings: string[] }
  | { status: 'partially_deleted';  dataRemoved: true;  warnings: string[] }
  | { status: 'failed';             dataRemoved: false; warnings: string[] }

FUNCTION classifyDeletionSuccess(body)        -> 'deleted' when body.success = TRUE, else failed
FUNCTION classifyDeletionErrorBody(body)      -> 'partially_deleted' when body.dataRemoved = TRUE,
                                                 else 'failed'
FUNCTION coerceWarnings(body)                 -> string[] (defensive, mirrors supabase.ts:355)
```

**File**: `src/lib/supabase.ts` — **Function**: `deleteAccountFromDB`

1. **Read the error body.** On `error`, detect `FunctionsHttpError` and `await error.context.json()`
   inside a `try`. `context` is a `Response` whose body may be consumed only once, so read it
   exactly once and pass the parsed value onward. A relay/fetch error (no `context`) or a parse
   failure classifies as `failed` per 2.2 — never as a fabricated partial deletion.
2. **Return the union.** Change the signature to `Promise<AccountDeletionOutcome>`. Keep the
   existing explicit `data?.success !== true` check as the `deleted` gate so success is never
   inferred from the absence of a transport error.
3. **Keep logging.** The existing `console.error` calls stay, so operator-visible diagnostics do
   not regress.

**File**: `src/lib/store.tsx`

4. **New partial purge**, alongside and not replacing `purgeLocalAccountData`:
   `purgeLocalContentRetainingIdentity(expected)`. It applies exactly the 2.4 key-level split:
   - `localStorage.removeItem(STORE_KEY_V1)`; rewrite `STORE_KEY` through the existing
     `saveState` path so only `carryOverDevicePrefs` persists. `carryOverDevicePrefs`
     (`store.tsx:197-203`) is left **exactly as at `7d82e3e`** (3.11) — the recovery marker does
     not go through it.
   - Write the recovery marker to its own key (item 5), which is a separate `localStorage.setItem`
     that does not touch `STORE_KEY`.
   - Retain `authenticatedUser` (identity is required to retry) and the `sb-*` session keys — no
     sign-out is performed.
   - Replace in-memory state with `{ ...DEFAULT_STATE, isDemoMode: false,
     ...carryOverDevicePrefs(current), authenticatedUser: current.authenticatedUser }`, clearing
     `records`, `events`, `trips`, all five `profile` fields, `setupComplete`, `onboardingStep`
     and `highlightedRecordId`. This is where the real exposure lives, because `saveState`
     already persists only the device-preference whitelist for an authenticated session.
   - Set `cachePurgedRef.current = true` and keep `hydratedUserIdRef.current` pinned to the
     retained user id so the save effect cannot resurrect the cache and the hydration effect
     cannot re-fetch data that no longer exists. Do **not** bump `sessionGenerationRef` — the
     session is deliberately kept.
5. **Recovery state in the store.** Add
   `accountDeletionRecovery: { warnings: string[] } | null` to `StoreContextType`
   (`src/lib/storeContext.ts`) and to the provider value, plus `retryAccountDeletion()` and reuse
   of the existing `signOut()` for the logout action. One authoritative flag; no consumer infers
   recovery from route or toast state. The **`warnings` array stays in memory only**, because
   warning strings can name storage paths.
6. **`deleteAccount` rewrite.** Return `AccountDeletionOutcome`. Keep the demo-mode short-circuit
   and the `isCurrentIdentity(identity)` guard at line 1682 exactly as they are, then branch:
   `deleted` → existing `purgeLocalAccountData` + `signOut` (unchanged path, per 3.7), then clear
   the recovery marker because Auth deletion is now confirmed;
   `partially_deleted` → write the recovery marker, then `purgeLocalContentRetainingIdentity`, then
   set recovery state;
   `failed` → return unchanged, no purge, no recovery, no marker.
7. **Retry semantics.** `retryAccountDeletion` re-invokes the same path. `deleted` clears the
   marker, clears recovery state, purges identity and signs out (2.7) — the marker is removed only
   in this branch, because only this branch confirms Auth deletion. `partially_deleted` or
   `failed` stays in recovery, leaves the marker in place, and re-fetches nothing (2.6).
8. **`purgeLocalAccountData` is left unchanged and MUST NOT delete the marker.** It removes
   `STORE_KEY_V1` and `STORE_KEY` (`store.tsx:1649-1650`) and the marker is neither, so the
   existing function already has the right behaviour by construction — but this is recorded
   explicitly because it looks like an omission. It is not: logout **retains** the marker (2.34),
   so a purge path that also removed it would reintroduce the fail-open bypass. Marker removal
   lives in exactly one place, the confirmed-deletion branch of item 6/7, and `signOut`
   (`store.tsx:1661`) calls `purgeLocalAccountData` without touching it.

**New module boundary**: recovery-marker access

9. **A single, small marker module** — colocated in `src/lib/accountDeletion.ts` so it is pure and
   unit-testable without a store or a Supabase client:

```
CONST RECOVERY_KEY_PREFIX = 'gomsinlog.accountDeletionRecovery.v1.'

FUNCTION recoveryKeyFor(userId)        -> RECOVERY_KEY_PREFIX + userId
FUNCTION markRecoveryPending(userId)   -> localStorage.setItem(recoveryKeyFor(userId), 'true')
FUNCTION readRecoveryMarker(userId)    -> 'absent' | 'active'
    raw := localStorage.getItem(recoveryKeyFor(userId))
    IF raw IS NULL THEN RETURN 'absent'
    // Anything present but not exactly the expected boolean marker is MALFORMED,
    // and malformed means ACTIVE. There is no third answer and no removal path.
    RETURN 'active'
FUNCTION clearRecoveryMarker(userId)   -> called ONLY after confirmed Auth user deletion
```

   Design points that are load-bearing rather than stylistic:
   - **Boolean only.** No warnings, no storage paths, no profile/couple/record/event/trip content
     is ever written to this key (2.33).
   - **Per-user key.** The `<userId>` suffix binds the marker to one account, so another user is
     neither blocked by it nor able to clear it (2.34). A reader only ever consults the key for
     the currently signed-in `userId`; it never enumerates `localStorage`.
   - **No parse-and-discard path.** `readRecoveryMarker` deliberately has no branch that returns
     `'absent'` for an unparseable value and no branch that calls `removeItem`. A present-but-
     malformed value is **ACTIVE** (2.35). This is the one place where a well-meaning
     "clean up bad data" reflex would reintroduce the fail-open defect, so it is called out here.
   - **Never described as fail-safe.** Losing this marker is a *failure*, mitigated only by the
     server flag. The sole fail-safe direction is staying in recovery.

   **Privacy note (2.37).** Writing `<userId>` into a key that outlives the session **is**
   persisting a pseudonymous identifier, and the fact that the signed-in session already held that
   UUID does not make retaining it past logout costless. No "this adds no new data category"
   reasoning is relied on. The justification is narrow and stated in full: the Supabase user UUID
   is the **minimum identifier necessary** to complete the deletion the user themselves requested,
   it is required to bind the marker to exactly one account so a second user is neither blocked
   nor able to clear it (2.34), it is retained for no other purpose, and it is deleted once Auth
   user deletion is confirmed (2.34, 2.37). Nothing else about the account is written alongside
   it.

**File**: `supabase/functions/delete-account/index.ts` — the primary authority (2.31, 2.32)

10. **Write the pending flag with the admin API, before any data deletion.** The service-role
    client already exists at `index.ts:164-166` (`createClient(supabaseUrl, serviceRoleKey, …)`),
    and the caller is already verified at `:168-172` via `admin.auth.getUser(token)`. The new
    write goes **immediately after that verification and immediately before the `try` block that
    opens the deletion sequence at `:178`** — that is, after `const userId = user.id;` (`:174`)
    and **before** the read-only `daily_records` preflight (`:180-185`) and before
    `begin_account_deletion` (`:191-195`). Placing it before the preflight rather than between the
    preflight and `begin_account_deletion` is deliberate: 2.32 makes the flag a hard gate on
    *anything* that touches the account, and the preflight also establishes the expected record
    id set that the transactional RPC is later held to. Being outside the `try` block is also
    deliberate: the existing `catch` at `:262` runs `cancel_account_deletion` and reports
    `dataRemoved: databasePreparationCompleted` (`:290`), neither of which is the right response
    to a flag-write failure, so this step returns its own response directly.

```
// after: const userId = user.id;   (index.ts:174)
const { error: pendingFlagError } = await admin.auth.admin.updateUserById(userId, {
  app_metadata: { ...(user.app_metadata ?? {}), account_deletion_pending: true },
});
if (pendingFlagError) {
  // Step 2 of 2.32 failed -> step 3 MUST NOT BEGIN.
  console.error('[delete-account] Could not record pending deletion; nothing was deleted',
                pendingFlagError);
  return jsonResponse({
    error: 'Account deletion could not be started. Please try again.',
    dataRemoved: false,
    warnings: [],
  }, 500, corsFor(request));   // headers per C2
}
```

    - **`updateUserById` is the admin API**, reachable only through the service-role client, so
      `app_metadata` remains non-writable by any client (2.31). `user_metadata` is **not** used:
      it is client-writable and would let a browser clear its own recovery flag.
    - **`app_metadata` is replaced wholesale, not merged, by the Auth API.** The existing
      `user.app_metadata` — already in hand from the `getUser(token)` call at `:164` — is spread
      first so `provider` and `providers` survive. This matters beyond tidiness:
      `store.tsx:397` reads `sessionUser.app_metadata?.provider` to build `AuthUser`, so dropping
      it would silently change the rendered sign-in provider.
    - **Robust to a partially-succeeded update.** The write is a single idempotent `PUT` of one
      boolean, so the only outcomes are "flag set" and "flag not set" — there is no half-set
      value. The dangerous case is an ambiguous one: a network timeout where the write may or may
      not have landed. That is treated as **failure of step 2**, which by 2.32.1 forbids step 3,
      so the worst outcome is a flag set on an account whose data is fully intact. That state is
      then resolved by the *next* attempt: the retry re-writes the same `true` value (idempotent),
      proceeds, and completes the deletion. A flag set with no data removed therefore blocks
      routing for a user who has asked to be deleted and whose deletion will complete on retry —
      conservative in the correct direction.
11. **Failure after the flag was set (step 3 of 2.32).** The flag **remains**. The existing `catch`
    at `:262-283` already calls `cancel_account_deletion` (`:269`) to release migration 015's
    upload block;
    that stays exactly as it is and must **not** be confused with clearing the pending flag — they
    are different markers with opposite lifecycles, which is why the glossary separates them.
    - **Preferred resolution: idempotent retry.** The existing sequence is already retry-safe by
      design (the preflight re-reads the record set and `prepare_account_deletion` fails closed if
      it changed, and `removeAndConfirmRecordMedia` re-enumerates rather than trusting a removal
      response), so a retry after a data-deletion failure re-runs cleanly and the flag needs no
      compensation.
    - **Compensating update, if one is implemented at all.** It SHALL clear the flag *only* when it
      has positively verified that no application data was removed — i.e. `daily_records` for the
      user still matches the preflight set, `databasePreparationCompleted` is `false`, and the
      media confirmation pass reported nothing removed. Clearing speculatively, on a timeout, on
      an unknown error, or on any assumption is forbidden (2.32.1). This is flagged in the
      residual-risk list as the hardest part of the design to get right, and it is **not**
      required for correctness: the retry path above is sufficient, so a compensating update
      SHALL NOT be written speculatively just to have one.
12. **Auth deletion success is what clears the flag — implicitly.** When `deleteUser` succeeds the
    Auth user no longer exists, so its `app_metadata` is gone with it. There is no separate
    flag-clearing call on the success path, and there SHALL NOT be one: adding a "clear the flag"
    step would create a window in which the flag is `false` while the user still exists.

**File**: `src/lib/store.tsx` — detection on login and session restoration (2.36)

13. **Where the check sits.** The auth bootstrap is the `supabase.auth.onAuthStateChange`
    subscription at `store.tsx:362`, inside the `useEffect` gated on `isHydrated`. Its async body
    already, for a `session?.user`: builds `authUser` from `sessionUser.app_metadata?.provider`
    (`:400-405`), short-circuits `TOKEN_REFRESHED` / `USER_UPDATED` for the already-hydrated user
    (`:407-413`), then awaits `fetchFullStateFromDB` under `withTimeout(…, AUTH_SYNC_TIMEOUT_MS,
    FULL_STATE_UNAVAILABLE)` (`:423-427`) and finally sets `setIsAuthChecked(true)` in the
    `finally` (`:516-522`). The recovery check is inserted **in that async body, after `authUser`
    is built and after the `TOKEN_REFRESHED` / `USER_UPDATED` short-circuit, and before the
    `fetchFullStateFromDB` await**:
    - **Synchronously first**, read the local marker for `sessionUser.id`. If it is `'active'`,
      set `accountDeletionRecovery` immediately. This is the instant/offline/reload guard and
      costs no network time, so the `App.tsx` gate is authoritative on first paint.
    - **Then the server round-trip.** Call `supabase.auth.getUser()` and read
      `data.user?.app_metadata?.account_deletion_pending`. Per 2.36 this SHALL NOT read
      `session.user.app_metadata`, because the session's JWT was issued before the flag was
      written and would report the stale value on exactly the reload that must catch it. A `true`
      result sets recovery **regardless** of the local marker or any cached claim, and also writes
      the local marker so the next reload is instant.
    - **`INITIAL_SESSION` is covered by the same path**, because that event also arrives with
      `session?.user` populated for a restored session and therefore runs the same async body; the
      separate no-session `INITIAL_SESSION` branch at `:539` needs no change, as there is no user
      to check.
14. **The round-trip must not deadlock offline startup.** `getUser()` is wrapped in the existing
    `withTimeout(…, AUTH_SYNC_TIMEOUT_MS, fallback)` helper from `src/lib/async.ts`, the same
    mechanism the surrounding code already uses so a hanging fetch cannot keep the app behind the
    splash spinner. On timeout or network failure the fallback is **"no server answer"**, not
    "not pending": the local marker's verdict stands, `setIsAuthChecked(true)` still runs in the
    `finally`, and the check is retried on the next auth event. An offline user with a marker
    stays in recovery; an offline user without one is not fabricated into recovery, which is the
    honest limit of an offline device and the reason the local marker exists at all.
15. **Retry from the recovery screen re-invokes the Edge Function**, which re-writes the same
    `true` flag idempotently before re-attempting deletion, so nothing special is needed for the
    retry path.

**File**: `src/App.tsx`

16. **Route gate.** When `accountDeletionRecovery` is non-null, render only the recovery screen for
    every path except `/auth/callback` and `/legal/:doc`, which must stay reachable. The gate sits
    **immediately before the existing `authSyncUnavailable` branch** (`App.tsx:80-90`), reusing an
    established pattern rather than inventing routing, and taking precedence over it: a sync
    outage must not replace the recovery screen with a retry-sync screen that offers no path to
    completing the deletion. Both branches sit after the `!isReady` spinner, so no authenticated
    route can render before `isReady` is true.
17. **No override.** There is no timeout, attempt counter, "continue anyway" affordance or query
    parameter that re-admits a blocked user to `/`, `/record`, `/schedule`, `/us`, `/my`,
    `/settings`, `/trips` or `/service` (2.32.2).

**File**: `src/pages/SettingsPage.tsx`

18. **Honest messaging.** Replace the generic toast at line 765 **for the `partially_deleted`
    outcome only**: state that the user's data has been deleted but the login account has not, and
    that deletion must be completed. `failed` keeps
    `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.`; `deleted` keeps its existing
    `media_not_fully_removed` warning toast.

**File**: `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`

19. **Operator note.** Record that `app_metadata.account_deletion_pending` is now written by the
    Edge Function, that it is intentionally left set on Auth-deletion failure, and that an
    operator who clears it by hand is re-admitting a user to an app whose data is gone. There is
    **no server-confirmed cancellation workflow** today (2.34), and this fix does not add one.

**Tri-state deletion status (2.39-2.48)**

Items 13-14 above describe *where* the authoritative check runs. Items 20-25 describe the **type**
that carries its outcome, because 1.28's defect is representational: at `7d82e3e` a check that could
not complete and a check that answered "not pending" are the same value.

20. **The union and the resolver, in `src/lib/accountDeletion.ts`** (the same new pure module as
    items 1 and 9, so the resolver is exhaustively unit-testable with no network, no store and no
    Supabase client):

```
// Three variants. Not two, and not two-plus-a-null.
export type DeletionStatus =
  | { kind: 'pending' }
  | { kind: 'clear' }
  | { kind: 'unknown' }

// Inputs are the two independent authorities, each already three-valued.
export type MarkerState  = 'absent' | 'active'                    // 'active' includes MALFORMED (2.35, 2.41)
export type ServerAnswer =
  | { kind: 'pending' }        // getUser() answered: app_metadata.account_deletion_pending = true
  | { kind: 'not_pending' }    // getUser() answered: flag absent or false
  | { kind: 'unavailable' }    // getUser() could NOT complete: reject, timeout, offline (NOT an answer)

// Pure. Total. Ordered exactly as the 2.39 table.
export function classifyDeletionStatus(
  marker: MarkerState,
  server: ServerAnswer,
): DeletionStatus {
  // Order 1 — a positive marker OUTRANKS a clear server answer (2.39).
  if (marker === 'active') return { kind: 'pending' }
  if (server.kind === 'pending') return { kind: 'pending' }
  // Order 2 — an authoritative negative, with no positive marker.
  if (server.kind === 'not_pending') return { kind: 'clear' }
  // Order 3 — no answer, no marker. This is NOT 'clear'.
  if (server.kind === 'unavailable') return { kind: 'unknown' }
  return assertNever(server)   // compile-time totality over ServerAnswer
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled deletion-status variant: ${JSON.stringify(value)}`)
}
```

    - **`MarkerState` has no `'malformed'` variant on purpose.** `readRecoveryMarker` (item 9)
      already collapses every present value to `'active'`, so there is no branch in which a
      malformed value could be routed anywhere except `pending`, and no branch that could call
      `removeItem`. The nine combinations required by 2.48 test 1 are exercised by feeding the
      resolver the three *observable* marker states (absent / valid positive / malformed) through
      `readRecoveryMarker`, so the mapping malformed → `'active'` → `pending` is asserted end to
      end rather than assumed. 2.41's prohibition is enforced structurally: `classifyDeletionStatus`
      takes a `MarkerState` **value**, not the key or the storage object, so it is physically unable
      to remove, overwrite, normalise or repair anything.
    - **Forbidden representations, named so a reviewer can reject them on sight** (2.43):
      `boolean`, `boolean | null`, `boolean | undefined`, `deletionPending?: boolean`, a nullable
      flag defaulted to `false`, an enum-like bare string union that a caller can `!`-negate, and any
      "absent means fine" convention. `StoreContextType` (`src/lib/storeContext.ts:12-47`) exposes
      `deletionStatus: DeletionStatus` — **required, not optional** — so there is no default-value
      substitution that can turn a missing answer into a negative one.
    - **Compile-time exhaustiveness** is the `assertNever` above plus a `never`-checked `switch` at
      each consumer (the `App.tsx` gate of item 16 and the pre-flight gate of item 21). A fourth
      state, or an unhandled `unknown`, is then a type error rather than a silent fall-through into
      permissive behaviour.
    - **`withTimeout` is where the old code collapsed the states, and where the fix lands.**
      `withTimeout` (`src/lib/async.ts:7-32`) resolves the *caller's own fallback* on **both**
      timeout (`async.ts:10-16`) and rejection (`async.ts:26-31`), so the fallback's **type is the
      representation**. The `getUser()` call of item 13 is therefore wrapped as
      `withTimeout(getUser(), AUTH_SYNC_TIMEOUT_MS, { kind: 'unavailable' } as ServerAnswer)` — the
      fallback is `unavailable`, never `not_pending`. This single argument is the load-bearing line
      of the tri-state fix; passing `false` there would reintroduce 1.28 exactly.

21. **Where the pre-sync / pre-mutation re-verification gate lives (2.45).** One new
    `StoreProvider`-internal helper, `ensureNotPendingBeforeServerCall()`, returning
    `Promise<DeletionStatus>`. It re-issues the authoritative check of item 13 and, on `pending`,
    performs the abort of item 22. It is placed at the top of the **existing** entry points named
    below — in the same position as the guards those functions already have — so it always runs
    **before the first `await` that issues a request**:

    **Synchronization entry points** (verified in `src/lib/store.tsx`):
    - `refreshSlice(slice)` — `store.tsx:771`. The realtime slice refresher, reached from
      `scheduleRefresh` (`store.tsx:839-850`), which the three channel handlers call at
      `store.tsx:918`, `:924` and `:934`. The gate goes immediately after the existing
      `if (!isCurrentActiveCouple()) return;` at `store.tsx:772` and **before** the
      `isWorkspaceQuarantined()` branch at `:775-778`, so the quarantine branch's call into
      `reconcileSharedAccess` is also covered by the same decision.
    - `reconcileSharedAccess(workspace)` — `store.tsx:665`. The authoritative membership check plus
      full RLS-backed re-read of every shared slice. It is the single funnel for
      `reconcileOwnMembership` (`store.tsx:852-855`), the `scheduleRecovery` poll
      (`store.tsx:869-891`), the `visibilitychange` / `online` handler (`store.tsx:965-970`) and
      `retrySharedAccessRef.current` (`store.tsx:893-899`) — which is what the context-exposed
      `retrySharedAccess` (`store.tsx:1899`) invokes. The gate goes immediately after the existing
      `if (!client || !canReconcile()) return false;` at `store.tsx:670`, before
      `++membershipReconciliationRef.current` at `:672` and before the first request,
      `client.rpc('get_my_active_couple_id')` at `store.tsx:679`.
      **`window.addEventListener('online', handleVisibility)` (`store.tsx:970`) is the concrete path
      by which the offline secondary device of 2.47 comes back and is caught**: connectivity returns,
      `handleVisibility` calls `reconcileOwnMembership`, the gate runs first, and the deletion is
      discovered before any read or write.
    - The initial hydration sync in the `supabase.auth.onAuthStateChange` async body
      (`store.tsx:362`), whose read is
      `withTimeout(fetchFullStateFromDB(sessionUser.id), AUTH_SYNC_TIMEOUT_MS, FULL_STATE_UNAVAILABLE)`
      at `store.tsx:423-427`. **No second gate is added here.** The check of item 13 already sits in
      that body before this `await`; item 20 changes only the type of its outcome, from a boolean to
      `DeletionStatus`.

    **Mutation entry points** — every server-mutating method on `StoreContextType`
    (`src/lib/storeContext.ts:20-38`). In each, the gate goes into the synchronous preamble the
    function already has, immediately after the existing identity capture and **before the first
    awaited network call**:
    | Method | Existing capture | First request the gate precedes |
    | --- | --- | --- |
    | `addRecordWithMedia` (`store.tsx:1155`), and `addRecord` (`:1142`) through it | `captureLinkedCouple()` `:1189` | `saveRecordToDB` `:1205` |
    | `updateRecord` (`:1284`) | `captureLinkedCouple()` `:1308` | `saveRecordToDB` `:1311` |
    | `deleteRecord` (`:1346`) | `captureLinkedCouple()` `:1358` | `deleteRecordFromDB` `:1361` |
    | `addEvent` (`:1380`) | `captureLinkedCouple()` `:1383` | `saveEventToDB` (`src/lib/events.ts:60`) |
    | `updateEvent` (`:1411`) | `captureActiveIdentity()` `:1415` | `updateEventInDB` (`events.ts:100`) |
    | `deleteEvent` (`:1462`) | `captureActiveIdentity()` `:1463` | `deleteEventFromDB` (`events.ts:134`) |
    | `reloadEvents` (`:1494`) | `captureActiveIdentity()` `:1498`, `captureLinkedCouple()` `:1502` | `fetchEventsResultFromDB` `:1515` |
    | `cancelPendingLink` (`:1574`) | `captureLinkedCouple()` `:1575` | `disconnectCoupleFromDB` `:1584` |
    | `disconnect` (`:1595`) | — | `disconnectCoupleFromDB` `:1616` |

    - **`updateProfile` (`store.tsx:1089`) needs a shape change, and this is called out rather than
      glossed.** It is synchronous and issues three fire-and-forget writes —
      `supabase.from('profiles').update(...)` at `store.tsx:1104`,
      `supabase.from('contact_preferences').upsert(...)` at `:1119`, and `saveCoupleAnniversary` at
      `:1138`. To gate them the network portion moves behind
      `await ensureNotPendingBeforeServerCall()`, which makes the *issuing* asynchronous. The
      synchronous `updateStateImmediately` at `:1094-1097` and the deliberate pre-computation of
      `newProfile` outside the updater at `:1092-1093` (kept for the React StrictMode
      double-invocation reason documented in the comment at `:1090-1092`) are both left exactly as
      they are. If the gate aborts, the optimistic local update is discarded anyway, because the
      purge of item 22 replaces state wholesale.
    - **Deliberate exemptions.** `deleteAccount` (`store.tsx:1672`), `retryAccountDeletion` (item 7)
      and `signOut` (`store.tsx:1661`) are **not** gated. They are the paths *out* of a pending
      deletion; gating them on "is a deletion pending" would trap the user in recovery with no way
      to complete or leave. `deleteAccount`'s existing demo short-circuit and
      `isCurrentIdentity(identity)` guard (`store.tsx:1678-1685`) are unchanged.

22. **Abort-and-purge when the retry returns `pending` (2.46).** `ensureNotPendingBeforeServerCall`
    calls one new helper, `abortForPendingDeletion(identity)`, which runs **synchronously with
    respect to the caller's first request** — the caller `return`s on the gate's non-`clear` result
    and never reaches its request:
    1. `markRecoveryPending(userId)` (item 9) — write the local marker first, so the verdict is
       durable across a reload and does not depend on repeating the round-trip.
    2. `purgeLocalContentRetainingIdentity(identity)` — the **existing partial-purge path of item 4**,
       reused unchanged. Content goes, identity and session stay, `carryOverDevicePrefs`
       (`store.tsx:197-203`) is untouched.
    3. Set `accountDeletionRecovery` (item 5), which makes the `App.tsx` gate of item 16 block every
       normal route on the next render.
    4. Bump `membershipReconciliationRef.current` and `clearRecovery()` (`store.tsx:867-870`), and
       clear the `timers` debounce map (`store.tsx:842-849`, the same clearing the teardown already
       does at `:978-979`), so nothing deferred can fire afterwards.
    5. Return `{ kind: 'pending' }`, on which every gated caller returns its existing failure value
       (`false`, or the `staleResult` shape at `store.tsx:1200-1204`) without issuing anything.

    **How "none of its writes applied" is actually achieved, given the real code structure** — this
    is the claim most worth being concrete about:
    - **The shared-sync paths are read-only.** `refreshSlice` and `reconcileSharedAccess` issue only
      `rpc('get_my_active_couple_id')` (`store.tsx:679`) and the three `fetch*ResultFromDB` SELECTs
      (`store.tsx:698-702`, `:788`, `:808`, `:820`; `records.ts:93`, `events.ts:8`, `trips.ts:144`).
      They modify **no server state at all**, so for these paths "none of its writes applied" is a
      statement about their *local* writes — `updateStateImmediately` at `store.tsx:800-804` and
      `:812-814`, and `replaceStateImmediately` at `:719` — every one of which is **downstream of the
      awaited fetch**. Returning at the gate, before that first `await`, means none of them runs, so
      no fetched row can be applied to state after the purge.
    - **The mutation paths issue exactly one request chain each**, and the gate precedes the first
      `await` in every one (table above), so the request is never sent and the server is never
      touched. `addRecordWithMedia`'s two-phase upload — row insert at `:1205`, media upload at
      `:1225`, metadata patch at `:1239`, a sequence required by the storage RLS policy — is aborted
      at phase zero, so there is no orphaned `daily_records` row and no orphaned storage object.
    - **"No queued mutation delivered" is achievable because there is no outbox at `7d82e3e`.**
      Verified: `src/lib/` contains no queue, outbox or pending-write module; every mutation is
      issued directly by the store methods above. The only deferred work in the store is two
      `window.setTimeout` schedulers, **both read-only**: the per-slice debounce map `timers`
      (`store.tsx:842-849`) and `recoveryTimer` (`store.tsx:869-891`). Step 4 cancels both. Anything
      already in flight when the abort happens is discarded rather than applied, because the
      revision bump makes its own existing guards fail — `isCurrentRefresh()` (`store.tsx:779-782`)
      and `isLatestCurrentWorkspace()` (`store.tsx:673-676`) both compare
      `membershipReconciliationRef.current` against the value captured at entry. So the race is
      handled by machinery that already exists, not by a new lock.
    - **Forward constraint.** This argument depends on there being no outbox. If a persistent
      mutation queue is ever added, 2.46 requires a drain-blocking gate at its drain point too, and
      this design note is where that obligation is recorded.

23. **How `unknown` is prevented from being cached as settled (2.45).**
    - **It cannot reach `localStorage` by construction.** `saveState` persists only the
      `carryOverDevicePrefs` whitelist (`store.tsx:128`, `:197-203`), which is left exactly as at
      `7d82e3e` (3.11) and contains no deletion field. `DeletionStatus` lives in React state and a
      ref, and is never added to `AppState`.
    - **The gate never reads a cached verdict.** `ensureNotPendingBeforeServerCall` re-issues
      `getUser()` on **every** entry. The ref holding the last observed status is used for rendering
      and logging only, never as a decision input, so there is no code path in which elapsed time,
      an exhausted retry counter or an unrelated successful request can stand in for an answer.
    - **There is no promotion path.** The only writers of `DeletionStatus` are `classifyDeletionStatus`
      (item 20) and the marker read of item 9. No `if (attempts > n) status = clear`, no expiry, no
      `??` default, no `||` fallback — every transition out of `unknown` comes from an authoritative
      answer or a positive marker, and there is nowhere else it could come from.
    - **Serialization and logging use a distinct token.** Anything that records status emits
      `deletion_status=pending` / `=clear` / `=unknown`; never `false`, `null`, `"clear"`, or an
      omitted field. `withTimeout`'s existing generic
      `[gomsinlog] operation timed out after ${ms}ms, continuing with fallback` warning
      (`src/lib/async.ts:13`) is **not** an acceptable sole trace, because it does not say which
      question went unanswered — the gate logs its own `unknown` line as well.

24. **Tri-state status and sync status are different axes, and are never conflated.** Stated
    explicitly because the codebase already has two availability-shaped values and reusing either
    would recreate 1.28:
    | Value | Where | What it means |
    | --- | --- | --- |
    | `SharedSyncStatus` = `'live' \| 'delayed' \| 'unavailable'` | `src/lib/storeContext.ts:10`, `:17` | How fresh the **shared couple workspace** on screen is |
    | `authSyncUnavailable: boolean` | `src/lib/storeContext.ts:16`, set from `FULL_STATE_UNAVAILABLE` at `store.tsx:446-447` | Whether **initial account hydration** succeeded |
    | `DeletionStatus` = `pending \| clear \| unknown` | new, `src/lib/accountDeletion.ts` | Whether **this account is being deleted** |

    They are orthogonal in both directions, and the combinations are all reachable: a perfectly
    `live` workspace can coexist with `pending` (the flag was set moments ago); `unavailable` does
    **not** imply `unknown` (a local marker yields `pending` while sync is down); and `unknown` does
    **not** imply `unavailable` (a `getUser()` failure alongside healthy Postgres reads). Therefore no
    existing field is reused, no existing union is widened, `FULL_STATE_UNAVAILABLE` (`src/lib/sync.ts:9`)
    keeps its current meaning of a retryable sync outage, and `setSharedSyncStatus` calls
    (`store.tsx:376`, `:604`, `:637`, `:724`) are untouched. Where the two axes meet is precedence
    only: per item 16 the recovery gate takes priority over the `authSyncUnavailable` branch
    (`App.tsx:80-90`), so a sync-outage screen never hides recovery.

25. **`unknown` continues offline, and that is an availability tradeoff — not a safety property
    (2.44).** When status is `unknown` and there is no positive marker, the existing offline path of
    `7d82e3e` continues: `setIsAuthChecked(true)` still runs in the `finally` at `store.tsx:516-522`,
    the splash releases, and locally held data stays visible. This is chosen so an offline user with
    no deletion outstanding is not stranded. It is **not** fail-closed, it is **not** verified, and it
    SHALL NOT be named or commented as safe, fail-safe or verified anywhere — identifiers and test
    names use `unknown` / `unverified`, never `safe` or `ok`. It is bounded on both sides: item 21
    forces the authoritative retry before the next server contact, and item 22 forces the
    abort-and-purge if that retry says `pending`. The residual exposure is recorded as risk item 7.

### Changes Required — C2

**New file**: `supabase/functions/_shared/cors.ts`

```
FUNCTION parseAllowedOrigins(raw)   -> trimmed, non-empty, de-duplicated exact origins
FUNCTION resolveCors(method, origin, allowlist) -> {
  configured: boolean,          // false when allowlist is empty  -> row (g)
  allowed: boolean,
  headers: Record<string,string>  // always includes 'Vary: Origin'
}
```

`resolveCors` is a pure function of its three arguments and MUST NOT reference `Deno` at module
scope — that is what lets `src/lib/cors.test.ts` import it under vitest/Node. `Deno.env.get('ALLOWED_ORIGINS')`
is read in `index.ts` and passed in. Matching is exact string equality on the `Origin` value; no
wildcards, no suffix matching, no `Access-Control-Allow-Origin: '*'` anywhere in the module.

**File**: `supabase/functions/delete-account/index.ts`

1. **Delete the wildcard constant** at lines 18-22 and make `jsonResponse` take the resolved
   headers as a parameter, so a wildcard cannot be reintroduced by forgetting to pass them.
2. **Implement the 2.13 decision table** at the top of `Deno.serve`, in this order: read
   `ALLOWED_ORIGINS`; if unconfigured return `500` (row g) for every method; then for `OPTIONS`
   return `200` with the exact reflected origin (a), `403` (b), or `200` with no reflection when
   `Origin` is absent (c); then for `POST` return `403` before any auth work when the origin is
   disallowed (e), else fall through (d, f).
3. **`Vary: Origin` on every response** — allowed, disallowed, absent-Origin, preflight, `405`,
   `401` and `500` alike. Threading it through `jsonResponse` guarantees this structurally.
4. **Nothing inside the deletion sequence changes.** The origin gate is strictly in front of the
   existing bearer check at `:152-157` and the sequence below it. C1's pending-flag write (C1 item
   10) sits between that bearer check and the sequence, so the final order is: origin gate →
   bearer verification → pending-flag write → deletion sequence. C2 contributes nothing to the
   sequence itself.

**File**: `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`, section 5 (line 299)

5. **Document `ALLOWED_ORIGINS`** next to `SUPABASE_SERVICE_ROLE_KEY` (line 324): exact
   comma-separated format, the fail-closed behaviour of row (g), and the absent-`Origin`
   allowance of rows (c) and (f) recorded as an explicit accepted risk with its compensating
   control (bearer-token verification remains mandatory).

### Changes Required — C3

**File**: `public/_headers`

1. Add a `Content-Security-Policy` line containing `__SUPABASE_HTTP_SRC__` and
   `__SUPABASE_CONNECT_SRC__`, leaving the five existing headers byte-identical.
2. Rewrite the header comment to record that **this supersedes the earlier deliberate decision to
   delegate CSP to the hosting platform**, why the earlier decision was made (the project URL is
   known only at build time), why the reversal is safe now (the build validates and injects that
   URL), and that platforms ignoring `_headers` still need equivalent configuration.

**File**: `vite.config.ts`

3. **`validateBuildEnvironment()` plugin.** In `config`/`buildStart` for `apply: 'build'` and
   production mode only, require `VITE_SUPABASE_URL` and (`VITE_SUPABASE_PUBLISHABLE_KEY` OR
   `VITE_SUPABASE_ANON_KEY`), throwing a message that names the missing variable. It must not
   affect `vite dev`, and it cannot affect `npm test`, which loads the separate
   `vitest.config.ts`.
4. **URL validation.** Parse with `new URL(...)`; reject unparseable values; require `https:`
   except when the hostname is `localhost` or `127.0.0.1`.
5. **`emitCspHeaders()` plugin.** In `closeBundle`, read `dist/_headers`, replace
   `__SUPABASE_HTTP_SRC__` with the validated `https://` origin and `__SUPABASE_CONNECT_SRC__`
   with the `https://` origin plus its `wss://` equivalent, and assert zero markers remain.
6. **Plugin order matters.** `emitCspHeaders()` must be registered **before**
   `injectServiceWorkerManifest()` so its `closeBundle` runs first: that plugin hashes every file
   in `dist` except `sw.js` to derive `SERVICE_WORKER_BUILD_ID`, and `_headers` is one of them.
   Registering it after would make the build id reflect pre-substitution content.

### Changes Required — C4

**Files**: `src/components/InstallPromptBanner.tsx` (18 matches),
`src/components/CycleSupportSection.tsx` (2), `src/pages/RecordPage.tsx` (16),
`src/pages/TripsPage.tsx` (24)

1. **Token mapping**, using only tokens that already exist in `src/styles/index.css`:
   `bg-white`/`bg-gray-50` → `bg-card` or `bg-muted`; `bg-gray-100` → `bg-muted`;
   `border-gray-100`/`border-gray-200` → `border-border`;
   `text-gray-900`/`text-gray-800` → `text-foreground` or `text-card-foreground`;
   `text-gray-700`/`text-gray-600`/`text-gray-500`/`text-gray-400` → `text-muted-foreground`.
2. **Translucent surfaces** become opacity variants of tokens: `bg-white/80` → `bg-card/80`,
   `bg-white/60` → `bg-card/60`, `bg-white/40` → `bg-card/40` (`RecordPage.tsx:385,390,396`;
   `CycleSupportSection.tsx:363`). Eliminated, not overridden.
3. **Accent foregrounds** become paired tokens: `bg-coral text-white` →
   `bg-coral text-coral-foreground` (`CycleSupportSection.tsx:390`), so the exception is legible
   rather than accidental.
4. **No new tokens**, no changes to `index.css`, no light-theme redesign.

**New file**: `src/lib/themeTokens.test.ts`

5. **Guard test.** Reads the four guarded files from disk, applies the `isBugConditionC4` regex
   including opacity variants, and asserts zero matches after subtracting theme-invariant accent
   foregrounds. The `guardedFiles` list is explicit, with a documented reason for every exclusion.
   Because `vitest.config.ts` sets `globals: false`, the test must import `describe`/`it`/`expect`
   from `vitest`.
6. **Resolve the three additional matching files explicitly**, as 2.22 requires — verified
   occurrences, each needing a decision recorded in the test's exclusion comments:
   - `src/pages/ServicePage.tsx:145,149` — `bg-white/20`, `bg-white/10` over the
     `from-navy to-navy/80` gradient at `:141`; also `text-white/10` (`:142`), `text-white/80`
     (`:159`), `bg-black/25` (`:163`), `text-white/60` (`:169`), `bg-black/50` (`:241`). Verify
     against the dark theme, then either convert or record as theme-invariant accent overlays on
     a fixed-hue navy surface.
   - `src/pages/SchedulePage.tsx:464` — `bg-slate-500` (private-event dot) and `bg-white`
     (today-marker dot on `bg-coral`): verify and resolve; `bg-black/50` at `:505` is a modal
     scrim, conventionally theme-invariant.
   - `src/pages/OnboardingPage.tsx:624` — `border-white` on a spinner inside a
     `bg-coral text-white` button; also `bg-black text-white` at `:402`, the Apple sign-in button
     whose colours are brand-mandated. Verify and resolve.

### Changes Required — C5

**File**: `src/lib/store.tsx`

1. Remove the three `await import('@/lib/events')` calls at lines 1397, 1438 and 1479, calling
   `saveEventToDB`, `updateEventInDB` and `deleteEventFromDB` through the existing line-19 static
   import extended to name them. Each call site keeps its surrounding `try`/`catch`, its
   `isCurrentLinkedCouple` / `isCurrentScope` guard and its return values exactly.

**File**: `src/lib/supabase.ts`

2. Replace the dynamic `await import('@capacitor/browser')` at line 450 with a static
   `import { Browser } from '@capacitor/browser'` matching `deepLinks.ts:2`. **No bundle-size
   regression:** `src/main.tsx:9` already statically imports `@/lib/deepLinks`, which statically
   imports `@capacitor/browser`, so the module is already in the eager graph. The
   `isNativePlatform()` guard that keeps `Browser.open` off the web path is untouched.

**File**: `vite.config.ts`

3. Add `build.rollupOptions.output.manualChunks` splitting vendors by import identity —
   react/react-dom/react-router, `@supabase/supabase-js`, `@dnd-kit/*`, `date-fns`,
   `lucide-react` — sufficient to clear the large-chunk warning. `injectServiceWorkerManifest`
   already enumerates every file under `dist/assets` recursively, so additional chunks are
   picked up automatically; verify this rather than assume it.

**Dependencies**

4. `brace-expansion`: **registry verification is done and affirmative** — npm publishes `1.1.18`
   on the 1.x line and `5.0.9` on 5.x — so audit section 7-3's "no patched 1.x exists" conclusion
   is stale and the fix is applied rather than deferred. Add an `overrides` entry pinning
   `brace-expansion` to `1.1.18`, deliberately staying on the **1.x line** so `minimatch@3`'s CJS
   `require` shape is preserved and the 5.x export-shape risk that audit 7-3 identified is
   avoided. Require `npm run lint` at 0 errors and 0 warnings afterwards as the empirical proof
   that the resolution is consumable. Never run `npm audit fix --force`.
5. `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`: record the react-router 7.18.2 /
   GHSA-qwww-vcr4-c8h2 conditional acceptance — static Vite SPA, `BrowserRouter` only, no
   Framework Mode, no RSC, no `loader`, no `action`, no `useFetcher`, no react-router `<Form>`,
   no server routes — with its invalidation trigger: adopting any one of those features voids the
   acceptance. Both a downgrade to 7.11.0 and a major upgrade are forbidden.

### Deliberate design decisions and residual risks

These are recorded rather than papered over, in the style the requirements set.

1. **Deletion recovery uses two ranked authorities, and the costs of that are real.** The previous
   approach — a boolean inside `STORE_KEY`, reached by extending `carryOverDevicePrefs`, cleared on
   logout and dropped when `STORE_KEY` was corrupt — is **rejected as fail-open** and has been
   removed from this design. Each of its exits handed the user a normal app over deleted data:
   corrupt JSON hit `loadState`'s existing `removeItem` (`store.tsx:103-116`), logout cleared it,
   and clearing site data or switching device bypassed it entirely. The replacement is the
   server-authoritative `app_metadata.account_deletion_pending` flag (2.31) with the dedicated
   per-user local marker `gomsinlog.accountDeletionRecovery.v1.<userId>` (2.33) as a secondary,
   never-sole guard. `carryOverDevicePrefs` is left exactly as at `7d82e3e` (3.11), so `STORE_KEY`
   and the marker cannot disturb each other in either direction. **This is the right architecture
   and it is still not free.** The honest residual risks:
   - **(a) A new failure mode appears before any deletion begins.** Requiring an `app_metadata`
     write as step 2 of 2.32 means a deletion that would previously have started can now fail
     earlier, at a step that did not exist. Deliberately accepted: the failure is
     `dataRemoved: false` with the account fully intact, which is strictly better than the current
     defect of removing data with no durable record. The visible cost is that a transient Auth API
     problem now blocks an operation the user asked for, and an ambiguous write (timeout) can leave
     the flag set on an intact account — blocking routing for a user whose deletion will complete
     on retry. Conservative in the correct direction, but it *is* a new way to be stuck.
   - **(b) The compensating update is the hardest part of this design to get right.** Clearing a
     flag after a data-deletion failure requires *verified* knowledge that nothing was removed
     (2.32.1), and "verified" is genuinely difficult across Storage, Postgres and Auth, which share
     no transaction. This design therefore **prefers the idempotent retry path and does not treat a
     compensating update as required**. If one is written, it must be tested against the specific
     partial-failure shapes, not reasoned about; a speculative implementation is worse than none,
     because the failure mode is silently clearing the flag on an account whose data is gone.
   - **(c) `getUser()` puts a network round-trip on the auth path.** It must not deadlock offline
     startup. Mitigated by reusing the existing `withTimeout(…, AUTH_SYNC_TIMEOUT_MS, …)` helper
     and by keeping `setIsAuthChecked(true)` in the `finally`, so the splash screen always
     releases. The residual cost is real: on a slow network the first paint is decided by the local
     marker alone, so a clean browser on a slow connection may briefly render a normal route before
     the server answer arrives and blocks it. That window is why the marker exists, and it is why
     the marker is not merely an optimisation.
   - **(d) The retained UUID is a pseudonymous identifier, and persisting it past logout is a real
     cost, not a free one.** No "adds no new data category" reasoning is used. It is justified only
     as the **minimum identifier necessary** to complete the user-requested deletion, it is bound
     to one account so it cannot affect another user, and it is removed on confirmed completion
     (2.34, 2.37).
   - **(e) Marker loss is a failure, not a fail-safe.** If the marker is lost or damaged, the server
     flag is the only remaining authority; if both are unavailable, recovery is not detected. That
     is named as a limitation rather than dressed up. A malformed marker is treated as ACTIVE and
     never cleared (2.35), and the only fail-safe direction anywhere in this design is *staying* in
     recovery.
   - **(f) There is no cancellation workflow, and nothing may behave as though there were.** No
     event other than confirmed Auth user deletion clears the marker (2.34). An operator clearing
     the server flag by hand is re-admitting a user to an app whose data is gone, which is why it is
     documented in the deployment checklist rather than left as folklore.
2. **Retaining the session while purging content inverts an existing invariant.** Every current
   purge path clears `authenticatedUser` and bumps the session generation. Keeping the identity
   means the hydration and sync effects must be prevented from re-fetching — handled by pinning
   `hydratedUserIdRef` and setting `cachePurgedRef`, and this is the highest-risk part of C1 for
   regression testing.
3. **The absent-`Origin` allowance is a real hole, narrowed deliberately.** Rows (c) and (f)
   permit non-browser clients; the compensating control is that bearer-token verification stays
   mandatory. It is documented as an accepted risk in the checklist, not hidden.
4. **Reversing the CSP delegation decision is only safe once C3's build validation lands.** The
   `_headers` comment and the `vite.config.ts` changes must ship together; landing 2.16 without
   2.18/2.19 would emit marker tokens to production.
5. **`src/lib/cors.test.ts` tests a Deno module from Node.** This works only because
   `resolveCors` is pure and free of `Deno` references at module scope. Verified enabling facts:
   `vitest.config.ts` includes `src/**/*.test.ts`; `tsconfig.json` excludes `**/*.test.ts` from
   typecheck; `allowImportingTsExtensions` is true. ESLint does lint `supabase/functions/**`
   (`ignores` is only `dist`, `node_modules`, `_original`), so the new shared module must be
   lint-clean.
6. **Guard-test scope is a judgement call.** Three files outside the four named in 2.20 match the
   regex. The guard covers only the four, and every exclusion carries a written reason, so the
   scope is auditable instead of implicit.
7. **An offline secondary device cannot learn about a deletion started elsewhere, and this design
   does not claim otherwise (2.44, 2.47).** Stated plainly and not softened:
   - **An offline secondary device that holds no local marker CANNOT learn about a deletion started
     on another device until connectivity returns.** Its status is `unknown`. It continues through
     the offline path, and **it will keep showing the local data it already holds** until a server
     answer becomes obtainable. There is no client-side signal that could tell it otherwise: the
     marker is per-device by construction (item 9), and the only authority that crosses devices is
     `app_metadata.account_deletion_pending`, which requires a round-trip to read.
   - **This design therefore makes no claim of absolute cross-device fail-closed behaviour while
     offline.** Cross-device fail-closed holds **only once a server answer is obtainable** — at which
     point item 21's gate forces the authoritative check before the next synchronization or mutation
     (in practice via `reconcileSharedAccess`, `store.tsx:665`, reached from the
     `window.addEventListener('online', …)` handler at `store.tsx:970`), and item 22 forces the
     abort-and-purge. Nothing in this design, in code comments or in test names may claim or imply
     stronger cross-device coverage than that, and no wording anywhere should suggest the offline
     window is closed. It is not closed; it is bounded at its far end only.
   - **`unknown` continuing offline is an availability tradeoff, not a safety property.** It is
     chosen so an offline user with no deletion outstanding is not stranded — that is the whole
     benefit, and it is a product decision, not a security argument. It confers no settled status
     (item 23) and it SHALL NEVER be named or described as safe, verified or fail-safe in the spec,
     the design, code comments, identifiers or test names. The one and only fail-safe direction
     anywhere in this design remains *staying* in recovery.
   - **What is actually mitigated, and what is not.** Mitigated: the initiating device (local
     marker, blocks before first render, no network needed); any device that can reach the server
     (authoritative flag); and any `unknown` device the moment it next tries to sync or mutate.
     **Not** mitigated: an indefinitely offline secondary device, which stays readable for as long
     as it stays offline. That gap is inherent to an offline-first client and is accepted knowingly
     rather than engineered away.

---

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples on the **unfixed** code at `7d82e3e` to confirm or
refute each root-cause hypothesis — if a hypothesis is refuted, re-hypothesize before writing the
fix. Then verify the fix holds for all buggy inputs (fix checking) and that behaviour is unchanged
for all non-buggy inputs (preservation checking).

Baseline to preserve: **206 tests across 23 files**, plus the new suites from 2.15 and 2.22.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the fix. Confirm
or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that drive each defect directly against the code at `7d82e3e` — a
mocked `supabase.functions.invoke` rejecting with a `FunctionsHttpError`-shaped error for C1, a
`resolveCors`-shaped assertion against the current wildcard for C2, real `npm run build`
invocations with a stripped environment for C3, filesystem regex scans for C4, and a captured
build log for C5. Run them on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **C1 partial-deletion classification**: invoke `deleteAccountFromDB` with a mocked
   `FunctionsHttpError` whose `context` is a `Response` of
   `500 { error, dataRemoved: true, warnings: [] }`; assert the outcome is `partially_deleted`
   (will fail on unfixed code — returns `{ ok: false, warnings: [] }`).
2. **C1 exposure containment**: render the store with populated `records`, `events`, `trips` and
   `profile.couple`, run `deleteAccount` against the same mock, and assert state is cleared while
   `authenticatedUser` survives (will fail on unfixed code — `store.tsx:1685` returns early).
3. **C1 route blocking**: assert that with recovery active, `/`, `/record`, `/schedule`, `/us`,
   `/my`, `/settings`, `/trips`, `/service` all render the recovery screen (will fail on unfixed
   code — no recovery state exists to set).
4. **C2 wildcard**: assert the `OPTIONS` response for `Origin: https://evil.example` carries no
   `Access-Control-Allow-Origin` and status `403` (will fail on unfixed code — `200 'ok'` with
   `'*'`).
5. **C2 `Vary`**: assert every response includes `Vary: Origin` (will fail on unfixed code — the
   header is absent entirely).
6. **C3 negative build**: run `npm run build` with all three Supabase variables unset and assert
   a non-zero exit (will fail on unfixed code — the build succeeds).
7. **C3 marker absence**: assert `public/_headers` contains both marker tokens (will fail on
   unfixed code — verified zero occurrences).
8. **C4 palette scan**: run the `isBugConditionC4` regex over the four guarded files (will fail on
   unfixed code — verified 18 / 2 / 16 / 24 matches).
9. **C5 build log**: capture `npm run build` output and assert no mixed-import and no large-chunk
   warning (will fail on unfixed code).
10. **Edge case — unreadable body**: reject with a `FunctionsFetchError` that has no `context`;
    assert `failed` with `dataRemoved: false`, proving 2.2 in both directions (may fail on
    unfixed code for the wrong reason — the unfixed code returns `ok: false` without ever reading
    a body, so this case must be distinguished from case 1, which is precisely the defect).
11. **C1 durability — reload escapes recovery**: drive a `partially_deleted` response, then
    remount the provider as a reload would, and assert the recovery screen is re-entered (will
    fail on unfixed code — `saveState` persists only `carryOverDevicePrefs`, so nothing survives
    and the remount lands on `/`, confirming 1.25).
12. **C1 durability — no server record exists**: assert that after a failed Auth deletion the Auth
    user carries `app_metadata.account_deletion_pending = true` (will fail on unfixed code — the
    function never writes it, and the one marker it does write is cleared again by
    `cancel_account_deletion` in the `catch` at `index.ts:246`, confirming 1.26 and 1.27).

**Expected Counterexamples**:
- C1: `deleteAccountFromDB` returns `{ ok: false, warnings: [] }` for a `dataRemoved: true`
  response, and `AppState` remains fully populated afterwards.
  Possible causes: `error.context` never read; two-valued return type; purge gated on
  `result.ok`; no recovery state in `StoreContextType`.
- C1 durability: a remount after a partial deletion renders a normal route, and no
  `account_deletion_pending` flag exists on the Auth user.
  Possible causes: `saveState` persists only the device-preference whitelist; no dedicated
  recovery key exists; the Edge Function writes no durable flag and clears the one non-durable
  marker it does write; detection would read stale `app_metadata` from a cached JWT even if a flag
  existed.
- C2: wildcard reflected, no `Vary`, preflight approved unconditionally.
  Possible causes: module-level `corsHeaders` constant; preflight short-circuit before any origin
  check; no `ALLOWED_ORIGINS` plumbing.
- C3: build succeeds with no configuration; `dist/_headers` has no CSP.
  Possible causes: `|| ''` defaults; no validation plugin; CSP deliberately delegated.
- C4: matches concentrated in surface/border/text utilities and their opacity variants.
  Possible causes: pre-token markup; opacity variants evading palette remapping.
- C5: two mixed-import warnings plus a 520 KB chunk warning.
  Possible causes: duplicate static+dynamic imports; no `manualChunks`.

### Fix Checking

**Goal**: Verify that for all inputs where a bug condition holds, the fixed function produces the
expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugConditionC1(input) DO
  outcome := deleteAccount_fixed(input)
  ASSERT outcome.status = 'partially_deleted' AND outcome.dataRemoved = TRUE
  ASSERT localContentPurged() AND identityRetained() AND devicePrefsRetained()
  ASSERT recoveryScreenShown() AND normalRoutesBlocked()
END FOR

FOR ALL input WHERE isBugConditionC2(input) DO
  response := deleteAccountFunction_fixed(input)
  ASSERT response.status = 403
  ASSERT response.headers['Access-Control-Allow-Origin'] IS ABSENT
  ASSERT response.headers['Vary'] CONTAINS 'Origin'
  ASSERT no_account_mutation_occurred()
END FOR

FOR ALL input WHERE isBugConditionC3(input) DO
  ASSERT build_fixed(input).exitCode <> 0 AND NOT artifactPublishable(...)
END FOR
FOR ALL input WHERE NOT isBugConditionC3(input) DO
  dist := build_fixed(input)
  ASSERT dist['_headers'] CONTAINS 'Content-Security-Policy'
  ASSERT dist['_headers'] CONTAINS httpsOrigin(input.VITE_SUPABASE_URL)
  ASSERT dist['_headers'] CONTAINS wssOrigin(input.VITE_SUPABASE_URL)
  ASSERT dist CONTAINS NO marker token
END FOR

FOR ALL input WHERE isBugConditionC4(input) DO
  ASSERT occurrenceCount_fixed(input) = 0
END FOR

FOR ALL input WHERE isBugConditionC5(input) DO
  out := build_fixed(input)
  ASSERT out.warnings CONTAINS NO mixedStaticDynamicImport
  ASSERT out.warnings CONTAINS NO largeChunk
  ASSERT observableBehaviour(out) = observableBehaviour(input)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where no bug condition holds, the fixed function produces the
same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT (isBugConditionC1(input) OR isBugConditionC2(input)
                      OR isBugConditionC3(input) OR isBugConditionC4(input)
                      OR isBugConditionC5(input)) DO
  ASSERT F(input) = F'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain.
- It catches edge cases that manual unit tests might miss — especially the C2 decision table,
  where the interesting inputs are combinations of method × origin × allowlist.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behaviour on UNFIXED code first for successful deletions, allowlisted and
absent-`Origin` Edge Function calls, valid builds, light-theme rendering and all four
soon-to-be-static import call sites; then write tests capturing that behaviour and re-run them
against the fix.

**Test Cases**:
1. **Successful deletion**: observe that `200 { success: true }` purges everything, signs out and
   raises the `media_not_fully_removed` warning toast when applicable on unfixed code, then
   verify this continues after the fix.
2. **Total failure**: observe that `dataRemoved: false` leaves the account intact with the generic
   retry toast on unfixed code, then verify no purge and no recovery after the fix.
3. **Sign-out and account switch**: observe `purgeLocalAccountData` clearing
   `authenticatedUser`, bumping the session generation and setting the cache-purged flag on
   unfixed code, then verify it is byte-for-byte unchanged after the fix.
4. **Demo mode**: observe refresh survival via `INITIAL_SESSION`, invitation code `123456` only,
   activation only when `!supabase`, and `blob:` stripping on unfixed code, then verify unchanged.
5. **Allowlisted origin end-to-end**: observe the full deletion sequence for a valid `POST` on
   unfixed code, then verify the fixed function runs the identical sequence with only CORS
   headers differing.
6. **Absent-`Origin` client**: verify `401` for missing/invalid/expired tokens and normal
   processing for a valid one, matching unfixed behaviour.
7. **Existing headers**: assert the five non-CSP headers byte-for-byte, before and after.
8. **`ANON_KEY` fallback**: build and run with only `VITE_SUPABASE_ANON_KEY` set; observe
   `isSupabaseConfigured === true` on unfixed code, then verify the new validation accepts it.
9. **Light theme snapshots**: capture the four guarded components in the light theme on unfixed
   code, then assert identical output after token conversion.
10. **Token definitions**: assert `src/styles/index.css` token values, `LIGHT_THEME_COLOR` and
    `DARK_THEME_COLOR` are unchanged.
11. **Event call sites**: observe `saveEventToDB` / `updateEventInDB` / `deleteEventFromDB`
    behaviour, including guard-rejection and failure paths, on unfixed code, then verify identical
    behaviour with static imports.
12. **Native browser guard**: verify `Browser.open` is still called only when
    `isNativePlatform()` is true and never on the web path.
13. **Service worker manifest**: assert the injected manifest enumerates every file under
    `dist/assets` after `manualChunks` splitting, and that the marker guard still throws when
    markers are removed.
14. **Existing suite**: all 206 baseline tests across 23 files continue to pass.
15. **Marker is not collateral damage**: observe that `purgeLocalAccountData` removes only
    `STORE_KEY_V1` and `STORE_KEY` on unfixed code, then verify after the fix that a sign-out from
    the recovery screen still removes exactly those two keys and leaves
    `gomsinlog.accountDeletionRecovery.v1.<userId>` in place (2.34).
16. **Provider survives the metadata write**: observe that `AuthUser.provider` is derived from
    `sessionUser.app_metadata?.provider` (`store.tsx:397`), then verify that after the Edge
    Function's `updateUserById` call the provider is unchanged — the existing `app_metadata` is
    spread before adding the flag, so `provider` and `providers` are not dropped.

### Deletion-Recovery Suite (2.38, gate 2.29(k))

These nine tests are required by 2.38 and are the tests gate 2.29(k) refers to. They are listed as
one suite because they only make sense together: each closes a bypass the others leave open.

| # | Test | Setup | Assertion |
| --- | --- | --- | --- |
| 1 | **Marker created on partial deletion** | `deleteAccount` against a `500 { dataRemoved: true }` response | `gomsinlog.accountDeletionRecovery.v1.<userId>` exists with a boolean value; it contains no warnings, no storage paths and no profile/couple/record/event/trip content; `STORE_KEY` holds only `carryOverDevicePrefs`; `authenticatedUser` is retained |
| 2 | **Logout preserves the marker** | From the recovery screen, invoke the logout action | `purgeLocalAccountData` + `signOut` run, `STORE_KEY_V1` and `STORE_KEY` are gone, and the marker **still exists**; the account is not presented as deleted (2.8, 2.34) |
| 3 | **Same-user re-login resumes recovery** | Sign back in as the same `<userId>` after test 2 | The recovery screen is re-entered with the retry action available, before any `fetchFullStateFromDB` result is applied (2.34) |
| 4 | **Other user unblocked, marker intact** | Sign in as a different `<userId>` on the same browser | The second user reaches normal routes, is **not** blocked, and after their session the first user's marker is still present — not deleted, not overwritten (2.34) |
| 5 | **Malformed marker fails closed** | Seed the key with invalid JSON, then with `{}`, then with an unexpected type | Each case is treated as recovery **ACTIVE**, and the key is **not** cleared or overwritten in any of them. Includes a negative assertion that no code path calls `removeItem` on this key outside confirmed-deletion cleanup (2.35) |
| 6 | **Clean browser blocked by server metadata** | No local marker at all; mock `getUser()` to return `app_metadata.account_deletion_pending = true` while the cached session's claims omit it | Every normal route is blocked. Asserts specifically that the verdict comes from the `getUser()` round-trip and **not** from `session.user.app_metadata`, so a stale JWT cannot bypass recovery (2.31, 2.36) |
| 7 | **Pending-flag write failure blocks data deletion** | Edge Function with `updateUserById` mocked to fail | No `daily_records` preflight, no `begin_account_deletion`, no `removeAndConfirmRecordMedia`, no `prepare_account_deletion`, no `deleteUser`; the response reports `dataRemoved: false`; the account is fully intact (2.32, 2.32.1) |
| 8 | **Retry success deletes Auth, then clears the marker** | Retry from the recovery screen with `deleteUser` succeeding | Ordering is asserted, not just the end state: `deleteUser` resolves **before** `clearRecoveryMarker` is called. The marker is gone afterwards; on a retry where `deleteUser` fails it is still present (2.34, 2.7) |
| 9 | **Normal routes inaccessible throughout** | Recovery active, driven through: before retry → after a failed retry → after a reload/remount → after logout and re-login as the same user | In every one of those states, `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips` and `/service` all render the recovery screen; `/auth/callback` and `/legal/:doc` remain reachable; no timeout, attempt counter or override re-admits the user (2.32.2) |

Two properties of this suite are worth stating explicitly, because they are what make it a real
gate rather than a checklist. Test 5 asserts a **negative** — the absence of a cleanup path — which
is the assertion most likely to be deleted by a future well-meaning refactor, so it carries a
comment saying so. Test 6 asserts **provenance**, not just outcome: it must fail if the
implementation reads cached claims, even though cached claims would give the right answer in most
scenarios. A test that only checked the outcome would pass against a stale-JWT implementation and
miss 2.36 entirely.

### Tri-State Verification Suite (2.48, gate 2.29(l))

These five tests are required by 2.48 and are the tests gate 2.29(l) refers to. They validate
Property 15. Tests 1 and 2 run against the pure resolver of Changes Required — C1 item 20 and need
no network; tests 3-5 run against the store and the route gate.

| # | Test | Setup | Assertion |
| --- | --- | --- | --- |
| 1 | **Classification is total and exclusive** | Table-drive all nine combinations of marker state (absent / valid positive / malformed) × authoritative answer (`pending` / not pending / cannot complete) through `readRecoveryMarker` into `classifyDeletionStatus` | Each combination maps to **exactly one** of `pending`, `clear`, `unknown`: no combination is unclassified, none maps to two, and the (marker present, server not pending) pair resolves to **`pending`**, not `clear`. Malformed marker → `pending` in all three answer columns, and the key is not removed in any of the nine cases (2.39, 2.41) |
| 2 | **A `getUser()` timeout is not `clear`** | `getUser()` that (a) never settles past `AUTH_SYNC_TIMEOUT_MS` through `withTimeout`, (b) rejects, (c) fails with the network offline | Every case yields `unknown`, never `clear`. The persisted, cached, serialized and logged forms of `unknown` are each distinct from those of `clear` and are never `false`, `null` or an omitted field — asserted on the actual log line and on the absence of any deletion field in `STORE_KEY`. Plus a **type-level** assertion (`@ts-expect-error`, or an `expect-type`-style check) that a representation collapsing the two — `boolean`, `boolean \| null`, `deletionPending?: boolean` — fails to type-check, and that a `switch` missing the `unknown` arm fails the `assertNever` check (2.43) |
| 3 | **Initiating device stays blocked offline** | The device that started the deletion: local marker present, network unavailable at startup | The marker **alone** yields `pending`; all of `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips`, `/service` render the recovery screen; the block happens **before first render** and **no `getUser()` round-trip is required** for it — asserted by spying on the auth call and confirming the route gate was already closed when it was still unresolved (2.40, 2.41) |
| 4 | **Secondary offline device retries before syncing** | No local marker, unreachable server → `unknown`; then trigger the next sync (`refreshSlice` / `reconcileSharedAccess`, including via the `online` event) and separately a mutation (`addRecord`, `updateRecord`, `deleteEvent`) | The device continues through the existing offline path (2.44), and on the next attempt the authoritative check is issued **first**. The assertion is on **request ordering**, not just on the presence of a check: the `getUser()` call is observed before `rpc('get_my_active_couple_id')` / `fetch*ResultFromDB` / `saveRecordToDB` in the call log. Also asserts the status is **not reused as if settled** — a second attempt re-issues the check rather than reading a cached verdict, and no elapsed time or retry count promotes `unknown` to `clear` (2.45) |
| 5 | **Synchronization is aborted when the retry finds `pending`** | From `unknown`, the gated retry returns `app_metadata.account_deletion_pending = true` | The synchronization is aborted with **none of its writes applied**: the call log contains **no** `rpc`, no `fetch*ResultFromDB`, no `saveRecordToDB` / `deleteRecordFromDB` / `saveEventToDB` / `disconnectCoupleFromDB` after the check, no server state is modified, and no deferred timer later delivers one. Local account content is purged immediately through the existing partial-purge path, recovery is entered, and all normal routes are blocked. The abort is asserted to happen **before any sync write is attempted** — an ordering assertion, so an implementation that syncs first and reconciles afterwards fails (2.46) |

Three things make this a real gate rather than a restatement of the type. Test 1 asserts **totality
by enumeration**, which is what catches an ordering regression that swaps rows 1 and 2 and quietly
turns "marker present, server clear" into `clear`. Test 2 asserts at the **type level** as well as
the value level, because 1.28's defect was representational: a value-only test would pass against a
`boolean | null` implementation that happens to branch correctly today. Tests 4 and 5 assert
**ordering**, not end state — an implementation that syncs and then reconciles reaches the same final
screen and must still fail.

### Unit Tests

- **C1**: `classifyDeletionSuccess` / `classifyDeletionErrorBody` / `coerceWarnings` over success,
  partial, total-failure, missing-field, wrong-type and unparseable bodies;
  `deleteAccountFromDB` against mocked `FunctionsHttpError`, `FunctionsFetchError` and
  `FunctionsRelayError`; `purgeLocalContentRetainingIdentity` asserting the 2.4 key-level split
  key by key, including that `authenticatedUser` and the three device preferences survive;
  `deleteAccount` branch selection for all three outcomes; retry success, retry failure and
  logout from recovery; the `isCurrentIdentity` guard under an account switch mid-flight.
  Also `recoveryKeyFor` / `markRecoveryPending` / `readRecoveryMarker` / `clearRecoveryMarker`:
  key naming per user, boolean-only payload, `'absent'` for a missing key, `'active'` for every
  present value including malformed ones, no `removeItem` on any read path, and `clearRecoveryMarker`
  reachable only from the confirmed-Auth-deletion branch. Plus the Edge Function's ordering:
  `updateUserById` is called with the existing `app_metadata` spread in, before the record
  preflight, and a failed call returns `dataRemoved: false` without invoking any deletion step.
- **C2** (`src/lib/cors.test.ts`, 2.15): every row (a)-(g) of the decision table, plus
  `parseAllowedOrigins` over empty, whitespace-only, single, multiple, duplicate and
  trailing-comma inputs; an assertion that no code path can emit `'*'`; and `Vary: Origin` on
  `403`, `401`, `405` and `500` responses.
- **C3**: environment validation over each missing-variable combination and each URL form
  (`https`, `http`, `http://localhost`, `http://127.0.0.1`, unparseable, empty); marker
  substitution producing the correct `https:`/`wss:` pair; plugin ordering such that
  `emitCspHeaders` runs before `injectServiceWorkerManifest`.
- **C4** (`src/lib/themeTokens.test.ts`, 2.22): zero palette-literal matches including opacity
  variants in the four guarded files; the theme-invariant accent-foreground exception accepts
  `bg-coral text-coral-foreground` and still rejects `bg-white/60`; the exclusion list for
  `ServicePage.tsx`, `SchedulePage.tsx` and `OnboardingPage.tsx` is explicit and reasoned.
- **C5**: no remaining `await import('@/lib/events')` or `await import('@capacitor/browser')` in
  the source; each converted call site behaves identically.

### Property-Based Tests

- **C2 decision table**: generate the cross product of method × `Origin` (allowlisted, disallowed,
  absent, malformed, case-varied, trailing-slash) × allowlist (empty, single, multiple) and assert
  the invariants that no response ever contains `'*'`, every response contains `Vary: Origin`, and
  a disallowed origin never receives a reflected origin.
- **C1 classification totality**: generate arbitrary response bodies and status codes and assert
  `classify` always returns exactly one of the three statuses, that `partially_deleted` implies
  `dataRemoved: true`, that `failed` implies `dataRemoved: false`, and that no unreadable body
  ever yields `deleted` or `partially_deleted`.
- **C1 purge completeness**: generate arbitrary populated `AppState` values and assert that after
  the partial purge, every personal/couple/content field equals its `DEFAULT_STATE` value while
  `authenticatedUser`, `widgetLayout`, `hasSeenInstallPrompt` and `theme` are preserved, and the
  recovery marker key is untouched by the purge.
- **C1 marker fail-closed totality**: generate arbitrary strings, JSON fragments and non-boolean
  values as the marker's stored value and assert that `readRecoveryMarker` returns `'active'` for
  **every** present value and `'absent'` only for a genuinely missing key, and that no input
  causes the key to be removed. This is the property that forbids a fail-open branch from being
  reintroduced.
- **C1 authority ranking**: generate the cross product of local marker state (absent, active,
  malformed) × `getUser()` result (`true`, `false`/absent, unavailable) and assert that recovery is
  active whenever either authority says so, that a `true` server result always blocks regardless of
  the local value, that a local `active` is never overridden by an unavailable server answer, and
  that the only combination admitting normal routing is "no marker, and a server answer that
  positively reports not pending".
- **C3 URL validation**: generate URL strings and assert acceptance exactly when the value is a
  parseable absolute URL that is `https:` or a `localhost`/`127.0.0.1` origin.
- **C4 guard soundness**: generate synthetic class strings and assert the guard regex flags
  palette literals with and without numeric and opacity suffixes and never flags theme tokens.

### Integration Tests

- **C1 full recovery flow**: partial-deletion response → recovery screen → failed retry stays in
  recovery with nothing re-fetched → successful retry clears recovery, purges identity and signs
  out; and the alternative logout path, which must not present the account as deleted.
- **C1 routing**: with recovery active, all eight authenticated routes render the recovery screen
  while `/auth/callback` and `/legal/:doc` remain reachable, and the recovery gate takes precedence
  over the `authSyncUnavailable` branch.
- **C1 durable recovery end-to-end**: the full nine-test Deletion-Recovery Suite above, run as one
  flow where the state is carried forward — partial deletion → reload → logout → same-user
  re-login → other-user session → back to the first user — so the suite proves the marker's
  lifecycle rather than nine isolated snapshots.
- **C1 offline auth path**: with the network unavailable, assert that `getUser()` times out through
  `withTimeout`, that `setIsAuthChecked(true)` still runs so the splash screen releases, that a
  local marker still blocks routing, and that the absence of a marker does not fabricate recovery.
- **C2 end-to-end**: preflight then `POST` from an allowlisted origin completes the deletion
  sequence; from a disallowed origin both are refused with `403` and no mutation; with
  `ALLOWED_ORIGINS` unset every request gets `500` and no mutation.
- **C3 build**: gate 2.29(e) with placeholders supplied for that invocation only —
  `VITE_SUPABASE_URL=https://example.supabase.co` and
  `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key-not-a-secret`, never written to a tracked file
  (2.30) — then gate 2.29(f) negative build and gate 2.29(g) marker assertion over all of `dist/`.
- **C4 theme switching**: mount each of the four components under light and dark and assert
  readable foreground-on-surface pairings in both, plus an unchanged light-theme appearance.
- **C5 offline activation**: build with `manualChunks`, confirm the service worker manifest lists
  every emitted chunk, and confirm an offline activation resolves them all.
- **Release gates 2.29(a)-(l)**: `npm ci`; `npm run typecheck` (0 errors); `npm run lint`
  (0 errors, 0 warnings); `npm test` (206 baseline plus new suites); `npm run build` with
  placeholders and no warnings; negative build exits non-zero; zero marker tokens in `dist/`;
  `npm audit` reported with every remaining advisory covered by a recorded decision under 2.27 or
  2.28; secret scan finding no JWT-shaped strings, no `service_role` values, no real project URL,
  no keystore or certificate files and no tracked `.env`; `git diff --check` clean; and **gate (k),
  the Deletion-Recovery Suite** — all nine tests of 2.38 passing: marker created on partial
  deletion, logout preserves it, same-user re-login resumes recovery, another user is unblocked
  with the first marker intact, a malformed marker fails closed, a clean browser is blocked by
  server metadata, a failed pending-flag write prevents application-data deletion, a successful
  retry deletes the Auth user before clearing the marker, and normal routes stay inaccessible
  throughout; and **gate (l), the Tri-State Verification Suite** — all five tests of 2.48 passing:
  classification is total and mutually exclusive across all nine marker × answer combinations, a
  `getUser()` timeout yields `unknown` and is never represented, stored, cached, serialized or logged
  as `clear`, an offline initiating device stays blocked by its local marker, an offline secondary
  device retries authoritative verification **before** synchronization rather than syncing first, and
  a retry that discovers `pending` aborts the synchronization with none of its writes applied, purges
  local account content and enters recovery.
