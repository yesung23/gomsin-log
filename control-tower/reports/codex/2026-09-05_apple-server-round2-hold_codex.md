# Apple server re-review: HOLD C0/H1/M2/L2

Hubble SolMax independent result on frozen15server paths, aggregate SHA256
0aa8eb50ae405f24423b58d53ff6a08e8e559db00f1cfee88fb44319ed909ed3.
HEAD88d8f53->676eda2 native-only committed delta; separately authorized photo WIP is out of
server review scope, not an unauthorized change. Reviewer confirms server byte equality.

## Findings accepted after parent source inspection

- HIGH:091 SQL288 excludes live revoke_in_flight lease;301 treats any remaining token as fully
  revoked. Superseding deletion B can persist premature terminal while A waits for Apple; A completion
  then stale, Auth cascade removes custody. Reviewer real001..091 PG reproduces. Parent confirms
  predicate/terminal source, has not independently rerun the inline race. Fix every terminal path:
  unsettled tokens prevent success; live/null-lease cases fail closed; retain custody until proof.
- MEDIUM: helper601 boolean provider classification treats missing/malformed optional metadata as
  explicit non-Apple. Require apple/explicit_non_apple/unknown; unknown never verified_not_required.
- MEDIUM: operator RPC356 validates reference but378 persists no reference. Store bounded evidence
  atomically with exact token/attempt decision; preserve readback and authorization negatives.
- LOW: helper393 awaits non-cooperative reader.cancel after timeout without a bound.
- LOW: not_required metadata omitted; terminal reason narrowed to credential_unrecoverable even for
  exchange uncertainty. Emit explicit allowlisted status/reason; legacy missing remains unverified.

Prior HIGH3 custody-before-verification, sticky uncertainty and advanced evidence replay were confirmed
fixed; do not reopen wholesale. New premature terminal invalidates aggregate safety, so integration HOLD.
Current9RPC/3tables negative coverage matches, but list is hardcoded, not automatic catalog discovery.

## Independent verification reported

Deno20+8+5 PASS; Vitest95PASS; PG91 plus expanded97/race reproduction; P076,storage/authz668,
P5105,writefloor39,rollback3scenarios PASS; Deno check/TS nonincremental/lint/syntax/diff PASS.
Initial Deno permission and unsupported option errors were corrected; not hidden PASS attempts.
These are reviewer-run results, not parent reexecution. Parent full6122/native75 evidence separate.
No hosted/provider/device evidence. No reviewer writes, commit, deployment.

## Decision / next

Architect clarification accepted: account-only terminal evidence misses intermediate tokenA manual
decision when tokenB forces retry. Each existing token row must atomically retain its own bounded
reference/time with original attempt/reason; exact retries read-only, conflicts stale. Direct no-token
operator decisions use account fields. Aggregation never overwrites per-token evidence. No new table;
DB evidence cascades on Auth deletion, so post-deletion audit depends on external protected ticket,
not a claim of indefinite DB retention. Add executable tokenA/B retry/idempotency evidence tests.
Round2 queued brief now has no unresolved design question. Photo solewriter still owns active work;
server implementation has not started. Parent made no source/test edits.

Hubble reused READONLY Architect for minimal all-terminal invariant and evidence storage prescription.
Photo sole writer continues; server fix queued after return, no overlapping writers. Parent plans only.
No server commit/remote091/provider activation; wholeRC not ready. Future fix requires executable
delete/delete regression and fresh independent DELTA. Rollback local named server patch only;
preserve native commits, photo work, existing migrations and user-content crypto.
