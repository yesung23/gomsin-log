# 곰신로그 프로젝트 핸드오프 — 2026-08-13

> **이 문서의 역할.** `CLAUDE.md`·`AGENTS.md` 다음으로 읽는 문서. 처음 합류하는
> 사람이나 다른 AI(Codex, Kiro, Gemini 등)가 "이 저장소가 뭐고, 뭐가 이미 있고,
> 뭘 먼저 읽어야 하는지"를 빠르게 파악하기 위해 존재한다.
>
> **이 문서는 프로토콜·제품 규칙을 복제하지 않는다.** 각 canonical 문서를
> 가리키기만 한다. 여기 적힌 요약과 원본이 어긋나면 **원본이 이긴다.**
>
> 기준: `origin/master` @ `58efb7d`, PR #52 merge commit `58efb7d`, PR #53
> head `f6bff1a` (branch `docs/project-handoff-business-memory`), 2026-08-14.

---

## 0. 다른 AI가 작업을 이어갈 때 — 먼저 읽을 것

1. **저장소 코드가 문서를 이긴다.** 오래된 문서의 주장으로 제품 방향을
   바꾸지 않는다. 현재 구현 사실은 코드로 재확인한다 (`CLAUDE.md` 우선순위 3).
2. **`CLAUDE.md`를 가장 먼저 읽는다.** 작업 기록을 어디에 남기는지, 문서
   충돌 시 무엇이 이기는지가 거기 있다.
3. **`docs/WORK_LOG.md`를 세션마다 갱신한다.** 색인일 뿐이다 — 이유는 커밋
   메시지에, 검증 결과는 PR 본문에 쓴다. 같은 내용을 두 번 쓰지 않는다.
4. **함부로 배포하지 않는다.** 프로덕션 마이그레이션 적용, RLS 정책 변경,
   실제 데이터 mutation은 사람의 명시적 승인 없이 하지 않는다.
5. **Git에 있다는 것이 프로덕션에 적용됐다는 증거가 아니다.** 저장소에
   커밋된 마이그레이션 파일은 "코드로 존재한다"는 뜻일 뿐이다. 운영 상태는
   `supabase/migrations/README.md`가 유일한 출처이고, 그 문서 자체가
   "적용됨"과 "커밋됨"을 절대 섞지 않는다.
6. **보안 경계를 바꾸는 작업은 반드시 실제 PostgreSQL 액터 테스트로
   증명한다.** 이 저장소는 mutation testing 없이 통과한 보안 단언이
   실제로는 공허했던 사례를 **최소 세 번** 냈다(028 private media, 038
   멤버십 게이트, 029 service-role 게이트 — 전부 "바깥 계층이 안 계층에
   가려 한 번도 실행되지 않음" 패턴). 검사를 지웠을 때 반드시 실패하는지
   확인하지 않은 보안 테스트는 증명이 아니다.
7. **PMK / CSK / HRK 불변식을 보존한다.** HRK는 어떤 이유로도 CSK로
   대체되거나 공유되지 않는다. 세 스코프 키는 독립적으로 뽑히고 서로에서
   유도되지 않는다 (`E2EE_PHASE_1A_ARCHITECTURE_V2_1.md` §2, §1의 불변식 목록).
8. **타의로 UI를 재설계하지 않는다.** 시각 디자인은 `DESIGN_V2.md`가 이기고,
   별도 워크스트림 소관이다 (`AGENTS.md` §1). 작업 지시가 명시적으로
   요청하지 않는 한 화면을 다시 그리지 않는다.
9. **곰신로그를 범용 메신저·소셜앱으로 확장하지 않는다.** §2의 제품 필터를
   통과하지 못하는 기능은 코어에 들어가지 않는다.
10. 이 문서(`PROJECT_HANDOFF_2026-08-13.md`)는 스냅샷이다. 시간이 지나
    저장소가 바뀌면 **저장소가 이긴다** — 이 문서를 갱신하거나, 최소한
    어긋난 지점을 지적한다.

---

## 1. 곰신로그란

> **"함께하지 못한 시간까지, 서로의 하루가 이어지도록."**

서로의 하루가 겹치지 않는 커플을 위한 사적인 공간. 시작은 군 복무 중인
커플(곰신 · 군화)이지만, 근무 교대 · 유학 · 파견 등 스케줄이 어긋나는 모든
커플로 확장 가능한 문제를 푼다.

지금은 놓친 하루를 이어주고, 장기적으로는 그렇게 이어온 시간을 안전하게 쌓아 다시
꺼내보고 손에 남길 수 있게 하는 **둘만의 사적인 기억 보관소**로 확장된다. 이는
`PRODUCT_V3.md`의 두 horizon을 요약한 것이며, 가격·인프라·수익화 가설은
[`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md)가 다룬다.

### 코어 루프

```text
가볍게 기록
  → 상대방의 오늘
  → 정확한 원본
  → 반응 / 이따 이야기하기
  → 채팅
  → 실제 대화
  → 추억 축적
```

코어 기능: 기록 · 상대방의 오늘 · 정확한 원본 · 반응 · 이따 이야기하기 ·
채팅 · 사진/미디어 · 일정 · 추억 · 아카이브.

전체 서술은 `PRODUCT_V3.md`가 canonical이다. 이 절은 그 요약일 뿐이다.

---

## 2. 제품 필터 — 이 기능이 코어에 들어가야 하는가

> **"이 기능이 서로의 하루를 더 잘 이어주는가?"**

아니라면 보통 코어가 아니다. 곰신로그는 다음이 **아니다**:

- 공개 소셜 미디어
- 범용 메신저 (카카오톡 대체)
- 군 정보 포털
- 그룹 채팅
- 작업/할일 관리 툴
- AI 관계 평가·점수화 시스템
- 광고 피드
- 무거운 게이미피케이션 제품

이 필터는 `PRODUCT_V3.md`의 North Star와 §14의 비목표에서 온다. 신규
기능을 제안할 때 항상 먼저 통과시킨다.

---

## 3. 지금 이 저장소가 어떤 상태인가 (repository truth)

이 절의 숫자는 이 핸드오프 작성 시점의 스냅샷이다. 시간이 지나면
`git log`, `gh pr list`, `supabase/migrations/README.md`로 재확인한다 —
이 표를 근거로 삼지 않는다.

### master

- `origin/master` HEAD: **`58efb7d`**
- 최근 머지: PR #52(P4 채팅 계약), PR #51(WORK_LOG 색인화)

### 열려 있는 PR

현재 확인된 열린 PR은 **8개**이며, 이 핸드오프의 현재 작업 PR은 #53이다.

| # | 브랜치 → 베이스 | 상태 | 비고 |
|---|---|---|---|
| **53** | `docs/project-handoff-business-memory` → `master` | **OPEN, 현재 핸드오프 PR.** head `f6bff1a` | 프로젝트 핸드오프·장기 비즈니스/메모리 방향 문서 갱신 |
| 2–9 | `kiro/*`, `codex/*` 브랜치들 (서로를 베이스로 함, `master` 아님) | 대부분 draft, 일부 CONFLICTING | **레거시 — 2026-07-30 전후 작업 체인으로 보인다.** 이 핸드오프에서 내용을 검증하지 않았다. 다른 AI는 이 PR들을 현재 작업 기준으로 삼지 말고, 병합 전 사람이 먼저 그 브랜치 계보와 현재 `master`의 정합성을 재검토해야 한다 |

### 마이그레이션 — 트래킹 상태 (2026-08-13 저장소 조사)

`supabase/migrations/README.md`가 유일한 운영 상태 출처다. 요약:

| 상태 | 마이그레이션 |
|---|---|
| **운영 적용됨 (2026-08-11, 확인됨)** | 020, 021, 022, 023, 024, 025, 026, 027 |
| **Git 추적됨 / 운영 미적용 — 배포 전 read-only 재확인 필요** | 028, 029, 030, 037, 038 |
| **신규 / 어디에도 미적용** | 031(E2EE 키 기반), 032(write floor), 034(복구 챌린지) |
| **README 원장에 행 자체가 없음 — 문서 갭** | **035, 036** — 둘 다 저장소에 존재하고 (035: Phase 1A P0 마감, 036: `devices.status` 권한 강화) `ENGINEERING_ROADMAP.md`가 마이그레이션 체인에 명시적으로 포함시키지만(031→032→034→035→036), 마이그레이션 README 파일 목록 표에 행이 없다. **이 핸드오프에서 그 갭만 기록한다 — README를 고치는 것은 이 작업의 범위 밖이다** |

**028–030 배포 논쟁은 이미 해소됐다.** 두 개의 독립 기록(마이그레이션
원장 + 2026-08-11 DATA_LEGAL read-only 감사)이 일치해서 "**프로덕션에
적용되지 않았다**"로 판정됐다 (`CURRENT_STATE.md` §3). 이 판정 자체는
2026-08-11 read-only 감사 시점 기준이며, 이번 핸드오프에서 원격을 다시
조회하지 않았다.

**이 핸드오프 작업에서 프로덕션을 조회하거나 변경하지 않았다.**

---

## 4. 다음에 읽을 순서

실제 저장소 우선순위(`CLAUDE.md`)에서 유도했다. 무엇을 하려는지에 따라
갈라진다.

### 항상

1. [`CLAUDE.md`](../CLAUDE.md) — 작업 규칙, 문서 우선순위
2. [`AGENTS.md`](../AGENTS.md) — 엔지니어링 계약, 워크스트림 경계
3. 이 문서 (`PROJECT_HANDOFF_2026-08-13.md`)

### 제품 방향을 결정하거나 확인할 때

4. [`PRODUCT_V3.md`](PRODUCT_V3.md) — canonical 제품 의도
5. [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md) — canonical 구현 순서
6. [`CURRENT_STATE.md`](CURRENT_STATE.md) — 저장소 결함/미구현 (휘발성,
   §7에서 매번 재확인)

### 특정 기능을 구현할 때

7. 해당 기능 계약이 있으면 먼저 읽는다 — 지금은
   [`CHAT_PRODUCT_DATA_CONTRACT_V1.md`](CHAT_PRODUCT_DATA_CONTRACT_V1.md)
   (채팅) 하나뿐이다

### User Content(암호화 대상 데이터)를 건드릴 때

8. [`E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`](E2EE_PHASE_1A_ARCHITECTURE_V2_1.md)
   — canonical 암호 프로토콜
9. [`DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`](DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md)
   — canonical 프라이버시·법적 판단, 데이터 분류
10. [`privacy-access-matrix.md`](privacy-access-matrix.md) — RLS/Storage
    접근 매트릭스 (실시간 DELETE payload에 RLS가 안 걸리는 이유 등 구체적
    함정이 여기 있다)

### DB를 건드릴 때

11. [`supabase/migrations/README.md`](../supabase/migrations/README.md) —
    마이그레이션 원장, 운영 적용 상태의 유일한 출처

### 비즈니스/수익화 방향이 필요할 때

12. [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) — 신규,
    이 핸드오프에서 함께 작성

### 시각 디자인을 건드릴 때 (별도 워크스트림)

13. [`DESIGN_V2.md`](DESIGN_V2.md)

---

## 5. 문서 지도 — 무엇이 있고, 무엇이 진짜 기준인가

카테고리별. 각 파일: 목적 · 상태 · 언제 읽는가. **충돌 시 무엇이 이기는가**는
`CLAUDE.md`의 7단계 우선순위를 따른다 — 여기서 반복하지 않고 해당되는 곳에만
표시한다.

### A. 시작 지점 / AI 운영 문서

| 파일 | 목적 | 상태 |
|---|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | 작업 기록 위치, 문서 우선순위 7단계, 기록 규칙 | **CANONICAL** — 가장 먼저 읽는다 |
| [`AGENTS.md`](../AGENTS.md) | 엔지니어링 계약: 이 워크스트림이 소유하는 것(기능·데이터·보안)과 소유하지 않는 것(시각 디자인) | **CANONICAL** (우선순위 6) |
| `docs/PROJECT_HANDOFF_2026-08-13.md` (이 문서) | 새 합류자/AI를 위한 지도 | **CURRENT SUPPORTING** — 스냅샷, 시간이 지나면 저장소가 이긴다 |

### B. 제품

| 파일 | 목적 | 상태 |
|---|---|---|
| [`PRODUCT_V3.md`](PRODUCT_V3.md) | 제품 의도 canonical. North Star, 코어 루프, 비목표, 채팅/사진/미디어 분류, 감정 프라이버시 규칙, 연결해제/계정삭제 계약 | **CANONICAL** (우선순위 1) |
| [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md) | 장기 비즈니스 방향: 요금제, 저장소 전략, 실물 메모리북 | **CANONICAL for 비즈니스/수익화** — 신규, PRODUCT_V3의 §12.3(오디오/영상)이 여기를 가리키도록 갱신했다 |
| [`PRODUCT_PRD.md`](PRODUCT_PRD.md) | 이전 통합 PRD (v5, 2026-08-09) | **LEGACY / SUPERSEDED (방향만)** — `PRODUCT_V3.md`가 자신의 서문에서 명시적으로 "PRD의 제품 방향을 대체한다"고 선언한다. **다만 PRD의 시나리오·와이어프레임은 참고 자료로 유효하다**고 V3가 직접 인정한다 |
| [`FEATURE_SPEC.md`](FEATURE_SPEC.md) | 기능별 구현/검증/후보 상태표 (2026-08-08 기준) | **CURRENT SUPPORTING, 주의 필요** — PRODUCT_V3가 "현행 구현 서술이므로 V3의 목표 상태와 다를 수 있다"고 명시. 구현 현황 참고엔 쓰되 목표 상태는 V3를 따른다 |
| [`SERVICE_OVERVIEW.md`](SERVICE_OVERVIEW.md) | 5분 안에 곰신로그를 이해하는 입문 문서 | **CURRENT SUPPORTING, 주의 필요** — 위와 같은 이유로 V3와 다를 수 있음 |
| [`USER_FLOWS.md`](USER_FLOWS.md) | 상세 화면 전환·오류·복구 분기 | **LEGACY reference** — 스스로 "PRODUCT_PRD.md v5가 기준"이라 밝힘. PRD가 방향 면에서 superseded이므로 세부 분기 참고용으로만 사용 |
| [`WIREFRAMES.md`](WIREFRAMES.md) | 화면 상태·와이어프레임 확장 | **LEGACY reference** — 위와 동일한 근거 |
| [`PRODUCT_REVIEW.md`](PRODUCT_REVIEW.md) | "무엇을 더 만들고 무엇을 멈출 것인가" 비평 문서 | **HISTORICAL** — PRODUCT_V3의 범위 축소(오디오/영상 강등, "카카오톡 대체 아님" 등) 판단에 선행 입력으로 보인다. 결정 자체는 이제 PRODUCT_V3에 반영되어 있다 |
| [`BEGINNER_PROJECT_ROADMAP.md`](BEGINNER_PROJECT_ROADMAP.md) | 비전공 담당자를 위한 개발·배포 로드맵 (2026-07-30) | **HISTORICAL** — `implementation_plan_v2.md`(2026-07-28 시점) 기준. 현재 로드맵은 `ENGINEERING_ROADMAP.md` |
| [`FREE_PLANNING_ARCHITECTURE.md`](FREE_PLANNING_ARCHITECTURE.md) | 무료 지도 API 없이 동작하는 일정/여행 플래너 구조 | **CURRENT SUPPORTING (좁은 범위)** — 특정 기능(일정/여행) 아키텍처 노트, 신규 수익화 방향과 무관하게 유효 |

### C. 엔지니어링 / 현재 상태

| 파일 | 목적 | 상태 |
|---|---|---|
| [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md) | 구현 **순서**만. P0-a부터 P10까지, Beta/Production 게이트 | **CANONICAL** (우선순위 2) |
| [`CURRENT_STATE.md`](CURRENT_STATE.md) | 저장소의 현재 결함·미구현·828–030 배포 판정. **의도적으로 휘발성** | **CANONICAL for "지금 무엇이 깨져 있는가"** — 항목 해소되면 삭제하는 문서라 항상 최신이어야 함 |
| [`WORK_LOG.md`](WORK_LOG.md) | 세션 단위 작업 색인 | **WORK LOG** — 이유·근거는 커밋 메시지, 검증은 PR 본문에 있고 여기는 링크+요약만 |
| [`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md) | 제품 약속 ↔ 코드 경로 ↔ 검증 매핑 (2026-08-08 기준) | **HISTORICAL, 재검증 필요** — PRODUCT_V3/ENGINEERING_ROADMAP보다 오래됨. 매핑 아이디어는 유효하나 각 행을 코드로 재확인해야 한다 |
| [`implementation_plan v1.md`](implementation_plan%20v1.md) | v1 시점 서비스 청사진 | **LEGACY / 명시적 스냅샷** — 파일 자체가 "현재 상태의 근거로 쓰지 마세요"라고 경고한다 |
| [`implementation_plan_v2.md`](implementation_plan_v2.md) | 2026-07-28 시점 구현 청사진 | **HISTORICAL** — `ENGINEERING_ROADMAP.md`로 대체됨 |
| [`release-readiness-audit.md`](release-readiness-audit.md) | Phase A 정적 분석 (구 에이전트 환경, npm/git 제약 있던 시절) | **HISTORICAL** — 이후 `scripts/phase0/storage-authz-harness.mjs` 같은 실제 PostgreSQL 액터 하네스로 대체된 접근 |
| [`rls-test-matrix.md`](rls-test-matrix.md) | 마이그레이션 005–007용 RLS 테스트 매트릭스 (A/B/C 계정) | **HISTORICAL** — 이후 마이그레이션(028, 038 등)은 harness 기반 mutation-tested 증명으로 검증됨 |
| [`PHASE0_LEGACY_CYCLE_MIGRATION_PLAN_2026-08-11.md`](PHASE0_LEGACY_CYCLE_MIGRATION_PLAN_2026-08-11.md) | 레거시 주기 데이터 정리 절차 계획 (DROP/DELETE 없음, 보존 우선) | **DRAFT, 저장소에 아직 커밋되지 않음** (git status에 `??`) — 실행되지 않은 계획. `CURRENT_STATE.md` §2-16(레거시 건강 평문)과 연결된 것으로 보이나, 이 핸드오프에서 커밋하지 않았다. 다음 작업자가 검토 후 커밋 여부를 결정한다 |

### D. E2EE / 보안 / 프라이버시

| 파일 | 목적 | 상태 |
|---|---|---|
| [`E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`](E2EE_PHASE_1A_ARCHITECTURE_V2_1.md) | canonical 암호 프로토콜: PMK/HRK/CSK 키 계층, 기기 인증서 그래프, GLK2/GLE1 봉투, epoch 상태 기계, write floor, rollback 보증, 정직한 한계 | **CANONICAL** (우선순위 4) |
| [`DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`](DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md) | canonical 프라이버시·법적 판단. 데이터 분류(Tier 0–3), 신뢰 경계, E2EE 스코프, 마이그레이션 계획, 릴리스 블로커 | **CANONICAL** (우선순위 5) |
| [`privacy-access-matrix.md`](privacy-access-matrix.md) | Zero Trust 접근 매트릭스. RLS/Storage가 최종 경계라는 원칙과 구체적 함정(예: Realtime DELETE payload는 RLS 미적용 — §F) | **CURRENT SUPPORTING, 실제로 인용됨** — 채팅 계약(§9.2)이 여기 §F를 직접 근거로 든다 |
| [`E2EE_1A1_SPIKE_REPORT.md`](E2EE_1A1_SPIKE_REPORT.md) | Phase 1A-1 플랫폼/암호 상호운용성 스파이크 (실제 하드웨어 검증 포함, Android는 미검증으로 남음) | **HISTORICAL EVIDENCE** — 결론은 Architecture V2.1에 흡수됨. 원본 실험 기록으로서 유효 |
| [`E2EE_IMPLEMENTATION_PLAN.md`](E2EE_IMPLEMENTATION_PLAN.md) | 이전 E2EE 구현 계획 (커플당 단일 CMK) | **명시적 SUPERSEDED** — 파일 첫 줄이 "V2.1로 대체됨"이라 선언. CMK 단일 키 구조는 V2.1의 불변식 4·5(HRK 절대 파트너 공유 금지)를 위반하므로 폐기됐다. 역사 보존용으로만 남음 |
| `scripts/phase0/storage-authz-harness.mjs`, `scripts/e2ee/*.mjs` | 실제 PostgreSQL 클러스터에 전체 마이그레이션을 적용하고 실제 RLS 액터로 검증하는 하네스 | **CURRENT — 실행 가능한 증명**, 문서가 아니라 코드지만 "무엇이 실제로 검증됐는가"의 근거 |
| [`SECURITY_TEST_PLAN.md`](SECURITY_TEST_PLAN.md) | DB REST API/Storage API/RLS 종합 보안 테스트 계획 | **HISTORICAL, 부분 대체됨** — 위 하네스 기반 접근이 최신 마이그레이션(028, 029, 038 등)의 실제 검증 방식이다. 계획 자체의 문제의식("구현 여부 ≠ 검증 여부")은 여전히 유효 |
| [`REMOTE_SUPABASE_AUDIT_2026-07-30.md`](REMOTE_SUPABASE_AUDIT_2026-07-30.md) | 원격 Supabase read-only 감사 (2026-07-30 시점) | **HISTORICAL EVIDENCE** — 특정 시점 증거. 더 최신 감사는 DATA_LEGAL 문서의 2026-08-11 read-only 조회 |

### E. 기능 계약

| 파일 | 목적 | 상태 |
|---|---|---|
| [`CHAT_PRODUCT_DATA_CONTRACT_V1.md`](CHAT_PRODUCT_DATA_CONTRACT_V1.md) | 채팅 제품·데이터·E2EE 계약 V1. 스코프, 메타데이터 예산(6필드), GLE1 object type, epoch 강제, tombstone, 계정 삭제, 25가지 위협 모델, 구현 게이트 C1–C12 | **CANONICAL for 채팅** — `PRODUCT_V3.md` §12.1이 여기를 가리킨다. PR #52로 머지됨 |

이 카테고리는 지금 하나뿐이다. 앞으로 daily_records E2EE(P5), 암호화 미디어(P6)
등도 구현 전에 이런 형태의 계약을 먼저 쓰는 것을 권장한다 — 그게 P4의 존재
이유였다.

### F. 디자인

| 파일 | 목적 | 상태 |
|---|---|---|
| [`DESIGN_V2.md`](DESIGN_V2.md) | canonical 시각 디자인 (2026-08-08 개정) | **CANONICAL** (우선순위 7) — 별도 워크스트림 소관, `AGENTS.md` §1 |
| [`DESIGN_V2.1_VISUAL_PILOT.md`](DESIGN_V2.1_VISUAL_PILOT.md) | DESIGN_V2의 마지막 미검증 시각 수용 기준 1개를 판정하기 위한 파일럿 프로토콜 | **DRAFT / 검증 대기** — 실행된 결과가 아니라 프로토콜 자체. 기능·프라이버시 검증은 범위 밖(PILOT_GUIDE로 위임) |
| [`KIRO_DESIGN_IMPLEMENTATION_PROMPT.md`](KIRO_DESIGN_IMPLEMENTATION_PROMPT.md) / [`_EN.md`](KIRO_DESIGN_IMPLEMENTATION_PROMPT_EN.md) | Kiro에게 디자인 구현을 지시하기 위한 프롬프트 문서 | **TOOLING PROMPT, 콘텐츠 아님** — 그 자체가 canonical 디자인 소스가 아니라 DESIGN_V2를 실제 구현에 옮기라는 지시문 |

### G. 마이그레이션 / 데이터베이스 문서

| 파일 | 목적 | 상태 |
|---|---|---|
| [`supabase/migrations/README.md`](../supabase/migrations/README.md) | 마이그레이션 원장. 파일별 목적 + **운영 적용 상태의 유일한 출처** | **CANONICAL for 운영 상태** — "적용됨"과 "커밋됨"을 구분하는 원칙이 여기 명시돼 있다. **문서 갭: 035, 036이 파일 목록 표에 없다** (§3 참고) |
| [`SUPABASE_DEPLOY_GUIDE.md`](SUPABASE_DEPLOY_GUIDE.md) | Supabase 연동·마이그레이션·RLS·Storage·배포(Vercel/Netlify) 운영 가이드 | **CURRENT SUPPORTING (운영 절차)** |
| [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) | (구) 셋업 안내 | **REDIRECT STUB** — 파일 자체가 "`SUPABASE_DEPLOY_GUIDE.md`로 통합되어 재작성되었다"고 밝힘. 삭제하지 않았지만 내용은 없다 |

### H. 파일럿 / 운영

| 파일 | 목적 | 상태 |
|---|---|---|
| [`PILOT_GUIDE.md`](PILOT_GUIDE.md) | 비공개 파일럿 운영자 지침 + 개인정보 수칙 | **CURRENT SUPPORTING** |
| [`PWA_PILOT_GUIDE.md`](PWA_PILOT_GUIDE.md) | iPhone Safari PWA 설치/테스트 지침 | **CURRENT SUPPORTING** |
| [`CLAUDE_OPUS_5_CROSS_VALIDATION_PROMPT.md`](CLAUDE_OPUS_5_CROSS_VALIDATION_PROMPT.md) | Claude Opus 5에게 교차검증을 맡기기 위한 프롬프트 원문 | **TOOLING PROMPT** — 실행 스크립트에 가까움, canonical 콘텐츠 아님 |

### 저장소에 있지만 문서가 아닌 것 (untracked, 건드리지 않음)

`.codex/`, `.kiro/agents/`, `claude_design/`, `supabase/.temp/` — 다른 AI
툴(Codex, Kiro)과 로컬 디자인 탐색의 작업 디렉터리로 보인다. git에 커밋되지
않은 상태(`??`)이며, 이 핸드오프는 내용을 검증하거나 정리하지 않았다.
다른 작업자의 진행 중 산출물일 수 있으므로 **삭제하지 않는다.**

---

## 6. 지금까지 완료된 단계

PR 번호·머지 상태로만 요약한다. 자세한 내용은 각 PR과 `WORK_LOG.md`.

| 단계 | 내용 | PR | 상태 |
|---|---|---|---|
| Phase 0 | 마이그레이션 028–030 기준선 정리 + 실제 PostgreSQL 하네스 도입 + 037 신규(계정 삭제 생존자 판정 P1 수정) | #48 | 머지됨 |
| Product V3 | 제품 문서를 PRODUCT_V3 / ENGINEERING_ROADMAP / CURRENT_STATE로 분리. 채팅·사진 코어 승격, 오디오/영상 강등 | #47 | 머지됨 |
| Core Day Loop P0-a → P3 | 기록 작성 진입점 복구, 작성자 태그, 감정 프라이버시(opt-in), 상대방의 오늘 통합, 원본 라우트 주소 지정 | #49 | 머지됨 |
| P3 bilateral 이따 이야기하기 | `talk_about_marks` 메타데이터 전용 테이블, RLS 증명 | #50 | 머지됨 |
| WORK_LOG 색인화 | 작업 기록 위치를 CLAUDE.md에 명시 | #51 | 머지됨 |
| **P4 채팅 계약** | 채팅 제품·데이터·E2EE 계약 확정 (스키마·코드 없음). 초판 이후 보안 결함 3건(ACTIVE epoch 강제, tombstone 표현, 계정삭제 CASCADE 모순) 정정 | **#52** | **머지됨 (`58efb7d`)** |

**다음 엔지니어링 단계는 P5 — `daily_records` E2EE 수직 슬라이스**다
(`ENGINEERING_ROADMAP.md` 단계표). P4는 순서를 바꾸지 않았다 — 채팅을
P5보다 먼저 구현하라는 뜻이 아니라, 나중에 scope/epoch/맥락참조 의미가
어긋나지 않게 하는 계약일 뿐이다.

**이 핸드오프 작업은 P5를 시작하지 않았다. P5가 다음 엔지니어링 단계다.**

---

## 7. 보안 / 프라이버시 모델 — 요약, 링크로

전체 프로토콜은 다시 쓰지 않는다. 방향만.

- **목표:** Full User-Content E2EE + Minimal Server Metadata. 서버는
  콘텐츠를 평문으로 보지 않고, 인가에 필요한 최소 메타데이터(불투명 id,
  시각, 순서, 전달 상태)만 본다.
- **키 계층:** PMK(개인, epoch 1) / HRK(건강, epoch 2) / CSK(커플, epoch 3).
  세 스코프는 독립적으로 뽑히고 서로에서 유도되지 않는다.
- **결정적 불변식: HRK는 절대 CSK로 대체되거나 공유되지 않는다.** 개인
  건강 원본 데이터는 소유자 기기 밖으로 평문이 나가지 않는다. 파트너에게
  안전하게 보이는 주기 projection은 **소유자 기기에서 계산**해야 하며,
  서버가 평문 건강 데이터로 파트너용 projection을 계산해서는 안 된다.
  **현재 이 불변식이 깨져 있다** — `CURRENT_STATE.md` §2-12: 파트너
  projection을 서버가 평문 건강 데이터를 읽어 계산 중이다. 동의·설정
  게이트는 정확하지만 계산 위치가 문제다. Phase 1B에서 단순 이식이
  불가능해 재설계가 필요하다(`ENGINEERING_ROADMAP.md` P8).
- **봉투:** GLE1(콘텐츠, 92바이트 헤더+암호문+태그), GLK2(키, 360바이트).
  GLE1 AAD가 protocol·suite·format·domain·epoch·owner·scope·object
  type·object id·field id·content_revision을 묶는다.
- **Epoch 상태 기계:** PREPARING → READY → ACTIVE → RETIRED/ABANDONED.
  쓰기는 ACTIVE만 허용, 복호화는 ACTIVE+RETIRED 둘 다 허용.
- **원문:**
  [`E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`](E2EE_PHASE_1A_ARCHITECTURE_V2_1.md)
  (프로토콜),
  [`DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`](DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md)
  (분류·법적 판단),
  [`privacy-access-matrix.md`](privacy-access-matrix.md) (RLS/Storage 경계).

---

## 8. 프로덕션 진실 — Git ≠ 프로덕션

**Git에 파일이 있다는 것은 배포 증거가 아니다.** 정확한 현재 판정은
§3의 표를 참고한다. 요약:

- 020–027: **운영 적용됨 (2026-08-11 확인)**
- 028, 029, 030, 037, 038: **Git 추적됨, 운영 미적용 — 배포 전 read-only
  재확인 필요**
- 031, 032, 034: **어디에도 미적용** (신규 E2EE 인프라, Phase 1A는
  DEVELOPMENT 게이트만 열려 있음)
- 035, 036: 존재하지만 원장 표에 누락 — 상태 불명, 갭으로 기록

**이 핸드오프 작업은 프로덕션 mutation을 수행하지 않았다.** 조회조차
하지 않았다 — 이 작업은 문서 정리이며 운영 재검증은 범위 밖이다.

---

## 9. 열려 있는 보안/베타 블로커

`CURRENT_STATE.md`와 `ENGINEERING_ROADMAP.md`에서 가져온 것. 새로 지어낸
항목 없음 — 저장소에 이미 기록된 것만 분류를 정리해 옮겼다.

### P0 (핵심 루프 결함, 이미 대부분 해소 — P0-a~P3로 처리됨)

`CURRENT_STATE.md` §1의 항목들은 Core Day Loop 작업(#49)과 P3(#50)가
처리한 것들이 많다. 남아있는 항목은 `CURRENT_STATE.md` §1을 직접 확인한다
— 이 문서는 스냅샷이 아니라 항목이 해소되면 삭제되는 문서이므로 그쪽이
더 정확하다.

### BETA 블로커 (`ENGINEERING_ROADMAP.md` §4 + `CURRENT_STATE.md` §2)

| 블로커 | 분류 |
|---|---|
| Storage 권한 정책이 카탈로그와 실제 동작 양쪽으로 운영에 적용됐음을 검증 (028 재확인) | `SEC` `BETA` |
| 마이그레이션 원장과 원격 상태의 drift 해소 | `BETA` |
| 백업 부재에 대한 데이터 손실 정책 확정 및 사용자 고지 | `BETA` |
| **정밀 위치 게이트** — 여행 항목이 정밀 위경도를 평문으로 담음, 행 단위 공개 범위 없음 | `SEC` `BETA` |
| **평문 영상 게이트** — 영상 첨부가 구현·노출되어 있고 평문 업로드 | `PRODUCT` `BETA` |
| HRK↔CSK 방벽이 클라이언트 검사 한 곳뿐, 회귀 테스트 없음 | `SEC` `BETA` |
| 미확인 기계 추론 감정이 파트너 표면에 도달하지 않음을 negative test로 증명 | `SEC` `BETA` |

### PRODUCTION 블로커 (`ENGINEERING_ROADMAP.md` §5)

| 블로커 |
|---|
| Phase 1A 독립 보안 리뷰 |
| Phase 1A 마이그레이션의 프로덕션 배포 승인 및 적용 검증 |
| 분실 기기 / 복구 kit 드릴 실제 수행 |
| 계정 삭제·데이터 내보내기 재검증 (E2EE 자료 포함) |
| Full User-Content E2EE 주장 전, 평문 User Content 경로 0개 감사 |

### 그 외 알려진 결함 (`CURRENT_STATE.md` §2, P1/P2 성격)

- 파트너 주기 projection이 서버 평문 계산 (§7의 HRK 불변식 위반, P8에서
  재설계 예정)
- 평문 요약 캐시 테이블(`briefings`)이 스키마에 남음 — 경로 0, 정리 대상
  (`LEGACY`)
- 레거시 주기/백업 테이블 평문 잔존 (`LEGACY`) — §5D의
  `PHASE0_LEGACY_CYCLE_MIGRATION_PLAN_2026-08-11.md` 초안이 이걸 겨냥한
  것으로 보이나 아직 커밋되지 않음
- 연결 해제 RPC가 pairing 상태를 `UNLINKED`로 전이하지 않음 — **데이터
  누출 위험 아님**(코드가 이미 재연결 불가를 강제), 상태 일관성 문제로만
  분류 (`FUTURE`)

**이 블로커 목록은 이번 핸드오프에서 새로 지어낸 것이 없다.** 전부
`CURRENT_STATE.md`/`ENGINEERING_ROADMAP.md`에서 옮겨온 것이며, 정확한
최신 상태는 그 두 문서를 직접 본다.

---

## 10. 신규 — 장기 비즈니스/메모리 방향 (이번 핸드오프에서 확정)

전체 내용은 [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md).
요약만:

- 포지셔닝 진화: "커플 앱" → **"둘이 함께하지 못했던 시간까지 안전하게
  보관하고, 나중에는 손에 잡히는 기억으로 만들어주는 사적인 기억 보관소"**
- 4개의 상호보완적 수익 축: ① 커플 커스터마이징/디지털 굿즈 ② 유료 미디어
  저장/아카이브 ③ Book Studio/기억 보존 도구 ④ 실물 메모리북
- Free / Plus / Archive 3단 구독 — **전부 초기 가설, 확정 가격 아님**
- 원본 화질 사진 + 음성 + 1080p 영상은 **코어 이후 유료 미디어 확장**으로
  로드맵에 편입 (V1 코어도, E2EE 미디어 기반 이전도 아님)
- 관리형 클라우드(Cloudflare R2 등) 우선, 자체 서버는 지금 사지 않는다
- 실물 책은 POD(주문형 인쇄) 외주, 인쇄 장비를 사지 않는다
- "오늘의 책갈피" — AI가 아니라 **사용자가 직접** 무엇이 기억할 가치가
  있는지 표시. Book Studio는 결정론적 초안(Stage 1)이 먼저, AI 편집자는
  실물책 수요가 검증된 뒤(Stage 2)
- **보안은 절대 유료화하지 않는다.** E2EE, 코어 채팅/기록, 상대방의 오늘,
  이따 이야기하기는 항상 무료

이 방향은 이제 `PRODUCT_V3.md` §1·§4·§12에 제품 의도로 반영했다. 가격·용량·인프라·
수익화 메커니즘과 Book Studio 사업 가설은 중복하지 않고
`BUSINESS_MEMORY_ROADMAP_V1.md`를 가리킨다.

---

## 11. 이 문서의 유지

- 저장소가 크게 바뀌면(새 canonical 문서 추가, PR 병합, 마이그레이션 배포)
  이 문서를 갱신하거나 최소한 어긋난 지점을 지적한다.
- 이 문서에 제품 의도나 구현 순서를 새로 쓰지 않는다 — 각각
  `PRODUCT_V3.md`, `ENGINEERING_ROADMAP.md`로 보낸다.
- §3(저장소 진실)이 가장 빨리 stale해지는 절이다. PR 상태·마이그레이션
  원장을 항상 직접 재확인한다.
