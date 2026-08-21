# AI 세션 프로토콜 — 여러 AI가 같은 상태에서 시작하는 방법

Claude Code · Codex · Cursor · Antigravity · ChatGPT · Kiro · Grok 가 **서로 어디까지
했는지 확인하고**, 같은 것을 두 번 하지 않고, 끊긴 자리에서 이어받기 위한 절차.

> 이 문서는 **도구 간 공유 절차 하나만** 소유한다. 상태 사실은 하나도 소유하지 않는다.
> 제품 의도는 [`PRODUCT_V3.md`](PRODUCT_V3.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md), 현재 현실은 저장소 코드와
> [`CURRENT_STATE.md`](CURRENT_STATE.md), 엔지니어링 계약은 [`../AGENTS.md`](../AGENTS.md)가
> 그대로 canonical이다. ONE FACT → ONE AUTHORITATIVE HOME.

---

## 1. 세션 시작 — 예외 없이

```bash
bash scripts/agent/session-start.sh
```

한 번에 출력된다: live 브랜치/HEAD/PR · 지금 무엇부터 만드는가 · **지금 누가 무엇을
잡고 있는가** · 최근 세션 3개 · 최근 agent report 5개.

이 출력이 시작 체크포인트다. 대화 기억이나 문서에 적힌 SHA로 대체하지 않는다.

## 2. 작업 점유 — 비사소한 작업 전

```bash
bash scripts/agent/claim.sh opus "PartnerDay OUTSTANDING 상한"
```

`control-tower/Now.md`에 한 줄이 생긴다. 겹치는 scope를 다른 AI가 이미 잡고 있으면
스크립트가 경고하고 멈춘다. 작업이 끝나면 반드시 놓는다.

```bash
bash scripts/agent/claim.sh --release opus
```

`Now.md`는 canonical이 아니다. 점유는 **예의이지 잠금이 아니다** — 실제 충돌 판정은
git이 한다. 24시간 넘은 claim은 `session-start.sh`가 STALE로 표시한다.

## 3. 세션 종료 — 두 곳에 남기고 공유한다

| 무엇 | 어디 | 형식 |
|---|---|---|
| 세션 원장 (무엇을 왜 했나, 검증한 것/안 한 것) | `docs/WORK_LOG.md` | `CLAUDE.md`의 표준 세션 항목 |
| 그 AI의 개별 리포트 | `control-tower/reports/<agent>/YYYY-MM-DD_HHMM_<task>_<agent>.md` | `control-tower/templates/Agent Report.md` |

그 다음 다른 AI가 볼 수 있게 밀어 올린다.

```bash
bash scripts/agent/ct-sync.sh push "ct: opus PartnerDay 상한 조사"
```

`ct-sync.sh`는 `control-tower/`와 `docs/WORK_LOG.md`만 커밋한다. 코드 변경은 절대
휩쓸어 가지 않는다.

---

## 도구별 진입점

| 도구 | 자동으로 읽는 파일 | 비고 |
|---|---|---|
| Claude Code | `CLAUDE.md` | Skill은 `.claude/skills/` |
| Codex | `AGENTS.md` | `.codex/` |
| Cursor | `.cursor/rules/control-tower.mdc` + `AGENTS.md` | always-apply 규칙 |
| Antigravity | `.agents/rules/control-tower.md` + `AGENTS.md` | 워크스페이스 규칙 |
| Kiro | `.kiro/` | spec 기반 |
| 웹 챗 (ChatGPT · Claude.ai · Grok) | 없음 — 저장소를 못 읽는다 | `control-tower/Chat AI Bootstrap.md`를 붙여넣는다 |

각 진입점은 **이 문서를 가리키는 얇은 포인터**다. 절차를 고칠 때는 이 파일만 고친다.

## 절대 하지 않는 것

- 휘발 사실(SHA · PR 번호 · CI 결과 · migration 적용 여부)을 vault나 이 문서에 복사한다.
  vault가 한 번 이것 때문에 썩었다. 항상 `session-start.sh`로 다시 읽는다.
- `Now.md`나 `reports/`를 merge · 배포 · migration 적용 · 게이트 통과의 근거로 삼는다.
- 검증하지 않은 것을 검증했다고 적는다.

## 동기화 방식 — GitHub이 유일한 전송로

vault(`control-tower/`)는 저장소 안에 있고 git이 추적한다. 그래서 `git push` 하나로
모든 AI가 같은 기억을 본다. **NAS · CouchDB · Gitea는 필요 없다** — 그건 저장소가 없는
개인 vault를 여러 기기에서 맞출 때 쓰는 방법이다.

**Obsidian Git 플러그인은 쓰지 않는다.** 이 vault는 코드 저장소의 하위 폴더라서
플러그인이 저장소 전체를 자동 커밋한다. 대신 경로가 좁혀진 `ct-sync.sh`를 쓴다.
