# GomsinLog service-readiness gates — 2026-09-01

Goal: a release candidate that is safe against known data-loss/auth/privacy failures, deterministic under CI, observable without leaking user content, and no slower on the default path than GitHub master by more than a small bounded regression.

## Release-candidate gates

- [ ] SR1 — No known P0/P1/P2 in the active release delta after independent review.
  Evidence: independent read-only security/reliability review of exact current diff.

- [ ] SR2 — Full application verification is green.
  CHECK: npm run verify
  EXPECT: exit 0

- [ ] SR3 — Security and lifecycle harnesses are green on a throwaway database/native static checks.
  CHECK: npm run test:p0 && npm run test:phase0 && npm run test:p5 && npm run test:write-floor && npm run verify:native
  EXPECT: exit 0

- [ ] SR4 — Error reporting is explicit opt-in, privacy-safe, failure-isolated, and not part of the default startup bundle.
  Evidence: Sentry unit tests, ErrorBoundary review, production build chunk inspection.

- [ ] SR5 — Default-path performance is benchmarked against live GitHub master `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`.
  Baseline from GitHub Actions run 33138693749: main JS 436.99 kB / 133.54 kB gzip; CSS 326.61 kB / 66.60 kB gzip; 3760 tests passed + 1 skipped; native 106 passed.
  Target: main initial JS gzip <= 140.22 kB (+5%); no Sentry runtime in the initial chunk when disabled.

- [ ] SR6 — CI/release configuration has no known imminent platform deprecation or secret-handling defect that can make green builds non-reproducible.
  Evidence: workflow review and package dependency audit.

- [ ] SR7 — Account deletion and other critical lifecycle code included in the working tree is syntactically valid and either release-wired + verified or explicitly excluded/unshipped; no patch artifacts may break lint/test discovery.
  Evidence: focused test/lint and call-path classification.

- [ ] SR8 — Remote/production truth is separated from local proof.
  Current authenticated Supabase actor/catalog, physical iPhone, and TestFlight remain UNVERIFIED unless freshly demonstrated. Exposed DB credential must be rotated before production release.

- [ ] SR9 — Git integration is safe: no reset/stash/rebase of unrelated dirty work; exact release-owned files are classified before any commit/PR/merge.

- [ ] SR10 — Completion is recorded in `docs/WORK_LOG.md`, `docs/CURRENT_STATE.md` where reality changed, and `control-tower/reports/` + Obsidian control-tower report.

## Current evidence — 2026-09-01 service-readiness closure

- [x] SR1 — Terra final exact-tree review: PASS; the scoped delta has no P0/P1/P2.
- [x] SR2 — `npm run verify`: PASS; 268 test files / 3,807 tests, typecheck, lint, and build.
- [x] SR3 — `test:p0` 76, `test:phase0` 420, `test:p5` 105, `test:write-floor` 39, `test:rollback`, and `verify:native` 106: PASS.
- [x] SR4 — Sentry/privacy tests pass; current initial entry gzip is 134.17 kB and contains no Sentry code when disabled.
- [ ] SR5 — Local performance target passes (134.17 kB gzip <= 140.22 kB), but a fresh comparative GitHub benchmark for the uncommitted delta is UNVERIFIED.
- [ ] SR6 — Workflow static review and `npm audit` pass, but the Release artifact is blocked until the required publishable key is supplied without logging it; current CI for this uncommitted delta is UNVERIFIED.
- [x] SR7 — AccountDeletion V2 remains unshipped and unreferenced; current lifecycle/Edge paths are type-checked and tested.
- [ ] SR8 — Remote Supabase actor/catalog, credential rotation, Production, TestFlight, and physical iPhone remain UNVERIFIED; no remote mutation was made.
- [x] SR9 — No reset, stash, rebase, clean, broad restore, commit, push, merge, or deploy was performed; unrelated dirty work remains isolated.
- [x] SR10 — This closure is recorded in `docs/CURRENT_STATE.md`, `docs/WORK_LOG.md`, this gate file, and the Control Tower report.

### Verdict

Scoped code delta: **PASS**. Overall device/TestFlight/Production release: **NOT READY** until the Release key, remote security hygiene, current CI, and a connected physical iPhone are separately verified.
