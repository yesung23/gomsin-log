> **Status: HISTORICAL SUPPORTING.** Use current repository harnesses and
> [`docs/rls-test-matrix.md`](rls-test-matrix.md) or task-specific tests for current
> verification; this document is not proof that tests were executed.

# 곰신로그 (곰신로그) 보안 & RLS 권한 검증 계획서

본 문서는 **`곰신로그` (군화와 곰신을 위한 1:1 비공개 데일리 로그 서비스)**의 DB REST API, Storage API, 각 테스터 JWT 및 RLS 정책을 기준으로 검증하는 종합 보안 테스트 계획서입니다.

> ⚠️ **구현 및 검증 상태 고지**:
> 1. **구현 여부와 실측 검증 여부는 다른 축입니다.** 이 문서에서 "구현 완료" 는 코드가
>    존재하고 단위/통합 테스트가 그것을 덮는다는 뜻이고, "실측 미검증" 은 실제 Supabase
>    프로젝트에서 두 계정으로 측정한 기록이 없다는 뜻입니다. 아래 표는 두 축을 분리해
>    적습니다. **"100% 완전 보안" 및 "코드 수준 확증" 표현은 실제 서버 RLS 실측 전까지
>    사용하지 않습니다.**
> 2. **`is_private` 격리**: 서버 RLS(`005`/`009`/`014` 마이그레이션)와 클라이언트 재필터
>    (`src/lib/privacy.ts`) 양쪽이 **구현 완료**입니다. 로컬 캐시에도 private 기록의 본문·
>    첨부·감정 메타데이터를 저장하지 않습니다(`src/lib/store.tsx`). 실제 프로젝트에서의
>    RLS 실측은 아래 API-\*/STOR-\* 행을 참조하세요.
> 3. **인증 상태**: 원격 설정에서 Google·Email provider 활성화와 Auth health 응답은
>    확인했습니다. Apple provider는 비활성화되어 UI에서도 노출하지 않습니다. 실제 사용자
>    OAuth·Magic Link 왕복은 사람이 테스트 계정으로 최종 확인해야 합니다.
> 4. **Storage / 계정 삭제**: Private Bucket 업로드(`src/lib/records.ts:378`), Signed URL
>    발급(`src/lib/records.ts:92`, TTL 1시간), MIME/용량 제한(`classifyMediaFile` +
>    `MAX_BYTES`), 계정 완전 삭제 Edge Function(`supabase/functions/delete-account/`)은
>    모두 **구현 완료**입니다. 이 문서는 한때 이 네 항목을 "파일럿 전 필요 (미구현)" 으로
>    적어두고 있었고, 그 상태로 파일럿 go/no-go 를 판단하면 틀립니다. 남은 것은 **원격
>    적용·배포와 실측**입니다.
> 5. **빌드/린트/테스트**: `npm run verify` 로 실행되며, CI 워크플로가 typecheck·lint·
>    전체 Vitest·양방향 빌드·CSP 스캔·에셋 대조·Playwright·Deno Edge 테스트를 돌립니다.

---

## 1. 테스터 정의 (Tester Roles)

- **사용자 A (기록 작성자)**: 1:1 커플 공간의 곰신 (Active Member JWT)
- **사용자 B (연결된 상대방)**: 사용자 A와 연결된 active 상태의 군화 (Active Member JWT)
- **사용자 C (제3자)**: A/B와 아무 관련이 없는 별도 서비스 가입자 (Third-Party JWT)
- **사용자 D (연결 해제 구 상대방)**: 사용자 A와 과거에 연결되었다가 `status = 'disconnected'` 상태가 된 구 상대방 (JWT 보유)

---

## 2. 서버 DB RLS 필수 보안 요구사항 (Supabase 연동 시 강제)

실제 서버 DB 및 Storage 연동 시 아래 규칙이 RLS(Row Level Security)로 강제되어야 합니다.

1. **작성자 A**: 자신의 모든 기록(`is_private = true` 및 `false`) CRUD 가능.
2. **연결된 상대 B**: A의 `is_private = false` shared 기록만 SELECT 가능 (private 기록 SELECT/UPDATE/DELETE 절대 불가).
3. **제3자 C**: A/B의 couple, records, summaries, attachment metadata 접근 전면 차단.
4. **연결 해제 구 상대 D**: `status = 'disconnected'` 전환 즉시 A의 기존 및 신규 shared 기록/Signed URL 접근 전면 차단.
5. **Storage**: Private Bucket `couple-media` 경로에 대해 DB RLS와 동일한 Signed URL 접근 정책 강제.

---

## 3. 종합 보안 테스트 시나리오 Matrix

| ID | 영역 / 목적 | 사전 조건 | 수행 절차 및 검증 항목 | 기대 결과 | 상태 (상세) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH-01** | Magic Link 인증 | 미인증 상태 | `signInWithOtp({ email })` 호출 및 콜백 수신 | JWT 세션상 `auth.uid()` 생성 | **코드 검증 / 실제 이메일 왕복 미검증** |
| **AUTH-02** | OAuth provider 가용성 | 원격 Auth 설정 조회 | 활성 provider만 버튼 노출; Google 콜백 수행 | 미설정 provider 숨김, Google은 실제 OAuth로 이동 | **자동 검증 / 실제 계정 왕복 미검증** |
| **AUTH-03** | service_role 누출 검사 | 번들/코드 검사 | 프론트엔드 번들, VITE 환경변수, Git 이력 검색 | `service_role` 키 부재 확인 | **통과** (코드베이스 안전) |
| **API-01** | REST API direct 조회 (A) | A 로그인 | A가 REST API로 자신의 private/shared records SELECT | 정상 HTTP 200 OK | **미실행** (서버 미연동) |
| **API-02** | REST API direct 조회 (B) | B 로그인 | B가 REST API로 A의 shared records SELECT | 정상 HTTP 200 OK | **미실행** (서버 미연동) |
| **API-03** | Direct private 조회 차단 (B) | B가 private ID 인지 | B가 A의 `is_private=true` record ID로 직접 SELECT | 0 rows returned (RLS 차단) | **미실행** (서버 미연동) |
| **API-04** | Direct API 접근 차단 (C) | C 로그인 | C가 A/B의 couple_id로 records/couples DIRECT SELECT | 0 rows returned (RLS 차단) | **미실행** (서버 미연동) |
| **API-05** | 위조 INSERT 방어 (C) | C 로그인 | C가 `user_id = A_uid`, `couple_id = A_couple`로 INSERT 시도 | RLS WITH CHECK 실패 (403/Exception) | **미실행** (서버 미연동) |
| **API-06** | 연결 해제 D direct 접근 차단 | status='disconnected' | D가 과거 A의 shared record ID로 SELECT 시도 | 0 rows returned (RLS 차단) | **미실행** (서버 미연동) |
| **INV-01** | 초대 코드 해시 저장 | 초대 코드 생성 | DB `invitation_codes` 테이블 직접 조회 | `code_hash` (SHA-256) 저장, 평문 없음 | **미실행** (서버 미연동) |
| **INV-02** | 초대 코드 평문 조회 차단 | B 로그인 | B가 `invitation_codes` SELECT 시도 | RLS 0 rows returned | **미실행** (서버 미연동) |
| **INV-03** | 초대 코드 만료/1회 사용 | 만료/사용한 코드 | RPC `consume_invitation(hash)` 재실행 | `Invalid or expired` 예외 | **미실행** (서버 미연동) |
| **INV-04** | 초대 코드 경쟁 조건 (Race Condition) | 2개 요청 동시 전송 | 2명이 동시 `consume_invitation(hash)` 실행 | 1명만 성공, 1명 거절 (ATOMIC) | **미실행** (서버 미연동) |
| **STOR-01** | Storage Direct Public Access | Public URL 요청 | `couple-media` 객체 URL 직접 GET | HTTP 403 Forbidden | **미실행** (Storage 미연동) |
| **STOR-02** | Signed URL 발급 (B shared) | A shared 사진 | B가 Signed URL 발급 요청 | 정상 Signed URL 발급 (1시간) | **구현 완료 / 실측 미검증** (`records.ts:92`, `SIGNED_URL_TTL_SECONDS`) |
| **STOR-03** | Signed URL 차단 (B private) | A private 사진 | B가 A의 private 미디어 Signed URL 요청 | 발급 거부 (HTTP 403 / Error) | **구현 완료 / 실측 미검증** (Storage 정책 `007`, 경로 제약 `015`) |
| **STOR-04** | Signed URL 차단 (D 구상대) | status='disconnected' | D가 A의 이전 shared 미디어 Signed URL 요청 | 발급 거부 (HTTP 403 / Error) | **구현 완료 / 실측 미검증** (Storage 정책 `007`, 멤버십 정합성 `008`/`015`) |
| **DEL-01** | 계정 완전 삭제 Edge Function | 탈퇴 요청 | Edge Function `deleteUser` 실행 | Auth, Profile, Records, Storage 순삭 | **구현 완료 / 배포·실측 미완** (`supabase/functions/delete-account/`, Deno 테스트 `entrypoint_test.ts`) |
| **UI-01** | 390px / 1280px 반응형 프레임 | 모바일/데스크톱 | 390px 뷰포트 및 1280px 화면 중앙 430px 프레임 확인 | 깨짐 없이 44px 터치 영역 유지 | **통과** (UI 검증 완료) |
| **UI-02** | 서버 데이터 새로고침 복원 | 실제 계정 로그인 | 기록 추가·동기화 후 브라우저 F5 새로고침 | 서버에서 동일 기록 복원 | **자동 검증 / 실제 계정 수동 검증 필요** |
| **UI-03** | private 달력 마커 차단 | A가 private 작성 | 연결된 실제 B 계정에서 달력 dot, 카운트, 타임라인 확인 | B 화면과 API 모두 비노출 | **코드 검증 / 2계정 실측 필요** |
| **BLD-01** | npm run build & lint & test | 개발 CLI 또는 CI | `npm run verify` (typecheck → lint → 전체 Vitest → 빌드) | 전 단계 exit 0 | **통과** (CI 워크플로가 매 PR 에서 실행) |

---

## 4. 세부 보안 구현 지침 (Supabase 연동 시)

### 1) access token 클라이언트 저장 규칙
- access token 및 refresh token은 브라우저 `localStorage`에 무단 저장하지 않으며, Supabase SDK의 `autoRefreshToken` 및 `persistSession` 메모리/쿠키 관리를 따릅니다.

### 2) 초대 코드 Brute Force 방어
- 초대 코드는 6자리 숫자(100,000가지 조합)이므로, 연속 시도를 방어하기 위해 Supabase Edge Function 또는 RPC 내에 **IP/User 당 분당 5회 실패 시 15분 차단 Rate Limiting**을 적용해야 합니다. (파일럿 전 필수 구현 항목).

### 3) OAuth Identity Linking (계정 병합)
- 이메일이 같다는 이유만으로 Magic Link, Google OAuth, Apple OAuth identity를 조용히
  병합하지 않습니다. 계정 연결은 로그인된 사용자가 `로그인 방법 연결`을 명시적으로 시작하고
  재인증한 경우에만 허용하는 것이 V5 계약입니다.
- 이 목표 경계는 Apple만이 아니라 Google·email을 포함한 모든 로그인 방법 조합에 적용합니다.
  다만 기존 Google/email 사용자 경로를 복구 계획 없이 즉시 끄지는 않습니다. 현재 원격 자동
  연결 동작과 기존 identity 충돌은 `UNVERIFIED`이며 별도 auth migration gate에서 측정합니다.
- managed Supabase에서 동일 verified-email OAuth identity의 자동 연결을 안전하게 끄는 공식
  지원이 확인되고 staging 두 계정 negative test가 통과하기 전에는 Apple provider와 CTA를
  활성화하지 않습니다. 클라이언트 사전 확인이나 Auth hook은 이미 일어난 서버 병합을 되돌리는
  보안 경계로 취급하지 않습니다.
- 필수 negative test: 동일 이메일의 서로 다른 기존 계정, Apple private relay email, 이미 다른
  계정에 연결된 Apple identity, 연결 취소, 재인증 실패, unlink 후 재로그인, 계정 삭제 중 Apple
  token revoke 실패·재시도. 하나라도 미검증이면 Apple Production 활성화는 `HOLD`입니다.
