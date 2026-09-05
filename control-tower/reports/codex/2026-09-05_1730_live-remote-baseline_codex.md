# Live remote baseline — 2026-09-05 17:20–17:30 KST

## Current state / scope

App worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, branch
`codex/rc-v5-final-fixes`, starting HEAD `b4b479b276427829d1a10b09dc11ee00412825ab`.
Parent read-only remote inspection while Carver owns service hourly-level code. No Book repository,
real user rows, photo bytes, credentials, private keys, production writes or deployments examined/changed.

## Live findings (not inferred from old reports)

| Surface | Evidence | Confirmed state |
|---|---|---|
| GitHub master | `git ls-remote origin refs/heads/master refs/heads/codex/rc-v5-final-fixes` | master `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`; current RC branch absent remotely |
| Branch relationship | `git merge-base HEAD bd4a9f3...`, `git rev-list --count bd4a9f3..HEAD` | master is ancestor; local starting HEAD has234 commits beyond master,618changed files; NOT an integration verdict |
| Supabase project | `supabase projects list --output json` | intended project `xzlorqsjajokrlkunxhr`, Seoul, ACTIVE_HEALTHY, PG17.6.1.164; worktree not linked |
| Provider dashboard | actual open authenticated browser tab `/auth/providers` | Apple Disabled, Google Enabled, email Enabled, signups ON, confirm-email ON, manual-linking OFF, anonymous OFF. Manual-linking OFF is not proof that automatic linking is OFF |
| Supabase migration history | `supabase migration list --project-ref ...` + metadata SELECT | 14tracked versions202609040001..14 are `book_*`; local app001..090 numbers absent from this tracking table. This does NOT mean all app schema is absent |
| App catalog | read-only pg_class/information_schema/pg_proc queries | daily_records and other legacy app tables exist. `daily_records.is_profile_post` exists (067 marker only, not whole067 proof). All44public/private base tables enumerated have RLS enabled; actor/policy correctness NOT proved |
| Latest app contracts | catalog existence checks | no `record_media_*`, `record_photo_*`, `profile_avatars`, or `apple_iap*` base tables; no begin_record_media_mutation/begin_record_photo_mutation/get_record_photo_metadata/set_my_profile_avatar/record_media_cleanup_contract_version; `couples.relationship_context` absent |
| Edge Functions | `supabase functions list --project-ref ... --output json` | only delete-account ACTIVE v6, verify_jwt true; updated_at1786436484443. No new cleanup or Apple IAP Edge functions. Exact deployed source vs local UNVERIFIED |
| Recoverability | `supabase backups list --project-ref ... --output json` | backups:null, physical_backup_data:{}, pitr_enabled:false, walg_enabled:true. No restorable backup checkpoint was returned; walg_enabled alone is not restoration proof |

SQL queried catalog and migration **metadata only** (version/name/count/hash), never stored SQL text or
user records. `public.migration_ledger` is an E2EE content-migration ledger, not a schema-migration
history (verified column metadata only); no rows read. No secrets printed.

## Failed checks / correction

- Initial `supabase db query --project-ref ...` rejected because current CLI requires `--linked`
  with `--project-ref`. Re-ran with both flags; metadata queries succeeded.
- `supabase migration list` uses a temporary login role internally (tool output); no application
  schema/data/auth-provider setting was mutated by this task. CLI authentication support is not
  evidence of app actor/RLS approval.
- CLI local-vs-remote list is not a safe `db push` plan: old app schema exists despite absent
  standard version tracking, local duplicate002 files exist, and Book versions are independently
  tracked. Do not repair history, replay001..090 or rename old migrations blindly.

## Decision / next safe rollout

Remote activation/master is HOLD, not complete. Recoverability gate is unmet. Before any production
DDL: establish an encrypted/restorable backup and rehearsal, compare actual schema/function/policy
fingerprints with app baseline (no user-content export to chat), account for live Book dependencies,
then stage a reviewed forward-only delta. Keep destructive cleanup scheduler inert until paired
prefix/exact-object contract and canary are verified, following rollback-runbook.

Apple remains OFF pending identity-linking decision/support and actual credential/device tests.
Google ON does not prove successful end-to-end login. No new credentials/identifiers created.
IAP/AI remain OFF. Core records/photos/privacy are not payment gates.

## Parallel local verification

`npx vitest run src/lib/store-update-record-media.test.tsx src/lib/recordPhotoRenditions.test.ts
src/lib/imageSanitization.test.ts src/lib/records.test.ts --maxWorkers=1`:
**110PASS / 1FAIL**. Failed test: definitive thumbnail upload denial reports `{ok:true,reason:forbidden}`
instead of failure. No record-save assertion was reached after the first failed assertion; do not claim
the test proved later ordering. Existing8photo WIP preserved; repair and creation-path tests required.

## Release boundary

- Production application changes: **NOT APPLIED**. Migration/provider/Edge/master: **NOT APPLIED**.
- Remote inventory: **confirmed above**, no longer blanket UNVERIFIED.
- Remote data authorization, restore drill, exact Edge source, physical on-device performance,
  StoreKit Sandbox, full exact-HEAD app: **UNVERIFIED / gate outstanding**.
- Review impact: new factual evidence changes release readiness; not a source security review.
- Rollback: no app production mutation to roll back. Preserve live Book tables/history and existing
  legacy app schema. Revert this factual documentation only if new evidence supersedes it.

## Follow-up evidence / corrected interpretation

- Live function metadata subsequently confirmed `get_partner_service_info()` exists (MD5
  fefc9ab4bae4c18cb3ceadaf8a8c9a37). V4_AS_BUILT§3.4/V4_BACKLOG A3's old LOCALFILEONLY/NOTAPPLIED
  certainty contradicted this observation; corrected to existence-confirmed, whole063/actorsUNVERIFIED.
  Book latest RPC signatures also matched the communicated argument lists; definition hashes recorded
  by tool but source equivalence/actor correctness not tested. No raw function body or user data printed.
- Book additionally confirmed `couple-media` private Storage 3-segment paths and300s signedURL calls
  as source dependencies. App forward rollout must preserve authorization and attachment master paths.

- Production GitHub deployment6199260279 is successful for `bd4a9f3...`, created2026-09-01T10:27:19Z.
  Master validation33497443640 and Native33497443662 succeeded for that old SHA, not current RC.
- Both `npm audit --omit=dev --json` and `npm audit --json` returned0 known vulnerabilities.
  This is registry advisory coverage, not proof that source/native/authorization is secure.
- Read-only transactions with `SET LOCAL ROLE` (then ROLLBACK) confirmed anon record query denied
  via42501 get_my_active_couple_id and separate anon cycle_daily_logs query denied42501 table grant.
  Authenticated role with verified `auth.uid() IS NULL` saw0daily_records and0cycle_daily_logs.
  The denial hints to grant permissions were not followed. This is limited live negative evidence;
  owner/partner/former/syntheticJWT/Storage runtime matrix remains open.
- Book Control Tower replied: no pre-apply database-backup/restore-rehearsal evidence located; HOLD.
  Confirmed source dependencies are get_my_active_couple_id, profiles.id, active couple_members,
  daily_records fields and three-segment photo paths. Preserve all book_* objects/history001..14,
  latest014 library RPC signatures,010 export selection,013 account context. Source dependencies are
  not proof of remote function fingerprints. Book source was not edited by parent.
- **Correction to initial photo failure interpretation:** actual consumers RecordPage398,
  ComposePage392, store replay4186 check `failedFiles` in addition to `ok`. Existing all-or-nothing
  test intentionally returns ok:true with all failedFiles. Thus current111test result proves a new
  test/return-contract mismatch, not a user-visible false success or record loss. Do not change public
  return semantics merely to satisfy the new assertion; verify failedFiles, abandonment, no-save and
  real caller recovery. The new once-mock also needs checking before trusting call-order expectations.

## Apple independent Architect result

Bohr Sol Max, read-only at b4b479b: C0/H2/M2/L1 for **activation readiness**, not a claim of active
exploitation. H: managed automatic verified-email linking conflicts with current V5 prohibition;
H: Apple authorizationCode is returned by native bridge but not exchanged/stored for account-delete
token revocation. M: signing capability/entitlement absent; M: planned web Apple path absent (native
only). L: stale OAuth entitlement comment. Parent checked the relevant current source references.
User asked asynchronously whether verified-email continuity is allowed; no approval received yet.
Apple/provider/build flags unchanged. No tests run by this Architect and no current Apple device proof.

Official sources consulted by Architect:
[Supabase linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
[managed Auth settings](https://supabase.com/docs/reference/api/v1-update-auth-service-config),
[native Apple setup](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Apple token revocation](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
