# Partner Briefing B1 and localization/general-couple expansion stop

- Worktree: `/Users/han-yejun/Desktop/곰신로그-partner-briefing`
- Branch: `codex/partner-briefing`
- Reviewed HEAD: `c7fd6e69f3113662be4f5d5b31aeb0a0f45b9bf0`
- Production: **NOT APPLIED**

## Completed

Gate B1 added `usePartnerBriefing` and 24 focused tests. The hook consumes only the caller-supplied PartnerDay surface, builds an immediate deterministic exact-source result, optionally runs the verified on-device pipeline, and prevents stale, unmounted, timed-out, or late responses from replacing the current result.

Direct verification passed:

- `npx vitest run src/lib/partnerBriefing/usePartnerBriefing.test.tsx` — 1 file / 24 tests
- `npm run typecheck`
- targeted ESLint for the two B1 files
- `git diff --check`

## Why B2 stopped

The latest request adds English and asks the product to work naturally for general couples. The active contract currently emits Korean deterministic templates and the application has no shared locale boundary. General-couple support is broader: `Role` is persisted as `gomsin | soldier` and participates in onboarding, store/sync logic, role-specific product surfaces, and database projection/security semantics.

The canonical business roadmap defines general-couple expansion as a later segment after validating the initial military-couple market. The new request is therefore an intentional sequencing/product-contract change, not a copy-only B2 task. The B2 Worker was interrupted before creating any UI file.

## Recommended architecture amendment

1. Add localization independently: `AppLocale = 'ko' | 'en'`, device-local preference, a small typed copy catalog, and locale propagation through Partner Briefing deterministic fallback, provider availability/request, and UI. Keep IDs/provenance/privacy unchanged.
2. Keep the product loop role-neutral in copy: “상대”, “지난 연락 이후”, and “함께하지 못한 시간”. Military-service surfaces remain an optional context, not the universal navigation language.
3. Add general couples only through an additive relationship context such as `military | long_distance | shift_work | general`; preserve existing couples as `military` by backfill/default. Do not overload or silently reinterpret current `gomsin/soldier` values.
4. Before any DB work, design actor matrix, RLS/RPC compatibility, migration/backfill, rollback, and old-client behavior. No production mutation occurred.

## Gate

`ORCHESTRATOR: BLOCKED` at the architecture/product-contract amendment. B1 is locally complete; B2-F and all localization/general-couple implementation remain unreviewed and unapplied.
