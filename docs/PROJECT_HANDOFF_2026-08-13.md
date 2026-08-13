# 곰신로그 프로젝트 핸드오프

> 이 문서는 **지도(map)**다. 제품·구현·보안·운영 사실을 복제하는 두 번째
> 데이터베이스가 아니다. 각 질문의 답은 아래 canonical 문서와 저장소 코드에서
> 확인한다.

## 1. 곰신로그란

서로의 생활 시간이 어긋나는 커플이 함께하지 못한 하루를 기록하고, 상대방의 오늘과
정확한 원본을 통해 자연스러운 대화로 이어가는 사적인 공간이다. 제품 의도와 장기
방향은 [`PRODUCT_V3.md`](PRODUCT_V3.md)가 유일한 기준이다.

핵심 흐름:

```text
가볍게 기록 → 상대방의 오늘 → 정확한 원본 → 대화 → 실제 관계의 연속성
```

## 2. 무엇이 어디의 사실인가

| 질문 | authoritative home |
|---|---|
| 제품의 목적·North Star·범위·비목표 | [`PRODUCT_V3.md`](PRODUCT_V3.md) |
| 수익화·보존·미디어·Book Studio 가설 | [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) |
| 구현 순서와 engineering gate | [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md) |
| 현재 결함·미구현·차단 요소 | 저장소 코드, 그 다음 [`CURRENT_STATE.md`](CURRENT_STATE.md) |
| 암호 프로토콜 | [`E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`](E2EE_PHASE_1A_ARCHITECTURE_V2_1.md) |
| 개인정보·건강 데이터·법적 경계 | [`DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`](DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md) |
| 채팅 제품·데이터·보안 계약 | [`CHAT_PRODUCT_DATA_CONTRACT_V1.md`](CHAT_PRODUCT_DATA_CONTRACT_V1.md) |
| 시각 디자인 | [`DESIGN_V2.md`](DESIGN_V2.md) |
| 마이그레이션과 운영 적용 상태 | [`supabase/migrations/README.md`](../supabase/migrations/README.md) |
| 세션 작업 색인 | [`WORK_LOG.md`](WORK_LOG.md) |
| 엔지니어링 작업 규칙 | [`AGENTS.md`](../AGENTS.md) |

### 충돌 및 검증 규칙

- 현재 구현 사실은 문서보다 **저장소 코드가 이긴다**.
- Git에 migration 파일이 있다는 것은 운영 적용의 증거가 아니다. Git과 Production은
  분리해 확인하고, 운영 상태는 migration README를 기준으로 다시 검증한다.
- 보안 경계는 성공 경로만으로 충분하지 않다. 비인가 사용자·파트너·이전 파트너·anon
  거부를 포함한 실제 negative test가 필요하다.
- PMK·CSK·HRK는 독립적인 키 스코프이며, HRK를 CSK로 대체하거나 공유하지 않는다.
  세부 불변식은 E2EE architecture 문서가 소유한다.
- 시각 redesign은 별도 workstream이다. 기능·보안 작업에서 임의로 UI를 재설계하지
  않는다.

## 3. 권장 읽기 순서

일반 작업은 다음만 먼저 읽는다.

1. [`CLAUDE.md`](../CLAUDE.md)
2. [`PRODUCT_V3.md`](PRODUCT_V3.md)
3. [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)
4. [`CURRENT_STATE.md`](CURRENT_STATE.md)
5. 작업과 직접 관련된 specialist 문서 하나 이상

엔지니어링 작업은 [`AGENTS.md`](../AGENTS.md)도 읽는다. DB·보안·암호·채팅·디자인
작업일 때만 위 표의 해당 문서를 추가한다. 모든 Markdown을 무조건 읽을 필요는 없다.

## 4. 다른 AI가 시작하는 방법

1. 작업 범위를 제품 기능, 구현 순서, 현재 결함, 계약, 또는 운영 상태로 분류한다.
2. 위 표에서 해당 authoritative home을 확인하고, 관련 코드 경로를 직접 추적한다.
3. 문서의 과거 서술이나 migration 파일만으로 현재 구현·운영 상태를 단정하지 않는다.
4. 변경 후 `docs/WORK_LOG.md`에 짧은 색인 항목을 남기고, 실행한 검증과 하지 않은 검증을
   구분한다.

## 5. 유지 원칙

- 이 문서에 제품 비전, 상세 암호 프로토콜, 장문의 blocker 목록, migration 표, PR
  inventory, 완료 이력을 추가하지 않는다. 이미 소유자가 있는 문서로 연결한다.
- PR·HEAD·CI·운영 상태처럼 휘발성인 사실은 live repository/GitHub/Supabase에서
  작업 시점에 확인한다.
- 새로운 canonical 문서를 만들기 전에 기존 authoritative home이 없는지 먼저 확인한다.
- `CURRENT_STATE.md`는 휘발성 문서이므로 실제 코드와 대조해 갱신한다.
