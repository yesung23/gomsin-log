---
agent_key: kiro
type: agent
tags:
  - agent/kiro
  - moc
---

# Kiro

**Kiro**

Spec-driven implementation. Specs live in `.kiro/specs/`, steering in `.kiro/steering/`.

> What this AI actually did, oldest first. Each row links to its own report.

_No reports recorded yet._

Reports go in `reports/kiro/` using [[Agent Report]].

## 이 AI에게 줄 컨텍스트

spec 기반 구현 작업이면 아래 팩 + **지금 작업에 직접 관련된 파일 3~8개.**
파일 20개를 매번 다 던지지 않는다.

- [[Context Packs#COMMON — 모든 구현 AI의 부팅 순서]]

```bash
bash scripts/agent/context-pack.sh common
```

목록을 이 페이지에 복사하지 않는다 — 정의의 집은 [[Context Packs]] 하나다.

## Where its work is authoritative

- Session history: `docs/WORK_LOG.md`
- Live branch/PR/CI state: `scripts/agent/live-state.sh`
- This page is navigation only, and non-canonical.

See [[Start Here]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
