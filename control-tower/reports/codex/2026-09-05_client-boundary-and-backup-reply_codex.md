# Client integration boundary and backup coordination

HEAD 88d8f53, branch codex/rc-v5-final-fixes. Parent coordination only; no runtime,
test, database or remote changes. Archimedes server fix remains running (bounded wait
timed out, not failed); Popper readonly SolMax Architect returned and was closed.

## Client decision

Accept session-bound captured bearer and UID fencing for Apple credential registration;
registration failure must not invalidate a verified login or sign out a newer account.
Keep authorization codes out of persistence/logs. Preserve structured Apple deletion
guidance across all result reconstruction and route teardown paths; missing evidence is
unverified, not not_required. A late Account A response must never alter Account B.

Parent rejects hosted deployment as a prerequisite to local client implementation:
reviewed frozen server contract plus mocks permits development; hosted proof remains an
activation gate. Proposed retry timings and wire labels are not authoritative. Final
brief must follow the server's reviewed retry/code-reuse semantics. No client writer
dispatched while server writer owns the implementation slot.

Detailed accepted requirements and negative cases remain in the ignored execution plan:
.superpowers/sdd/rc-closure-plan-2026-09-05/task-1-client-architect-ruling.md.
This is architecture guidance, not implementation or test PASS; fresh server review pending.

## Book Studio coordination reply

Book owner reports no direct tracked-code/document reference to the two named August26/27
backup folders. That is not proof of no operational dependency, restoration viability or
permission to delete. Shared Supabase restoration evidence remains UNVERIFIED/HOLD.
Parent has not independently inspected Book's release receipt or backup contents and does
not adopt its separate deployment claim as app release evidence. No backup deletion,
retention extension, remote migration or Book change performed.

## Next gate and rollback

Native follow-up returned: exactly App.entitlements, project.pbxproj, nativeConfig.test.ts
plus ignored worker report. Parent read actual three-file diff: Default Apple entitlement
and target capability added, obsolete web-only comment removed, CompleteProtection/IAP preserved.
Parent independently ran both plutil lints PASS and focused nativeConfig via matching root
Vitest CLI:75PASS/2SKIP at21:53:34,603ms. Skips are not PASS. No signed/device evidence.
Parent staged exactly those three native paths, inspected cached stat/check, and committed
676eda2 (fix(ios): declare native Sign in with Apple capability). OldHEAD88d8f53;
postcommit stat confirms3files41insertions13deletions; index empty. No server paths included,
reviewer warned about unrelated HEAD advance. No push/master merge or remote action.
Full Vitest is separately running under PTY26414; native files changed during that run,
so use this post-return focused result for native freshness. No full-suite verdict yet.
Server frozen under Hubble SolMax independent review; no server review approval inferred.
Client trace identifies metadata loss in classifiers, Store cleanup/reconstruction and recovery;
memory-only readable explicit-dismiss guidance must survive route teardown, not AccountB login.

Finish current server fix, independently review exact patch, then integrate client contract
and native capability slice with separate verification. Restore rehearsal remains necessary
before consequential production database changes. Documentation-only update needs no runtime
rollback; preserve all existing WIP. Production NOT APPLIED; whole RC remains incomplete.
