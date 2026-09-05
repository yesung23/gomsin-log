# Browser CI and watchdog closure

## Exact-head remote follow-up: 12f97ea — browser HOLD

### D05 scoped correction verified locally

- The old upload-500 injection still received a successful final PATCH from the fixture; it did not represent an unknown final commit. The corrected scenario performs normal upload, applies the final PATCH in fixture memory, then drops that response and the status response. Existing hold assertions remain, with counters requiring one upload, one media PATCH, one status read and only the initial insert plus that PATCH. No app/DB behavior was changed and no real backend atomicity is claimed.
- Nietzsche worker: focused D05 1/1 PASS and full coupleMatrix 37/37 PASS. Parent independently inspected both changed test files and reran `CI=true GOMSINLOG_E2E_PORT=4191 npm run test:e2e -- e2e/coupleMatrix.spec.ts --grep 'unknown attachment commit'`: 1/1 PASS in12.9s. Scoped ESLint and diff-check PASS. Linux/full CI remains pending.
- Pascal readonly trip discovery found unbounded `worker.terminate()` after OCR timeout and same-account `state.trips` refresh closing the create sheet. Parent confirmed these source paths. They are next bounded runtime fixes; their causal role in the Linux failures is not yet proven. Production and master remain unchanged.

- GitHub master-validation run `33983511707`: 193 browser tests PASS, 3 FAIL. Failures are the unknown-attachment commit hold (`coupleMatrix.spec.ts:295`), map OCR draft dialog (`realUsability.spec.ts:369`), and new-trip dialog (`realUsability.spec.ts:492`). Local subset PASS did not establish full CI success.
- Typecheck/lint/Vitest/build/CSP/assets, PostgreSQL fresh-chain, Deno, boundary, audit and full-range secret checks passed. Native run `33983511648` iOS unsigned build, Android and Capacitor checks passed. Master merge remains NOT APPLIED; no protection bypass.
- Nietzsche Sol High is the bounded browser correction owner. Temporary diagnosis is not a reviewed fix. Parent does not edit app/test source. New notebook Home remains NOT IMPLEMENTED.
- Pasteur Terra Max read-only review of `12f97ea` distinguishes the superseded Apple lifecycle HOLD from deployment readiness. The latest Apple closure report records M1 CLOSED; parent independently checked the exact-true flag, production/release fuse and watchdog-only test delta. This supports conditional source integration with deployment held, not Apple activation or a new whole-app security verdict.
- Active production gaps: hosted schema/Edge compatibility, recoverable current backup, Apple provider/signing/device proof, and evidence resolving the previously reported DB-credential incident. The earlier secret scan is not proof of credential rotation. Physical iPhone is still unavailable; Xcode reports 26.6, not 27 beta.
- Existing production `/home` returned HTTP 200 during this check; that is availability evidence only, not new-build deployment or authenticated flow verification. REVIEW IMPACT: narrow DELTA; source implementation/retest still pending. Remote mutations in this follow-up: NOT APPLIED.

- Reviewed base `be085e18824c9f79336da2660b0c54f4e1ff4534`, branch `codex/rc-v5-final-fixes`, PR93.
- Parent inspected all seven implementation/test/config deltas after worker freeze. Application change is only removal of the inaccurate hardcoded 1/1 summary progress phrase; its baseline/status/algorithm/source binding remains unchanged.
- Browser fixtures now cover legacy photo API absence, seeded own/active-partner metadata, and media reservation/confirmation. Added negative tests reject third-author metadata, malformed photo pair, and replayed changed object/path lists. This mock is explicitly not SQL/RLS/Storage or hosted authorization evidence.
- Existing service-growth tests now assert the latest user-approved EXP/level and two progress bars while retaining read-only partner behavior, touch/contrast/reduced-motion tests. Optional isolated E2E port preserves CI defaults.
- The Apple watchdog test clears its own timer in finally; 20/150/140ms security assertions and production source are unchanged.
- Parent verification: StoryViewer52 PASS; Edge82 PASS; actual production-style mock browser27 PASS in28.4s with trace off; diff check PASS. Worker additionally ran normal trace groups27 PASS and Deno2.5.6 focused26 PASS. OCR passed locally in1.6s, but its earlier CI timeout remains unproven until the new GitHub run.
- Prior exact `be085e1` GitHub whole Vitest363 files/6181 PASS/2 SKIP; full web build/lint/type/CSP/assets PASS. iOS, Android, PostgreSQL contracts and secret scan PASS. Those are prior-source evidence, not automatic approval of this new commit.
- REVIEW IMPACT: DELTA. No new hosted security verdict. Remote Supabase/production/master merge NOT APPLIED at this checkpoint.
- Remaining: new GitHub full check, master integration before notebook Home implementation, hosted compatibility/recovery/Apple/client/native beta gates. Physical iPhone unavailable.
- Rollback: revert this scoped change; no schema or data rollback required. Do not deploy the old artifact against an incompatible schema without the separate release checks.
- Detailed local worker evidence: `.superpowers/sdd/rc-closure-plan-2026-09-05/task-browser-ci-report.md`.
