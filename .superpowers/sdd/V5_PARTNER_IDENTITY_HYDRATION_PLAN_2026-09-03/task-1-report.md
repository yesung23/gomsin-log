# Task 1 report — authoritative partner identity in full hydration

## Status

IMPLEMENTED AND FOCUSED-GREEN. The strict membership authority and atomic hydration boundary are complete in the allowed runtime and test files. The repository-wide `npm run verify` remains FAIL because two unchanged UI tests expect obsolete `tab`/`tablist` roles; the build step was therefore skipped by that script, and a separate build attempt was BLOCKED by missing `VITE_SUPABASE_URL`.

## Repository identity

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-sol-rc-v4`
- Branch: `codex/sol-gomsinlog-rc-v4`
- Expected and verified base HEAD: `841c053e744b5653b87de954004019a24e1b3331`
- Implementation owner: Codex, sole writer; no subagents dispatched
- Production / remote Supabase: NOT APPLIED

## Direction check

- Product source checked: `docs/PRODUCT_V5_MASTER_DECISION.md`, `docs/V4_AS_BUILT.md`
- Business source checked: NOT APPLICABLE; this task does not change customer, product scope, AI role, monetization, storage, media, KPI, or market strategy
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`, task brief, V5 partner identity hydration plan
- Current-state checked: repository, `docs/CURRENT_STATE.md`
- Latest relevant Work Log checked: `docs/WORK_LOG.md`
- Does this task conflict with canonical direction? NO
- Scope note: the user's hard scope explicitly prohibited editing documentation other than this report, so no Work Log or Control Tower file was modified by this task.

## Implemented contract

- Added a strict partner membership result that separates verified zero rows, one valid exact partner, and authority failure.
- The authority query is scoped to exact `couple_id`, `status = active`, non-self `user_id`, and selects only `user_id, joined_at`; it reads at most two rows so duplicate active partners fail closed.
- Query error, thrown transport failure, malformed data, self identity, invalid join time, and multiple rows become retryable `partner-membership` full-sync failures.
- Presentation profile/service RPCs run before the final membership authority. Only the final authority result determines `connected` and whether presentation fields may enter the snapshot.
- A verified zero-row result publishes pending state and discards stale partner presentation. A presentation no-row plus one membership row publishes exact identity with empty presentation.
- `partnerUserId` and optional `partnerJoinedAt` are bound into the same active `CoupleInfo` returned by the successful `FullStateResult`.
- Profile invalidation now refuses an identity-less connected/active profile and retains the last verified profile and talk-about marks. This `store.tsx` change was made only after the focused RED test proved the previous guard accepted the incomplete response.
- The existing account/workspace generation guard was preserved; its delayed-account-A-after-account-B-login test passed without requiring generation-guard changes.
- The new internal `partner-membership` stage is normalized to the existing public `membership` UI stage, avoiding any UI file or UI contract change.

## Changed files

- `src/lib/coupleTimeline.ts`
- `src/lib/coupleTimeline.test.ts`
- `src/lib/sync.ts`
- `src/lib/sync.test.ts`
- `src/lib/store.tsx`
- `src/lib/store.test.tsx`
- This report only

No Home, UI, dailySummary, PartnerDay, receipt, migration, Supabase, or unrelated dirty file was changed by this task.

## Strict TDD evidence

### Expected RED

Command:

```text
npx vitest run --config vitest.config.ts --configLoader runner src/lib/coupleTimeline.test.ts src/lib/sync.test.ts src/lib/store.test.tsx
```

Result before implementation: EXPECTED FAIL — 3 files, 14 failed and 105 passed tests (119 total). The failures demonstrated the absent strict result/query, missing atomic partner identity, stale-presentation zero-row leak, unclassified membership authority failures, and the profile invalidation overwrite. The delayed A response after B login test was already green, proving the existing generation guard was sufficient for account switching.

An added invalid-timestamp case then produced the intended narrower RED: 1 failed and 20 passed tests in `coupleTimeline.test.ts`; validation was implemented before proceeding.

### Final focused GREEN

Command:

```text
npx vitest run --config vitest.config.ts --configLoader runner src/lib/coupleTimeline.test.ts src/lib/sync.test.ts src/lib/store.test.tsx
```

Result: PASS — 3 files, 120 passed tests.

## Verification

- Named Home/daily-summary/lifecycle/PartnerDay regressions: PASS — 12 files, 314 passed tests.
- `npm run typecheck`: PASS.
- `npx eslint src/lib/coupleTimeline.ts src/lib/sync.ts src/lib/store.tsx src/lib/coupleTimeline.test.ts src/lib/sync.test.ts src/lib/store.test.tsx --max-warnings 0`: PASS, zero warnings.
- `npm run test:phase0`: PASS — 70 migrations inspected (68 applied in harness; 041/042 frozen), 668 assertions. This existing local actor harness includes active-member and anon/unrelated/former-partner negative authorization coverage. It does not prove remote state.
- `npm run verify`: FAIL after typecheck PASS and full ESLint PASS; Vitest result was 297 passed files / 2 failed files and 4312 passed tests / 2 failed tests. Failures:
  - `src/components/MobileShell.designReview.test.tsx`: expects role `tab` named `홈`, while the unchanged implementation exposes a link.
  - `src/pages/SupportPage.test.tsx`: expects role `tablist` named `하단 내비게이션`, while the unchanged implementation exposes navigation.
- The two failures reproduced when run alone: 2 failed files, 2 failed and 10 passed tests. `git diff --quiet HEAD` over both tests and their implementation files returned exit 0, proving this task did not change those paths. They were not fixed because UI is explicitly out of scope.
- `npm run build`: BLOCKED after TypeScript compilation by `[gomsinlog] build aborted: VITE_SUPABASE_URL is missing or empty.` No environment value was invented or exposed.
- `git diff --check`: PASS before staging.

## Database, privacy, and production

- Database/schema/migrations: NOT CHANGED.
- Remote Supabase: NOT TOUCHED; remote state UNVERIFIED.
- Production: NOT APPLIED and UNVERIFIED.
- No identity was written to analytics, URLs, logs, or device-preference localStorage.
- No crypto, RLS, Storage authorization, receipt, Home, daily-summary, lifecycle, or PartnerDay semantics were changed.

## Remaining concerns

- Repository-wide verification is not fully green because of the two deterministic, unchanged, out-of-scope UI test mismatches above.
- A production-configured build was not verified because the required local build environment variable was absent.
- Phase 0 actor evidence is local harness evidence only; no remote or Production claim is made.

## Rollback

Revert the single atomic implementation commit containing the six source/test files and this report. No database, remote, or Production rollback is required.

## Gate decision

The requested privacy/correctness slice is focused-green and ready for independent review at the resulting commit. Do not claim the repository-wide verify gate or Production gate green until the unrelated UI expectations and a correctly configured build are handled by their respective owners.
