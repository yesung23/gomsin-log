# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Application commit: `a96b0c45be5ea545ae2190c3e5878f50579a11c0`
- Garden state: local candidate; post-fix independent delta review pending
- Production, remote Supabase, current physical iPhone, TestFlight, App Store: UNVERIFIED / NOT APPLIED

## Findings

- The earlier empty white playfield did not yet express the product owner's intended shared aspiration: a couple should be able to project the home, places, and experiences they want into this private world.
- The old composite/pixel tree had visible quality defects. Its replacement needed complete transparent source art rather than stretched fragments.
- A width-only growth curve looked monotonic in unit tests but the different stage aspect ratios made the tree visibly shorter at 365 days. Independent review caught this at 320px and 390px.
- Enabling reduced motion while a shy/care timer was pending could still start a delayed run. This violated the user's changed accessibility preference.

## Decision

- Start the world with one central tree that the couple plants once and that grows with elapsed relationship days without exposing a score, streak, attendance counter, or failure state.
- Preserve the exact historical characters, identify them as `살구` and `초록`, and make motion legible through source-pixel limb layers rather than replacing the art.
- Treat the Garden as a free core relationship surface. Future houses, benches, pools, seasons, paper, and accessories can be direct-purchase expression products only after rights and entitlement gates; paid random loot remains prohibited.
- Scale by actual rendered height, not nominal width, so stage artwork never appears to regress at the one-year transition.

## Changes

- Four new complete transparent tree WebPs with pinned provenance hashes
- Account-scoped first planting and backward-compatible local state v2
- Four artwork stages plus daily visual-height growth
- 72×76 exact-source `살구/초록` characters
- Opposing-limb walk/run, face-covering shy reaction, and independent four-limb held flail
- Tap shy→safe run, close-encounter reaction, pair-safe collision and viewport boundaries
- Reduced-motion cancellation of already scheduled touch/care reactions
- 320/390 one-year rendered-height browser regression
- Canonical/current/provenance documentation update

## Verification

- Focused Vitest: 7 files / 167 tests PASS
- TypeScript, scoped ESLint, diff check: PASS
- System Chrome Garden: 12/12 PASS, one worker, retry 0, 1.2 minutes
- Exact final 390px capture: tree/characters visible without checkerboard, seam, clipping, or body loss
- Independent review before final height fix: CRITICAL 0 / HIGH 0 / MEDIUM 1 / LOW 0; MEDIUM reproduced and fixed
- Post-fix exact-commit independent delta: PENDING
- Full exact-HEAD repository suite, current iPhone, remote RLS/Production: UNVERIFIED

## Risks

- Still screenshots do not prove every animation frame or WebKit's complete SVG clip cycle; physical iPhone motion, VoiceOver, and energy profiling remain.
- Historical character/accessory commercial rights remain a separate external gate. Generated-tree provenance is documented, but legal uniqueness is not certified.
- Garden layout and ownership are still local. Server-synchronized buildings and paid entitlements are not implemented or activated.

## Current Score

- Product: 8.8/10
- UX: 8.8/10
- Design: 8.7/10
- Engineering: 8.9/10
- Security: 8.2/10
- Release readiness: 7.7/10

These scores apply to the Garden slice, not the whole app Release Candidate.

## Next Highest-ROI Goal

Complete Apple-primary/Google-secondary authentication behind default-OFF gates, while treating same-email automatic identity linking and Apple token revocation during account deletion as release blockers. In parallel, resolve Home/PartnerDay identity and on-device summary path evidence without changing unread/acknowledgement meaning.
