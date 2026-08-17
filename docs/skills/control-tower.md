> **도구 중립 절차서.** Codex·Kiro·Claude Code가 모두 이 파일을 원본으로 읽는다.
> 각 도구의 설정은 이 파일을 가리키는 얇은 래퍼일 뿐이므로, 내용을 도구별로
> 복사하지 않는다. 수정은 여기서 한 번만 한다. 도구별 진입점은 `docs/skills/README.md`.

# Control Tower — 상태 복구와 방향 확인

대화 기억은 source of truth가 아니다. 저장소와 live Git이 소유한다.

## 1. Canonical 복구 (이 순서대로 읽는다)

1. `CLAUDE.md`
2. `docs/PRODUCT_V3.md`
3. `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — 고객·문제정의·제품범위·AI 역할·수익화·가격·
   저장/클라우드·미디어·Memory Product·KPI·시장확장에 영향이 있을 때만
4. `docs/ENGINEERING_ROADMAP.md`
5. `docs/CURRENT_STATE.md`
6. `docs/WORK_LOG.md` 최신 관련 항목 (전체를 읽지 않는다)
7. `docs/PROJECT_HANDOFF_2026-08-13.md`
8. `AGENTS.md` — engineering 작업일 때
9. 작업과 직접 관련된 specialist 문서 하나 이상

모든 Markdown을 읽지 않는다. 무관한 역사 문서는 건너뛴다.

## 2. Live 검증 (문서의 과거 SHA보다 우선)

```bash
scripts/agent/live-state.sh
```

문서에 적힌 PR·HEAD·CI는 checkpoint일 뿐이다. 항상 live 값을 다시 확인한다.


## 2.5 Shared AI memory recovery (non-canonical)

After canonical recovery + live verification, if a shared AI memory vault is present:

1. Read `control-tower/AI_ENTRYPOINT.md`
2. Read `control-tower/Dashboard.md`
3. Read only the task/audit/report files that are directly relevant to the current bounded request.

The shared memory under `control-tower/` is NON-CANONICAL.

It must never override:
- live Git / GitHub / CI facts
- repository code
- canonical documents (PRODUCT_V3, BUSINESS_MEMORY_ROADMAP_V1, ENGINEERING_ROADMAP, CURRENT_STATE, WORK_LOG, PROJECT_HANDOFF, AGENTS.md, skills procedures)
- security architecture decisions
- migration ledger
- production / remote / device state that can be independently verified

This preserves ONE FACT → ONE AUTHORITATIVE HOME.

Obsidian is only a viewer for the parked shared context. It is not an authority.

## 3. Start checkpoint 보고

확인할 수 없는 항목은 추측하지 않고 `UNVERIFIED`로 남긴다.

- CURRENT PHASE / ACTIVE STEP
- ACTIVE PR / BRANCH
- VERIFIED BASE / HEAD
- LAST GATE / NEXT GATE
- CURRENT BLOCKER
- DO NOT ADVANCE UNTIL

## 4. DIRECTION CHECK

구현·문서 수정 전에 기록한다. 해당 없으면 `NOT APPLICABLE`.

- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict?

`YES`이면 **구현 전에 멈추고** 충돌과 선택지를 사용자에게 보고한다.

## 5. Abandoned-strategy guard

다음이 요청에 다시 등장하면 `DIRECTION CONFLICT`로 표시하고 멈춘다. 상세 목록은
`AGENTS.md` §17이 소유한다.

저장용량 구독 · 고화질/긴 영상 유료 게이트 · E2EE 유료화 · 구독 우선 BM ·
AI 자동 추억 선정 · 관계점수/애정도/이별예측 · 체류시간·다운로드 KPI ·
CloudKit 구현 완료 주장 · 음성·영상 완료 주장 · 자체 Chat 재활성화

## 6. 세션 종료

`docs/WORK_LOG.md`에 항목 하나. 실행한 검증과 실행하지 않은 검증을 구분한다.
READ-ONLY 리뷰어는 저장소를 수정하지 않고 `READY-TO-COPY WORK_LOG ENTRY`만 출력한다.

## 7. Persistent shared memory worktree (for parked vault access)

The canonical parked vault lives on `origin/docs/shared-ai-control-tower-v1`.

For long-running or cross-branch agent work, a dedicated persistent worktree is recommended:

    git worktree add /Users/han-yejun/Desktop/gomsinlog-control-tower-memory origin/docs/shared-ai-control-tower-v1

This worktree is read-mostly for agents. Only the Control Tower state-sync role writes substantial updates back to the parked branch.

If a worktree is not available, agents may still read the latest memory directly without checking it out:

    git show origin/docs/shared-ai-control-tower-v1:control-tower/AI_ENTRYPOINT.md
    git show origin/docs/shared-ai-control-tower-v1:control-tower/Dashboard.md

This pattern allows agents on implementation branches (including the harness branch) to read the shared memory without mutating their own working tree.

## 8. Automated agent reporting protocol (required on every substantial task end)

### 8.1 Directory layout (agent-scoped)

control-tower/reports/
  chatgpt/
  grok-build/
  grok-4.6/
  opus/
  codex/
  other/

### 8.2 Naming rule (Asia/Seoul local time)

YYYY-MM-DD_HHMM_<task-slug>_<agent>.md

Example: 2026-08-17_2315_p55-harness-followup_grok-build.md

### 8.3 Who may write what

- Normal agents (chatgpt, grok-build, grok-4.6, opus, codex, other) MUST NOT modify:
  - control-tower/Dashboard.md
  - control-tower/Current Gate.md
  - control-tower/Decision Log.md

- Only the CONTROL TOWER STATE SYNC role may edit the three files above.

### 8.4 Required report structure (every agent)

Every agent report must end with a STOPPED AT block containing at minimum:

STOPPED AT
- exact HEAD:
- branch:
- PR:
- changed (this delta only):
- explicitly not changed:
- tests executed / not executed and why:
- Production:
- Supabase:
- P6:
- next owner / next action:

### 8.5 Memory write failure fallback (do not fail the engineering task)

If writing the report to the persistent memory worktree or to the parked branch fails for any reason (permissions, network, worktree not present, etc.):

1. Do NOT treat the memory write failure as a task failure.
2. Immediately emit a complete READY-TO-COPY CONTROL-TOWER REPORT in the exact structure above.
3. The Control Tower state-sync owner will later incorporate the report into the parked vault.

The engineering artifact (code, tests, docs delta) is considered complete once the canonical verification passes. Memory reporting is best-effort.

### 8.6 When a report must be produced

- Any substantial agent-owned step that changes files, runs verification, or produces an audit/review verdict.
- Normal "chat only" turns that do not change state may skip, but any bounded task (implementation, review, audit, handoff) must produce one.

### 8.7 Control Tower state-sync responsibilities

After receiving agent reports (or READY-TO-COPY blocks), the state-sync role:
- merges factual updates into Dashboard.md / Current Gate.md / Decision Log.md when appropriate
- keeps the three files as single source of "last known non-canonical snapshot"
- never rewrites agent-authored reports under reports/<agent>/

### 8.8 Successful report persistence (required step after creating the report file)

After an agent has created its NEW report file under:

    control-tower/reports/<agent>/YYYY-MM-DD_HHMM_<task>_<agent>.md

the agent MUST attempt to persist it in the dedicated memory worktree:

1. cd /Users/han-yejun/Desktop/gomsinlog-control-tower-memory
2. git fetch origin
3. git checkout docs/shared-ai-control-tower-v1
4. git pull --ff-only origin/docs/shared-ai-control-tower-v1   # fast-forward only; abort if not clean
5. git add ONLY the newly-created report file (never add Dashboard.md, Current Gate.md, Decision Log.md, or any other agent's files)
6. git commit -m "docs(control-tower): add <agent> report <task>"
7. git push origin docs/shared-ai-control-tower-v1

Rules:
- Never force-push.
- Never amend or rewrite another agent's report.
- Normal agents may only commit their own report files.
- If the remote branch has moved ahead and a clean fast-forward is not possible, or if any step fails safely:
  - STOP the memory sync attempt.
  - Emit a complete READY-TO-COPY CONTROL-TOWER REPORT (see 8.5).
  - Do NOT mark the engineering task as failed.
  - The Control Tower state-sync owner will reconcile later.

This makes successful report persistence an explicit, auditable step rather than an implicit side-effect.

## 9. Obsidian volatile files (gitignore only)

The Obsidian vault root for the shared Control Tower memory is:

    control-tower/

Machine-specific / volatile Obsidian state under this vault MUST be ignored so that
the shared Markdown content remains clean across machines.

Add (or keep) the following in .gitignore (scoped to the vault root):

control-tower/.obsidian/workspace.json
control-tower/.obsidian/cache/
control-tower/.obsidian/workspace-cache/
control-tower/.obsidian/plugins/*/data.json   (machine-specific plugin state)
control-tower/.obsidian/appearance.json       (only if customized per-machine)

Do NOT ignore:

control-tower/**/*.md

All shared Markdown reports, procedures, and documentation must remain tracked.

## 10. Cross-branch memory access summary (for all agents)

Preferred:
- Dedicated persistent worktree at /Users/han-yejun/Desktop/gomsinlog-control-tower-memory

Fallback (no checkout required):
- git show origin/docs/shared-ai-control-tower-v1:control-tower/...

Both patterns are explicitly allowed by this procedure. Agents on any branch (including implementation branches) may use them to read the shared non-canonical memory without polluting their own tree.
