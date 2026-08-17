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
| 수익화·보존·미디어·기억상품 가격·검증 가설 | [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) |
| Book Studio 제품 방향 | [`PRODUCT_V3.md`](PRODUCT_V3.md) §12.5 |
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
3. [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) (사업·고객·BM·AI·미디어·기억·시장·KPI에 영향이 있는 경우)
4. [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md)
5. [`CURRENT_STATE.md`](CURRENT_STATE.md)
6. 작업과 직접 관련된 specialist 문서 하나 이상

엔지니어링 작업은 [`AGENTS.md`](../AGENTS.md)도 읽는다. DB·보안·암호·채팅·디자인
작업일 때만 위 표의 해당 문서를 추가한다. 모든 Markdown을 무조건 읽을 필요는 없다.

## 4. 새 Control Tower / 새 AI 시작 방법

새 세션은 대화 기억을 복구 수단으로 사용하지 않는다. 다음 순서로 저장소 문서를
읽고, 마지막에 volatile 사실을 live 확인한다.

```text
CLAUDE
→ PRODUCT
→ BUSINESS (사업·고객·BM 영향 시)
→ ENGINEERING ROADMAP
→ CURRENT_STATE
→ WORK_LOG latest relevant entries
→ PROJECT_HANDOFF
→ AGENTS
→ specialist docs
→ live GitHub verification
```

복구 직후 Control Tower가 먼저 보고할 항목은 다음과 같다.

- CURRENT PHASE
- ACTIVE STEP
- ACTIVE PR
- VERIFIED HEAD
- LAST GATE
- CURRENT BLOCKER
- NEXT GATE
- STALE REVIEWS
- DO NOT ADVANCE UNTIL

PR inventory를 이 문서에 복사하지 않는다. active PR·HEAD·CI·mergeability는
`CURRENT_STATE.md`의 checkpoint와 live GitHub를 함께 사용하되, 항상 live 값을
다시 검증한다.

## 5. 다른 AI가 시작하는 방법

1. 작업 범위를 제품 기능, 구현 순서, 현재 결함, 계약, 또는 운영 상태로 분류한다.
2. 위 표에서 해당 authoritative home을 확인하고, 관련 코드 경로를 직접 추적한다.
3. 문서의 과거 서술이나 migration 파일만으로 현재 구현·운영 상태를 단정하지 않는다.
4. 변경 후 `docs/WORK_LOG.md`에 짧은 색인 항목을 남기고, 실행한 검증과 하지 않은 검증을
   구분한다.

## 6. 유지 원칙

- 이 문서에 제품 비전, 상세 암호 프로토콜, 장문의 blocker 목록, migration 표, PR
  inventory, 완료 이력을 추가하지 않는다. 이미 소유자가 있는 문서로 연결한다.
- PR·HEAD·CI·운영 상태처럼 휘발성인 사실은 live repository/GitHub/Supabase에서
  작업 시점에 확인한다.
- 새로운 canonical 문서를 만들기 전에 기존 authoritative home이 없는지 먼저 확인한다.
- `CURRENT_STATE.md`는 휘발성 문서이므로 실제 코드와 대조해 갱신한다.

## 7. 문서 분류와 최신 사업전략 경계

### Canonical

- `PRODUCT_V3.md`: 제품 의도·North Star·Daily Core·제품 경계
- `BUSINESS_MEMORY_ROADMAP_V1.md`: 고객·문제·시장·BM·Memory Product·M1–M8·팀·사업화 판단
- `ENGINEERING_ROADMAP.md`: P-stage 기술 의존성·gate·M↔P crosswalk
- `CURRENT_STATE.md`: 현재 저장소·branch·Production 검증 현실
- `WORK_LOG.md`: 세션 작업 원장
- 이 문서: 새 AI의 복구 지도

### Supporting / historical source packets

| 분류 | 문서 | 사용 규칙 |
|---|---|---|
| SUPPORTING | `CHAT_PRODUCT_DATA_CONTRACT_V1.md`, E2EE·DATA_LEGAL·SECURITY specialist 문서 | 각 전문영역의 세부 계약·보안 판단에만 사용 |
| HISTORICAL SNAPSHOT | `SERVICE_OVERVIEW.md`, `FEATURE_SPEC.md`, 기존 디자인·운영 문서 | 구현·시각·운영 참고. 현재 제품 의도·사업전략의 단일 근거가 아님 |
| SUPERSEDED | `PRODUCT_PRD.md`, `BEGINNER_PROJECT_ROADMAP.md`, `implementation_plan v1.md`, `implementation_plan_v2.md` | 역사적 시나리오·계획·분석으로 보존. 현재 방향과 충돌하면 사용하지 않음 |
| LOCAL / USER-SUPPLIED SUPPORTING SUBMISSION PACKET — NOT PRESENT IN REPOSITORY / NOT CANONICAL | `GOMSINLOG_BUSINESS_PLAN_MASTER_V2_FINAL.md`, `GOMSINLOG_PRODUCTION_BRIEF_V1_FINAL.md` | 이 저장소에 포함되지 않은 제출 원고·원자료 증빙 패킷. 새 repository agent는 읽을 수 없으며, 최신 MASTER PLAN과 충돌하는 과거 가격·저장용량 과금 표현은 superseded |
| OPERATIONAL PROMPT | `CLAUDE_OPUS_5_CROSS_VALIDATION_PROMPT.md` | canonical 문서를 읽고 검증하도록 지시하는 실행 프롬프트. 독립 source of truth가 아님 |

최신 승인 사업전략과 충돌하면 `BUSINESS_MEMORY_ROADMAP_V1.md`와 사용자가 제공한 최신
MASTER PLAN을 우선하고, 원문은 삭제하지 않고 역사로 보존한다.

`CLAUDE_OPUS_5_CROSS_VALIDATION_PROMPT.md`는 canonical 문서를 읽도록 지시하는 실행
프롬프트다. 이 프롬프트 자체가 제품·사업전략의 독립적인 source of truth는 아니다.

특히 과거 저장용량 구독·기능별 유료화·초기 구독 우선·CloudKit 완료 표현·검증되지 않은
성과 숫자는 현재 사업전략의 근거로 사용하지 않는다.
