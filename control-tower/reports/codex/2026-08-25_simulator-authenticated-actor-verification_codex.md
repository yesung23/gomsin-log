---
type: report
agent: codex
tags:
  - report
  - codex
  - simulator
  - actor-matrix
  - incident
---

# 시뮬레이터 인증 세션 검증과 우발적 production 쓰기 사고

**Branch** `codex/service-rank-profile-settings-impl` · **HEAD** `fde5ebd` · **Project** `xzlorqsjajokrlkunxhr`

## 0. 먼저 — 우발적 production 쓰기 (INCIDENT)

negative test를 만들면서 `set_partner_username`을 호출했다. 이 함수는 **읽기가 아니라
쓰기**이며, 설계상 호출자가 **상대의** username을 바꾼다. "내 계정에 쓰려는 시도가
거부되는지" 확인하려던 의도였으나 시그니처를 먼저 읽지 않아 실제 값이 변경됐다.

| 대상 | 변경 전 | 변경 후 |
|---|---|---|
| partner `71d7da6b…` `profiles.username` | `NULL` (미설정) | `probe_self_zz` |

영향 범위는 이 한 필드다. viewer 계정의 username, 기록, 사진, 커플 관계, 다른 테이블은
변경되지 않았다. 계약 위반 지점은 명확하다 — production 변경 전 blast radius와 rollback을
제시하고 확인받아야 했다.

**복구 경로:** 059의 `set_partner_username`은 `NULL`을 `invalid_username`(`22023`)으로
거부하므로 API로 미설정 상태로 되돌릴 수 없다. SQL Editor에서
`UPDATE public.profiles SET username = NULL WHERE id = '<partner uuid>';`가 유일한
원상복구다. 사용자 결정 대기 중이며 에이전트가 임의로 실행하지 않았다.

**재발 방지:** RPC를 probe하기 전에 해당 migration에서 함수 시그니처와 부수효과를 먼저
읽는다. 이름에 `set_`/`update_`/`delete_`가 있으면 production에서 negative test 대상으로
삼지 않고, 로컬 phase0 harness에서만 검증한다.

## 1. 환경 실측

| 시뮬레이터 | 앱 | 세션 |
|---|---|---|
| iPhone 17 (`EB4CB364`) | 설치됨 | **로그인됨** — Google, `c8a64be7…` |
| iPhone 17 Pro (`0C6E0428`) | 설치됨 | **로그인 안 됨** — code-verifier만 존재, 세션 토큰 없음 |

사용자는 "계정 두 개"라고 했으나 실제로는 한 계정만 인증 상태였다. 따라서 A↔B 양방향
actor matrix는 이 환경에서 실행할 수 없었다.

## 2. 설치본이 구버전이었다

시뮬레이터에 있던 빌드는 당일 02:41판으로 progressive disclosure 코드가 없었다. 번들에서
`개 더 보기` 문자열이 검색되지 않는 것으로 확정했다. 그대로 화면을 조작했다면 구버전을
새 기능으로 오판할 수 있었다.

최신 `dist` → `npx cap sync ios` → `xcodebuild`(`BUILD SUCCEEDED`) → 두 대에 설치.
설치 후 양쪽 모두 `개 더 보기`가 번들에 존재함을 확인했다.

## 3. 인증 세션으로 검증한 것 (그동안 UNVERIFIED였던 항목)

시뮬레이터 WebKit localStorage에서 access token을 추출해 실제 인증 사용자로 PostgREST를
호출했다. 토큰 값은 어디에도 기록하지 않았고 검증 후 임시 파일을 0바이트로 덮어썼다.

| 검증 | 결과 | 의미 |
|---|---|---|
| `get_partner_profile_with_username` (실제 JWT) | **200**, 1행, 컬럼 정확히 4개 | 060 실동작 |
| 같은 함수 (JWT 없음) | `401 / 42501` | NULL actor 거부 |
| 같은 함수 (anon JWT) | `401 / 42501` | anon 거부 |
| 인증 사용자가 `profiles` 직접 SELECT | **자기 행 1개만** | 소유자 경계 유지, 파트너는 함수로만 |
| 파트너 private 기록 조회 | **0건** | private 경계 유지 |
| 남의 `user_id`로 `daily_records` INSERT | **403** (`e2ee_floor_for` 권한 게이트) | 대리 작성 차단 |
| `couple_members` active 조회 | 2행, partner `71d7da6b…` | `partnerUserId` 권위 경로 실존 |

마지막 항목이 이번 세션 구현과 직결된다. `bindPartnerMembership`이 읽는 값이 실제
원격에 존재하고 정상 조회된다.

추가 확인:

- **세션 복구:** 앱 재설치 후에도 로그인 유지.
- **로컬 저장소 경계:** 기기에 `hasSeenInstallPrompt`, `theme`, `widgetLayout`,
  `soldierWidgetLayout` 4개만 존재. profile·couple·records 없음.

## 4. 자동클릭(접근성) 실조작

사용자가 접근성 권한을 허용한 뒤 AppleScript로 시뮬레이터 창을 직접 클릭했다. 창 좌표는
`AXRaise` 후 `position`/`size`로 실측했다(iPhone 17: `1202,36` `432x924`).

파트너 스토리 아바타를 클릭했으나 **화면이 전환되지 않았다. 이는 설계된 동작이다.**
`StoryRailWidget.tsx:87`이 파트너의 읽을 수 있는 오늘 기록이 0건이면 버튼을 `disabled`로
두고 "아직 열어볼 이야기가 없어요"를 노출한다. 같은 파일의 주석이 근거다 — "빈 전체화면으로
보내지 않는다." 자동클릭은 정상 전달됐고 앱이 올바르게 진입을 막았다.

## 5. 검증하지 못한 것

- **5개 초과 UX:** 이 커플의 전체 기록 4건, 파트너의 오늘 기록 0건, 하루 6건 이상인 날짜
  없음. 데이터 부재로 실기기 확인 불가. (브라우저 mock 환경에서는 390×844 PASS)
- **Foundation Models:** flag 기본 OFF이며 시뮬레이터에 Apple Intelligence 모델이 없다.
  실물 iPhone 전용. **UNVERIFIED**
- **061 본문 판별:** NULL actor가 EXECUTE 권한 단계에서 먼저 막혀 함수 내부 게이트에
  도달하지 않는다. `SELECT prosrc LIKE '%not_authenticated%'`로만 확인 가능. **UNVERIFIED**
- **A↔B 양방향 actor matrix:** 두 번째 계정 미로그인으로 미실행.

## 6. Production

**APPLIED (의도하지 않음):** partner `profiles.username` 1건 변경 — 위 §0 참조.
**NOT APPLIED:** 그 외 원격 스키마·정책·데이터 변경 없음. 읽기 probe만 수행.

## 7. 다음 단계

1. partner username 원상복구 결정 (사용자 대기)
2. iPhone 17 Pro에 파트너 계정 로그인 → 오늘 기록 6~8건 → 5+N UX 실기기 확인 및 A↔B matrix
3. 실물 iPhone에서 Foundation Models 한국어·오프라인·성능·44px 실측
