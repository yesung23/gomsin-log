# Bugfix Requirements Document

## Introduction

This bugfix produces a **safe, reviewable web release candidate** for 곰신로그 on the
working branch `integration/kimi-web-stabilization`, created from
`7d82e3efd1b17283b0e8f086e94cf97cf268b625` (`origin/kiro/release-hardening-2026-07-31`,
30 commits ahead of `master`).

Five verified defect clusters block the web release. Each is written below as a bug
condition `C(X)` with a fix-checking property `P(result)` for buggy inputs and a
preservation goal `F(X) = F'(X)` for non-buggy inputs.

| ID | Bug condition | Impact |
| --- | --- | --- |
| C1 | Partial account deletion is misreported and leaves private data on screen | P0 — privacy |
| C2 | `delete-account` Edge Function accepts any browser origin | P0 — security |
| C3 | Build ships no CSP and silently accepts missing Supabase config | P1 — security / silent misconfiguration |
| C4 | Light-only hard-coded surfaces break dark theme | P1 — usability |
| C5 | Build and dependency hygiene is unresolved and unrecorded | P1 — release readiness |

**Key definitions**

- **F** — the code at `7d82e3e`, before this fix.
- **F'** — the code after this fix.
- **C(X)** — predicate selecting inputs that trigger the bug.
- **P(result)** — required behaviour of `F'` for inputs satisfying `C(X)`.

### Scope discipline

This is a defect fix, not a redesign. Schedule, trips, cycle tracking, records and
couple functionality are treated as working and are protected by Section 3. No
unrelated product features are added, Android/native work is deferred, and the older
divergent 19-commit local branch is **not** merged or cherry-picked wholesale.

### Baseline discrepancies between the handoff and repository reality

Reality wins in every row below; the discrepancy is recorded rather than papered over.

| Handoff claim | Verified reality at `7d82e3e` |
| --- | --- |
| Prior work exists in commits `d41a003`, `6c0edac`, `dbd5097`, `ecf6a69` | Never pushed. Not reachable from any remote ref. All content must be reconstructed from scratch. |
| `docs/NEW_WINDOW_KIMI_GITHUB_AUDIT_PROMPT.md` should be read | Does not exist on any branch. Its contents are unknown and are **not** invented here. |
| `src/lib/accountDeletion.ts`, `supabase/functions/_shared/cors.ts`, `src/lib/cors.test.ts`, `src/lib/themeTokens.test.ts`, `src/App.test.tsx` exist | All five are absent. Each is a new file. |
| `public/_headers` contains CSP markers | Contains zero occurrences of `__SUPABASE_HTTP_SRC__` / `__SUPABASE_CONNECT_SRC__`. Its header comment states CSP is *deliberately* delegated to the hosting platform, so C3 reverses a prior deliberate decision (see 2.14). |
| `brace-expansion` should resolve to 1.1.18 | `package-lock.json` resolves the `eslint` → `minimatch@3` path to **1.1.16**. Audit 7-3 concluded no patched 1.x release exists (vulnerable range `<=5.0.7`). The claimed 1.1.18 is unverified; C5 requires registry verification before any change. |
| Dark-theme breakage is confined to 4 files | `src/pages/OnboardingPage.tsx` (`border-white`), `src/pages/SchedulePage.tsx` (`bg-slate-500`, `bg-white`) and `src/pages/ServicePage.tsx` (`bg-white/20`, `bg-white/10`) also match the pattern. The guard test scope must be stated explicitly (2.20) rather than assumed. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` is the only key variable | `src/lib/supabase.ts:10` falls back to `VITE_SUPABASE_ANON_KEY`. The fallback is load-bearing and must survive (3.9). |

---

## Bug Analysis

### Current Behavior (Defect)

#### C1 — Partial account deletion is misreported and leaves private data on screen

Per audit section 7-2 (final row), the Edge Function retries Auth deletion
(`AUTH_DELETE_ATTEMPTS = 3`) and on final failure clears the deletion marker and
returns HTTP 500 with `{ error, dataRemoved: true, warnings: [] }`. The server is
honest; the client throws the honesty away.

1.1 WHEN the Edge Function returns a non-2xx response carrying `dataRemoved: true` THEN `deleteAccountFromDB` (`src/lib/supabase.ts:350-353`) branches on the transport `error` object, logs it, and returns `{ ok: false, warnings: [] }`, discarding the response body and collapsing a partial deletion into a generic failure.

1.2 WHEN `deleteAccountFromDB` returns `ok: false` THEN `deleteAccount` in `src/lib/store.tsx` returns at `if (!result.ok) return result;` before reaching `purgeLocalAccountData`, so the in-memory `AppState` — `records`, `events`, `trips`, `profile.myName`, `profile.couple`, `profile.military`, `profile.contact` — remains populated and continues to render.

1.3 WHEN the deletion outcome is partial THEN `src/pages/SettingsPage.tsx:765` shows the generic toast `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.`, telling the user nothing was deleted when their server-side data is already gone.

1.4 WHEN server-side data is already deleted but the login still exists THEN `src/App.tsx` keeps routing to `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips` and `/service`, so the user navigates a normal app whose backing data no longer exists, with no explanation and no path to completion.

1.5 WHEN the client needs to distinguish "deleted", "partially deleted" and "failed" THEN no such representation exists: `deleteAccountFromDB` and `deleteAccount` both return the boolean shape `{ ok: boolean; warnings: string[] }`, `src/lib/accountDeletion.ts` is absent, and neither `StoreContextType` (`src/lib/storeContext.ts`) nor `StoreProvider` (`src/lib/store.tsx`) exposes any `accountDeletionRecovery` state.

1.6 WHEN a partial deletion is retried and fails again THEN there is no defined behaviour at all, because there is no recovery state to remain in.

#### C2 — Edge Function accepts any browser origin

1.7 WHEN any browser on any origin sends `POST` to `delete-account` THEN `supabase/functions/delete-account/index.ts:19` returns `'Access-Control-Allow-Origin': '*'`, so any web page can read the response of an authenticated account-deletion call.

1.8 WHEN a response is returned THEN no `Vary: Origin` header is sent, so a shared cache can serve one origin's CORS decision to another.

1.9 WHEN an `OPTIONS` preflight arrives from any origin THEN the function returns `200` with body `'ok'` and the wildcard `corsHeaders`, approving the origin unconditionally.

1.10 WHEN an operator deploys the function THEN no origin allowlist exists to configure: `supabase/functions/_shared/` does not exist, and `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` section 5 documents only `SUPABASE_SERVICE_ROLE_KEY`, with no mention of `ALLOWED_ORIGINS`.

#### C3 — Build ships no CSP and silently accepts missing Supabase config

1.11 WHEN the app is served from `dist` THEN no Content-Security-Policy is delivered: `public/_headers` sets only `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `X-DNS-Prefetch-Control`, `index.html` contains no CSP meta tag, and no marker token exists for a build step to replace.

1.12 WHEN `npm run build` runs with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (and `VITE_SUPABASE_ANON_KEY`) all absent THEN the build succeeds, because `src/lib/supabase.ts:9-10` default both to `''` and `vite.config.ts` performs no environment validation. The artifact is a permanently demo-mode app that looks like a successful release build.

1.13 WHEN `VITE_SUPABASE_URL` is set to a non-HTTPS or malformed value THEN nothing rejects it; it is passed straight to the Supabase client.

#### C4 — Light-only hard-coded surfaces break dark theme

Audit item 21 records that opacity variants such as `bg-white/60` defeated the earlier
`!important` palette remap, so bare-colour detection alone is insufficient.

1.14 WHEN the theme is dark THEN `src/components/InstallPromptBanner.tsx` renders light-only surfaces and near-invisible text (`bg-gray-50` and `border-gray-100` at lines 65, 78, 85, 108; `text-gray-900`, `text-gray-700`, `text-gray-600`, `text-gray-500`, `text-gray-400` at lines 71-108).

1.15 WHEN the theme is dark THEN `src/components/CycleSupportSection.tsx:363` renders `bg-white/60`, a translucent light wash over a dark background.

1.16 WHEN the theme is dark THEN `src/pages/RecordPage.tsx` renders `bg-white/80` (385), `bg-white/60` (390), `bg-white/40` (396), `bg-gray-50` (611), `bg-gray-100` (597) and `text-gray-900`/`text-gray-800`/`text-gray-500` (592, 597, 612, 625) — light surfaces with dark-on-dark text.

1.17 WHEN the theme is dark THEN `src/pages/TripsPage.tsx` renders `bg-gray-50`/`bg-gray-100`/`border-gray-200`/`border-gray-100` (228, 230, 240-250) with `text-gray-900`/`text-gray-700`/`text-gray-500`/`text-gray-400` (203-251).

1.18 WHEN a change reintroduces a hard-coded light surface THEN nothing catches it: `src/lib/themeTokens.test.ts` does not exist.

#### C5 — Build and dependency hygiene is unresolved and unrecorded

1.19 WHEN `npm run build` runs THEN Vite emits a mixed static/dynamic import warning for `@/lib/events`, which is imported statically at `src/lib/store.tsx:19` and `src/lib/sync.ts:5` and dynamically at `src/lib/store.tsx:1397`, `1438` and `1479`, so the dynamic chunk is inlined and the split achieves nothing.

1.20 WHEN `npm run build` runs THEN Vite emits the same warning for `@capacitor/browser`, imported statically at `src/lib/deepLinks.ts:2` and dynamically at `src/lib/supabase.ts:450`.

1.21 WHEN `npm run build` runs THEN Rollup emits a large-chunk warning (audit section 4: 520 KB / 151 KB gzip), because `vite.config.ts` declares no `build.rollupOptions.output.manualChunks`.

1.22 WHEN `npm audit` runs THEN five development-only advisories resolve to `eslint` → `minimatch@3.1.5` → `brace-expansion@1.1.16` (GHSA-mh99-v99m-4gvg). The handoff demands resolving to 1.1.18 and 5.0.9, but audit section 7-3 concluded no patched 1.x exists and **rejected** an `overrides` bump because `minimatch@3` uses CJS `require` while 5.x changed its exports, risking breaking `npm run lint`. The conflict is unresolved and the registry claim is unverified.

1.23 WHEN a future maintainer changes routing dependencies THEN the react-router 7.18.2 / GHSA-qwww-vcr4-c8h2 conditional acceptance lives only in `docs/kiro/RELEASE_AUDIT_2026-07-31.md` and is absent from the deployment checklist, so a blind downgrade to 7.11.0 or a major upgrade can be applied without encountering the reasoning.

1.24 WHEN release readiness is assessed for this branch THEN no verification result exists for this baseline, because the four commits of prior work were never pushed and their gate runs are unrecoverable.

---

### Expected Behavior (Correct)

#### C1 — Partial deletion is reported truthfully and contains the exposure

```pascal
FUNCTION isBugConditionC1(X)
  INPUT: X of type DeleteAccountResponse
  OUTPUT: boolean

  // The Edge Function reports data removal without completing account deletion.
  RETURN X.httpStatus <> 200 AND X.body.dataRemoved = TRUE
END FUNCTION

// Property: Fix Checking — truthful classification and containment
FOR ALL X WHERE isBugConditionC1(X) DO
  outcome ← deleteAccount'(X)
  ASSERT outcome.status = 'partially_deleted'
  ASSERT outcome.dataRemoved = TRUE
  ASSERT localContentPurged() AND identityRetained() AND devicePrefsRetained()
  ASSERT recoveryScreenShown() AND normalRoutesBlocked()
END FOR
```

2.1 WHEN the Edge Function returns a non-2xx response THEN the system SHALL read the response body from the `FunctionsHttpError` context rather than discarding it, and SHALL classify the outcome using a typed union declared in the new `src/lib/accountDeletion.ts`: `deleted` (`dataRemoved: true`), `partially_deleted` (`dataRemoved: true`), `failed` (`dataRemoved: false`).

2.2 WHEN the response body cannot be read or parsed THEN the system SHALL classify the outcome as `failed` with `dataRemoved: false`, so an unreadable response never silently downgrades a real partial deletion into a claim of success, and never fabricates a partial deletion that did not occur.

2.3 WHEN the outcome is `partially_deleted` THEN the system SHALL expose `accountDeletionRecovery` state through `StoreContextType` in `src/lib/storeContext.ts` and `StoreProvider` in `src/lib/store.tsx`, so every consumer reads one authoritative flag rather than inferring recovery from route or toast state.

2.4 WHEN the outcome is `partially_deleted` THEN the system SHALL immediately purge all local personal, couple, content and cache data while retaining **only** the authenticated identity and device preferences, with this exact key-level split:

| Storage location | Disposition | Grounding |
| --- | --- | --- |
| `localStorage['gomsinlog.state.v2']` (`STORE_KEY`) | **Rewritten** to device preferences only | `store.tsx:96`, `saveState` at `store.tsx:128` |
| `localStorage['gomsinlog.state.v1']` (`STORE_KEY_V1`) | **Removed** | `store.tsx:95`, `105` |
| `widgetLayout`, `hasSeenInstallPrompt`, `theme` | **Retained** — device preferences | `carryOverDevicePrefs`, `store.tsx:197-203` |
| `authenticatedUser` | **Retained** — identity is required to retry deletion | new behaviour; differs from `purgeLocalAccountData` |
| Supabase auth session keys (`sb-*`, owned by `supabase-js`) | **Retained** — no sign-out is performed | consequence of retaining identity |
| `records`, `events`, `trips` | **Cleared** to `[]` | `DEFAULT_STATE`, `store.tsx:154-190` |
| `profile.myName`, `profile.role`, `profile.couple`, `profile.military`, `profile.contact` | **Reset** to `DEFAULT_STATE` values | same |
| `setupComplete`, `onboardingStep`, `highlightedRecordId` | **Reset** to `DEFAULT_STATE` values | same |
| `isDemoMode` | **Set to `false`** — this is a real, signed-in account | mirrors `purgeLocalAccountData` |

  Because `saveState` already persists only the `carryOverDevicePrefs` whitelist for an
  authenticated session, no personal content is on disk to begin with; the purge SHALL
  therefore also clear in-memory `AppState`, which is where the actual exposure lives.

2.5 WHEN `accountDeletionRecovery` is active THEN the system SHALL block every normal application route and render a recovery screen offering exactly two actions — retry deletion, and log out — with no navigation to `/`, `/record`, `/schedule`, `/us`, `/my`, `/settings`, `/trips` or `/service`.

2.6 WHEN a retry of the deletion also fails THEN the system SHALL remain in `accountDeletionRecovery`, SHALL NOT re-fetch or re-render any purged personal, couple or content data, and SHALL keep offering only retry and logout.

2.7 WHEN a retry succeeds THEN the system SHALL clear `accountDeletionRecovery`, purge the retained identity, and sign out, reaching the same end state as an outcome of `deleted`.

2.8 WHEN the user chooses logout from the recovery screen THEN the system SHALL clear the retained identity and sign out, and SHALL NOT present the account as successfully deleted.

2.9 WHEN the outcome is `partially_deleted` THEN `src/pages/SettingsPage.tsx` SHALL state explicitly that the user's data has been deleted but the login account has not, and that the deletion must be completed — replacing the generic `계정을 삭제하지 못했습니다` message at line 765 for this outcome only.

2.10 WHEN the outcome is `failed` (`dataRemoved: false`) THEN the system SHALL keep the account fully intact, SHALL NOT purge local data, SHALL NOT enter recovery, and SHALL show the existing generic retry message.

#### C2 — Explicit origin allowlist

```pascal
FUNCTION isBugConditionC2(X)
  INPUT: X of type EdgeFunctionRequest
  OUTPUT: boolean

  // A browser-issued request whose Origin is not on the operator's allowlist.
  RETURN X.headers.origin IS NOT NULL
     AND X.headers.origin NOT IN parseAllowedOrigins(env.ALLOWED_ORIGINS)
END FUNCTION

// Property: Fix Checking — disallowed origins are refused, never reflected
FOR ALL X WHERE isBugConditionC2(X) DO
  response ← deleteAccount'(X)
  ASSERT response.status = 403
  ASSERT response.headers['Access-Control-Allow-Origin'] IS ABSENT
  ASSERT response.headers['Vary'] CONTAINS 'Origin'
  ASSERT no_account_mutation_occurred()
END FOR
```

2.11 WHEN the Edge Function handles any request THEN it SHALL derive CORS headers from a new shared module `supabase/functions/_shared/cors.ts` that reads a comma-separated `ALLOWED_ORIGINS` environment variable, and SHALL NOT emit `Access-Control-Allow-Origin: '*'` under any condition.

2.12 WHEN a request is handled THEN the system SHALL return `Vary: Origin` on every response — allowed, disallowed, absent-Origin, preflight and error alike.

2.13 WHEN a request is received THEN the system SHALL apply exactly this decision table. The absent-Origin row is a deliberate, security-visible allowance for non-browser authenticated clients (CLI, server-to-server); without enumerating it the allowlist would be theatre.

| # | Method | `Origin` header | `ALLOWED_ORIGINS` | Outcome |
| --- | --- | --- | --- | --- |
| a | `OPTIONS` | on allowlist | configured | `200`, `Access-Control-Allow-Origin: <that exact origin>`, `Vary: Origin`, allow-methods `POST, OPTIONS`, allow-headers `authorization, apikey, content-type, x-client-info` |
| b | `OPTIONS` | not on allowlist | configured | `403`, no `Access-Control-Allow-Origin`, `Vary: Origin` |
| c | `OPTIONS` | absent | configured | `200`, no `Access-Control-Allow-Origin` (nothing to reflect), `Vary: Origin` |
| d | `POST` | on allowlist | configured | Proceeds to bearer-token verification |
| e | `POST` | not on allowlist | configured | `403` before any auth check, no `Access-Control-Allow-Origin`, no account mutation |
| f | `POST` | absent | configured | Proceeds to bearer-token verification. **Bearer-token verification remains REQUIRED** — a missing `Authorization: Bearer …` still yields `401`, and an invalid or expired token still yields `401`. |
| g | any | any | unset or empty | `500` configuration error, no account mutation — the function SHALL fail closed rather than fall back to a wildcard |

2.14 WHEN an operator deploys the function THEN `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` section 5 SHALL document `ALLOWED_ORIGINS` alongside `SUPABASE_SERVICE_ROLE_KEY`, including its exact comma-separated format, the fail-closed behaviour of row (g), and the absent-Origin allowance of rows (c) and (f) as an explicit accepted risk.

2.15 WHEN CORS behaviour changes THEN a new `src/lib/cors.test.ts` SHALL assert every row (a)-(g) of the table above.

#### C3 — Required config, validated origins, generated CSP

```pascal
FUNCTION isBugConditionC3(X)
  INPUT: X of type ProductionBuildEnvironment
  OUTPUT: boolean

  RETURN X.VITE_SUPABASE_URL IS EMPTY
      OR (X.VITE_SUPABASE_PUBLISHABLE_KEY IS EMPTY AND X.VITE_SUPABASE_ANON_KEY IS EMPTY)
      OR NOT isHttpsOrLocalhost(X.VITE_SUPABASE_URL)
END FUNCTION

// Property: Fix Checking — a misconfigured production build cannot produce an artifact
FOR ALL X WHERE isBugConditionC3(X) DO
  outcome ← build'(X)
  ASSERT outcome.exitCode <> 0
  ASSERT NOT artifactPublishable(outcome)
END FOR

// Property: Fix Checking — a valid build emits a complete CSP
FOR ALL X WHERE NOT isBugConditionC3(X) DO
  dist ← build'(X)
  ASSERT dist['_headers'] CONTAINS 'Content-Security-Policy'
  ASSERT dist['_headers'] CONTAINS httpsOrigin(X.VITE_SUPABASE_URL)
  ASSERT dist['_headers'] CONTAINS wssOrigin(X.VITE_SUPABASE_URL)
  ASSERT dist['_headers'] CONTAINS NO marker token
END FOR
```

2.16 WHEN `public/_headers` is authored THEN it SHALL contain the marker tokens `__SUPABASE_HTTP_SRC__` and `__SUPABASE_CONNECT_SRC__` inside a `Content-Security-Policy` directive, and its header comment SHALL be rewritten to record that **this supersedes the earlier deliberate decision to delegate CSP to the hosting platform**. This is an explicit reversal, not an oversight correction: the earlier decision was made because the Supabase project URL is only known at build time, and the reversal is now safe precisely because 2.18 makes the build validate and inject that URL. Platforms that ignore `_headers` still require equivalent configuration, and the comment SHALL say so.

2.17 WHEN a production build runs THEN `vite.config.ts` SHALL require `VITE_SUPABASE_URL` and either `VITE_SUPABASE_PUBLISHABLE_KEY` or the existing `VITE_SUPABASE_ANON_KEY` fallback (`src/lib/supabase.ts:10`), and SHALL fail with a non-zero exit code and a message naming the missing variable when any required value is absent or empty.

2.18 WHEN `VITE_SUPABASE_URL` is provided THEN the build SHALL reject any non-HTTPS URL except a `localhost` or `127.0.0.1` origin, and SHALL reject a value that is not a parseable absolute URL.

2.19 WHEN a production build succeeds THEN the build SHALL replace `__SUPABASE_HTTP_SRC__` with the validated `https://` origin and `__SUPABASE_CONNECT_SRC__` with both the `https://` and the corresponding `wss://` origin in `dist/_headers`, and `dist/` SHALL contain zero occurrences of either marker token. Real secrets and real project URLs SHALL remain out of tracked files — the markers, not values, are what is committed.

#### C4 — Theme tokens on every themed surface

```pascal
FUNCTION isBugConditionC4(X)
  INPUT: X of type ClassNameOccurrence
  OUTPUT: boolean

  // Palette-literal surface/border/text utilities, INCLUDING opacity variants
  // such as bg-white/60, which audit item 21 records as defeating the earlier fix.
  RETURN X.utility MATCHES
    /^(bg|border|divide|from|to|via|ring|text|placeholder|shadow)-(white|black|gray|slate|zinc|neutral|stone)(-[0-9]{2,3})?(\/[0-9]{1,3})?$/
    AND X.file IN guardedFiles
    AND NOT isThemeInvariantAccentForeground(X)
END FUNCTION

// Property: Fix Checking
FOR ALL X WHERE isBugConditionC4(X) DO
  ASSERT occurrenceCount'(X) = 0
END FOR
```

2.20 WHEN the theme is dark THEN `src/components/InstallPromptBanner.tsx`, `src/components/CycleSupportSection.tsx`, `src/pages/RecordPage.tsx` and `src/pages/TripsPage.tsx` SHALL render surfaces, borders and text using the existing theme tokens defined in `src/styles/index.css` — `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-card-foreground`, `text-muted-foreground`, `border-border`, plus the semantic tokens `destructive`, `warning`/`warning-surface`, `info`/`info-surface`, `success`/`success-surface` and the brand tokens `coral`, `lilac`, `mint`, `cream`, `navy` — and SHALL NOT introduce new tokens.

2.21 WHEN a translucent surface is required THEN it SHALL use an opacity variant of a theme token (for example `bg-card/60`) rather than a palette literal, so `bg-white/80`, `bg-white/60` and `bg-white/40` in `src/pages/RecordPage.tsx` (385, 390, 396) and `bg-white/60` in `src/components/CycleSupportSection.tsx` (363) are eliminated rather than merely overridden.

2.22 WHEN `src/lib/themeTokens.test.ts` is added THEN it SHALL fail on palette literals **including opacity variants** in the four files named in 2.20, and its file scope SHALL be an explicit list with a documented reason for every exclusion. The three additional files that match the pattern SHALL each be resolved explicitly:
- `src/pages/ServicePage.tsx:145,149` — `bg-white/20`, `bg-white/10` over a coral gradient: verify against the dark theme and either convert or record as a theme-invariant accent overlay.
- `src/pages/SchedulePage.tsx:464` — `bg-slate-500`, `bg-white`: verify and resolve.
- `src/pages/OnboardingPage.tsx:624` — `border-white`: verify and resolve.

2.23 WHEN a token renders foreground text on a fixed-hue accent surface THEN the guard SHALL permit it, because `--coral-foreground` is white in both themes; such occurrences SHALL be expressed as the paired foreground token (for example `text-coral-foreground` on `bg-coral`) so intent is legible rather than accidental.

#### C5 — Clean build output and recorded dependency decisions

```pascal
FUNCTION isBugConditionC5(X)
  INPUT: X of type ProductionBuildOutput
  OUTPUT: boolean

  RETURN X.warnings CONTAINS mixedStaticDynamicImport
      OR X.warnings CONTAINS largeChunk
END FUNCTION

// Property: Fix Checking — warnings removed without behavioural change
FOR ALL X WHERE isBugConditionC5(X) DO
  out ← build'(X)
  ASSERT out.warnings CONTAINS NO mixedStaticDynamicImport
  ASSERT out.warnings CONTAINS NO largeChunk
  ASSERT observableBehaviour(out) = observableBehaviour(X)
END FOR
```

2.24 WHEN `@/lib/events` is used inside `src/lib/store.tsx` THEN the system SHALL use the existing static import at line 19 and SHALL remove the duplicate dynamic `await import('@/lib/events')` calls at lines 1397, 1438 and 1479, preserving each call site's current behaviour exactly.

2.25 WHEN `@capacitor/browser` is used inside `src/lib/supabase.ts` THEN the duplicate dynamic import at line 450 SHALL be replaced with a static import matching `src/lib/deepLinks.ts:2`, and the change SHALL NOT alter the `isNativePlatform()` guard that keeps `Browser.open` off the web path.

2.26 WHEN `npm run build` runs THEN `vite.config.ts` SHALL configure `build.rollupOptions.output.manualChunks` vendor splitting sufficient to remove the large-chunk warning, and SHALL NOT change module evaluation order in a way that alters observable behaviour; the existing `injectServiceWorkerManifest` plugin SHALL continue to enumerate every emitted asset under `dist/assets` so an offline activation still finds all chunks.

2.27 WHEN `brace-expansion` is addressed THEN the system SHALL first **verify against the npm registry** whether patched releases matching the handoff's claim (1.1.18 on the 1.x line, 5.0.9 on the 5.x line) actually exist, since audit section 7-3 concluded no patched 1.x exists (vulnerable range `<=5.0.7`). The system SHALL apply an `overrides` change **only if** registry verification confirms a patched release on the line that `minimatch@3` can consume via CJS `require`. `npm run lint` SHALL pass with zero errors and zero warnings afterwards. `npm audit fix --force` SHALL NOT be run. If verification fails, the system SHALL record the acceptance with the same reasoning as audit section 7-3 and leave the lockfile at `1.1.16`.

2.28 WHEN the react-router 7.18.2 / GHSA-qwww-vcr4-c8h2 advisory is addressed THEN the system SHALL record it as a **documented conditional acceptance** in `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`, stating the preconditions that make it inapplicable — a static Vite SPA using `BrowserRouter` only, with no Framework Mode, no RSC, no `loader`, no `action`, no `useFetcher`, no react-router `<Form>` and no server routes — together with its **invalidation trigger**: adopting any one of those features invalidates the acceptance and forces re-evaluation. A blind downgrade to 7.11.0 and a major-version upgrade are both forbidden by this requirement.

#### Verification gates

2.29 WHEN the fix is presented for review THEN all of the following gates SHALL be executed on the working branch and their results recorded:

| # | Gate | Requirement |
| --- | --- | --- |
| a | `npm ci` | Completes from the committed lockfile |
| b | `npm run typecheck` | 0 errors |
| c | `npm run lint` | 0 errors, 0 warnings |
| d | `npm test` | Full suite passes (baseline: 152 tests / 21 files, plus the new tests from 2.15 and 2.22) |
| e | `npm run build` | Succeeds using **only** temporary non-secret placeholders `VITE_SUPABASE_URL=https://example.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key-not-a-secret`; no mixed-import warning, no large-chunk warning |
| f | Negative build test | A production build with the required variables **absent** exits non-zero, proving 2.17 |
| g | Marker assertion | `dist/` contains zero occurrences of `__SUPABASE_HTTP_SRC__` and `__SUPABASE_CONNECT_SRC__`, proving 2.19 |
| h | `npm audit` | Run and reported; every remaining advisory is covered by a recorded decision under 2.27 or 2.28 |
| i | Secret scan | No JWT-shaped strings, no `service_role` values, no real Supabase project URL, no keystore or certificate files, no tracked `.env` |
| j | `git diff --check` | No whitespace errors and no conflict markers |

2.30 WHEN gate 2.29(e) is run THEN the placeholder values SHALL be supplied for that invocation only and SHALL NOT be written into any tracked file, so 2.19's prohibition on committing real or placeholder project URLs is not circumvented by the verification itself.

---

### Unchanged Behavior (Regression Prevention)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugConditionC1(X) OR isBugConditionC2(X)
                  OR isBugConditionC3(X) OR isBugConditionC4(X)
                  OR isBugConditionC5(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

#### Product functionality

3.1 WHEN a user creates, reads, updates, deletes or reorders schedule events — monthly calendar, six event types, multi-day ranges, D-Day, author-only private events, active-couple sharing — THEN the system SHALL CONTINUE TO behave exactly as at `7d82e3e`.

3.2 WHEN a user uses the trips planner — trips, per-day items, manual places, memos, `http(s)` links, checklists, joint editing, date-ranged record views — THEN the system SHALL CONTINUE TO behave exactly as at `7d82e3e`.

3.3 WHEN a user uses cycle tracking and the opt-in minimal support signal — start, end, symptoms, memos, settings, private calendar, next-start estimate, same-day and 24-hour bounds, 80-character message, immediate withdrawal — THEN the system SHALL CONTINUE TO behave exactly as at `7d82e3e`.

3.4 WHEN a user creates records with photo, video or voice attachments through the two-phase upload THEN the system SHALL CONTINUE TO succeed, SHALL CONTINUE TO preserve the body text when an attachment fails, and SHALL CONTINUE TO store paths rather than expiring signed URLs.

3.5 WHEN couple functionality is exercised — invitation creation, redemption throttling, `pending` link cancellation, disconnect, role switch, membership revocation, and `live`/`delayed`/`unavailable` shared-sync status with its banner and retry — THEN the system SHALL CONTINUE TO behave exactly as at `7d82e3e`.

3.6 WHEN a record author has marked emotion items private THEN the system SHALL CONTINUE TO filter `author_only` items before writing and defensively on read.

3.7 WHEN a user signs out, switches accounts, or completes a fully successful account deletion THEN the system SHALL CONTINUE TO use the existing `purgeLocalAccountData` path unchanged, including clearing `authenticatedUser`, bumping the session generation, and setting the cache-purged flag so the save effect cannot resurrect the previous account's cache.

3.8 WHEN the app runs in demo mode THEN the system SHALL CONTINUE TO survive a page refresh via `INITIAL_SESSION`, SHALL CONTINUE TO accept only invitation code `123456`, SHALL CONTINUE TO activate only when `!supabase`, and SHALL CONTINUE TO strip `blob:` attachment URLs before persisting.

#### Configuration and theming

3.9 WHEN `VITE_SUPABASE_PUBLISHABLE_KEY` is absent but `VITE_SUPABASE_ANON_KEY` is present THEN the system SHALL CONTINUE TO accept the `VITE_SUPABASE_ANON_KEY` fallback exactly as `src/lib/supabase.ts:10` does today, and the new build-time validation SHALL treat that fallback as satisfying the key requirement.

3.10 WHEN the existing non-CSP security headers are served THEN `_headers` SHALL CONTINUE TO deliver `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()` and `X-DNS-Prefetch-Control: off` unchanged.

3.11 WHEN a device has never chosen a theme THEN the system SHALL CONTINUE TO honour `prefers-color-scheme`, and `widgetLayout`, `hasSeenInstallPrompt` and `theme` SHALL CONTINUE TO survive sign-out and account switches.

3.12 WHEN the theme changes THEN the light and dark token values in `src/styles/index.css` SHALL CONTINUE TO be exactly as at `7d82e3e`; C4 changes consumers only, and SHALL NOT redefine, rename or add tokens, and SHALL NOT alter `LIGHT_THEME_COLOR = '#FAF8F5'` or `DARK_THEME_COLOR = '#16181D'` in `src/lib/store.tsx`.

3.13 WHEN the light theme is rendered THEN every surface touched by C4 SHALL CONTINUE TO look as it does today, so the dark-theme fix is not a light-theme redesign.

#### Build and dependencies

3.14 WHEN a service worker activates while offline THEN the system SHALL CONTINUE TO find every hashed asset in its injected manifest, and the `SERVICE_WORKER_ASSET_MARKER` / `SERVICE_WORKER_BUILD_ID` guard in `vite.config.ts` SHALL CONTINUE TO throw when its markers are missing.

3.15 WHEN dependencies are resolved THEN `react-router` and `react-router-dom` SHALL CONTINUE TO be pinned at `7.18.2`, and `src/main.tsx` SHALL CONTINUE TO use `BrowserRouter` in declarative mode with no `loader`, `action`, `useFetcher`, react-router `<Form>`, Framework Mode or RSC usage.

3.16 WHEN `npm run lint` runs after any dependency change THEN it SHALL CONTINUE TO exit with 0 errors and 0 warnings; a `brace-expansion` change that breaks `minimatch@3`'s CJS `require` is a regression, not a fix.

3.17 WHEN the Edge Function receives a valid `POST` from an allowlisted origin with a valid bearer token THEN it SHALL CONTINUE TO execute the existing deletion sequence unchanged: read-only record preflight, `begin_account_deletion`, `removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` and `MAX_STORAGE_DEPTH = 8`, `prepare_account_deletion`, then `deleteUser` with `AUTH_DELETE_ATTEMPTS = 3` and marker cleanup on failure. C2 adds an origin gate in front of this sequence and changes nothing inside it.

3.18 WHEN the working branch is assembled THEN the older divergent 19-commit local branch SHALL NOT be merged or cherry-picked wholesale, and the branch SHALL CONTINUE TO descend from `7d82e3efd1b17283b0e8f086e94cf97cf268b625` alone.

3.19 WHEN this bugfix is scoped THEN Android and native work SHALL CONTINUE TO be deferred: `capacitor.config.ts`, the `cap:*` scripts and the Android shell SHALL remain unmodified, and no unrelated product feature SHALL be added.

#### Release gates that remain out of scope

Each item below requires explicit credentials and human approval. They SHALL be
reported as release gates, not silently attempted.

3.20 WHEN this fix is completed THEN staging deployment SHALL CONTINUE TO be unperformed.

3.21 WHEN this fix is completed THEN production deployment SHALL CONTINUE TO be unperformed.

3.22 WHEN this fix is completed THEN migrations `013_invitation_hardening.sql`, `014_feature_privacy_and_collaboration.sql` and `015_security_followup.sql` SHALL CONTINUE TO be unapplied remotely, and no database mutation or migration SHALL be executed; the `013 → 014 → 015` order and the ambiguous duplicate `002_*` ordering SHALL CONTINUE TO be flagged in the checklist.

3.23 WHEN this fix is completed THEN the `delete-account` Edge Function SHALL CONTINUE TO be undeployed, and `ALLOWED_ORIGINS` SHALL CONTINUE TO be unset in any remote environment until an operator sets it per 2.14.

3.24 WHEN this fix is completed THEN real two-account end-to-end deletion testing — and every other item in `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md`, including whether `LOCK TABLE storage.objects IN SHARE MODE` is permitted on Supabase hosting — SHALL CONTINUE TO be unperformed and SHALL remain a human gate.

3.25 WHEN this fix is completed THEN no merge into the default branch SHALL be performed; the work SHALL be delivered on `integration/kimi-web-stabilization` for review.
