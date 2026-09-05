---
agent: codex
date: 2026-09-05
status: hold
tags: [control-tower, on-device, source-provenance, gate]
---

# [GOMSINLOG CONTROL TOWER]

## Current State

`codex/rc-v5-final-fixes`, `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`.
Application review checkpoint `1f7777f`. Photo 090/harness is separately worker-owned uncommitted work.
This gate records an actual defect, not an implemented fix or an app-completion claim.

## Findings

1. **HIGH / OPEN**: runtime `verifyRefinedItems → guardSummaryExcerpt` proves source substring,
   not preserved meaning. Omitting following negation, quotation clarification, condition or correction
   can reverse the apparent statement. Many older negative tests instead exercise the unused
   `guardSummaryRewrite`, so their PASS does not protect the actual path.
2. **HIGH / OPEN**: `deterministicSummaryLines` stores only the normalized first120 UTF-16 units for
   verification. A later negation is unavailable to the guard. A same-prefix later-body edit does not
   change the hook's payloadKey, so a previous refinement can survive the source change.
3. V5 §8 bounds the day's total records at20 for this initial device candidate. Current hook instead
   counts only long candidates; total21/long1 can call the model. All original rows remain accessible.
4. Story integration suite collection fails because its Capacitor registerPlugin mock always throws,
   now also affecting AppleAuth import. This is not a passing route test and not a real provider failure.
5. Swift unavailable reasons and exported TypeScript package reasons disagree. Native runtime uses
   bounded actual capability checks; the public type/comments require alignment.

## Decision

Prioritize these HIGHs before on-device activation. Preserve full normalized source locally for validation
and result invalidation; keep bridge `{index,text}` only. Enforce the actual total20 contract while preserving
all original rows/IDs. The exact eligibility/omission rule is being finalized with the read-only Architect.

Reject two alternatives: a word blacklist presented as a proof of arbitrary-language meaning; disabling
every useful shortening and calling the AI feature complete. Any conservative subset must have both
successful safe examples and actual-runtime negative tests, with linguistic limitations disclosed.
Do not broaden model context/CPU budgets without device evidence or silently substitute cloud processing.

## Changes

Only the current-state note and this factual gate/ledger are parent changes. A queued photo client brief
was written under ignored `.superpowers/sdd/rc-closure-plan-2026-09-05/`; it does not mean integration exists.
No on-device implementation has changed at this checkpoint. TDD and parallel-agent skills are used to
retain reproductions and one implementation owner plus a separate evidence-led review role.

## Verification

- Architect scoped9files/203 tests PASS, **but the reproduced counterexamples were incorrectly accepted**.
  This baseline count is not a release gate. Actual Story suite collection FAIL is separately retained.
- Parent read the real verifier/guard/hook call path and directly executed the TypeScript guard via Node
  against four independently phrased synthetic sources: negation, a joke clarification, a condition,
  and correcting three meetings to two. All four returned `ok:true` with misleading truncated statements.
  No customer text was used. These results establish the defect, not its repair.
- `xcrun swiftc -typecheck -target arm64-apple-ios15.0 -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" packages/capacitor-on-device-summary/ios/Sources/OnDeviceSummaryPlugin/OnDeviceSummary.swift`
  **PASS**. Source compilation only, not full app signing/bridge/physical inference.
- Physical iPhone16Pro, iOS27.0, connected and DeveloperMode enabled; Xcode26.6. No install, launch,
  app overwrite, Apple settings or customer account operation performed.
- Local Mac probe with Foundation + FoundationModels: availability `appleIntelligenceNotEnabled`,
  Korean locale support true. **No inference was run; this is not iPhone availability evidence.**
- Official [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)
  documents runtime availability and OS-dependent model versions. Device tests must pin OS/model era;
  an eligible model name alone is not readiness evidence. Supported hardware prerequisites are in
  [Apple Support](https://support.apple.com/en-us/121115).

## Risks / Current Score

Meaning preservation: HIGH2 OPEN. Whole-app scoring not repeated at this narrow gate. Release HOLD.
Actual Korean model quality, latency, heat, background behavior, lower-device performance, signed build,
two-account provider login and hosted SQL090 are **UNVERIFIED**. The AI flag remains default OFF.
No finding here claims perfect security or infallible natural-language semantics.

## Next Highest-ROI Goal

Finish current isolated photo backend implementation/PG evidence, then hand the implementation slot to
a bounded Sol High summary worker while an independent reviewer checks stable media changes. The
worker must include actual verifier counterexamples, full-tail invalidation, total20/21, preserved last-record
navigation, cancellation and the Story mock-only collection repair. Parent verifies actual diff and tests.

Remote actions: **NOT APPLIED**. This documentation can be reverted independently; no user data is changed.
