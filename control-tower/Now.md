---
type: board
tags:
  - board
  - now
---

# Now — 지금 누가 무엇을 잡고 있나

> **점유 보드. 저장소 상태의 거울이 아니다.**
>
> 여러 AI가 같은 파일을 동시에 건드리는 것을 막기 위한 곳이다. 여기의 한 줄은
> **예의이지 잠금이 아니다** — 실제 충돌은 git이 판정한다. 무엇을 다음에 만드는가는
> [[Current Gate]]가, 무엇을 이미 했는가는 `docs/WORK_LOG.md`와 [[Dashboard]]의
> agent 페이지가 소유한다. **SHA · PR 번호 · CI 결과를 여기 적지 않는다.**

## 잡는 법 / 놓는 법

```bash
bash scripts/agent/claim.sh opus "PartnerDay OUTSTANDING 상한"   # 잡기
bash scripts/agent/claim.sh --release opus                        # 놓기
bash scripts/agent/claim.sh --list                                # 보기
```

아래 블록은 **스크립트가 쓴다. 손으로 고치지 않는다.**

## 활성 점유

<!-- CLAIMS:BEGIN -->
| agent | scope | branch | since (UTC) |
|---|---|---|---|
| _(없음)_ | | | |
<!-- CLAIMS:END -->

24시간이 지난 줄은 `session-start.sh`가 **STALE**로 표시한다. STALE이면 그 AI가
죽었다고 보고 가져가도 된다 — 대신 가져갔다는 사실을 `docs/WORK_LOG.md`에 적는다.

## 이 보드가 답하지 못하는 것

| 질문 | 어디서 보나 |
|---|---|
| 지금 브랜치 HEAD · 열린 PR · CI | `bash scripts/agent/live-state.sh` |
| 다음에 무엇을 만드나 | [[Current Gate]] |
| 각 AI가 실제로 무엇을 했나 | `docs/WORK_LOG.md`, `reports/<agent>/` |
| 도구 간 절차 전체 | `docs/AI_SESSION_PROTOCOL.md` |

See [[Start Here]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
