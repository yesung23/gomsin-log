# Web Release Stabilization Bugfix Design

## Overview

This design fixes the five defect clusters that block the 곰신로그 web release, on the working
branch `integration/kimi-web-stabilization` at `7d82e3efd1b17283b0e8f086e94cf97cf268b625`.

| ID | Defect | Fix strategy in one line |
| --- | --- | --- |
| C1 | Partial account deletion is misreported and leaves private data on screen | Read the error response body, classify the outcome into a typed union, purge in-memory content while retaining identity, and route to a recovery screen |
| C2 | `delete-account` Edge Function accepts any browser origin | Replace the wildcard with a fail-closed `ALLOWED_ORIGINS` allowlist in a new shared module, always sending `Vary: Origin` |
| C3 | Build ships no CSP and silently accepts missing Supabase config | Add build-time environment validation and marker-token CSP injection into `dist/_headers` |
| C4 | Light-only hard-coded surfaces break dark theme | Convert palette literals (including opacity variants) to existing theme tokens in four files, guarded by a new test |
| C5 | Build and dependency hygiene unresolved and unrecorded | Remove duplicate dynamic imports, add `manualChunks`, verify the `brace-expansion` claim against the registry, and record dependency decisions |

Every fix is a defect repair, not a redesign. C4 changes consumers only and never touches token
definitions. C2 adds a gate in front of the deletion sequence and changes nothing inside it. C5
must be behaviour-neutral by construction.

**Verified baseline.** `git branch --show-current` reports `integration/kimi-web-stabilization`
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
`deleteAccount` (`store.tsx:1687`) then returns at `if (!result.ok) return result;` before
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
  `isCurrentIdentity` guard (`store.tsx:1683`) still prevents clearing B's session.

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
- Edge case: `brace-expansion@1.1.16` under `eslint → minimatch@3`. *Expected:* registry
  verification, then either a safe `overrides` bump or a recorded acceptance. *Actual:* an
  unverified handoff claim of 1.1.18 conflicting with audit section 7-3.

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
  sequence unchanged: record preflight, `begin_account_deletion`,
  `removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` / `MAX_STORAGE_DEPTH = 8`,
  `prepare_account_deletion`, then `deleteUser` with `AUTH_DELETE_ATTEMPTS = 3` and marker
  cleanup on failure (3.17).

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
3. **Purge coupled to total success.** `store.tsx:1687` gates `purgeLocalAccountData` on
   `result.ok`, so the one path that clears the exposure is the one path a partial deletion never
   takes.
4. **No recovery state.** Neither `StoreContextType` (`src/lib/storeContext.ts:12-39`) nor
   `StoreProvider` exposes any recovery flag, so `App.tsx` has nothing to branch on and keeps
   rendering all ten authenticated routes.
5. **Purge is all-or-nothing.** `purgeLocalAccountData` always clears `authenticatedUser`. A
   partial deletion needs the opposite: clear content, keep identity, because the identity is
   what the retry needs.

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

### C5 — Duplicate import styles and an unverified upstream claim

1. **Redundant dynamic imports.** `store.tsx` already imports `@/lib/events` statically at line
   19, so the three `await import('@/lib/events')` calls add a warning and no benefit. Same for
   `@capacitor/browser`, static at `deepLinks.ts:2` and dynamic at `supabase.ts:450`.
2. **No chunk strategy.** `vite.config.ts` declares no `build.rollupOptions.output.manualChunks`,
   so React, Supabase, dnd-kit, date-fns and lucide-react all land in one chunk.
3. **Unverified registry claim.** The handoff demands `brace-expansion@1.1.18`; audit section 7-3
   concluded no patched 1.x exists and rejected an `overrides` bump because `minimatch@3` uses CJS
   `require` while 5.x changed its exports. The lockfile resolves to 1.1.16. The claim must be
   checked before any change.
4. **Decisions recorded in the wrong document.** The react-router acceptance lives only in
   `docs/kiro/RELEASE_AUDIT_2026-07-31.md`, which a maintainer changing dependencies has no
   reason to open.

---

## Correctness Properties

Property 1: Bug Condition - Partial deletion is classified truthfully and contained

_For any_ deletion response where `isBugConditionC1` holds (non-2xx status carrying
`dataRemoved: true`), the fixed `deleteAccount` SHALL return an outcome whose status is
`partially_deleted` with `dataRemoved: true`, SHALL purge all in-memory and on-disk personal,
couple, content and cache data while retaining only the authenticated identity and the three
device preferences (`widgetLayout`, `hasSeenInstallPrompt`, `theme`), SHALL set
`accountDeletionRecovery`, and SHALL block every authenticated route in favour of a recovery
screen offering exactly retry and logout. A response body that cannot be read or parsed SHALL
instead be classified `failed` with `dataRemoved: false`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Successful and total-failure deletion paths are unchanged

_For any_ deletion response where `isBugConditionC1` does NOT hold — a `200 { success: true }`
success, or a failure with `dataRemoved: false` — the fixed code SHALL produce the same result as
the original: success still runs `purgeLocalAccountData` and signs out with the existing
media-warning toast, and total failure still leaves the account fully intact, performs no purge,
does not enter recovery, and shows the existing generic retry message. Sign-out and account
switching SHALL continue to use `purgeLocalAccountData` unchanged, and demo-mode deletion SHALL
continue to purge locally and report success.

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
invalid or expired token), and a verified caller still runs the existing deletion sequence
byte-for-byte, including the read-only record preflight, `begin_account_deletion`,
`removeAndConfirmRecordMedia` with `MAX_STORAGE_ROUNDS = 20` / `MAX_STORAGE_DEPTH = 8`,
`prepare_account_deletion`, `deleteUser` with `AUTH_DELETE_ATTEMPTS = 3`, and marker cleanup on
failure. An allowed preflight SHALL still advertise methods `POST, OPTIONS` and headers
`authorization, apikey, content-type, x-client-info`.

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
`npm run lint` at 0 errors and 0 warnings, SHALL apply a `brace-expansion` `overrides` change
only if npm-registry verification confirms a patched release that `minimatch@3` can consume via
CJS `require` — otherwise recording the acceptance and leaving the lockfile at `1.1.16` — SHALL
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
allowance as an explicit accepted risk — and SHALL have executed and recorded all ten verification
gates 2.29(a)-(j) on the working branch: `npm ci`, `npm run typecheck` at 0 errors,
`npm run lint` at 0 errors and 0 warnings, `npm test` over the full suite, `npm run build` with
non-secret placeholders and no import or chunk warnings, a negative build exiting non-zero, zero
marker tokens in `dist/`, a reported `npm audit` with every advisory covered by a recorded
decision, a clean secret scan, and a clean `git diff --check`.

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
     `saveState` path so only `carryOverDevicePrefs` persists.
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
5. **Recovery state.** Add `accountDeletionRecovery: { warnings: string[] } | null` to
   `StoreContextType` (`src/lib/storeContext.ts`) and to the provider value, plus
   `retryAccountDeletion()` and reuse of the existing `signOut()` for the logout action. One
   authoritative flag; no consumer infers recovery from route or toast state.
6. **`deleteAccount` rewrite.** Return `AccountDeletionOutcome`. Keep the demo-mode short-circuit
   and the `isCurrentIdentity(identity)` guard at line 1683 exactly as they are, then branch:
   `deleted` → existing `purgeLocalAccountData` + `signOut` (unchanged path, per 3.7);
   `partially_deleted` → `purgeLocalContentRetainingIdentity` + set recovery;
   `failed` → return unchanged, no purge, no recovery.
7. **Retry semantics.** `retryAccountDeletion` re-invokes the same path. `deleted` clears
   recovery, purges identity and signs out (2.7). `partially_deleted` or `failed` stays in
   recovery and re-fetches nothing (2.6).

**File**: `src/App.tsx`

8. **Route gate.** When `accountDeletionRecovery` is non-null, render only the recovery screen for
   every path except `/auth/callback` and `/legal/:doc`, which must stay reachable. The gate sits
   beside the existing `authSyncUnavailable` branch (`App.tsx:80-90`), reusing an established
   pattern rather than inventing routing.

**File**: `src/pages/SettingsPage.tsx`

9. **Honest messaging.** Replace the generic toast at line 765 **for the `partially_deleted`
   outcome only**: state that the user's data has been deleted but the login account has not, and
   that deletion must be completed. `failed` keeps
   `계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.`; `deleted` keeps its existing
   `media_not_fully_removed` warning toast.

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
   existing bearer check at `:152-157` and the sequence below it.

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

4. `brace-expansion`: query the npm registry for the actual published versions before touching
   anything. Apply an `overrides` entry **only if** a patched release exists on a line that
   `minimatch@3` can consume via CJS `require`, and only if `npm run lint` still reports 0
   errors and 0 warnings afterwards. Otherwise record the acceptance with audit section 7-3's
   reasoning and leave the lockfile at `1.1.16`. Never run `npm audit fix --force`.
5. `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md`: record the react-router 7.18.2 /
   GHSA-qwww-vcr4-c8h2 conditional acceptance — static Vite SPA, `BrowserRouter` only, no
   Framework Mode, no RSC, no `loader`, no `action`, no `useFetcher`, no react-router `<Form>`,
   no server routes — with its invalidation trigger: adopting any one of those features voids the
   acceptance. Both a downgrade to 7.11.0 and a major upgrade are forbidden.

### Deliberate design decisions and residual risks

These are recorded rather than papered over, in the style the requirements set.

1. **Recovery state is in-memory only, and a page refresh escapes it.** Requirement 2.4 fixes the
   persisted key set exactly, and no key is allocated for a recovery flag; the Edge Function has
   already cleared its server-side deletion marker. So after a refresh the user lands in a
   signed-in app with empty data and no recovery screen. Persisting a new key would contradict
   2.4's table, so this design keeps recovery in memory and flags the gap for a decision rather
   than silently inventing storage.
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

---

## Testing Strategy

### Validation Approach

Two phases. First, surface counterexamples on the **unfixed** code at `7d82e3e` to confirm or
refute each root-cause hypothesis — if a hypothesis is refuted, re-hypothesize before writing the
fix. Then verify the fix holds for all buggy inputs (fix checking) and that behaviour is unchanged
for all non-buggy inputs (preservation checking).

Baseline to preserve: **152 tests across 21 files**, plus the new suites from 2.15 and 2.22.

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
   `authenticatedUser` survives (will fail on unfixed code — `store.tsx:1687` returns early).
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

**Expected Counterexamples**:
- C1: `deleteAccountFromDB` returns `{ ok: false, warnings: [] }` for a `dataRemoved: true`
  response, and `AppState` remains fully populated afterwards.
  Possible causes: `error.context` never read; two-valued return type; purge gated on
  `result.ok`; no recovery state in `StoreContextType`.
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
14. **Existing suite**: all 152 baseline tests across 21 files continue to pass.

### Unit Tests

- **C1**: `classifyDeletionSuccess` / `classifyDeletionErrorBody` / `coerceWarnings` over success,
  partial, total-failure, missing-field, wrong-type and unparseable bodies;
  `deleteAccountFromDB` against mocked `FunctionsHttpError`, `FunctionsFetchError` and
  `FunctionsRelayError`; `purgeLocalContentRetainingIdentity` asserting the 2.4 key-level split
  key by key, including that `authenticatedUser` and the three device preferences survive;
  `deleteAccount` branch selection for all three outcomes; retry success, retry failure and
  logout from recovery; the `isCurrentIdentity` guard under an account switch mid-flight.
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
  `authenticatedUser`, `widgetLayout`, `hasSeenInstallPrompt` and `theme` are preserved.
- **C3 URL validation**: generate URL strings and assert acceptance exactly when the value is a
  parseable absolute URL that is `https:` or a `localhost`/`127.0.0.1` origin.
- **C4 guard soundness**: generate synthetic class strings and assert the guard regex flags
  palette literals with and without numeric and opacity suffixes and never flags theme tokens.

### Integration Tests

- **C1 full recovery flow**: partial-deletion response → recovery screen → failed retry stays in
  recovery with nothing re-fetched → successful retry clears recovery, purges identity and signs
  out; and the alternative logout path, which must not present the account as deleted.
- **C1 routing**: with recovery active, all eight authenticated routes render the recovery screen
  while `/auth/callback` and `/legal/:doc` remain reachable.
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
- **Release gates 2.29(a)-(j)**: `npm ci`; `npm run typecheck` (0 errors); `npm run lint`
  (0 errors, 0 warnings); `npm test` (152 baseline plus new suites); `npm run build` with
  placeholders and no warnings; negative build exits non-zero; zero marker tokens in `dist/`;
  `npm audit` reported with every remaining advisory covered by a recorded decision under 2.27 or
  2.28; secret scan finding no JWT-shaped strings, no `service_role` values, no real project URL,
  no keystore or certificate files and no tracked `.env`; `git diff --check` clean.
