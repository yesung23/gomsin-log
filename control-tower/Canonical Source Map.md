---
type: moc
tags:
  - moc
---

# Canonical Source Map — 이 질문의 집은 어디인가

> **이 페이지에는 사실이 하나도 없다. 링크만 있다.**
>
> 규칙·수치·정책을 여기 옮겨 적으면 그 순간 두 번째 source of truth가 생기고, 곧
> 원본과 어긋난다. [[AI_ENTRYPOINT]]가 금지하는 것이 정확히 그것이다.

## 권위 순서 (충돌 시 위가 이긴다)

1. **live Git · GitHub · CI** — 정확한 SHA, PR 상태, check run
2. **저장소 코드** — 현재 무엇이 구현돼 있는지는 문서가 아니라 코드가 답한다
3. **canonical 문서** — 아래 표
4. **Control Tower 결정** — [[Decision Log]]
5. **이 vault** — navigation, 스냅샷, 리포트
6. **개별 AI의 대화 기록**

전체 서술은 [[AI_ENTRYPOINT]]와 `CLAUDE.md`의 *문서 우선순위*에 있다.

## 질문 → 집

| 질문 | authoritative home |
|---|---|
| 제품 의도 · 비목표 · 주기 공유 정책 | `docs/PRODUCT_V3.md` |
| 사업전략 · 수익화 · 시장 · Memory Product | `docs/BUSINESS_MEMORY_ROADMAP_V1.md` |
| 구현 순서 · 단계 · gate 진입 조건 | `docs/ENGINEERING_ROADMAP.md` |
| **현재 구현 현실 · 결함 · 미구현** | 저장소 코드, **그 다음** `docs/CURRENT_STATE.md` |
| 세션 작업 이력 | `docs/WORK_LOG.md` |
| 엔지니어링 계약 · 금지사항 | `AGENTS.md` |
| 암호 프로토콜 | `docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md` |
| 프라이버시 · 법적 판단 | `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md` |
| 시각 디자인 | `docs/DESIGN_V2.md` · `docs/DESIGN_V2.1_VISUAL_PILOT.md` |
| migration 적용 원장 | `supabase/migrations/README.md` |
| 새 AI 온보딩 | `docs/PROJECT_HANDOFF_2026-08-13.md` |
| 도구 간 세션 절차 · 작업 점유 | `docs/AI_SESSION_PROTOCOL.md` |
| **어떤 작업에 어떤 파일을 주나** | [[Context Packs]] |

## 휘발 사실 — 문서에서 읽지 않는다

브랜치 HEAD · PR 상태 · CI 결과 · remote migration 적용 여부 · 로컬 SDK/기기 상태.
문서에 적힌 것은 전부 과거의 checkpoint다.

```bash
bash scripts/agent/session-start.sh
```

See [[Start Here]] · [[Context Packs]] · [[Do Not Build]]
