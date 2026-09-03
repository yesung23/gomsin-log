# V5 Garden Natural Interaction Plan — 2026-09-03

Status: LOCAL VERIFIED
Owner: Codex Control Tower
Worktree: `/Users/han-yejun/Desktop/gomsinlog-sol-rc-v4`
Initial base: `1276a257c7733620adbfdc6d3c3979f52a08828d`
Latest application checkpoint: `27c0805c3eb24e1cb19c0a63b66f876b0847ace7`

## Direction check

- Product source checked: `docs/PRODUCT_V5_MASTER_DECISION.md`
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` V5-D
- Current-state checked: repository at the base above and `docs/CURRENT_STATE.md`
- Latest relevant Work Log checked: `docs/WORK_LOG.md` garden entries dated 2026-09-01 through 2026-09-03
- Does this task conflict with canonical direction? **YES, narrowly resolved by the product owner.**
- Conflict and resolution: V5 removed the old once-per-day random draw and required direct starter choices. On 2026-09-03 the product owner explicitly requested a visibly spinning draw. This plan permits only an always-available, finite starter reveal with no date, deadline, streak, currency, payment, duplicate, or missed-day loss. Future paid accessories and buildings remain direct-purchase non-consumables; paid random loot remains prohibited.

## Product decision

The garden is a quiet white play space for the two approved paper characters. It is not a dashboard or pressure-based retention game. Following the product owner's 2026-09-03 correction, the available path has no visible words at all: the back and play/customization affordances are icon-only with accessible names, and the former `함께한 N일` counter is removed. Unavailable states retain truthful recovery copy because silently showing an empty garden would be misleading.

The nurturing-game feeling comes from direct response rather than obligation. A character sheet offers `쓰다듬기`, `인사하기`, and `같이 놀기`; each returns to the garden and produces a short, distinct body/limb response with a polite assistive announcement. There is no hunger, health meter, experience, score, streak, deadline, failure, or relationship rating. Future persistent value comes from owned accessories and direct-purchase interaction buildings, not from punishing absence.

The exact historical asset `src/assets/characters/paper-pair-v1.webp` remains the character and accessory source. The asset itself is not regenerated or altered. Code-native limb layers may animate around the exact body crop so walking and pickup are communicated without replacing the approved character art.

## Acceptance gates

### Garden surface

- No tree, stage copy, card border, or tinted panel on the available path.
- No visible day counter or other text on the available garden path.
- The garden fills the usable screen with a semantic white field in light and dark themes.
- The visible character artwork is approximately half the current 49×56 size while each interactive target remains at least 44×44 CSS pixels.
- Only two companions exist; both remain fully inside the scene and do not overlap.

### Character motion and accessibility

- Autonomous motion uses transform/opacity only and reads as walking: opposing arms and legs move with a small step cadence.
- A held companion keeps its body stable while independent arm and leg layers flail; whole-body shake is prohibited.
- Long-press drag, pointer cancel, lost capture, keyboard/action-sheet movement, focus restoration, and screen-reader labels remain supported.
- Pickup, release, and cancelled pickup expose polite status announcements.
- Pet, wave, and paired-play actions expose distinct one-shot reactions; the sheet closes so the reaction is visible in the garden.
- Every care action keeps a minimum 44px target and works through keyboard/screen-reader semantics.
- `prefers-reduced-motion: reduce`, hidden documents, and open sheets stop autonomous/repeating motion while preserving a static state cue and keyboard controls.

### Source-sheet accessories and starter reveal

- New starter accessories are cropped from the approved source sheet before introducing code-drawn alternatives.
- Existing stored legacy accessory IDs and equipped choices remain loadable; no owner loses an item.
- The starter reveal visibly rotates, persists the selected unowned item before announcing success, never duplicates, and has no daily reset or countdown.
- Signed-out users cannot mutate state. Storage failure does not falsely announce ownership. Account changes cancel pending visual completion.
- When the finite starter set is complete, the draw becomes unavailable with a truthful completion state.

### Verification

- Tests are written or changed before implementation for every changed behavior.
- Focused garden/shop/state tests, typecheck, scoped lint, and `git diff --check` pass.
- Local browser QA covers 390×844 and a small iPhone viewport, light/dark, reduced motion, long text where relevant, pointer interaction, keyboard interaction, and no overflow.
- A final independent reviewer inspects regression, accessibility, persistence, and motion failure modes.

Completed evidence at `27c0805`:

- Focused Garden/Shop Vitest: 11 files / 171 tests PASS.
- TypeScript, scoped ESLint, and `git diff --check 63beb82..27c0805`: PASS.
- System Chrome Garden matrix: 11/11 PASS with one worker and no retry, including a 10.75-second Realtime subscribe-boundary regression.
- System Chrome finite free Shop reveal: 2/2 PASS at 320px and 393px.
- Non-secret loopback placeholder production build: 2,546 modules PASS; Garden route 33.87 kB / gzip 11.43 kB and lazy source sheet 1,489.08 kB.
- Independent cumulative Garden review and final test-harness delta review: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.
- Production, remote Supabase/RLS, current physical iPhone touch/VoiceOver/energy, TestFlight, and App Store: **UNVERIFIED / NOT APPLIED**.

## Explicitly not changed in this slice

- Couple lifecycle, anniversary semantics, RLS, Supabase, E2EE, AI, records, unread/briefing state machines.
- Paid IAP checkout, entitlement server ledger, buildings, currency, scores, streaks, missions, needs/decay, or relationship evaluation.
- Production, Vercel, TestFlight, App Store, or remote Supabase state.

## Rollback

Revert the atomic garden commits. Local version-1 collection data remains backward-compatible and legacy IDs remain valid, so rollback must not delete local storage.
