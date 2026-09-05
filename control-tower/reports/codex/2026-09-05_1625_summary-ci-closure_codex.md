---
agent: codex
date: 2026-09-05
status: local-fixes-independent-medium-open
tags: [control-tower, on-device, media, local-only]
---

# [GOMSINLOG CONTROL TOWER]

## Current State

`codex/rc-v5-final-fixes`, summary code **d01793a69b6a8192d915e26ec75da4f89738b67b**,
photo CI **e35ff9d1920d8c4cf27a5634a8112e74eca4bcd6**. 전체 RC/AI 활성화는 HOLD다.
Production/Supabase/Apple/master 변경은 **NOT APPLIED**다.

## Findings / Decision

Kepler의 범위를 확대하지 않고 명시적으로 중단·소유권 반환 후 parent가 패치를 인수했다.
기존 HIGH 반례에 대해 임의의 문장 중간 발췌 대신 전체 원문과 완전한 마지막 문장 경계를 확인한다.
이는 앞문장의 화자·조건·반어·대명사 맥락까지 보장하는 의미 동등성 판정기가 아니다.
일반 언어 품질은 여전히 검증이 필요하며 flag를 ON으로 바꾸지 않았다.

Parent가 원문 편집 뒤 이전 클릭으로 모델이 다시 실행되는 동작을 추가 테스트로 재현했다.
요청을 당시 source key에 묶고 source 변경 시 요청을 폐기한다. A→B→A도 이전 클릭을 부활시키지 않는다.
기능을 전부 거부해 검사만 통과시키지 않도록 운동장/약국 방문의 실제 성공 발췌와 원본 이동을 유지했다.

## Changes

- d01793a: `dailySummary/{contract,rules,semanticGuard,verify,useOnDeviceDailySummary}`와 직접 tests,
  실제 Story 통합 test, native package Swift prompt/types/README. 16개 파일.
- full NFC source는 메모리 검증/결과 무효화에만 보존한다. Native 입력은 index/text만 유지한다.
- 120단위 초과/안전한 문장 경계가 없는 긴 원문은 그날 모델을 생략하고 모든 기존 기본 발췌/원본을 유지한다.
- 하루 총21개 이상은 긴 후보 수와 무관하게 preflight/모델0회다. 총20개 안의 긴6개는5+1로 처리한다.
- batch는 전부 성공한 경우에만 반영한다. background/화면전환/unmount/원문 변경 후 늦은 결과를 폐기한다.
- Story test의 native register mock 수집 오류를 고쳤고 source 이동/ack mutation 경계를 실제로 검사한다.
- e35ff9d: 새 photo PostgreSQL 두 모드를 package script/기존CI job에 연결한다.
  상속된 모든 PG* 접속 설정을 제거한 뒤 격리 socket을 지정한다. regression subprocess도 동일하게 격리한다.
- IAP runbook의 “미래082판매활성화” 표기는 이미082가 reconciliation 수정에 사용됐으므로 바로잡았다.
  실제 판매 활성화나 기존 migration 재작성은 하지 않았다.

## Verification

| 실제 parent 검사 | 결과 / 정확한 의미 |
|---|---|
| `vitest run src/lib/dailySummary src/features/story/storyDailySummary.test.tsx` | 인수 patch257PASS; 수동요청 fix 이후258PASS |
| `useOnDeviceDailySummary.test.tsx -t '예전 클릭'` | 최소 corpus fixture1개 오류를2개로 고친 후 실제 원문편집 재실행 FAIL 재현; 수정 후 통과 |
| 최종 request tombstone 이후 hook+Story 두 파일 | **65PASS**, A→B→A 새요청·20/21·원본 클릭 포함 |
| 최종 contract test | **23PASS**; 빈 배열 순회로 통과하던 assertion에 실제 두 후보 개수 검증 추가 |
| scoped ESLint / `npm run typecheck` / `git diff --check` | **PASS**; 최종 test wording 변화는 별도23PASS로 확인 |
| `xcrun swiftc -typecheck -target arm64-apple-ios15.0 -sdk <iphoneos SDK> .../OnDeviceSummary.swift` | **PASS**, 모델 실행/전체 네이티브앱/실기기 증거 아님 |
| 의도적으로 잘못된PGSERVICE/PGHOSTADDR/PGOPTIONS를 상속한 새PG harness | 격리 전 createdb FAIL, 접속환경 격리 후 fresh001..090 **187PASS**, 기존+090 **520PASS** |
| 새CI YAML + package명령 확인 / node syntax | **PASS**. 최초 `yaml` package 없음은 기존 `js-yaml`로 확인; dependency 추가 없음 |
| placeholder Supabase 환경 `npm run build -- --logLevel warn` | **PASS**, source가 e35ff9d와 동일함을 검사 후 immutable browser artifact 복사 |

별도 outDir를 시도한 최초 build는 Vite plugin이 기본dist를 참조해 `Service worker build markers are missing`
오류로 FAIL했다. 표준dist 빌드는 PASS다. 이 실험 때문에 Vite 배포 설정을 바꾸거나 실패를 숨기지 않았다.
실제 사용자4174는 Vite dev임을 확인해 그대로 유지했고, mock preview는4177의 별도 산출물을 사용한다.

Photo backend/cleanup은 exactfb880ed에서 독립 Sol Max **C/H/M/L0 PASS**로 닫혔다.
검토 대상 SQL/Edge/source는 e35ff9d에서도 동일하다. 새 CI 하네스 환경 격리는 parent delta 검사이며
090 권한 계약을 수정하지 않았다. Summary 독립 검토 후속 결과는 아래와 같다.

### 독립 summary DELTA — d01793a

Sol Max/Russell: **C0/H0/M1/L0, FAIL**. 기존 HIGH1/2의 부모/대상 실제 verifier 비교와 정상2개는 PASS.
추가 실제 hook/Story memory-injected 테스트에서 거대한 결합문자 원문이 짧게 절단되는 경우
그 줄이 후보에서 빠지고 정상 긴 줄만 AI applied가 되는 M1을 확인했다. 전체 corpus의 절단 여부를
후보 필터 이전에 검사하는 최소 수정과 fresh DELTA가 남는다. 이전 전체258PASS를 이 결함의
해결 증거로 쓰지 않는다. reviewer는258PASS 및 hook3PASS/1FAIL, Story4PASS/1FAIL을 구분했다.
파일 변경/원격/기기 작업은 없었다. 관찰된HIGH 수정과 일반 의미품질/activation HOLD는 별개다.

### 실제 브라우저 — immutable e35ff9d

- Node22 Playwright, `e2e/.artifacts/rc-review.config.ts`, localhost4177/mock auth만 사용.
- 기본18흐름: **17PASS/1FAIL**. garden13개(끌기/격리된이동/간격/가로모드/reduced-motion 포함),
  Story8개 전체접근/정확원본, Home실패차단, 복무접근성, Settings짧은화면이 통과했다.
- 별도 brand/Home/My/legal target +실제정원 캡처: **2PASS**.
- 전체5탭/역할/light·dark/빈·loading/오류/작은기기/하위화면/320px문서 캡처: **11PASS**,47.5초.
  이 묶음은 일부 geometry assertion을 포함한 capture audit이며 기능을 전부 조작한 테스트가 아니다.
- parent는 실제 Home/정원/Search/Diary dark/Schedule/Us dark/오류 이미지를 열어 확인했다.
- 실패의 원인은 최신 data validation이 malformed DB fixture를 React render 이전에 차단해
  `AuthSyncUnavailable`가 나타나는 것이다. 실제 ErrorBoundary 종이 CSS는 코드에 유지됐다.
  예전 “render crash 주입” 검사를 현재 보호/재시도/로그아웃 흐름으로 바로잡을 필요가 있다.
  이를 위해 보호 경로를 우회하거나 정상 ErrorBoundary를 지우지 않는다. test 수정은 writer 인수 뒤 수행한다.
- 추가 Playwright 실행은 기본 outputDir의 앞선 실패 screenshot을 덮어썼다. 실패 판정/명령은 위에
  보존하고, 이후 캡처는 별도 `rc-e35ff9d-screens`에 보존했다. 없는 파일을 증거 링크로 쓰지 않는다.

## Risks / Current Score

Product/UX/Design: 좁은 기능 gate에서 전제품 점수를 꾸며내지 않는다.
Engineering: 명시된 로컬 검사 PASS, browser1FAIL. Security: media backend 독립PASS / summary M1 OPEN.
Release readiness: **HOLD**. 실제 iPhone 추론 지연/메모리/발열/오프라인/일반 한국어 품질,
hostedSQL/Storage/OAuth/StoreKit, 실제 CI 실행은 **UNVERIFIED**다.

IAP 실제 조사: Settings의 구매복원 호출은 있으나 Shop은 무료 local collection이고 purchase runtime의
판매 소비자와 service-only 실제 delivery evidence caller가 아직 연결되지 않았다. 클릭/구매/예약을
실제 사용 증빙으로 꾸미지 않는다. 판매 OFF와 권리·상품·동의·운영 gate를 유지한다.

## Next Highest-ROI Goal

Hegel Sol High는 photo client SliceA(단일 decode/두 JPEG/정확한 byte hash/예약·업로드·복구)를 소유한다.
Russell Sol Max는 M1 결과를 반환해 종료했다. Parent는 immutable browser QA/통합 기록을 소유한다.
현재 photo writer 반환 뒤 summary M1과 stale browser fixture만 고치고 각각의 delta를 확인한다.
최대2 하위 에이전트, 코드 writer1명. 그 다음 실제 작은목록/확대 master 연결 SliceB와 별도 리뷰를 수행한다.

## Rollback

미배포 summary/CI commit은 개별 revert 가능하다. 사용자 기록·암호·권한·DB schema는 이두commit에서 바꾸지 않았다.
Photo090이 실제 pair를 가진 후에는 wrapper/bindings/physical64를 제거하지 않고 client를 멈춘 forward fix를 사용한다.
Book Studio, 기존 Now.md, master, 외부 서비스는 변경하지 않았다.
