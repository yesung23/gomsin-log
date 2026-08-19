---
type: moc
tags:
  - moc
---

# Control Tower Dashboard

> **Navigation hub. Not a mirror of repository state.**
>
> This file used to restate master SHA, PR numbers, and CI run ids. All of it rotted
> within a day — it still said "P5.5 CLOSED, PR #68 MERGED" while work had moved two
> PRs on. Volatile facts now live only where they are authoritative, and this page
> links to them instead.

## Where the live facts are

| Question | Authoritative source |
|---|---|
| Branch HEAD, open PRs, migrations | `bash scripts/agent/live-state.sh` |
| CI conclusions for an exact SHA | `gh pr checks <n>` / `gh run view <id>` |
| What is implemented right now | repository code, then `docs/CURRENT_STATE.md` |
| Session history | `docs/WORK_LOG.md` |
| Product intent | `docs/PRODUCT_V3.md` |
| Implementation order and gates | `docs/ENGINEERING_ROADMAP.md` |

Do not copy any of these into the vault.

## Navigation

- **[[Start Here]]** — begin here
- [[Current Gate]] — what is blocked and what to build next
- [[Decision Log]] — Control Tower decisions only
- [[AI_ENTRYPOINT]] — authority order and agent rules
- [[AI_USAGE_POLICY]] — permitted actions

## Agents

[[Claude Opus]] · [[Codex]] · [[Grok Build]] · [[Grok 4.6]] · [[ChatGPT]] · [[Kiro]]

## Open work

- [[PartnerDay Checkpoint State Machine]] — **open defect, do not merge**
- [[P5.5 Browser Harness]] — closed

## Ownership

Dashboard, [[Current Gate]] and [[Decision Log]] are written by the Control Tower owner
only. Agents write into `reports/` and `tasks/`.
