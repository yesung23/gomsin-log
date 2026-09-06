# OCR file chooser CI delta

## Scope and direction
- Base `961b19788cb2cce030ce5cbc9635c826b2092b3e`, branch `codex/beta-device-gates`.
- Product: retain actual map-photo import, editing and save flow. Business NOT APPLICABLE. Engineering/current-state/latest WORK_LOG and actual failed master run checked. No direction conflict.
- Meitner Terra High implemented only `e2e/realUsability.spec.ts`; parent did not write application/test source.
- Master validation run34011502352 had214 passes/1 failure while waiting for the OCR dialog. Trace showed no OCR worker request; missed hidden-input event remains a hypothesis, not a proven runtime root cause.

## Change
- Exercise the enabled “사진에서 불러오기” button and native browser file chooser instead of injecting directly into a hidden input.
- Existing45-second dialog budget, recognized content, editing, save assertions and page-error checks preserved. No application/OCR algorithm, DB, permissions, crypto or production changes.

## Verification
- Worker: five isolated fresh-browser focused runs,5/5 PASS; standard full matrix on isolated4195,215/215 PASS. Default4173 invocation blocked before testing by occupied port; existing process left intact.
- Parent independently reviewed the complete one-file diff and embedded Playwright HTML report at `e2e/.artifacts/html/index.html`: total215, expected215, unexpected0, flaky0, skipped0; duration371548.587ms, report start1788670204358. `.last-run.json` says passed with no failedTests.
- Parent `git diff --check -- e2e/realUsability.spec.ts` and `npx eslint e2e/realUsability.spec.ts` both exit0/PASS.
- This establishes local browser matrix success, not successful Linux CI, an actual production OCR fix, native AI correctness, or release readiness.

## Review / remaining / rollback
- REVIEW IMPACT: test-only DELTA; parent spec/diff review. Native diagnostic commit is separate and its actual model failures are unresolved.
- Next: exact-commit CI before master integration; isolated restore networking and actual native-model output checks proceed independently.
- Production NOT APPLIED. Rollback this test-only change without application/user-data mutation. No unrelated working files staged by this report.
