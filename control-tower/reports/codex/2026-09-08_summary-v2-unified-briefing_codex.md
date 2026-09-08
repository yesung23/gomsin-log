# Summary V2 Unified Partner Briefing — 2026-09-08

## SCOPE
- Repository: `/Users/han-yejun/Desktop/곰신로그`
- Isolated DevSpace worktree branch: `codex/summary-v2-unified-briefing`
- Base: master `82979baa8e6f1a61bee0a7ff72c67b75b370a221`
- Goal: make Partner Briefing the canonical partner-story summary contract for today and missed periods while preserving deterministic fallback, exact provenance, E2EE boundaries, and rollback compatibility.

## AUDIT
- Active paths inspected: `src/lib/briefing.ts` callers, `src/lib/dailySummary/**`, `src/lib/partnerBriefing/**`, `src/features/story/**`, both on-device packages, native iOS/Android providers, relevant tests, `docs/V4_AS_BUILT.md`, `docs/CURRENT_STATE.md`, `docs/PARTNER_BRIEFING_ARCHITECTURE.md`, recent control-tower reports, and `docs/WORK_LOG.md`.
- `PRODUCT_V5_MASTER_DECISION.md` was not present in the audited checkout.
- `gomsinlog-summary-v2.patch` was not present in the audited worktree.
- `src/lib/briefing.ts` is still used by `RecordPage`, `PartnerEmotionWidgets`, and widget helpers; it was not deleted.
- Legacy `dailySummary` had the active Story cover refinement caller before this change. Its module/native package remain for rollback and compatibility tests, but the active partner Story caller no longer uses it.
- PartnerBriefing already owned the stronger closed-extract provenance contract: supplied surface only, ordinal-only native output, exact candidate membership verification, deterministic fallback, exact `sourceRecordId` mapping, and no persisted AI prose.
- Current Android PartnerBriefing provider does exist and uses ML Kit GenAI Prompt API; current iOS provider uses Foundation Models. Older documentation claiming Android absence is not treated as implementation truth.

## IMPLEMENTED
1. **Unified partner Story ownership**
   - `/story/partner` now always attempts deterministic PartnerBriefing for today/outstanding records.
   - `VITE_PARTNER_BRIEFING_ENABLED` now gates only on-device refinement, not whether a briefing exists.
   - Legacy `useOnDeviceDailySummary` was removed from the active Story caller.
   - Existing deterministic Story cards remain a compatibility fallback if PartnerBriefing corpus/identity cannot be built.

2. **Deterministic exact-source selection quality**
   - Added deterministic candidate scoring instead of always choosing candidate 0.
   - Prefers complete, concrete event/action/plan/place/object wording and penalizes generic/very short openings.
   - Selection never invents text; displayed extract remains an exact source substring.
   - Ties preserve source order.
   - Meaning-dependent correction/negation continuations (`아니`, `사실`, `하지만`, etc.) are conservatively merged with the preceding exact substring so extraction cannot flip the written meaning.

3. **On-device closed selection guidance**
   - iOS Foundation Models and Android ML Kit prompts now explicitly prefer concrete/context-independent supplied candidates.
   - Emotional intensity is not an importance signal.
   - Native model is explicitly forbidden from inferring facts, emotion, health, intent, causes, advice, or relationship state.
   - Native response remains ordinal-only; it still cannot return display text or record IDs.
   - Android prompt overhead budget increased from 512 to 1024 bytes after the prompt grew; actual static prompt remains within the advertised budget.

4. **A → B → A stale resurrection protection**
   - `usePartnerBriefing` now binds each refined result to both semantic `inputKey` and a monotonically changing input revision.
   - Returning to a source with the same semantic key after an intervening source epoch cannot temporarily resurrect the earlier refinement.

5. **Regression coverage**
   - Added/updated Korean semantic cases for negation, correction, condition, quotation, irony/joking, Korean/English mixing, emoji/ZWJ, and line breaks.
   - Added explicit A → B → A stale-refinement regression.
   - Updated Story route/identity tests for canonical briefing prefix while preserving exact original/talk-about/highlight/acknowledgement semantics.

## VERIFIED
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- Focused PartnerBriefing/Story run — PASS, 7 files / 245 tests.
- Broad summary/briefing/story regression:
  - command: `npx vitest run --config vitest.config.ts --configLoader runner src/lib/briefing.test.ts src/lib/dailySummary src/lib/partnerBriefing src/features/story src/components/widgets/PartnerBriefingCard.test.tsx src/components/widgets/CallBriefingWidget.test.tsx src/components/widgets/StoryRailWidget.test.tsx src/lib/summaryJumpTargets.test.ts`
  - PASS, 29 files / 736 tests.
- `git diff --check` — PASS before documentation closure.
- Exact-original navigation is still covered by Story and PartnerBriefingCard tests; grouped parts retain exact `sourceRecordId` mappings.
- Native bridge static-contract tests for both iOS and Android pass as part of the 736-test suite.

## UNVERIFIED
- Physical iPhone Foundation Models quality, Korean candidate quality on the real model, deterministic → native transition latency, background/cancellation behavior on hardware, heat, battery, memory, and repeated 1/3/8/15/20-record runs were not executed in this task.
- Physical Android ML Kit GenAI quality/runtime was not executed.
- iOS native compile for this exact worktree revision is UNVERIFIED because the required production web build preceding `cap sync` stopped at missing `VITE_SUPABASE_URL`.
- Android native compile for this exact worktree revision is UNVERIFIED because generated Capacitor Cordova files were absent: `android/capacitor-cordova-android-plugins/cordova.variables.gradle`.

## NOT APPLIED
- No Supabase migration or remote database mutation.
- No E2EE protocol/key change.
- No server-side AI, network inference, prompt persistence, analytics logging, or AI-result persistence.
- No deletion of `src/lib/briefing.ts`, `src/lib/dailySummary/**`, or `packages/capacitor-on-device-summary/**`; legacy cleanup remains a separate gate.
- No adaptive compression rewrite beyond the existing contiguous 2–4 grouping contract. This avoids destabilising provider/verifier/provenance guarantees in the same change.
- No production deploy, TestFlight, App Store, Google Play, or remote push performed by this task.

## REMAINING RISKS
- Deterministic sentence scoring is heuristic and should be tuned with real Korean corpus feedback; it is deliberately conservative and extractive rather than semantic inference.
- Correction/negation continuation handling covers explicit connective patterns; subtle discourse reversal without a marker can still require the on-device closed selector or whole-source fallback.
- Native prompt changes require exact-revision simulator/Gradle compilation once environment generation/secrets are available.
- Real-device model availability, latency, thermal behavior, and locale quality remain release gates.
- `dailySummary` still exists as rollback/legacy code; it should only be removed after caller/import/native-registration dead-code proof in a dedicated cleanup change.

## VERDICT
- **IMPLEMENTATION STATUS:** core unified summary-v2 contract implemented locally.
- **LOCAL JS/TS VERIFICATION:** PASS.
- **EXACT NATIVE REVISION BUILD:** UNVERIFIED due environment blockers above.
- **REAL DEVICE:** UNVERIFIED.
- Therefore this report does **not** call the feature fully release-complete.
