# 실물 iPhone iOS 27 UIScene 수정 빌드 검증

- 날짜: 2026-08-27
- 브랜치: `codex/profile-post-composer`
- 검증 commit: `34b6e4c1b8817abdfa39a1e4497a252591cde257`
- 판정: **PHYSICAL LAUNCH PASS / AUTH COMPLETION UNVERIFIED / PRODUCTION NOT APPLIED**

## DIRECTION CHECK

- Product source checked: `docs/WHAT_IS_GOMSINLOG.md`, `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 제품·고객·AI·과금·저장 전략 변경 없음
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`, `docs/APP_STORE_RELEASE_PLAN_2026-08-25.md`, `docs/skills/README.md` release-validation
- Current-state checked: live branch/HEAD/status, physical device connection/lock/developer mode, Xcode destinations, installed app/process/screenshots
- Latest relevant Work Log checked: 2026-08-27 iOS 27 UIScene 검정 화면 진단 및 로컬 수정
- Does this task conflict with canonical direction? NO

## 수행 범위

- 연결 기기: iPhone 16 Pro, iOS 27.0 beta, Developer Mode enabled, wired/paired
- 빌드: `/Users/han-yejun/Downloads/Xcode-27-Beta.app`, Xcode 27.0 build `27A5252f`, iPhoneOS 27.0 SDK
- 앱: `app.gomsinlog`, version 0.1.0, build 1
- 기존 앱 삭제 없이 설치를 시도했으나 설치 전 CoreDevice 앱 목록에는 `app.gomsinlog`가 없었다. 설치 후 developer app과 container access가 정상 확인됐다.

## 실제 결과

- `npm run build`: PASS, 2,165 modules
- `npx cap sync ios`: PASS, five plugins
- Xcode 27 signed Debug physical-device build: PASS, exit 0
- code signature verification: PASS
- `devicectl device install app`: PASS
- 첫 실행: PASS, 앱 process 생존 및 온보딩 실제 렌더, 검정 화면 재발 없음
- terminate-existing 후 재실행: PASS, 새 process 및 동일 온보딩 실제 렌더
- 30초 이상 안정성 확인: PASS, process 생존 및 설치 앱 0.1.0(1) 확인
- cold-start `gomsinlog://auth/callback?error=access_denied`: PASS, 상단 오류 토스트 표시. 진행 중 통화 Dynamic Island가 문구 일부를 가렸으므로 exact copy visual 판독은 제한됨
- Google OAuth: PASS to provider entry only — 시스템 브라우저가 `accounts.google.com`까지 진입
- Google 계정 선택, Supabase callback/session 완결: UNVERIFIED — 개인정보 자동 입력 금지
- Apple OAuth, 두 계정 연결, Foundation Models, Secure Enclave, airplane mode: UNVERIFIED

## 개인정보 및 상태 보호

- 홈 화면과 실물 기기 screenshot은 개인 배경화면·앱·통화 상태를 포함하므로 저장소나 보고서에 복사하지 않고 `/tmp`에만 남겼다.
- 실제 OAuth 계정 선택이나 credential 입력을 자동화하지 않았다.
- 앱 삭제, 데이터 container 제거, Supabase/Auth/Vercel/Apple/TestFlight/Production mutation을 하지 않았다.
- callback test는 `access_denied` 고정 오류만 사용해 원격 session을 바꾸지 않았다.

## 경고와 남은 gate

- Xcode 27 build는 기존 Capacitor/Cordova deprecated API 경고와 `[CP] Embed Pods Frameworks` no-output 경고가 있었지만 exit 0이다.
- Google 실제 로그인 완료와 PKCE callback, Apple provider, 두 계정 user-flow는 별도 실기기 검증이 필요하다.
- 이 빌드는 normal production bundle을 사용한 signed Debug 검증이며 strict release artifact, Archive, TestFlight, App Store 증거가 아니다.
- rollback은 기기에서 이 development app을 제거하는 것이지만 container data가 삭제될 수 있으므로 사용자 승인 없이 수행하지 않는다.
