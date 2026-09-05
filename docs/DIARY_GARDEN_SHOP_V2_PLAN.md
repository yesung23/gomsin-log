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

## 2026-09-02 User-Approved Refinement

This section supersedes only the presentation and feed details that conflict with the user's
2026-09-02 device feedback. The privacy, exact-original, no-payment, local-collection, lazy-loading,
and reduced-motion contracts above remain in force.

### Direction Check

- Product source checked: latest explicit user request, `docs/V4_AS_BUILT.md`, this plan, and the current repository paths.
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`; no customer, monetization, storage, or AI-role change.
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`, and `docs/kiro/AI_HANDOFF.md`.
- Current-state checked: `docs/CURRENT_STATE.md`, `scripts/agent/session-start.sh`, and branch HEAD `3373ee2`.
- Latest relevant Work Log checked: the 2026-09-02 physical-iPhone install record.
- Does this task conflict with canonical direction? NO. The user's newer instruction intentionally replaces the garden's tree/copy-heavy presentation and the split home/story feed presentation. Core privacy and exact-original behavior remain unchanged.

### Refinement A: Quiet white garden with original-character motion

> **SUPERSEDED 2026-09-03:** the product owner's newer instruction and
> `V5_GARDEN_NATURAL_INTERACTION_PLAN_2026-09-03.md` replace Refinement A items 1–2 and
> Refinement B item 1. The available garden now has no visible together-day copy or other text,
> and the playfield remains white in both themes with verified control contrast. Nurturing comes
> from direct `쓰다듬기 · 인사하기 · 같이 놀기` reactions, never pressure metrics. The free
> starter spinner is finite and always available until its five unique items are owned; it has no
> once-per-day limit, countdown, currency, payment, or missed-day loss. The historical text below
> remains only to explain the superseded implementation sequence.

2026-09-02 Control Tower accessibility amendment: a real dark-mode capture showed that an isolated
pure-white stage becomes a high-luminance band against the surrounding dark paper. The user's newer
instruction to make every surface more natural and accessible therefore supersedes only the
"white in dark mode" detail below. Light mode remains white; dark mode uses the corresponding semantic
elevated surface. This also removes a direct hex value without changing interaction or data semantics.

1. Keep only the back control and the together-day copy as garden text. Remove the tree, ground strip,
   stage title/copy, decoration controls, helper copy, footer, and shop action from the garden surface.
2. Use a white garden canvas in light mode and the corresponding semantic elevated surface in dark mode,
   while keeping controls and focus indicators readable. Preserve safe areas and a minimum 44×44 CSS px
   control target.
3. Reduce each visible character to about half the former size and update physical bounds/collision
   geometry to match; do not merely scale the bitmap while retaining stale geometry.
4. Use pose frames cropped from the approved `paper-pair-v1.webp` sheet for walking and held/flailing
   motion. Do not redraw the characters. Animate frame opacity/transform only, and stop automatic or
   repeated motion under `prefers-reduced-motion`.
5. Keep long-press, pointer-follow, release, cancel, and keyboard pickup alternatives. Held animation
   must come from visibly different limb poses rather than shaking the entire control.
6. Replace synthetic cap/bow/scarf/flower drawings with crops of objects already present in the approved
   character sheet wherever a usable original object exists. Preserve local ownership safely through a
   versioned mapping; never delete an already owned selection silently.

### Refinement B: Visible spinning draw and continuous paper texture

1. Keep the existing local, free, once-per-day, duplicate-free draw semantics.
2. Add a visible roulette/spinner phase before revealing the already selected result. Disable repeat
   activation while spinning and announce the result once through the existing live region.
3. Under reduced motion, shorten or remove repeated rotation while preserving clear progress and the
   same draw result.
4. Apply the active paper texture layers to sticky top surfaces, including the Home logo/bookmark/call
   row and shared AppBar surfaces, so a solid `var(--paper)` fill does not mask the selected texture.

### Refinement C: Partner-only Home feed and truthful on-device AI status

1. Home's seven-day feed shows records written by the currently active partner and never the viewer's
   own records. Partner records remain privacy-filtered, readable on this device, and linked to the exact
   original record. A record may also remain in the unread Story surface; the user's explicit Home request
   supersedes the previous no-duplication presentation rule.
2. Do not change Supabase, RLS, couple membership, record visibility, or remote state unless repository
   evidence proves the display-layer fix is insufficient.
3. Keep deterministic summary lines as the immediate fallback. On-device AI remains a user-requested
   editing pass, never a hidden selector or importance judge.
4. Distinguish corpus-not-eligible, plugin/device/model/locale unavailable, timeout, and rejected-output
   outcomes without logging diary content. The UI must show a short actionable reason instead of a
   generic silent fallback, while preserving the fail-closed privacy boundary.
5. Verify native compilation with Xcode 27 Beta and, when the physical iPhone is connected and its model
   is ready, verify the actual device path. Otherwise report runtime model execution as UNVERIFIED.
