# Scrapbook reference correction — active implementation

## Plan position / direction

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`, branch `codex/notebook-home-v1`, base `8b3ad4f1ba80c1f4bce01ea5a1047e62f0b0e3b5`, PR94.
- Latest user explicitly rejects the prior visual approximation and requests the approved photo reference: masking-taped photographs, scrapbook notebook composition, chronological time-entry story rail and direct access.
- Product: latest user approval + existing V4 flow; visual source: approved attached image and DESIGN_V2, with latest image precedence. Engineering/Current/latest Work Log already checked during Home integration. Business NOT APPLICABLE: no pricing/storage/AI policy change.
- Conflict: older Home comment mandates exactly two identity rings; latest explicit approval replaces that presentation restriction. Privacy, readable-content filtering, exact source identity and acknowledgment remain unchanged.
- Goal: first deliver actual Home matching the reference; do not claim the present diagnostic login screen or old screenshot is that result.

## Findings / decision

Parent viewed `402-light-horizontal.png` from the 0455 compact result: image dominates as a flat rectangle, tape is barely perceptible, sparse identity-only story rail differs from the reference's visual rhythm. Prior local tests are functional evidence, not approval of visual fidelity.

Use a unified inset paper scrap for photo, full caption, time and existing actions; clearly visible decorative tape and slim notebook binding; warm low-contrast ruling rather than dense blue form lines. Chronological photo/time rail retains own story/compose and partner summary entry. Missing photos use honest fallback, not fabricated content. Existing logo/navigation are outside this correction.

## Ownership / boundaries

Boyle, Sol High, sole Home implementation owner. Parent owns visual judgment, direction and independent verification; no parent app/test source edits. Scope: Home presentation/components and directly affected tests. No Story state machine, authorization, crypto, DB, auth, global theme, Book Studio, remote deploy or commit by worker.

Parent route inspection: `/story/partner?at=<id>` focuses exact ID but only within PartnerDay surface; seven-day feed is wider. Use a verified membership route or existing archive-day exact-ID route/direct record route. Never substitute another record or expand acknowledgment just to make a thumbnail work.

## Verification / next gate

New implementation NOT YET VERIFIED. Required: chronological stable ordering and exact ID navigation; private/unreadable/current-partner boundaries; 320/402 light/dark screenshots; full text, multiple photos, empty/error/loading; 44px controls, focus, reduced motion and prior swipe safeguards.

PR94 prior head 8b3ad4f CI remains in progress; it does not validate this forthcoming correction. REVIEW IMPACT: new Home presentation/navigation DELTA needed. Production changes NOT APPLIED. No merge while local correction is unverified. Rollback is scoped source revert, no data migration.

## Implementation checkpoint

- Previous committed head 8b3ad4f now has both master-validation `34008379933` and native-validation `34008379931` SUCCESS. This does not validate the uncommitted scrapbook correction.
- Parent personally viewed new local QA screenshots `notebook-home-v2-20260906-1226/402-light-horizontal.png`, `402-light-text-only.png`, and `320-dark-longtext-200-reduced.png`: inset photo/caption sheet, visible tape, binding and chronological rail are actually rendered. The image fixtures are synthetic illustrations, not customer photographs. These are intermediate screenshots, not frozen release evidence.
- Live 4193 UI is now authenticated and shows the prior build's text-only Home. Parent only inspected the UI; no account consent/login/content mutation was performed by parent. It has not yet received the scrapbook update.
- Pauli Terra Max read-only integration review found direct URL rendering cannot recover expired signed URLs; one-child-per-photo `useMediaAttachment(..., 'thumbnail')` and lazy images are required. Parent inspected the existing hook and sent the change to the sole worker. Core hook/security semantics stay unchanged.
- Rejected alternative: hiding all legacy photos without dedicated thumbnail renditions. That would defeat the user's requested photo rail. Keep existing hook's legacy behavior with lazy loading; prefer dedicated thumbnails when present, never manually fall back after permission denial. Legacy transfer cost remains a risk, not a falsely claimed zero-master guarantee.
- 320px/200% header wordmark appears constrained; worker is checking actual overlap before final freeze. No source is considered complete yet.

## Frozen local verification and actual preview

Worker froze five source/test files, aggregate diff SHA256 `c61e836c185101fca004ab3696d5db2ba9fa22c2c29bc73e9cf33ae51b001f68` against 8b3ad4f; parent independently matched it. Scope: PaperHome.tsx, notebookHome.css, PaperHome.test.tsx, notebookHome.spec.ts, storyProfilePresentation.spec.ts. Sticky fixture now supplies genuinely long text instead of relying on portrait-frame height; all geometry assertions remain.

- Worker: 123 unit / 20 browser PASS (Home15, gallery3, sticky2); type/scoped lint/diff PASS. This is worker-reported evidence.
- Parent: `node node_modules/vitest/vitest.mjs run src/features/home/PaperHome.test.tsx src/features/home/NotebookFeed.test.tsx src/lib/useMediaAttachment.test.tsx`: 75 PASS, 4.11s. Existing hook tests cover renewal and rejection; Home tests cover wiring/current identity/private and unreadable exclusions.
- Parent: TypeScript `tsc -b --pretty false`, scoped ESLint and diff check PASS.
- Parent: fresh QA production build on4194, `notebookHome.spec.ts --grep 'time rail opens|Notebook Home screenshot 402-light-horizontal'`: 2 PASS,15.0s. Browser proves exact original route/content; no-ack mock assertion is in unit coverage, not inferred from the browser test title.
- Parent viewed final320px/200% dark screenshot from1230-verified. Worker-added geometry assertions check brand does not overlap actions and its text does not overflow; screen-reader/physical Dynamic Type remain untested.
- Real-public-config `npm run build:release` PASS,2596modules,3.54s. Existing >500k chunk warning remains. Apple/IAP/E2EE device protection/partner briefing activation flags retained false; no readiness claim for held features.
- Immutable artifact `e2e/.artifacts/notebook-v2-c61e836-real-dist`, index SHA256 `6e5be8bfd6d39bbe3abab60f42def7c2e4c7d86cf2fb8580080291dbf2c39105`. Parent booleans: real project host=true, example project=false, new time rail=true. Public key selected in memory only; no environment file or secrets written.
- Replaced only parent-owned4193 preview process (old58436 stopped, new55834). Same origin preserves user session. Parent reloaded the existing in-app browser and visually confirmed the actual signed-in Home now has binding, time rail and inset text scraps. Current visible account records were text-only; no customer photo/upload was fabricated or submitted. No private record text is copied into this report.
- Independent Pauli TerraMax DELTA review still pending. New source uncommitted/unmerged and remote deployment NOT APPLIED. Next: close review findings, exact-commit CI and controlled source integration, then remaining server/device/bookmark gates.

## Independent DELTA closed / source integration gate

Pauli TerraMax final review matched the frozen aggregate and all five file hashes, C/H/Medium actionable 0. Confirmed media hook authority, identity boundaries, exact-ID navigation and actual installed Astryx selector structure. Reviewer ran hash comparison/diff check only; parent executed the tests and real build separately above. Review impact scoped DELTA PASS, not whole-app/hosted security approval. Parent stages only five named source/test files plus this report and WORK_LOG; Now remains excluded. Ready for new source commit and exact-head CI, not yet master merge or public deployment. Full objective remains open.
