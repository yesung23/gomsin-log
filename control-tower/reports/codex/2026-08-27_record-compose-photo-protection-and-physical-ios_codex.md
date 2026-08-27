# 기록 작성 사진·보호 경로·실물 iOS 검증 보고서 — 2026-08-27

## 판정

**CONDITIONAL PASS**

코드와 로컬/렌더링/네이티브 빌드·실물 실행 게이트는 통과했다. 로그인 후 실제 계정으로
사진 기록을 저장하고 상대 계정에서 확인하는 경로는 현재 설치 앱이 약관 동의 전 상태라
실행하지 못했으며 **UNVERIFIED**다. Production 변경은 없다.

## exact state

- branch: `codex/profile-post-composer`
- base HEAD: `02fd3f898c2c1c84c76f9ac088367121a4620a3c`
- review target: 위 HEAD 기반 uncommitted delta
- 보존한 사용자 변경: `.DS_Store`
- claim: `codex`가 이번 범위를 점유했고 완료 시 release

## 실제 사용자 동작

- 기록 작성에서 사진을 고르면 글 바로 아래에 실제 썸네일이 보인다.
- 사진별 44px 제거 버튼으로 저장 대상에서 뺄 수 있고, 같은 선택 버튼으로 사진을 더 추가한다.
- 사진은 저장 전 기기 Blob URL로만 표시되며 서버 업로드·로그·localStorage 저장이 없다.
- 출시 보호 flag와 원격 write floor가 모두 꺼져 있으면 곰신/군인 모두 기존 RLS 경로로 저장한다.
- 보호 상태를 확인할 수 없으면 한 번만 재조회하고, 계속 실패하면 평문으로 낮추지 않는다.
- 출시 flag가 꺼진 빌드에서는 열리지 않는 기록보호 설정으로 보내지 않고 초안을 유지한 채 재시도한다.
- 앱 본체에는 원격 `server.url`이 없고 설치된 `app.gomsinlog`의 `App.app/App`가 번들된 웹 자산을
  네이티브 WebView에서 실행한다. 시스템 브라우저는 Google/Apple OAuth provider 화면에만 사용한다.

## 개인정보·보안 불변식

- private/shared 선택과 owner/couple 권한은 변경하지 않았다.
- active write floor가 있거나 상태를 끝내 확인할 수 없으면 plaintext write를 허용하지 않는다.
- 선택 사진의 object URL은 제거, 저장 후 이동, 화면 이탈 때 해제한다.
- 기존 이미지 메타데이터 제거·JPEG 정규화와 Storage/RLS 경로를 재사용한다.
- DB, migration, Supabase Auth/provider, Vercel, Apple 설정은 변경하지 않았다.

## 검증 결과

- focused Vitest: PASS, 6 files / 129 tests
- P0/P5/write-floor: PASS, 76 / 93 / 39 assertions
- phase0 PostgreSQL 17: PASS, 64 migrations / 411 assertions
- focused Playwright: PASS, 4/4 (`chromium-390`)
- full `LANG=en_US.UTF-8 npm run verify`: PASS, 258 files / 3,735 tests, build 2,165 modules
- `npx cap sync ios`: PASS, five plugins, tracked iOS diff 0
- unsigned simulator build: PASS, `BUILD SUCCEEDED`
- signed Xcode 26.6 / iPhoneOS 26.5 SDK build for iPhone 16 Pro / iOS 27: PASS, exit 0
- physical install/launch/screenshot/process: PASS, latest build installed; onboarding rendered and `App.app/App` alive 1초 뒤 렌더 PASS
- independent Terra review: initial FAIL/HOLD on same-frame duplicate submit P1; all three authoring entry points remediated; fresh closure PASS, P0-P3 0

## 실패·차단·미검증

- 실물 기기 로그인 후 텍스트/사진 저장: UNVERIFIED
- 상대 계정에서 새 사진 기록 확인과 exact original 이동: UNVERIFIED
- Google/Apple OAuth 왕복, Apple provider/redirect: UNVERIFIED/BLOCKED
- Archive/TestFlight/App Store 제출: NOT EXECUTED
- Foundation Models 실기기 품질: UNVERIFIED, feature flag 기본 OFF

## Production

- Supabase SQL/Auth/provider: **NOT APPLIED**
- Vercel deploy/env: **NOT APPLIED**
- Apple/TestFlight/App Store Connect: **NOT APPLIED**
- 실제 적용: 로컬 코드와 연결된 iPhone의 development Debug 앱 덮어 설치만 수행

## rollback

- 코드: 이 범위의 단일 커밋을 revert한다.
- 기기: 이전 development build를 다시 설치한다. 앱을 삭제하지 않으면 컨테이너 데이터가 유지된다.
- 원격: 변경하지 않았으므로 원격 rollback은 없다.

## 가장 작은 다음 단계

사용자가 설치 앱에서 필수 약관 동의와 로그인을 완료한 뒤, 사진 한 장을 포함한 기록 하나를
저장한다. Codex는 같은 기기에서 피드/원본을 확인하고 두 번째 계정에서 partner visibility와
exact original 이동을 확인한다. 이 증거 전에는 App Store 제출 가능 판정을 PASS로 올리지 않는다.

## STOPPED AT

- exact HEAD: `02fd3f898c2c1c84c76f9ac088367121a4620a3c` 기반 reviewed working-tree delta; final commit은 완료 보고에 기록
- branch: `codex/profile-post-composer`
- PR: #90은 remote `a633ccb`이며 이 로컬 delta는 아직 push하지 않음
- changed (this delta only): 사진 즉시 미리보기/제거, flag-aware 보호 오류 복구, bounded floor retry, 세 작성 경로 중복 제출 방지와 회귀 테스트
- explicitly not changed: DB/migration/RLS/crypto authority, Production Supabase/Auth/Vercel/Apple/TestFlight
- tests executed / not executed and why: 로컬 전체 verify·보안/DB·Playwright·native sync/build·signed 실기기 launch 실행; 로그인된 두 계정 기록 왕복은 사용자 세션 전이라 미실행
- Production: NOT APPLIED
- Supabase: remote mutation 없음; 이 작업에서 live catalog를 재판정하지 않음
- P6: NOT AUTHORIZED / NOT CHANGED
- next owner / next action: 사용자 로그인 후 Codex가 실물 사진 기록 저장 → 상대 표시 → exact original을 검증
