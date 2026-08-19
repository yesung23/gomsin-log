---
agent: opus
agent_note: "[[Claude Opus]]"
date: 2026-08-19
time: "11:00"
task: "Architecture review — surfaced-but-unconfirmed loss"
phase: LV
status: open
canonical: false
tags:
  - agent/opus
  - phase/lv
  - report
  - blocker
---

> Non-canonical agent report. Authority order in [[AI_ENTRYPOINT]].
> Agent: [[Claude Opus]] (acting Architect, Codex unavailable)
> Task: [[PartnerDay Checkpoint State Machine]]

# Architecture Review — a seventh defect, and the pattern behind all of them

## What was requested

Act as Architect and redesign the missed-context state machine. No code.

## What was found

**A record shown on screen and never acknowledged is silently lost.** With no
acknowledgement there is no persisted checkpoint, so the surface falls back to
`date >= today - 6`, which rolls. A record surfaced on day 0 leaves the surface on day 7
with no user action in between. Verified directly from `missedPartnerRecords` and from
the fact that the only writer in the app is `acknowledgeVisible`.

## The pattern

Seven defects, one mistake: **the system records what was consumed but never what was
shown**, so the "still owed" set had to be re-derived from the clock on every render.
A clock is not memory.

## Design issued

Split the single transition in two. A DISCOVER transition persists OUTSTANDING and
KNOWN when a record is *shown*; ACKNOWLEDGE remains the only writer of CONFIRMED. The
seven-day fallback becomes a one-time discovery bound that is materialised into state
rather than re-evaluated forever.

Verdict issued: READY_FOR_IMPLEMENTATION. Specification is items W1–W8.

## Why four cold reviews missed it

Every fixture acknowledges on nearly every open. There is no "opened, read, walked
away" actor anywhere in the suite, so the behaviour was unreachable by the tests.

## Explicitly not done

No code written. The specification has not been independently reviewed.

## STOPPED AT

- PR #70 has a known open defect and is NOT ready to merge
- Production: UNTOUCHED · Supabase: UNTOUCHED · P6: NOT AUTHORIZED
