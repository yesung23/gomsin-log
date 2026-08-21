---
agent_key: opus
type: agent
tags:
  - agent/opus
  - moc
---

# Claude Opus

**Anthropic Claude Opus — Claude Code CLI**

Deep implementation and adversarial review. Runs multi-round self-review and spawns isolated cold reviewers.

> What this AI actually did, oldest first. Each row links to its own report.

| Date | Time | Task | Status | Report |
|---|---|---|---|---|
| 2026-08-19 | 03:30 | LV missed-context repair and widget identity lifecycle | closed | [[2026-08-19_0330_lv-missed-context-repair_opus]] |
| 2026-08-19 | 08:30 | PartnerDay checkpoint state machine redesign | closed | [[2026-08-19_0830_partnerday-state-machine-redesign_opus]] |
| 2026-08-19 | 11:00 | Architecture review — surfaced-but-unconfirmed loss | open | [[2026-08-19_1100_partnerday-architecture-review_opus]] |

## 이 AI에게 줄 컨텍스트

구현·적대적 리뷰 작업이면 아래 팩 + **지금 작업에 직접 관련된 파일 3~8개.**
파일 20개를 매번 다 던지지 않는다.

- [[Context Packs#COMMON — 모든 구현 AI의 부팅 순서]]
- [[Context Packs#Release · PR 감사]]

```bash
bash scripts/agent/context-pack.sh common
```

목록을 이 페이지에 복사하지 않는다 — 정의의 집은 [[Context Packs]] 하나다.

## Where its work is authoritative

- Session history: `docs/WORK_LOG.md`
- Live branch/PR/CI state: `scripts/agent/live-state.sh`
- This page is navigation only, and non-canonical.

See [[Start Here]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
