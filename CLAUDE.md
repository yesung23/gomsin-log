# CLAUDE.md — 작업 규칙

앞으로 너가 작업하는 모든 내용을 별도의 md파일에 작성해줘

→ 그 파일은 **[`docs/WORK_LOG.md`](docs/WORK_LOG.md)** 다. 세션이 끝날 때마다
항목 하나를 추가한다.

> 절차가 필요한 작업은 아래 Skill을 쓴다. 이 파일에 절차를 복사하지 않는다.
>
> | 상황 | Skill | 원본 |
> |---|---|---|
> | 세션 시작·상태 복구·방향 확인 | `gomsin-control-tower` | `docs/skills/control-tower.md` |
> | 기능 구현 | `gomsin-feature-build` | `docs/skills/feature-build.md` |
> | 인증·E2EE·RLS·커플 lifecycle 검토 | `gomsin-security-review` | `docs/skills/security-review.md` |
> | migration 작성·검증 | `gomsin-migration-gate` | `docs/skills/migration-gate.md` |
> | 종료 전 검증 | `gomsin-release-validation` | `docs/skills/release-validation.md` |
>
> 여러 AI(Codex·Cursor·Antigravity·ChatGPT·Kiro·Grok)와 상태를 맞추는 절차는
> [`docs/AI_SESSION_PROTOCOL.md`](docs/AI_SESSION_PROTOCOL.md)가 소유한다.
> 세션은 `bash scripts/agent/session-start.sh` 하나로 시작한다.
>
> 절차의 원본은 [`docs/skills/`](docs/skills/README.md)이며 Codex·Kiro와 공유한다.
> Skill은 그 파일을 가리키는 얇은 래퍼다. 절차를 고칠 때는 원본만 고친다.

## Control Tower session protocol

대화 기억은 source of truth가 아니다. 새 채팅을 포함한 모든 비사소한 작업은
다음 순서로 현재 상태를 복구한다. 0번은 명령 하나로 1·5·6의 live 부분을 대신한다.

0. `bash scripts/agent/session-start.sh` — live 상태 · 다음 작업 · **다른 AI의 점유** · 최근 세션
1. 이 문서
2. [`docs/PRODUCT_V3.md`](docs/PRODUCT_V3.md)
3. [`docs/BUSINESS_MEMORY_ROADMAP_V1.md`](docs/BUSINESS_MEMORY_ROADMAP_V1.md) (사업·고객·BM·AI·미디어·기억·시장·KPI에 영향이 있는 경우)
4. [`docs/ENGINEERING_ROADMAP.md`](docs/ENGINEERING_ROADMAP.md)
5. [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)
6. [`docs/WORK_LOG.md`](docs/WORK_LOG.md)의 최신 관련 세션
7. [`docs/PROJECT_HANDOFF_2026-08-13.md`](docs/PROJECT_HANDOFF_2026-08-13.md)
8. `AGENTS.md` (engineering 작업인 경우)
9. 작업과 직접 관련된 specialist 문서

문서 복구 뒤 volatile 사실은 GitHub·저장소·Supabase·로컬 환경에서 다시 확인한다.

### Start checkpoint

작업을 시작하기 전에 최소한 다음을 확정하고, 확인할 수 없는 항목은
`UNVERIFIED`로 표시한다.

- CURRENT PHASE
- ACTIVE STEP
- ACTIVE PR / BRANCH
- VERIFIED BASE / HEAD
- LAST GATE
- CURRENT BLOCKER
- NEXT GATE
- DO NOT ADVANCE UNTIL

### DIRECTION CHECK

모든 비사소한 작업은 구현·문서 수정을 시작하기 전에 다음을 확인한다. 해당하지 않는
문서는 `NOT APPLICABLE`로 표시하고, 확인하지 못한 것은 추측하지 않고 `UNVERIFIED`로
남긴다.

- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict?

충돌이 `YES`이면 구현 전에 중단하고 Control Tower/user에게 충돌 내용과 선택지를 보고한다.
Business source는 고객, 문제정의, 제품 범위, AI 역할, 수익화, 가격, 저장·클라우드,
미디어, Memory Product, KPI, 시장확장에 영향을 주는 작업에서 필수다. 단순한 저수준
버그 수정은 관련 없는 사업 문서를 억지로 읽지 않는다.

### 다른 AI와 겹치지 않기

비사소한 작업 전에 잡고, 끝나면 놓는다. 겹치면 스크립트가 막는다.

```bash
bash scripts/agent/claim.sh opus "<한 줄>"
bash scripts/agent/claim.sh --release opus
```

점유는 예의이지 잠금이 아니다 — 실제 충돌은 git이 판정한다. 보드는
`control-tower/Now.md`이며 **손으로 고치지 않는다.**

### Volatile fact rule

다음은 문서의 과거 기록을 그대로 믿지 말고 작업 시점에 live 확인한다.

- PR state, draft, mergeability, base/head SHA, CI
- branch HEAD와 remote ref
- remote migration state
- local SDK/device state

문서에 남은 PR·SHA는 checkpoint일 뿐이다.

### Canonical ownership

| 질문 | authoritative home |
|---|---|
| **곰신로그가 무엇인가 (처음 오는 사람)** | `docs/WHAT_IS_GOMSINLOG.md` |
| 제품 의도 | `docs/PRODUCT_V3.md` |
| V4 화면이 실제로 어떻게 생겼나 | `docs/V4_AS_BUILT.md` |
| 사업전략·수익화·시장·Memory Product | `docs/BUSINESS_MEMORY_ROADMAP_V1.md` |
| 구현 순서·단계·gate | `docs/ENGINEERING_ROADMAP.md` |
| 현재 구현 현실·blocker | 저장소 코드, 그 다음 `docs/CURRENT_STATE.md` |
| 세션 작업 이력 | `docs/WORK_LOG.md` |
| 도구 간 세션 절차 · 작업 점유 | `docs/AI_SESSION_PROTOCOL.md` |
| 새 AI의 지도·복구 방법 | `docs/PROJECT_HANDOFF_2026-08-13.md` |
| migration 적용 원장 | `supabase/migrations/README.md` |

ONE FACT → ONE AUTHORITATIVE HOME을 지킨다. 지도와 작업 로그에는 다른 문서의
상세 사실을 복제하지 말고 링크와 짧은 요약만 남긴다.

### Update propagation

모든 비사소한 작업은 `WORK_LOG.md`에 기록한다. 현재 구현·gate·blocker가 바뀌면
`CURRENT_STATE.md`도 갱신하고, 계획·단계·진입 조건이 바뀌면
`ENGINEERING_ROADMAP.md`를 갱신한다. 제품 방향은 `PRODUCT_V3.md`, 사업전략은
`BUSINESS_MEMORY_ROADMAP_V1.md`, remote migration 변경은 migration README가 소유한다.
문서를 매번 모두 수정하지 않는다.

### Session end checkpoint

세션 종료 시 `WORK_LOG.md`에 표준 원장 형식으로 다음을 남기고,
`bash scripts/agent/ct-sync.sh push "ct: opus <요약>"`로 다른 AI에게 공유한다. 실제 실행한 검증과
실행하지 않은 검증, code/migration/production 변경 여부, 정확한 중단 지점과 다음
작업을 구분한다. READ-ONLY reviewer는 저장소를 수정하지 않고 `READY-TO-COPY
WORK_LOG ENTRY`만 출력한다. Control Tower 또는 write-capable Worker가 이를
반영하며, review 대상 security PR에 WORK_LOG-only commit을 추가해 review를
stale하게 만들지 않는다.

---

## 수정 사항을 어디에 적는가

작업 기록은 원래 여러 곳에 나뉜다. `WORK_LOG.md`는 그것들을 가리키는 색인이지
대체물이 아니다. 같은 내용을 두 번 쓰지 않는다.

| 무엇 | 어디 |
|---|---|
| 변경의 이유·근거 (가장 자세함) | git commit message |
| 변경 묶음의 요약·검증 결과 | PR 본문 |
| 코드가 왜 그렇게 생겼는지 | 해당 파일의 주석 |
| 현재 저장소의 결함·미구현 | `docs/CURRENT_STATE.md` |
| 마이그레이션 적용 상태 | `supabase/migrations/README.md` |
| 세션 단위 작업 색인 | `docs/WORK_LOG.md` |

## 문서 우선순위 (충돌 시)

1. **제품 의도** → `docs/PRODUCT_V3.md`
2. **사업전략·수익화** → `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
3. **구현 순서** → `docs/ENGINEERING_ROADMAP.md`
4. **현재 구현 사실** → 저장소 코드가 이긴다. 문서가 아니라 코드를 확인한다
5. **암호 프로토콜** → `docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`
6. **프라이버시·법적 판단** → `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`
7. **엔지니어링 계약** → `AGENTS.md`
8. **시각 디자인** → `docs/DESIGN_V2.md`

## 문서 탐색 규칙

- **ONE FACT → ONE AUTHORITATIVE HOME.** 이미 소유자가 있는 사실을 다른 문서에
  복사하지 말고 링크한다.
- 일반 작업의 기본 읽기 순서는 `CLAUDE.md` → `docs/PRODUCT_V3.md` → 관련 시
  `docs/BUSINESS_MEMORY_ROADMAP_V1.md` → `docs/ENGINEERING_ROADMAP.md` → `docs/CURRENT_STATE.md` → 작업과 직접 관련된
  specialist 문서다. `docs/PROJECT_HANDOFF_2026-08-13.md`는 온보딩용 지도이며,
  일반 세션에서 모든 역사 문서를 읽게 하는 목록이 아니다.

## 이 파일에 넣지 않는 것

- PR 번호·HEAD·SHA·CI 결과·현재 blocker 같은 휘발성 상태 → `docs/CURRENT_STATE.md`와
  작업 시점의 live 확인이 소유한다.
- 특정 작업에서만 필요한 절차 → 해당 Skill.
- 코드로 강제되는 금지 규칙(Production mutation, master 직접 push, frozen migration
  041/042 재사용, secret 노출) → `.claude/hooks/`가 결정적으로 차단한다.

## 기록할 때 지킬 것

- **"적용됨"과 "커밋됨"을 섞지 않는다.** 마이그레이션 파일이 저장소에 있다는 사실은
  운영 적용의 증거가 아니다. 운영 상태를 적을 때는 확인 방법과 날짜를 함께 남긴다.
- 검증하지 않은 것을 검증했다고 쓰지 않는다. 실행한 테스트와 실행하지 않은 테스트를
  구분해서 적는다.
- 실패한 것은 실패했다고 적는다.
