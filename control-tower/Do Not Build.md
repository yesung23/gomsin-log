---
type: moc
tags:
  - moc
  - constraint
---

# Do Not Build — 짓기 전에 멈추는 곳

> **목록을 여기 복제하지 않는다.** 각 금지는 이미 집이 있고, 그 집이 바뀌면 여기가
> 아니라 거기가 바뀐다. 이 페이지는 "어디를 봐야 하는지"만 답한다.

AI가 새 기능을 제안하거나 화면을 다시 그리려 할 때, 아래 네 곳을 통과시킨다.

| 무엇을 확인하나 | 어디 |
|---|---|
| **제품 비목표** — 애초에 만들지 않기로 한 것 | `docs/PRODUCT_V3.md` §16. 여기 있는 항목을 추가하려면 **그 문서를 먼저 개정**해야 한다 |
| **시각 재설계 금지** — 색·타이포·간격·레이아웃·아이콘·애니메이션 | `AGENTS.md` §1. UI가 낡아 보인다는 이유로 기능을 지우지 않는다 |
| **지금 열린 제약** — Production/Supabase/기기/P6/채팅 | [[Current Gate]] *Standing constraints* |
| **권한 없음** — merge · 배포 · migration 적용 · gate 통과 | [[AI_ENTRYPOINT]]. vault의 어떤 것도 이것을 승인하지 못한다 |

## 코드가 결정적으로 막는 것

문서가 아니라 `.claude/hooks/`가 차단한다. 설득으로 우회되지 않는다.

- Production mutation
- `master` 직접 push
- frozen migration `041` · `042` 재사용
- 이미 적용된 migration 파일을 제자리에서 고치기 (앞으로 가는 새 번호를 만든다)
- 자격증명 파일 쓰기

## 아직 결정되지 않은 것

"금지"가 아니라 **"아직 아무도 정하지 않았다"**인 항목은 `docs/PRODUCT_V3.md` §22
*열린 제품 결정*과 [[Current Gate]] *Known, deferred*에 있다. 그것을 코드로
먼저 정하지 않는다 — 결정은 제품 문서에서 내리고 코드가 따라간다.

See [[Start Here]] · [[Canonical Source Map]] · [[Context Packs]]
