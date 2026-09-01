# Interactive Companion Garden — implementation and validation report

- Date: 2026-09-01 KST
- Tool: ChatGPT + DevSpace isolated worktree
- Base: `origin/master` = `b7df5f69691b1cc60bda75b95664271c48acc7cc`
- Live master recheck after validation: unchanged at `b7df5f69691b1cc60bda75b95664271c48acc7cc`
- Production mutation: **NOT APPLIED**
- Supabase / migration / RPC / RLS / Storage changes: **NONE**

## Decision

The historical `codex/couple-garden-v1` branch was not merged. It was based on an old, broad change stack and its garden was a static staged illustration without the requested walking, accessories, or pick-up interaction. The current implementation was rebuilt narrowly on the latest master.

## Implemented behavior

### Garden availability

`/diary/garden` is reachable from `/diary` and renders only when all of the following are true:

- local couple is connected and active;
- server-authoritative lifecycle is `connected`;
- current user id and couple id exist;
- shared state is not `unavailable`;
- anniversary date is a real calendar date and is not in the future.

If the relationship state is uncertain, the page fails closed and does not render a fake day count, stage, or companions.

### Growth

Growth remains deterministic and score-free:

- 1–29 days: 작은 싹
- 30–99 days: 어린 나무
- 100–364 days: 든든한 나무
- 365+ days: 꽃 피는 나무

No streak, feeding, mission, ranking, relationship score, or AI inference was added.

### Two autonomous companions

Two original inline-vector companions (`peach`, `sage`) are rendered as independent interactive controls.

Each companion:

- starts from a separate position;
- chooses a bounded random destination;
- refuses destinations too close to the other companion;
- avoids near-zero fake movement;
- walks for 1.8–3.6s;
- rests for 0.6–1.8s;
- repeats independently;
- uses safe fallback destinations if RNG degenerates;
- cancels timers on unmount.

The position wrapper owns left/top transitions and the glyph owns the walking bob animation, so transforms do not overwrite one another.

### Pick-up / wriggle interaction

Tapping or pressing Enter on either companion:

- marks it lifted immediately;
- raises it visually;
- runs a short left/right wriggle;
- returns it after 900ms;
- repeated activation restarts the timer instead of allowing a stuck lifted state.

With `prefers-reduced-motion: reduce`, autonomous walking is disabled and lift is represented by a small static translation without wriggle animation.

### Accessories

Five free device-local choices are available per companion:

- 없음
- 모자
- 리본
- 목도리
- 꽃

The selector uses actual `button[role="radio"]` elements. An initial hidden-input/label implementation was rejected after real Chromium hit-testing showed that the label intercepted the radio click. The final accessibility node and physical hit target are the same element.

Accessory state is stored only at `gomsin.diary.garden.<userId>`. Invalid stored values fail safe to `none`. Garden state is account-scoped and is included in the existing diary local purge on logout/account deletion.

No accessory purchase, entitlement, server sync, analytics, or remote persistence was added.

## Browser proof

`e2e/companionGarden.spec.ts` verifies the real production bundle with the mock backend:

- both companions visibly change position;
- both move counters advance;
- minimum separation is maintained;
- accessories change visually;
- accessory selection survives reload;
- lift starts and returns after real elapsed time;
- 44px hit targets;
- no horizontal overflow;
- 320px, 390px, 430px containment;
- reduced-motion keeps autonomous motion stopped while preserving understandable lift feedback.

Result: **5/5 PASS**.

## Full validation

### App

`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_public_key_not_a_secret npm run verify`

- typecheck: PASS
- lint: PASS
- Vitest: **277 files / 3,877 tests PASS**
- production build: PASS
- initial app JS: **133.46 kB gzip**
- `CompanionGardenPage` lazy chunk: **5.29 kB gzip**

`scripts/agent/validate.sh app` with the same public placeholder environment: **PASS**.

### Browser

All 24 Playwright specs were run in four batches:

- batch 1: 55/55 PASS
- batch 2: 35/35 PASS
- batch 3: 24/24 PASS
- batch 4: 19/19 PASS

Total: **133/133 PASS**.

### Native contracts

`npm run verify:native`: **106/106 PASS**.

This proves tracked native/config/privacy contract invariants, not physical-device runtime behavior.

### Edge

- `npm run check:edge`: PASS
- `npm run test:edge`: **18/18 PASS**

### Diff hygiene

- `git diff --check`: PASS
- live `origin/master` read-only recheck: still `b7df5f69691b1cc60bda75b95664271c48acc7cc`

## Explicitly not changed

- Supabase schema or migrations
- RLS / RPC / Storage authorization
- E2EE / key authority / crypto protocol
- Push behavior
- on-device AI
- Book Studio
- Vercel deployment
- TestFlight / App Store
- paid accessories or garden economy

## Remaining integration boundary

The validated worktree is still uncommitted. The current exposed DevSpace command surface permits tests/builds and Git inspection but does not expose an authorized Git mutation primitive for branch creation, commit, push, or PR creation. The attempted outer native command bridge was unavailable (`MCP SSE probe 404`).

Therefore no Git write was fabricated or performed through an unsupported path. The next write-capable release owner should:

1. recheck live `origin/master`;
2. create a feature branch from this exact base;
3. commit only intended garden/app/docs files, excluding `control-tower/Now.md` claim metadata;
4. push and open a Draft PR;
5. require CI green on the committed exact tree before merge;
6. optionally perform physical iPhone interaction QA before App Store upload.

The current implementation is locally **READY FOR COMMIT / DRAFT PR**, not Production-applied.
