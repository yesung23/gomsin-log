---
type: task
status: in-progress
phase: LV
pr: 70
tags:
  - task
  - phase/lv
  - blocker
---

# Task: PartnerDay Checkpoint State Machine

The missed-context surface — `상대방의 오늘` / `놓친 하루`. PRODUCT_V3 §6.5.

## Status: OPEN — known defect, do not merge

An eighth round is required. See [[2026-08-19_1100_partnerday-architecture-review_opus]].

**Defect:** a record shown on screen and never acknowledged is silently lost. Without an
acknowledgement no checkpoint exists, so the surface falls back to a rolling seven-day
date window and the record ages out with no user action.

## Defect history

Seven defects, all the same mistake: memory derived from a clock instead of stored.

| # | Defect | Found by |
|---|---|---|
| 1 | Today-only filter lost multi-day context | original review |
| 2 | Mount-driven acknowledgement collapsed the window | self-review |
| 3 | Late old-date arrival hidden forever | cold review 1 |
| 4 | 500-id cap made the surface unclearable | cold review 2 |
| 5 | Bound rollback resurrected history (3 → 295) | cold review 3 |
| 6 | Future record entombed by domain mismatch | cold review 4 |
| 7 | **Surfaced-but-unconfirmed ages out** | architecture review |

## Next action

Implement W1–W8 from the architecture review. Write the repro test **first** and confirm
it fails on the current HEAD.

## Agents involved

[[Claude Opus]] · [[Codex]] (unavailable) · [[Kiro]] (next implementer)

See [[Start Here]] · [[Current Gate]]
