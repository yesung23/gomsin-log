# Diary · Garden · Shop V2 — Task 4 local closure

Status: **LOCAL GREEN / NOT PROMOTED**
Date: 2026-09-01 KST
Worktree: `/private/tmp/gomsinlog-diary-garden-shop-20260901`
Branch: `codex/diary-garden-shop-v2`
HEAD: `7e515fe123d9e7a4c2345fc394326d34db0a96ee` + preserved uncommitted Task 4 tree
Observed live `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`

## Scope

The interrupted Task 4 was completed in the exact preserved worktree without reset, stash, clean, rebase, or production mutation. Tasks 1–3 remain the seven existing commits ahead of master. The current dirty tree finishes the original-character interactive Garden and performs local integration verification only.

No StoreKit, paid entitlement, price, checkout, fake currency, server inventory, Supabase schema, migration, auth/RLS/crypto change, analytics expansion, Vercel deploy, TestFlight, App Store, or physical-device change was made.

## Original character provenance

Private source-of-truth evidence remains outside the repository:

`/Users/han-yejun/Documents/GomsinLog Private/AI Asset Evidence/paper-pair-v1-2026-08-30/original-with-c2pa.png`

- 1254×1254 PNG
- SHA-256 `8b8db06e952b6b26b2813684ca73f38afb50029645bd914838c3dcd21c942d01`
- C2PA provenance preserved

The app ships the exact historical WebP derivative:

`src/assets/characters/paper-pair-v1.webp`

- 1254×1254 WebP
- SHA-256 `cac84b0179f4f0d05a655b4c41c03b644a7fdd67d3701c51a9de30c5f04ff856`
- byte identity is guarded by `src/features/diary/companionGardenAsset.test.ts`

The private source PNG was not copied into Git.

## Implemented Task 4 behavior

- `/diary/garden` uses a dedicated full-content surface with the persistent five-tab navigation hidden.
- Garden header provides a direct `상점 열기` action to the existing free `/shop` surface.
- The two visible companions are crops from the exact historical WebP, not replacement inline character body paths.
  - first: `20 515 136 155`
  - second: `156 514 138 155`
- Each companion wanders independently inside bounded scene coordinates.
- Quick tap does not pick up a companion.
- A continuous 500 ms pointer press activates pickup.
- Pre-activation movement beyond the threshold cancels pickup.
- A picked companion uses pointer capture and can be dragged within scene bounds.
- Pointer release/cancel clears pressed/lifted state.
- Enter/Space provides a finite 900 ms keyboard-equivalent pickup interaction.
- `prefers-reduced-motion` stops autonomous wandering and repeated wriggle animation while preserving small direct-interaction feedback.
- Decoration choices remain `none` plus accessories actually owned by this account; unavailable items stay hidden.
- A minimal data-driven scene-object registry seam remains, without benches/rides/object-placement editing.
- The 1.49 MB character sheet stays a separate route-lazy asset and is excluded from the service-worker precache.

## Related Tasks 1–3 integration deltas preserved

Three additional dirty files are not new Task 4 product scope; they complete/freshen the earlier paper/menu integration:

- `src/components/HandwritingSection.test.tsx`: verifies the selected paper applies to `data-paper` immediately as well as local storage.
- `src/components/ProfilePaperMenu.tsx`: reads current owned-paper state without a stale memoized inventory snapshot.
- `src/features/us/postComposerSheet.test.tsx`: verifies Settings remains reachable through the relocated My overflow menu.

Full-suite verification includes these deltas.

## Verification

### Focused Garden

`npm run typecheck`

**PASS**.

Focused Vitest command over Garden view/route/styles/exact asset/CSP:

**PASS — 5 files / 39 tests.**

Focused ESLint plus `git diff --check`:

**PASS.**

### Browser

`npm exec playwright test e2e/companionGarden.spec.ts`

**PASS — 3/3.**

Covered:

- 375×812 portrait
- 812×375 landscape
- reduced-motion
- exact character crops
- hidden persistent nav
- independent wandering
- quick-tap no pickup
- 500 ms long press
- drag/release
- keyboard equivalent
- Shop routing
- bounded geometry / no horizontal overflow

### Full application

`npm run test`

**PASS — 279 files / 3,904 tests.**

`npm run lint`

**PASS.**

`npm run verify:native`

**PASS — 4 files / 106 tests.**

### Production build / bundle boundary

The first intentionally weak placeholder key was rejected by the build guard as designed. Re-running with a non-secret `sb_publishable_`-shaped placeholder:

`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder npm run build`

**PASS.**

Post-build inspection:

- emitted: `dist/assets/paper-pair-v1-DIBMn02t.webp`
- not referenced from `dist/index.html`
- not referenced from `dist/sw.js`
- Garden remains a separate lazy route chunk

This proves the character sheet is emitted but is not part of the initial HTML or service-worker precache.

## Live Git boundary

Read-only `git ls-remote` recheck:

- `origin/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`
- branch committed HEAD remains 0 behind / 7 ahead
- Task 4 is deliberately still uncommitted pending exact-tree independent review

No commit, push, PR mutation, merge, force-push, Vercel deploy, Supabase mutation, TestFlight action, App Store action, or device install was performed by this continuation.

## Remaining gate

Local implementation and verification are green. Promotion is still blocked on an independent exact-tree review of the final dirty Task 4/integration delta. A prior review cannot be inherited because the tree changed after the interrupted handoff.

Physical iPhone interaction evidence and remote CI are also not claimed here.

## Rollback

Because Task 4 remains uncommitted, rollback does not require a database or remote rollback. The seven pre-existing commits remain isolated on `codex/diary-garden-shop-v2`; the current Task 4 dirty changes can remain preserved until review. No destructive rollback command was executed.

## Verdict

**TASK 4 LOCAL IMPLEMENTATION: PASS**
**TASK 5 LOCAL VERIFICATION/DOCUMENTATION: PASS**
**INDEPENDENT FINAL REVIEW: UNVERIFIED**
**MASTER PROMOTION: NOT APPLIED**
**PRODUCTION / SUPABASE / VERCEL / TESTFLIGHT / APP STORE: NOT APPLIED**
