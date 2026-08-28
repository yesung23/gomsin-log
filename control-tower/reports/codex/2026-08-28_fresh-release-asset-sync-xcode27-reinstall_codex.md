# Fresh release asset sync and Xcode 27 physical reinstall — 2026-08-28

## 판정

**PACKAGING/INSTALL PASS · PHYSICAL RENDER UNVERIFIED.** 사용자가 “앱이 그대로”라고
보고한 시점에는 최신 `dist/index.html`과 `ios/App/App/public/index.html`의 hash가 달랐다.
즉 최신 웹 build가 iOS bundle에 들어가지 않은 상태였다. fresh release build, Capacitor
sync, Xcode 27 signed build, physical overwrite install과 launch를 다시 수행해 이 불일치를
닫았다.

## Root cause

- 초기 `dist`와 iOS `public`의 entry asset이 서로 다른 chunk를 가리켰다.
- 첫 `npm run cap:release:ios`는 `.env`의 legacy JWT/anon 형태 key를 감지하고 의도대로
  abort했다. 보안 검사를 우회하지 않았다.
- project `xzlorqsjajokrlkunxhr`의 `default` publishable key를 Supabase CLI로 읽어 shell
  memory에서만 build env에 전달했다. key 값은 출력·파일 저장·Git commit하지 않았다.

## 실행 결과

- `npm run cap:release:ios`: PASS
  - TypeScript build PASS
  - Vite production build 2,166 modules PASS
  - Capacitor iOS sync 5 plugins PASS
- `dist/index.html`, `ios/App/App/public/index.html`, signed
  `App.app/public/index.html`: 동일 SHA-256
  `61f53c550c138cbe1628cfc1bb31c17cce8ad2946b22c5f08088fc4b571f65fb`.
- Toolchain: `/Users/han-yejun/Downloads/Xcode-27-Beta.app`, Xcode 27.0
  build `27A5252f`, iPhoneOS SDK 27.0.
- Xcode physical Debug build: `BUILD SUCCEEDED`.
- Apple Development signature/provisioning: PASS.
- physical install: PASS, 새 bundle install URL로 교체.
- `--terminate-existing` launch: PASS.
- 5초 후 process: PID 4433, 새 install URL의 `App.app/App` 실행 확인.
- native config/privacy/assets/permissions focused Vitest: 4 files / 106 tests PASS.
- 설치 표시 버전은 기존과 같은 `0.1.0 (1)`이다. 버전 문자열이 같아도 bundle은 교체됐다.

## Xcode warning 판정

- App/Pods의 `Update to recommended settings`: advisory only. generated Pods 프로젝트에는
  적용하지 않는다. App project도 현재 iOS 15 deployment target과 Xcode 27 build가 PASS라
  자동 적용하지 않았다.
- `[CP] Embed Pods Frameworks` no-output warning: `Podfile`이 의도적으로
  `disable_input_output_paths => true`를 사용해 script가 매 build 실행되는 상태다.
  warning은 남지만 framework embed는 실행됐고 build exit 0이다. 기능 결함이 아니다.

## 경계

- 화면 capture/remote mirror 수단이 없어 실제 최신 UI 렌더는 **UNVERIFIED**다.
- Apple OAuth, 두 계정, 기록 저장, Foundation Models, Secure Enclave, airplane mode,
  Archive/TestFlight는 실행하지 않았다.
- app data container path가 install 전후 달라졌으므로 session/data container 보존은 PASS로
  주장하지 않는다. Supabase 원격 데이터는 변경하지 않았다.
- tracked native diff 없음. 기존 `.DS_Store`, `src/lib/store.test.tsx`,
  `src/pages/authCallbackPkceRace.test.tsx`는 보존했다.

## 다음 확인

사용자가 현재 열린 iPhone 앱에서 마이탭 왼쪽 `+`, 중앙 아이디, 스토리의 `HH:mm`과
콘텐츠 아래 액션, 설정의 무지/줄 종이 선택을 확인한다. 이 표지가 보이면 최신 UI 렌더
PASS로 닫을 수 있다.
