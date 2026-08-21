---
agent_key: codex
type: agent
tags:
  - agent/codex
  - moc
---

# Codex

**OpenAI Codex**

Architecture and state-sync. Owns canonical document synchronisation when available.

> What this AI actually did, oldest first. Each row links to its own report.

| Date | Time | Task | Status | Report |
|---|---|---|---|---|
| 2026-08-18 | 12:34 | P5.5 Post-Landing State Sync | closed | [[2026-08-18_1234_p55-post-landing-state-sync_codex]] |

## 이 AI에게 줄 컨텍스트

아키텍처·state sync 작업이면 아래 팩 + **지금 작업에 직접 관련된 파일 3~8개.**
파일 20개를 매번 다 던지지 않는다.

- [[Context Packs#COMMON — 모든 구현 AI의 부팅 순서]]
- [[Context Packs#Release · PR 감사]]

```bash
bash scripts/agent/context-pack.sh release
```

목록을 이 페이지에 복사하지 않는다 — 정의의 집은 [[Context Packs]] 하나다.

## Where its work is authoritative

- Session history: `docs/WORK_LOG.md`
- Live branch/PR/CI state: `scripts/agent/live-state.sh`
- This page is navigation only, and non-canonical.

See [[Start Here]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
