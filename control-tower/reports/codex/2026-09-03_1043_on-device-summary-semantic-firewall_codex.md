# [GOMSINLOG CONTROL TOWER]

## Current State

- Branch: `codex/sol-gomsinlog-rc-v4`
- Reviewed base HEAD: `d0914b54732408ddbb56d6f388c3e6fc75099764`
- Scope: 현재 40자 온디바이스 요약 adapter의 출력 검증 5개 파일
- Feature state: exact-true flag이며 기본 OFF; 실제 지원 iPhone 검증 전 Production 활성화 금지
- Remote/Production: 변경하지 않음

## Findings

- 기존 구조·길이·index 검증만으로는 모델이 원문에 없는 감정·관계·진단·의도 문장을 지어내도 통과할 수 있었다.
- 부분 문자열만 허용하는 방식도 `꿈에서`, `춘향이랑`, 부정, 통화 수량, 금액 부호 같은 핵심 맥락을 잘라낼 수 있어 안전하지 않았다.
- 구두점·공백을 손실 정규화하면 `아버지가 방`과 `아버지 가방`, 인용 여부, 마이너스·통화 기호가 달라진 문장을 같다고 오판할 수 있었다.

## Decision

- 이번 baseline에서는 자연어 의미 동등성을 추측하지 않는다.
- 모델 출력은 NFC와 바깥 공백 정리 후 원문 내부와 exact match해야 한다.
- 원문 마지막이 Letter/Number/Mark/Symbol일 때 ASCII 마침표 하나만 추가 허용한다.
- 한 줄이라도 검증 실패 시 그날의 모델 결과 전체를 버리고 기존 결정론적 문장으로 돌아간다.
- 건강·위치 표현도 사용자가 현재 파트너에게 공유한 DailyRecord 본문이면 같은 규칙으로 온디바이스 처리할 수 있다. 구조화 건강 원본과 GPS/EXIF metadata는 입력 대상이 아니다.

## Changes

- raw Unicode 안전성 검사와 exact-source guard 추가
- verifier에 `semantic_mismatch` fail-closed 경계 추가
- 맥락 절단, 숫자·부호·인용·공백·Unicode 우회 회귀 테스트 추가
- 뒤 배치의 한 줄 실패가 앞 배치까지 포함해 하루 전체 fallback하는 Story 통합 테스트 추가

## Verification

- Focused Vitest: 8 files / 182 tests PASS
- Target ESLint: PASS
- Full TypeScript typecheck: PASS
- Non-secret placeholder production build: PASS, 2,536 modules
- Independent adversarial review: PASS, CRITICAL/HIGH/MEDIUM/LOW 모두 0
- Direct probes: 43/43 expected, mismatch 0
- Physical iPhone Foundation Models: UNVERIFIED

## Risks

- 현재 방화벽은 의도적으로 보수적이라 실질적인 문장 압축은 거의 허용하지 않는다.
- 다음 120→40 발췌 구현은 exact contiguous source, 눈에 보이는 생략 표시, exact original one-tap 이동을 함께 새로 검증해야 한다.
- 온디바이스 처리는 앱 서버로 본문을 보내지 않는다는 장점일 뿐, OS·기기·백업·스크린샷까지 포함한 완전한 보안이나 E2EE를 뜻하지 않는다.
- 실제 모델 품질·지원 기기·지연·발열·배터리는 실물 기기 전까지 UNVERIFIED다.

## Current Score

- Product: 7.7/10 — 하루 기록 정리의 원문 연결 계약은 명확, 유용한 발췌는 미완료
- UX: 7.4/10 — 실패 시 원문 fallback은 안전, 생략 표시는 미완료
- Design: 7.5/10 — 이번 gate는 시각 변경 없음
- Engineering: 8.2/10 — fail-closed 검증과 atomic fallback을 테스트로 고정
- Security: 7.9/10 — 모델 출력 오염 경계 폐쇄, 실기기·전체 E2EE는 별도
- Release readiness: 6.7/10 — default-OFF 안전 baseline이며 기기 gate가 남음

## Next Highest-ROI Goal

정원 좌표·접근성 회귀를 독립 검토로 폐쇄한 뒤, 공유 가능한 하루 원문 최대 120자에서 40자 이내 exact contiguous excerpt를 만들고 생략을 명시하며 같은 recordId의 정확한 원문으로 이동하는 온디바이스 계약을 별도 TDD·Native·실기기 gate로 구현한다.
