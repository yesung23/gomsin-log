# Xcode 27 Apple Development 서명·실물 기기 검증

## 판정

**Development signing gate: PASS. App Store release gate: PARTIAL.**

Xcode 27/iOS 27 SDK, 활성 Apple Developer 팀, Apple Development 인증서,
`app.gomsinlog` development provisioning profile을 사용해 iPhone 16 Pro용 signed Debug
build를 재현했다. 앱은 실물 기기에 설치됐고 프로세스 launch와 설치 경로 일치까지 확인했다.

## 적용한 외부 상태

- Apple Development 인증서 1개 생성
- 기존 Development 인증서 유지
- `app.gomsinlog` iOS Team Provisioning Profile 자동 생성
- 연결된 iPhone에 곰신로그 0.1.0(1) development build 설치

Team ID는 추적되는 Xcode 프로젝트에 기록하지 않았다. 저장소가 이미 제공하던 optional
`Config.xcconfig` 경계를 사용해 ignored `ios/App/LocalSigning.xcconfig`에만 두었다.

## 검증

- Xcode 27.0 build `27A5252f`, iOS SDK 27.0: PASS
- physical iPhone 16 Pro CoreDevice `connected`: PASS
- Mac Keychain Apple Development identity: 2 valid
- signed physical-device Debug build: `BUILD SUCCEEDED`
- provisioning profile: `iOS Team Provisioning Profile: app.gomsinlog`
- installed app: 곰신로그 0.1.0(1), bundle `app.gomsinlog`, Developer App
- process launch: PASS
- installed bundle path와 실행 중 `App.app/App` path: exact match
- native config/privacy focused Vitest: 초기 tracked Team ID 위반 2건 FAIL, 교정 후 2 files / 74 tests PASS
- `git diff --check`: PASS
- `LocalSigning.xcconfig`: `git check-ignore` PASS
- final tracked status: 사용자 `.DS_Store` 외 native code/config diff 없음

## 증명하지 않은 것

- 설치된 웹 자산은 Supabase publishable key로 새로 만든 release artifact가 아니다.
- 실제 화면, 로그인, 두 계정 연결, 기록·사진, Apple OAuth를 조작하지 않았다.
- Foundation Models 한국어 품질, airplane mode, timeout/cancel, Secure Enclave를 검증하지 않았다.
- Distribution certificate, Archive validation, TestFlight 업로드, App Store 심사를 수행하지 않았다.

## 실패와 교정

첫 시도는 인증서 표시명의 괄호 값을 Team ID로 오인해 `No Account for Team`으로 실패했다.
인증서 subject의 `OU`를 실제 Team ID로 확인해 교정했다. 이어서 Team ID를 tracked
`project.pbxproj`에 넣은 상태가 native config 테스트 2건에 의해 거부됐다. 해당 변경을
완전히 제거하고 ignored LocalSigning 경계로 옮긴 뒤 테스트와 signed build를 재실행해
통과했다.

## Rollback

1. 로컬 `ios/App/LocalSigning.xcconfig`를 제거한다.
2. Xcode Accounts의 Manage Certificates에서 이번에 생성한 2026-08-27 Development
   인증서를 revoke하고 Keychain의 대응 인증서/개인키를 제거한다.
3. development profile은 Xcode/Developer Portal에서 삭제하거나 이후 자동 재생성한다.
4. 실물 iPhone에서 development 곰신로그 앱을 제거한다.

기존 인증서는 이번 작업에서 삭제하거나 revoke하지 않았다.

## Production

- Apple development signing/profile/device install: APPLIED
- Supabase/Vercel/Auth provider/TestFlight/App Store distribution: NOT APPLIED
