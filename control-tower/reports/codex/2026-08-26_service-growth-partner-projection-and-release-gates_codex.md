# 2026-08-26/27 Service Growth, Partner Projection 063, and Release Gates Evidence Report

## Verdict

**Local feature/security/native gate verdict: PASS. Overall App Store release verdict: CONDITIONAL PASS / HOLD.**

 - **Sol High final security/privacy delta**: **PASS**, P0/P1/P2/P3 all 0, valid for committed HEAD `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21` plus current dirty worktree. Production approval not granted; 063 NOT APPLIED, remote UNVERIFIED.
 - **Terra High final local release/native delta**: Initially found one P3 stale README iOS 14 statement; `packages/capacitor-on-device-summary/README.md` was corrected to iOS 15 floor + iOS 26 FoundationModels runtime gate; narrow recheck **PASS**, P0-P2 remain 0 and P3 closed. `git diff --check` PASS.
 - **Local gate verdict**: Feature, security, and native gates **PASS**.
 - **Overall App Store release verdict**: **CONDITIONAL PASS / HOLD** because remote Supabase/Vercel/Apple config, physical iPhone (on-device AI and Secure Enclave), and signed archive/TestFlight distribution remain unverified.
 - **Production mutation**: Zero mutations performed. No commit, no push, no deploy, no remote Supabase/Vercel/Apple mutation.

Initial final Terra review HOLD (P1 full verify not rerun, P2 V4 docs contradiction, P2 E2E soldier RPC non-call observation gap) and initial Sol security review HOLD (P2 stale partnerMilitary survived quarantine/disconnect, P3 regex-only impossible dates) were fully remediated locally. Focused remediation tests (8 files / 147 tests), fresh-chain PostgreSQL 17 testing (001..063, 369 assertions), Playwright E2E with real RPC request observation (2 passed), and fresh exact command `LANG=en_US.UTF-8 npm run verify` (exit code 0, 252/252 files, 3586/3586 tests, build 2164 modules, partnerDay seed 991 passed in full suite, nativeConfig 57 passed) all PASS. Following the full verify PASS, an additional native packaging delta was verified for Xcode 27 warning remediation (iOS floor 14.0 -> 15.0 normalization across Podfile, pbxproj, and podspecs, post_install normalization, zero 14.0 warnings, focused native tests 127/127 PASS with nativeConfig 61/61 PASS, and clean simulator build). Final Sol High security/privacy delta and Terra High local release/native delta re-reviews are complete and PASS. Migration 063 is LOCAL FILE ONLY and has NOT been applied to remote Production Supabase. Remote Supabase current state, Vercel deployment, Apple provider/redirects, and physical iPhone/TestFlight gates remain UNVERIFIED and BLOCKED. Production unchanged.

## Repository identity and preservation

- repository: `/Users/han-yejun/Desktop/곰신로그`
- branch: `codex/profile-post-composer`
- committed HEAD: `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21`
- origin/master: `d9a2eb0a22b657c6384d59d1a53aa668fdb286f0`
- state: dirty, uncommitted
- preserved unrelated work: user-owned post composer, record protection, E2EE, and documentation changes were preserved; nothing was committed or pushed
- destructive Git operations: none

## Direction check

- Product docs checked: `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`
- Business docs checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering docs checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`, `docs/APP_STORE_RELEASE_PLAN_2026-08-25.md`
- Current-state & work log checked: `docs/CURRENT_STATE.md`, `docs/WORK_LOG.md`
- Conflict with canonical direction: **NO**
- Rationale: Service level progression is strictly derived from actual enlistment and discharge dates and personal decoration; it introduces no relationship score, affection score, or AI ranking. Partner projection provides read-only sanitized data without exposing private profiles or notes.

## Implemented local behavior

1. **Service growth UI (7 tiers & EXP separation)**:
   - 7 tiers: 신병, 일초, 일꺾, 일말, 상초, 상꺾, 왕고.
   - 1 second = 1 EXP progression rate.
   - EXP resets within each tier (0→100%) to indicate progress toward the next promotion, while cumulative total service percentage is tracked and displayed separately.
   - Full tier list is presented through progressive disclosure.
   - Soldier sees own editable service details; connected gomsin sees partner service in read-only mode.
   - Standalone action targets meet the 44px minimum touch target requirement.
   - No relationship scoring or AI rank calculations.

2. **Migration 063 (`get_partner_service_info` RPC)**:
   - LOCAL FILE ONLY; NOT APPLIED to remote Production Supabase.
   - Defined as a `SECURITY DEFINER` function with pinned `search_path = public, pg_temp`.
   - Returns an allowlist only: `branch`, `military_status`, `enlistment_date`, `expected_discharge_date`, `discharge_date`, `discharge_date_source`.
   - Explicitly excludes the soldier's free-form `memo` and keeps the owner-only `profiles` table row inaccessible.
   - Authorization rules:
     - Rejects unauthenticated callers (`auth.uid()` IS NULL) with SQLSTATE `42501`.
     - Requires caller to be an active gomsin (`status = 'active' AND role = 'gomsin'`).
     - Requires partner to be an active soldier (`status = 'active' AND role = 'soldier'`).
     - Enforces exactly 2 active couple members; returns zero rows if anomalous members exist.
     - Denies or returns zero rows for anon, unrelated users, former partners, or soldier callers.
     - Revokes all permissions from PUBLIC, anon, authenticated; grants EXECUTE only to authenticated.

3. **Local iOS developer signing configuration**:
   - Tracked `ios/App/Config.xcconfig` optionally includes `LocalSigning.xcconfig` via `#include? "LocalSigning.xcconfig"`.
   - `ios/App/LocalSigning.xcconfig` is ignored in `.gitignore` to prevent accidental commitment of developer Team IDs.
   - Tracked template `ios/App/LocalSigning.xcconfig.example` contains only placeholder `YOUR_TEAM_ID`.
   - Zero secrets or actual Apple Team IDs are tracked in Git or documentation.

4. **Xcode 27 warning remediation & native packaging floor normalization**:
   - Source iOS floor changed 14.0 -> 15.0 in `ios/App/Podfile`, 4 App project deployment-target settings (`project.pbxproj`), and two local plugin podspecs (`GomsinlogCapacitorDeviceKeys.podspec`, `GomsinlogCapacitorOnDeviceSummary.podspec`). `Podfile.lock` checksums regenerated by `pod install`.
   - `Podfile` `post_install` normalizes generated third-party pod targets to 15.0; generated Pods project was not manually edited.
   - Broad Xcode recommended settings button was not used.
   - `[CP] Embed Pods Frameworks` no-output warning remains harmless/non-blocking because Podfile intentionally uses `disable_input_output_paths` and CocoaPods generates it; no generated script edit.
   - `src/lib/nativeConfig.test.ts` updated with deployment target consistency assertions and comment cleanup.

## Initial review findings and local remediation

- **Initial final Terra review HOLD**:
  - P1: Full verify not rerun after native signing repair.
  - P2: V4 docs contradiction regarding partner projection and EXP reset.
  - P2: E2E soldier RPC non-call observation gap (did not verify soldier made 0 calls).
- **Initial Sol security review HOLD**:
  - P2: Stale `partnerMilitary` survived quarantine (`store.tsx`) and lifecycle negative membership / disconnect (`coupleLifecycle.ts`).
  - P3: Regex-only date validation allowed impossible calendar dates (e.g. `2026-02-30`).
- **Remediation implemented locally**:
  - `partnerMilitary` explicitly cleared in quarantine (`store.tsx`) and couple lifecycle negative membership / disconnect (`coupleLifecycle.ts`).
  - Disconnected render strictly requires `connected` in `SearchPage.tsx` (`hasPartnerService = connected && ...`).
  - Strict UTC round-trip calendar date validation in `sync.ts` (`isValidCalendarDate`: verifies parse round-trip so impossible calendar dates are rejected).
  - Real E2E request observation in Playwright (`e2e/serviceGrowth.spec.ts`: `expect(partnerServiceRpcCalls).toBe(1)` for gomsin, `expect(partnerServiceRpcCalls).toBe(0)` for soldier).
  - V4 docs aligned (`docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`).

## Exact verification evidence

| Verification command | Status | Proven scope & constraints |
|---|---|---|
| `npx vitest run src/lib/sync.test.ts src/lib/coupleLifecycle.test.ts src/lib/store.test.tsx src/features/search/searchPage.test.tsx src/lib/serviceLevel.test.ts src/lib/migration063.test.ts src/lib/migrationSecurityContracts.test.ts src/lib/nativeConfig.test.ts` | **PASS** (8 files, 147 tests) | Focused remediation tests: quarantine/disconnect partnerMilitary cleanup, strict UTC date validation, 063 sync/security contracts, Search rendering, service tier math, and native signing isolation. |
| `npm run typecheck` | **PASS** | TypeScript compiler clean (0 errors). |
| Scoped ESLint | **PASS** | Targeted ESLint clean on all relevant modified files. |
| `npm run test:phase0` | **PASS** (369 assertions) | PostgreSQL 17 fresh chain, 61 migrations (001..063), actor matrix (gomsin, soldier, anon, unrelated, former, NULL actor, 3-member anomaly) strictly verified. |
| `git diff --check` | **PASS** | No whitespace errors or unresolved merge conflict markers. |
| `npx playwright test e2e/serviceGrowth.spec.ts` | **PASS** (2 passed) | Browser mock rendering for soldier own service (390px) and gomsin partner service (390px). Screenshots captured at `ui-audit-results/service-growth/`. Real network request observation: soldier 0 calls, gomsin 1 call. Browser mock evidence only; not physical iPhone. |
| `npm run build` && `npx cap sync ios` && simulator `xcodebuild` (prior run) | **PASS** (`BUILD SUCCEEDED`) | Web production build (2164 modules), Capacitor sync, and unsigned CocoaPods iOS Simulator build succeeded. |
| `LANG=en_US.UTF-8 npm run verify` (fresh exact command) | **PASS** (exit 0) | Typecheck PASS, full lint PASS, Vitest 252/252 files and 3586/3586 tests PASS, production build PASS with 2164 modules. `partnerDay` seed 991 passed in full suite; `nativeConfig` 57 passed. |
| Focused native tests | **PASS** (127/127 tests) | Focused native test suite passed. Unit test `src/lib/nativeConfig.test.ts` now 61/61 PASS after comment cleanup. |
| `pod install` && `npx cap sync ios` | **PASS** | CocoaPods install succeeded, `Podfile.lock` checksums regenerated, and Capacitor iOS sync clean. |
| `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -showBuildSettings` | **PASS** | Reports `IPHONEOS_DEPLOYMENT_TARGET = 15.0` and `RECOMMENDED_IPHONEOS_DEPLOYMENT_TARGET = 15.0`. |
| Unsigned generic iOS Simulator clean build (`xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO clean build`) | **PASS** (`BUILD SUCCEEDED`) | Unsigned workspace simulator clean compile and link succeeded. Unsupported 14.0 warnings: 0. Harmless `[CP] Embed Pods Frameworks` warning remains non-blocking due to intentional `disable_input_output_paths`. |
| Targeted native packaging delta validation | **PASS** | Targeted native delta validation completed after documented full verify PASS; does not claim a second full verify. |
| Sol High final security/privacy delta review | **PASS** (P0/P1/P2/P3 all 0) | Valid for committed HEAD `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21` plus current dirty worktree. Production approval not granted; 063 NOT APPLIED, remote UNVERIFIED. |
| Terra High final local release/native delta review | **PASS** (P0-P2: 0, P3 closed) | Initially found one P3 stale README iOS 14 statement; `packages/capacitor-on-device-summary/README.md` was corrected to iOS 15 floor + iOS 26 FoundationModels runtime gate; narrow recheck PASS, P0-P2 remain 0 and P3 closed. `git diff --check` PASS. |
| Local feature/security/native gate verdict | **PASS** | Complete local suite, migration contracts, security delta, and native build/packaging passed. |
| Overall App Store release verdict | **CONDITIONAL PASS / HOLD** | Remote Supabase/Vercel/Apple configuration, physical iPhone runtime, and signed archive/TestFlight remain unverified. |

## Remote and environment status

- **App Store Release Verdict**: **CONDITIONAL PASS / HOLD** because remote Supabase/Vercel/Apple config, physical iPhone, and signed archive/TestFlight remain unverified; local feature/security/native gate verdict PASS.
- **Remote Supabase**: **UNVERIFIED**. Migration 063 is **NOT APPLIED** to Production.
- **Vercel Web**: **UNVERIFIED**. Exact deployed commit SHA and environment variables not checked live.
- **Apple Provider & Redirects**: **UNVERIFIED**. Redirect allowlist and query-aware native callback handling require live configuration check.
- **Physical Device & TestFlight**: **UNVERIFIED / BLOCKED**. Apple Developer signing, archive build, TestFlight distribution, and on-device Secure Enclave testing require physical hardware and credentials.
- **Production Mutations**: Zero mutations performed. No remote SQL, no deploy, no push, no commit.

## Review freshness & rollback

- **Review Impact**: **DELTA**. Sol High final security/privacy delta PASS (P0/P1/P2/P3 all 0, valid for committed HEAD `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21` plus current dirty worktree; Production approval not granted, 063 NOT APPLIED, remote UNVERIFIED). Terra High final local release/native delta PASS (initially found one P3 stale README iOS 14 statement in `packages/capacitor-on-device-summary/README.md`, corrected to iOS 15 floor + iOS 26 FoundationModels runtime gate, narrow recheck PASS, P0-P2 remain 0 and P3 closed, `git diff --check` PASS). Local feature/security/native gate verdict PASS. Overall App Store release verdict remains CONDITIONAL PASS/HOLD because remote Supabase/Vercel/Apple config, physical iPhone, signed archive/TestFlight remain unverified. Production unchanged; no commit/push/deploy/Production mutation.
- **Rollback strategy**: Revert only the isolated named commit/delta after it exists, or disable partner display and leave migration 063 unapplied. No destructive command or working-tree discard is used, preserving all unrelated in-progress work. Since migration 063 has not been applied remotely, remote Supabase requires no rollback.

## Next safe actions

1. Local review gates are complete: Sol High delta PASS (P0-P3: 0) and Terra High delta PASS (P0-P2: 0, P3 closed).
2. Isolate and stage named feature and signing configuration files for commit.
3. Keep production changes gated: any future remote migration requires verified live catalog state, blast-radius assessment, rollback runbook, and explicit user confirmation.
