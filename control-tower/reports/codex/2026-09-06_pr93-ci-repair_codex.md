# PR 93 first CI findings and configuration repair

- Base: `065592f48c582d5a87d75c1b8082fe435e7f20f1`, `codex/rc-v5-final-fixes`.
- GitHub first runs: master `33980196939`, native `33980196942`. Not a release pass.
- Web Vitest: 6177 passed, 3 failed, 3 skipped. Missing three Apple sources in check:edge; PostgreSQL 16 selected while two suites require 17.
- Browser: 188 passed, 7 failed. Separate worker owns old EXP expectations, photo metadata mock routing, and unresolved OCR draft flow. No browser issue is declared fixed by this configuration commit.
- Deno failed cold dependency resolution for pinned jose. Scripts now install via Deno auto node_modules with frozen lock and include Apple source/tests.
- Native compile and built bundle checks passed; stale Apple entitlement prohibition failed. CI now asserts exactly the already-approved Apple Default and complete data-protection entries; no source entitlement or provider change.
- Initial textual scanner review requested changes for broad inherited path exclusions, repeated sentinels, and history coverage. Final delta removes path exclusions, limits each exact path/content sentinel to one occurrence, and adds explicit full BASE_SHA..HEAD gitleaks scan. Parent declined brittle line-number identity: duplicate counting preserves the intended bound without breaking on unrelated line insertions. Text-only scanner limits are explicit; known signing-file history and full-range gitleaks complement it.
- Parent independently inspected the final scanner/workflow/package diff and executed scanner controls plus worktree scan: PASS; diff check PASS. Worker cold-cache Edge check PASS, Edge82 PASS, repaired Vitest45 PASS, native128 PASS/2 SKIP, YAML/JSON PASS. Worker interrupted redundant full Vitest at exit130, not PASS.
- Worker detailed local evidence: `.superpowers/sdd/rc-closure-plan-2026-09-05/task-ci-repair-report.md`.
- REVIEW IMPACT: DELTA. Parent closes the bounded scanner findings from actual changed code and negative controls; GitHub rerun remains required. No claim of new independent full-app security approval.
- Not changed: application/auth/crypto source, database, migrations, production, Book Studio. Now.md claim preserved.
- Remote catalog Architect confirmed old account-deletion columns and absent media/Apple custody structures. Candidate dependencies 074→076→078→083–088→090, and 074→091 are not an apply instruction. Existing RPC compatibility, backup/restore rehearsal, hosted actor tests remain unverified; full chain replay prohibited.
- Rollback: revert this CI-only change; do not relax tests or deploy the incompatible artifact.
- Next: rerun CI, repair browser failures, protected master merge, then approved notebook Home. Home redesign and beta are NOT COMPLETE.
