# iOS 27 UIScene 검정 화면 진단 및 로컬 수정 보고

- 날짜: 2026-08-27
- 브랜치: `codex/profile-post-composer`
- 기준 HEAD: `45b32586ad24b70188fd2265ab225972c6edf372`
- 판정: **LOCAL PASS / PHYSICAL DEVICE UNVERIFIED / PRODUCTION NOT APPLIED**

## DIRECTION CHECK

- Product source checked: `docs/WHAT_IS_GOMSINLOG.md`, `docs/V4_AS_BUILT.md`, `docs/V4_BACKLOG.md`
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 고객·AI 역할·과금·저장 전략 변경 없음
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`, `docs/APP_STORE_RELEASE_PLAN_2026-08-25.md`, `docs/skills/README.md`의 feature-build, security-review, migration-gate, release-validation
- Current-state checked: repository branch/HEAD/status, `docs/CURRENT_STATE.md`, Xcode 27 simulator 로그와 실제 설치 앱
- Latest relevant Work Log checked: 2026-08-27 App Store RC 통합·게시물 재전송 안전성 최종 검증
- Does this task conflict with canonical direction? NO

## 원인과 수정

Xcode 27 SDK로 만든 기존 앱은 시작 직후 다음 fatal을 내고 웹 뷰를 만들기 전에 중단됐다.

```text
Application failed to launch: UIScene life cycle is required for apps built with this SDK.
```

단일-window scene manifest와 `SceneDelegate`를 추가하고 기존 Main storyboard/Capacitor bridge를 유지했다. scene 전환으로 AppDelegate에 오지 않게 된 cold/foreground custom URL 및 universal link를 Capacitor proxy에 전달했다. cold-start URL은 JavaScript listener 설치 전에 도착하므로 `App.getLaunchUrl()`로 회수하되, 기존 exact-route, PKCE `sb_flow_id`, 직렬화, bounded queue, 중복 방지, 일반화된 오류 처리 경로를 그대로 사용한다. token-pair `setSession` fallback은 추가하지 않았다.

## 변경 파일

- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/Info.plist`
- `ios/App/App/SceneDelegate.swift`
- `src/lib/deepLinks.ts`
- `src/lib/deepLinks.test.ts`
- `src/lib/nativeConfig.test.ts`
- `src/lib/iosPrivacyManifest.test.ts`
- `src/lib/platform.test.ts`

DB, migration, RLS, 암호화, 사용자 기록, 제품 UI, Production 설정은 변경하지 않았다.

## 실제 실행 증거

- 수정 전 iOS 27 및 iOS 26.5 simulator: 검정/빈 화면과 동일 UIScene fatal 재현
- 수정 후 iOS 27 iPhone 16 Pro simulator: 온보딩 렌더 PASS
- 수정 후 iOS 26.5 simulator: 온보딩 렌더 PASS
- iOS 27 cold start `gomsinlog://auth/callback?error=access_denied`: 앱 실행 후 `로그인이 취소되었습니다. 다시 시도해 주세요.` 표시 PASS
- iOS 27 foreground 동일 callback: 같은 사용자 안내 표시 PASS
- 실제 OAuth provider 왕복과 실물 iPhone 수정 빌드: UNVERIFIED

## 검증

- focused Vitest: PASS, 3 files / 117 tests
- cold-start delta Vitest: PASS, 2 files / 53 tests
- `npm run typecheck`: PASS
- 대상 ESLint: PASS
- `npm run verify:native`: PASS, 4 files / 106 tests
- `npm run test:phase0`: PASS, PostgreSQL 17 / 64 migrations / 411 assertions
- `npm run build`: PASS, 2,165 modules
- `npx cap sync ios`: PASS, five plugins
- Xcode 27 unsigned simulator build: PASS, `BUILD SUCCEEDED`, `iphonesimulator27.0`
- `plutil -lint ios/App/App/Info.plist`: PASS
- `git diff --check`: PASS
- 첫 `LANG=en_US.UTF-8 npm run verify`: FAIL, 257/258 files 및 3,729/3,730 tests. 동작 결함이 아니라 `platform.test.ts`의 이전 exact source-string assertion 1건이 새 early-return 표기와 달랐고 build 단계 전 중단됨
- assertion을 의미 보존 형태로 좁게 수정한 뒤 재실행한 `LANG=en_US.UTF-8 npm run verify`: PASS, typecheck/lint, 258 files / 3,730 tests, production build 2,165 modules. keystore 12/12 PASS, 기존 병렬 timeout 재발 없음
- 독립 Gemini 3.1 Pro High read-only review: PASS, finding 없음
- 독립 Gemini 3.7 Flash High final read-only verification: PASS, P1 0 / P2 0; focused Vitest 4 files / 130 tests, native verify 4 files / 106 tests, typecheck, target ESLint, plist lint 및 Xcode workspace build PASS
- Kiro/Sol review: NOT EXECUTED — 모델 경로 오류로 사용할 수 없었으며 사용했다고 주장하지 않음

## 개인정보·보안 불변식

- callback URL, code, plugin error를 로그에 출력하지 않는다.
- custom callback은 정확한 `gomsinlog://auth/callback` 경로와 유효한 `sb_flow_id`를 모두 요구한다.
- session 교환은 authorization code + PKCE만 사용하며 URL token pair fallback이 없다.
- launch URL과 live event가 중복되더라도 동일 code는 한 번만 교환한다.
- Supabase/Auth/Vercel/Apple/DB 원격 상태는 변경하지 않았다.

## 남은 차단 요소와 rollback

- 실물 iPhone을 다시 연결해 수정 빌드의 signed install, 첫 실행, 재실행, Google/Apple OAuth cold/foreground 복귀를 확인해야 한다.
- Supabase Apple provider, redirect allow-list, Distribution/Archive/TestFlight는 별도 release gate다.
- rollback은 이 작업 커밋을 revert하는 것이지만 Xcode 27 빌드에서 검정 화면 fatal을 다시 만들므로, 회귀가 이 변경 자체로 입증된 경우에만 사용한다.
