# Summary V2 quality refinement — 2026-09-08

## Verdict

**LOCAL QUALITY DELTA IMPLEMENTED; TARGETED LOGIC/COMPILE EVIDENCE PASS; FULL APP SUITE UNVERIFIED IN THIS ISOLATED WORKTREE.**

이번 작업은 `codex/summary-v2-unified-briefing` @ `14e1c0c1425a314ef4afe39934cadacbad58d63f`를 기준으로 새 격리 worktree에서 요약 관련 실제 사용자 경로를 다시 감사하고 품질 결함을 수정했다. DB/migration/E2EE protocol/server AI/Production은 변경하지 않았다.

## Direction check

- Product source checked: `docs/V4_AS_BUILT.md`, current `/story/partner` and Record/Home code paths.
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` §7 — 사실 중심 요약, 시간순 정리, 중요한 추억 자동 선정 금지, 숨은 감정/관계 추론 금지.
- Engineering source checked: `AGENTS.md`, `CLAUDE.md`, `docs/skills/release-validation.md`.
- Current-state checked: `scripts/agent/session-start.sh`, code, `docs/CURRENT_STATE.md`.
- Latest relevant Work Log checked: 2026-09-08 Summary V2 unified Partner Briefing entry.
- Does this task conflict with canonical direction? **NO.**

## Findings and fixes

### 1. Correction could bind to an older duplicate sentence

`buildBriefingExtractCandidates` kept only candidate strings and used `sourceText.indexOf(previous)` when joining `아니/사실/하지만` style corrections. With repeated identical sentences, the correction could start at the first duplicate rather than the immediately preceding one.

**Fix:** candidates retain exact source `start/end` spans from `Intl.Segmenter`. Correction/negation continuations combine with the immediately preceding source span. Added regression for `좋았어. 좋았어. 아니 사실 별로였어.`.

### 2. Deterministic selector over-weighted verbosity

Candidate score gave up to 80 points for length. A long abstract emotional sentence could beat a shorter concrete event, conflicting with the product rule that emotional intensity is not importance.

**Fix:** length is now a capped weak completeness signal (32), concrete event/action/place/object evidence is stronger, abstract emotion without concrete event gets a penalty, and generic `하다` / `did` auxiliaries are not treated as event evidence. Korean and English regressions added.

### 3. Partner Briefing first screen contained counts, not useful context

Collapsed `PartnerBriefingCard` showed range/count overview only. Actual source-grounded content required opening details, so the nominal “10-second summary” did not answer what happened.

**Fix:** collapsed card now shows at most the first three chronological source-bound parts. This is a deterministic prefix, not importance selection. Every line opens its exact source record. Expanding replaces the preview with the full date/period hierarchy.

### 4. Active RecordPage summary still used legacy weak behavior

`generateDailySummary` remains active in RecordPage and home widgets, so leaving it as “legacy” was unsafe. It had several user-visible defects:

- copied an entire diary log into a quick summary;
- counted records containing photos rather than actual attachment count;
- omitted video from media summary;
- used `오늘` wording for archived dates;
- translated explicit `hard` tag into `정신없었던`, which is unsupported inference;
- could return zero summary items for a valid shared record with no text/media/reaction;
- for 4+ text records, comment promised up to 3 items but implementation emitted only the first text item.

**Fix:** it reuses PartnerBriefing closed-extractive candidate selection, emits up to three chronological exact-source text items for 4+ records, counts actual photo/video/voice attachments, uses date-neutral and tag-faithful wording, and keeps a source-linked neutral `기록을 남겼어요.` item for an otherwise empty valid record.

### 5. “오늘의 요약” showed a conversation prompt before the summary

`PartnerEmotionSummaryWidget` preferred `summary.opener` over the factual summary item. The widget title said summary but the content could be a question.

**Fix:** factual `summary.items[0]` is now primary; conversation opener is fallback.

### 6. Home briefing could open a different record than the visible headline

`widgetComponents` displayed emotion-flow before the summary but always chose `summaryTargetRecordId` for navigation. Visible content and exact-original target could disagree.

**Fix:** derived `headline` and `headlineTarget` together. Emotion-flow headline opens its emotion source record; summary headline opens the factual summary source. `summaryTargetRecordId` now prefers the factual item over the conversation opener.

## Verification actually executed

- `src/lib/partnerBriefing/fallback.test.ts`: **77 tests PASS** using the installed source-tree Vitest binary with worktree root and minimal config.
- Bundled current-worktree `src/lib/briefing.ts` and executed Node assertions: **PASS** for concrete-over-abstract selection, attachment counts, neutral empty record, hard/good date-neutral opener, private/unreadable exclusion, item-first summary target, and 4+ chronological three-item output.
- esbuild current-worktree UI bundles: `PartnerBriefingCard.tsx`, `PartnerEmotionWidgets.tsx`, `widgetComponents.tsx`, `RecordPage.tsx` — **PASS**.
- esbuild changed test-file compile: `briefing.test.ts`, `summaryJumpTargets.test.ts`, `PartnerBriefingCard.test.tsx`, `storyRoutes.test.tsx` — **PASS**. This proves syntax/import bundling only, not test execution.
- `git diff --check` — **PASS**.
- `bash scripts/agent/validate.sh app` — environment-blocked: `tsc`, `eslint`, `vitest` are absent from this isolated worktree, so typecheck/lint/full test/build are **UNVERIFIED for this delta**. The script's `git diff --check` stage passed.

The earlier 29 files / 736 tests + typecheck/lint PASS belongs to the preceding Summary V2 base and is not claimed as fresh proof for this refinement delta.

## Explicitly not changed

- DB/schema/migration: none.
- E2EE/auth/RLS/couple lifecycle semantics: none.
- Native iOS/Android prompt/provider implementation: none in this follow-up delta.
- Server AI, analytics content, AI persistence: none.
- Important-memory automatic selection: none; collapsed preview is chronological prefix only.
- Production/Supabase/Vercel/TestFlight/App Store/Google Play: **NOT APPLIED**.

## Remaining risks / next gate

1. Full typecheck/lint/Vitest/build must be rerun in an environment where this exact branch has dependencies installed before integration.
2. Korean/English deterministic concrete-event lexicon remains heuristic; real user corpus should be sampled before claiming quality completeness.
3. Physical iPhone Foundation Models / Android ML Kit quality, latency, heat, battery, cancellation, and repeated runs remain UNVERIFIED.
4. Legacy `dailySummary`/on-device-summary removal remains a separate cleanup gate; active `generateDailySummary` callers still exist and were intentionally hardened rather than deleted.
