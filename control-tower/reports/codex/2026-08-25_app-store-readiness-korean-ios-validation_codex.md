# App Store 준비도·iOS 실렌더·보안 delta 보고서

- 기준일: 2026-08-25
- 저장소: `/Users/han-yejun/Desktop/곰신로그`
- Branch: `codex/service-rank-profile-settings-impl`
- checked-out HEAD: `f02e93a26e9b6d73073cd42f6247a8ab30f2971a`
- 대상: 위 HEAD 위의 current uncommitted working-tree snapshot
- 코드 판정: **APPROVE — fresh Sol Max logging DELTA P0~P3 없음**
- 출시 판정: **HOLD — remote redirect/provider/App Store Connect/실기기 gate 미완료**
- Production: **NOT APPLIED**

## 1. 오케스트레이션과 방향 확인

- 어려운 출시·native 설계 감사: Kiro CLI `claude-opus-5`
- 작은 비보안 구현: `google-antigravity/gemini-3.7-flash` High
- 인증 로그 판단·구현·독립 검토: GPT-5.6 Sol High/Max
- 통합·실행·diff·시뮬레이터 확인: Codex primary

제품·사업·엔지니어링·현재 상태 문서를 다시 확인했다. 이번 변경은 connection-first 제품
루프, 관계 점수 금지, M6 전 neural on-device AI 미도입, 시각 전면 재설계 금지와 충돌하지
않는다.

## 2. 실제 변경

### 찾기 탭 접근성

`src/features/search/SearchPage.tsx`의 `전체 단계` 버튼은 접힌 상태에서도
`aria-controls="service-tier-rail"`가 실제 DOM wrapper를 가리킨다. 내부 7단계 rail만
조건부 렌더한다. 44px target, 현재 rank 상시 노출, 1초=1 EXP, 전체 단계 disclosure,
행정 진급·관계 점수가 아니라는 안내는 유지했다.

### 이메일 인증 로그

`src/lib/supabase.ts`의 `signInWithEmail` throw 경로가 raw exception object를 출력하지 않고
정적 문자열 하나만 기록한다. `src/lib/supabaseAuthLogging.test.ts`는 email, token URL,
access token, code, nested response detail canary를 실제 rejected promise에 넣어 runtime에서
로그 비노출을 검증한다. Fresh Sol Max는 이 P3를 CLOSED, review impact DELTA, CODE APPROVE로
판정했다.

### iOS 생성물과 빌드

최종 `dist`를 `npx cap sync ios`로 로컬 iOS bundle에 동기화했다. tracked `ios/`, `android/`,
package, Capacitor 설정에는 diff가 생기지 않았다. Xcode 26.6 / iOS Simulator SDK 26.5에서
서명 없는 iPhone Simulator build를 완주했고 `BUILD SUCCEEDED`를 확인했다.

빌드된 `app.gomsinlog`를 iPhone 17 Pro 시뮬레이터에 설치·실행했다. 온보딩 첫 화면의 safe
area, Dynamic Island 상단 여백, 필수 동의, 로그인 비활성 상태가 실제 렌더됐다.

![iPhone 17 Pro 온보딩 실렌더](/Users/han-yejun/Desktop/곰신로그/ui-audit-results/2026-08-25-ios-onboarding.png)

## 3. 실행 결과

| 상태 | 명령/경로 | 정확한 결과 |
|---|---|---|
| PASS | Search focused Vitest | 1 file / 21 tests |
| PASS | OAuth + auth logging focused Vitest | 6 files / 89 tests |
| PASS | 대상 ESLint | Search 2 files, auth logging 2 files, warnings 0 |
| PASS | `LANG=en_US.UTF-8 npm run verify` | typecheck, full lint, 235 files / 3,361 tests, production build 2,155 modules |
| PASS | `npm run test:phase0` | PostgreSQL 17, 58 migrations, 333 actor/security assertions |
| PASS | `npm run verify:native` | 4 files / 96 tests |
| PASS | `npx cap sync ios` | final dist와 4개 Capacitor plugin 동기화 |
| PASS | unsigned `xcodebuild` | iOS simulator app `BUILD SUCCEEDED` |
| PASS | simulator install/launch/screenshot | iPhone 17 Pro에서 PID 반환, 온보딩 실제 렌더 캡처 |
| PASS | `git diff --check` | whitespace 오류 없음 |
| FAIL | Kiro가 시작한 첫 full Vitest 시도 | partial-ack seed 991이 기본 5초를 126ms 초과; 이후 final `npm run verify`에서는 3,361/3,361 PASS |
| BLOCKED | 첫 Xcode 시도 | 사용자가 Kiro 작업을 중단하면서 `BUILD INTERRUPTED`; final 재실행은 PASS |

기존 500kB chunk warning은 유지된다. 현재 동작 결함은 아니며 이 보안·출시 gate에 억지
code-splitting refactor를 섞지 않는다.

## 4. Kiro Opus 독립 감사 결과

- P0/P1: 코드 finding 없음.
- P2 성격의 출시 차단: `appendPkceFlowIdToRedirects`가 Google·Apple·email callback 전체에
  query를 붙이지만 remote allow-list는 exact 4 entries뿐이라는 기존 read-only evidence.
- P3 raw email auth log: Sol 구현과 runtime canary test로 CLOSED.
- P3 접근성 참조: Gemini 구현과 focused test로 CLOSED.
- 생성 iOS public stale: final sync와 final Xcode build로 CLOSED.

Kiro가 제안한 Android manifest 주석 정리는 사용자 가치가 없어 수행하지 않았다. 속성·권한
변경도 하지 않았다.

## 5. 실제 사용자 경로 상태

| 경로 | 상태 | 근거 |
|---|---|---|
| iOS 첫 실행/온보딩 | PASS | final simulator install·launch·screenshot |
| `/search` EXP/disclosure | PASS(컴포넌트/이전 브라우저) | 21 focused tests와 이전 모바일 브라우저 렌더; 이번 iOS 세션은 미인증이라 해당 route를 열지 못함 |
| `/us`, `/settings`, record, story, highlight | UNVERIFIED on final iOS snapshot | 인증된 iOS session 없음 |
| Google/Apple/email 실제 인증 | UNVERIFIED | provider 계정 왕복 미실행 |
| native cold/warm OAuth return | UNVERIFIED | 실기기 provider callback 미실행 |
| push token/notification | UNVERIFIED | 시뮬레이터·unsigned build는 APNs 실동작 증거가 아님 |

코드가 존재하는 것과 실제 사용자 계정·실기기에서 성공하는 것을 분리했다.

## 6. 외부 출시 gate

1. remote Supabase redirect allow-list에 `sb_flow_id`가 붙는 web/native callback을 허용할
   최소 entry와 rollback을 보안 승인 후 적용한다.
2. Google·Apple·email 실제 계정으로 success/cancel/error를 web과 native에서 검증한다.
3. iOS/Android 실기기에서 cold start, warm return, Custom Tab close, timeout/retry를 확인한다.
4. App Store Connect에서 `app.gomsinlog`, signing/profile, App Privacy, 연령 등급,
   screenshot, 공개 HTTPS 약관·개인정보 URL을 확정한다.
5. Google 로그인이 있으므로 iOS에서 Sign in with Apple의 provider 활성화와 실제 성공을
   확인한다. 현재 첫 화면에서는 remote availability 때문에 Apple 버튼이 보이지 않았다.
6. 리뷰 가능한 immutable SHA를 만든 뒤 그 exact SHA에서 CI와 release validation을 다시
   수행한다. 이번 세션은 사용자의 금지에 따라 commit하지 않았다.

## 7. 온디바이스 하루 요약

현재 neural on-device model은 구현하지 않았다. M5 출시 gate 전 M6 기능을 끼워 넣지 않는다.
향후에도 상대가 실제 공유한 하루 기록만 입력하고, 사실 중심 최대 5줄, 각 줄의 exact source
record ID, private/건강 raw data 제외, 모델 불가 시 deterministic fallback을 유지해야 한다.
관계 점수·숨은 감정 분석·자동 중요 기억 선택은 추가하지 않는다.

## 8. 수정하지 말아야 할 것

- fragment/query token pair `setSession` fallback 복원
- `sb_flow_id` 부재 시 검증 없는 exchange fallback
- remote allow-list를 승인·rollback·실제 test 없이 넓히기
- 현재 release gate에 E2EE·새 DB 모델·AI SDK·새 의존성 끼워 넣기
- 관계/애정 점수, 좋아요·조회수·팔로워 추가
- 스타일 취향만으로 온보딩·탭 구조 전면 재설계
- unrelated user worktree 변경 reset/stash/checkout

## 9. 세션 경계

commit, push, PR, merge, Vercel deploy, Supabase migration/config mutation, provider console,
App Store Connect 변경은 모두 수행하지 않았다. remote/physical-device gate가 닫히기 전 출시
판정은 HOLD다.
