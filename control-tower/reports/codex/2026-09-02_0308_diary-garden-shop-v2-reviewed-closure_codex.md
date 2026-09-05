# Diary · Garden · Shop V2 — reviewed local closure

Status: **REVIEWED LOCAL GREEN / GIT INTEGRATION PENDING**
Date: 2026-09-02 KST
Worktree: `/private/tmp/gomsinlog-diary-garden-shop-20260901`
Branch: `codex/diary-garden-shop-v2`
Reviewed application commit: `8d463c1685d071634c88eef4564e0ec6844d5758`
Live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`

## Outcome

Diary · Garden · Shop V2 Tasks 1–4 are implemented on the isolated feature branch. Task 4 now uses the exact historical character WebP, fills the Garden content surface, supports a continuous 500ms pickup and bounded drag, reconciles owned paper state, and keeps the Shop explicitly free with no payment path.

The first independent reviews found real geometry, cancellation, semantic-input, ownership-recovery, and test-stability gaps. Luna applied bounded fixes; Sol and Terra re-reviewed the final delta. Their final verdicts are **PASS**, with **0 new Critical / 0 new Important**.

## Material behavior

- The Garden hides persistent bottom navigation and links to `/shop` from its header.
- Two exact crops from `paper-pair-v1.webp` render within the full 98×112 physical footprint.
- Automatic destinations and pointer drag use the same containment and non-overlap calculation.
- The former 430×180 short-landscape floating-point collision is closed with a 0.1px separation margin and helper/View regressions.
- Quick physical tap is inert; continuous 500ms hold activates pickup; release, cancellation, lost pointer capture, and availability withdrawal clean up state.
- Enter/Space and assistive semantic click provide a finite 900ms equivalent.
- Reduced motion disables automatic wandering and repeated squirm while retaining direct feedback.
- App, Shop, and Profile reconcile an active paper selection against actually owned paper.
- Settings no longer duplicates the Profile-owned paper selector.
- Shop states that every current item is free and that there is no payment feature.
- The 1.49MB character asset remains route-lazy and outside initial HTML and service-worker precache.

## Verification

- `npm run typecheck` — **PASS**.
- focused feature regression — **PASS, 14 files / 148 tests**.
- full Vitest excluding the two separately classified suites — **PASS, 277 files / 3,874 tests**.
- `src/lib/e2eeRollback.test.ts` with throwaway PostgreSQL — **PASS, 17/17**.
- unchanged `src/features/search/searchPage.test.tsx` — **26/27 PASS, 1 existing date-dependent FAIL**; both the test and Search implementation have no diff from `origin/master`.
- aggregate current-tree unit evidence — **3,917 PASS / 1 existing unrelated FAIL**.
- `npm run lint` — **PASS**.
- `npm run verify:native` — **PASS, 106/106**.
- `npm exec playwright test e2e/companionGarden.spec.ts` — **PASS, 3/3** for portrait, landscape, and reduced motion.
- placeholder production build — **PASS**.
- source asset SHA-256 — **PASS**, `cac84b0179f4f0d05a655b4c41c03b644a7fdd67d3701c51a9de30c5f04ff856`.
- built asset emitted separately and absent from `dist/index.html` / `dist/sw.js` — **PASS**.
- `git diff --check` and staged diff check — **PASS**.
- `git fetch origin --prune` — **PASS**; live master remained `bd4a9f3`, with no base divergence before the feature commit.

## Independent review

- Sol final geometry delta: **PASS**, former 430×180 overlap resolved, 270 additional supported geometry combinations with 0 overlapping return, 0 Critical / 0 Important.
- Terra final delta: **PASS**, former flaky test repeated 20/20 and focused 44/44, 0 Critical / 0 Important.
- The application commit only records the already reviewed dirty tree; it does not change its reviewed content.

## Explicit boundaries

- DB/schema/migration/RLS/auth/crypto: **UNCHANGED**.
- Supabase/Production/Vercel/TestFlight/App Store/physical device: **NOT APPLIED**.
- Remote CI: **UNVERIFIED** until the branch is pushed and the Draft PR runs.
- Physical iOS/Android touch and assistive-technology behavior: **UNVERIFIED**.
- External C2PA/right-to-use/legal provenance: **UNVERIFIED** by this repository review. The checked-in derivative identity is verified; rights judgment remains manual.

## Rollback

No database or remote rollback is required. Before merge, rollback is deleting or abandoning the isolated feature branch. After merge, revert the feature commits; no data migration or server-state reversal is involved. No destructive rollback command was executed.

## Next safe action

Commit factual documentation without `control-tower/Now.md`, push `codex/diary-garden-shop-v2`, open a Draft PR, and accept promotion only after exact-commit CI and repository approval are green. Do not merge, deploy, or mutate Supabase as part of this local closure.
