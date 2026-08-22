---
agent_key: ox-alpha
type: agent
tags:
  - agent/ox-alpha
  - moc
---

# Ox Alpha

**opencode zen 경유 · 모델 id `opencode/x-preview-f-free`**

독립 감사와 red-team. 저장소를 직접 읽고 돌릴 수 있다.

> 무엇을 실제로 했는지 오래된 것부터. 각 줄은 그 세션의 리포트로 이어진다.

| Date | Time | Task | Status | Report |
|---|---|---|---|---|
| 2026-08-22 | 03:20 | 전체 기술·제품 감사 (READ-ONLY) | open | [[2026-08-22_0320_full-repo-audit_ox-alpha]] |

## 부르는 법 — **반드시 `--agent plan`**

```bash
~/.opencode/bin/opencode run --agent plan -m opencode/x-preview-f-free "..."
```

`opencode`는 PATH에 없다. 경로를 그대로 쓴다. 멀티턴은 `-c`/`-s <id>`,
기계 판독은 `--format json`, 파일 첨부는 `-f`, 그쪽이 한 일을 읽으려면
`opencode export <sessionID>`.

## ⚠️ `build` 모드로 이 저장소에 붙이지 않는다

`build`의 권한은 `"permission": "*", "action": "allow"`다. 그리고 더 중요한 것:

**`.claude/hooks/`는 opencode에 적용되지 않는다.** 그 훅들은 `.claude/settings.json`의
Claude Code 설정이고 opencode는 그 파일을 읽지 않는다. 즉 이 저장소의 결정적 가드가
**하나도 걸리지 않는다** — master 직접 push · 적용된 migration 재작성 · frozen 041/042
재사용 · PR merge · production mutation · force push 전부 가능해진다.

`plan` 모드는 권한이 이렇게 되어 있다(원문 확인):

```
"permission": "edit", "pattern": "*",                    "action": "deny"
"permission": "edit", "pattern": ".opencode/plans/*.md", "action": "allow"
```

저장소에는 쓰지 못하고 자기 plans 디렉터리에만 쓴다. 읽기·검색·bash는 된다.

## 이 AI에게 줄 컨텍스트

감사·red-team 작업이면 아래 팩 + **지금 작업에 직접 관련된 파일 3~8개.**

- [[Context Packs#Release · PR 감사]]
- [[Context Packs#Security · E2EE]]

```bash
bash scripts/agent/context-pack.sh release
```

목록을 이 페이지에 복사하지 않는다 — 정의의 집은 [[Context Packs]] 하나다.

## 이 AI의 작업이 authoritative한 곳

- **어디도 아니다.** 감사 보고는 그 자체로 사실이 아니며, 재검증란이 붙어야 값을 한다.
- 세션 이력: `docs/WORK_LOG.md` · live 상태: `bash scripts/agent/session-start.sh`

See [[Start Here]] · [[Now]] · [[Dashboard]] · [[AI_ENTRYPOINT]]
