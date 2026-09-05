# Apple caller lifecycle review — HOLD

## Final local closure (supersedes local HOLD below)

Boyle independent Sol Max returned **PASS / M1 CLOSED, C0/H0/M0/L0, Spec/Quality PASS** at reviewed HEAD `7d8805d` with the exact final four hashes listed below. It performed independent source/call-path/hash/syntax review; runtime results remain parent-run PG180/Edge39, not reviewer reruns. Reviewer was closed.

Named index/stat/whitespace checks followed by two local commits, without source-byte edits:

- `c2785690c61f1b137aaa5c15dade5c5bf5cdfae7`: migration091 and PG harness (2 files).
- `abd5909bdd9508a4e46f8ecc4d47a510957b2f47`: Apple server/config/lock/tests and recovery runbook (13 files).

Photo commit `7d8805d` remains unchanged. Source WIP is committed; remaining dirty files are documentation/script-owned Now. Review impact: packaging-only, exact reviewed bytes preserved. Local rollback uses reviewed scoped reverts in reverse dependency order, not reset of unrelated work. No migration, master push or deployment occurred. Master transition remains pending automatic-deployment safety choice; this is not READY FOR PRODUCTION.

- HEAD: `7d8805db87bc060c455e576ff13057f8c28b0384`, branch `codex/rc-v5-final-fixes`.
- Independent Boyle Sol Max: C0/H0/M1/L0, Spec/Quality FAIL. Parent inspected actual SQL completion/finalizer bodies and confirmed missing caller-fence mechanism.
- M1: A claims token T under attempt X/lease LA; A canceled; B reuses X and reclaims T/lease LB, completes; late A completion can read B's token/terminal and return duplicate success without comparing caller lifecycle/lease. No-token A classification can similarly finalize B because the finalizer rereads B lifecycle rather than receiving A's original fence.
- Previous provider grammar/unknown-provider and catalog ACL findings are closed. Do not reopen them without new evidence.
- Existing 6181 Vitest / 36 Edge / 160 PG / 8 browser PASS do not cover these two missing event orders. Apple completion gate remains HOLD; photo commit remains preserved.

## Correction dispatch

Meitner Sol Max `01a07235-cee4-75e2-92a5-4f490babda0c` is sole writer. Exact source/test allowance: migration091, shared appleAuthCredentials helper and its test, dedicated apple-auth-credentials-harness.mjs. New paired ignored implementation report allowed. No client/handler/074/photo/Book/remote changes, no commit, no subagents. Parent writes no source.

Carry original claim lifecycle through all completion paths, reject missing/mismatched fences, preserve genuine same-lifecycle duplicate/advanced replay and evidence. Require actual PostgreSQL RED/GREEN for both event orders and helper propagation tests, then focused Edge/PG/typecheck/lint. Avoid unchanged full UI test reruns. Independent Boyle DELTA follows frozen source return.

REVIEW IMPACT: Apple DELTA required. Production/master push NOT APPLIED. User's explicit auto-deploy pause choice still pending. No overall RC or design completion claimed.

## Read-only integration preflight

## Correction returned and parent verification

Meitner returned and was closed. Four source files frozen at worker report hashes; parent independently recalculated all four and matched. Detailed report: `.superpowers/sdd/rc-closure-plan-2026-09-05/task-1-apple-caller-lifecycle-report.md`.

Parent executed `node scripts/phase0/apple-auth-credentials-harness.mjs`: **180 assertions PASS, exit0**, real disposable local PostgreSQL. Parent executed frozen Deno test command for shared helper, registration handler and deletion entrypoint: **39 passed / 0 failed, exit0**. Parent read helper claim validation, invocation fence pinning, no-token propagation, and stale-result handling. No extra source changes.

Boyle Sol Max resumed same independent review for exact caller-fence/lease-proof delta. Verdict PENDING. Original M1 is not declared closed until review returns. Prior full app 6181PASS/browser8PASS applies to unchanged client/photo; new server delta is evidenced by focused PG/Edge results, not an unexecuted full rerun. Worker non-gate Deno formatting check failed on whole-file style; scoped ESLint passed, no unrelated reformat.

Final hashes: SQL `6c19eab2105259181dd7231107529ccda3c3aa417ca1b701b5c10f2bbb9f11be`; helper `9fb4dfef5e3811df882af9d670cd4ef57a2020e9f93a460c7d63d155fdd8a4d5`; helper test `145a66621ad280fd819a63b396b71afe15537b1ba2f7e26dcade18274172b789`; harness `d43b09a03fd6287bffc3929a585c785f638d9bdd5f7f00d21236c0f8e348b3d5`.

`git ls-remote origin refs/heads/master` freshly returned `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`. `git merge-base --is-ancestor <that SHA> HEAD` exited 0. Current committed branch is 245 commits ahead, 625 changed files, 131535 insertions / 15064 deletions. This proves remote master ancestry, not release readiness or full-diff review.

Local `refs/heads/master` is stale at `82979baa8e6f1a61bee0a7ff72c67b75b370a221` and registered to a missing/prunable old temporary worktree. No pruning, branch movement, reset or cleanup was performed. Future integration must use freshly verified remote master as authority, not this stale local branch. The current workspace/root checkout is another branch and must not be overwritten. Apple writer handle was polled and remains running; no restart.
