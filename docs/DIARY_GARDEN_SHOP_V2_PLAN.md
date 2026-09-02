# Diary · Garden · Shop V2 Implementation Plan

Spec authority: the user's 2026-09-01 correction and approval of the recommended no-real-money rollout.

## Context

The current `master` puts a large “내 종이로 엮기” card and a garden card in the Diary body, uses a newly drawn peach/sage inline SVG instead of the previously approved character sheet, renders the garden inside a small card, and lifts characters on a tap rather than a long press. The existing paper shop also changes Diary-page paper instead of owning the app-wide paper background requested from the My/profile overflow menu.

## Direction Check

- Product source checked: `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`, current `origin/master` UI and tests, latest explicit user correction.
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`; the user approved a no-real-money first release, so IAP/payment remains closed.
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`, `docs/skills/README.md`.
- Current-state checked: `docs/CURRENT_STATE.md`, `scripts/agent/session-start.sh`, `origin/master` at `bd4a9f3`.
- Latest relevant Work Log checked: 2026-09-01 product realignment and interactive companion garden entries.
- Does this task conflict with canonical direction? NO after explicit 2026-09-01 user override limited to a free local catalog. Paid entitlement, IAP, and server economy remain frozen.

## Global Constraints

- Preserve the core exact-original-record flow and do not change records, couple authorization, crypto, Supabase, migrations, or remote state.
- No real-money payment, StoreKit, purchasable currency, paid entitlement, score, streak, mission, AI, network inventory, or server persistence.
- Shop and ownership state are account-scoped device-local data and must be purged with the existing `gomsin.diary.*` / display namespaces on logout and account deletion.
- The first release gives one non-accumulating free accessory draw per local calendar day. Draw only from unowned accessories, never consume the day when the collection is complete, and disclose that there is no payment.
- Existing locally equipped garden accessories remain owned after the state migration; never silently remove a user's current choice.
- `plain` and `ruled` app paper backgrounds remain owned for existing users. Additional backgrounds can be collected with a deterministic “무료로 받기” action in the shop.
- The My/profile overflow menu is the direct owner of app-wide paper-background selection. Diary may retain its date-page editing internals, but the Diary landing page must not present “내 종이로 엮기” or duplicate shop/garden cards.
- Diary top-right action order is Shop, then Garden. Both icon-only controls need descriptive accessible names and at least 44×44 CSS px targets.
- Garden uses the exact historical `src/assets/characters/paper-pair-v1.webp` blob from commit `a2d09d22`; do not redraw or synthesize a replacement.
- The garden scene fills the app content viewport and hides the persistent bottom tab bar. It respects top/bottom safe areas, 375px width, landscape, dark mode, and reduced motion.
- Characters wander independently within bounds. Long press is at least 450ms, gives immediate pressed feedback, supports pointer cancel/movement threshold, and has an accessible keyboard/button alternative. A normal quick tap must not trigger pickup.
- The pickup motion follows the finger while held and visibly squirms; release returns the character to wandering. Reduced-motion keeps direct movement feedback but removes repeated squirm/automatic wandering.
- Keep a small data-driven scene-object seam for future benches, trees, and rides, but do not ship unrequested placement editing or fake interactions now.
- Follow TDD: every behavior test must be observed failing for the expected missing behavior before production code is changed.
- Preserve route-level lazy loading and keep the 1.49 MB character sheet out of the initial entry chunk and service-worker precache.

## Rulings

- Ruling: “무료 뽑기권 기반” means one local-calendar daily draw that does not accumulate — this gives a repeatable no-payment loop without inventing an economy; if wrong, replenishment cadence will need product rework.
- Ruling: accessory draws are duplicate-free until the collection is complete — this avoids a punitive gambling loop in a relationship app; if wrong, rarity/duplicate compensation will need a later economy design.
- Ruling: paper products use “무료로 받기” in this beta rather than a fake price — this preserves a real ownership flow without pretending payment exists; if wrong, actual IAP requires a separate release gate.

## Task 1: Account-local collection state and paper preference foundation

Files expected:
- `src/lib/companionShopLocalState.ts` and tests
- `src/lib/paperTexturePreference.ts` and tests
- `src/styles/paper.css`
- account-local purge contract tests/source only where required

Acceptance criteria:
1. Write failing tests for versioned collection loading, malformed fallback, account isolation, legacy accessory migration, daily draw availability, duplicate-free draw, complete-collection no-consume, paper collection, and purgeability.
2. Write failing tests proving all five paper backgrounds apply a stable `data-paper` attribute and the CSS has distinct app-wide surfaces while preserving existing plain/ruled values.
3. Implement the smallest state and preference foundation needed to pass, with no UI edits and no server calls.
4. Run focused tests, typecheck, and self-review; commit atomically.

## Task 2: My/profile paper overflow menu

Files expected:
- `src/components/ProfilePaperMenu.tsx` and tests
- `src/features/us/SharedProfile.tsx` and focused profile tests

Acceptance criteria:
1. Write a failing real-component test proving the My/profile `MoreHorizontal` overflow opens an accessible sheet, shows only owned paper choices, applies a choice immediately, and retains the settings route.
2. Implement the smallest accessible sheet needed to pass, consuming Task 1 APIs rather than duplicating storage logic.
3. Use semantic buttons/radiogroups, 44px targets, existing modal stacking patterns, focus return/close behavior, no emoji structural icons, and no server calls.
4. Run focused tests, typecheck, and self-review; commit atomically.

## Task 3: Diary actions and free local shop

Files expected:
- `src/features/diary/DiaryPage.tsx` and `diaryScreens.test.tsx`
- `src/features/shop/ShopPage.tsx` and `shopPage.test.tsx`
- small reusable shop presentation helpers only if they reduce real duplication

Acceptance criteria:
1. Write failing tests proving Diary has adjacent Shop then Garden app-bar actions and no “내 종이로 엮기”, “종이 고르기”, or duplicate garden body card.
2. Write failing real-component tests for Shop paper collection, immediate global paper selection, daily accessory draw, collection-complete state, transparent no-payment copy, and navigation back to Diary/Garden.
3. Implement a compact two-category shop with progressive disclosure. Keep paper acquisition deterministic and accessory draw random only among unowned options.
4. Do not add prices, checkout, payment SDKs, fake currency, network calls, or Book Studio.
5. Run focused tests, typecheck, and self-review; commit atomically.

## Task 4: Original-character full-screen interactive garden

Files expected:
- exact `src/assets/characters/paper-pair-v1.webp` historical blob
- `src/features/diary/CompanionGardenPage.tsx`
- `src/features/diary/CompanionGardenView.tsx` and focused tests
- `src/features/diary/companionGardenMotion.ts` and tests as needed
- `src/styles/index.css`
- `e2e/companionGarden.spec.ts` focused updates
- bundle/service-worker asset tests only where required

Acceptance criteria:
1. Write failing tests proving `MobileShell` hides persistent navigation for Garden, the scene fills the content viewport rather than a 4:3 card, and Shop is reachable from the Garden header.
2. Write failing tests proving the two character renderers reference `paper-pair-v1.webp` and crop the two front-facing characters from that exact sheet, not inline replacement body paths.
3. Write failing interaction tests: quick tap does not lift; 450ms long press lifts; movement beyond threshold cancels before pickup; held pointer movement updates position; release ends pickup; keyboard Enter/Space offers an equivalent finite pickup; reduced motion stops automatic wandering and repeated squirm.
4. Filter garden accessory choices to owned accessories while preserving `none`, and link to Shop when more are wanted.
5. Implement a full-screen bounded scene with exact sprite crops, independent wandering, safe-area-aware chrome, interruptible long-press pickup/squirm, and a minimal scene-object registry seam.
6. Confirm the asset stays route-lazy and excluded from the service-worker precache. Run focused unit/component/E2E tests, typecheck, and self-review; commit atomically.

## Task 5: Integration verification and factual release records

Files expected:
- `docs/V4_AS_BUILT.md`
- `docs/CURRENT_STATE.md`
- `docs/WORK_LOG.md`
- `control-tower/reports/codex/2026-09-01_diary-garden-shop-v2_codex.md`

Acceptance criteria:
1. Run the focused feature tests, full Vitest suite, typecheck, lint, production build with non-secret placeholders, relevant Playwright tests at 375px and landscape, native regression tests, and `git diff --check`.
2. Perform browser visual checks for Diary, Shop, My overflow, and Garden in light/dark and reduced-motion where the harness supports them; record unsupported checks as UNVERIFIED.
3. Update canonical/current-state documentation to reflect only implemented behavior and explicitly state no payment, server inventory, Supabase, or production mutation.
4. Write the mandatory Work Log and Control Tower report with exact commands/results, remaining IP/provenance risk, rollback, and production status.
5. Commit documentation separately. Do not edit `control-tower/Now.md` manually.
