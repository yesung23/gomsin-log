# App Store release security closure — Codex — 2026-08-27

## Verdict

- Local feature/security/native gate: **PASS**
- Overall App Store release: **CONDITIONAL PASS / HOLD**
- Branch: `codex/profile-post-composer`
- Reviewed base HEAD: `fbbd35496fcd1c848f2f7437bb6a85ffb2399f21`
- Resulting code HEAD: `78f8402` (`9d12bc8` feature/security, `cf922df` iOS packaging, `73f6b45` CI closure, `78f8402` exact profile-header centering)
- Production mutation in this session: **NOT APPLIED**
- Git remote: reviewed code and ledger through `b2090d1` pushed to `origin/codex/profile-post-composer`; `origin/master` and Production remain unchanged

## User-visible behavior in the release candidate

- Connection-first landing explains the value before login and requires age/terms/privacy consent. Provider availability fails closed; a disabled provider is not advertised.
- My header keeps the plus action at the left and the handle at the actual viewport center using symmetric 88px side slots. Post composer accepts uploads, trip photos, and story photos, supports order/caption/privacy, and saves copied media under the new exact record path.
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
- Gitleaks 8.24.3 exact PR-history scan: PASS, 0 findings. The only exemption requires the exact `ios/App/Podfile.lock` path and exact `GomsinlogCapacitorDeviceKeys: <40 lowercase hex>` checksum line with AND semantics; Terra independent delta review PASS, P0–P3 0.
- UTC and Asia/Seoul focused `searchPage` reruns: PASS, 25/25 in each timezone. The pre-enlistment D-day test now freezes the same clock used by the rendered service EXP calculation.
- PR #90 exact HEAD `73f6b4576f91c0595c2cce9c33a203b4574a8515`: PASS. Both full typecheck/lint/Vitest/build jobs, boundary, PostgreSQL chain, real-browser two-account matrix, Android, Capacitor sync cleanliness, unsigned iOS build, secret/signing scan and Vercel Preview all completed successfully.
- Profile header centering delta: Playwright `e2e/postComposer.spec.ts` PASS, 2/2. At 390px the handle center differs from viewport center by at most 1px, the plus target remains at least 44px, and the rendered screenshot was visually inspected.
- Fresh `LANG=en_US.UTF-8 npm run verify` after the centering delta: PASS, exit 0; typecheck, full lint, 254 files / 3,630 tests, production build. `deviceKeyPort.test.ts` passed 12 tests in 244ms and the historical parallel timeout did not recur.

## Live remote preflight

- Project `xzlorqsjajokrlkunxhr`: ACTIVE_HEALTHY, PostgreSQL 17 preview.
- Migration ledger: empty; `supabase db push` prohibited.
- Auth settings: Google ON, Apple OFF, Email ON, Phone OFF, signup enabled.
- Managed backups: empty; PITR OFF.
- Fresh external public backup: `/Users/han-yejun/Desktop/gomsinlog-production-backups/2026-08-27-pre-release-065/`; directory 700, files 600, custom dump/list/schema/SHA256 verified.
- Live schema: 062 pairing functions exist. 063 is absent. 064 is absent because authenticated still has `REFERENCES, SELECT, TRIGGER, TRUNCATE` on `crypto_pairings`. 065 hardening marker is absent. Pairing/scope/device tables currently have zero rows.
- Live Edge Function: `delete-account` is ACTIVE, version 6, JWT verification enabled. Production-origin OPTIONS returned 200 with the exact origin and unauthenticated POST returned 401; destructive account deletion itself remains unverified.
- Live Vercel: exact feature Preview `b2090d1` is READY at `https://gomsin-fnqovk6rn-nabbvn.vercel.app`; Production remains `d9a2eb0`. Production env lacks `VITE_LEGAL_OPERATOR_NAME` and `VITE_PRIVACY_CONTACT_EMAIL`, so legal values must be supplied and approved before master/Production deployment.
- Live Apple/device: Apple Developer membership purchase is still processing. An iOS 27.0 iPhone 16 Pro is connected and paired, but the physical build was stopped after compile/link while codesign did not finish; no signed install, Archive, TestFlight, or app runtime proof exists.

## Blocked / unverified

- Exact 064 → 065 → 063 Production application and real actor matrix: NOT APPLIED.
- Apple App ID/Services ID/key, Supabase Apple provider, redirect allowlist including query-aware PKCE, and actual Apple round-trip: BLOCKED/UNVERIFIED.
- PR #90 code+ledger HEAD `b2090d1`: PASS. Both required workflows and exact Vercel Preview are green. Vercel Production exact SHA is known as old master `d9a2eb0`; required legal env and authenticated smoke remain BLOCKED.
- Signed Archive, TestFlight processing, App Store metadata/review accounts: UNVERIFIED.
- Physical iPhone Foundation Models, Secure Enclave, offline/heat/battery/reinstall/recovery: UNVERIFIED. Device connectivity alone is not runtime proof.
- Apple Developer activation, provisioning profile and available disk for Archive: BLOCKED. Current free disk is about 3.8GB; no user files were deleted.

## Safe next action and rollback

1. At action time, confirm the live catalog and backup, then apply exact 064 → 065 → 063 only; never replay the empty ledger.
2. Reload PostgREST, re-read schema/ACL/function markers, and run authenticated/anon/unrelated/former-partner/NULL-actor matrices.
3. Obtain the exact public legal operator name and monitored privacy email, then configure Vercel only with user-approved values.
4. Merge PR #90 to `master` only after the remote gate and Production env gate pass.
5. After Apple membership activates, configure Apple web OAuth and validate Google/Apple PKCE on a real iPhone.
6. Free sufficient disk, deploy the exact commit, create signed Archive/TestFlight, and run the two-account release checklist.

Database rollback is forward-only: do not restore authenticated mutation/TRUNCATE privileges or the weaker 062 pairing bodies. Reapply 064/065 as the repair. Local code rollback is `git revert` of the isolated commits. Apple/provider/Vercel changes must retain their previous settings for console rollback.
