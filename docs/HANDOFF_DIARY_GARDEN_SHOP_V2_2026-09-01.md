# Diary · Garden · Shop V2 Handoff

> **SUPERSEDED FOR CURRENT STATUS:** 이 문서는 2026-09-01 21:40 KST의 중단 상태를 보존하는 역사적 handoff다. Task 4 복구와 로컬 검증이 완료된 최신 상태는 `control-tower/reports/codex/2026-09-01_2358_diary-garden-shop-v2-task4-local-closure_codex.md`, `docs/CURRENT_STATE.md`, 그리고 이 문서 뒤의 최신 `docs/WORK_LOG.md` 항목을 따른다. 독립 exact-tree review와 commit/promotion은 아직 미완료다.

Status at capture: **IN PROGRESS / current dirty tree is not releasable**
Target worktree: `/private/tmp/gomsinlog-diary-garden-shop-20260901`
Branch: `codex/diary-garden-shop-v2`
Current HEAD: `7e515fe123d9e7a4c2345fc394326d34db0a96ee`
Observed live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`
Observed divergence: 0 behind / 7 ahead

This handoff records the live state observed on 2026-09-01 around 21:40 KST. The next owner must verify it again before editing.

## What is already committed

1. `f4a9585` — account-local companion collection and paper preference foundation.
2. `83a0e07` — preserve migrated/equipped accessory ownership.
3. `41bab1f` — move app-wide paper choices into the My/profile overflow menu.
4. `32b4eb1` — complete paper menu keyboard/focus flow.
5. `5893750` — test backdrop dismissal behavior.
6. `cb0340c` — add the free Shop entry and Diary app-bar routing.
7. `7e515fe` — enforce one daily free accessory draw and owned-accessory filtering.

These commits are not on live `origin/master` yet. Do not push them until the unfinished Task 4 tree is repaired and the final exact tree is verified.

## What is unfinished

Task 4 from `docs/DIARY_GARDEN_SHOP_V2_PLAN.md` is partially edited:

- the exact historical `src/assets/characters/paper-pair-v1.webp` is restored and staged;
- crop-based character rendering and pointer/keyboard pickup helpers were started;
- tests were updated first for full-screen Garden, Shop app-bar access, exact image crops, long press, drag, keyboard equivalence, reduced motion, CSS, and service-worker exclusion;
- the render tree and CSS/build wiring were not finished.

The current production file still calls stale `liftCompanion` code and passes removed `tone`/`onLift` props. It also leaves partial handlers/imports unused. This is why the tree is deliberately uncommitted.

## Live verification at handoff

- `npm run typecheck`: **FAIL**, 13 TypeScript errors, all reported in `src/features/diary/CompanionGardenView.tsx`.
- Focused Vitest command covering five Garden/CSP files: **FAIL**, 18 failed / 21 passed.
- `src/features/diary/companionGardenAsset.test.ts`: **PASS** within that run; exact historical WebP SHA-256 matched.
- `git diff --check`: **PASS** before handoff documentation.
- Full Vitest, ESLint, production build, Playwright, native, real iPhone, Vercel, Supabase, TestFlight, and App Store: **NOT RUN / NOT APPLIED** for this dirty tree.

## Do not damage this state

- Do not run reset, stash, clean, broad restore, checkout-overwrite, or rebase.
- Do not change worktrees. All implementation must stay in the exact target worktree above.
- Do not include `control-tower/Now.md` in a feature commit.
- Do not replace the historical WebP with a generated/redrawn character.
- Do not add StoreKit, payment, paid entitlement, fake currency, server inventory, Supabase schema, migration, or remote mutation.
- Do not call the branch complete while typecheck or focused tests fail.

## Ready-to-paste continuation prompt

```text
You are the bounded Luna Max implementation owner for GomsinLog Diary · Garden · Shop V2. Continue from the exact interrupted state below. Do not start over.

WORKTREE (mandatory): /private/tmp/gomsinlog-diary-garden-shop-20260901
BRANCH: codex/diary-garden-shop-v2
EXPECTED HEAD: 7e515fe123d9e7a4c2345fc394326d34db0a96ee
OBSERVED origin/master: bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0

First run the repository session-start script, then pin pwd, repo root, branch, HEAD, git status --short, git diff, git diff --cached, and live origin/master. Stop if the worktree/branch/HEAD differs materially and report the discrepancy. Never reset, stash, clean, broad-restore, rebase, or overwrite existing staged/unstaged/untracked work. Do not edit another worktree. Preserve the staged exact historical asset src/assets/characters/paper-pair-v1.webp. Never include control-tower/Now.md in a feature commit.

Read completely before editing:
- AGENTS.md
- docs/HANDOFF_DIARY_GARDEN_SHOP_V2_2026-09-01.md
- docs/DIARY_GARDEN_SHOP_V2_PLAN.md
- docs/BUSINESS_MEMORY_ROADMAP_V1.md
- docs/ENGINEERING_ROADMAP.md
- the current Task 4 diff and focused tests

Current facts:
- Seven completed commits are ahead of origin/master: f4a9585, 83a0e07, 41bab1f, 32b4eb1, 5893750, cb0340c, 7e515fe.
- Task 4 is partially edited and intentionally uncommitted.
- npm run typecheck currently fails with 13 errors in CompanionGardenView.tsx.
- The five-file focused Vitest run currently has 18 failures / 21 passes. Principal blockers are stale undefined liftCompanion render calls, missing press/lift/reduced-motion CSS, and missing production service-worker exclusion for paper-pair-v1.
- companionGardenAsset.test.ts already proves the exact WebP hash and passes.

Your bounded implementation task:
1. Finish Task 4 only. Wire the existing begin/move/end/cancel pointer pickup and keyboard pickup handlers into both GardenCompanion instances. Remove stale tone/onLift/liftCompanion code. Fix SVG image typing without weakening the exact asset test.
2. Finish the full-app-content Garden layout: no 4:3 card, no persistent bottom tab bar, safe app bar with Shop action, one main landmark, two independently wandering exact historical characters.
3. Implement continuous 500ms long press, immediate pressed feedback, pre-activation movement cancellation, pointer-captured drag within scene bounds, release/cancel cleanup, finite Enter/Space equivalent, and reduced-motion behavior. Quick tap must never pick up.
4. Add only the CSS and build/service-worker filtering needed by the already-written tests. Keep the 1.49 MB asset route-lazy, outside the initial entry chunk, and outside service-worker precache.
5. Preserve owned-accessory filtering and none. Keep the small data-driven scene-object registry seam only; do not add benches/rides/placement editing yet.
6. Do not add IAP, StoreKit, prices, payment SDKs, fake currency, server economy, Supabase, migrations, auth, RLS, crypto, analytics, or unrelated redesign. The later IAP/refund request is a separate direction-checked legal/business workstream.

Verification order:
- Run the five focused test files and npm run typecheck until green.
- Run focused ESLint and git diff --check.
- Run relevant Garden Playwright at 375px, landscape, and reduced-motion. Verify both characters move independently, remain bounded, long-press/drag/release works, quick tap does not lift, Shop opens, and the bottom tab bar is absent.
- Run full npm verification with approved non-secret placeholder build environment, native regression checks, and any project-required release validation.
- Inspect the final diff yourself. Then request an independent Terra reviewer for correctness/regressions/accessibility and a Daybreak Blue review only if the final change crosses security/privacy/release boundaries. A prior review does not cover a changed HEAD.

Commit/promotion rules:
- Stage named intended files only. Exclude control-tower/Now.md and unrelated changes.
- Do not commit while any required test is failing.
- Write the mandatory docs/WORK_LOG.md entry and Control Tower Codex report with exact results and NOT RUN/UNVERIFIED boundaries.
- Re-fetch origin/master before integration. Because the user wants finished work promoted directly, push to master only after the final exact tree is green, independently reviewed as required, and origin/master has no conflicting advance. Never force-push.
- Production/Supabase/Vercel/TestFlight/App Store/device changes are not authorized by this continuation prompt.

Return a factual completion report: changed files, behavior, tests and exact results, tests not run, review exact SHA, remote actions, rollback, and whether master was actually updated. If blocked, leave the dirty state intact and write a new handoff rather than hiding or discarding it.
```

## Separate pending request

The user also requested current Apple in-app-purchase prerequisites and lawful refund-evidence documents based on a referenced article. No research, legal draft, StoreKit implementation, App Store Connect change, or payment activation has been performed. That work changes monetization and must receive its own mandatory business-direction check; the current approved Garden/Shop branch remains no-real-money.
