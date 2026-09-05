# [GOMSINLOG CONTROL TOWER] Photo SliceA and regression closure

## Current State / scope

Worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, branch `codex/rc-v5-final-fixes`.
Photo128736c, recovery4800fcf, tests217c666. Serviceac6ea50 and summary2a420b2 gates remain closed.
No push/master/Production changes. Whole app RC remains **HOLD**, not an all-complete report.
Photo backend090 is locally reviewed atfb880ed; remote table/RPC absence was independently checked.

## Findings / Decision / Changes

- Hegel SolHigh resumed the preserved9WIP files, not a replacement implementation. Closed SliceA
  create/edit uploads, no SQL/UI/auth/native/Book writes. Parent integrated one extra gate-inventory test.
- Original is decoded once, then2048px/.84 JPEG and640px thumbnail are generated without enlargement.
  White transparency background, neutral filename, exact bytes/dimensions/SHA256; frozen in-memory
  factory outputs prevent callers relabeling an original as prepared. This is not cryptographic E2EE.
- Preparation is cancellable on stale Store scope; decoder/encoder/hash waiting is bounded, late
  decoded buffers released. The existing40MP check happens after decode: **not an OOM guarantee**.
- Read-only empty-ID metadata probe detects optional090. Only confirmed missing-function may use
  legacy flow before beginning; auth/network failures never mean unsupported. No ambiguous fallback.
- Actual create/edit callers retain the operation-lifetime deletion barrier. Opaque journal precedes
  begin; stable paired object IDs, upsert:false, authoritative CAS and abandonment/reconciliation remain.
  Record attachment JSON contains only master. Missing thumbnail never publishes an incomplete pair.
- New post failure preserves its private staged row/text; ordinary partial multi-photo creation keeps
  earlier complete pairs. Existing ok+failedFiles contract and caller warnings are preserved.
- Parent gate inventory explicitly classifies read-only probe vs Store-gated begin/upload and exact
  transport counts; no broad exemption or deletion barrier weakening.
- Recovery4800fcf changes **three presentation class attributes only** in AuthSyncUnavailable. Keeps
  malformed-record refusal, callbacks, diagnostic and concealed records. Uses existing paper/ink/safe-area.
  Browser test now verifies this actual path instead of expecting an unreachable render crash, then
  retries a valid response and navigates Home. Real ErrorBoundary throw remains separately unit-tested.
- Full preflight discovered63failed assertions in4files, not63 independently proven runtime bugs.
  Gate3 failed on unclassified new APIs (fixed128736c); account53+CORS1 used old cleanup contract3
  where current handler requires4; outbox6 lacked the new capability mock. Test-only217c666 fixes
  those fixtures and adds8 malformed/version/error/throw cases proving503 before any write.

## Verification

| Scope | Actual evidence | Result / boundary |
|---|---|---|
| Worker photo |7focused files(imageSanitization,recordPhotoRenditions,records,recordMediaFailures,recordMediaMutationJournal,store-update-record-media,store) |259PASS, lint/typecheck/diffPASS; mockcanvas/Storage|
| Parent gate/Store |gatePathCoverage +store +store-update-record-media |RED3gate→206gate+86create+37edit=329PASS; scopedgate lintPASS|
| Photo independent |SolMax Russell exact128736c10files, unchanged through217c666 |**Spec/LocalQuality PASS, C/H/M/L0**; independently465/465PASS,7/7memoryprobes,2defense-removal mutants expectedRED,scopedlint/diffPASS|
| Full preflight |`npm run test -- --silent --reporter=json --outputFile=e2e/.artifacts/rc-full-preflight-20260905-1827.json` |363files/6083tests:6018PASS,63FAIL,2skip. Worker source was being finalized, not a stable release proof|
| Corrected fixtures |cors +deleteAccountFunction +store-outbox-flush |97PASS (includes8new denial cases), scopedlintPASS; no production deletion|
| Recovery unit |ErrorBoundary +authSyncFailureCopy |6PASS, scopedApp/E2ElintPASS|
| Recovery browser |Built4178, Node22, homeFailureState +rcPaperTransitionSurfaces |2PASS3.1s. Added normal Home navigation then1PASS2.9s. RED artifact proved missing paper surface before classes changed|
| Stable full gate |217c666, full Vitest/typecheck/lint |**363files/6094tests:6092PASS,0FAIL,2skip**,287.4s; typecheck/full lintPASS|
| Fixture independent exploration |FlashHigh Sartre read-only at217c666 |Confirmed actual handler3→503/4→200 in memory and missing outbox mock. Reviewed97PASSartifact; no runtime defect found in this scoped delta|

Photo focused command: `npx vitest run --config vitest.config.ts --configLoader runner src/lib/imageSanitization.test.ts src/lib/recordPhotoRenditions.test.ts src/lib/records.test.ts src/lib/recordMediaFailures.test.ts src/lib/recordMediaMutationJournal.test.ts src/lib/store-update-record-media.test.tsx src/lib/store.test.tsx`.
Recovery build used the same public placeholder Supabase/general-coupletrue/briefingfalse command as
the hourly report; PASS with existing>500KBchunkwarning. No AI/sale activation.
Screenshots parent inspected: `e2e/.artifacts/recovery-paper-128736c/rcPaperTransitionSurfaces--3f4f5-hare-the-paper-home-surface-chromium-390/screenshots/error-recovery-dark-375.png`.
New artifacts are test fixtures, not real customer records or hosted UI proof.
Stable full command: `npm run test -- --silent --reporter=json --outputFile=e2e/.artifacts/rc-full-stable-20260905-1839.json`.
The two skipped tests are nativeConfig.test.ts's Android merged-manifest permission/ML Kit inspections;
there is no built Android artifact available to those checks. Do not report6094executed or nativePASS.
Type/lint command: `npm run typecheck && npm run lint`, exit0. Runtime source stayed frozen during
the full stable run; only parent documentation changed. Earlier preflight failures remain in their artifact.

## Risks / next highest ROI / rollback

Photo **SliceB is not implemented**: actual small-grid metadata/thumbnail reads, master-only fullscreen,
fresh authorization/revision fencing and Book screen-master/PPI consumption still require integration.
Physical image/HEIC/EXIF quality/peak memory and on-device AI performance remain UNVERIFIED.
Apple identity-policy decision/revoke/signing/provider and restorable DB backup/forward rollout/actor
canary remain held; paid goods/rights/Sandbox/actual fulfillment remain OFF and incomplete.
Next: independent upload review is CLOSED; preserve passing service/summary; complete thumbnail
consumers and remaining6-task RC gates without restarting visual redesign. No unreviewed master push.
Review impact: new photo client's independent review is fresh at128736c (unchanged through217c666);
UI/test-only changes are narrow DELTA,
not a new crypto or DB protocol. Rollback: local commits individually reversible; after hosted paired
objects exist, preserve companion records/cleanup contract and prefer a compatible forward fix.

## Stop / merge boundary

All workers/reviewers for this wave returned ownership and closed. Only parent documentation and
claim release remain. The completed local patches are committed separately; there is no abandoned
photo source WIP. This is **NOT READY TO MERGE / NOT RELEASE CANDIDATE**, because Task2B and
the explicitly listed Apple/device/IAP/remote/full-integration gates remain. No remote writes were
silently substituted for missing evidence. The existing Apple verified-email policy question has not
received a user answer; current prohibition remains until explicitly changed.
