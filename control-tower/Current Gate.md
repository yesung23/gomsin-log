---
type: gate
status: in-progress
tags:
  - gate
---

# Current Gate

## What to build next

현재 실행선은 [엔지니어링 로드맵 §0](../docs/ENGINEERING_ROADMAP.md)와
[RC 종결 계획](../docs/operations/rc-closure-plan-2026-09-05.md)이다.
완료 여부·열린 blocker는 [CURRENT_STATE](../docs/CURRENT_STATE.md), exact-commit 검증은
[WORK_LOG](../docs/WORK_LOG.md)를 확인한다. 아래 8월 LV 기록으로 현재 일을 다시 배정하지 않는다.

한 구현자와 독립 검토/탐색 역할을 나누고, 완료된 항목은 같은 상태에서 재실행하지 않는다.
구현됨/로컬 검증/독립 리뷰/원격 적용을 구분한다. 모든 기능 구현만으로 RC를 선언하지 않는다.

## Standing constraints

- 최신 사용자 승인과 AGENTS의 canonical 표가 과거 리포트보다 우선한다.
- 실제 branch/HEAD/status, 점유는 session-start로 확인한다. 이 지도에 복제하지 않는다.
- Production/원격/실기기 상태는 확인 전 UNVERIFIED; 로컬 PASS를 외부 증거로 쓰지 않는다.
- 보안·데이터 손실 blocker를 남긴 채 release/merge를 진행하지 않는다.
- 현재 앱 task는 Book Studio 저장소를 수정하거나 대신 완료 판정하지 않는다.

## Historical LV gate — 2026-08-20 (현재 실행 지시 아님)

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

### Historical next work

The gate is no longer blocked on that defect. What stands between here and LV-ready is
listed under *Known, deferred* below — chiefly that unbounded `OUTSTANDING` growth is a
storage-capacity product decision nobody has made yet, and that no multi-day run on a
physical device has happened.

**Write the repro test first** for anything new on this surface. Eight defects here have
been found by reproduction and none by reading.

### Historical constraints

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
