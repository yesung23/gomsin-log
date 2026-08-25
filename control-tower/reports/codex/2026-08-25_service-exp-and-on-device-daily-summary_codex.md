# 복무 EXP·iPhone 온디바이스 하루 요약 구현 및 검증

- 기준일: 2026-08-25
- 저장소: `/Users/han-yejun/Desktop/곰신로그`
- 구현 commits: `bfc7423fe77d78bd3fc52896f73968e4d3d541f6`, Unicode follow-up `483e085`
- 출시 범위: iPhone App Store 우선, Android는 기존 웹/PWA, Google Play 후속
- Production flag: `VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED` 기본 OFF
- 원격 변경: Supabase/Vercel/Auth/배포 **NOT APPLIED**

## 1. 최종 판정

**CONDITIONAL PASS — 로컬 구현·회귀·simulator compile은 통과했지만 App Store 출시 완료가 아니다.**

지원 iPhone 실기기, Apple OAuth, 원격 060→061 actor matrix, signed TestFlight,
production 환경변수·배포·두 계정 smoke가 아직 끝나지 않았다. Sol 독립 검토 결과는 이 문서의
후속 갱신 전까지 최종 보안 승인으로 간주하지 않는다.

## 2. 현재 실제 구현된 기능

### 복무 EXP

- 실제 입대일·전역일을 `Asia/Seoul` 기준으로 계산한다.
- 기본 화면에는 현재 7단계 등급, 다음 목표, 실시간 EXP만 보인다.
- 전체 7단계는 44px `전체 단계` disclosure를 눌렀을 때만 DOM에 렌더링된다.
- 이 값은 실제 행정 진급·관계 점수·애정 점수·보상·랭킹이 아니다.

### iPhone 온디바이스 하루 요약

- 상대의 오늘 스토리에서 기존 규칙 요약을 먼저 즉시 렌더링한다.
- active couple, 상대 작성, 공개, 읽기 가능, 저장 완료, 오늘 한 날짜의 기록만 사용한다.
- 시간순 최대 5개이며 네이티브 payload는 `{ index, text }`뿐이다.
- iOS 26+ Foundation Models, 한국어 locale, 모델 availability를 확인한다.
- 매 요청마다 transcript 없는 새 `LanguageModelSession`을 만들고 tool은 쓰지 않는다.
- guided output을 JavaScript에서 count/order/index/length로 다시 검증한다.
- 미지원·오류·4초 전체 timeout·취소·stale response·검증 실패는 규칙 결과를 유지한다.
- 요약 줄을 누르면 배열 index가 아니라 exact record ID의 원본 카드가 열리고, 원본 기록 route로
  이동하는 기존 경로도 유지된다.

## 3. 확인된 결함과 심각도

- P1: **Apple 로그인 비활성.** Google 로그인이 있는 iOS 앱의 App Store 제출 전 4.8 gate.
- P1: **원격 migration 060/061 미적용.** 파트너 username 새로고침 경로가 원격에서 완성되지 않음.
- P1: **지원 iPhone 실기기 검증 없음.** 모델 품질·네트워크 0·발열·배터리를 simulator로 증명할 수 없음.
- P2: **Supabase native redirect가 query-aware PKCE callback을 허용하는지 미검증.** 현재 등록값은
  query 없는 `gomsinlog://auth/callback`만 live 확인됨.
- P2: **Vercel production 환경과 exact SHA 미검증.** CLI 로그인이 없어 지원 이메일과 feature flag,
  실제 배포 commit을 확인하지 못함.
- P2: **signed archive/TestFlight 미검증.** unsigned simulator build는 서명·entitlement·실기기 runtime 증거가 아님.

## 4. 각 결함의 파일·함수·근거

- `src/lib/platform.ts`, `src/lib/oauthPkce.ts`, `src/lib/deepLinks.ts`: native callback은 PKCE
  flow ID와 code만 허용한다. Supabase redirect allowlist는 원격 설정이므로 코드 테스트만으로 완료 아님.
- `supabase/migrations/060_partner_username_projection.sql`,
  `061_reject_null_partner_profile_actor.sql`: 저장소와 fresh-chain에는 있지만 원격 함수가 없음.
- `packages/capacitor-on-device-summary/`: compile/wiring은 확인했으나 physical model 실행은 미확인.
- `src/pages/OnboardingPage.tsx`: Apple OAuth UI/call path는 존재하나 remote Apple provider가 disabled.
- `src/pages/LegalPage.tsx`: 지원 이메일은 `VITE_PRIVACY_CONTACT_EMAIL`에 의존하며 production 값 미확인.

## 5. 실행한 테스트와 정확한 결과

- focused daily-summary/story/native: **PASS — 9 files / 185 tests**
- `npm run typecheck`: **PASS**
- 대상 ESLint: **PASS**
- `git diff --check`: **PASS**
- `LANG=en_US.UTF-8 npm run verify`: **PASS**
  - typecheck PASS
  - full lint PASS
  - Vitest **243 files / 3470 tests PASS**
  - production web build **2161 modules PASS**
  - 500kB chunk warning만 존재
- `npm run test:phase0`: **PASS — 59 migrations / 344 actor-security assertions**
- unsigned iOS Simulator `xcodebuild`: **PASS — BUILD SUCCEEDED**
- Gemini 3.7 Flash High native permission docs focused: **PASS — 3 files / 79 tests**

## 6. 실행하지 못한 테스트와 이유

- 지원 iPhone Foundation Models 실제 생성: **BLOCKED — 연결된 물리 iPhone offline**
- airplane mode 네트워크 0 관찰: **BLOCKED — 실기기 없음**
- cold/warm latency, 발열, 배터리: **BLOCKED — 실기기 없음**
- Apple/Google OAuth 실제 native 왕복: **BLOCKED — Apple provider disabled, redirect 보강 전**
- signed archive/TestFlight: **UNVERIFIED — signing/TestFlight gate 미실행**
- authenticated two-account production smoke: **UNVERIFIED — exact production 배포와 원격 DB gate 전**

## 7. 원격 Supabase·Vercel·브라우저 검증 상태

- Supabase project health: live 확인 시 ACTIVE_HEALTHY.
- Remote catalog: 057–059 대상 객체 존재, 060 projection 함수 없음, 061 미적용.
- Remote migration ledger: 비어 있음. `supabase db push` 금지.
- Supabase Auth: Google/Email enabled, Apple disabled; native/web callback 기본 URL은 등록됨.
- Vercel: CLI unauthenticated로 production env/deploy exact SHA **BLOCKED**.
- 브라우저/실기기: local tests와 simulator compile만 PASS; physical iPhone **BLOCKED**.

## 8. 가장 작은 수정안

1. Sol 독립 보안 검토 finding을 먼저 닫는다.
2. backup/catalog 재확인 후 exact 060 → 061만 순서대로 적용한다.
3. PostgREST reload 후 owner/active/former/unrelated/anon actor matrix를 실행한다.
4. Apple provider와 query-aware native redirect를 설정하고 실제 iPhone PKCE 왕복을 확인한다.
5. 지원 iPhone에서 온디바이스 품질 gate를 통과할 때만 production flag를 켠다.
6. exact SHA를 배포하고 두 계정 production smoke 후 TestFlight로 간다.

## 9. 수정하지 말아야 할 사항

- Google Play/Android native AI
- iCloud/CloudKit을 공통 source of truth 또는 파트너 공유 경로로 만드는 것
- 서버 AI fallback, summary DB/cache/migration
- AI 중요 기억 선정, 감정·건강·관계 판단
- 실기기 증거 전 feature flag 기본 ON
- migration ledger가 빈 원격에 전체 history push
- 음성 녹음/업로드 재활성화

## 10. 다음 작업 순서

```text
Sol exact-commit review
→ 원격 060/061 안전 적용 및 actor 검증
→ Apple Auth/redirect 실기기 PKCE
→ Foundation Models 한국어·offline·성능 실기기 gate
→ exact production deploy + 두 계정 smoke
→ signed archive/TestFlight
→ App Store metadata/privacy/review notes
→ 제출
```

상세 단계표는 `docs/APP_STORE_RELEASE_PLAN_2026-08-25.md`가 소유한다.
