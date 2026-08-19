---
type: gate
status: blocked
tags:
  - gate
  - blocker
---

# Current Gate

> Updated 2026-08-19 by [[Claude Opus]] acting as Control Tower, at the user's request.
> Previously stale: it still described P5.5 as the active gate, two PRs behind reality.
> Deliberately contains **no SHAs, PR states or CI run ids** — those rot. Run
> `bash scripts/agent/live-state.sh`.

## Gate: LV — Limited Validation · **BLOCKED**

P5.5 is closed (see [[Decision Log]]). The active work is LV readiness.

## What blocks it

[[PartnerDay Checkpoint State Machine]] has a known open defect: **a record shown on
screen and never acknowledged is silently lost.** With no acknowledgement there is no
persisted checkpoint, so the surface falls back to a rolling seven-day window and the
record ages out with no user action in between.

That violates the product's core promise — 함께하지 못한 하루를 안전하게 이어준다 — so the
PR cannot land in its current shape.

## What to build next

Items **W1–W8** from [[2026-08-19_1100_partnerday-architecture-review_opus]].

The shape of the fix: persist state when a record is **shown**, not only when it is
**acknowledged**. Acknowledgement stays the only writer of CONFIRMED.

**Write the repro test first** and confirm it fails on the current HEAD. Seven defects
here have been found by reproduction and none by reading.

## Standing constraints

- Production: NOT APPLIED
- Remote Supabase: no mutation; remote catalog UNVERIFIED
- Physical device: UNVERIFIED
- P6: NOT AUTHORIZED
- In-app chat: FROZEN / DEFERRED
- Security semantic delta on the active PR: NONE

## Known, deferred (POST_LV)

- localStorage quota eventually makes the surface unclearable (fail-safe direction)
- the partner-day key survives account deletion
- CareHint does not refresh in the same mount after an acknowledgement
- test files are excluded from typecheck in `tsconfig.json`, which let a missing
  required field compile silently
