# Book Studio Supabase 읽기 경계 구현 보고서

기준일: 2026-09-01

## PLAN POSITION

- Phase: Book Studio Supabase 연결 — 읽기 전용 Gate A/B 경계
- Workstream: 별도 Book Studio 사이트와 Supabase 권한 경계
- Step: PKCE 로그인, 현재 active couple allowlist RPC, 메모리 내 signed URL 연결
- Previous Gate: Gate A identity/exact-couple PASS
- This Gate: 로컬 구현·정적 계약 검증 PASS / 원격 적용 전 CONDITIONAL

## DIRECTION CHECK

- Product source checked: `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`, `docs/DESIGN_V2.md`
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`, `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`, `docs/skills/feature-build.md`, `docs/skills/security-review.md`, `supabase/migrations/README.md`
- Current-state checked: `bash scripts/agent/session-start.sh`, 두 feature worktree의 branch/HEAD/status, 기존 Book Studio 코드와 canonical migration/schema
- Latest relevant Work Log checked: 2026-09-01 Memory Book / service-readiness 관련 entries
- MASTER PLAN version / 기준일: Book Studio Supabase read-only integration / 2026-09-01
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A

## OWNERSHIP

- Tool: Codex orchestrator
- Model: primary Codex; requested `kiro/gpt-5.6-sol` Max consultation was attempted but the model gateway returned `401 Unauthorized`, so no Sol approval exists
- Role: bounded frontend integration, migration contract, verification, and release-boundary classification
- PR: none
- Frontend branch: `codex/book-studio-supabase`
- Frontend base SHA: `3847aca278fcf98254311696821606a6f7b433b2`
- Frontend new HEAD: `463e13b569515c2edd2aefe0bbc82108ef648330`
- Migration branch: `codex/book-studio-supabase-migration`
- Migration base SHA: `a536f9bbd2a66b72f15daa99af093474a296c9c4`
- Migration new HEAD: `fcd64b8a57bb723a368cd5cfd2aa8f8e50f99188`

## CHANGED / REVIEWED

- file: `src/lib/bookStudioSupabase.ts`, `src/lib/bookStudioAuth.ts`, `src/pages/AuthCallbackPage.tsx`
- function/component: independent Book Studio PKCE authentication
- what changed/reviewed: exact `VITE_BOOK_STUDIO_SUPABASE_ENABLED === 'true'` gate, publishable-key-only client, PKCE callback exchange with validated `sb_flow_id`, bounded token request body, one-time URL cleanup, no URL token-pair `setSession`
- why: the site must authenticate independently without receiving the app session token or accepting ambiguous callback state
- file: `src/lib/liveBookLibrary.ts`
- function/component: live library adapter
- what changed/reviewed: authenticated `getUser()` preflight, `get_book_library()` allowlist RPC, current-couple/public/plaintext response defense, canonical photo path validation, five-minute same-origin signed URLs held only in memory, no writes
- why: the editor must receive only the records and photos that the server contract explicitly allows
- file: `src/features/memoryBookStudio/MemoryBookStudio.tsx`, `BookPages.tsx`, `bookModel.ts`
- function/component: live editor wiring
- what changed/reviewed: synthetic data is absent in live mode; live data is rendered only after a successful authenticated load; logout, account switch, authorization reload, and late responses clear stale content; signed photo assets are rendered without persisting a draft
- why: a previous account/couple must not remain visible after auth context changes
- file: `book/vite.config.ts`, `.env.example`, README and deployment notes
- function/component: build boundary and operator documentation
- what changed/reviewed: default false build aliases out the Supabase SDK; live build is explicit and documented with staging gates
- why: the public synthetic deployment cannot accidentally ship live-data wiring or config values
- file: `supabase/migrations/068_book_library_read_rpc.sql`
- function/component: `public.get_book_library()`
- what changed/reviewed: SECURITY DEFINER, fixed `search_path`, authenticated actor, exact current active couple, exactly two active members, active owner membership, shared plaintext rows only, minimal return fields, canonical three-part photo paths, authenticated-only execute grant
- why: the browser must not directly query the full record table as a substitute for a project-scoped boundary

## EXPLICITLY NOT CHANGED

- crypto semantics: unchanged; encrypted rows are excluded, not decrypted
- DB/migration semantics: no existing RLS or Storage policy changed; migration 068 is a new repository commit only
- product semantics: no automatic memory/photo selection, no AI selection, no project/draft persistence, no PDF library
- app worktree: no production app source was changed
- Production: no Supabase migration, OAuth provider allow-list, Cloudflare environment variable, deploy, push, merge, or payment action

## VERIFICATION

- command: `npm run verify:release` in `/Users/han-yejun/Desktop/gomsinlog-book-studio-supabase`
- PASS: typecheck, lint, 9 test files / 69 tests, synthetic Book Studio build, direct-edit/font/layout/provenance/Cloudflare checks; exit 0
- command: explicit live build with placeholder publishable key, then explicit false synthetic build
- PASS: live bundle built (`492.22 kB` JS / `141.43 kB` gzip); false bundle built (`261.34 kB` JS / `80.16 kB` gzip)
- command: `npm audit --omit=dev`
- PASS: 0 vulnerabilities
- command: `npm test -- --run src/lib/migration068.test.ts` in migration worktree
- PASS: 1 file / 4 static migration contract tests
- command: `supabase db lint --local --schema public --fail-on error`
- BLOCKED / UNVERIFIED: local Postgres was not running at `127.0.0.1:54322`; no Docker/start action was taken
- command: `node /Users/han-yejun/.agents/skills/unlazy/scripts/gate-check.mjs --reverify .unlazy/book-studio-supabase/GATES.md`
- PASS: G1, G2, G3, G5 reverified; UNMET: G4 manual source-scan record, G6 independent Sol review, G7 remote Supabase/actor/OAuth/Cloudflare verification
- command: changed live-path source scan for console logging, storage/session mutation, service-role text, and token-pair session installation
- PASS: no matching logging or mutation call in the reviewed live integration files; signed URL variables exist only for in-memory rendering and are not logged
- command: `git diff --check` and staged diff inspection in both worktrees
- PASS: no whitespace errors; frontend and migration commits contain only the intended named files; `.unlazy` remains untracked and uncommitted

## REVIEW IMPACT

- FULL: this is a new auth/data boundary and requires an independent security review before remote enablement
- whether an earlier review is stale: earlier local Gate A review does not approve this new Supabase integration; Sol review was unavailable

## BLOCKERS

- code: no known local test failure in the bounded read-only implementation
- environment: no local Postgres/Docker for runtime SQL lint; no staging actor credentials or real OAuth callback evidence
- external/manual: Sol Max returned 401; remote schema/RLS/Storage policy state, staging actor matrix, OAuth allow-list, and Cloudflare live environment are unverified

## STOPPED AT

- exact completed boundary: committed local PKCE/read-only adapter/editor wiring and committed migration contract; stopped before any remote mutation or live flag enablement

## REMAINING

- obtain an independent Sol/security review on the exact commits
- apply migration 068 only in a controlled staging project after confirming migrations 009/032 and the final `couple-media` policies
- run authenticated actor matrix: own shared, own private, current partner shared/private, former partner, unrelated user, no couple, malformed/stale membership, anon
- verify signed URL access and unlink/relink/account-switch behavior in staging
- configure OAuth redirect allow-list and Cloudflare live build only after the above passes
- perform browser and real iPad/iPhone user-flow verification; current local tests are not device evidence

## NEXT ACTION

- next owner: independent security reviewer, then staging operator
- tool/model: `kiro/gpt-5.6-sol` Max when the model gateway is available; otherwise do not treat a different model as Sol approval
- 기준 SHA: frontend `463e13b569515c2edd2aefe0bbc82108ef648330`; migration `fcd64b8a57bb723a368cd5cfd2aa8f8e50f99188`
- exact next task: read-only review of the exact commits, then staging-only migration and actor/RLS/Storage checks; no production apply

## DO NOT ADVANCE UNTIL

- independent security review is recorded against the exact commits
- migration 068 runtime SQL lint and staging apply succeed
- actor matrix proves private, former-partner, unrelated-user, anon, and stale-membership denial
- signed URL scope and unlink/relink stale-state behavior are verified
- only then set the Cloudflare live build flag; never put service-role material in browser config

## PRODUCTION

- NOT APPLIED: Supabase, Storage, OAuth allow-list, Cloudflare, GitHub push/merge, deploy, and database changes
- UNVERIFIED: remote catalog, staging/runtime SQL, actor matrix, physical device behavior, and independent Sol review
