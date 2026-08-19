# Control Tower — shared AI memory (Obsidian vault)

Open this folder as a vault in Obsidian: **Open folder as vault → `control-tower/`**.

Then read [[Start Here]].

## What this is for

Several AIs work on this repository — Claude, Codex, Grok, ChatGPT, Kiro. This vault
records **what each one actually did** and **what to build next**, so a new session can
pick up without re-reading every chat.

## What this is not

Not canonical. Live Git, GitHub, and the `docs/` documents win over anything here.
Authority order is in [[AI_ENTRYPOINT]].

**Never copy volatile facts into this vault** — SHAs, PR numbers, CI run ids. That is
exactly what made it rot the first time. Run `bash scripts/agent/live-state.sh` instead.

## Layout

```
Start Here.md      entry point
Dashboard.md       navigation hub
Current Gate.md    what is blocked, what to build next
Decision Log.md    Control Tower decisions only
Agents/            one page per AI, linking its reports
reports/<agent>/   individual agent reports
tasks/             work units
audits/            audits
templates/         Agent Report template
.obsidian/         vault config (committed; workspace and caches are gitignored)
```

## Conventions

- Reports: `reports/<agent>/YYYY-MM-DD_HHMM_<task-slug>_<agent>.md`
- Every report needs frontmatter (`agent`, `date`, `status`, `tags`) or it will not show
  up on the agent page or in tag search
- Link notes with double-bracket wiki syntax so graph view and backlinks work
- Only the Control Tower owner edits Dashboard, Current Gate, and Decision Log
