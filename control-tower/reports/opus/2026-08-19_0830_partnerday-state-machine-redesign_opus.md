---
agent: opus
agent_note: "[[Claude Opus]]"
date: 2026-08-19
time: "08:30"
task: "PartnerDay checkpoint state machine redesign"
phase: LV
status: closed
canonical: false
tags:
  - agent/opus
  - phase/lv
  - report
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[Claude Opus]] · Task: [[PartnerDay Checkpoint State Machine]]

# PartnerDay State Machine Redesign (PR #70)

## What was requested

Four cold isolated reviews each returned CHANGES_REQUIRED. Control Tower authorised a
state-machine redesign rather than a fifth one-field patch.

## What was actually done

Replaced the single date lower bound with three separately stored id sets — CONFIRMED,
OUTSTANDING, OBSERVED — and one authoritative eligibility helper
(`eligibleSharedPartnerRecords`) shared by the surface and the observation snapshot, so
`OBSERVED ⊆ ELIGIBLE` holds by construction. Every persisted date used for membership
was removed. The 500-id cap was removed; truncation had been manufacturing false
"never observed" verdicts.

## Defects found and closed, in order

1. Late-arriving old-date record hidden forever
2. 500-id cap making the window grow on acknowledgement, unclearable past ~500 records
3. Date-bound rollback resurrecting observed history (3 → 295, measured)
4. Future-dated record entombed by a domain mismatch on `todayStr`

Each was reproduced as a failing test before being fixed.

## Verification performed

`npm run verify` green. Seeded 1000-day simulation, later found vacuous and repaired.
Eight-mutation battery, all caught.

## Explicitly not verified

Real-device and remote Supabase. Local Playwright unavailable throughout.

## STOPPED AT

- Production: UNTOUCHED · Supabase: UNTOUCHED · P6: NOT AUTHORIZED
