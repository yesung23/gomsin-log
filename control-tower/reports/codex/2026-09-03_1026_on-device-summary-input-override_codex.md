# [GOMSINLOG CONTROL TOWER] 온디바이스 하루 정리 입력 계약 개정

## Current State

- Worktree: `/Users/han-yejun/Desktop/gomsinlog-sol-rc-v4`
- Branch: `codex/sol-gomsinlog-rc-v4`
- Base HEAD: `b28a79c36b1698c98a08fcf7e45c21b8aed70aad`
- 이 보고서는 제품·엔지니어링 canonical 문서의 결정 변경만 기록한다.
- 앱 코드, 네이티브 코드, DB, Supabase, Production은 이 gate에서 변경하지 않았다.

## Findings

- `PRODUCT_V5_MASTER_DECISION.md` §8.1은 건강·주기·성적·정확 위치가 섞일 가능성만 있어도
  그날 전체를 규칙 결과로 유지하도록 정했다.
- 2026-09-03 제품 오너는 현재 파트너에게 공유되고 이 기기에서 읽을 권한이 있는 기록이라면,
  본문 속 건강·위치 표현도 온디바이스 정리에 사용할 수 있다고 명시적으로 승인했다.
- 이 승인은 소유자 전용 구조화 건강 데이터, GPS/EXIF, 위치 metadata, 비공개·권한 없음·
  복호화 불가 기록의 입력 승인과 다르다.
- 현재 코드는 모든 적격 기록을 5개씩 순차 처리하고 정확한 `recordId`에 다시 결속하지만,
  모델 입력과 출력이 모두 40자이며 하루 전체 4초 timeout이라 많은 기록을 유용하게 압축하는
  실기기 계약은 아직 완성되지 않았다.

## Decision

- 최신 명시적 사용자 승인을 canonical 제품 문서에 반영했다.
- 모든 적격 공유 기록을 시간순으로 1:1 유지하며 모델은 중요 기록을 고르거나 기록을
  합치지 않는다.
- 첫 실기기 후보는 `기록당 최대 120 UTF-16 source → 최대 40 UTF-16 exact excerpt`,
  배치 5개, 하루 최대 20개, 배치당 4초, 하루 단위 atomic fallback이다.
- 발췌가 원문의 일부라면 생략 표시를 화면에서 숨기지 않고, 누르면 정확한 원본 기록으로
  이동한다.
- cloud AI fallback은 만들지 않고 exact-true/default-OFF를 유지한다.
- 온디바이스는 앱 서버 전송을 줄이는 경계이지 E2EE 또는 완전한 비노출 보증 표현이 아니다.

## Changes

- `docs/PRODUCT_V5_MASTER_DECISION.md`: 허용 입력, 금지 입력, 원본 1:1 결속, 첫 실기기 후보
  배치·길이·fallback 계약과 고지 경계를 명시했다.
- `docs/ENGINEERING_ROADMAP.md`: 2026-09-03 product-owner input override와 다음 구현 gate를
  추가했다.
- 본문 입력 정책만 바꿨으며 건강정보 자동 파트너 공유, 위치 수집, E2EE, RLS, DB 의미는
  바꾸지 않았다.

## Verification

- Canonical source와 최신 관련 Work Log를 재확인했다.
- 네 문서 파일에 대해 `git diff --check`를 실행했고 PASS했다.
- 앱 코드 테스트나 실물 Foundation Models 테스트는 이 docs-only gate의 증거가 아니다.

## Risks

- 원문 발췌도 앞뒤 맥락을 생략할 수 있으므로 생략 표시와 정확한 원본 이동이 필수다.
- 실제 Foundation Models가 한국어 원문 발췌 계약을 얼마나 지키는지, 20개 처리의 지연·발열·
  배터리·fallback 비율은 실물 지원 iPhone에서 UNVERIFIED다.
- 사용자 공유 기록 본문 자체의 서버 저장·E2EE 상태는 별도 보안 gate이며 이번 결정으로
  완성되었다고 주장하지 않는다.

## Current Score

- Product: 방향 결정 완료, 구현 전
- UX: 원본 1:1 이동과 생략 표시 계약 확정, 실렌더 UNVERIFIED
- Design: 변경 없음
- Engineering: 후보 계약 확정, 구현 전
- Security: 권한 경계 유지, 실기기·운영체제 경계 UNVERIFIED
- Release readiness: default-OFF / HOLD

## Next Highest-ROI Goal

현재 semantic output firewall과 정원 D2 독립 재검토를 먼저 닫은 뒤, 한 명의 bounded Worker가
120→40 원문 발췌·최대 20개·배치당 timeout·정확 원본 이동을 TDD로 구현한다. 이후 독립
privacy/security review와 실물 iPhone gate 전에는 기능을 활성화하지 않는다.
