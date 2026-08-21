---
type: moc
tags:
  - moc
  - context
---

# AI Context Packs — 어떤 작업에 어떤 파일을 주는가

> **파일 20개를 매번 다 던지지 않는다.** 공통 팩 + 지금 작업에 직접 관련된 파일 3~8개.
>
> 이 페이지가 팩 정의의 **유일한 집**이다. `scripts/agent/context-pack.sh`가 이 파일을
> 그대로 읽어서 출력하고, 경로가 실재하는지·git이 추적하는지 검사한다. 목록을 다른
> 곳에 복사하지 않는다 — 복사하면 썩는다.

```bash
bash scripts/agent/context-pack.sh common     # 목록 + 존재 검사
bash scripts/agent/context-pack.sh release
bash scripts/agent/context-pack.sh --list     # 팩 이름 전부
```

> **어떤 팩도 권위를 주지 않는다.** 현재 구현 사실은 언제나 코드와 live GitHub가
> 문서를 이긴다. 권위 순서는 [[Canonical Source Map]].

---

## COMMON — 모든 구현 AI의 부팅 순서

<!-- pack: common -->

읽는 순서 그대로다.

1. `CLAUDE.md`
2. `docs/PRODUCT_V3.md`
3. `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
4. `docs/ENGINEERING_ROADMAP.md`
5. `docs/CURRENT_STATE.md`
6. `docs/WORK_LOG.md`
7. `docs/PROJECT_HANDOFF_2026-08-13.md`
8. `AGENTS.md`

<!-- /pack -->

> 8번은 저장소 루트의 `PROJECT_HANDOFF.md`가 아니다 — 그런 파일은 없다.
> 날짜가 붙은 `docs/PROJECT_HANDOFF_2026-08-13.md`가 실재하는 경로다.
>
> 여기에 `bash scripts/agent/session-start.sh` 출력을 함께 준다. 문서 8개는
> **의도**를 싣고, 그 출력은 **지금 사실**을 싣는다. 둘은 대체 관계가 아니다.

## Release · PR 감사

<!-- pack: release extends: common -->

COMMON 전부 + 아래.

- `docs/CODEX_AUDIT_HANDOFF_2026-08-21.md`
- `supabase/migrations/README.md`
- `docs/FABLE_PRODUCT_STRATEGY_AUDIT_2026-08-21.md`   <!-- optional non-canonical -->

<!-- /pack -->

그리고 **그 PR이 실제로 건드린 파일만.** 예 — PR #80 DELTA 리뷰라면:

```text
supabase/migrations/054_shared_at_is_server_state.sql
supabase/migrations/055_notified_through_is_the_send_decision.sql
supabase/functions/send-push/handler.ts
src/pages/RecordPage.tsx
src/pages/recordOpensRequestedDate.test.tsx
```

Fable 전략 문서까지 강제로 읽힐 필요 없다. 붙일 때는 반드시 함께 표시한다:
**NON-CANONICAL · 참고자료일 뿐 구현 계약이 아님 · `PRODUCT_V3`와 실제 코드가 우선.**

## Product Strategy

<!-- pack: strategy -->

- `docs/PRODUCT_V3.md`
- `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- `docs/ENGINEERING_ROADMAP.md`
- `docs/CURRENT_STATE.md`
- `docs/PRODUCT_STRATEGY_REDESIGN_2026-08-21.md`
- `docs/FABLE_PRODUCT_STRATEGY_AUDIT_2026-08-21.md`   <!-- optional non-canonical -->

<!-- /pack -->

필요할 때만 덧붙인다: `docs/DESIGN_V2.md` ·
`docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`.

**전략 AI에게 migration 55개를 다 읽히지 않는다.** COMMON을 통째로 주지도 않는다 —
전략 판단에 `WORK_LOG` 4천 줄은 신호가 아니라 잡음이다.

## Security · E2EE

<!-- pack: security -->

- `docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md`
- `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`
- `docs/CURRENT_STATE.md`
- `docs/ENGINEERING_ROADMAP.md`
- `AGENTS.md`
- `supabase/migrations/README.md`

<!-- /pack -->

그리고 **실제 관련 migration과 crypto 코드만.** 041·042는 frozen이며 재사용하지 않는다
(hook이 차단한다). 이 팩을 쓸 때는 `gomsin-security-review` Skill을 함께 연다.

## UI · UX

<!-- pack: ui -->

- `docs/PRODUCT_V3.md`
- `docs/DESIGN_V2.md`
- `docs/DESIGN_V2.1_VISUAL_PILOT.md`
- `docs/CURRENT_STATE.md`

<!-- /pack -->

그리고 **해당 화면 파일만.** 예:

```text
src/features/home/RoleHome.tsx
src/pages/RecordPage.tsx
src/components/widgets/PartnerDayTimelineWidget.tsx
```

Fable 전략 문서는 선택사항이다. `AGENTS.md` §1이 시각 재설계를 금지한다는 것을 먼저 읽는다.

## Cycle · Care

<!-- pack: cycle -->

- `docs/PRODUCT_V3.md`
- `docs/CURRENT_STATE.md`
- `src/types/index.ts`

<!-- /pack -->

그리고 관련 cycle/care migration · UI component · test만. 이 영역은 제품 결정이
촘촘해서 **코드를 보기 전에 [[Cycle · Care Canon]]의 질문 목록을 먼저 통과시킨다.**

---

## 팩을 고칠 때

이 페이지만 고친다. `context-pack.sh`가 여기를 읽으므로 스크립트는 손댈 필요가 없다.
경로를 지웠거나 이름을 바꿨으면 스크립트가 `❌ 없음`으로 알려준다.

See [[Start Here]] · [[Canonical Source Map]] · [[Do Not Build]] · [[Now]]
