---
type: task
status: landed
phase: LV
pr: 72
tags:
  - task
  - phase/lv
---

# Task: PartnerDay Checkpoint State Machine

The missed-context surface — `상대방의 오늘` / `놓친 하루`. PRODUCT_V3 §6.5.

## Status: LANDED on master (2026-08-20 consolidation)

The eighth round was built as a **clean replacement on master**, not as a patch on the
seventh. See [[2026-08-19_1100_partnerday-architecture-review_opus]].

**The defect that forced it:** a record shown on screen and never acknowledged was
silently lost. Without an acknowledgement no checkpoint existed, so the surface fell back
to a rolling seven-day date window and the record aged out with no user action.

**What replaced it.** The checkpoint stores three sets — `confirmedRecordIds`,
`outstandingRecordIds`, `knownRecordIds` — and `OUTSTANDING` is what carries the product
promise. Its membership changes only through the transitions that add to and remove from
it, so elapsed time cannot empty it. A receipt read resolves to one of four states —
`missing` · `valid` · `corrupt` · `unavailable` — and each is handled distinctly: a
corrupt receipt recovers every eligible record unbounded by date, and an `unavailable`
read is never written back, so a storage that fails reads but accepts writes cannot
overwrite a healthy receipt. `acknowledgePartnerDayRecords` is the only writer of
`CONFIRMED`.

## Defect history

Eight defects, all the same mistake: memory derived from a clock instead of stored.

| # | Defect | Found by | State |
|---|---|---|---|
| 1 | Today-only filter lost multi-day context | original review | fixed |
| 2 | Mount-driven acknowledgement collapsed the window | self-review | fixed |
| 3 | Late old-date arrival hidden forever | cold review 1 | fixed |
| 4 | 500-id cap made the surface unclearable | cold review 2 | fixed |
| 5 | Bound rollback resurrected history (3 → 295) | cold review 3 | fixed |
| 6 | Future record entombed by domain mismatch | cold review 4 | fixed |
| 7 | **Surfaced-but-unconfirmed ages out** | architecture review | fixed by replacement |
| 8 | Corrupt receipt indistinguishable from a missing one | clean-replacement review | fixed |

## Next action

Not implementation. Two things are open and neither is a code defect:

- unbounded `OUTSTANDING` growth is a storage-capacity **product decision** — preserving
  unconfirmed records has been given priority over capacity, but no bound has been chosen
- no multi-day run on a physical device has been performed; only simulated time

## Agents involved

[[Claude Opus]] · [[Codex]] (unavailable) · [[Kiro]] (next reviewer)

See [[Start Here]] · [[Current Gate]]
