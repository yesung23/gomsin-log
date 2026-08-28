# Production release gate live audit — 2026-08-28

## Verdict

**CONDITIONAL PASS / Production HOLD.** The local release candidate and the
current public-schema backup are usable. Production still has a P0 table
privilege gap closed by migration 064, and the App Store flow still lacks live
Apple OAuth, authenticated actor-matrix evidence, TestFlight, and physical
rendered-flow evidence.

No Production SQL, Auth provider change, Vercel Production deployment,
TestFlight upload, or App Store submission was performed in this audit.

## Identity and direction check

- Repository: `/Users/han-yejun/Desktop/곰신로그`
- Branch: `codex/profile-post-composer`
- Source HEAD reviewed for remote compatibility: `044d32442cc7c1952f8916875dc32adec7157620`
- Browser-fixture follow-up: `e382d34` (`is_profile_post=true` on the existing
  profile-post fixture only)
- `origin/master` observed: `d9a2eb0a22b657c6384d59d1a53aa668fdb286f0`
- Product: `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`,
  `docs/WHAT_IS_GOMSINLOG.md`
- Business: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering/current state: `docs/ENGINEERING_ROADMAP.md`,
  `docs/CURRENT_STATE.md`, latest relevant `docs/WORK_LOG.md`
- Direction conflict: **NO**. AI still refines sentences only; it does not
  choose memories or infer relationship/health state.

## Live Supabase evidence

Read-only catalog checks were run in project `xzlorqsjajokrlkunxhr`.

- Project status: `ACTIVE_HEALTHY`; database size observed as 15,240,339 bytes.
- `supabase_migrations.schema_migrations`: relation absent. `supabase db push`
  remains prohibited.
- 060 partner-profile projection is present; the 061 NULL-actor hardening marker
  is present. The three 062 pairing RPCs are present.
- 063 `get_partner_service_info`: absent.
- 064: absent. `authenticated` currently has `SELECT`, `TRUNCATE`, `TRIGGER`,
  and `REFERENCES` on `crypto_pairings`; write DML is denied. This is the live
  privilege risk that must be closed first.
- 065 hardening markers: absent. Exact impact query at
  `2026-08-28T00:45:25Z` returned `total_rows=0`, `malformed_live=0`, and
  `malformed_crypto_active=0`.
- 066 cannot be applied: `public.push_delivery_state` is absent and no
  `send-push` Edge Function is deployed. Only `delete-account` was listed
  (`ACTIVE`, version 6, JWT required).
- 067 `daily_records.is_profile_post`: absent. `daily_records` has 5 rows, so
  the additive default-false migration would mark five existing rows false and
  does not infer a historical profile-post intent.
- Exact prerequisites for 063/064/065/067 were present: required profile and
  membership columns, `crypto_pairings`, `devices`, `scope_keys`,
  `get_my_active_couple_id`, and `daily_records`.

### Backup and restore proof

- Supabase plan is Free; managed physical backup/PITR is unavailable from the
  observed backup catalog.
- Encrypted public schema+data archive:
  `/Users/han-yejun/Documents/GomsinLog Backups/supabase-public-2026-08-28-pre-063-067-044d324.dump.enc`
- Ciphertext SHA-256:
  `5e4b4224a33655572ab789f3d7ab3f866f3c1df486636d37db4bfab9e23c1c38`
- Decryption key remains in macOS Keychain service
  `gomsinlog-supabase-backup-2026-08-28-044d324`; no key or user-content
  plaintext was printed or committed.
- An isolated PostgreSQL 17 restore completed with exit 0: 5 daily records,
  39 public tables, 69 public functions, 53 validated public foreign keys,
  5 profiles, and 0 pairing rows.
- The archive intentionally covers `public`, not Auth rows or Storage blobs.
  The isolated proof therefore used placeholder `auth.users` IDs derived from
  public UUID references before validating public foreign keys. This proves the
  public archive is structurally restorable; it is not a full Supabase disaster
  recovery snapshot.

## Independent security review

Sol High independently reviewed exact migrations 063–067 and the observed live
catalog. Initial verdict was HOLD until a real isolated restore and a malformed
pairing impact query were completed. Both conditions are now closed.

- Minimal security/schema set: 064 → 065 → 067.
- 063 is additionally required to ship the requested gomsin-facing partner
  service information, but is a separate user-visible projection gate.
- 066 must be deferred until the exact 048–055 dependency chain, atomic claim
  schema, `send-push`, service-role checks, and scheduler/provider smoke are
  deliberately deployed together.
- No new source-level P0/P1 defect was found in 064/065/067. Production currently
  still contains the P0 privilege that 064 is designed to remove.

## Auth, Vercel, and iPhone state

- Supabase Auth: Email enabled, Google enabled, Apple disabled; signup and email
  confirmation enabled; anonymous sign-in and manual linking disabled.
- Redirect allow-list contains web/local/custom-scheme callbacks and query-aware
  `gomsinlog://auth/callback?sb_flow_id=*` plus the matching Production web path.
- Apple provider Client IDs and Secret Key are blank. The app uses Supabase
  browser OAuth, then custom-scheme PKCE deep-link return; live Apple login
  cannot pass until the Apple Services ID/secret and provider are configured.
- Vercel Production is Ready at exact master commit `d9a2eb0`. The feature
  preview for `044d324` completed successfully. Production was not changed.
- The latest source built with 2,166 web modules, synced five Capacitor plugins,
  and signed successfully with Xcode 27 beta/iPhoneOS 27. The development app
  was installed and its process remained alive on the connected iPhone.
  Physical rendered UI, authenticated routes, two-account behavior, and
  Foundation Models quality remain **UNVERIFIED**.

## GitHub and browser regression

PR #90 was updated to `044d324`. All checks passed except the real-browser job,
which reported 108 passes and two failures in `e2e/postComposer.spec.ts` because
its pre-existing grid photo lacked the new explicit profile-post marker. The
one-line fixture correction was committed as `e382d34`; focused Playwright
`chromium-390` then passed 2/2. A fresh full CI run is required after pushing
this follow-up.

## Production application plan

After action-time approval, never use the empty migration ledger. Apply and
verify one exact SQL file at a time:

1. exact 064; confirm `authenticated=SELECT only`, `anon/PUBLIC=none`;
2. exact 065; confirm three hardened authenticated-only RPCs and zero malformed
   live rows;
3. exact 067; confirm boolean/not-null/default-false and the five existing rows
   remain false;
4. exact 063; confirm allow-listed service fields and no memo exposure;
5. PostgREST reload;
6. dedicated QA actor matrix for owner, active partner, former partner,
   unrelated user, anon, and NULL actor;
7. only then merge/deploy PR #90.

## Rollback

- 064/065: do not restore broad table privileges or vulnerable RPC bodies.
  Repair forward with a new migration.
- 067: roll the client back to Production `d9a2eb0` first and leave the harmless
  default-false column in place; dropping it after posts exist would lose intent.
- 063: drop only the exact function and reload PostgREST if the projection must
  be withdrawn.
- Restore source: the verified encrypted public archive above. Auth and Storage
  require separate provider/object recovery because they are outside that file.

## Smallest next release step

Obtain action-time approval for exact `064 → 065 → 067 → 063`, then apply and
verify each file separately. Do not merge PR #90, enable Apple, or deploy
Production until that actor matrix passes.
