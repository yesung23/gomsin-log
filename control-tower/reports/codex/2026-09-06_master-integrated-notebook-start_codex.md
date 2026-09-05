# Existing work integrated; approved notebook Home started

Latest checkpoint: notebook Home prototype is locally implemented and verified; all reported scoped findings closed. Ready for source commit/CI, NOT beta release. Earlier intermediate rejections below are retained as evidence history.

## Direction and scope

Latest user-approved notebook image and master-first order checked; V4_AS_BUILT, ENGINEERING_ROADMAP §0, CURRENT_STATE and latest WORK_LOG checked. Business NOT APPLICABLE for this presentation slice; no monetization/media-storage policy change. Older visual freeze yields only within the explicitly approved Home scope. No unapproved product conflict.

## Verified integration

- PR https://github.com/yesung23/gomsin-log/pull/93 merged at `2026-09-05T19:22:54Z`.
- Head `13eb1b921ece31aecf7eb4919d3f78556f360a2c`; merge/master `2d0c7f621bfe95aaa6b5e4ddc55b58a189a4ef89`, independently confirmed using `git ls-remote`.
- 256 commits / 669 changed paths relative to prior master. Required and additional PR checks passed before merge. No admin bypass.
- Exact-head CI: Vitest363 files/6188 PASS/2 SKIP; browser196 PASS (OCR3.4s); type/lint/build/CSP/assets, PG fresh-chain, Edge, native unsigned iOS/Android, sync and secret/audit checks PASS. Hosted/device tests are not implied.
- Post-merge exact master `2d0c7f6`: `gh run list --branch master` independently confirmed completed SUCCESS for master validation run `33986943738` and Native release validation run `33986943739`. This is additional integration evidence, not a signed-device or production deployment claim.
- `git fetch origin master`, exact-tree comparison, fast-forward and `git switch -c codex/notebook-home-v1` completed in `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`. Only script-managed Now was dirty; no source overwritten.
- Code integration rollback: reviewed revert of merge commit if necessary. No DB migration or production artifact was applied by the merge; Vercel Ignored Build Step still canceled its build.

## Actual Home implementation assignment

Boyle Sol High `01a07308-b891-7742-a43e-9e8cb07cd821` is sole UI writer, with the approved image and `.superpowers/sdd/rc-closure-plan-2026-09-05/home-notebook-approved-brief.md`. Scope is PaperHome, bounded new notebook presentation/preference components and their direct tests/screenshots. Store/auth/crypto/sync/summary semantics, frozen gallery/media and Book repo are excluded. Parent writes no app/test source.

UI/UX skill read, including full pro-rules and critical quick-reference sections. Generic newsletter/SaaS palette output did not fit and was rejected; approved paper/olive/rose tokens prevail. Verified drag-alternative guidance is applied. User-approved icon-only navigation and optional horizontal notebook reading override generic visible-label/vertical-only preferences while accessible names and button alternatives remain.

## Not completed

### Live preview diagnosis

Read-only `lsof` and `ps` confirmed that port 4174 is served from this worktree but explicitly uses `--outDir e2e/.artifacts/rc-e35ff9d-dist`. It is a pinned older build, not the evolving notebook source. This explains why source changes cannot appear in that preview automatically; no new screenshot is claimed from it. Keep it undisturbed during isolated 4192 validation, then explicitly switch the preview only after the new build is verified.

Further evidence: boolean-only inspection of its bundled JS found `example.supabase.co`, not the real project backend. Live in-app `/home` tab is actually at the unauthenticated consent screen with “현재 사용할 수 있는 로그인 방법을 확인하지 못했어요.” It is not a usable real-account preview. Do not swap in another QA-environment bundle and imply login is repaired; hosted compatibility and a correctly configured runtime must be verified separately.

Independent read-only bookmark architecture review assigned to Ampere Sol Max `01a07310-0b54-7a40-8a49-eed5a5606457`, disjoint from Home writing. No bookmark schema or implementation is authorized by that review alone; integrate its findings before the next implementation gate.

Review returned and agent closed: recommends additive personal `book_bookmarks` + immutable-media child IDs, authenticated RPC-only writes/reads, exact record provenance, separate from talkAbout, no durable content/URL cache or offline optimistic writes. Private/unlink/delete changes must prune inaccessible partner candidates; read authorization must remain independent of pruning. Parent independently read 084 Storage predicate and 090 metadata predicate: both currently require an active relationship even for the record owner. Therefore owner photo continuity after unlink needs a separately reviewed policy change; it must not be silently bypassed in bookmarks. Proposed 092 depends on currently unapplied 090/media lifecycle chain. No schema/API is implemented or deployed at this checkpoint. Full reviewer report was returned in conversation; these recommendations are not test or remote evidence.

Fresh read-only native check: `xcrun devicectl list devices` still reports physical iPhone unavailable; `xcodebuild -version` reports Xcode 26.6 / 17F113. Actual-device login, summary performance and signed beta installation remain UNVERIFIED.

Fresh authenticated dashboard read at the project Auth Providers page confirmed Google Enabled, Apple Disabled, anonymous sign-ins OFF, manual linking OFF and email confirmation ON. No provider changes were saved. Provider enablement is not evidence of a complete native OAuth round trip; the Apple custody/logging/build gates remain required before activation.

### First visual gate — rejected

Parent viewed actual `/home` screenshots `ui-audit-results/notebook-home-20260906-0441/402-light-horizontal.png` and `402-dark-horizontal.png`. Both showed the caption but no intended photo; this does not satisfy the approved taped-photo notebook. The screenshot helper allowed zero images and therefore did not prove the intended media path. Worker directed to repair the isolated fixture/render-path verification without weakening production media authorization, require the intended photo to load, and return new screenshots. These images are not a completed design deliverable and are not used as release evidence.

Parent then viewed the 0452-final light/dark screenshots: fixture photo displayed, but the top area pushed time/actions below the first fold. Requested Home-only compact layout without cropping media or truncating text. The subsequent `ui-audit-results/notebook-home-20260906-0455-compact-final/402-light-horizontal.png` visibly includes the taped QA image, full short caption, time and actual talkAbout action. This passes the narrow first-fold visual observation, not the complete behavior/release gate. The 320 dark/200% screenshot was also viewed; possible missing header action is being checked rather than assumed safe. Euclid Terra Max `01a0731e-d949-76f0-8cd9-447835ff0770` independently reviews paging/state/interaction, with source hashes required because the worker is still finishing. No more aesthetic scope expansion requested.

### Frozen implementation verification

Worker confirmed header call clipping at 320px/200% and fixed Home-scoped sizing. Parent viewed the corrected 0505-accessibility screenshot: saved/call actions both visible. Worker then froze source. Parent independently ran:

- `npx vitest run --config vitest.config.ts --configLoader runner src/features/home/ src/lib/bundleHygiene.test.ts`: 11 files / 113 PASS.
- `CI=true GOMSINLOG_E2E_PORT=4191 GOMSINLOG_NOTEBOOK_SCREENSHOT_RUN=20260906-parent-verification node node_modules/@playwright/test/cli.js test e2e/notebookHome.spec.ts e2e/homeLongContent.spec.ts e2e/mediaGallery.spec.ts --config=playwright.config.ts`: 25 PASS, 28.5s; includes QA production build, 12 viewport/theme/mode combinations and existing media gallery paths. No production backend is used.
- `npm run typecheck` and scoped ESLint for all changed TS/TSX tests/source: PASS.
- `git diff --check`: PASS.

Independent review still pending; no commit/preview replacement/new deployment at this boundary. Physical iOS gesture, VoiceOver, actual-login and on-device model performance remain UNVERIFIED.

Review returned against NotebookFeed SHA256 `9a5ddbed00e80d3c2803b8063676414089a12564ed72f255a7b0b32de7b36757`: P1 normalized intersectionRatio selects tiny fully-visible records over the long record occupying most of the viewport; P2 non-left mouse pointer may page; P2 dynamic action label plus aria-pressed communicates the opposite current mode. Parent checked these against source, read receiving-code-review skill, and accepted the bounded corrections. Worker authorized only NotebookFeed/direct test corrections, with fresh visible-pixel selection, non-left-button rejection and action-name-only ARIA semantics. Previous 113/25 PASS remains evidence for the pre-correction snapshot, not proof these uncovered cases work. Narrow DELTA review required after correction. No visual expansion and no remote change.

Correction frozen: NotebookFeed SHA256 `54fe90fd3a54d2a0a29cc8a2cf5212e3fb78a7bd5d5bc185bb3ac9ca9bab5cce`; its test `a77d063569675c6d8f61fa7af9187c59238064f487fab5e1c28e1976acf36989`. Parent inspected fresh visible-pixel measurement on scroll/resize with listener cleanup, right-button exclusion and removal of contradictory pressed state. Parent reran the same Home/bundle unit command: 11 files / 115 PASS (9.70s). Parent reran affected real browser mode/state and gesture cases with `--grep 'horizontal/vertical modes|record swipe guards'`: 2 PASS (14.4s), including a fresh QA production build. Euclid DELTA confirmation pending; no runtime/source activation inferred from these tests.

Euclid DELTA returned: all three original findings CLOSED on the exact 54fe90 snapshot. One P3 remains: removed ARIA state leaves its old visual CSS selector unmatched. Parent rejected the suggested ancestor-only selector because PaperHome's live toggle is outside the NotebookFeed wrapper; worker is applying a direct non-ARIA button data attribute and matching CSS. No interaction/authorization changes are needed. Reviewer closed; this trivial visual-state correction receives parent static/direct-test verification, not a repeated full audit. Parent execution evidence above is independent of worker reports.

P3 closed: parent verified the data attribute is on the actual toggle, CSS matches it, ARIA remains action-only, and independently reran NotebookFeed tests: 10/10 PASS. Worker and reviewer are closed. REVIEW IMPACT: reviewed interaction delta retained; subsequent narrow data-attribute/CSS/test change verified by parent. No known open scoped Home finding. Snapshot matrix is synthetic QA; physical iPhone/system gestures/VoiceOver and production remain outside this local verdict. Next: commit named paths, CI, correctly configured preview/hosted compatibility, then remaining bookmark/summary/date and beta gates. Rollback: revert this presentation/preference commit; it contains no DB or crypto migration and reading preference stores only an enum.

No new notebook Home implementation/screenshot is claimed at this checkpoint. Separate book bookmark persistence, later screen expansion, hosted compatibility/current recoverable backup, credential-incident closure, Apple provider/signing/device, on-device performance and beta deployment remain open. Book bookmark handoff contract exists, not app persistence.

Master merge APPLIED. Supabase/Edge/provider/production deployment/TestFlight in this checkpoint NOT APPLIED. REVIEW IMPACT: packaging-only integration tree identical to verified PR head; new Home requires fresh presentation/behavior review.
