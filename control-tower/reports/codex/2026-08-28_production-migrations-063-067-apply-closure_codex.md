# Production migrations 063–067 apply closure — 2026-08-28

## 판정

**CONDITIONAL PASS.** 사용자 action-time 승인 범위인 exact
`064 → 065 → 067 → 063`은 Production Supabase에 적용됐고 파일별·최종 catalog,
PostgREST reload, rollback-only actor 경계에서 의도대로 동작했다. 066, Apple provider,
Vercel Production, PR merge, TestFlight/App Store는 적용하지 않았다.

이 판정은 실제 두 기기 E2EE 정상 ceremony, real JWT HTTP authenticated actor matrix,
실물 iPhone 화면·두 계정·Apple OAuth, Auth/Storage 전체 재해복구를 PASS로 부르지 않는다.

## Identity and direction check

- Repository: `/Users/han-yejun/Desktop/곰신로그`
- Branch: `codex/profile-post-composer`
- 적용 시 repository HEAD: `b85b7573a31b7c6c7ad9b9542545676e7c84f571`
- Runtime source commit: `044d32442cc7c1952f8916875dc32adec7157620`
- `origin/master`: `d9a2eb0a22b657c6384d59d1a53aa668fdb286f0`
- Product: `docs/WHAT_IS_GOMSINLOG.md`, `docs/V4_AS_BUILT.md`,
  `docs/V4_BACKLOG.md`
- Business: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- Engineering/current state: `docs/ENGINEERING_ROADMAP.md`,
  `docs/CURRENT_STATE.md`, latest `docs/WORK_LOG.md`
- Direction conflict: **NO**. 기존 Supabase source of truth와 곰신 대상 최소 복무정보
  projection, 명시적 게시물 의도를 유지한다.

## Action-time 승인과 실행 방법

- 적용 직전 현재 상태, blast radius, backup/rollback, exact 순서, 066 보류를 사용자에게
  제시했고 사용자가 `네`로 승인했다.
- migration ledger relation이 없으므로 `supabase db push`를 사용하지 않았다.
- Supabase CLI의 linked connection을 이용해 `SET ROLE postgres`,
  `ON_ERROR_STOP=1`로 exact repository 파일을 한 번에 하나씩 실행했다.
- 각 파일의 SHA-256:
  - 064: `4fd1808ea7998eea113b5bf3c56d9856985d79643c02748ff09dde2570c28ee2`
  - 065: `85ff1db68c590f02278ba6eb336e4fc5da09955eeba2c8e89b93a4bdf6c5b7aa`
  - 067: `aa5a73fc81344c0d06ef6c529666a7977db39a0414499440585597f33c7210cb`
  - 063: `1b062a9c9b948c63a4de445a4864eeaed33b5f35992feae89fcaa656d96f226d`

## 적용·catalog 결과

### 064 — pairing table privilege

- **APPLIED**.
- `authenticated` table privilege: 정확히 `SELECT` only.
- anon `SELECT`: false.
- `crypto_pairings`: 적용 전후 0행.
- 과거 `TRUNCATE/TRIGGER/REFERENCES` P0 권한은 제거됐다.

### 065 — pairing RPC hardening

- **APPLIED**.
- RPC 3개 존재: start, confirm, mark-active.
- 모두 SECURITY DEFINER, `search_path=public, pg_temp`, `auth.uid()` bound,
  authenticated EXECUTE, anon EXECUTE 없음.
- rollback-only live 검증:
  - active member valid start: `TRANSCRIPT_PROPOSED` 1행 생성 후 rollback.
  - NULL evidence: SQLSTATE `22023`.
  - former/unrelated start: `42501`.
  - noncanonical activation: `42501`.
  - canonical but unconfirmed activation: `22023`.
  - NULL signature confirm: `22023`.
- Production의 active device와 active couple scope key가 각각 0이므로 실제 두 기기
  confirm→activate 정상 경로는 **UNVERIFIED**다. rollback 후 pairing은 0행이다.

### 067 — explicit profile-post intent

- **APPLIED**.
- `daily_records.is_profile_post`: boolean, NOT NULL, DEFAULT false.
- 기존 5행: true 0, false 5, NULL 0.
- rollback-only live actor matrix:
  - owner marker update 1행, partner marker update 0행.
  - active partner shared read 1행.
  - owner private read 1행, partner private read 0행.
  - former/unrelated read 0행.
  - rollback 뒤 total 5행, true 0으로 원상 유지.

### 063 — partner service projection

- **APPLIED**.
- 함수 1개, no-argument, 허용 목록 6개 반환.
- SECURITY DEFINER, fixed search path, authenticated EXECUTE, anon EXECUTE 없음.
- `auth.uid()`·active caller·gomsin→soldier 경계가 있고 자유 형식 `memo`는 참조하지 않는다.
- rollback-only live actor matrix: gomsin 1행, soldier/former/unrelated 0행.

### Final integrated catalog

`2026-08-28T01:20:51Z` 최종 재확인:

- 063 function 1, 065 functions 3.
- 064 authenticated privileges `[SELECT]`, anon select false.
- 067 column 1, 5 rows all false, NULL 0.
- `crypto_pairings` 0행.
- migration ledger relation 없음.
- 066 claim RPC 0, `push_delivery_state` relation 없음.
- PostgREST anon probes for 063/065/067: `401/42501`, schema-missing false.
- live Edge Function: `delete-account` only, ACTIVE version 6, JWT required.

## Backup and recoverability boundary

- 적용 전 암호화 archive:
  `/Users/han-yejun/Documents/GomsinLog Backups/supabase-public-2026-08-28-pre-063-067-044d324.dump.enc`
- ciphertext SHA-256:
  `5e4b4224a33655572ab789f3d7ab3f866f3c1df486636d37db4bfab9e23c1c38`
- 키는 macOS Keychain에만 있고 보고서·로그·Git에 기록하지 않았다.
- 격리 PostgreSQL 17 restore exit 0: daily records 5, public tables 39,
  public functions 69, validated public FKs 53, profiles 5, pairings 0.
- 범위는 public schema/data다. Auth rows와 Storage blobs는 포함하지 않아 전체 Supabase
  disaster recovery PASS가 아니다.

## Independent post-apply review

- 우선 요청한 `kiro/gpt-5.6-sol` High는 실제 호출에서 `INVALID_MODEL_ID`로 실패했다.
  사용했다고 주장하지 않는다.
- 대체 `main/gpt-5.6-sol` High 읽기 전용 검토: **Production DB delta PASS /
  전체 출시 CONDITIONAL PASS**. reviewer가 `2026-08-28T01:26:05Z`에 Production을
  독립 재조회했고 P0 0, P1 0, SQL source P2 0으로 이전 HOLD 종료를 확인했다.
- reviewer의 유일한 P2는 exact HEAD `b85b757`의 운영 문서가 적용 전 상태였다는 것이다.
  이 closure commit이 migration README, current state, release plan, Work Log, report를
  Production 현실로 갱신해 해당 문서 P2를 닫는다. 이 docs delta의 diff/CI는 commit 후
  별도 확인한다.

## 명시적으로 적용하지 않은 것

- migration 066: **NOT APPLIED**. 선행 push table과 sender가 없다.
- Supabase Apple provider/Client IDs/Secret: **NOT APPLIED / OFF**.
- Vercel Production: **NOT DEPLOYED**; observed master remains `d9a2eb0`.
- PR #90 merge/master update: **NOT APPLIED**.
- TestFlight, App Store Connect submission: **NOT APPLIED**.
- 실제 iPhone 기능 검증: 폰이 분리된 상태라 **UNVERIFIED**.

## Rollback

- 064/065: 취약한 broad privilege나 062 함수 본문으로 되돌리지 않는다. forward migration으로
  repair하고 authenticated SELECT-only를 재고정한다.
- 067: 클라이언트를 먼저 이전 Production commit으로 되돌리고 harmless default-false 열은
  남긴다. 사용 후 열 삭제는 intent 데이터 손실이므로 하지 않는다.
- 063: projection을 철회해야 하면 exact 함수만 drop하고 PostgREST reload한다.
- 데이터 복원 후보는 위 encrypted public archive다. Auth/Storage는 별도 provider/object
  복구가 필요하다.

## 가장 작은 다음 단계

이 문서 delta를 commit·push하고 fresh checks를 닫은 뒤 PR #90 merge의 Vercel Production
자동 배포 영향을 먼저 확인한다. 그 다음 Apple Services ID/secret과 Supabase Apple
provider를 설정해 실제 iPhone에서 Google/Apple PKCE cold-start/deep-link를 검증한다.
Production web deploy와 TestFlight는 각각 별도 gate로 진행한다.
