---
type: gate
status: open
tags:
  - gate
---

# Current Gate

> Updated 2026-08-20 by [[Claude Opus]] acting as Control Tower, during the branch
> consolidation that landed every branch's still-valid work on master.
> Deliberately contains **no SHAs, PR states or CI run ids** — those rot. Run
> `bash scripts/agent/live-state.sh`.

## Gate: LV — Limited Validation · **OPEN**

P5.5 is closed (see [[Decision Log]]). The active work is LV readiness.

## What blocked it — CLOSED

[[PartnerDay Checkpoint State Machine]] had a known open defect: **a record shown on
screen and never acknowledged is silently lost.** With no acknowledgement there was no
persisted checkpoint, so the surface fell back to a rolling seven-day window and the
record aged out with no user action in between.

That violated the product's core promise — 함께하지 못한 하루를 안전하게 이어준다.

W1–W8 from [[2026-08-19_1100_partnerday-architecture-review_opus]] were implemented as a
clean replacement on master and landed in the consolidation. `OUTSTANDING` is now
persisted when a record is **shown**; acknowledgement is the only writer of `CONFIRMED`;
and membership is decided only by the transitions that add to and remove from the set,
so no amount of elapsed time can empty it. A corrupt receipt recovers unbounded by date,
and a receipt this device could not *read* is never written over.

## What to build next

The gate is no longer blocked on that defect. What stands between here and LV-ready is
listed under *Known, deferred* below — chiefly that unbounded `OUTSTANDING` growth is a
storage-capacity product decision nobody has made yet, and that no multi-day run on a
physical device has happened.

**Write the repro test first** for anything new on this surface. Eight defects here have
been found by reproduction and none by reading.

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
