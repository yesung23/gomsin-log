---
type: moc
tags:
  - moc
---

# Start Here

이 vault는 **여러 AI가 서로 무엇을 했는지** 기록하고, **다음에 무엇부터 구현할지** 찾는 곳이다.
Obsidian으로 `control-tower/` 폴더를 열면 된다.

> 여기의 어떤 것도 canonical이 아니다. 권한 순서는 [[AI_ENTRYPOINT]]에 있다.
> SHA·PR 상태·CI 결과는 여기 적지 말고 live로 확인한다.

## 1. 지금 무엇부터 구현하나

→ **[[Current Gate]]** 하나만 보면 된다.

지금은: [[PartnerDay Checkpoint State Machine]] 의 W1–W8.
PR #70은 알려진 결함이 있어 merge 불가.

## 2. 어떤 AI가 무엇을 했나

| AI | 역할 |
|---|---|
| [[Claude Opus]] | 구현 + 적대적 리뷰 |
| [[Codex]] | 아키텍처 + state sync |
| [[Grok Build]] | 환경 복구, CI, harness |
| [[Grok 4.6]] | red-team, 최종 harness 리뷰 |
| [[ChatGPT]] | 기획·논의 |
| [[Kiro]] | spec 기반 구현 |

각 페이지에 그 AI의 report가 시간순으로 링크되어 있다.
태그로도 볼 수 있다: `#agent/opus` `#agent/grok-build` `#phase/lv` `#blocker`

## 3. 새 작업을 마쳤을 때

`reports/<agent>/YYYY-MM-DD_HHMM_<task>_<agent>.md` 로 [[Agent Report]] 템플릿을 써서 남긴다.
frontmatter의 `agent`, `date`, `status`, `tags`를 반드시 채운다 — 그게 없으면
해당 AI 페이지와 태그 검색에 나타나지 않는다.

## 4. Live 상태는 어디서 보나

vault가 아니라 저장소에서 본다.

```bash
bash scripts/agent/live-state.sh
```

브랜치 HEAD, 열린 PR, migration 상태를 출력한다. **이 값들을 vault에 복사하지 않는다.**
그렇게 해서 이 vault가 한 번 썩었다.

## 5. 지도

- [[Dashboard]] — 링크 허브
- [[Decision Log]] — Control Tower 결정만
- [[AI_ENTRYPOINT]] — 권한 순서, 에이전트 규칙
- [[AI_USAGE_POLICY]] — 무엇을 해도 되는가
- `tasks/` — 작업 단위 · `audits/` — 감사 · `templates/` — 템플릿
