---
date: 2026-09-05
agent: codex
status: local-verified-independent-delta-pass
scope: service-journey
---

# 복무 여정 — 시간 기반 EXP

## Current State

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-rc-v5-final-fixes`
- Branch: `codex/rc-v5-final-fixes`; base `e35ff9d`; implementation `361cfc7`, contrast `ead5000`,
  provenance-test wording `a35acd7`, older-WebView/waiting-refresh fix `c6cddd8`.
- 찾기 군화/활성 곰신 파트너 카드와 `/service`에 같은 `ServiceJourney`가 실제 연결됐다.
- 별도 Hegel 사진 SliceA 8파일은 반환받아 보존했다. Store 통합 후 테스트 미실행 상태이며
  이 기능 작업에 섞어 commit하지 않았다. `Now.md`도 수정/stage하지 않았다.
- 이번 결과는 복무 기능의 로컬 checkpoint이며 앱 전체 RC 완료가 아니다.

## Findings / Decision

- V4_AS_BUILT §3.4 / V4_BACKLOG §찾기의 EXP 제거 기록과 최신 요청이 충돌했다.
  최신 사용자가 명시적으로 EXP/계급 레벨업을 요청했으므로 V5에 범위 한정 추가 승인을 기록했다.
- 기존 `computeServiceExp`는 코드만 있었고 실제 화면은 `computeServiceProgress`만 사용했다.
  기존 군종별 앱 단계/Lv.1–200 엔진을 재사용하되 UI 투영을 좁혔다.
- 1초=1 EXP. 접속하지 않아도 경과한 시간으로 계산한다. 출석/기록 횟수/읽음/결제는 무관하다.
  앱 예상 계급과 실제 진급을 구분하며, 실제 군 진급일/정책을 검증했다고 주장하지 않는다.
- 화면의 중심은 현재 계급·레벨/다음 레벨 EXP. 전체 단계/계산 설명은 native details 안으로
  옮겨 말이 길어지지 않게 했다. 상대 읽기 전용/기존 입력·휴가·연락·검색 경로는 유지했다.
- 시간/입력값은 서버 검증 점수가 아니다. 날짜나 기기 시각 변경에 따라 재계산하며, 결제
  재화·관계 평가·랭킹으로 사용할 수 없다.

### 버린 대안

- 7개 은어 티어 + 실제 계급 + Lv.200 세 척도 동시 표시: 무엇이 성장하는지 혼동된다.
- 가짜 빠른 채움/무한 반짝임: 실제 복무 기간과 다르고 접근성/배터리에 불리하다.
- 매초 서버 저장/조회: 필요 없다. 로컬 시각만으로 표시한다.
- 실제 인사상 진급으로 단정: 사용자가 입력한 실제 진급 이력이 없으므로 불가능하다.
- 사회복무/기타에 군 계급 적용: 중립 0/25/50/75/100% 여정, 선형 Lv.1–200으로 분리했다.

## Changes

- `src/features/service/serviceJourneyModel.ts`: 유효한 군종/유한 시각/실제 입력 기간만 사용.
  전역 플래그+미래 전역일 모순 차단. 군 계급/중립 여정 투영, 반올림된 표시 %로 진급 일수
  계산하지 않고 실제 초 단위 경계를 이용한다. 사용하지 않는 은어/군종 가상 래퍼 출력 안 함.
- `ServiceJourney.tsx` / CSS: 실제 초 단위 EXP/일시정지/재개, 화면 밖 및 background timer 정리,
  reduced-motion 수동 새로고침, 레벨 전환 시 짧은 효과, 44px/키보드/details 지원.
  EXP readout은 aria-live off여서 매초 화면 낭독을 요구하지 않는다.
- 동일시각 기준으로 EXP/D-Day/복무율을 함께 계산한다. 복무 완료 전 반올림 100% 방지.
- SearchPage/ServicePage: 실제 사용자 호출 연결. 군화만 기존 editor, 연결된 곰신은 읽기 전용.
- 초기 다크 캡처에서 어두운 아이콘 발견: built 대비 검사에서 **1.22:1 FAIL** 재현.
  `.press-response`의 색 transition은 종이 배경 즉시 변경보다 늦었다. 제어 아이콘만 색
  transition을 없애고, reduced-motion에서는 눌림 scale도 없앴다. 전역 디자인 변경은 아님.
- 테스트/canonical 문서/RC 실행순서/작업 원장 갱신.

## Verification

### 실제 실행

- 최초 계산 테스트: 모듈 부재 RED. UI 최초 7 FAIL → 구현 후 7 PASS.
  모순 날짜·잘못된 군종 3 FAIL 재현 → guard 후 PASS.
- `npm test -- src/features/service src/features/search/searchPage.test.tsx
  src/features/search/searchPageRenders.test.tsx src/features/us/gomsinServiceBehavior.test.tsx
  src/lib/serviceLevel.test.ts src/lib/milestones.test.ts`: **7 files / 102 tests PASS**.
  +1초/레벨 경계/종료 경계/100% 선반영 방지/일시정지/배경/화면 밖/reduced/cleanup/역할·연결을 포함한다.
- `npm run typecheck`: PASS. 초기 unused 상수 오류 2건은 제거 후 재실행했다.
- 추가 실제 caller `militaryInfoProvenance.test.tsx`: 10 PASS / 1 FAIL(옛 '자동 계산' 문구)
  → 새 disclosure의 '자동 계산한 전역일 기준'으로 assertion 갱신 후 **11 PASS**, scoped lint PASS.
  원본 날짜 보존/날짜 미입력 시 가짜 데이터 없음 검사는 그대로 유지했다.
- `npx eslint src/features/service src/pages/ServicePage.tsx src/features/search/SearchPage.tsx
  src/features/search/searchPage.test.tsx e2e/serviceJourney.spec.ts e2e/serviceAccessibility.spec.ts
  --max-warnings 0`: PASS.
- placeholder Supabase 환경의 `npm run build -- --logLevel warn`: PASS, 기존 >500KiB chunk 경고.
  기존 photo WIP가 포함된 로컬 build이므로 clean exact-commit 전체 RC build라고 주장하지 않는다.
- Node22 + 실제 Playwright, mock network, source-entry4176: serviceJourney/serviceAccessibility **4 PASS**.
  320/375/402px, 568×320 가로, 실제 dark, 200% text, 양쪽 역할, EXP 실제 tick/pause/resume,
  details, 44px, dialog focus/escape를 확인했다. 테스트 이름의 과거 'levels up'은 실제 해당
  browser 검사가 하지 않아 정확한 'opens rank journey'로 고쳤다. 레벨 경계는 unit으로 검증했다.
- production-style4178 초기: **3 PASS / 1 FAIL** (새 다크 제어 아이콘 대비 검사).
  이 실패를 4 PASS로 기록하지 않는다. 수정 후 source 대비1 PASS → rebuild PASS → built 전체
  **4 PASS (7.3s)**. `ead5000` feature 코드와 기존 미완료 photo WIP가 함께 있는 로컬 빌드다.
  결과/이미지는 `e2e/.artifacts/service-journey-final/`에 보존했다. 실사용자 데이터가 아닌 fixture다.
- `c6cddd8` H/M 교정 뒤 rebuild PASS, built 같은4시나리오 **4 PASS (6.7s)**.
  최종 캡처는 `e2e/.artifacts/service-journey-c6cddd8/`이다. 4174 실제 개발 서버의 cwd도 이번
  worktree로 확인했다. 실제 계정으로 이 화면을 확인한 증거는 아니며 4176/4178은 mock 검증 전용이다.

### 독립 검토

- Sol Max Aristotle 읽기 전용 기존 계산 검토: H2/M1. 사회복무 군 계급, 모순 전역 MAX,
  가상 ServiceProgress 래퍼의 시간이 멈추는 문제. 새로운 adapter/guard/실제 now 호출로
  대응했으며 기존 엔진 전체의 security PASS를 주장하지 않는다.
- Sol Max Huygens `361cfc7`→`ead5000` DELTA: **H1/M1 HOLD**.
  `Object.hasOwn` 부재 시 복무 화면 crash, reduced-motion 입대 대기에 갱신 control 없음.
  [Apple Safari 15.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-15_4-release-notes)
  에 해당 함수 도입이 명시돼 있고, parent도 함수 부재/입대 경계 테스트로 **2 FAIL / 19 PASS**를 재현했다.
  `c6cddd8`은 `hasOwnProperty.call`과 대기 상태 수동 갱신으로 대응. parent 해당4파일군
  **57 tests PASS**, typecheck/scoped lint PASS. 이 수정이 iOS15 전체 앱 UI/성능 인증은 아니다.
  최종 exact `c6cddd8a638dc7af82b8dd5a1708426770559038` H/M DELTA는
  **PASS — C0/H0/M0/L0**. Reviewer가 새 model/component21tests를 `--no-cache`로 독립 실행해
  **21/21 PASS (1.27s)**, `git diff --check a35acd7 HEAD` PASS, scoped 변경 없음으로 반환했다.
  이는 해당 기능의 관찰된 H/M 종결이며 앱 전체 security audit나 실기기 인증이 아니다.

### 미실행 / 남은 위험

- 실제 iPhone/VoiceOver/장시간 발열·배터리: UNVERIFIED. browser viewport와 별개다.
- hosted Supabase, 진짜 2계정, GitHub CI, TestFlight/App Store: UNVERIFIED / 원격변경 NOT APPLIED.
- 전체 RC: 사진 client WIP, 요약 M1, native 모델 성능, 실제 IAP 제공·운영 게이트 등이 남았다.
- 추정 계급은 날짜 비례 앱 여정이다. 병무청/소속 부대 인사와 일치한다고 보장하지 않는다.

## Rollback / Next

- 이 기능 코드 commit만 revert하면 기존 날짜 기반 UI로 돌아간다. DB/Storage/crypto/원본
  데이터 변경이 없어 데이터 rollback은 필요 없다. 기존 photo WIP/문서를 일괄 revert하지 않는다.
- 독립 DELTA/대비 수정 검증을 마쳐 **복무 로컬 gate를 닫았다**. 다음은 기존 사진 SliceA 중단점과 요약 M1
  단계로 돌아간다. 이 사용자 요청을 새로운 전면 리디자인 루프로 확대하지 않는다.

## Current Score / Next Highest-ROI Goal

전체 제품 점수는 이번 기능 검증만으로 갱신하지 않는다. 복무 기능은 구현·focused tests·
production-style browser·독립 DELTA 통과, native/Production은 UNVERIFIED다.
다음 최우선은 사진 SliceA의 미검증 Store 통합을 재개하여 upload/CAS/복구를 닫는 것이다.
이후 표시 SliceB와 요약 M1·native 장치 gate를 기존 순서로 종결한다.

## Production

**NOT APPLIED** — push/merge/deploy/Supabase/Apple/provider/결제/계정 데이터 변경 없음.
