# Control Tower — shared AI memory (Obsidian vault)

Open this folder as a vault in Obsidian: **Open folder as vault → `control-tower/`**.

Then read [[Start Here]].

## What this is for

Several AIs work on this repository — Claude, Codex, Grok, ChatGPT, Kiro. This vault
records **what each one actually did** and **what to build next**, so a new session can
pick up without re-reading every chat.

## What this is not

Not canonical. Live Git, GitHub, and the `docs/` documents win over anything here.
Authority order is in [[AI_ENTRYPOINT]]. 도구 간 세션 절차는 `docs/AI_SESSION_PROTOCOL.md`가 소유한다.

세션은 `bash scripts/agent/session-start.sh` 로 시작하고, 공유는
`bash scripts/agent/ct-sync.sh push "<msg>"` 로 한다. **Obsidian Git 플러그인은 쓰지 않는다** —
이 vault는 코드 저장소의 하위 폴더라 플러그인이 저장소 전체를 자동 커밋한다.

**Never copy volatile facts into this vault** — SHAs, PR numbers, CI run ids. That is
exactly what made it rot the first time. Run `bash scripts/agent/live-state.sh` instead.

## Layout

```
Start Here.md      entry point
Context Packs.md   작업별 파일 목록 — context-pack.sh 가 이 파일을 읽는다
Canonical Source Map.md  질문 → authoritative home (사실 없음, 링크만)
Do Not Build.md    짓기 전에 멈추는 곳 (금지 목록을 복제하지 않는다)
Cycle · Care Canon.md    주기·배려 작업에서 물어야 할 것
Now.md             작업 점유 보드 (claim.sh 가 쓴다 — 손으로 고치지 않는다)
Dashboard.md       navigation hub
Current Gate.md    what is blocked, what to build next
Decision Log.md    Control Tower decisions only
Agents/            one page per AI, linking its reports
reports/<agent>/   individual agent reports
tasks/             work units
audits/            audits
templates/         Agent Report template
Chat AI Bootstrap.md  저장소를 못 읽는 웹 챗에게 붙여넣는 프롬프트
.obsidian/         vault config (committed; workspace and caches are gitignored)
```

## Conventions

- Reports: `reports/<agent>/YYYY-MM-DD_HHMM_<task-slug>_<agent>.md`
- Every report needs frontmatter (`agent`, `date`, `status`, `tags`) or it will not show
  up on the agent page or in tag search
- Link notes with double-bracket wiki syntax so graph view and backlinks work
- Only the Control Tower owner edits Dashboard, Current Gate, and Decision Log
