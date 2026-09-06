# Notebook CI and real-runtime follow-up

## Scope and direction

Base/PR94 head `ad57014a3eee59380bddec4b969935d8beeeeace`, branch `codex/notebook-home-v1`, worktree `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`. Latest approved notebook Home, Engineering order, CURRENT_STATE and latest WORK_LOG checked. Business NOT APPLICABLE to this test/runtime correction; no pricing/storage policy changes. Parent writes no app/test source. Now claim preserved.

## CI evidence

Exact-head master-validation `33989315245`: browser 210 PASS / 2 FAIL. Both failures are `e2e/storyProfilePresentation.spec.ts:41`, widths 320/390: initial header y=7, post-scroll y=0. All other reported checks, including unit/type/lint/build/CSP, PostgreSQL fresh-chain, Edge, native unsigned iOS/Android, sync and secret scan passed. No merge was performed. Vercel check is canceled by Ignored Build Step, not a deployment.

Confirmed root cause: the new notebook sheet's 6px margin + 1px border creates normal initial sticky travel to the scroller top; the old assertion assumed no initial offset. Boyle changed only `e2e/storyProfilePresentation.spec.ts`. At widths 320/390, initial header Y=7, main viewport/inset=0/0, and middle/deep header Y=0. The test now checks sufficient scroll travel, actual container-relative clamp and stability at both depths; Us/Story and 44px assertions remain. No application/CSS change was made to accommodate the test.

Worker scoped browser 7/7 PASS (22.6s). Parent independently reviewed the exact diff and ran `CI=true GOMSINLOG_E2E_PORT=4194 GOMSINLOG_NOTEBOOK_SCREENSHOT_RUN=pr94-parent-sticky node node_modules/@playwright/test/cli.js test e2e/storyProfilePresentation.spec.ts --config=playwright.config.ts --grep 'story and fixed headers'`: 2/2 PASS (20.8s), fresh QA build. Parent scoped ESLint and `git diff --check`: PASS. This is a test-only DELTA; it does not replace the pending exact-head full CI rerun.

## Real public configuration and build

- Existing root `.env` had the expected project host, but its publishable-key field did not use `sb_publishable_` format. The attempted production-gated build stopped before building; no bypass or env file edit.
- CLI API-key inventory read without `--reveal`; only type/name/field names were displayed. Verified public key was passed in memory to the build, not written to reports/commands or printed. No private-key disclosure, API-key creation or rotation.
- `npm run build:release` with production validation, the verified project public key, approved operator 한예성 / gomsinlog@gmail.com succeeded. Apple login, E2EE device protection, IAP sale and partner-briefing activation flags remained false. This diagnostic artifact does not prove those features are ready.
- Immutable local copy: `e2e/.artifacts/notebook-ad57014-real-dist`. `index.html` SHA256 `49ff210bb029b15ea4320ab040ef6b66d8662035eacb3024fb17963e19588f87`. Bundle boolean check: real project host present, example.supabase.co absent.
- Served only at `127.0.0.1:4193`, parent process session 58436. Live in-app `/home` displayed the unauthenticated consent screen and Google continuation button (disabled until the user's required consents), without the prior provider-loading error. No consent, login, signup, record mutation or upload was submitted. Apple remains off. Earlier 4174 listener was no longer present on recheck.

## Hosted boundary

Fresh catalog-only Management API query confirmed missing record_media_objects, record_media_mutations, record_photo_metadata, book_bookmarks, begin_record_media_mutation and get_record_photo_metadata. get_my_couple_state and begin_account_deletion exist; existence alone is not contract compatibility. No user content was queried.

Backup Architect Galileo recovered from adapter_eof on the same agent ID `01a07332-cd30-7901-bd31-ea6ec71342ab` and completed read-only research: prefer official CLI filtered dumps and an isolated restore; raw pg_dump and temporary login-role creation alone are not complete recovery proof. No backup/restore was executed. Existing expired backups were not read, extended or deleted. Parent readiness check: Homebrew available; Docker/Colima absent; FileVault on; disk only 14GiB available. Container installation is not yet performed; capacity and restore isolation must be planned first. Revoking all project CLI roles could affect Book Studio and must not happen silently.

## Gate and next action

READY TO MERGE: NO, CI still failed at this checkpoint. Production migration/Edge/provider/publish/TestFlight: NOT APPLIED. Actual authentication, physical iPhone, on-device performance, fresh backup/restore rehearsal, hosted migration compatibility, book bookmarks and remaining notebook screens remain open. Next: verify the exact sticky-header correction, rerun CI, then source integration and hosted recovery gate. Rollback: stop the new local diagnostic preview; the copied artifact has no server-side mutation. Do not overwrite or drop user data to make the source deployable.
