# AI Entry Point — Shared Control Tower Memory

This directory is NON-CANONICAL shared memory only.

## Authority Order (strict)

1. live Git / GitHub / CI (exact SHAs, PR state, check runs)
2. repository code and canonical documents:
   - docs/PRODUCT_V3.md
   - docs/BUSINESS_MEMORY_ROADMAP_V1.md
   - docs/ENGINEERING_ROADMAP.md
   - docs/CURRENT_STATE.md
   - docs/WORK_LOG.md
   - docs/PROJECT_HANDOFF_2026-08-13.md
   - AGENTS.md (for engineering work)
   - docs/skills/*.md (procedures)
   - docs/AI_SESSION_PROTOCOL.md (cross-tool session procedure)
3. explicit Control Tower decision recorded in Decision Log
4. control-tower/ shared memory (navigation, snapshots, prompts, reports)
5. individual agent chat history / per-agent reports

## Required agent behavior

Every agent MUST:

1. Read canonical sources first (the list above).
2. Live-verify volatile state (PR numbers, HEAD SHAs, CI conclusions, branch pointers).
3. Then read:
   - control-tower/AI_ENTRYPOINT.md
   - control-tower/Dashboard.md
   - control-tower/Now.md — what another agent is already holding
   Steps 1-3 are produced in one command: `bash scripts/agent/session-start.sh`
4. Read only task/audit/report files that are directly relevant to the current bounded request.
5. Claim before non-trivial work and release after:
   `bash scripts/agent/claim.sh <agent> "<scope>"` / `--release <agent>`.
   A claim is courtesy, not a lock. Git decides real conflicts.
6. Never treat anything under control-tower/ as authorization for:
   - merge
   - production deployment
   - migration application
   - P6 start
   - security gate pass/fail
   - canonical document changes

ONE FACT → ONE AUTHORITATIVE HOME must be preserved.

Obsidian is only a convenient viewer for the parked non-canonical memory.
It does not override repository reality.
