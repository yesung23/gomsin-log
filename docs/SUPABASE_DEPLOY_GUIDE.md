# 곰신로그 Supabase 배포 및 운영 가이드

본 문서는 **`곰신로그` (군화와 곰신을 위한 1:1 비공개 데일리 로그 서비스)**의 Supabase 백엔드 연동, 데이터베이스 마이그레이션, RLS 보안 정책, Storage 설계, 및 웹 호스팅(Vercel/Netlify) 배포 절차를 안내하는 운영 문서입니다.

---

## 1. 문서 목적 및 전제 조건

### 1) 데모 모드와 실연동 모드의 차이
* **데모 모드 (`LocalStorageRepository`)**:
  - Supabase 환경변수(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)가 설정되지 않은 경우 자물쇠/안내 바와 함께 즉시 오프라인 로컬 데모 모드로 작동합니다.
  - 클라이언트 브라우저의 `localStorage` (`gomsinlog.state.v1`)에 데모 데이터가 보관되며, **비공개 필터링은 UI 레벨의 모의 격리**입니다.
* **실연동 모드 (`SupabaseAuthRepository` / `SupabaseLogRepository`)**:
  - 실제 Supabase 프로젝트 생성 후 환경변수 설정, SQL 마이그레이션 실행, OAuth Provider 등록, RLS 보안 검증이 모두 완료된 후 활성화됩니다.
  - **주의**: DB RLS 정책이 배포되어야만 작성자 외 private 기록 SELECT/UPDATE/DELETE 차단이 서버 수준에서 강제됩니다.

---

## 2. Supabase 프로젝트 생성 및 설정

1. **프로젝트 생성**:
   - [supabase.com](https://supabase.com) 접속 후 New Project 생성.
   - **권장 리전**: `ap-northeast-2` (Seoul).
   - **DB 비밀번호**: 강력한 비밀번호를 생성하고 안전한 키 관리소에 별도 보관 (코드/Git 금지).
2. **플랜 요금 안내**:
   - 서비스 규모에 따른 정확한 요금은 [Supabase Pricing 공식 페이지](https://supabase.com/pricing)를 직접 참조해야 합니다.

---

## 3. 환경변수 관리 규칙

루트 디렉터리의 `.env` 파일에 작성합니다 (`.env.example` 참조):

```env
# 프론트엔드 공개 환경변수 (브라우저 번들에 포함됨)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

### 보안 준수 사항
- `.env`, `.env.local` 파일은 반드시 `.gitignore`에 등록하여 Git 저장소에 커밋되지 않도록 합니다.
- `service_role` 키, DB 비밀번호, OAuth Client Secret은 **프론트엔드 코드, `.env`, VITE_ 환경변수에 절대 넣지 않습니다.**
- `service_role` 키는 서버 측 Edge Function Secrets 관리 공간에만 보관합니다.

---

## 4. 데이터베이스 마이그레이션 (DB Migration)

### 1) 마이그레이션 파일 정보
- **파일명**: `supabase/migrations/001_initial_schema.sql`

### 2) 적용 스키마 구조
- `profiles`: `id (auth.uid())`, `display_name`, `role ('gomsin' | 'soldier')`, `avatar_path`, `onboarding_completed_at`
- `couples`: `id`, `anniversary_date (nullable)`
- `couple_members`: `couple_id`, `user_id`, `role`, `status ('pending' | 'active' | 'disconnected')` (제약: 커플당 active 2명 제한, 유저당 active 1개 제한)
- `invitation_codes`: `id`, `couple_id`, `code_hash (SHA-256)`, `created_by`, `expires_at (24hr)`, `used`
- `daily_records`: `id`, `user_id`, `couple_id`, `record_date`, `record_time`, `log_text`, `reaction`, `attachments`, `is_private (default false)`
- `briefings`: `id`, `couple_id`, `recipient_id`, `briefing_date`, `summary_items`
- `contact_preferences`: `user_id`, `weekday_start/end`, `weekend_start/end`

### 3) 실행 방법
* **방법 A: Supabase CLI (권장)**
  ```bash
  npx supabase db push
  ```
* **방법 B: Dashboard SQL Editor**
  `supabase/migrations/001_initial_schema.sql` 전문을 복사하여 Supabase 대시보드 SQL Editor에 붙여넣고 Run 실행.

---

## 5. 인증 (Authentication) 설정 (현재 상태: 미검증)

1. **Email Magic Link (비밀번호 없는 로그인)**:
   - Dashboard → Authentication → Providers → Email 활성화.
2. **Google OAuth / Apple OAuth**:
   - Client ID / Secret 생성 후 Supabase Dashboard 입력 (자격증명 미설정 시 미검증).

---

## 6. Storage (미디어 파일) 아키텍처 (구현 완료 / 원격 실측 미검증)

> **현재 코드 구현 상태**: 업로드·Signed URL·MIME/용량 제한이 모두 구현되어 있습니다.
> - 업로드: `src/lib/records.ts:378` — 버킷 `couple-media`
> - Signed URL: `src/lib/records.ts:92` — TTL 1시간 (`SIGNED_URL_TTL_SECONDS`)
> - MIME 판별 / 용량 제한: `classifyMediaFile` + `MAX_BYTES` (첨부 타입별), 테스트
>   `src/lib/records.test.ts`, 실패 경로 테스트 `src/lib/recordMediaFailures.test.ts`
>
> 이 절은 한때 "파일럿 전 필요 (미구현)" 이라고 적혀 있었습니다. 남은 것은 실제 프로젝트에
> 버킷·정책(`007`)을 적용하고 두 계정으로 실측하는 일입니다(`docs/SECURITY_TEST_PLAN.md`
> STOR-01~04).

### 1) 버킷 설계 원칙
- **Public Bucket 사용 금지**: 사진, 동영상, 음성은 1:1 커플 비공개 자산이므로 **Private Bucket**으로 구성합니다.
- **버킷명**: `couple-media`

### 2) Storage 경로 구조
```text
couple-media/{couple_id}/{record_id}/{attachment_id}.{extension}
```

### 3) 접근 권한 및 Signed URL
- DB `daily_records`에는 Public URL 대신 `storage_path` 메타데이터만 저장합니다.
- 클라이언트 렌더링 시 권한을 확인하고 1시간 수명의 **Signed URL**을 발급받아 표시합니다.
- `is_private = true` 기록의 미디어는 작성자 본인만, `is_private = false` 기록의 미디어는 active 커플 멤버 2명만 접근 허용.
- 커플 연결 해제(`status = 'disconnected'`) 후에는 상대방의 이전 미디어 접근도 차단됩니다.

---

## 7. 계정 삭제 및 연결 해제 동작 구분

| 구분 | 커플 연결 해제 (`disconnect`) | 계정 삭제 (회원 탈퇴) |
| :--- | :--- | :--- |
| **목적** | 상대방과의 1:1 관계 종료 | 서비스 이용 완전 종료 |
| **영향 범위** | `couple_members.status = 'disconnected'` 전환. 내 아카이브 유지. | Auth User, Profile, Records, Storage 객체 완전 삭제 |
| **상대방 변경** | 즉시 상대방의 렌더링 타임라인 및 빠른 정리에서 제외. | 상대방 화면에서 가명/연결 해제 표시 |
| **서버 구현** | RPC `disconnect_couple()` 실행 | **Edge Function 구현 완료** (`supabase/functions/delete-account/`) — 배포는 사람이 실행: `supabase functions deploy delete-account` |

> **Edge Function 계정 삭제 처리 순서**:
> 1. Storage `couple-media` 내 작성자 객체 삭제
> 2. 작성자 `daily_records` 및 `briefings` 삭제
> 3. `couple_members` 및 `profiles` 행 삭제
> 4. `auth.admin.deleteUser(user_id)` 실행 (`service_role` 전용)

---

## 8. 배포 후 검증 및 빌드 참고

- **빌드 실행**: `npm run build` (`tsc -b && vite build`)
- **환경변수 필수**: `VITE_SUPABASE_URL` 과 `VITE_SUPABASE_PUBLISHABLE_KEY`(또는
  `VITE_SUPABASE_ANON_KEY`) 없이는 **빌드가 의도적으로 실패**합니다. 설정이 없는 채로
  영구 데모 모드 산출물이 나가는 것을 막기 위한 가드입니다(`build/buildEnv.ts`).
  URL 은 파싱 가능해야 하고 `localhost`/`127.0.0.1` 을 제외하면 https 여야 합니다.
- **검증 명령**: `npm run verify` (typecheck → lint → 전체 Vitest → 빌드). CI 워크플로가
  매 PR 에서 이 게이트에 Playwright(실브라우저 커플 매트릭스), Deno Edge 테스트, CSP 스캔,
  에셋 대조, 의존성 감사 allowlist 를 더해 실행합니다.

### ⚠️ 보안 헤더는 호스팅 플랫폼에 따라 적용 방식이 다릅니다

CSP 를 포함한 보안 헤더는 `public/_headers` 에서 나가고, 빌드가 `VITE_SUPABASE_URL` 을
그 안의 마커에 치환합니다(치환에 실패하면 빌드가 실패합니다).

| 플랫폼 | `_headers` 인식 | 필요한 조치 |
| :--- | :--- | :--- |
| **Netlify** | O | 없음 |
| **Cloudflare Pages** | O | 없음 |
| **Vercel** | **X** | `vercel.json` 의 `headers` 로 **같은 헤더를 직접 설정해야 합니다.** 하지 않으면 CSP·`X-Frame-Options`·`Permissions-Policy` 가 **전부 적용되지 않습니다.** |

이 문서의 다른 절과 `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` 는 예시로 Vercel 주소를
쓰고 있으므로, 배포 플랫폼을 확정한 뒤 위 표에 따라 조치하세요. 배포 후에는 브라우저
DevTools → Network → 문서 응답 헤더에서 `Content-Security-Policy` 가 실제로 존재하는지
확인하는 것이 유일하게 신뢰할 수 있는 검증입니다.
