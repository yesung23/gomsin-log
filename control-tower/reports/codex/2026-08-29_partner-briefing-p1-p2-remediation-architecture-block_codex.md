# Partner Briefing P1/P2 remediation — architecture blocker reassessment and closure

## Verdict

`ORCHESTRATOR: LOCAL CODE CONDITIONAL PASS — TERRA PASS; DEVICE/ANDROID ENVIRONMENT UNVERIFIED; MERGE HELD`

Reviewed worktree: `/Users/han-yejun/Desktop/곰신로그-partner-briefing`
Branch: `codex/partner-briefing`
HEAD: `15a7a7933d37e95907fd8f5d609fbb9e4f1e1cd2`

No commit, push, merge, deploy, Supabase mutation, server AI, or AI-result persistence was performed.

## Reassessment and resolution of architecture blocker

The prior architecture block identified a tension between semantic compression and the sensitive data boundary, which assumed that either a DB projection migration or free text classification was required. That blocker is now resolved and closed under the canonical privacy contract and the v2 grouping architecture:

1. **Privacy Authority & Zero DB Migration:**
   - Explicitly partner-shared, partner-readable general `DailyRecord.log` text is processed exclusively by on-device AI directly on the partner's physical device.
   - No database projection column or migration is required.
   - Private/author-only (`isPrivate !== false`), unreadable (`contentUnavailable`), wrong-partner, and unpersisted records are excluded fail-closed.
   - Structured cycle/bleeding/pain/symptom/health fields and unshared projections are strictly excluded upstream and never read or projected.
   - Zero metadata leakage: database keys, actual user/couple/record IDs, exact timestamps, URLs/paths, and cryptographic keys never cross into wire payloads.
   - Zero external transmission: No server AI, analytics content, persistent AI storage, or external content service is used.

2. **v2 Ordinal Grouping Plan & Extractive Multi-record Compression:**
   - Provider returns version 2 `UntrustedBriefingGroupPlan` consisting strictly of `groupOrdinal` and choices (`itemOrdinal`, `candidateOrdinal`).
   - The model generates **zero** displayable text, strings, claims, or labels.
   - Real compression: 2–4 contiguous source items are grouped into one final UI item with exact constituent `parts` (`{ text, sourceRecordId }`).
   - Singleton items are used only for single-item requests or deterministic fallback.
   - Grouping never crosses day/period boundaries or fallback/media-only gaps.
   - Long unfittable records fall back to deterministic singletons rather than splitting or dropping.
   - TypeScript verifies strict allowlists, non-negative integers, exact ordered source coverage, and binds real record IDs.

3. **Pipeline, Deadline, & Stress Boundaries:**
   - Enforces a whole-run deadline across all batches.
   - Partial batch failures fall back to deterministic exact-source items for that batch while retaining verified sibling choices.
   - Provenance is classified as `on_device`, `hybrid`, or `deterministic`.
   - 30/100/300 record stress suites pass.
   - Progressive disclosure renders 20 compressed groups at a time and eventually exposes every exact original.

4. **Persisted Authority & State Isolation:**
   - Persisted record authority is guaranteed by the current call path (adding records after save confirmation) plus structural `id`/`userId`/`createdAt` gates.
   - `StoryRoute` remounts on `${viewerId}:${coupleId || 'no-couple'}` key changes, preventing cross-relationship state leaks.
   - Briefing viewing/expanding never writes CONFIRMED or modifies PartnerDay state.

5. **Native Platform Implementations & Android API Floor:**
   - iOS uses Apple Foundation Models on-device provider (`OnDeviceBriefing.swift`).
   - Android uses official ML Kit GenAI Prompt beta2 (`OnDeviceBriefingEngine.kt`).
   - Android app has `minSdk 23`; provider is API 26+ gated. Pre-26 devices fall back safely to deterministic mode without touching ML Kit classes.
   - Single lazy `Deferred` handles completion/cancellation without split-job races.
   - iOS keeps a bounded in-memory pre-start cancellation set inside its actor, so cancel-before-registration cannot start a Foundation Models session.
   - Android registers the request `Deferred` before launching the bridge coroutine.

## Verification status

### Verified Locally (PASS)
- Final focused iOS/native/hook regression: **3 files / 56 tests PASS**.
- Full `npm run test`: **279 files / 4,205 tests PASS**.
- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS**.
- Production `npm run build`: **PASS**, Vite **2,179 modules**.
- `npm run verify:native`: **4 files / 106 tests PASS**.
- `npm run test:e2e:partner-briefing`: **2/2 PASS** at 390x844 in Korean and English; expansion, 44px controls, and exact-record navigation verified under deterministic browser fallback.
- `npm run test:phase0`: **PASS**, PostgreSQL 17 / 65 migrations / 420 assertions in a throwaway local database.
- `npx cap sync ios`: **PASS**, 6 plugins.
- Unsigned iOS Simulator `xcodebuild`: **BUILD SUCCEEDED**, including recompilation of the updated Swift target.
- `git diff --check`: **PASS**.
- Terra High independent review: initial **BLOCKED** on one iOS cancel-before-registration P1; after the bounded actor-owned pre-cancel fix and regression test, fresh code-delta review **PASS** with P0 none / P1 none / P2 none. Later edits are evidence-only documentation updates.

### Pending / Unverified
- Android compile and app assembly: attempted, but blocked before Kotlin compilation because this host has no configured Android SDK.
- Android API 23–25 emulator startup/fallback behavior.
- Physical iPhone Foundation Models runtime, including cancellation/offline/model-unavailable paths.
- Physical Samsung/Android on-device Gemini runtime and capability detection.
- Signing, Archive, TestFlight, remote Supabase/Vercel/Apple configuration, and Production rollout.

The scoped local implementation and independent review are complete, but device and Android environment evidence are still missing. The release status is therefore **CONDITIONAL PASS**, not App Store/Android READY.

## Rollback & Safety

All changes are local in the worktree and uncommitted. Disabling the feature flag restores the legacy dailySummary cover cleanly. No Production or Supabase changes were made, so no database rollback exists or is needed. Merge, push, and deploy remain intentionally held.
