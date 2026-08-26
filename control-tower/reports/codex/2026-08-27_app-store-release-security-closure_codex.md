# App Store release security closure — Codex — 2026-08-27

## Verdict

- Local feature/security/native gate: **PASS**
- Overall App Store release: **CONDITIONAL PASS / HOLD**
- Branch: `codex/profile-post-composer`
- Reviewed base HEAD: `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21`
- Resulting code HEAD: `cf922df` (`9d12bc8` feature/security, `cf922df` iOS packaging)
- Production mutation in this session: **NOT APPLIED**
- Git remote: reviewed commits pushed to `origin/codex/profile-post-composer`; `origin/master` and deploy remain unchanged

## User-visible behavior in the release candidate

- Connection-first landing explains the value before login and requires age/terms/privacy consent. Provider availability fails closed; a disabled provider is not advertised.
- My header keeps the plus action at the left and the handle centered. Post composer accepts uploads, trip photos, and story photos, supports order/caption/privacy, and saves copied media under the new exact record path.
- Search shows seven factual service tiers with tier-local EXP reset and separate overall service progress. A connected gomsin sees only the soldier's sanitized read-only projection.
- Partner daily summary keeps every eligible record in time order, shows five first, expands with `N개 더 보기`, and every line still opens its exact record. AI never ranks or drops records.
- Record protection pairing fails closed: missing/invalid server ceremony cannot promote local state, and plaintext write floors remain enforced.

## Privacy and security invariants

- On-device summary payload is index/text only; no record ID, timestamp, media URL, private record, raw cycle/health data, unrelated/former partner, or server AI fallback.
- Missing `Intl.Segmenter`, timeout, cancellation, native/model failure, count/order/index mismatch, or any batch failure keeps all deterministic lines.
- Pairing activation requires canonical actors, both confirmations, persisted transcript evidence, and successful server activation before local `CRYPTO_ACTIVE`.
- Migration 065 quarantines malformed legacy pairing evidence to `TRANSCRIPT_EXPIRED`; migration 064 removes direct authenticated `TRUNCATE` and other table privileges while retaining SELECT.
- No secrets, prompt text, model output, or user-content plaintext are written to logs/reports.

## Verification executed

- `LANG=en_US.UTF-8 npm run verify`: PASS, exit 0; typecheck, full lint, 254 Vitest files / 3,630 tests, production build.
- JSON Vitest confirmation: 254 files / 3,630 passed / 0 failed / 0 pending.
- Focused E2EE/migration Vitest: PASS, 6 files / 98 tests. Independent Sol rerun: 12 files / 253 tests PASS.
- PostgreSQL 17 `test:phase0`: PASS, 63 migrations / 392 assertions.
- `test:p0`: 76 PASS; `test:p5`: 93 PASS; `test:write-floor`: 39 PASS; `test:rollback`: PASS.
- `verify:native`: PASS, 4 files / 101 tests.
- Playwright product flows: PASS, 8/8; login landing 320/390 and consent activation: PASS, 2/2.
- `npx cap sync ios`: PASS; no unexpected tracked generated diff.
- Xcode iPhone 16 Pro iOS 26.5 arm64 unsigned simulator build: `BUILD SUCCEEDED`.
- `git diff --check`: PASS.
- Sol High security closure: PASS, P0/P1/P2 0.
- Terra High final dirty-delta review: PASS, P0–P3 0; narrow 22 files / 483 tests PASS.

## Live remote preflight

- Project `xzlorqsjajokrlkunxhr`: ACTIVE_HEALTHY, PostgreSQL 17 preview.
- Migration ledger: empty; `supabase db push` prohibited.
- Auth settings: Google ON, Apple OFF, Email ON, Phone OFF, signup enabled.
- Managed backups: empty; PITR OFF.
- Fresh external public backup: `/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-27-pre-release-065/`; directory 700, files 600, custom dump/list/schema/SHA256 verified.
- Live schema: 062 pairing functions exist. 063 is absent. 064 is absent because authenticated still has `SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on `crypto_pairings`. 065 hardening marker is absent. Pairing/scope/device tables currently have zero estimated rows.

## Blocked / unverified

- Exact 064 → 065 → 063 Production application and real actor matrix: NOT APPLIED.
- Apple App ID/Services ID/key, Supabase Apple provider, redirect allowlist including query-aware PKCE, and actual Apple round-trip: BLOCKED/UNVERIFIED.
- Vercel production exact deployed SHA and release env: UNVERIFIED.
- Signed Archive, TestFlight processing, App Store metadata/review accounts: UNVERIFIED.
- Physical iPhone Foundation Models, Secure Enclave, offline/heat/battery/reinstall/recovery: UNVERIFIED.

## Safe next action and rollback

1. Commit the exact reviewed local delta without `.DS_Store` or ignored signing secrets.
2. At action time, confirm the live catalog and backup, then apply exact 064 → 065 → 063 only; never replay the empty ledger.
3. Reload PostgREST and run authenticated/anon/unrelated/former-partner/NULL-actor matrices.
4. Configure Apple web OAuth and validate Google/Apple PKCE on a real iPhone.
5. Deploy the exact commit, create signed Archive/TestFlight, and run the two-account release checklist.

Database rollback is forward-only: do not restore authenticated mutation/TRUNCATE privileges or the weaker 062 pairing bodies. Reapply 064/065 as the repair. Local code rollback is `git revert` of the isolated commits. Apple/provider/Vercel changes must retain their previous settings for console rollback.
