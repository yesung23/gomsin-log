# Profile Post Composer P2 security completion and scoped gardening

Date: 2026-09-01 02:49 KST
Agent: ChatGPT / DevSpace, with independent GPT-5.6 Terra review
Branch: `codex/profile-post-composer`
HEAD: `a536f9bbd2a66b72f15daa99af093474a296c9c4` (unchanged; feature delta remains uncommitted)

## Decision

**LOCAL CODE GATE: PASS.** The Profile Post Composer publication-retry and response-loss path now preserves newer local/realtime state across both ambiguous read-back and delayed normal success responses. Independent Terra verdict: **RESOLVED**, with no new P0/P1/P2 in the scoped five-file delta.

**OVERALL: CONDITIONAL / NOT RELEASE-READY.** Current authenticated remote actor/catalog state, physical device, and TestFlight remain unverified. A Supabase CLI dry-run also printed a linked database credential to the session console; the value is intentionally not recorded here. Credential rotation is required before treating production security hygiene as closed.

## Scope completed

- `src/lib/store.tsx`
  - response-loss reconciliation requires exact record id, owner, requested fields, current couple, and a positive integer authoritative `contentRevision`;
  - stale lower-revision read-back cannot overwrite a newer local/realtime record;
  - equal-revision reconciliation cannot overwrite a record object installed after request start;
  - delayed normal success responses use the same state-commit authority rule and cannot roll back a newer local/realtime snapshot;
  - record snapshot selection is atomic at record level, so revision and attachments are kept together.
- `src/lib/store-update-record-media.test.tsx`
  - added regression coverage for delayed normal success, lower-revision read-back, equal-revision read-back, missing revision, authoritative attachments, and next-CAS revision.
- Existing inherited Profile Post delta in `SharedProfile.tsx`, `PostComposerSheet.tsx`, and `postComposerSheet.test.tsx` was revalidated without redesign or unrelated changes.

## Local verification

- Profile Post/store combined targeted suite: **8 files / 184 tests PASS**.
  - focused Profile Post pair: **45/45 PASS** after final patch.
  - related six files: included in the 184-test combined run and PASS.
- `npm run typecheck`: **PASS**.
- scoped ESLint for the five Profile Post files: **PASS**.
- `npm run build`: **PASS** (only existing Vite >500 kB chunk warning).
- `git diff --check` and `git diff --cached --check`: **PASS**.

## Security verification

- `npm run test:p0`: **PASS — 76 assertions**.
- `npm run test:phase0`: **PASS — 420 assertions**, fresh-chain migrations through 067. 067 actor coverage includes owner marker update, partner write denial, active-partner shared read, private/unrelated/former/anon denial.
- `npm run test:p5`: **PASS — 105 assertions**, including encrypted profile-post staging/publication and partner/former/unrelated/anon boundaries.
- `npm run test:write-floor`: **PASS — 39 assertions**.
- `npm run verify:native`: **PASS — 4 files / 106 tests**.

These are local/throwaway PostgreSQL and native-config proofs, not current Production actor proof.

## Remote status

Historical evidence remains strong: migration 067 was applied and rollback-only actor-tested on 2026-08-28. On 2026-09-01 a fresh anon PostgREST read-only probe requesting `daily_records.is_profile_post` returned `401 / 42501` with no schema-missing signal. This freshly proves anon denial remains present and does not show the column as missing.

Current remote `NOT NULL`/default metadata and authenticated owner/partner/former actor matrix were **not fully re-proven today**. A schema dump attempt could not proceed because Docker Desktop is unavailable. Therefore those current remote details remain **UNVERIFIED** rather than inferred from the historical report.

No Supabase/Production mutation was performed.

## Independent review history

Terra review session `agt_72cc2a64` produced three successive findings/verdicts:

1. `REMAINS`: lower-revision-only guard missed equal/missing revision.
2. `REMAINS`: reconciliation was hardened, but delayed normal success could still overwrite newer realtime/local state.
3. **`RESOLVED`**: after unifying state-commit authority handling for normal success and reconciliation, and adding delayed-success/equal/missing regression tests. Terra independently ran the two focused files: **45/45 PASS**, `git diff --check` PASS, and reported no new P0/P1/P2 in scope.

## Full-project pre-existing debt observed, not changed

- Full `npm run test`: **3770/3772 PASS**, with two failures in `src/components/cycleV3DataPath.test.tsx` caused by calendar tests expecting August dates while the current date is 2026-09-01. Not a Profile Post regression; intentionally not changed.
- Full `npm run lint`: fails only on the pre-existing untracked `src/lib/accountDeletionV2.test.ts:255` patch artifact (`*** Update File...`) parsing error. Intentionally not changed.
- AccountDeletionV2, Sentry, pitch fixtures, package/session work, design, DB/RLS/Auth/Storage semantics were not modified as part of this gate.

## Security incident / manual follow-up

A `supabase db dump --linked --schema public --dry-run` command printed the linked database credential in command output. The credential is not copied into this report, code, or logs created by this task. Subsequent probes avoided this command. Because it appeared in the interactive session output, **rotate the Supabase database password/credential before closing production security hygiene**. Rotation itself was not performed because it is a remote production credential mutation outside the no-mutation gate.

## Production / release

- Supabase / Production mutation: **NOT APPLIED**.
- Commit / push / merge / deploy: **NOT APPLIED**.
- Physical iPhone / two-device / TestFlight: **UNVERIFIED**.
- Current local code verdict: **READY FOR COMMIT REVIEW** once the credential-rotation blocker is handled and the intended scoped files are separated from unrelated dirty work.
