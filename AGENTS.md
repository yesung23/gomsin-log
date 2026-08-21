# GomsinLog Engineering Contract

## 0. 세션 시작 — 모든 AI 공통

이 저장소는 여러 AI(Claude Code · Codex · Cursor · Antigravity · ChatGPT · Kiro · Grok)가
번갈아 작업한다. **대화 기억은 source of truth가 아니다.**

```bash
bash scripts/agent/session-start.sh                 # 시작: live 상태 · 다음 작업 · 다른 AI의 점유
bash scripts/agent/claim.sh <agent> "<한 줄>"        # 비사소한 작업 전에 잡는다
bash scripts/agent/claim.sh --release <agent>       # 끝나면 놓는다
bash scripts/agent/ct-sync.sh push "ct: <agent> <요약>"   # 공유 기억만 커밋·push
```

세션을 마치면 `docs/WORK_LOG.md`에 표준 항목과
`control-tower/reports/<agent>/`에 리포트를 남긴다. 절차 원본은
[`docs/AI_SESSION_PROTOCOL.md`](docs/AI_SESSION_PROTOCOL.md)이고, 이 계약은 그것을
가리킬 뿐 복제하지 않는다.

## 1. Workstream Boundary

A separate Claude Design workstream owns the visual redesign.

This engineering workstream owns:

- functionality
- data integrity
- privacy
- authorization
- security
- synchronization
- testing
- migrations
- production reliability

Do not redesign the application.

Unless absolutely required for functionality or security, do not change:

- visual identity
- color system
- typography
- spacing
- layout styling
- card styling
- icon language
- animations
- navigation appearance
- decorative UI

Do not remove functionality simply because the current UI appears outdated.

## 2. Core Product Contract

Never break the core GomsinLog user flow:

가볍게 기록
→ 상대방의 오늘
→ summary item
→ exact original record
→ 자연스러운 대화

A summary item must continue to reference the exact source record whenever the underlying product flow requires it.

## 3. Engineering Priorities

When priorities conflict, prefer:

1. correctness
2. data integrity
3. privacy
4. authorization
5. security
6. reliable synchronization
7. recoverability
8. testability
9. performance
10. maintainability
11. visual cleanup

## 4. Architecture Direction

Prefer this boundary:

Presentation UI
→ ViewModel / Feature Hooks
→ Application Use Cases
→ Repository
→ Crypto / Authorization
→ Supabase

Presentation components should not need to understand:

- Supabase authorization details
- RLS implementation
- encryption internals
- E2EE key management
- server mutation details

Do not perform a large architecture refactor solely to reach this target.

Move toward it incrementally when relevant to the requested work.

## 5. Security Rules

Never weaken:

- RLS
- Storage authorization
- ownership verification
- active couple verification
- private/shared visibility
- cycle raw-data owner-only access
- account deletion gates
- sensitive consent enforcement

Do not expose:

- service-role keys
- API secrets
- private keys
- GitHub tokens
- OAuth secrets
- user-content plaintext in logs

Never print actual discovered secrets in reports.

Use redacted identifiers only.

## 6. Sensitive Data

Treat the following as high-sensitivity user content:

- private daily records
- shared relationship records
- photos
- videos
- voice recordings
- private schedule content
- trip notes and addresses
- cycle periods
- cycle symptoms
- pain
- flow
- mood
- health notes

Raw cycle/health information must never become partner-visible unless the explicit product design and consent boundary allows a sanitized projection.

Symptom-only logging must NEVER create or extend a menstrual period or incorrectly influence period prediction.

## 7. E2EE Direction

The approved privacy architecture direction is:

Full User-Content E2EE + Minimal Server Metadata

However, do not implement E2EE merely because this file mentions it.

Only implement or modify cryptographic systems when the current user task explicitly requests the relevant E2EE phase.

Do not invent cryptography.

Use vetted platform cryptographic primitives and explicitly design:

- key ownership
- key wrapping
- nonce safety
- algorithm versioning
- device authorization
- key rotation
- recovery
- migration
- rollback

Never call a system E2EE if the server possesses sufficient secret material to decrypt all user content.

## 8. Database and Migration Safety

A migration file existing in Git does NOT prove that it is applied remotely.

Always distinguish:

- repository state
- local state
- test state
- remote Supabase state
- production state

If remote state cannot be verified, report it as:

UNVERIFIED

Do not perform destructive production changes without proving:

- necessity
- affected data
- backup/rollback strategy
- compatibility
- test coverage

Avoid irreversible:

- DROP
- mass DELETE
- destructive rewrites
- legacy health-data purge

unless explicitly authorized and safely rehearsed.

## 9. RLS / RPC / Storage

For all new or modified database/security paths, verify where applicable:

- RLS enabled
- authenticated access scoped
- anon denied
- ownership checks
- active couple membership
- private/shared visibility
- GRANT
- REVOKE
- service-role boundary
- SECURITY DEFINER necessity
- fixed search_path
- auth.uid() validation

Storage object paths alone must not be treated as sufficient authorization.

## 10. Account and Relationship Lifecycle

Security reviews and changes must consider:

- signup/login
- session restoration
- couple pairing
- couple unlink
- password reset
- logout
- account deletion
- data export
- new device
- lost/stolen device
- offline cache
- stale authorization
- recovery

Do not claim previously downloaded or saved partner data can be remotely revoked after it has already been accessed.

## 11. Logging and Analytics

Do not place user-content plaintext into:

- console logs
- error reporting
- analytics
- URLs
- push notification payloads
- debugging fixtures

Prefer event metadata such as:

- event type
- record id
- error code

rather than record content.

## 12. Testing Rules

Do not claim:

- implemented
- fixed
- secure
- migration applied
- RLS verified
- test passed

unless it was actually verified.

For each completed task, distinguish:

- tests executed
- tests not executed
- reasons for unexecuted tests

Security-sensitive behavior should include negative tests, not only successful paths.

Examples:

- unauthorized partner denied
- unrelated user denied
- anon denied
- former partner denied
- private data denied

## 13. Scope Discipline

Do not perform unrelated refactors.

Do not add new product functionality unless requested.

Do not redesign adjacent features while fixing a bug.

Prefer the smallest change that correctly solves the requested problem.

## 14. Production Safety

Before changing remote production state, identify:

- current state
- intended change
- blast radius
- rollback plan

Do not silently apply remote migrations or destructive mutations.

Explicitly report remote actions as:

APPLIED

or

NOT APPLIED

## 15. Completion Report

For substantial engineering tasks, report:

1. changed files
2. changed behavior
3. database/schema changes
4. remote changes actually applied
5. tests executed
6. tests not executed
7. remaining risks
8. rollback path
9. whether the next planned phase is safe to begin

Never present assumptions as verified facts.

## 16. Documentation Sources

When relevant, consult repository documentation before changing architecture.
Each question has exactly one deciding document:

Canonical Product/Business/Engineering documents have one active write owner.
Do not independently modify the same canonical source on parallel feature,
security, or audit branches. If such divergence already exists, the designated
canonical branch wins strategy conflicts; implementation branches must align
during convergence.

| Question | Canonical source |
|---|---|
| What should the product do? | `docs/PRODUCT_V3.md` |
| What is the approved business strategy? | `docs/BUSINESS_MEMORY_ROADMAP_V1.md` |
| What is currently implemented / blocked? | the repository, then `docs/CURRENT_STATE.md` |
| What order do we build in? | `docs/ENGINEERING_ROADMAP.md` |
| Cryptographic protocol | `docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md` |
| Privacy / data / legal architecture | `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md` |
| Visual presentation | `docs/DESIGN_V2.md` |
| Codebase structural traps / historical implementation notes | `docs/kiro/AI_HANDOFF.md` — verify against current code and canonical docs |
| Security / RLS coverage | `docs/SECURITY_TEST_PLAN.md`, `docs/rls-test-matrix.md` |
| Rollback | `docs/operations/rollback-runbook.md` |
| How to carry out a task (procedures) | `docs/skills/README.md` |

`docs/skills/` holds the tool-neutral procedures that Codex, Kiro, and Claude Code
all share: session recovery and direction check, feature build, security review,
migration gate, and release validation. Read the relevant one instead of
re-deriving the steps, and never fork a tool-specific copy of it.

Repository reality always wins for claims about what is currently implemented.
A document is not evidence that code exists, and a migration file is not
evidence that it was deployed.

If documentation conflicts with actual verified production behavior, report the discrepancy rather than silently choosing one.

## 17. Codex Orchestration

The primary agent owns user intent, scope, integration, final diff review, and
the completion report. It must not delegate merely to use subagents, or accept
a subagent's completion claim as proof.

### DIRECTION CHECK — mandatory before substantial work

Before implementation or a consequential documentation change, record:

- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict?

Business source review is required when a task can change the customer, problem definition,
product scope, AI role, monetization, pricing, storage/cloud strategy, media strategy, Memory
Product, KPI, or market expansion. If the conflict answer is `YES`, **STOP BEFORE
IMPLEMENTATION** and report the conflict to the Control Tower/user.

For non-trivial tasks, delegate bounded independent exploration, implementation,
verification, or review work to the appropriate configured subagent when doing
so materially improves reliability or keeps noisy intermediate work out of the
primary context. Do not spawn subagents for trivial changes, and do not duplicate
work merely to use multiple agents.

Classify work before delegating:

- **Level 0 — question:** answer directly.
- **Level 1 — small:** a clear one-file edit, copy change, minor UI adjustment,
  simple type error, or known-cause bug. Handle directly.
- **Level 2 — medium:** related-code discovery, 2–4 files, a small feature, or
  testing required. Use at most one Explorer, then one Worker; use Verifier for
  the changed path.
- **Level 3 — large:** multiple modules, data-flow change, complex bug, or
  major feature. Run at most two independent Explorers on non-overlapping
  read-only scopes, integrate their findings, then use one Worker and one
  Verifier. Add Reviewer only when its independent review has material value.
- **Level 4 — critical:** authentication, authorization, privacy, encryption,
  sensitive health data, destructive migration, core database schema, or
  hard-to-reverse architecture. Consult Architect before implementation; then
  use one Worker, Verifier, and an independent Reviewer or Architect final
  review as warranted.

Configured roles are intentionally narrow:

- **Explorer:** evidence-led code-path discovery; read-only.
- **Worker:** one clearly bounded implementation owner; no overlapping parallel
  writes and no unrelated refactors.
- **Verifier:** inspect the diff, run relevant tests/typecheck/lint/build as
  appropriate, and report failures and coverage gaps without redesigning.
- **Reviewer:** independent Terra-level review for consequential changes;
  prioritize correctness, regressions, data loss, races, validation, and test
  gaps—not style preferences.
- **Architect:** rare read-only security/privacy/database/architecture decision
  support. Compare safe options, state risks and constraints, then decompose
  the approved direction; do not implement by default.

Parallelize reads, not writes. Give each subagent a precise scope and concise
context; do not make several agents re-read the entire repository or receive
the same raw logs. Limit concurrent subagents to the project configuration.
Escalate a bounded Luna task from High to Max at most once only when the scope
is still clear; otherwise obtain Reviewer or Architect guidance.

Before reporting completion, the primary agent independently checks the actual
diff, changed files, test output, typecheck, lint, build necessity, user-flow
impact, and remaining risks. For high-risk data/security work, include relevant
negative authorization tests. Read project documents as needed rather than
copying them into prompts: `docs/kiro/AI_HANDOFF.md` for codebase structural traps
and historical implementation notes,
`docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md` for privacy/E2EE
decisions, `docs/SECURITY_TEST_PLAN.md` and `docs/rls-test-matrix.md` for
security/RLS coverage, and `docs/operations/rollback-runbook.md` for rollback.

### Abandoned-strategy guard

The following are superseded strategy, not active defaults. If a request reintroduces one,
mark `DIRECTION CONFLICT`, stop before changing the canonical plan, and ask whether the user
is intentionally changing strategy:

- Free 5GB / Plus 100GB / Archive 300GB or any storage-capacity subscription
- paid high-quality photo or paid long video
- E2EE or privacy as a premium gate
- subscription-first initial business model
- company-server-only media architecture
- AI selecting important memories automatically
- relationship score, affection score, breakup prediction, or hidden relationship analysis
- time-spent North Star or downloads as acquisition success
- military population treated as the entire customer market
- CloudKit described as already implemented
- audio/video described as currently complete

Historical `WORK_LOG` entries and superseded source packets remain for traceability, but they
must not be used as current business direction without an explicit user decision.

## 18. Mandatory Work Ledger

Every substantial engineering, verification, or security-review result must have a
corresponding `docs/WORK_LOG.md` entry. Keep detailed implementation rationale in
the commit or PR and use the ledger as the session index. The entry must include:

```text
PLAN POSITION
- Phase:
- Workstream:
- Step:
- Previous Gate:
- This Gate:

DIRECTION CHECK
- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- MASTER PLAN version / 기준일:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict:

OWNERSHIP
- Tool:
- Model:
- Role:
- PR:
- Branch:
- Base SHA:
- Old HEAD:
- New HEAD / Reviewed HEAD:

CHANGED / REVIEWED
- file:
- function/component/migration:
- what changed/reviewed:
- why:

EXPLICITLY NOT CHANGED
- crypto semantics:
- DB/migration semantics:
- product semantics:
- Production:

VERIFICATION
- command:
- PASS / FAIL / UNVERIFIED:
- what it actually proves:

REVIEW IMPACT
- NONE / DELTA / FULL:
- whether an earlier review is stale:

BLOCKERS
- code:
- environment:
- external/manual:

STOPPED AT
- exact completed boundary:

REMAINING
- not completed:

NEXT ACTION
- next owner:
- tool/model:
- 기준 SHA:
- exact next task:

DO NOT ADVANCE UNTIL
- next-step conditions:

PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED:
```

`CURRENT_STATE.md`에는 현재 현실만, `ENGINEERING_ROADMAP.md`에는 순서와 gate만
기록한다. 완료 주장보다 실제 명령과 증거를 우선한다.

## 19. Review Freshness

Review는 특정 exact commit에 대한 판정이다. HEAD가 바뀌면 이전 review를 자동으로
승계하지 않는다. 각 작업 종료 기록의 `REVIEW IMPACT`를 반드시 채운다.

| 변경 분류 | 필요한 영향 평가 |
|---|---|
| A. docs/comment/test wording only, security semantics 없음 | review 불필요 또는 narrow DELTA |
| B. packaging/native wiring 같은 좁은 변경 | targeted DELTA review |
| C. authorization/RLS/DB schema/migration | 해당 security review 재수행 |
| D. crypto protocol/trust authority/key semantics | Architect 판단 + FULL security review |
| E. parent/base/rebase가 security semantics에 영향 | integration/delta review |

리뷰 대상 PR의 보안 의미를 바꾸지 않는 별도 docs-only branch는 그 PR의 HEAD에
WORK_LOG-only commit을 추가하지 않는다. READ-ONLY Kiro Reviewer/Sol Architect는
저장소를 수정하지 않으며, 다음 write-capable owner가 복사할 수 있는 결과만 남긴다.
