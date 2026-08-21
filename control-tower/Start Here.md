---
type: moc
tags:
  - moc
---

# Start Here

이 vault는 **여러 AI가 서로 무엇을 했는지** 기록하고, **다음에 무엇부터 구현할지** 찾는 곳이다.
Obsidian으로 `곰신로그/control-tower/` 폴더를 열면 된다.

> 여기의 어떤 것도 canonical이 아니다. 권한 순서는 [[AI_ENTRYPOINT]]에 있다.
> SHA·PR 상태·CI 결과는 여기 적지 말고 live로 확인한다.

## 0. 세션을 시작할 때 — 명령 하나

```bash
bash scripts/agent/session-start.sh
```

live 브랜치·HEAD·열린 PR, 다음에 만들 것, **지금 누가 무엇을 잡고 있는지**, 최근 세션과
리포트가 한 번에 나온다. 도구별 절차 전체는 `docs/AI_SESSION_PROTOCOL.md`.

## 1. 지금 무엇부터 구현하나

→ **[[Current Gate]]** 하나만 보면 된다.

## 2. 지금 누가 무엇을 잡고 있나

→ **[[Now]]**. 비사소한 작업을 시작하기 전에 잡고, 끝나면 놓는다.

```bash
bash scripts/agent/claim.sh <agent> "<한 줄>"
bash scripts/agent/claim.sh --release <agent>
```

## 3. 그 AI에게 어떤 파일을 주나

→ **[[Context Packs]]**. 공통 팩 + 지금 작업에 직접 관련된 파일 3~8개.
**파일 20개를 매번 다 던지지 않는다.**

```bash
bash scripts/agent/context-pack.sh --list
bash scripts/agent/context-pack.sh release
```

경로가 실재하는지·git이 추적하는지까지 검사해서 낸다.

## 4. 어떤 AI가 무엇을 했나

| AI | 역할 | 진입점 |
|---|---|---|
| [[Claude Opus]] | 구현 + 적대적 리뷰 | `CLAUDE.md` |
| [[Codex]] | 아키텍처 + state sync | `AGENTS.md` |
| [[Cursor]] | IDE 안 구현·리팩터 | `.cursor/rules/control-tower.mdc` |
| [[Antigravity]] | 에이전트 우선 IDE | `.agents/rules/control-tower.md` |
| [[Ox Alpha]] | 독립 감사·red-team | `--agent plan` 필수 (아래 주의) |
| [[Grok Build]] | 환경 복구, CI, harness | — |
| [[Grok 4.6]] | red-team, 최종 harness 리뷰 | — |
| [[ChatGPT]] | 기획·논의 | [[Chat AI Bootstrap]] |
| [[Kiro]] | spec 기반 구현 | `.kiro/` |

각 페이지에 그 AI의 report가 시간순으로 링크되어 있다.
태그로도 볼 수 있다: `#agent/opus` `#agent/grok-build` `#phase/lv` `#blocker`

저장소를 못 읽는 웹 챗(ChatGPT·Claude.ai·Grok)은 [[Chat AI Bootstrap]]을 붙여넣는다.

## 5. 새 작업을 마쳤을 때

`reports/<agent>/YYYY-MM-DD_HHMM_<task>_<agent>.md` 로 [[Agent Report]] 템플릿을 써서 남긴다.
frontmatter의 `agent`, `date`, `status`, `tags`를 반드시 채운다 — 그게 없으면
해당 AI 페이지와 태그 검색에 나타나지 않는다.

그리고 `docs/WORK_LOG.md`에 표준 세션 항목을 남긴 뒤, 다른 AI가 볼 수 있게 밀어 올린다.

```bash
bash scripts/agent/ct-sync.sh push "ct: <agent> <요약>"
```

`control-tower/`와 `docs/WORK_LOG.md`만 커밋된다. 코드 변경은 휩쓸려 가지 않는다.

## 6. Live 상태는 어디서 보나

vault가 아니라 저장소에서 본다. `session-start.sh`가 그것을 포함해 출력한다.
**이 값들을 vault에 복사하지 않는다.** 그렇게 해서 이 vault가 한 번 썩었다.

## 7. 지도

- [[Context Packs]] — 어떤 작업에 어떤 파일을 주는가
- [[Canonical Source Map]] — 이 질문의 authoritative home은 어디인가
- [[Do Not Build]] — 짓기 전에 멈추는 곳
- [[Cycle · Care Canon]] — 주기·배려 작업에서 빠뜨리면 안 되는 질문
- [[Now]] — 지금 누가 무엇을 잡고 있나
- [[Dashboard]] — 링크 허브
- [[Decision Log]] — Control Tower 결정만
- [[AI_ENTRYPOINT]] — 권한 순서, 에이전트 규칙
- [[AI_USAGE_POLICY]] — 무엇을 해도 되는가
- [[Chat AI Bootstrap]] — 저장소를 못 읽는 AI에게 붙여넣는 프롬프트
- `tasks/` — 작업 단위 · `audits/` — 감사 · `templates/` — 템플릿
