# 2026-08-26 Record protection product-flow local gate

## Verdict

**HOLD for release; local implementation gate PASS.**

The unreachable/native-disabled control is now wired to an actual first-device and two-account
ceremony in the working tree. Local cryptographic-flow tests, a real PostgreSQL actor matrix,
repository-wide verification, Capacitor sync, and unsigned iOS Simulator build pass. No remote
Supabase migration was applied. An independent Claude review returned conditional PASS with no
P0/P1 and identified memory-fake parity issues that were repaired; an independent Luna verifier
then reproduced the broad local gates. The final Sol review did not complete, so this report does
not grant Production security approval.

## Repository identity and preservation

- repository: `/Users/han-yejun/Desktop/곰신로그`
- branch: `codex/profile-post-composer`
- committed HEAD: `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21`
- state: dirty, uncommitted
- preserved unrelated work: existing post-composer/store/record/mock/E2E changes and `.DS_Store`
- destructive Git operations: none

## Root cause confirmed

1. Native device protection was build-time default OFF.
2. Existing crypto primitives had first-device helpers but no product caller for a two-account
   couple pairing ceremony.
3. The remote project has E2EE foundation objects but the live read-only catalog showed no
   `daily_records.content_envelope` and the old two-argument `e2ee_floor_for`, so the client-required
   039/040 schema is absent. A second read-only function-body probe returned
   `{"m043":true,"m044":false,"m045":false,"m046_begin":false,"m046_finalize":false,"m062":false}`.
   Thus 043 is present, while the 044/045/046 hardening effects and 062 are absent.
4. Remote crypto tables were estimated at zero rows; that lowers migration data-conversion risk but
   is not a backup and does not authorize a production mutation.

## Implemented local behavior

- Native iPhone builds default the feature on; explicit `false` remains an emergency kill switch.
- Web/PWA cannot start the native key ceremony.
- Settings distinguishes first-device setup, recovery, and `PAIRING_REQUIRED`.
- Both active accounts independently reconstruct the exact canonical transcript and show the same
  SAS; the app tells users not to continue if any group differs.
- Each account signs and writes only its own confirmation.
- One confirmation never creates a couple key.
- After both valid confirmations, only the canonical low account creates one CSK and publishes
  `CRYPTO_ACTIVE`; the other account accepts the same verified authority on refresh.
- Runtime installation then verifies the key and activates the exact couple write floor. There is no
  plaintext fallback.
- The canonical first confirmer does not create a fresh ECDSA signature when refreshing after the
  partner confirms; it reuses the persisted evidence, avoiding a valid but byte-different signature
  being rejected as a rebinding attempt.
- Pairing reads select only live states, so an expired/rejected historical row and its replacement do
  not make the single-row adapter fail.
- The five-minute TTL still limits human confirmation and CSK creation, but it no longer invalidates
  an already-`CRYPTO_ACTIVE` signed authority on a later app launch; both accounts are tested after
  advancing the in-memory clock past the TTL.

## Security invariants

- explicit NULL actor denial
- exact current active couple and exactly two active members
- anon, unrelated, and former partner denied
- confirming device must be active and owned by the actor
- low/high confirmation slots cannot be overwritten by the other actor
- 440-byte canonical transcript, nonce/hash lengths, five-minute expiry
- persisted transcript/timestamps are independently reconstructed before signing
- both confirmation signatures are checked against certified, non-revoked devices before CSK creation
- active couple scope key required before server pairing activation
- no content plaintext, key material, recovery code, or SAS is logged

The first actual PostgreSQL run found a NULL-comparison authorization defect for a user with no
active couple. Replacing all three active-couple comparisons with `IS DISTINCT FROM` closed it;
the complete actor matrix then passed.

## Exact verification

- primary focused Vitest: **PASS**, 16 files / 123 tests
- independent Luna E2EE verification: **PASS**, 25 files / 484 tests; typecheck, targeted lint,
  phase0, and diff check also PASS
- final independent Luna TTL delta: **PASS**, focused 3/3, broader E2EE/crypto corpus ALL PASS,
  TypeScript 0 errors
- `npm run typecheck`: **PASS**
- targeted ESLint: **PASS**
- `npm run test:phase0`: first **FAIL** (NULL-comparison defect), final **PASS**,
  PostgreSQL 17 / 60 migrations / 362 assertions
- `git diff --check`: **PASS**
- `npm run build`: **PASS**, 2164 modules
- `npx cap sync ios`: **PASS**, no tracked iOS diff
- unsigned generic iOS Simulator build: direct `.xcodeproj` command first **FAIL** because it omits
  CocoaPods (`Unable to resolve module dependency: Capacitor`); correct `App.xcworkspace` command
  **PASS**, `BUILD SUCCEEDED`
- `LANG=en_US.UTF-8 npm run verify`: **PASS**, 251 files / 3567 tests plus production build
- independent Claude review: **CONDITIONAL PASS**, no P0/P1; reported P2 memory-fake parity defects
  were repaired and covered by tests
- final independent Sol review: exact-final-diff and later live-catalog final gates both **BLOCKED** with
  `stream disconnected before completion`; no further retry was made

## Not proved

- no committed exact review SHA exists yet
- remote 039/040/044/045/046/062 compatibility/application is not proved
- authenticated two-account simulator ceremony is not run against remote
- actual encrypted shared-record create/read/update/delete round trip is not run
- physical iPhone Secure Enclave, reinstall, recovery, unlink, and offline behavior are unverified
- Production, Vercel, TestFlight, and App Store are unchanged

## Production gate and rollback

Do not run `supabase db push`; the remote migration ledger is blank. A final 2026-08-26 live catalog
refresh superseded the earlier partial snapshot and proved that 039 content-envelope, 040 exact-scope
floor, 044/045 hardening, 046 NULL-actor guards, 060/061 projection denial, and all 062 RPC/grant
effects already exist. Authenticated direct pairing INSERT/UPDATE and anon RPC execution are denied;
the pairing and scope-key tables contain zero rows. No migration was replayed in this session.

The dashboard is on Free Plan, so managed backups are unavailable. Docker-backed CLI dump also could
not run, but Homebrew PostgreSQL 17 tools produced a repository-external mode-600 custom dump of the
complete `public` schema+data, a schema SQL file, a `pg_restore --list` manifest, SHA-256 hashes, and
pre-change catalog snapshots under
`/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-26-pre-record-protection`.
This is sufficient for the public-schema migration blast radius, but it is not an Auth/Storage managed
backup and must not be described as one.

Local rollback is the inverse patch for the files listed in the Work Log; no production rollback is
needed because nothing was applied. After 062 is live, rollback must not silently re-grant direct
pairing DML. Prefer restoring the prior database snapshot and compatible app build; a manual RPC
rollback requires a separate security review.

## Smallest safe next step

Get a successful read-only final security verdict on the exact diff. Sol should be used only at that
consequential gate. If it returns PASS with no P0/P1/P2, do not apply SQL—the required effects are
already live. Instead, use the two logged-in simulators to prove the same SAS, one-side waiting state,
two-side completion, one CSK, encrypted record round trip, and exact partner decryption before the
isolated local commit/release decision.
