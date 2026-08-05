# 곰신로그 (곰신로그) 파일럿 가이드 & 운영 체크리스트

본 문서는 **`곰신로그` (군화와 곰신을 위한 1:1 비공개 데일리 로그 서비스)**의 비공개 파일럿(Pilot) 테스트 운영자를 위한 지침서 및 개인정보 수칙입니다.

---

## 1. 파일럿 목적 및 검증 가설

### 1) 핵심 가설
> "곰신이 하루 중 생각날 때 부담 없이 남긴 사진, 짧은 영상, 음성, 한 줄 기록들이
> 저녁 통화 전 군화에게 시간순 타임라인으로 전달되어,
> 제한된 연락 시간에도 서로의 하루를 놓치지 않고 이어 보게 하는가?"

### 2) 핵심 제품 경험 루프
1. **기록자 (곰신)**: 하루 중 사진, 짧은 영상, 음성, 한 줄 기록을 2~3터치로 편하게 남김.
2. **확인자 (군화)**: 폰을 받거나 접속 가능한 시간에 상대의 하루를 시간순 타임라인으로 확인.
3. **오늘의 빠른 정리**: 원문을 대신하는 AI 브리핑이 아니며, 군화가 하루를 빠르게 훑도록 돕는 **작은 보조 정리 카드**.
4. **원문 스크롤 & 하이라이트**: 빠른 정리 문장을 누르면 타임라인의 해당 원본 위치로 스크롤되어 1~2초간 강조됨.
5. **소통 루프**: 기록 → 확인 → 자연스러운 통화 대화로 이어짐.

---

## 2. 수집 · 이용 · 보관 · 삭제 체크리스트

| 구 분 | 수집 항목 / 내용 | 수집 여부 및 관리 원칙 | 현재 코드 구현 상태 |
| :--- | :--- | :--- | :--- |
| **필수/선택 수집** | 닉네임, 사귄 날짜(`anniversaryDate`), 군종, 입대일, 예상전역일, 연락 가능 시간, 텍스트 로그, 미디어 메타데이터 | **최소 수집** (가명/별명 권장) | 서버 저장 + `LocalStorageRepository` 캐시 (`src/lib/sync.ts`, `src/lib/store.tsx`) |
| **절대 미수집** | **실명, 성별, 생년월일, 부대명, 계급, 군번, 부대 위치** | **절대 수집하지 않음 🚫** | 온보딩/프로필 폼에서 배제 |
| **이용 목적** | 1:1 커플 간 일상 로그 공유, 복무 진행률 표시, 빠른 정리 내비게이션 | 목적 외 활용 금지 | 목적 내 전용 작동 확인 |
| **프라이버시** | `is_private = true` (나에게만) 기록 처리 | 작성자 본인만 조회, 상대 타임라인 및 요약 제외 | **서버 RLS + 클라이언트 재필터 구현 완료** (`005`/`009`/`014` 마이그레이션, `src/lib/privacy.ts`). 원격 적용 상태는 `supabase/migrations/README.md` 참조 |
| **커플 연결 해제** | 커플 상호 관계 종료 (`disconnect`) | 상대방 즉시 접근 차단, 내 아카이브 유지 | RPC `disconnect_couple` 연동 완료 (`src/lib/supabase.ts`), 경합 차단은 `015` |
| **계정 삭제** | 계정 및 데이터 완전 삭제 요청 | Auth user, profile, storage, records 순삭 | **Edge Function 구현 완료** (`supabase/functions/delete-account/`, Deno 테스트 포함) — **배포는 사람이 실행** (`supabase functions deploy delete-account`) |

---

## 3. 온보딩 분기 UX 가이드

* **곰신 역할**:
  - Step 1 (역할) -> Step 2 (닉네임) -> Step 3 (우리 공간) -> Step 4 (사귄 날짜).
  - 복무 정보 및 연락 가능 시간 입력 폼은 자동 스킵되며 *"연결된 군화가 직접 입력할 수 있어요"* 안내 제공.
* **군화 역할**:
  - Step 1 (역할) -> Step 2 (닉네임) -> Step 3 (우리 공간) -> Step 4 (사귄 날짜) -> Step 5 (복무 정보) -> Step 6 (연락 가능 시간).
  - 복무 정보: 군종(7종), 상태(5종), 입대일, 예상전역일 (자동계산 + 수동수정).
  - 연락 가능 시간: *"주로 언제 오늘의 로그를 확인할 수 있나요?"* (평일/주말 시간).
* **날짜 분리**:
  - `anniversaryDate` (사귄 날짜)와 `enlistmentDate` / `expectedDischargeDate` / `dischargeDate` (복무 날짜)는 철저히 분리된 필드로 저장.

---

## 4. 현재 구현 상태 및 미검증 항목 표 Summary

> **갱신 규칙**: 이 표의 모든 행은 **파일:줄 근거와 함께** 적습니다. 근거 없이 "구현됨" /
> "미구현" 을 쓰지 마세요. 이 표는 한때 Storage 업로드·Signed URL·계정 삭제 Edge Function 을
> "미구현" 으로 적어두고 있었고, 그 세 가지는 이미 코드에 있었습니다. 파일럿 go/no-go 를
> 그 표로 판단하면 틀립니다.
>
> "**구현 완료**" 와 "**원격 적용/실측 완료**" 는 다른 축입니다. 코드가 있어도 마이그레이션이
> 적용되지 않았거나 함수가 배포되지 않았으면 파일럿에서 동작하지 않습니다. 원격 적용
> 상태의 단일 출처는 `supabase/migrations/README.md` 입니다.

| 구분 | 기능 / 정책 | 상태 | 근거 / 비고 |
| :--- | :--- | :--- | :--- |
| **구현 완료** | 오프라인 캐시 (`LocalStorageRepository`) | **완료** | `src/lib/store.tsx` — private 기록은 로컬에 본문/첨부 없이 저장 |
| **구현 완료** | 곰신/군화 6단계 분기 온보딩 | **완료** | `src/pages/OnboardingPage.tsx` |
| **구현 완료** | 빠른 정리 -> 원문 스크롤 & 하이라이트 | **완료** | 1~2초 펄스 애니메이션 |
| **구현 완료** | 기록 아카이브 & 월간 달력 | **완료** | 월 이동, 날짜별 타임라인, 미디어 필터 |
| **구현 완료** | `is_private = true` 격리 | **완료** | 서버 RLS (`005`/`009`/`014`) + 클라이언트 재필터 `src/lib/privacy.ts` |
| **구현 완료** | 커플 연결 해제 (`disconnect`) | **완료** | RPC `disconnect_couple` (`src/lib/supabase.ts`), 경합 차단 `015` |
| **구현 완료** | Storage 미디어 업로드 (비공개 버킷) | **완료** | `src/lib/records.ts:378` — 버킷 `couple-media`, 경로 `{couple_id}/{record_id}/{파일명}` |
| **구현 완료** | Signed URL 발급 | **완료** | `src/lib/records.ts:92` — TTL 1시간 (`SIGNED_URL_TTL_SECONDS`) |
| **구현 완료** | MIME 판별 / 용량 제한 | **완료** | `src/lib/records.ts` `classifyMediaFile` + `MAX_BYTES` (타입별), 테스트 `src/lib/records.test.ts` |
| **구현 완료** | 계정 완전 삭제 Edge Function | **완료** | `supabase/functions/delete-account/` + `entrypoint_test.ts` (실제 Deno 테스트) |
| **구현 완료** | 빌드 / 린트 / 테스트 검증 | **완료** | `npm run verify`. CI 워크플로가 typecheck·lint·전체 Vitest·양방향 빌드·CSP·에셋·Playwright·Deno 를 실행 |
| **사람이 실행 필요** | 마이그레이션 `016`·`017` 원격 적용 | **미적용** | `supabase/migrations/README.md` — 적용 후 PostgREST 스키마 캐시 리로드 필수 |
| **사람이 실행 필요** | `supabase functions deploy delete-account` | **미배포** | `SUPABASE_SERVICE_ROLE_KEY` 를 함수 환경변수로 설정해야 함 |
| **미검증** | Google / Apple OAuth 실제 콜백 | **미검증** | Client ID 미설정. 코드 경로는 `src/pages/AuthCallbackPage.tsx` 에 존재 |
| **미검증** | 실제 두 계정 종단 시나리오 | **미검증** | 절차: `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` |
