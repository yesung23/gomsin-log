# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Base HEAD: `7ba2df809220180d704086921ae3ed4fe503cd98`
- Implementation HEAD: `68dc6c1fa20233157e68acc2027c768c2cc2eb9c`
- Scope: 현재 파트너가 공유한 하루 기록 전체를 순서대로 정리하고 각 항목을 정확한 원문으로 연결하는 온디바이스 발췌
- Feature state: exact-true flag, 기본 OFF
- Remote/Production: NOT APPLIED / UNVERIFIED

## Findings

- 원문과 같은 문장만 허용하던 기존 40자 adapter는 안전했지만 긴 기록에서 유용한 부분을 골라 보여주지 못했다.
- 모델에게 자유 요약을 허용하면 사실 추가, 부정·수량·주체 손실, 기록 간 병합 또는 순서 변경이 생길 수 있다.
- Swift bridge가 JavaScript number/bool을 느슨하게 해석하면 잘못된 index나 boolean이 계약을 우회할 수 있다.
- `Intl.Segmenter` 없이 긴 Unicode 원문을 자르면 grapheme 경계를 깨뜨릴 수 있어 모델 호출 전 fail-closed가 필요했다.

## Decision

- 입력은 현재 연결된 파트너의 오늘 기록 중 readable·persisted·non-private 본문만 사용한다.
- 현재 파트너에게 공유된 본문의 건강·위치 표현은 허용하지만 owner-only 구조화 건강 데이터와 GPS/EXIF metadata는 제외한다.
- AI는 기록을 버리거나 합치거나 재정렬하지 않는다. 한 기록당 한 항목을 유지하고 결과는 같은 원문의 연속 부분 문자열만 허용한다.
- 화면의 앞·뒤 생략 표시는 앱이 붙이며, 항목을 누르면 동일한 `recordId`의 정확한 원문으로 이동한다.
- 최대 20개, 5개씩, 배치당 4초로 제한하고 한 배치라도 실패하면 그날 전체를 결정론적 원문 목록으로 되돌린다.
- cloud/server fallback은 없고, 지원되는 실물 iPhone 검증 전 feature는 기본 OFF로 유지한다.

## Changes

- JavaScript contract와 semantic guard에 120 UTF-16 입력, grapheme-safe 전처리, 40자 이내 exact contiguous excerpt, 실제 생략 경계 검증을 추가했다.
- Story flow에 최대 20개/5개 배치/4초 timeout/하루 단위 atomic fallback과 exact-original navigation을 연결했다.
- Swift Foundation Models adapter를 동일한 1:1 index 계약으로 조이고 dictionary key, integer, boolean type을 엄격히 검증했다.
- bodyless attachment-only 기록이나 안전하게 자를 수 없는 긴 Unicode 입력은 모델을 호출하지 않고 기존 목록을 유지한다.
- 사용자 문구를 `AI로 하루 정리`, `기기에서 정리 중`, `원문 발췌 완료`로 맞췄다.

## Verification

- Focused Vitest: 8 files / 211 tests PASS
- Segmenter preflight delta: 3 files / 78 tests PASS
- Story integration repeated 5 times: each 38/38 PASS
- Native configuration tests: 4 files / 106 tests PASS
- Target ESLint: PASS
- Full TypeScript typecheck: PASS
- Placeholder public-env production build: PASS, 2,536 modules
- iOS Simulator clean unsigned Xcode build: PASS
- Independent Sol architecture/security review: initial HOLD 4건 수정 후 FINAL LOCAL PASS, actionable CRITICAL/HIGH/MEDIUM 0
- Full Vitest snapshot: 4,218/4,221 PASS; 이 기능 관련 Segmenter 실패는 수정·포커스 재검증했고, 별도 Realtime/lifecycle 2건은 다음 안정성 gate에서 조사 중
- Physical supported iPhone Foundation Models, offline behavior, Korean output quality, latency, thermal, battery, memory: UNVERIFIED

## Risks

- 실물 지원 iPhone에서의 Foundation Models 가용성·한국어 품질·오프라인 동작·4초 제한은 아직 증명되지 않았다.
- 온디바이스 처리는 서버로 본문을 전송하지 않는 경계일 뿐 완전한 보안이나 E2EE가 아니다.
- 21개 이상 또는 본문 없는 기록이 포함된 날은 의도적으로 AI 버튼을 숨기고 결정론적 목록을 유지한다.
- 전체 테스트에는 이 기능과 별개인 lifecycle/migration contract 실패 2건이 남아 Release Candidate gate는 아직 HOLD다.

## Current Score

- Product: 8.1/10 — 하루 전체를 놓치지 않고 각 원문으로 연결하는 계약 구현
- UX: 7.9/10 — 명시적 생략·atomic fallback·exact navigation 구현, 실기기 체감 미확인
- Design: 7.8/10 — 기존 Story 위계 안에 작은 선택형 보조 기능으로 통합
- Engineering: 8.6/10 — strict bridge, bounded batching, Unicode·timeout·fallback 회귀 고정
- Security: 8.3/10 — no-cloud·eligible-source 경계와 output firewall 구현, E2EE 주장은 하지 않음
- Release readiness: 7.1/10 — local/simulator gate PASS, 실기기와 전체 suite 2건이 남음

## Next Highest-ROI Goal

전체 테스트에서 재현되는 couple lifecycle subscription 실패와 migration 072 schema-cache reload contract 실패의 실제 원인을 각각 확정하고, Realtime 의미를 보존하는 최소 수정 후 fresh PostgreSQL chain·전체 test/typecheck/build를 다시 통과시킨다.
