---
agent_key: cursor
type: agent
tags:
  - agent/cursor
  - moc
---

# Cursor

**Cursor IDE**

IDE 안에서의 구현과 리팩터. 파일 단위 작업에 강하다.

> 무엇을 실제로 했는지 오래된 것부터. 각 줄은 그 세션의 리포트로 이어진다.

| Date | Time | Task | Status | Report |
|---|---|---|---|---|
| _(아직 없음)_ | | | | |

## 이 AI에게 줄 컨텍스트

IDE 안 구현·리팩터 작업이면 아래 팩 + **지금 작업에 직접 관련된 파일 3~8개.**
파일 20개를 매번 다 던지지 않는다.

- [[Context Packs#COMMON — 모든 구현 AI의 부팅 순서]]
- [[Context Packs#UI · UX]]

```bash
bash scripts/agent/context-pack.sh ui
```

목록을 이 페이지에 복사하지 않는다 — 정의의 집은 [[Context Packs]] 하나다.

## 이 AI의 작업이 authoritative한 곳

- 세션 이력: `docs/WORK_LOG.md`
- live 브랜치/PR/CI: `bash scripts/agent/session-start.sh`
- 이 페이지는 navigation이며 canonical이 아니다.

See [[Start Here]] · [[Now]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
