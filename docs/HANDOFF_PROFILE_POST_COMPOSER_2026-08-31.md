# HANDOFF — profile-post-composer 현재 저장소 인수인계

작성 기준: 2026-08-31 22:29 KST 전후 live checkout. 대화나 과거 보고서의 SHA보다 이
문서 작성 시점의 Git과 소스 확인 결과를 우선한다. 이 문서는 새 Codex 세션이 현재
상태를 오해하지 않고 이어가기 위한 비정규 handoff이며, 제품·보안·원격 상태의
canonical source가 아니다.

## 현재 목표

현재 checkout은 `codex/profile-post-composer`의 profile/story/post 후보와 그 이후
가독성·startup preflight 커밋을 보존하고 있다. 다음 세션의 우선순위는 새 기능을
추가하는 것이 아니라 다음 세 가지를 분리해 재판정하는 것이다.

1. profile-post 후보의 실제 branch/원격/Production·두 계정 동기화 gate를 다시 확인한다.
2. dirty cross-workstream 후보(Sentry, Account Deletion V2, pitch 캡처)를 profile-post
   구현 완료로 잘못 포함하지 않는다.
3. Account Deletion V2와 Sentry 후보는 별도 보안·통합 검토 전까지 안전/완료로 주장하지
   않는다.

## 정확한 Git 상태

- worktree: `/Users/han-yejun/Desktop/곰신로그`
- branch: `codex/profile-post-composer`
- HEAD: `a536f9bbd2a66b72f15daa99af093474a296c9c4`
- HEAD subject: `docs: record readability and distribution preflight`
- `origin/codex/profile-post-composer`: HEAD와 동일
- `origin/master`: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3` (HEAD를 포함하는 merge commit)
- 관계: `git rev-list --left-right --count origin/master...HEAD` = `1 0`
  (origin/master가 merge commit 한 개 앞서며, profile branch tip은 그 merge의 부모다)

현재 dirty 목록은 다음과 같다. 이 목록은 profile-post 구현 파일 목록이 아니라
동시에 존재하는 cross-workstream 변경 목록이다.

### tracked modified

- `.DS_Store` — macOS metadata
- `.env.example` — `VITE_SENTRY_DSN` 예시
- `control-tower/.obsidian/graph.json` — vault graph 변경
- `docs/WORK_LOG.md` — 이 HANDOFF 세션의 필수 ledger entry 추가
- `package.json`, `package-lock.json` — `@sentry/react` 후보 dependency
- `src/components/ErrorBoundary.tsx` — Sentry 후보 호출 추가 및 현재 raw `console.error` 유지
- `src/lib/store.test.tsx` — `INITIAL_SESSION` 테스트 문구/기대값 변경
- `src/main.tsx` — Sentry 후보 eager 초기화 호출
- `src/pages/authCallbackPkceRace.test.tsx` — 세션 persistence 기대값 추가

### untracked

- `control-tower/reports/codex/2026-08-30_2124_sentry-privacy-minimal-and-session-ledger_codex.md`
- `control-tower/reports/codex/2026-08-30_2355_local-master-push-hold-audit_codex.md`
- `control-tower/reports/terra/2026-08-31_2229_profile-post-composer-handoff_terra.md`
- `docs/HANDOFF_PROFILE_POST_COMPOSER_2026-08-31.md`
- `e2e/pitchShots.spec.ts`
- `e2e/pitchUsShots.spec.ts`
- `e2e/fixtures/photos/{cafe,food,letter,night,sky,sunset}.jpg`
- `src/lib/accountDeletionV2.ts`
- `src/lib/accountDeletionV2.test.ts`
- `src/lib/sentry.ts`
- `src/lib/sentry.test.ts`

최종 문서 작성·claim 해제 후 `git status --short`는 다음과 같다. 아래 목록에는 이
HANDOFF와 Terra report 자체가 포함되어 있으며, `control-tower/Now.md`에는 활성 claim이
없다.

```text
 M .DS_Store
 M .env.example
 M control-tower/.obsidian/graph.json
 M docs/WORK_LOG.md
 M package-lock.json
 M package.json
 M src/components/ErrorBoundary.tsx
 M src/lib/store.test.tsx
 M src/main.tsx
 M src/pages/authCallbackPkceRace.test.tsx
?? control-tower/reports/codex/2026-08-30_2124_sentry-privacy-minimal-and-session-ledger_codex.md
?? control-tower/reports/codex/2026-08-30_2355_local-master-push-hold-audit_codex.md
?? control-tower/reports/terra/
?? docs/HANDOFF_PROFILE_POST_COMPOSER_2026-08-31.md
?? e2e/fixtures/photos/
?? e2e/pitchShots.spec.ts
?? e2e/pitchUsShots.spec.ts
?? src/lib/accountDeletionV2.test.ts
?? src/lib/accountDeletionV2.ts
?? src/lib/sentry.test.ts
?? src/lib/sentry.ts
```

## 완료 작업 — profile/story/post 범위

현재 HEAD에 포함된 profile-post 계보는 `044d324` 이후 `e382d34`, `d40d7ee`,
`a64ecad`, `f12e83e`, `5b15685`, `a536f9b`에 걸쳐 있다. 실제 코드에서 확인한
핵심 동작은 다음과 같다.

- `우리`의 첫 탭은 달력/날짜 칸이 아니라 `isProfilePost === true`인 사진 기록만
  `postTiles`로 만들고, 글만 있는 기록은 사진 탭에 남긴다.
- `우리`의 게시물 작성기는 기존 `addRecordWithMedia`와 기존 Storage/RLS 경로를
  재사용한다. 새 게시물 전용 테이블·Storage 경로는 없다.
- 사진이 모두 저장되는 마지막 업데이트에서만 명시적 profile-post marker를 확정한다.
  public staged row는 private/marker 미설정으로 시작하고, media commit과 visibility/
  marker 확정을 분리된 새 권한 경계로 만들지 않는다.
- 기존 공유 사진을 자동으로 게시물로 backfill하지 않는다. 기존 Story 사진은 사진 목록과
  원본에 남고, profile tile/detail/original은 동일한 record ID를 사용한다.
- 선택한 기존 공유 사진은 현재 권한으로 다시 확인·다운로드하여 새 record 아래에 복사한다.
  시작한 couple ID, active/shared/private 조건, all-or-nothing media, retry row와
  duplicate 방지 lock을 확인한다.
- `우리`의 하이라이트는 게시물 격자와 별도 커플 데이터다. 비공개 기록을 제외하고
  record 단위로 선택하며, 다중 첨부 기록의 대표 cover는 첫 사진이다.
- Story는 요약과 exact original 순간을 함께 제공하고, 현재 가독성 변경은 작성자 이름
  중복 제거, `HH:mm`, 본문 17px, 사진 `contain`, 콘텐츠 아래 액션이다.
- 종이 질감 선택은 계정별 기기 로컬 설정이며, 게시물/Story 본문 크기 선택도 서버
  사용자 콘텐츠가 아니다. startup 분리는 pre-auth/Home 코드를 분리하고 boot surface를
  두는 변경이다.

이것은 로컬/branch 코드와 자동 검증의 설명이다. 실제 두 계정·두 기기 동기화,
Production parity, 최신 UI의 physical iPhone 렌더를 완료했다는 뜻이 아니다.

## 데이터베이스·원격 경계

- 이 handoff 세션에서는 Supabase, Auth, Vercel, Apple, TestFlight, App Store에 어떤
  변경도 하지 않았다.
- 이 handoff 세션에서는 migration을 적용하지 않았다. `supabase db push`도 실행하지
  않았다.
- 2026-08-28 기존 기록은 063/064/065/067의 Production 적용을 보고하지만, 이번
  `session-start.sh`에서는 remote catalog를 조회하지 않아 현재 원격 상태는
  **UNVERIFIED**로 남긴다. 과거 문서의 APPLIED를 이 세션의 live 증거로 승계하지 않는다.
- repository의 `supabase/migrations/067_profile_post_intent.sql`은 `daily_records`에
  `is_profile_post BOOLEAN NOT NULL DEFAULT false`만 추가하는 파일이다. 파일 존재는
  원격 적용 증거가 아니다.
- profile-post의 cleartext marker는 authorization이 아니다. 기존 row RLS, active couple,
  private/shared visibility, Storage 권한이 계속 실제 접근을 결정한다.

## 별도 dirty 후보 — 완료로 주장하면 안 되는 것

### AccountDeletionV2

`src/lib/accountDeletionV2.ts`는 React/Supabase/store에 의존하지 않는 순수 클라이언트
계약 후보다. UUIDv4 `operationId`, 32-byte base64url `recoveryToken`, localStorage
capability 저장/검증, PUT request body와 prepare/status/finalize 응답 parser를 제공한다.

현재는 **순수 클라이언트 계약만 존재**한다. 실제 `src/lib/supabase.ts`에는 V2 import나
adapter 함수가 없고, Settings/store 사용자 경로도 V2를 호출하지 않는다. 서버
`supabase/functions/delete-account/handler.ts`는 현재 POST만 받으며 V2 protocol/action
경로가 없다. V2 migration/server wiring/원격 적용은 없다. 기존 POST deletion과 기존
recovery marker 경로를 V2 구현 완료로 바꿔 읽지 않는다.

특히 현재 untracked `src/lib/accountDeletionV2.test.ts`는 254행의 테스트 뒤에 다음
patch artifact가 그대로 붙어 있다.

```text
*** Update File: src/lib/supabase.ts
@@ -12,2 +12,12 @@
```

따라서 실제 실행한 `npx vitest run src/lib/accountDeletionV2.test.ts`는
`src/lib/accountDeletionV2.test.ts:255:0 ERROR: Unexpected "**"`로 transform/parse
실패했고, `Tests no tests`였다. 이 파일을 PASS로 보고하거나 patch 내용을 실제
`supabase.ts` 변경으로 간주하지 않는다.

### Sentry 후보

현재 live dirty code는 이전 Sentry 보고서의 최종 후보와 다르다.

- `src/lib/sentry.ts`는 `@sentry/react`를 eager static import한다.
- `VITE_SENTRY_ENABLED === 'true'` 같은 exact true gate가 없다. 현재 조건은 web +
  production + non-empty DSN이며 strict explicit enable flag가 아니다.
- `package.json` dependency는 `"@sentry/react": "^10.72.0"` caret range다.
- `src/main.tsx`가 앱 시작 시 `initializeSentry(...)`를 직접 호출한다.
- `ErrorBoundary.componentDidCatch`는 `reportBoundaryError` 뒤에도
  `console.error('[ErrorBoundary]', error, info.componentStack)`로 raw Error와
  component stack을 출력한다.

그러므로 Sentry는 **안전/완료가 아니다**. 현재 후보의 focused test가 통과해도 privacy
gate, bundle/lazy boundary, console redaction, exact flag, production canary를 증명하지
않는다. 이전 report의 dynamic import/exact flag/raw console 제거 주장은 이 checkout의
현재 코드에 적용되지 않는다.

### pitch screenshots/photos

`e2e/pitchShots.spec.ts`, `e2e/pitchUsShots.spec.ts`와 여섯 JPEG는 mock backend에서
소개자료용 자연어 데이터와 사진을 제공해 `ui-audit-results/pitch` 캡처를 만드는
**capture-only untracked** 산출물이다. 제품 runtime, 실제 Supabase 데이터, 실제 사용자
경로, 출시 증거가 아니다. profile-post 구현 완료나 Production 화면 증거로 사용하지 않는다.

## 설계 결정과 변경 금지

- 사용자 선택과 명시적 발행 의도만 profile grid에 들어간다. 기존 사진의 의도를 추측해
  backfill하지 않는다.
- 게시물은 기존 DailyRecord/Storage/RLS/crypto 보호 경계를 재사용한다. 게시물 전용
  권한 우회, 새 평문 콘텐츠 컬럼, 서버 AI 선정, 관계 점수는 만들지 않는다.
- summary item과 Story action은 계속 exact source record ID로 원본을 연다.
- `우리`의 grid, `사진`의 record-centered list, `여행`의 planner 요약을 다시 합치지
  않는다. 하이라이트도 별도 모델로 유지한다.
- P5.3/P5.4 chat은 FROZEN/DEFERRED이고 P6는 승인된 선행 gate 전까지 시작하지 않는다.
- 시각 redesign, 색상·타이포그래피·간격·카드·네비게이션 변경은 이 engineering
  handoff의 범위가 아니다.
- Account Deletion V2, Sentry, OCR/pitch는 독립 branch/gate로 다루고 profile-post와
  섞어 merge하지 않는다.

이번 세션에서 코드·테스트·환경·migration·원격 상태를 수정하지 않는다. 특히
`docs/WORK_LOG.md`는 canonical ledger owner가 별도로 작성하므로 건드리지 않으며,
`control-tower/Now.md`는 `claim.sh`가 관리하므로 손으로 편집하지 않는다.

## 실행한 테스트와 정확한 판정

| 명령 | 결과 | 실제로 증명하는 것 |
|---|---|---|
| `npx vitest run src/lib/accountDeletionV2.test.ts` | **FAIL** — line 255 `Unexpected "**"`; 0 tests | patch artifact 때문에 해당 suite가 parse되지 않음 |
| `npx vitest run src/lib/sentry.test.ts` | **PASS** — 1 file / 4 tests | 현재 후보의 제한된 pure helper 테스트만 통과 |
| `npm run typecheck` | **PASS** | 현재 TypeScript project graph; V2 test parse나 runtime wiring 증명 아님 |
| `git diff --check` (문서 작성 전) | **PASS** | tracked diff whitespace; untracked 파일은 대상 아님 |

전체 `npm run verify`, 전체 Vitest, 전체 lint, build, Playwright, physical-device,
Production, remote actor matrix는 이 handoff 세션에서 실행하지 않았다. 그러므로
profile-post의 현재 checkout 전체를 새로 PASS라고 주장하지 않는다.

## 다음 세션 최초 작업

1. `bash scripts/agent/session-start.sh`를 실행하고 branch/HEAD/status/remote/claim을
   다시 고정한다. 문서에 적힌 SHA는 재검증 전까지 기준점일 뿐이다.
2. `src/lib/accountDeletionV2.test.ts:255` 이후 patch artifact를 별도 diff로 분석하되,
   사용자 승인 없이 코드 수정하지 않는다. 먼저 V2 protocol의 server/migration/wiring
   설계 및 보안 review owner를 정한다.
3. 현재 Sentry dirty diff는 이전 보고서와 대조해 exact `VITE_SENTRY_ENABLED === 'true'`,
   dependency pin, lazy import, raw console 제거 여부를 다시 확인한 후 독립 privacy
   review를 받는다. 지금은 merge/deploy/activate하지 않는다.
4. profile-post를 계속할 경우 먼저 067 remote catalog, backup/rollback, 두 계정·두 기기
   actor matrix를 action-time 승인과 함께 확인한다. `supabase db push`는 migration
   ledger가 verified될 때까지 금지한다.
5. 그 뒤에만 최신 exact HEAD 기준 focused/full tests와 real-browser/physical-device
   gate를 새로 실행한다.

## 반드시 읽을 문서/파일

- `AGENTS.md`
- `docs/AI_SESSION_PROTOCOL.md`
- `docs/CURRENT_STATE.md`
- `docs/V4_AS_BUILT.md`
- `docs/V4_BACKLOG.md`
- `docs/ENGINEERING_ROADMAP.md`
- `docs/HANDOFF_A1_DIARY_PAGES.md`
- `docs/CODEX_AUDIT_HANDOFF_2026-08-21.md`
- `docs/WORK_LOG.md` 최신 tail
- `control-tower/README.md`
- `control-tower/templates/Agent Report.md`
- `control-tower/Current Gate.md`
- 최신 `control-tower/reports/codex/` 리포트, 특히 Sentry와 local-master push-hold
- `src/features/us/SharedProfile.tsx`
- `src/features/us/postTiles.ts`
- `src/lib/records.ts`, `src/lib/store.tsx`
- `supabase/migrations/067_profile_post_intent.sql`
- `src/lib/accountDeletionV2.ts`, `src/lib/accountDeletionV2.test.ts`
- `src/lib/sentry.ts`, `src/lib/sentry.test.ts`, `src/main.tsx`, `src/components/ErrorBoundary.tsx`
- `supabase/functions/delete-account/handler.ts`, `src/lib/supabase.ts`
- `e2e/pitchShots.spec.ts`, `e2e/pitchUsShots.spec.ts`

## 현재 dirty diff의 의미와 rollback

현재 dirty diff는 한 기능의 단일 구현 delta가 아니라 profile-post branch 위에 남겨진
Sentry 후보, AccountDeletionV2 순수 계약 후보, pitch 캡처 fixture, 세션 테스트/문서
변경의 혼합 상태다. 기존 사용자 변경으로 보이는 `.DS_Store`, `store.test.tsx`,
`authCallbackPkceRace.test.tsx`, vault `Now.md/graph.json`도 보존한다.

- 이 handoff 작업이 새로 만든 파일은 두 Markdown 파일이며, 같은 세션의 필수 ledger인
  `docs/WORK_LOG.md`에는 한 항목을 추가했다.
- 이 세션에서는 commit/push/merge/deploy를 하지 않았다.
- Supabase migration/Auth/provider/Storage/Vercel/Apple/TestFlight를 이 세션에서
  변경하지 않았다.
- 코드 rollback은 다음 owner가 각 후보의 provenance와 승인 범위를 확인한 뒤 별도
  branch에서 해야 한다. 이 handoff는 dirty 파일을 reset/stash/clean하지 않는다.
- profile-post의 이미 merge된 코드 delta는 관련 commit만 revert하는 경우에도 067
  compatibility와 exact-original/retry 경계를 먼저 재검증해야 하며, migration column을
  즉시 DROP하는 rollback은 금지한다.

## 인수인계 중지 지점

- completed boundary: 필수 문서, 최신 Codex 리포트, live Git 상태, profile-post call path,
  AccountDeletionV2 patch artifact, Sentry 후보, pitch capture-only 산출물을 읽고 대조함
- code changes: 없음 (문서 두 개만 새로 작성)
- tests: V2 suite FAIL(parse, 0 tests), Sentry focused PASS(4/4), typecheck PASS, diff-check PASS
- remote/Production: 이 세션에서 NOT APPLIED; 현재 remote catalog는 UNVERIFIED
- next owner: primary Codex가 새 exact state를 재확인한 뒤 V2/Sentry/profile-post gate를
  각각 분리해 진행

## [NEW SESSION HANDOFF]

```text
저장소 `/Users/han-yejun/Desktop/곰신로그`의 현재 작업을 이어간다.

1. 먼저 `bash scripts/agent/session-start.sh`를 실행하고, 아래 값을 live Git과 대조한다.
   - branch: `codex/profile-post-composer`
   - expected HEAD: `a536f9bbd2a66b72f15daa99af093474a296c9c4`
   - Production/Supabase/Apple/TestFlight mutation: 이 HANDOFF 세션에서는 없음
2. `AGENTS.md`, `docs/AI_SESSION_PROTOCOL.md`, `docs/CURRENT_STATE.md`,
   `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`, `docs/ENGINEERING_ROADMAP.md`,
   `docs/WORK_LOG.md` 최신 tail, 이 파일과
   `control-tower/reports/terra/2026-08-31_2229_profile-post-composer-handoff_terra.md`를 읽는다.
3. `git status --short`, `git diff`, `git diff --cached`, untracked 목록을 다시 확인한다.
   현재 dirty worktree는 profile-post, Sentry, AccountDeletionV2, pitch 캡처, 세션 테스트가
   섞인 상태다. reset/stash/clean하지 말고 각 provenance를 먼저 분리한다.
4. 즉시 수정하지 말고 다음 blockers를 확인한다.
   - `src/lib/accountDeletionV2.test.ts:255`부터 patch artifact가 붙어 있어 focused Vitest가
     `Unexpected "**"`로 parse 실패한다. AccountDeletionV2는 client-only/unwired이며 서버,
     migration, Settings/store 호출 경로가 없다.
   - 현재 Sentry 후보는 `VITE_SENTRY_ENABLED === 'true'` gate가 없고, `^10.72.0` caret
     dependency, eager import, ErrorBoundary raw console logging을 사용한다. 안전/완료로
     주장하거나 Production에 활성화하지 않는다.
   - `e2e/pitchShots.spec.ts`, `e2e/pitchUsShots.spec.ts`, JPEG 6개는 mock capture-only다.
5. 다음 작업은 하나만 선택해 별도 gate로 진행한다. V2는 제품·보안·migration 설계 후
   negative test와 Sol/Architect 검토, Sentry는 exact gate/dependency/lazy/logging 경계 후
   독립 privacy 검토, profile-post는 migration 067 remote catalog와 두 계정 actor matrix
   확인 후에만 진행한다. Supabase/Production/TestFlight 변경은 별도 승인 없이는 금지한다.

현재 증거: `npx vitest run ... src/lib/accountDeletionV2.test.ts` FAIL(parse, 0 tests),
Sentry focused 4/4 PASS, `npm run typecheck` PASS, `git diff --check` PASS.
이 증거는 현재 uncommitted candidates의 end-to-end 안전성이나 Production parity를 증명하지 않는다.
```
