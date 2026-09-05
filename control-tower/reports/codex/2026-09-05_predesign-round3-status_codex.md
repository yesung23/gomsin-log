# Predesign integration: current findings and executed regression

- HEAD remains `676eda2d3ad1b4ddbeaa901cd90ea92d766cd5f9` plus preserved WIP. No master update or remote mutation.
- Parent writes no implementation/test code. Latest user routing: Flash (maximum High) or Muse preferred for ordinary work; Sol/Terra for security. Current work is authorization and deletion lifecycle.

## Actual local regression

- `node node_modules/vitest/vitest.mjs run src/lib/buildEnv.test.ts src/lib/viteBuildGate.test.ts src/lib/appleLoginFeature.test.ts src/lib/iap/saleGate.test.ts --reporter=dot`: PASS, 4 files / 79 tests, 1.85s.
- `node node_modules/vitest/vitest.mjs run --reporter=dot`, PTY4324: FAIL, 361 files passed / 2 failed; 6149 tests passed / 2 failed / 2 skipped; 280.27s, start23:31:58.
- Failures: `cors.test.ts:327` expects old deletion JSON without explicit Apple status; `gatePathCoverage.test.ts:914` expects six records RPC call sites, actual seven with new metadata read. Parent inspected actual sites and response; writer must retain ordering/security assertions and document metadata read classification, not merely inflate count.
- Full run describes the observed correction-round1 WIP, not the subsequent round2 fix or a clean exact-commit release.

## Review results and ownership

- Gibbs independent Apple review: C0/H0/M2/L1. Prior live-lease HIGH addressed in source; remaining current-provider malformed strings and cancelled-deletion stale terminal reproduced. A narrow readonly Architect follow-up is pending. Hosted state remains unverified.
- Bacon independent photo correction review: HOLD, reported C1/H2/M1. Parent confirmed Archive fresh-sign can bypass metadata server/unreachable failure because generic URL failure loses authority provenance; exact missing-RPC regex also accepts arbitrary arguments. Stale open-viewer and cross-record ID validation findings must be covered in correction tests. Severity reports are not proof of actual Production exposure.
- Aristotle `01a071ff-a4b0-7b41-b8fe-945fd7004297`, Sol Max, is sole writer: existing photo14 plus exactly two test-only extensions (`src/lib/cors.test.ts`, `src/lib/gatePathCoverage.test.ts`). No Apple source/Home/Book/remote edits.
- Gibbs `01a071ed-6d61-7e33-a6bd-5b865deab7be`, Sol Max: readonly Apple lifecycle ruling, no source edits.

## Gate

- REVIEW IMPACT: both source slices still require resolved findings and scoped independent re-review. No approval from passing unit-test counts alone.
- Next: photo authority provenance correction; Apple attempt-freshness ruling then one bounded implementation owner; separate named commits only after appropriate review.
- Master integration remains HOLD. Approved notebook Home begins only after authorized safe master integration. Production NOT APPLIED.
