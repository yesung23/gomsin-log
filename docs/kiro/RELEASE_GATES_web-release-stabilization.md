# Release gate record — `kimi/web-release-stabilization`

Branch base: `7d82e3efd1b17283b0e8f086e94cf97cf268b625`
Recorded because no verification result existed for this baseline (clause 1.24).
Node 22.23.1 / npm 11.4.2.

## Measured bug conditions on the unfixed baseline

Confirmed by checking out `7d82e3e` into a throw-away worktree, copying **only**
the new test files onto it, and running them. Every new suite either failed to
resolve (the module it tests did not exist) or failed its assertions.

| Cluster | Counterexample measured at `7d82e3e` |
| --- | --- |
| C1 | `src/lib/accountDeletion.ts` absent; `deleteAccountFromDB` typed `Promise<{ ok: boolean; warnings: string[] }>`; **zero** reads of `error.context`; **zero** occurrences of `deletionStatus` / `accountDeletionRecovery` in `storeContext.ts`; **zero** occurrences of `account_deletion_pending` in the Edge Function |
| C2 | `'Access-Control-Allow-Origin': '*'` at `index.ts:19`; **zero** `Vary` headers |
| C3 | **zero** CSP marker tokens and **zero** `Content-Security-Policy` lines in `public/_headers` |
| C4 | **18 / 2 / 16 / 24** palette-literal matches in `InstallPromptBanner.tsx`, `CycleSupportSection.tsx`, `RecordPage.tsx`, `TripsPage.tsx` — exactly the figures the specification recorded |
| C5 | **3** `await import('@/lib/events')` in `store.tsx`; **1** `await import('@capacitor/browser')` in `supabase.ts`; no `manualChunks`; no `overrides` |

Every hypothesis in `design.md` was **confirmed**; none was refuted, so no
re-hypothesising was required.

## Gates 2.29(a)-(l)

| Gate | Command | Result |
| --- | --- | --- |
| (a) | `npm ci` | exit 0, from the committed lockfile including the new `overrides` entry |
| (b) | `npm run typecheck` | exit 0, **0 errors** |
| (c) | `npm run lint` | exit 0, **0 errors / 0 warnings** — also the proof that the `brace-expansion` pin did not break `minimatch@3`'s CJS `require` |
| (d) | `npm test` | **303 passed / 303**, **30 files / 30**. Baseline was **206 / 23**; **+97 tests, +7 files, zero pre-existing tests removed or skipped** |
| (e) | positive `npm run build` | exit 0. **0** mixed static/dynamic import warnings, **0** large-chunk warnings. Largest chunk **341.07 kB / 105.05 kB gzip** (was ~520 kB / 151 kB) |
| (f) | negative `npm run build` | exit **1** in every case, naming the missing variable: all absent, URL absent, both keys absent, non-HTTPS non-loopback URL. `VITE_SUPABASE_ANON_KEY`-only still **succeeds** (exit 0) |
| (g) | marker assertion | **0** occurrences of `__SUPABASE_HTTP_SRC__` and **0** of `__SUPABASE_CONNECT_SRC__` anywhere in `dist/`. `dist/_headers` names the injected origin in `img-src`/`media-src` and both the `https://` and `wss://` origins in `connect-src`. The five non-CSP headers are **byte-identical** to `7d82e3e` |
| (h) | `npm audit` | **3 -> 2** advisories. `brace-expansion` GHSA-mh99-v99m-4gvg **resolved**. The two remaining are `react-router` / `react-router-dom` GHSA-qwww-vcr4-c8h2, covered by the recorded conditional acceptance. `npm audit fix --force` was **never run** |
| (i) | secret scan | **0** JWT-shaped strings, **0** `service_role` values, **0** real project URLs, **0** keystore/certificate files, no tracked `.env` (only `.env.example`). The build placeholders appear in **no source or configuration file** — only in the specification documents that prescribe them |
| (j) | `git diff --check` | exit 0 for `HEAD` and for the whole `7d82e3e..HEAD` range: no whitespace errors, no conflict markers |
| (k) | Deletion-Recovery Suite | **24 passed / 24** across `accountDeletionRecovery.test.tsx` and `deleteAccountFunction.test.ts` |
| (l) | Tri-State Verification Suite | **38 passed / 38** across `accountDeletion.test.ts` and `accountDeletionRecovery.test.tsx` |

### Gate (k) roll call

1. marker created on partial deletion — boolean-only, no warnings or content, identity retained — **PASS**
2. logout preserves the marker and does not present the account as deleted — **PASS**
3. same-user re-login resumes recovery before any fetched state is applied — **PASS**
4. another user reaches normal routes; the first marker is neither deleted nor overwritten — **PASS**
5. malformed marker fails closed, including the negative `removeItem` assertion — **PASS**
6. clean browser blocked by server metadata, with **provenance** proven to be the `getUser()` round-trip and not `session.user.app_metadata` — **PASS**
7. pending-flag write failure blocks **all** application-data deletion; `dataRemoved: false`; account fully intact — **PASS**
8. a successful retry deletes the Auth user **before** clearing the marker (ordering asserted) — **PASS**
9. normal routes inaccessible throughout, across all eight authenticated routes, before retry / after a failed retry / after remount / after logout and re-login; `/auth/callback` and `/legal/:doc` remain reachable; no override offered — **PASS**

### Gate (l) roll call

1. classification total and mutually exclusive across all **nine** marker x answer combinations; malformed => `pending` in all three answer columns; key never removed — **PASS**
2. a `getUser()` timeout / rejection / offline failure yields **`unknown`**, never `clear`, distinct in its logged and serialized form, **including the type-level `@ts-expect-error` assertions** that `boolean`, `boolean | null`, an optional flag, a bare string and a fourth variant all fail to type-check, and that a `switch` missing the `unknown` arm fails `assertNever` — **PASS**
3. an offline **initiating** device is blocked by its marker alone, before first render, with **no `getUser()` round-trip** — **PASS**
4. an offline **secondary** device re-issues the authoritative check **before** synchronization (driven through the `online` handler) and **before** a mutation, asserted on **request ordering**; a second attempt re-issues rather than reusing; no elapsed time or retry count promotes `unknown` to `clear` — **PASS**
5. a retry that discovers `pending` aborts with **none of its writes applied**, asserted on **ordering** so a sync-then-reconcile implementation fails, then purges local content and enters recovery — **PASS**

## Unperformed human release gates

Reported as **not done**, not as work completed:

- staging deployment;
- production deployment;
- remote application of migrations `013_invitation_hardening.sql`,
  `014_feature_privacy_and_collaboration.sql`, `015_security_followup.sql` — the
  `013 -> 014 -> 015` order stands, and the ambiguous duplicate `002_*` ordering
  is still flagged;
- Edge Function deployment;
- setting `ALLOWED_ORIGINS` in any remote environment;
- the two-account end-to-end deletion test;
- any merge into the default branch.

## Deviations from the specification, stated plainly

1. **The Edge Function request handler was extracted** into
   `supabase/functions/delete-account/handler.ts`, with `index.ts` reduced to a
   Deno entrypoint injecting `Deno.env` and the service-role client. The plan
   assumed the logic would stay in `index.ts`, but clause 2.38 test 7 requires
   asserting that a flag-write failure deletes nothing, which is untestable while
   the module calls `Deno.serve` and imports `npm:` specifiers at top level. The
   deletion sequence is **moved, not changed** — every step, every constant, same
   order, proven by a step-for-step ordering assertion.
2. **Commit order is C2 before C1.** Both clusters rework the same Edge Function,
   and the extraction is atomic, so putting C2 first keeps each diff focused
   instead of forcing C1 to carry C2's change.
3. **C4 shifts the light-mode neutral.** Converting `gray-*` literals to the
   app's semantic tokens moves light mode from Tailwind's cool greys to the
   warm cream-based neutrals; the values are not byte-identical. It is a
   maintainability fix, not a dark-mode bug fix, because the existing
   `--color-gray-*` remap already handled those utilities in dark mode. The
   genuine dark-mode defect was `bg-white`/`bg-white/NN`, since `--color-white`
   is deliberately not remapped. Conversions of `bg-white/NN -> bg-card/NN` and
   the coral indicator dots **are** byte-identical in light mode, because `--card`
   and `--coral-foreground` are both `oklch(1 0 0)`.
4. **One coupled change beyond the letter of C4.** CycleSupportSection's mint
   card had `text-navy`, and `--navy` is dark in **both** themes, so converting
   its panel to `bg-card/60` without moving the text to the paired
   `text-mint-foreground` would have replaced one unreadable pairing with
   another. Identical in light mode.
5. **`bg-indigo-500 text-white` was changed to `text-indigo-50`.** The dark theme
   remaps `--color-indigo-500` to a *light* indigo, so white-on-indigo lost
   contrast; `indigo-50` is remapped the other way. Not named in the plan, but
   leaving it would have shipped a known low-contrast pairing.
6. **`src/lib/store.test.tsx` gained one line in `beforeEach`.** The shared test
   setup calls `vi.restoreAllMocks()`, which strips the `getUser` double's
   implementation, and the store now legitimately asks the server whether a
   deletion is pending before it syncs. No existing test was removed, skipped or
   weakened. `verifyDeletionStatus` also treats a throwing `getUser()` as
   `unavailable` rather than letting it escape as an unhandled rejection.

---

# Pre-publish audit

Three checks were run against the five implementation commits. **Two found real
issues**, both now fixed; the third was completed with real Deno rather than
being deferred.

## 1. Server-mutation gate inventory — BYPASS FOUND AND FIXED

The plan's gate inventory covered `refreshSlice`, `reconcileSharedAccess` and
every server-mutating method on `StoreContextType`. It did **not** cover the
data-layer modules whose mutations pages issue directly. A full sweep of the
client found **22 server mutations with no tri-state pre-flight**.

Requirement 2.45 says the authoritative check is retried "before the next server
synchronization **or any server mutation**", so this was a genuine bypass: while
status was `unknown`, these writes could recreate server rows for an account
whose data `prepare_account_deletion` had already removed. The route gate
mitigated it *after* recovery was entered — those pages cannot mount — but not
during the `unknown` window, which is precisely the window clause 2.45 exists for.

### Fix

One centralized mechanism, no redesign. `accountDeletion.ts` gained a gate
registry; `StoreProvider` registers its existing
`ensureNotPendingBeforeServerCall` on mount and clears it on unmount; each
data-layer mutation calls `serverCallBlockedByPendingDeletion()` first and
returns **its own existing failure value**. With no provider mounted the helper
is a no-op, so unit tests and demo mode behave exactly as before. Only `pending`
blocks; `clear` and `unknown` pass through, and because the gate is consulted on
every call, an `unknown` device re-verifies before every mutation.

### Inventory

| File / function | Verified before? | Pending aborts? | `unknown` re-verified | Note |
| --- | --- | --- | --- | --- |
| `store.tsx` `refreshSlice` (records/events/trips) | yes | yes, returns before the fetch | per call | already gated |
| `store.tsx` `reconcileSharedAccess` | yes | yes, before `get_my_active_couple_id` | per call | already gated; `online` handler funnels here |
| `store.tsx` `updateProfile` (`profiles`, `contact_preferences`, `saveCoupleAnniversary`) | yes | yes | per call | already gated |
| `store.tsx` `addRecord` / `addRecordWithMedia` (`saveRecordToDB`, `uploadRecordMedia`) | yes | yes, at phase zero | per call | already gated; no orphan row or object |
| `store.tsx` `updateRecord`, `deleteRecord` | yes | yes | per call | already gated |
| `store.tsx` `addEvent`, `updateEvent`, `deleteEvent`, `reloadEvents` | yes | yes | per call | already gated |
| `store.tsx` `cancelPendingLink`, `disconnect` (`disconnect_couple`) | yes | yes | per call | already gated |
| `trips.ts` `saveTripToDB`, `updateTripInDB`, `deleteTripFromDB`, `saveTripItemToDB`, `updateTripItemInDB`, `reorderTripItemsInDB`, `deleteTripItemFromDB`, `saveTripChecklistToDB`, `toggleTripChecklistInDB`, `deleteTripChecklistFromDB` | **was NO — now yes** | yes | per call | **10 fixed** |
| `cycle.ts` `saveCycleSettingsToDB`, `saveCycleEntryToDB`, `updateCycleEntryInDB`, `deleteCycleEntryFromDB`, `createCycleSupportSignalInDB`, `revokeCycleSupportSignalFromDB` | **was NO — now yes** | yes | per call | **6 fixed** |
| `supabase.ts` `createCoupleInvitation`, `consumeCoupleInvitation`, `regenerateCoupleInvitation` | **was NO — now yes** | yes | per call | **3 fixed**; in `createCoupleInvitation` the gate sits ahead of the caller-verification read too, so nothing at all is issued |
| `OnboardingPage.tsx` `profiles` + `contact_preferences` upserts | **was NO — now yes** | yes | per call | **1 fixed**, guarding both writes |
| `records.ts`, `events.ts`, `trips.ts` fetch/read helpers | via their gated caller | n/a (reads) | per call | reached only through gated store methods or gated sync |
| `supabase.ts` `deleteAccountFromDB` (`delete-account` invoke) | **exempt** | n/a | n/a | intentional: the path OUT of recovery |
| `store.tsx` `deleteAccount`, `retryAccountDeletion` | **exempt** | n/a | n/a | intentional: gating would trap the user |
| `store.tsx` `signOut`, `supabase.ts` `signOut` | **exempt** | n/a | n/a | intentional: logout must always work |
| `store.tsx` `verifyDeletionStatus` → `auth.getUser()` | **exempt** | n/a | n/a | intentional: it IS the verification |
| `signInWithOAuth`, `signInWithOtp`, `exchangeCodeForSession`, `setSession`, `getSession` | **exempt** | n/a | n/a | intentional: authentication needed to reach and complete recovery |
| `get_partner_profile` (`sync.ts`, partner poll, `SettingsPage`, `OnboardingPage`) | via gated hydration / poll | n/a (read) | per call | read-only; discloses nothing new and writes nothing |

Regression tests added: `src/lib/serverCallGate.test.ts` (registry semantics plus
all sixteen trips/cycle mutations aborting with **zero** requests issued) and
`src/lib/invitationGate.test.ts` (the three invitation RPCs, driven with a
configured client and a `fetch` spy, since an unconfigured client never reaches
the guard). Both include preservation cases proving `clear` and `unknown` still
let every call through.

## 2. `brace-expansion` topology — RANGE VIOLATION FOUND AND FIXED

`npm ls brace-expansion --all` showed the global override was forcing 1.1.18 into
consumers that require the 5.x line:

| Consumer | Declares | Resolved (before) | Verdict |
| --- | --- | --- | --- |
| `minimatch@3.1.5` (eslint) | `^1.1.7` | 1.1.18 | correct |
| `minimatch@10.2.5` (typescript-eslint) | `^5.0.5` | **1.1.18** | **VIOLATION** |
| `minimatch@10.2.6` (@capacitor/cli → rimraf → glob) | `^5.0.8` | **1.1.18** | **VIOLATION** |

Latent rather than visible: 1.x is a single CommonJS export while 5.x uses named
exports, and neither `minimatch@10` path is exercised by our lint config or by
any script we run, so no gate caught it.

Replaced with a scoped override:

```json
"overrides": { "minimatch@3": { "brace-expansion": "1.1.18" } }
```

After (proved with npm's own semver, every range satisfied):

| Consumer | Declares | Resolved | Verdict |
| --- | --- | --- | --- |
| `minimatch@3.1.5` | `^1.1.7` | **1.1.18** | patched 1.x |
| `minimatch@10.2.5` | `^5.0.5` | **5.0.9** | patched 5.x |
| `minimatch@10.2.6` | `^5.0.8` | **5.0.9** | patched 5.x |

5.x is outside the advisory's affected ranges, so it needs no pin. The lockfile
was **not** regenerated from scratch — a full regeneration touched 241/217 lines,
so the committed lockfile was restored and `npm install` applied the override
incrementally (46/36 lines). `npm audit fix --force` was never run, and
`brace-expansion` no longer appears in `npm audit` at all.

`src/lib/bundleHygiene.test.ts` now asserts the override is scoped **and** checks
the structural invariant: every consumer resolves within its own declared major.

## 3. Deno Edge Function validation — COMPLETED, NOT DEFERRED

Deno was not installed; it was installed (2.9.4) and both available validations
were run for real.

- `npm run check:edge` → `deno check` passes on `_shared/cors.ts`,
  `delete-account/handler.ts` and `delete-account/index.ts`, the last with the
  real `npm:@supabase/supabase-js@2` specifier and the real `Deno` globals.
- `npm run test:edge` → three integration tests, **stubbing no Deno API at all**.
  `index.ts` is spawned as a genuine subprocess, so the real `Deno.serve`,
  `Deno.env` and npm resolution are all in play, and a local HTTP server stands
  in for the Supabase Auth endpoint. They prove:
  1. the entrypoint's responses match `handleDeleteAccountRequest` called
     directly with the same env — status, compared headers and body, across six
     method/origin combinations;
  2. an unset `ALLOWED_ORIGINS` fails closed with `500` and `Vary: Origin` for
     every method, reflecting nothing;
  3. the entrypoint constructs a working admin client from the injected
     `(url, serviceRoleKey)`: the real client calls `/auth/v1/user` with the
     service-role key as `apikey`, and the function answers `401`.

**Still a staging gate, and not claimed as proven here:** behaviour against the
actual Supabase Edge runtime and a real project — the RPCs
`begin_account_deletion` / `prepare_account_deletion` / `cancel_account_deletion`,
real Storage listing and removal, and real `auth.admin.updateUserById` /
`deleteUser`. A local stub is not Supabase. Mocked Vitest coverage does **not**
prove runtime compatibility, and this record does not assert that it does.

## 4. Final integrity after the fixes

| Check | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run typecheck` | exit 0, 0 errors |
| `npm run lint` | exit 0, **0 errors / 0 warnings** |
| `npm test` | **318 passed / 318**, **32 files / 32** (was 303/30; +15 tests, +2 files) |
| positive build | exit 0, **0** mixed-import warnings, **0** large-chunk warnings, entry chunk 341.80 kB / 105.22 kB gzip |
| negative build | exit **1**, naming `VITE_SUPABASE_URL` |
| CSP marker scan | **0** markers in `dist/`; `connect-src 'self' https://example.supabase.co wss://example.supabase.co` |
| `npm audit` | **2** advisories, both `react-router` GHSA-qwww-vcr4-c8h2 under the recorded conditional acceptance. `brace-expansion` gone |
| secret scan | 0 JWTs, 0 `service_role` values, 0 real project URLs, 0 keystores, no tracked `.env` beyond `.env.example`, 0 placeholder leaks outside the spec documents |
| `git diff --check` | clean for `HEAD` and for the whole `7d82e3e..HEAD` range |
| `npm run check:edge` | exit 0 |
| `npm run test:edge` | 3 passed / 3 |
