# Codex report — Instagram-like profile and service level-up refinement

## PLAN POSITION
- Phase: V4 product-surface completion / profile and service information
- Workstream: engineering
- Step: honest pre-enlistment service state and lower-clutter profile surface
- Previous Gate: local uncommitted service/profile checkpoint on `7f4886b`
- This Gate: implementation, focused/full local verification, rendered local browser inspection, and live remote recheck

## DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md`
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`
- Current-state checked: `docs/CURRENT_STATE.md`
- Latest relevant Work Log checked: `docs/WORK_LOG.md`
- Does this task conflict with canonical direction? YES only for partner-phone-only mutation of the global username
- Conflict: current `profiles.username` is owner-managed by auth/RLS, and a web session cannot prove which physical phone is in use. The safe local implementation therefore keeps global username ownership unchanged and leaves a couple-scoped alias as the next gated design.

## OWNERSHIP
- Primary: Codex
- Delegated design/implementation/review: `google-antigravity/gemini-3.7-flash`
- Branch: `codex/service-rank-profile-settings-impl`
- Base/HEAD: `7f4886bcbe32034bfabb454c85378532b14cb261` with uncommitted changes
- PR: none

## CHANGED
- `src/lib/milestones.ts` and `src/lib/serviceLevel.ts`: pre-enlistment state, separate days-until-enlistment value, rank labels, tier EXP, next-rank remaining values, and stage data.
- `src/features/search/SearchPage.tsx`, `src/pages/ServicePage.tsx`: connected `이등병 → 일병 → 상병 → 병장` rail, EXP bar for serving users, honest waiting state for future enlistment, correct enlistment D-day, and local date refresh.
- `src/features/us/PaperProfile.tsx`, `src/components/ProfileIdentity.tsx`, `src/components/AvatarPicker.tsx`, `src/pages/SettingsPage.tsx`: Instagram-like one-profile header layout, single profile-edit entry, plus-style highlight settings entry, direct profile modal routing, and removal of the permanent camera badge.
- Tests: rank boundaries/pre-enlistment/discharge, search rail, profile edit routing, highlight settings, source edit routing, and keyboard path.

## NOT CHANGED
- No database schema, migration, Supabase function, RLS, crypto, or authorization policy was changed.
- No relationship score, affection score, views, viewer list, or health-flow exposure was added.
- No remote Supabase mutation, commit, push, merge, or deployment was performed.

## VERIFICATION
- `npm test -- src/lib/milestones.test.ts src/lib/serviceLevel.test.ts src/features/search/searchPage.test.tsx src/features/us/paperProfile.test.tsx src/pages/keyboardOperableCards.test.tsx`: PASS — 5 files / 69 tests.
- `npm run verify`: PASS — typecheck, lint, 226 Vitest files / 3247 tests, and build; only the existing large-chunk warning was emitted.
- Local browser `http://127.0.0.1:5173/us`, `/search`, `/settings?profile=edit`: PASS — DOM and rendered screenshots inspected; no save was submitted.
- `git diff --check`: PASS.
- `git ls-remote origin refs/heads/master`: PASS — `7f4886bcbe32034bfabb454c85378532b14cb261`.
- `gh pr view 88`: PASS — OPEN, head `a7c2d5c5f441e75c64d07052330cd7e78991d1d2`, CONFLICTING; listed checks belong to that other head.
- Production `/us` HTTP probe: PASS — 200; this branch is not deployed.
- Remote Supabase catalog/application state: UNVERIFIED.
- `npm run test:e2e`, `npm run test:phase0`, and physical-device/cross-device verification: UNVERIFIED — not run in this gate.

## STOPPED AT
Local uncommitted implementation and evidence only. No remote mutation.

## REMAINING / NEXT ACTION
The next smallest safe task is a design/security gate for a couple-scoped partner-assigned alias, separate from the account-owned global English username. It must specify active-couple derivation, former-partner denial, anon denial, uniqueness scope, and rollback before a migration or RPC is written.

## PRODUCTION
NOT APPLIED
