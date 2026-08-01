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
