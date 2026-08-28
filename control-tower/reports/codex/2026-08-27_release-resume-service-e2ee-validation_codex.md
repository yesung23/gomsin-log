# Release resume: service UX and E2EE launch validation — Codex — 2026-08-27

## Verdict

- Local feature/security/native gate: **CONDITIONAL PASS** (code commit `d6650fd`; full local tests, production build, Capacitor sync, unsigned iOS build and independent post-replay delta review green; formal Sol final security route unavailable)
- Overall App Store release: **HOLD** (remote migrations unapplied, Vercel production unverified, physical Apple/device gates pending)
- Branch: `codex/profile-post-composer`
- Reviewed base HEAD: `a633ccb0d194159d81c061add70fab4aa348eda1`
- Code commit: `d6650fd` (`feat: close App Store release candidate blockers`)
- origin/master: `d9a2eb0a22b657c6384d59d1a53aa668fdb286f0`
- Dirty worktree: **preserved** (no stash, reset, or checkout)
- Production mutation in this session: **NOT APPLIED** (read-only audit; zero remote changes)

## Direction Check

- **Product source checked**: `docs/WHAT_IS_GOMSINLOG.md`, `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md` — connection-first V4 core flow (`가볍게 기록 → 상대방의 오늘 → summary item → exact original record → 자연스러운 대화`).
- **Business source checked**: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — evaluated because E2EE launch policy changes the trust model; privacy and user-content protection retained without premium gates or admin escrow.
- **Engineering source checked**: `docs/CURRENT_STATE.md`, `docs/ENGINEERING_ROADMAP.md`, `docs/APP_STORE_RELEASE_PLAN_2026-08-25.md`, `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`.
- **Latest relevant Work Log checked**: 2026-08-27 마이탭 실제 중앙 정렬 및 원격·실기기 출시 gate 재확인.
- **Conflict with canonical direction**: **NO** — E2EE remains staged; new activation is explicit opt-in (OFF at launch); no admin escrow/master key; existing protected-data no-downgrade retained; core product flow preserved.

## User-Visible Behavior & UX Invariants

### Service UX & Partner Service Projection
- Connected gomsin sees partner service info read-only across `/search`, `/service`, `/us`, and the home widget.
- Service level progression: Lv.1..199 then MAX; EXP resets each level.
- Soldier retains full edit authority; disconnected or pending couple states fail closed.

### Daily Summary Beyond Five Records
- Every eligible record for the selected day remains in chronological order; equal timestamps are stable by exact record id.
- The cover initially shows five lines and exposes the rest with `N개 더 보기`; eight records render as five plus three, with expand/collapse.
- AI refines wording only. It does not rank or select records, and every rendered line retains exact source-record navigation.
- Private records, unrelated dates/users, unsaved records, health/cycle raw data, identifiers, times and media URLs remain outside the on-device model payload.
- Native inference uses sequential fixed batches of five with a bounded total timeout; unavailable model, timeout, cancellation, failure or missing `Intl.Segmenter` keeps deterministic text for every line.

### Profile Post Reliability
- The My-tab composer accepts uploaded photos plus eligible trip/story photos, preserves user order, caption and visibility, and uses up to ten images.
- A public post with media is inserted privately first and becomes public only in the same row update that commits the complete ordered attachment set.
- Offline outbox entries preserve `allOrNothingMedia`. Upload or attachment-patch failures keep the same exact private row and retryable queue entry; the next flush resumes that row, then restores the intended visibility only after all media succeeds.
- Retry metadata stores only record id, couple id and desired visibility; no caption or media content is placed in localStorage.

### E2EE Launch Delta & Feature Flag Isolation
- Environment variable omitted, `false`, or web platform: disabled.
- Only native exact `'true'` activates the feature.
- Store new barrier and activation paths are gated.
- Runtime floor guard stays unconditional; existing protected records fail closed against plaintext downgrades.
- `recoverWithKit` and all E2EE use cases are blocked while the flag is OFF.
- Latest Settings delta: hides `DeviceProtectionSection` and dialogs, and skips bootstrap while OFF; ON behavior remains completely preserved.

## Security Review Routing Status

- Independent narrow reviewer verdict: **PASS** for the five-file E2EE delta.
- Independent Terra delta reviewer verdict: **PASS, no P1/P2** for private staging, offline outbox replay, exact-row media retry and final visibility restoration after two earlier HOLD findings were fixed.
- Sol/Kiro final security route unavailable:
  - Kiro `claude-sonnet-5` returned `INVALID_MODEL_ID`.
  - Earlier Kiro `opus` and `sol` were also unavailable.
- **Do not claim Sol review.** Formal Sol Max / Kiro security signoff could not be executed for this delta.

## Main Verification Executed (Local)

- **Service focused Vitest**: PASS (4 files / 81 tests).
- **Service Playwright (`e2e/serviceGrowth.spec.ts`, system Chrome)**: PASS (2/2 tests; screenshots captured at `ui-audit-results/service-growth/gomsin-partner-service-390.png` and `soldier-own-service-390.png`; 44px toggle target asserted; exact gomsin read-only vs soldier edit permissions verified).
- **E2EE / settings focused latest Vitest**: PASS (8 files / 95 tests).
- **TypeScript Typecheck (`npm run typecheck`)**: PASS.
- **Target ESLint**: PASS.
- **Git whitespace check (`git diff --check`)**: PASS.
- **Post/outbox final focused Vitest**: PASS (4 files / 78 tests), including initial photo failure, retryable attachment-patch failure, same-record replay and final public visibility restoration.
- **Full verify in sandbox (`LANG=en_US.UTF-8 npm run verify`)**: FAIL only because sandboxed `initdb` could not create the throwaway PostgreSQL cluster (257/258 files, 3,722/3,723 tests); keystore passed 12/12.
- **Full Vitest outside sandbox (`LANG=en_US.UTF-8 npm run test`)**: PASS (258 files / 3,723 tests, 0 failures; rollback PostgreSQL test 17/17; keystore 12/12).
- **Production build (`npm run build`)**: PASS (2,165 modules; only existing >500KB chunk warning).
- **Release-config build (`npm run build:release`)**: FAIL CLOSED before artifact creation because the project has no `sb_publishable_...` key configured; the legacy anon JWT is intentionally rejected for production artifacts.
- **PostgreSQL 17 Phase 0 (`npm run test:phase0`)**: PASS (64 migrations 001..066, 041/042 frozen, 411 assertions).
- **Capacitor iOS sync (`npx cap sync ios`)**: PASS (5 plugins synced; tracked iOS diff hash unchanged: `918b7224...`).
- **Final unsigned iOS simulator Debug xcodebuild**: PASS (`BUILD SUCCEEDED`, Xcode SDK `iphonesimulator26.5`; one existing Embed Pods Frameworks dependency-analysis warning).
- **Signed generic iPhone Release build**: PASS (Apple Development identity, exit 0; deprecation/script warnings only; **this is NOT App Store Archive, TestFlight, or distribution**).

## Remote Live Read-Only Preflight

- **Supabase Migration Ledger**: Empty; `supabase db push` forbidden.
- **Table Stats Estimates (not exact)**:
  - `profiles`: 5
  - `couple_members`: 5
  - `couples`: 6
  - `daily_records`: 4
  - `scope_keys`, `key_envelopes`, `devices`, `recovery_identities`, `crypto_pairings`, `crypto_deployment`, `crypto_write_floor`: estimated 0.
- **Dashboard Function Search**:
  - `get_partner_profile_with_username`: exists (migration 060).
  - `e2ee_start_pairing_ceremony`, `e2ee_confirm_pairing_ceremony`, `e2ee_mark_pairing_active`: exist (062 family).
  - `get_partner_service_info`: **absent** (migration 063 **NOT APPLIED**).
  - `push_delivery_candidates`: **absent** (migration 066 **NOT APPLIED**).
  - Exact 061, 064, 065 semantics: **UNVERIFIED**.
- **Auth Settings (Live)**:
  - Email: Enabled
  - Google: Enabled
  - Apple: Disabled
  - Signups: Enabled
  - Email confirmation: Enabled
- **API Keys (Live)**:
  - Publishable key list is empty; Dashboard shows only `New publishable key`.
  - No key was created because API-key creation requires action-time confirmation.
- **Site URL & Redirect Allow-List**:
  - Site URL: `https://gomsin-log.vercel.app`
  - Redirects: exactly `localhost`, `127.0.0.1`, `gomsinlog://auth/callback`, production web callback.
  - Query-aware `sb_flow_id` allow-list adequacy: **UNVERIFIED**.
- **Vercel Production**:
  - Controlled browser tab required login; CLI unavailable/not authenticated.
  - Production environment variables and deployed SHA: **UNVERIFIED**.
- **Physical iOS Device**:
  - Physical iPhone unavailable; real Apple OAuth, cold start, two-account pairing, and physical Foundation Models: **UNVERIFIED**.

## Production Status & Next Actions

- **Production APPLIED**: None. Remote changes **NOT APPLIED**.
- **Overall Release State**: **CONDITIONAL PASS locally / HOLD for production release**. Do not claim App Store readiness or a valid release artifact while the publishable key, Production deployment and physical-device gates remain open.
- **Required Next Actions**:
  1. Action-time approval to create one Supabase publishable key, then configure it locally and in Vercel without logging its value; rerun `build:release` and `cap:release:ios`.
  2. Action-time approval for exact 063 application: pre-flight backup, catalog current state, blast radius adds one sanitized active-partner projection, rollback drop exact function/revoke, then PostgREST reload and real actor matrix.
  3. Migration 066 and Edge Function deployment remain a separate later gate.
  4. Apple provider enablement requires credentials, configuration, and separate approval.
  5. Do not stage `.DS_Store` or `control-tower/Now.md`.
