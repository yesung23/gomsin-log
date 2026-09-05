# Deployment resumed — 2026-09-06

## Direction and ownership

- User explicitly approved all deployments and beta readiness. The earlier automatic-deployment permission hold is resolved.
- Product: PRODUCT_V5_MASTER_DECISION and approved notebook Home; business: BUSINESS_MEMORY_ROADMAP_V1 unchanged; engineering: ENGINEERING_ROADMAP and rc-closure-plan; state/most recent WORK_LOG checked. Direction conflict: NO. Master-before-notebook implementation order remains.
- Repository: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, branch `codex/rc-v5-final-fixes`, starting HEAD `fc3f43a15d6b7d350861ca4f76b3774e43530344`.
- Parent orchestrates/operates/documents, no app or test implementation. Nash Sol Max: read-only DB sequencing. Godel Terra High: read-only native install gaps (completed). Copernicus Sol Max: bounded scanner false-positive verification/configuration.

## APPLIED remote operations

1. Vercel **gomsin-log only**: Ignored Build Step changed from Automatic to **Don't build anything**, `exit 0`. Saved, then Project Settings expanded and selected value / disabled Save re-read. This temporarily blocks new Git builds, not the existing served deployment. Restore Automatic only once target DB compatibility and deploy gates are met. Book Studio unchanged.
2. App Store Connect iOS app record created: **곰신로그**, Korean primary language, bundle `app.gomsinlog`, SKU `gomsinlog-ios`, Apple app ID **6809005110**. Reopened Apps list confirmed iOS 1.0 / Prepare for Submission. No build uploaded, no TestFlight invitation, no App Review submission, no sale/product enabled. This is an app registration, NOT a beta release.

## Live read-only evidence

- `git ls-remote origin refs/heads/master`: `bd4a9f3c7d3adda70d4a7c906b8788bd914d29e0`.
- No existing PR for RC branch. 248 commits between remote master and starting HEAD, 657 changed files. Existing source tests/reviews remain scoped to their recorded bytes; no new whole-app PASS claimed.
- Supabase CLI projects list: target ACTIVE_HEALTHY. Functions list: only delete-account v6.
- Remote catalogs: legacy app tables and Book tables exist; all listed public base tables have RLS enabled. No private base tables listed. Standard migration history has only Book versions 202609040001..014. This is NOT permission to replay the app chain.
- Separate function probe: begin_account_deletion/get_my_couple_state exist; begin_record_media_mutation/get_record_photo_metadata/record_media_cleanup_contract_version absent.
- Backups list: `backups:[]`, PITR false. WALG alone is not restore evidence.
- Metadata only: database 16,387,219 bytes, daily_records relation 98,304 bytes, storage.objects metadata relation 139,264 bytes. These are NOT media object bytes or capacity forecasts. No user rows exported.
- Expired Aug26/Aug27 backup directories still exist, mode700. Not read/deleted; retention/recovery hold remains.
- Native read-only: Xcode26.6/17F113, iPhone16Pro unavailable; local signing config missing. App payload ignored by Git requires exact-HEAD cap sync before archive. Apple release fuse is intentional and must not be bypassed merely to produce an archive.

## New verification / blockers

- `git diff --check` and commit-range diff check PASS.
- Gitleaks 248-commit scan: nine generic-api-key findings, under classification. Suspected checksum/test false positives are NOT silently waived. A report-to-/dev/stdout attempt failed because that path was not writable; redacted verbose scan supplied locations. No discovered secret values printed.
- App/DB/Edge release: NOT APPLIED. Master update: NOT APPLIED at this checkpoint. TestFlight: NOT UPLOADED.
- Parent rejects the native sidecar suggestion to create a TestFlight-only activation bypass before hosted credential custody/revocation and signing gates. Fix verified prerequisites first; then separately reviewed activation.

## Next / rollback

- Resolve scanner evidence and run remote PR CI; integrate predesign only with automatic publication safely held.
- Establish current restorable backup and reviewed catalog-based forward delta before DB mutation; preserve all Book objects, grants and history.
- Complete native credential registration and real provider/signing/device gates before TestFlight readiness.
- REVIEW IMPACT: operational DELTA, not an app security re-review. No tested app bytes changed here. Vercel rollback is restoring Automatic; app-record creation cannot be treated as an uploaded release and must not trigger deletion of the registered bundle.
