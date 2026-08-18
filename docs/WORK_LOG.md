# 작업 기록 (Work Log)

> AI 에이전트가 수행한 작업의 누적 기록. `CLAUDE.md`의 지시에 따라 유지한다.
>
> **이 문서는 "무엇을 했는가"의 기록이다.** 제품 의도는
> [`PRODUCT_V3.md`](PRODUCT_V3.md), 저장소 현실은
> [`CURRENT_STATE.md`](CURRENT_STATE.md), 구현 순서는
> [`ENGINEERING_ROADMAP.md`](ENGINEERING_ROADMAP.md), 사업전략은
> [`BUSINESS_MEMORY_ROADMAP_V1.md`](BUSINESS_MEMORY_ROADMAP_V1.md)가 각각 canonical이다.
> 여기에 제품 결정을 새로 쓰지 않는다.

## 앞으로 사용할 표준 세션 원장 형식

새 세션 기록은 아래 구조를 사용한다. 과거 자유형식 기록은 역사 보존을 위해
삭제·재작성하지 않는다.

```markdown
### YYYY-MM-DD · [Phase/Step] 세션 제목

#### PLAN POSITION
- Phase:
- Workstream:
- Step:
- Previous Gate:
- This Gate:

#### DIRECTION CHECK
- Product source checked:
- Business source checked / NOT APPLICABLE:
- Engineering source checked:
- Current-state checked:
- Latest relevant Work Log checked:
- MASTER PLAN version / 기준일:
- Does this task conflict with canonical direction? YES / NO
- If YES, what conflict:

#### OWNERSHIP
- Tool:
- Model:
- Role:
- PR:
- Branch:
- Base SHA:
- Old HEAD:
- New/Reviewed HEAD:

#### CHANGED / REVIEWED
- file:
- function/component/migration:
- what changed/reviewed:
- why:

#### EXPLICITLY NOT CHANGED
- crypto semantics:
- DB/migration semantics:
- product semantics:
- Production:

#### VERIFICATION
- command:
- PASS / FAIL / UNVERIFIED:
- what it actually proves:

#### REVIEW IMPACT
- NONE / DELTA / FULL:
- whether an earlier review is stale:

#### BLOCKERS
- code:
- environment:
- external/manual:

#### STOPPED AT
- exact completed boundary:

#### REMAINING
- not completed:

#### NEXT ACTION
- next owner:
- tool/model:
- 기준 SHA:
- exact next task:

#### DO NOT ADVANCE UNTIL
- next-step conditions:

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED:
```

### 2026-08-18 · P5.5 Final Landing 및 Control Tower 동기화

#### PLAN POSITION
- Phase: P5.5
- Workstream: landing / documentation state sync
- Step: final landing 후 canonical 상태 갱신
- Previous Gate: P5.5 landing preparation READY
- This Gate: P5.5 CLOSED

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — no product change
- Business source checked / NOT APPLICABLE: NOT APPLICABLE
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`
- Current-state checked: `docs/CURRENT_STATE.md` updated to landed master
- Latest relevant Work Log checked: yes
- MASTER PLAN version / 기준일: repository canonical docs / 2026-08-18 live state
- Does this task conflict with canonical direction? NO

#### OWNERSHIP
- Tool: Codex / GitHub CLI
- Model: Luna-assigned documentation state-sync task
- Role: Control Tower state sync
- PR: #68
- Branch: `master`
- Base SHA: `8a2167073bce4d9c9ef6dbe35f1b40a8122180c6`
- Old HEAD: `8a2167073bce4d9c9ef6dbe35f1b40a8122180c6`
- New/Reviewed HEAD: `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7`

#### CHANGED / REVIEWED
- file: `docs/CURRENT_STATE.md`, `docs/PROJECT_HANDOFF_2026-08-13.md`, `docs/WORK_LOG.md`
- file: `control-tower/Dashboard.md`, `control-tower/Current Gate.md`, `control-tower/Decision Log.md`
- what changed/reviewed: recorded P5.5 CLOSED, landed master and CI, superseded provenance, and parked-memory integration boundary
- why: remove stale pre-landing state without changing code or product behavior

#### EXPLICITLY NOT CHANGED
- crypto semantics: unchanged
- DB/migration semantics: unchanged; no remote migration application
- product semantics: unchanged
- Production: NOT APPLIED

#### VERIFICATION
- command: live GitHub/Git verification; post-merge `master validation` `32095000055`; post-merge `Native release validation` `32095000040`
- PASS / FAIL / UNVERIFIED: PASS for repository landing and CI; Production/Supabase/native physical-device gates remain NOT APPLIED or UNVERIFIED
- what it actually proves: master contains the approved P5.5 candidate and both post-merge workflows completed successfully

#### REVIEW IMPACT
- NONE / DELTA / FULL: DELTA — documentation state only
- whether an earlier review is stale: pre-landing dashboard/gate snapshots are superseded; security and harness reviews remain attached to their exact SHAs

#### BLOCKERS
- code: none in this task
- environment: remote Supabase catalog and physical-device state remain UNVERIFIED
- external/manual: future Production/Supabase/device gates require separate authorization

#### STOPPED AT
- exact completed boundary: P5.5 landed at master merge commit `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7`

#### REMAINING
- no P6 or new feature work authorized by this entry

#### NEXT ACTION
- next owner: Control Tower / human landing recordkeeper
- tool/model: future task must re-read current canonical docs and live state
- 기준 SHA: `eb2d9a4f9eca9742296bfe0d5a2a8e980499f2e7`
- exact next task: none; keep P5.5 CLOSED

#### DO NOT ADVANCE UNTIL
- new Control Tower decision authorizes the next phase

#### PRODUCTION
- NOT APPLIED

---

### 2026-08-16 · 세 도구 공용 절차서 통합 (Codex · Kiro · Claude Code)

같은 절차를 도구마다 따로 두면 반드시 갈라지므로, 절차 원본을 `docs/skills/`(도구 중립,
Git 추적) 한 곳으로 모으고 각 도구는 그 파일을 가리키는 얇은 래퍼만 갖게 했다. 제품
코드·crypto·migration·Production은 변경하지 않았다.

- `docs/skills/` 신설: `control-tower` `feature-build` `security-review`
  `migration-gate` `release-validation` + `README.md`(도구별 진입점, 공유되는 사실의
  소유자, 도구 간 인계 절차).
- `.claude/skills/*/SKILL.md`를 70줄대 본문에서 **10줄 래퍼**로 축소(frontmatter +
  "원본을 읽어라"). 내용 중복 제거.
- `.kiro/steering/shared-procedures.md` 신설 — Kiro가 같은 절차서를 쓰도록 하고, 다른
  도구가 남긴 작업을 이어받는 절차와 이 저장소에서 실제로 나온 실수 3건을 명시.
- `.kiro/steering/merge-policy.md` 수정: `kiro/v1-product-excellence-audit`로의 **자동
  merge 허용을 제거**했다. 그 브랜치는 현재 활성 스택과 무관해졌고(stale), 도구마다 다른
  merge 권한을 갖는 것 자체가 위험하다. 이제 세 도구 모두 "merge는 사용자만"으로
  통일된다(Claude Code는 hook으로 `gh pr merge`를 차단). CI가 없을 때 green을 주장하지
  않는다는 규칙과 정직성 요구사항은 보존했다.
- `AGENTS.md` §16에 `docs/skills/README.md` 행을 추가하고, **누락돼 있던 business
  canonical**(`BUSINESS_MEMORY_ROADMAP_V1.md`)을 추가했다.
- `.gitignore`: `/.codex/` 전체 제외를 유지하면서 `config.toml`과 `agents/`만 예외로
  추적한다(worktree 체크아웃·캐시·세션 DB는 계속 제외). 이제 새 기기·새 clone에서도
  subagent 5개 설정이 따라온다.
- `scripts/claude/` → `scripts/agent/`로 이동. 공용 절차서가 특정 도구 경로를 가리키지
  않게 했다.

검증: 마크다운 링크 전수 검사 **깨진 링크 0건**, Skill 래퍼 5/5 경로 유효,
`.codex/` 추적 대상이 정확히 설정 6개(worktree 복사본 제외됨), hook 재확인
(`gh pr merge` 차단 / `npm test` 통과), `live-state.sh`·`validate.sh` 새 경로에서 동작,
typecheck·lint PASS, full Vitest **158 files / 2,302 tests PASS**.
Production **NOT APPLIED**, master merge 없음.

---

### 2026-08-16 · Claude Code 오케스트레이션 레이어 정리 (제품 코드 변경 없음)

반복 지침을 올바른 레이어로 옮겼다. 제품 기능·crypto·migration·Production은 건드리지
않았다. 설치 버전을 실제로 확인했다: **Claude Code 2.1.220**.

- `CLAUDE.md`: 49 → 63줄. 항상 참인 규칙만 남기고 절차는 Skill로, 결정 가능한 금지는
  Hook으로 옮겼다. 누락된 business canonical(우선순위 2번)을 추가했고, "이 파일에 넣지
  않는 것"(휘발성 PR/HEAD/blocker)을 명시했다.
- `.claude/skills/` 5개 신설: `gomsin-control-tower`(복구·live 검증·DIRECTION CHECK),
  `gomsin-feature-build`, `gomsin-security-review`, `gomsin-migration-gate`,
  `gomsin-release-validation`. 각 47–77줄이며 canonical 문서를 복사하지 않고 읽도록
  지시한다. 모든 description에 "Do not use for…" 경계를 넣어 trigger 범위를 좁혔다.
- `.claude/hooks/` 2개 신설(PreToolUse, deterministic): 원격 Supabase migration/link,
  force push, `reset --hard`, `clean -f`, worktree 폐기, master 직접 push, `git merge`,
  `gh pr merge`, frozen 041/042 조작, secret 읽기, 기존 migration 재작성, credential
  파일 쓰기. PostToolUse·Stop hook은 **의도적으로 두지 않았다** — 매 저장/종료마다 느린
  검사를 강제하지 않고 범위별 validation을 쓴다.
- `scripts/agent/live-state.sh`(read-only 상태 출력), `scripts/agent/validate.sh`
  (`docs|app|security|migration` 범위별 검증 + unverified 고정 출력). 후자는
  `package.json`에 실제 있는 script만 호출한다.
- Agent Teams: **2.1.220에 team/swarm 기능이 없음**을 `claude --help`로 확인. 정책상 OFF.
- MCP: 연결된 8개(Notion·Gmail·Drive·Slack 등)는 이 프로젝트와 무관. 저장소 작업에서
  사용하지 않고 GitHub live state는 `gh`로 충분. Production write는 자동 루프에 금지.
- `.claude/settings.local.json`은 개인 권한 파일이라 `.gitignore`에 추가(공유 레이어만 추적).

검증: hook 차단 8/8 + 파일 5/5 정확, 정상 개발 명령 12건 오탐 **0건**, 쓰기 허용 5/5,
`claude doctor` OK, JSON/shell 문법 OK, typecheck·lint·build PASS,
full Vitest **158 files / 2,302 tests PASS**. Production **NOT APPLIED**, master merge 없음.

---

### 2026-08-16 · QUEUE 2–7 — gate 재평가 (환경 전제조건으로 대부분 차단)

QUEUE 1을 닫은 뒤 남은 queue의 진입 조건을 이 checkout에서 재확인했다. 코드를 쓰지 않고
gate만 판정했으며, 충족되지 않은 단계는 구현하지 않았다.

| Queue | 판정 | 이 checkout에서 확인한 사실 |
|---|---|---|
| 2 실기기/두 계정 지원 | PARTIAL — 문서만 진행 | 실기기 없음, `xcodebuild`가 Command Line Tools만 가리켜 iOS native 검증 불가, `deno` 없어 `test:edge` 실행 불가. 자동화 가능한 부분(static/native contract 85 tests)은 이미 통과 상태다. QUEUE 1이 닫은 항목을 검증할 수 있도록 두 계정 체크리스트에 `5-4b` 12항목을 추가했다 |
| 3 사진 E2EE + CloudKit | BLOCKED | `ios/App/App/App.entitlements`에 iCloud container/ubiquity entitlement가 없고 주석이 명시적으로 `No iCloud storage. Sync is Supabase only.`라고 적혀 있다. CloudKit container 생성은 manual Apple developer configuration이며 사용자 승인·자격증명이 필요하다. 현재 미디어 경로는 `src/lib/records.ts`가 `couple-media` Storage에 직접 업로드한다 |
| 4 기본 기억 아카이브 | NOT STARTED — QUEUE 3 의존 | 사진 E2EE 기반 이후로 정의된 단계다. 평문 미디어 위에 아카이브를 세우면 나중에 되돌리기 어려운 표면이 생긴다 |
| 5 온디바이스 AI | NOT STARTED — QUEUE 4 의존 | 정리할 기록 corpus와 아카이브가 선행 조건이다. Apple on-device stack 조사는 실기기·Full Xcode 없이는 성능/열/지연을 측정할 수 없다 |
| 6 우리의 한 달 MVP | NOT STARTED — 상위 queue 의존 | `ENGINEERING_ROADMAP`의 `P-MP` 단계가 소유하며 M5 축적 기반 이후다. 결제·POD는 법적·비용 경계가 열려 있어 이번에 만들지 않았다 |
| 7 Limited Validation hardening | NOT STARTED — QUEUE 1 리뷰 선행 | `LV` gate는 QUEUE 1의 보안 수정이 독립 리뷰를 통과한 뒤에 의미가 있다 |

보안 gate를 우회해 후속 기능을 먼저 만들지 않았다. Production·remote Supabase·master
merge·PR merge는 수행하지 않았다.

---

### 2026-08-16 · QUEUE 1 — P5.5 security blocker closure (1B / 1C / actor binding)

PR #66 감사 HEAD `d1bace6`에서 남은 P5.5 blocker를 실제 코드로 닫았다. Production /
remote Supabase에는 조회·배포·mutation을 실행하지 않았다.

**1B — Couple Protection Activation (닫힘).** `activateCoupleProtection`은 구현되어
있었지만 **어떤 제품 경로에서도 호출되지 않았다**(호출자는 Settings 1인 ceremony의
`activatePersonalProtection`뿐). 실제 커플이 shared record를 floor 아래에서 계속 쓸 수
있던 gap이다. `runtimeSession.ts`에 server-authoritative 활성화를 추가하고
`refreshCoupleLifecycle`의 `connected` 판정 한 곳에 연결했다 — 초대자 폴링, 수락자 코드
입력, hydration, unlink 후 재연결이 모두 지나는 단일 지점이다. 커플은
`listOwnedCoupleScopeIds()`가 고르고 client state가 고르지 않으며, scope가 정확히 1개가
아니면 거부한다. 상태를 `activated / not_paired / keys_pending / unavailable`로 분리해
pending invitation과 "커플은 있으나 CSK 미발급"을 구분한다. 실패는 floor를 켜지 않고
shared write를 fail closed로 남긴다.

**1C — Kit-Verified 복구 경로 (닫힘).** protected local state는 이미 ciphertext가 있을 때
대체 키 생성을 거부하고 `E_PROTECTED_STATE_KEY_MISSING`을 던졌지만, **그 오류를 아무도
처리하지 않았다.** Settings는 `TEMPORARILY_UNAVAILABLE`로, 세션은 조용한 `localState =
null`로 보고해 사용자가 Recovery Kit 검증에 도달할 수 없었다. 이제 server recovery
identity가 있을 때 `RECOVERY_REQUIRED`로, 없으면 `SECURE_STORAGE_UNAVAILABLE`로
보고하고, 세션은 `guarded / recovery_required`를 반환한다. 어느 경로도
`SETUP_REQUIRED`가 되지 않는다 — 기존 ciphertext에 대한 대체 권한 생성을 막는다.

**1A — Actor-Bound Recovery (부분: 서버 결속 확인 + 046 forward fix).** 감사가 우려한
actor binding은 상당 부분 이미 존재했다: `verify-recovery` Edge Function이
`caller.user.id`로 challenge와 device 양쪽 소유를 확인하고 `E_WRONG_ACCOUNT`로 거부하며
(negative 테스트 3건 존재), `e2ee_commit_recovery_authentication`은 challenge 소비와
device 전이를 한 트랜잭션에서 수행한다. 반면 `e2ee_begin_device_provisioning`과
`e2ee_finalize_device_provisioning`은 소유권을 `v_uid IS NOT NULL AND ...`로 비교해
**`auth.uid()`가 NULL인 실행 컨텍스트에서 소유권 비교를 건너뛰었다.** migration 046이
045와 동일한 형태로 NULL actor를 먼저 거부하도록 forward 수정했다. revocation 우선순위·
인증서 요구·envelope coverage·허용 상태·idempotent 반환은 그대로 보존했다.

검증: full Vitest **158 files / 2,299 tests PASS**, write-floor **39 assertions PASS**
(046 신규 6건: NULL actor·타 계정·anon × begin/finalize), P0 76 · Phase 0 fresh-chain ·
P5 integrated 93 · rollback PASS, native static 85 PASS, typecheck / lint / build /
`git diff --check` PASS. 실기기 recovery·cold-start, remote catalog, staging, production은
**UNVERIFIED / NOT APPLIED**.

남은 1A 범위: recovery는 인증 이후에도 certificate → provisioning → 회전 → finalize가
여러 요청으로 남아 있다. 각 단계가 서버에서 actor·상태를 재검증하고 실패 시
`PROVISIONING_FAILED`로 닫히지만, 단일 ceremony RPC로의 통합과 실기기 검증은 남았다.
ceremony 자체는 `VITE_E2EE_DEVICE_PROTECTION_ENABLED` build flag 뒤에 있어 기본
빌드에서 노출되지 않는다.

---

### 2026-08-16 · Security Stack Integration Audit & Repair V1

Queue 1–4 통합 HEAD `e97b951`을 기준으로 실제 runtime·outbox·RLS/RPC·migration
chain·알림·계정/커플 lifecycle을 감사했다. Production/remote Supabase에는
조회·배포·mutation을 실행하지 않았다.

- migration 045로 write-floor 활성화를 소유 ACTIVE 기기의 인증서와 해당 ACTIVE
  scope epoch의 self-notarized envelope에 결속했다. PENDING·recovery·provisioning·
  failed·revoked 기기는 personal/couple 모두 거부한다.
- 인증 runtime의 첫 await 전 fail-closed guard, 보호 ciphertext가 있을 때 대체 LCK 생성
  금지, floor/couple-key를 포함한 정직한 보호 상태, account-switch session predicate,
  provider unmount teardown을 추가했다.
- outbox를 원래 couple id에 고정해 unlink 후 새 파트너에게 예전 기록이 전송되는
  경로를 payload open 전과 첫 mutation 전 두 곳에서 차단했다.
- talk-about read 실패를 빈 성공으로 변환하지 않고 기존 목록을 유지하며, full
  hydration에서는 `talk-about` unavailable stage로 보고한다. 알림 dedupe는 immutable event
  id를 사용하고 preference 통과 후에만 소비한다. 백그라운드/native push가 없는
  현재 범위를 Settings에 `앱이 열려 있을 때`로 표시했다.
- 탈퇴 복구 marker는 logout 후에도 보존하되, signed-out 사용자를 가두던 in-memory
  recovery route state는 해제했다. 동일 계정 재로그인 시 marker로 다시 복구한다.
- P5 actor harness를 `031→032→034→035→036→037→038→039→040→043→044→045`
  fresh chain으로 교정하고, 예전 032만 훼손하던 mutation test를 최종 040 정의에
  결속했다.
- 검증: full Vitest 157 files / 2,294 tests PASS, P0 76·Phase 0 active fresh-chain
  125·P5 integrated 93·write-floor 33 assertions PASS, rollback(031–036 pre-activation contract) PASS,
  native static 85 tests PASS, typecheck/lint/build/diff-check PASS. 실기기 recovery/cold-start,
  remote catalog/staging/production은 **UNVERIFIED / NOT APPLIED**.

P6는 여전히 차단된다. production couple pairing/floor activation 경로, LCK-loss 후 kit-verified
protected-state replacement, recovery 중 account-switch와 server mutation의 원자적 결속, 실기기
native/CloudKit gate가 남아 있다.

### 2026-08-16 · Notification & Re-entry V1 — privacy-safe local delivery

`codex/device-protection-recovery-v1`의 Queue 1 완료 커밋 `67b8cb8`을 기준으로
`codex/notification-reentry-v1`에서 구현했다. 기존 couple realtime 재검증 경로를
재사용하되, 초기 authoritative refresh가 끝난 뒤 새로 확인된 partner shared record와
partner talk-about mark만 generic 재진입 이벤트로 만든다. cold load에서 기존 기록을
새 알림으로 재생하지 않으며, 현재 active couple/session이 아니면 이벤트를 버린다.

- 앱 안 알림과 Settings의 계정별 알림 설정을 추가했다. 시스템 알림은 브라우저
  `Notification` 권한 adapter만 연결했으며 APNs/FCM/native background delivery는 아직
  연결하지 않았다.
- 제목·본문·push data에는 기록 본문, 사진, 일정, 상대방 이름을 넣지 않는다. 전달하는
  destination은 opaque record id뿐이고, 클릭 시 기존 RecordPage의 현재 authorization과
  deleted/unavailable surface를 다시 통과한다. 조용한 다른 기록 fallback은 없다.
- 이벤트 dedupe, disabled preference, unsupported notification API, stale session drop을
  회귀 테스트로 고정했다. 새 DB 컬럼·migration·remote preference 저장은 추가하지 않았다.
- 검증: targeted Vitest 91 tests PASS, `npm run test:p5` 93 assertions PASS,
  `npm run typecheck` PASS, `npm run lint` PASS, `npm run build` PASS,
  `git diff --check` PASS. 실기기 백그라운드 수신, APNs/FCM, 원격 Supabase 상태는
  UNVERIFIED / NOT APPLIED.

---

### 2026-08-16 · Limited Validation Ready Core UX — write protection handoff

Queue 2의 완료 HEAD를 기준으로 핵심 사용자 경로를 다시 검증했다. 전체 Vitest를
실행하면서 두 통합 회귀를 실제로 발견·수정했다: 알림 재진입 bridge를 `MobileShell` 안에
두어 StoreProvider 없는 shell 단위 테스트가 깨지던 문제는 App/store 경계로 옮겼고,
Settings가 `src/crypto` 타입·adapter를 직접 가져가던 문제는 application boundary로
모았다. 그 결과 독립 shell/accessibility 테스트와 E2EE layering 경계가 함께 통과한다.

- write floor에서 device key/epoch가 없을 때 `saveRecordToDB()`가 일반 서버 오류로
  뭉개지지 않고 `protectionRequired` 증거를 전달한다. Store는 이를
  `protection_required`로 분류하고, 기록 컴포저는 draft를 유지한 채 Settings로 바로
  이동할 수 있는 `설정 열기` action을 제공한다. 평문 fallback은 추가하지 않았다.
- record 작성 탭의 독립 컴포저, 양쪽 role의 `상대방의 오늘`, durable `?record=` 원본
  라우팅과 offline outbox를 현재 코드·회귀 테스트와 대조해 CURRENT_STATE의 해결 항목을
  갱신했다.
- 검증: targeted core tests 73 tests PASS, 전체 Vitest 157 files / 2283 tests PASS,
  `npm run test:p0` 76 assertions PASS, `npm run test:p5` 93 assertions PASS,
  `npm run test:write-floor` 18 assertions PASS, `npm run test:rollback` PASS,
  `npm run typecheck` PASS, `npm run lint` PASS, `npm run build` PASS,
  `git diff --check` PASS. 실기기 종료·재실행/실제 계정 전환·remote Supabase 상태는
  UNVERIFIED / MANUAL GATE.

---

### 2026-08-16 · P6 Readiness — entry gates remain closed

Queue 1–3 완료 HEAD `fa68c72`에서 P6를 구현하지 않고 read-only readiness audit만
수행했다. `ENGINEERING_ROADMAP.md`의 P6는 P0-b와 사진 E2EE 기반을 전제로 하며,
현재 저장소의 미디어 경로와 native/iCloud 상태는 그 진입 조건을 충족하지 않는다.

| Gate | 저장소에서 확인한 사실 | 판정 |
|---|---|---|
| Core Privacy Foundation | `35da04c` integration 위에 Queue 1–3이 순차적으로 쌓였고 local P0/P5 actor harness가 통과했다 | DEVELOPMENT EVIDENCE ONLY |
| DeviceKeys / LCK | first-party Capacitor plugin의 iOS Podfile·Android Gradle wiring과 static tests는 존재한다. 실제 iPhone에서 setup/restart/logout/recovery/locked-state를 수행하지 않았다 | UNVERIFIED / MANUAL GATE |
| Active migration chain | 후속 통합 감사에서 local harness를 031→032→034→035→036→037→038→039→040→043→044→045 fresh chain으로 교정했다. migration ledger는 E2EE chain을 신규/어디에도 미적용으로 둔다 | REMOTE UNVERIFIED; NOT APPLIED |
| CloudKit prerequisite | `ios/App/App/App.entitlements`에 iCloud container/ubiquity entitlement가 없고, native guide도 iCloud container가 없다고 명시한다. CloudKit/CKShare/CKAsset 구현·container identifier·test harness가 없다 | BLOCKED |
| Current media path | `src/lib/records.ts`가 `File`을 private `couple-media` Storage에 직접 업로드하고 signed URL로 읽는다. media ciphertext/envelope/CloudKit ownership 경계가 없다 | P6 NOT READY |
| Future migration number | 045는 write-floor 활성화 보안 수정에 사용했다. frozen 042를 재발급하지 않고 P6 재개 시 046 이상 새 forward migration을 사용한다 | RECORDED; DO NOT USE 042 |

`npm run verify:native`는 85 static/native contract tests PASS였지만, 이것은 실제
서명·기기·CloudKit entitlement 검증이 아니다. 따라서 P6A 구현, media migration,
CloudKit container 생성, remote mutation은 수행하지 않았다.

---

### 2026-08-16 · Device Protection & Recovery UX V1 — local implementation

`35da04c` Core Privacy Foundation integration을 기준으로 `daily_records` P5 actor/RLS
harness를 다시 실행했고, 93 assertions가 통과했다. Production·remote Supabase에는
조회나 변경을 하지 않았다.

- Settings는 runtime과 같은 protected-local-state namespace를 읽고, verified runtime/LCK
  기준의 `보호됨 / 설정 필요 / 복구 필요 / 보안 저장소 사용 불가 / 일시 확인 불가`를
  표시한다. 상태를 알 수 없을 때 보호됨으로 표시하지 않는다.
- 최초 native 설정은 recovery code와 기존 canonical recovery anchor artifact를 명시적으로
  저장·재입력한 뒤에만 완료한다. 자동 clipboard 복사는 하지 않는다. ceremony는 명시적
  `VITE_E2EE_DEVICE_PROTECTION_ENABLED=true` build flag가 있어야 시작한다.
- 실제 결함을 수정했다: Settings가 runtime과 다른 namespace를 읽어 bootstrap을 놓치던
  문제와, `recoverWithKit`가 server ACTIVE device를 만든 뒤 local runtime-discovery state를
  저장하지 않던 문제. recovery artifact는 새 crypto format이 아니라 기존 canonical anchor
  bytes의 display/transport form이다.
- 검증: targeted Vitest 42 tests PASS, `npm run test:p5` 93 assertions PASS,
  `npm run typecheck` PASS. Native device/restart/logout/recovery drill, remote catalog,
  migration deployment은 UNVERIFIED / NOT APPLIED.

---

### 2026-08-14 · 문서 source-of-truth 정규화

문서 아키텍처를 정리했다. `PROJECT_HANDOFF_2026-08-13.md`를 프로젝트 상태 스냅샷에서
canonical 문서 지도와 작업 시작 규칙 중심으로 축소했고, 문서별 소유권을 명확히 했다.
역사 문서는 삭제하지 않고 필요한 경우 상태 표지로 구분했다. `PRODUCT_V3.md`의 제품
방향은 변경하지 않았으며, 활성 P5 PR #54 때문에 `CURRENT_STATE.md`의 broad refresh는
P5 해결 후 별도 작업으로 유보했다.

## 수정 사항이 기록되는 곳 — 우선순위

작업 내용은 원래 아래 다섯 곳에 나뉘어 기록된다. 이 문서는 그것들을 **가리키는
색인**이지, 대체물이 아니다.

| 무엇 | 어디 | 성격 |
|---|---|---|
| 변경의 이유와 근거 | **git commit message** | 영구. 가장 자세하다 |
| 변경 묶음의 요약·검증 결과 | **PR 본문** | 영구 |
| 코드가 왜 그렇게 생겼는지 | **해당 파일의 주석** | 영구. 코드와 함께 이동 |
| 현재 저장소의 결함·미구현 | [`CURRENT_STATE.md`](CURRENT_STATE.md) | 휘발성. 해소되면 삭제 |
| 마이그레이션 적용 상태 | [`../supabase/migrations/README.md`](../supabase/migrations/README.md) | Git 추적 ≠ 운영 적용 |
| 세션 단위 작업 색인 | **이 문서** | 누적 |

---

## 세션 기록

### 2026-08-15 · [Control Tower Governance / documentation infrastructure] canonical 문서 governance 정규화

#### PLAN POSITION
- Phase: Control Tower Governance / documentation infrastructure
- Workstream: canonical documentation foundation
- Step: session start/end recovery and review freshness normalization
- Previous Gate: canonical documents existed but active plan/state/session ownership was split
- This Gate: new-AI recovery protocol, build train, active-state split, and work ledger rules recorded

#### OWNERSHIP
- Tool: Codex
- Model: Luna / High
- Role: Documentation Worker + Verifier
- PR: #61 (draft) — https://github.com/yesung23/gomsin-log/pull/61
- Branch: `docs/control-tower-governance`
- Base SHA: `83c9b82b4cb9a5f3978b192a16927f3c01dba213`
- Old HEAD: `83c9b82b4cb9a5f3978b192a16927f3c01dba213`
- New/Reviewed HEAD: `6675d2b23b75ca57cbae9728797b88e4d3d20412`

#### CHANGED / REVIEWED
- file: `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`, `docs/CURRENT_STATE.md`, `docs/WORK_LOG.md`, `docs/PROJECT_HANDOFF_2026-08-13.md`
- function/component/migration: documentation rules only
- what changed/reviewed: session boot/end protocol, mandatory ledger, review freshness, P5.1–P5.5/ARCH-P6 train, master-vs-active checkpoint, and handoff recovery map
- why: new AI sessions must recover the same plan and state without conversation memory

#### EXPLICITLY NOT CHANGED
- crypto semantics: none
- DB/migration semantics: none
- product semantics: none
- Production: no mutation

#### VERIFICATION
- command: `git diff --check`, changed-file audit, Markdown/link and stale-statement scans, live `gh pr view` metadata for PRs #54/#57/#58/#59/#60
- PASS / FAIL / UNVERIFIED: PASS for documentation scope; remote Supabase/device gates UNVERIFIED
- what it actually proves: only the six allowed documents changed on this branch and the recorded PR checkpoints matched live GitHub at review time

#### REVIEW IMPACT
- NONE / DELTA / FULL: NONE for the security PRs; this is a separate docs-only branch
- whether an earlier review is stale: no security PR HEAD was changed

#### BLOCKERS
- code: none in this docs-only scope
- environment: native Android/iOS and physical-device gates remain outside this task
- external/manual: Control Tower must reverify volatile PR/CI/mergeability and remote migration state before advancing

#### STOPPED AT
- Control Tower governance rules committed and draft PR opened

#### REMAINING
- live reviewer approval and future sessions applying the protocol

#### NEXT ACTION
- next owner: Control Tower
- tool/model: GitHub live verification, then assigned Worker/Reviewer
- 기준 SHA: this docs branch HEAD after push
- exact next task: verify the diff and approve or request changes on the docs-only PR

#### DO NOT ADVANCE UNTIL
- six-document diff is approved, active PR facts are refreshed, and P5.2 native/device gates are independently verified before P6A

#### PRODUCTION
- NOT APPLIED

### 2026-08-14 · 00-BM — iCloud-first 기억 제품 사업 모델 전환

기존 Free 5GB / Plus 100GB / Archive 300GB와 저장용량·원본 화질·긴 미디어를 판매하는
구독 가설을 폐기했다. 연결과 정상적인 보존은 무료로 유지하고, 사용자가 고른 시간을
정리·편집·제작하는 디지털/실물 기억 제품을 주요 수익 모델로 재정의했다.

`PRODUCT_V3.md`에는 보존 과금 원칙, 코어 이후 미디어 확장, iOS-first 사용자 소유
iCloud/CloudKit 방향과 미구현 상태를 반영했다. `BUSINESS_MEMORY_ROADMAP_V1.md`는
FREE CORE + 일회성 기억 제품 + 실물 제품 + 검증 후 optional Plus 구조로 재작성했다.
`ENGINEERING_ROADMAP.md`에는 P5 뒤, P6 구현 전의 `ARCH-P6` 검증 단계를 추가했다.
CloudKit 구현·코드·migration·crypto·P5 PR·production은 변경하지 않았다.

### 2026-08-14 · PR #56 최종 문서 정합성 정리

`PROJECT_HANDOFF_2026-08-13.md`에서 특정 PR이나 활성 작업을 전제로 한 `CURRENT_STATE.md`
갱신 유보 문구를 제거하고, 휘발성 문서는 실제 코드와 대조한다는 내구성 있는 규칙으로
정리했다. 문서 인벤토리 집계는 실제 Markdown 54개를 기준으로 확인했으며, 이전 58 합계는
primary classification과 secondary 상태 속성을 중복 합산한 결과로 판정했다. 별도 인벤토리
문서를 만들거나 기존 canonical 문서를 변경하지 않았다. 코드·마이그레이션·PR #54는 건드리지
않았다.

### 2026-08-14 · PRODUCT_V3 North Star — 장기 기억 보존 비전 정합화

장기 기억 보존 방향이 사업 로드맵에만 남아 canonical 제품 의도와 분리되어 있던 문제를
해소했다. `PRODUCT_V3.md`에 현재의 핵심 목적(서로의 놓친 하루를 잇기)과 장기 표현(함께하지
못한 시간을 안전하게 쌓아 다시 보고 손에 남기기)을 두 horizon으로 명시했다. 기록은 그날
소비되고 끝나지 않지만 기억의 중요도는 앱이 자동 결정하지 않는다는 원칙, 사용자가 고른
기록·사진·대화·북마크·마일스톤 중심의 장기 확장, 미디어의 기억 보존 역할, Book Studio의
제품 방향과 E2EE/명시적 opt-in 경계를 추가했다.

`PROJECT_HANDOFF_2026-08-13.md`의 제품 요약도 같은 방향으로 작게 맞췄다. 가격·용량·
인프라·수익화·인쇄 세부는 `BUSINESS_MEMORY_ROADMAP_V1.md`에 그대로 남겼고,
`ENGINEERING_ROADMAP.md`의 순서와 P5 다음 단계, 코드·마이그레이션·UI·배포는 변경하지
않았다. 검증은 문서 diff, 링크/교차참조, `git diff --check`로 수행한다.

최종 보정에서 연결이 일차 목적이고 보존은 연결된 시간을 잃지 않게 하는 장기 표현임을
명확히 했다. 앱 체류·메시지 수·읽음 압박을 늘리는 대신 실제 대화로 이어지게 한다는 원칙과,
핵심 관계 연속성을 paywall로 만들지 않고 보존 확장에 과금한다는 제품 경계를 추가했다.
사업 모델·가격·저장·인프라 세부는 사업 로드맵에 남겼다.

### 2026-08-14 · PR #53 · P4 병합 후 핸드오프 갱신

PR #52가 `58efb7d`로 `master`에 머지된 뒤 같은 #53 브랜치를 최신 `origin/master`에
맞췄다. `PROJECT_HANDOFF_2026-08-13.md`의 저장소 스냅샷을 현재 기준으로 갱신하고,
P4를 완료로 표시했으며 다음 엔지니어링 단계가 P5임을 명시했다. #53은 현재 열린
핸드오프 PR로 유지한다. `WORK_LOG` 충돌은 #52 계약 기록과 #53 비즈니스/핸드오프
기록을 모두 보존하는 방식으로 해결했다. `git diff --check`와 문서 링크/충돌 검사를
실행했다. 프로덕션 조회·mutation과 P5 구현은 수행하지 않았다.

---

### 2026-08-13 · 새 PR — 프로젝트 핸드오프 + 장기 비즈니스/메모리 방향

Claude 사용이 앞으로 제한된다는 전제로, 다른 AI(Codex, Kiro, Gemini 등)나
사람이 CLAUDE.md/AGENTS.md 다음으로 읽고 저장소를 이어받을 수 있도록 하는
순수 문서화 작업. **코드·마이그레이션·기능 구현 없음. PR #52와 무관 — 별도
브랜치·별도 PR.**

**저장소 진실 재확인 (문서를 쓰기 전):** 당시 `origin/master` HEAD `a92339e`.
이후 PR #52가 `58efb7d`로 머지되었고, 현재 #53이 이 핸드오프 PR이다.
당시 열린 PR 9개 중 #52(P4 채팅 계약, OPEN/MERGEABLE/CI 14/14)는 활성
작업이고, #2–#9는 `kiro/*`·`codex/*` 브랜치가 서로를 베이스로 하는 오래된
체인으로 이번 작업에서 내용을 검증하지 않아 핸드오프 문서에 레거시로
표시했다. 마이그레이션 원장을 다시 읽다가 **035·036이 저장소에 존재하고
`ENGINEERING_ROADMAP.md`가 마이그레이션 체인에 명시적으로 포함시키는데도
`supabase/migrations/README.md`의 파일 목록 표에 행이 없는 문서 갭**을
발견해 두 행을 추가했다(내용 파악 후 "신규 / 어디에도 미적용"으로 표기 —
운영 상태를 새로 조사하지 않았고 조사할 수도 없는 문서 정리 작업이므로
추정하지 않았다).

| 파일 | 변경 |
|---|---|
| `docs/PROJECT_HANDOFF_2026-08-13.md` | 신규. 다른 AI를 위한 지도: 문서 전체 인벤토리(카테고리·상태·언제 읽는가), 저장소 진실 스냅샷, 완료된 단계, 보안 모델 요약(링크만), 프로덕션 진실(Git ≠ 배포), 열린 블로커 인벤토리 |
| `docs/BUSINESS_MEMORY_ROADMAP_V1.md` | 신규. 장기 방향 — 아래 참고 |
| `docs/PRODUCT_V3.md` | §12.3만 수정. 오디오/영상을 "활성 로드맵 아님"에서 "P6 이후 유료 미디어 확장"으로 — 순서는 그대로, 방향 확신만 변경. 세부는 새 로드맵 문서로 링크 |
| `docs/ENGINEERING_ROADMAP.md` | "로드맵에 없는 것" 절의 오디오/영상 문구를 같은 취지로 수정 |
| `docs/CURRENT_STATE.md` | "수익화/구독: 코드 없음" 행에 새 로드맵 문서 링크 한 줄 추가 |
| `supabase/migrations/README.md` | 035·036 원장 표 누락 발견 → 행 추가 (위 참고) |

#### 신규 장기 비즈니스 방향 (전부 `BUSINESS_MEMORY_ROADMAP_V1.md`가 canonical)

포지셔닝이 "커플 앱"에서 "함께하지 못한 시간까지 안전하게 보관하고, 나중엔
손에 잡히는 기억으로 만들어주는 사적인 기억 보관소"로 확장된다. 4개 수익
축(커스터마이징 / 유료 미디어 저장 / Book Studio / 실물 메모리북),
Free·Plus·Archive 3단 구독(가격·용량은 전부 검증 전 가설), 관리형 클라우드
(Cloudflare R2 류) + 얇은 인가 게이트웨이 우선하고 자체 서버는 지금 사지
않는다는 인프라 방향, POD 외주 실물 책, "오늘의 책갈피"(AI가 아니라
사용자가 직접 무엇이 기억할 가치가 있는지 표시), Book Studio는 결정론적
Stage 1이 먼저이고 AI Stage 2는 실물책 수요 확인 후. **보안(E2EE)과 코어
루프는 어떤 경우에도 유료화하지 않는다는 원칙이 문서 전체를 관통한다.**
AI Book Studio·인쇄 각각에 대해 명시적 opt-in과 E2EE 경계로부터의 export
경고를 요구했다 — 관계 아카이브 전체를 조용히 외부 모델에 올리는 흐름은
금지.

**검증하지 않은 것:** 가격·용량·시간 한도(전부 명시적으로 가설), POD
벤더 견적, 클라우드 비용 실측치. 이번 작업에서 코드/가격 로직을 만들지
않았고 만들 수도 없다 — 순수 방향 문서다.

**프로덕션 mutation 없음.** 조회도 하지 않았다.

---

### 2026-08-13 · PR #52 (2차) — 보안 계약 결함 3건 정정

같은 PR·같은 브랜치에서 초판 계약의 보안 결함 세 가지를 정정했다. 셋 다 문구 문제가
아니라 **실제 모순**이었다. 문서만 변경, 소스·마이그레이션 없음.

| # | 결함 | 왜 실제 모순인가 | 결정 |
|---|---|---|---|
| A | "채팅에 write floor가 필요 없다" | 032의 write floor는 평문 강등 방어와 **R5 EPOCH**(032:163-182) 두 책임을 지는데 초판은 전자만 보고 판단했다. 채팅이 born-encrypted인 것은 후자와 무관하다 — 폐기·stale 기기가 옛 epoch로 계속 쓰는 것을 막지 못했다 | GLE1 헤더 **직접 검증**(Option A). 메타데이터 필드 증가 없음 |
| B | tombstone 표현 미정의 | 초판은 tombstone을 도입하고 그 상태가 어디 사는지, 누가 만들 수 있는지, 되돌릴 수 있는지를 전부 비워 뒀다. "전송 후 불변"과 tombstone UPDATE도 서로 모순인 채였다 | `ciphertext IS NULL`이 유일한 표현. **원작성자만**, **단방향** |
| C | `sender_user_id` CASCADE | `PRODUCT_V3.md` §14.4 "커플 소유/공유 객체는 남은 파트너가 있으면 유지된다"와 정면 충돌. 한쪽 탈퇴가 남은 파트너의 대화 절반을 파괴했다 | `ON DELETE SET NULL` |

**기각한 대안**

- **A / Option B(`key_epoch` 컬럼 복제):** 복제 컬럼은 헤더와 어긋날 수 있고 어긋나지
  않음을 증명하려면 결국 헤더를 읽어야 한다. "Option A + 중복 컬럼 + 정합성 검사"라
  엄격히 더 나쁘다. `daily_records`가 컬럼을 쓰는 것은 필드별 암호문이 여럿이고 평문
  행과 공존해야 하는 사정 때문이며 채팅에는 없는 사정이다.
- **B / `is_deleted`·`deleted_at` 추가:** 여섯 필드 예산을 늘리면서 얻는 것이 없다.
  `NULL`은 INSERT 검증 때문에 "malformed/pending"을 뜻할 수 없어 이미 모호하지 않다.
- **B / 수신자도 delete-for-both 허용:** 한쪽이 상대가 작성한 관계 히스토리를 일방적으로
  파괴할 수 있게 된다. 수신자의 실제 요구는 로컬 숨기기로 충족된다.
- **C / 작성자를 생존자로 이전:** 히스토리 위조다.

정직하게 남긴 한계: 서버는 암호문이 실제로 열리는지 확인할 수 없어, 커플 구성원은
복호화 불가능한 행을 밀어넣을 수 있다. 기밀성 우회가 아니라 신뢰 경계 안의 자해성
DoS이고 해법은 rate limit이다. 위협 모델에 19번으로 명시했다.

위협 모델 16 → **25가지**, 게이트 C1–C9 → **C1–C12**(C10 epoch / C11 tombstone /
C12 계정 삭제). 실제 DB 증명은 구현 시점의 몫이고 이 PR에서 구현하지 않았다.
**운영 변경 없음.**

---

### 2026-08-13 · PR #52 — 채팅 제품·데이터·E2EE 계약 (P4)

**목표:** 채팅을 만드는 것이 아니라, P5(daily_records E2EE)·P6(암호화 사진)이 채팅
구조를 재설계하지 않아도 되도록 그 전에 최소한의 올바른 계약을 고정하는 것.
**코드·스키마·마이그레이션 없음.**

| 파일 | 변경 |
|---|---|
| `docs/CHAT_PRODUCT_DATA_CONTRACT_V1.md` | 신규. 22개 절(§0–21), 약 630줄 |
| `docs/PRODUCT_V3.md` | §12.1이 계약을 가리키도록 한 줄 |
| `docs/ENGINEERING_ROADMAP.md` | P4 행에 산출물·게이트 C1–C9·P5 독립성 명시 |
| `docs/CURRENT_STATE.md` | 당시 채팅 상태 갱신, PR #50으로 해소된 행 삭제, #17 심각도 정정 |

#### 저장소 조사에서 나온 결정적 사실

채팅은 백지 상태다(테이블·라우트·UI·레거시 스키마 전부 없음). 그보다 중요한 발견은
**연결이 해제된 커플은 되살아날 수 없다**는 것이다. 초대 코드를 발행하는 세 경로가 모두
active 멤버십을 요구하고(`regenerate_invitation` 013:277-279, `create_invitation`
030:34, `create_couple_and_invitation`은 항상 새 couple_id 생성), 멤버십을 active로
되돌리는 유일한 방법이 초대 소비(001:357 / 002:18 / 006:111 / 015:219)이기 때문이다.
`disconnect_couple`은 양쪽을 모두 disconnected로 만든다.

→ **재연결은 항상 새 couple_id = 새 CSK 스코프**이며, 채팅이 관계 경계를 넘는 경로가
구조적으로 존재하지 않는다. 정책으로 고른 것이 아니라 코드가 이미 강제하는 사실이다.
초안에 "같은 커플이 재활성화되면 히스토리가 돌아온다"고 썼던 것은 **도달 불가능한
상태를 서술한 오류**였고 정정했다. `CURRENT_STATE` #17도 "누출 위험"이 아니라 "상태
일관성 문제"로 심각도를 낮췄다.

#### 핵심 결정

- **새 scope도 새 봉투 형식도 만들지 않는다.** 기존 CSK + GLE1을 쓰고, 채팅은 GLE1
  AAD가 이미 묶는 `object type` 하나를 추가할 뿐이다. A(공유 CSK) vs B(전용 스코프)를
  8개 기준으로 비교해 A를 선택했다 — 신뢰 경계가 동일해 **blast radius조차 줄지 않는데**
  프로토콜만 두 벌이 되기 때문.
- 서버가 보는 것은 6개 필드뿐: `message_id / couple_id / sender_user_id / ciphertext /
  ordinal / created_at`. `message_type`·`reply_to`·`context`·`nonce`·`crypto_version`·
  `sender_device_id`를 전부 암호문 또는 GLE1 헤더로 밀어냈고, 각 필드마다 "암호문으로
  옮길 수 있나 / 보존 정책"까지 표에 적었다.
- **write floor가 필요 없다**는 것을 명시. 032가 필요했던 이유는 daily_records에 평문
  컬럼이 이미 있었기 때문이고, 채팅은 태어날 때부터 암호화라 내려갈 곳이 없다.
- 수정은 V1 연기하되 **구조적 막다른 길이 아님**을 근거와 함께 기록. 미래 구현자에게
  "계약 개정 없이 ciphertext UPDATE를 추가하지 말 것"을 명문화했다.
- 순서는 서버 `ordinal`, 클라이언트 시계는 순서에 쓰지 않는다. 대기 메시지는 목록 맨
  아래에 두었다가 ordinal을 받으면 제자리로 — 시계를 믿고 잘못 확정하는 것보다 정직하다.

#### 삭제 설계를 뒤집은 것

초안은 하드 삭제였다(tombstone = "여기 메시지가 있었다"는 영구 메타데이터라고 판단).
두 가지가 그 판단을 뒤집었다:

1. **하드 삭제는 전파되지 않는다.** 이미 동기화해 간 상대는 삭제를 알 신호가 없어
   영원히 들고 있게 된다. 상대 화면에 반영되지 않는 삭제는 삭제가 아니다.
2. **published 테이블의 DELETE payload에는 RLS가 적용되지 않는다** —
   015가 `public.events`를 publication에서 뺀 바로 그 이유
   (`privacy-access-matrix.md` §F). 하드 삭제는 그 함정에 다시 들어간다.

그리고 privacy 비용은 작다: 서버는 그 행의 존재를 **이미** 알고 있었고, tombstone이 새로
알려주는 것은 "지워졌다"뿐이며 암호문은 실제로 사라진다. → tombstone으로 변경.

#### 검증

내부 §참조 전수 검사(22개 절, 미해결 0 — 초안에서 절 번호가 밀린 교차참조 약 20건을
찾아 수정), 로컬 md 링크 전수 확인, 계약의 사실 주장을 코드와 대조(GLE1 AAD·epoch
헬퍼·PRODUCT_V3 §20·오버헤드 108B·초대 3경로 line number·disconnect 양쪽 갱신·realtime
publication 목록), 위협 모델 16가지 통과, `git diff --check`. 코드 변경이 없어 전체
테스트는 돌리지 않았다.

---

### 2026-08-13 · PR #50 — 양방향 `이따 이야기하기` (P3) · 머지됨

**상태:** 머지됨 (`a92339e`). 커밋 `cbed079`(DB), `a626d2e`(제품). CI 14/14 통과.
마이그레이션 038은 **운영 미적용** — 배포 전 read-only 재확인 필요.
PRODUCT_V3 P3 완료. PR #49에서 "보안 마이그레이션이 필요하다"며 막아둔 항목이다.
파트너가 남의 기록에 쓰려면 `daily_records` 쓰기 권한을 넓혀야 하는데, 그 대신
메타데이터 전용 별도 테이블을 만들었다.

| 파일 | 변경 |
|---|---|
| `supabase/migrations/038_bilateral_talk_about_marks.sql` | 신규. `talk_about_marks` 테이블 + RLS 3개 + 컬럼 단위 INSERT grant |
| `supabase/migrations/README.md` | 038 ledger 행 추가 |
| `scripts/phase0/storage-authz-harness.mjs` | 실제 RLS actor 검증 28건 추가 |
| `src/lib/talkAbout.ts` | 신규. 데이터 레이어 |
| `src/lib/talkAboutList.ts` | 신규. 마크 × 기록 조인 (프라이버시 경계가 여기 있다) |
| `src/components/widgets/TalkAboutListWidget.tsx` | 신규. `오늘 이야기할 것` |
| `src/pages/RecordPage.tsx` | 기록 상세에 표시 버튼 |
| `src/lib/store.tsx`, `storeContext.ts`, `types/index.ts`, `widgets.tsx` | 상태·액션·위젯 등록 |
| 테스트 | `talkAboutList.test.ts`(13), `TalkAboutListWidget.test.tsx`(9), RecordPage +6 |

핵심 결정:
- 서버가 아는 것은 `record_id / couple_id / actor_user_id / created_at` **뿐**이다.
  본문·주제·요약을 담을 컬럼이 아예 없다.
- actor별 행(`UNIQUE (record_id, actor_user_id)`). 누가 표시했는지 남고, 내 표시를
  지워도 상대 것이 지워지지 않는다.
- 레거시 `daily_records.talk_about`은 **손대지 않았다**. 의미가 다르고, 마이그레이션은
  동의한 적 없는 사용자의 데이터를 만드는 일이 된다. PR 본문에 근거 기록.
- mutation 테스트 중 실제 결함 발견: active-membership 게이트가 `daily_records` RLS에
  가려 한 번도 검증되지 않고 있었다. 격리 assertion 추가로 해소.

---

### 2026-08-13 · PR #49 — 핵심 하루 루프 (P0-a → P2) · 머지됨

기록 → 상대방의 오늘 → 정확한 원본 → 대화의 앞 세 단계.

| 마일스톤 | 내용 |
|---|---|
| P0-a | 기록 탭에 제거 불가능한 작성 진입점(기존엔 지울 수 있는 홈 위젯 하나뿐이었다), 작성자 태그 입력 UI(읽는 화면만 5개 있고 쓰는 경로가 없었다), 기계 추론 감정의 기본값을 author-only로 전환 |
| P1 | 공유 기록 1건이어도 요약 생성, 키워드 기반 서사 창작 분기 제거, 침묵을 "평온함"으로 추론하던 문구 제거 |
| P2 | `?record=<id>` 내구성 있는 원본 주소 지정(기존엔 휘발성 스토어 상태라 새로고침·딥링크에서 소실) |

P3는 이 PR에서 보안 마이그레이션 필요를 이유로 의도적으로 미구현 후 문서화.

---

### 2026-08-13 · PR #48 — Phase 0 기준선 마이그레이션 정리 · 머지됨

028·029·030이 커밋되지 않은 채 작업 트리에만 있던 것을 추적 대상으로 편입하고,
증명을 붙였다. 검증 중 발견한 실제 결함 2건을 수정(028 trailing slash, 029 락 누락),
그리고 037을 새로 추가했다.

- `scripts/phase0/storage-authz-harness.mjs` 신규 — 실제 PostgreSQL 17 클러스터에
  001..038 전체를 적용하고 실제 RLS actor로 검증
- 037: 계정 삭제 시 disconnected/pending 파트너의 커플 키가 파괴되던 P1 수정

---

### 2026-08-13 · PR #47 — Product V3 canonical 문서 · 머지됨

하나의 혼재된 문서를 수명이 다른 셋으로 분리:
`PRODUCT_V3.md`(제품 의도, 안정) / `ENGINEERING_ROADMAP.md`(구현 순서) /
`CURRENT_STATE.md`(저장소 현실, 휘발성). 채팅·사진을 코어로 승격, 오디오·영상을
Premium Candidate로 강등, 기계 추론 감정 규칙 확정.

---

### 2026-08-15 · 문서 canonical MASTER PLAN 정렬

#### PLAN POSITION
- Phase: 문서·사업전략 canonical consolidation
- Workstream: Product / Business / Engineering governance
- Step: 최신 MASTER PLAN을 기존 authoritative home에 반영
- Previous Gate: 기존 Product·Engineering·Current State 분리 및 memory-business 방향 기록
- This Gate: Business canonical 완성, M-stage ↔ P-stage crosswalk, DIRECTION CHECK 거버넌스 정렬

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked / NOT APPLICABLE: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: `docs/WORK_LOG.md` — YES
- MASTER PLAN version / 기준일: 사용자 제공 최신 36-section MASTER PLAN / 2026-08-15
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Luna / High
- Role: Primary Documentation Strategy Implementer + Verifier
- PR: `docs/control-tower-governance` draft PR status to be live-checked
- Branch: `docs/control-tower-governance`
- Base SHA: `origin/master` merge-base to be live-recorded in final report
- Old HEAD: `d03f390918f8c890e0766221bb951a94c9125f25`
- New/Reviewed HEAD: working tree after this docs-only alignment; exact commit recorded after verification

#### CHANGED / REVIEWED
- file: `docs/PRODUCT_V3.md`
- function/component/migration: product definition, source-of-truth table, Daily Core heading
- what changed/reviewed: Added the exact approved product definition and linked business ownership without moving business detail into the product document.
- why: Make the latest product definition reconstructable by a new AI while preserving ONE FACT → ONE AUTHORITATIVE HOME.
- file: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- function/component/migration: entire canonical business roadmap
- what changed/reviewed: Added Primary Customer/acquisition, problem chain, market methodology, four fact states, Daily Core, AI/privacy/cloud strategy, Free Core, Memory Product, pricing hypotheses, POD economics, Plus, KPI, M1–M8, risks, expansion, Team, execution evidence, validation prohibition, and M8 GO/HOLD.
- why: Make the user-approved MASTER PLAN the complete business-strategy home and separate strategy from implementation/Production facts.
- file: `docs/ENGINEERING_ROADMAP.md`
- function/component/migration: M-stage ↔ P-stage crosswalk and later P7–P10 preservation
- what changed/reviewed: Added crosswalk boundaries, M5 Basic Memory Archive ≠ P9 Advanced Moment/Archive, and later engineering-stage table.
- why: Preserve technical dependency order without replacing it with the business M1–M8 sequence.
- file: `CLAUDE.md`
- function/component/migration: session recovery, canonical ownership, DIRECTION CHECK
- what changed/reviewed: Added conditional business-source read, business ownership, and mandatory direction checklist.
- why: Prevent future agents from inferring business strategy from stale conversation or source packets.
- file: `AGENTS.md`
- function/component/migration: documentation sources, orchestration, work ledger
- what changed/reviewed: Added Business canonical source, DIRECTION CHECK, abandoned-strategy guard, and ledger fields.
- why: Stop reintroduction of storage-first/subscription-first/AI-judgment strategy and require per-session traceability.
- file: `docs/PROJECT_HANDOFF_2026-08-13.md`
- function/component/migration: reading order and document classification
- what changed/reviewed: Added business canonical to recovery order and classified root submission packets as non-authoritative supporting/history material.
- why: Allow a new AI to navigate the latest plan without erasing historical source packets.
- file: `docs/CLAUDE_OPUS_5_CROSS_VALIDATION_PROMPT.md`
- function/component/migration: Opus cross-validation prompt preamble, source order, product value, monetization section
- what changed/reviewed: Repointed the prompt to canonical Product/Business/Engineering/Current-State sources and replaced storage-first subscription guidance with Free Core + Memory Product + optional Plus after validation.
- why: Prevent the AI audit prompt itself from reintroducing superseded business strategy.
- file: `docs/WORK_LOG.md`
- function/component/migration: standard template and this session entry
- what changed/reviewed: Added DIRECTION CHECK to the ledger template and recorded this session.
- why: Require exact direction and verification trace for future substantial work.

#### EXPLICITLY NOT CHANGED
- crypto semantics: not changed
- DB/migration semantics: not changed
- product semantics: only canonical wording/ownership alignment; no new product feature
- Production: no remote action, migration, deployment, or Supabase mutation

#### VERIFICATION
- command: `git diff --check`
- PASS / FAIL / UNVERIFIED: PASS
- what it actually proves: whitespace errors only; not product, security, or Production correctness
- command: repository search and section audit against user MASTER PLAN
- PASS / FAIL / UNVERIFIED: PASS for covered canonical sections; the older root submission packet is not the latest MASTER PLAN
- what it actually proves: required strategy homes and guardrails are present in the edited documents

#### REVIEW IMPACT
- NONE / DELTA / FULL: DELTA for documentation/governance only
- whether an earlier review is stale: application/security reviews are not changed; this docs branch requires an independent canonical-strategy review at its final reviewed SHA

#### BLOCKERS
- code: none for docs-only scope
- environment: higher-model Kiro/Claude Opus 5 canonical audit not run in this session
- external/manual: live PR/base/remote status and external submission evidence require separate verification

#### STOPPED AT
- exact completed boundary: repository documents aligned to the user-provided MASTER PLAN; no commit/push/PR mutation yet at ledger creation

#### REMAINING
- final diff and coverage verification
- independent Kiro/Claude Opus 5 canonical strategy audit
- commit/push and draft PR only after local verification and scope confirmation

#### NEXT ACTION
- next owner: Kiro / Claude Opus 5 independent canonical strategy auditor
- tool/model: Kiro / Claude Opus 5, high or max reasoning as available
- 기준 SHA: final docs-only alignment commit SHA
- exact next task: Audit all canonical documents against the latest MASTER PLAN; report omitted items, active strategy conflicts, stale source packets, and fact-state errors without editing the repository.

#### DO NOT ADVANCE UNTIL
- final diff contains only approved docs/governance paths
- `git diff --check` passes
- no application source/tests/migrations/crypto/native/Production files are changed
- independent canonical strategy audit is reviewed by the primary agent

#### PRODUCTION
- NOT APPLIED — no remote mutation, migration, deployment, or Supabase action performed

---

### 2026-08-15 · [Control Tower Governance / canonical correction] MASTER PLAN 감사 gap 반영

#### PLAN POSITION
- Phase: Control Tower Governance / documentation canonicalization
- Workstream: Product / Business / Engineering strategy maintenance
- Step: 독립 감사(@ `1944361`)가 지적한 canonical gap을 문서에 반영
- Previous Gate: independent read-only audit 완료, 판정 `REQUEST CANONICAL CORRECTIONS`
- This Gate: M3/M7 engineering owner 신설, 사업문서 보정, 과거 packet 무효화 표기 완료

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked / NOT APPLICABLE: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES (`origin/master` 코드/migration 재확인)
- Latest relevant Work Log checked: 직전 두 항목 — YES
- MASTER PLAN version / 기준일: 사용자 승인 MASTER PLAN / 2026-08-15
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A — 승인된 전략을 바꾸지 않고 실행 gap만 닫았다

#### OWNERSHIP
- Tool: Kiro
- Model: Opus 5 / MAX
- Role: Strategy Maintainer + Verifier (write-capable, bounded)
- PR: #61 (draft 유지)
- Branch: `docs/control-tower-governance`
- Base SHA: `83c9b82b4cb9a5f3978b192a16927f3c01dba213`
- Old HEAD: `194436174919213cd4c73090398dc2c5644791a7`
- New HEAD / Reviewed HEAD: 이 커밋 SHA (push 후 live 확인)

#### CHANGED
- file: `docs/ENGINEERING_ROADMAP.md`
- function/component/migration: §2.5 crosswalk M3/M7 행, 신설 `LV`·`P-MP` 단계
- what changed: M3에 `LV — Limited Validation Gate`(통제된 소규모 외부 검증 진입조건,
  Public Beta/Production과 명시적 분리), M7에 `P-MP — Memory Product MVP`(구성·선택·
  결정적 초안·편집·미리보기·주문·결제·POD handoff·계측 범위 한정)를 추가했다.
- why: M3는 실제 사용자를 요구하는데 Beta gate가 P10에 있어 순환이었고, M7이 요구하는
  판매 가능한 제품을 어떤 단계도 소유하지 않았다.
- file: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- function/component/migration: §9.2 구매자 경계, §9.4 기여이익, §11 M-stage 앵커, §13 리스크
- what changed: M1–M8을 8개 순차 실행구간으로 정의하고 달력 확정을 제출 시점으로 유보,
  기여이익 산식에 `플랫폼·판매채널 수수료(해당되는 경우)` 추가, 구매자·미리보기 노출·연결
  해제 후 접근을 결제 구현 전 선행 gate로 명시, `고객 문제강도·반복사용 미달`과 `실물 배송
  개인정보` 리스크 2건 추가, iOS 우선이 영구 결정이 아님을 명시, M1/M2가 사전 고객조사를
  금지하지 않음을 명시.
- why: 협약기간 현실성 판단, 저단가 디지털 상품의 기여이익 왜곡 방지, 음성 검증결과의
  실행 가능한 대응 확보.
- file: `docs/CHAT_PRODUCT_DATA_CONTRACT_V1.md`
- function/component/migration: §13 미디어 주석, §21 범위 밖 표
- what changed: 오디오·영상의 `Premium Candidate` 표현을 `코어 이후 미디어 확장(유료 게이트
  아님)`으로 교체하고, 지연 이유가 P6 기반·engineering priority·복구/프라이버시 검증임을
  명시했다. 채팅 crypto/데이터 계약은 건드리지 않았다.
- why: canonical 문서가 폐기된 유료 미디어 게이트 표현을 유지하고 있었고
  `PRODUCT_V3.md` §12.3이 더는 하지 않는 주장을 인용하고 있었다.
- file: `docs/CURRENT_STATE.md`
- function/component/migration: §3 default-branch product/security reality 표
- what changed: `briefings` 레거시 스키마와 연결 해제 시 `crypto_pairings` `UNLINKED`
  미전이 2건을 정확한 성격으로 복원했다. `briefings`는 `master` `src/**`에 read/write 경로가
  없으므로 동작하는 평문 요약 파이프라인이 아니라 스키마 정리 대상으로, pairing 문제는
  데이터 유출이 아니라 lifecycle/state 정합성 문제로 기술했다.
- why: 두 항목 모두 해소 증거가 없는데 문서에서 사라져 있었다.
- file: `docs/DATA_LEGAL_E2EE_ARCHITECTURE_DECISION_2026-08-11.md`
- function/component/migration: §E E2EE Scope — Memory Product 실물 제작·배송 경계 신설
- what changed: 사용자 선택 콘텐츠만 경계 이탈, 최소수집, 목적제한, 처리자 범위 한정,
  보관·삭제, 건강데이터 배제, 결제 전 고지를 PRODUCT PRIVACY DECISION으로 추가하고,
  법적 판단은 `LEGAL SPECIALIST FOLLOW-UP REQUIRED`로 남겼다.
- why: 실물 배송은 실명·주소·연락처와 외부 처리자를 도입하는 첫 흐름인데 경계가 없었다.
- file: `docs/PROJECT_HANDOFF_2026-08-13.md`
- function/component/migration: §2 authoritative home 표
- what changed: Book Studio 제품 방향을 `PRODUCT_V3.md` §12.5로, 가격·검증 가설을
  business 문서로 분리했다.
- why: 기존 포인터가 Book Studio를 business 문서로 보냈지만 그 문서에는 해당 서술이 없었다.
- file: `docs/PRODUCT_V3.md`
- function/component/migration: 문서 머리말 기준일
- what changed: 기준일 2026-08-14 → 2026-08-15. 제품 의미 변경 없음.
- why: 이 PR에서 실제로 수정된 canonical 문서의 기준일이 과거로 남아 있었다.

#### LOCAL-ONLY / UNTRACKED (PR에 포함되지 않음)
- `GOMSINLOG_BUSINESS_PLAN_MASTER_V2_FINAL.md`, `GOMSINLOG_PRODUCTION_BRIEF_V1_FINAL.md`
- 문서 최상단에 `SUPERSEDED / SUPPORTING SUBMISSION PACKET` 경고와 현재 사업전략/가격가설/
  폐기 전략을 추가했다. 원문은 삭제하지 않았다.
- 두 파일은 untracked 상태를 유지했고 `git add`하지 않았다. **LOCAL-ONLY / UNTRACKED /
  NOT INCLUDED IN PR.**

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음
- DB/migration semantics: 변경 없음 (`supabase/migrations/*.sql` 무수정)
- product semantics: 승인된 MASTER PLAN 방향 변경 없음. M2/채팅 순서 유지, 새 M0 신설 안 함
- Production: remote mutation·migration·배포·Supabase 조회 없음
- 그 외: `src/**`, `packages/**`, `e2e/**`, native, `AGENTS.md`, `CLAUDE.md` 무수정.
  security PR #54/#58/#59/#60 HEAD 무변경

#### VERIFICATION
- command: `git rev-parse HEAD` / `gh pr view 61`
- PASS / FAIL / UNVERIFIED: PASS — 편집 전 HEAD가 감사 대상 `1944361`과 일치
- what it actually proves: 시작 지점 동일성만 증명한다
- command: `git grep`으로 `briefings` / `disconnect_couple` / `UNLINKED`를 `origin/master`에서 재확인
- PASS: `briefings`는 `src/**` 참조 0건이고 DROP migration 없음. `disconnect_couple`은
  `couple_members`만 갱신하며 `crypto_pairings`를 전이하지 않음
- what it actually proves: 복원한 두 항목이 실제로 미해소임을 증명한다. remote 상태는 아니다
- command: `rg`로 `Premium Candidate` / `39,000` / `100GB` / `300GB` / `storage tier` 재검색
- PASS: canonical 문서에 active 잔존 없음. 남은 것은 `WORK_LOG`·`AGENTS.md` guard·
  superseded 문서·경고 배너가 붙은 untracked packet뿐
- what it actually proves: 문구 수준 잔존만 증명한다
- command: `git diff --check`
- PASS: whitespace 오류 없음
- command: 단계 보존 확인 (`P5.1`–`P5.5`, `P6A`–`P6D`, `P7`–`P10`, `LV`, `P-MP`, `M1`–`M8`)
- PASS: 삭제된 단계 없음
- UNVERIFIED: remote Supabase catalog, production migration state, native device gate,
  POD 법적 요건, 실제 협약기간 길이

#### REVIEW IMPACT
- NONE / DELTA / FULL: DELTA — documentation/strategy only
- whether an earlier review is stale: **YES.** `1944361`에 대한 이전 Opus 감사는 이 커밋으로
  HEAD가 바뀌었으므로 STALE이다. 새 HEAD 기준 delta 확인이 필요하다. security PR
  #54/#58/#59/#60 리뷰는 영향받지 않는다(HEAD 무변경)

#### BLOCKERS
- code: 없음 (문서 범위)
- environment: remote Supabase catalog, native Android/iOS device gate
- external/manual: POD 처리위탁·국외이전·보관기간은 법률 검토 필요. 협약기간 길이는
  사용자 확정 필요. untracked packet의 Git 추적 여부는 사용자 결정

#### STOPPED AT
- exact completed boundary: 감사가 지적한 tracked 문서 보정 완료, untracked packet에 경고
  배너 추가 완료, PR #61 draft 유지

#### REMAINING
- Control Tower의 최종 diff 확인
- 별도 Opus delta review 필요 여부 판단
- 협약기간 길이 확정 시 M1–M8 달력 매핑
- POD 법률 검토

#### NEXT ACTION
- next owner: ChatGPT Control Tower
- tool/model: 최종 diff 검토 후 필요 시 Opus delta review
- 기준 SHA: 이 커밋 SHA
- exact next task: 최종 diff를 독립 확인하고 별도 delta review 필요 여부를 결정한다

#### DO NOT ADVANCE UNTIL
- 최종 diff에 문서 경로만 포함되어 있음이 확인됨
- P5.2 native/device gate가 독립 검증되기 전 P6A를 시작하지 않음
- PR #57이 먼저 merge됨 (base chain)
- POD 실제 배송 전에 법률 검토가 완료됨

#### PRODUCTION
- NOT APPLIED — remote mutation·migration·배포·Supabase 조회 없음

---

### 2026-08-15 · [Control Tower Governance / canonical correction] Memory Product 검증 순서 확정

#### PLAN POSITION
- Phase: Control Tower Governance / documentation canonicalization
- Workstream: Business / Engineering strategy maintenance
- Step: 사용자 결정 6건 반영 (M7 검증 순서 명시 1건만 문서 변경)
- Previous Gate: 감사 gap 반영 완료 (`36d917c`)
- This Gate: M7 내부 `디지털 → POD` 검증 순서 확정

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES (변경 없음)
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES (변경 없음)
- Latest relevant Work Log checked: 직전 항목 — YES
- MASTER PLAN version / 기준일: 사용자 승인 MASTER PLAN / 2026-08-15
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A — 승인된 `Memory Product 우선` 전략 안에서 검증 순서만 구체화

#### OWNERSHIP
- Tool: Kiro
- Model: Opus 5 / MAX
- Role: Strategy Maintainer + Verifier (write-capable, bounded)
- PR: #61 (draft 유지)
- Branch: `docs/control-tower-governance`
- Base SHA: `83c9b82b4cb9a5f3978b192a16927f3c01dba213`
- Old HEAD: `36d917cc7dcaa6e7db6ee515fcfc5e08f3324a1c`
- New HEAD / Reviewed HEAD: 이 커밋 SHA (push 후 live 확인)

#### CHANGED
- file: `docs/BUSINESS_MEMORY_ROADMAP_V1.md`
- function/component/migration: §9.4 실물상품과 POD — `검증 순서 — 디지털 먼저, POD 다음` 신설
- what changed: 디지털 기억상품으로 지불의향·제작완료·실제결제를 먼저 검증한 뒤 POD 실물
  제작을 검증한다는 순서를 명시했다. 디지털 실제결제 확인 전 POD 업체 계약·최소 제작수량·
  선투자를 진행하지 않는다는 제약과, 실물 개시 전 §13 개인정보·법률 검토 선행을 함께 적었다.
- why: 디지털 경로는 배송·수령인 개인정보·외부 벤더 없이 수요를 확인할 수 있어, 벤더
  선투자 위험을 지불의향 확인 이후로 미룰 수 있다.
- file: `docs/ENGINEERING_ROADMAP.md`
- function/component/migration: `P-MP — Memory Product MVP` 범위·순서
- what changed: POD handoff 항목에 `디지털 실제결제 확인 이후` 조건을 붙이고, 순서 블록을
  `M7 디지털 검증 → M7 POD 실물 검증`으로 분리했다. P-MP 안에서 디지털 경로를 먼저 완성하고
  디지털 실제결제 확인 전 POD 벤더 연동·선투자를 하지 않는다는 제약을 추가했다.
- why: 사업문서의 검증 순서가 engineering 단계 범위와 어긋나지 않게 맞춘다.
- file: `docs/WORK_LOG.md`
- function/component/migration: 이 세션 항목
- what changed: 사용자 결정 6건과 그중 문서 변경 1건을 기록했다.
- why: 결정 근거와 미변경 이유를 추적 가능하게 남긴다.

#### 사용자 결정 기록 (문서 변경 없이 확정된 항목)
- 제출 패킷 2개: **untracked 유지**. `git add`하지 않는다
- 협약기간 길이: 확정 전까지 `8개 순차 실행구간` 표현 유지
- POD 법률 검토: 실제 실물 fulfillment 전 필수 gate로 유지
- M2 → M3 순서: 변경하지 않는다. 채팅을 M3 뒤로 미루지 않는다
- PR #61: draft 유지. #57 merge 후 master 기준 재검증하고 review 전환

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음
- DB/migration semantics: 변경 없음
- product semantics: 승인된 전략 변경 없음. M2/채팅 순서 유지, 새 M0 없음, 가격가설 불변
- Production: remote mutation·migration·배포·Supabase 조회 없음
- 그 외: `src/**`, `packages/**`, `e2e/**`, native, `AGENTS.md`, `CLAUDE.md`,
  `PRODUCT_V3.md`, `CURRENT_STATE.md` 무수정. security PR #54/#58/#59/#60 HEAD 무변경
- untracked 제출 패킷: 이 커밋에 포함하지 않았다

#### VERIFICATION
- command: `git rev-parse HEAD` 편집 전 확인
- PASS: `36d917c` — 직전 커밋과 일치
- what it actually proves: 시작 지점 동일성만 증명한다
- command: `git diff --check`
- PASS: whitespace 오류 없음
- command: `git diff --name-only` / staged 경로 확인
- PASS: 문서 3개만 변경. untracked 파일 미포함
- command: 단계 보존 확인 (`P5.1`–`P5.5`, `P6A`–`P6D`, `P7`–`P10`, `LV`, `P-MP`, `M1`–`M8`)
- PASS: 삭제된 단계 없음
- UNVERIFIED: remote Supabase catalog, production migration state, native device gate,
  POD 법적 요건, 실제 협약기간 길이, 디지털/POD 실제 수요

#### REVIEW IMPACT
- NONE / DELTA / FULL: DELTA — documentation/strategy only, class A
- whether an earlier review is stale: **YES.** `1944361` 감사와 `36d917c` 상태 모두 이
  커밋으로 대체된다. security PR 리뷰는 영향 없음(HEAD 무변경)

#### BLOCKERS
- code: 없음
- environment: remote Supabase catalog, native device gate
- external/manual: POD 법률 검토, 협약기간 길이 확정, PR #57 merge

#### STOPPED AT
- exact completed boundary: M7 검증 순서를 business/engineering 양쪽에 반영하고 push.
  PR #61 draft 유지

#### REMAINING
- PR #57 merge
- #61을 master 기준으로 재검증한 뒤 review 전환
- 협약기간 확정 시 M1–M8 달력 매핑
- 실물 fulfillment 전 POD 법률 검토

#### NEXT ACTION
- next owner: ChatGPT Control Tower
- tool/model: PR #57 merge 후 `#61` rebase/재검증 담당자
- 기준 SHA: 이 커밋 SHA
- exact next task: PR #57을 merge하고 `#61`을 master 기준으로 재검증한 뒤 review 상태로 전환

#### DO NOT ADVANCE UNTIL
- PR #57이 merge되고 `#61`이 master 기준으로 재검증됨
- P5.2 native/device gate 독립 검증 전 P6A 시작 금지
- 디지털 기억상품 실제결제 확인 전 POD 벤더 선투자 금지
- 실물 배송 개시 전 개인정보·법률 검토 완료

#### PRODUCTION
- NOT APPLIED — remote mutation·migration·배포·Supabase 조회 없음

---

### 2026-08-15 · [Control Tower / Conversation Bridge V1] canonical direction update

#### PLAN POSITION
- Phase: P4 / M2 direction update
- Workstream: Product + Engineering canonicalization
- Step: Conversation Bridge V1 CORE; 자체 Chat/Messenger DEFERRED
- Previous Gate: Control Tower explicit decision
- This Gate: canonical sources aligned; code implementation moves to a separate `origin/master` branch

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 2026-08-15 Memory Product validation entry — YES
- MASTER PLAN version / 기준일: Control Tower explicit decision / 2026-08-15
- Does this task conflict with canonical direction: YES — prior documents treated chat as V1 core
- If YES, what conflict: Control Tower explicitly supersedes that direction; this entry and canonical edits resolve it

#### OWNERSHIP
- Tool: Codex
- Model: Terra / High
- Role: Control Tower implementation owner
- PR: #61
- Branch: `docs/control-tower-governance`
- Base SHA: `fc35ad0019eed14d41bfbe8bb8a0ee1760c311a1`
- Old HEAD: `fc35ad0019eed14d41bfbe8bb8a0ee1760c311a1`
- New HEAD / Reviewed HEAD: this commit (live push verified after commit)

#### CHANGED / REVIEWED
- `docs/PRODUCT_V3.md`: Conversation Bridge core loop, talk-about lifecycle, V1 scope, deferred self-chat boundary
- `docs/BUSINESS_MEMORY_ROADMAP_V1.md`: M2, Free Core, and daily-flow wording
- `docs/ENGINEERING_ROADMAP.md`: P4 ownership; P5.3/P5.4 FROZEN / DEFERRED while preserving P5.5/P6 gates
- `docs/CURRENT_STATE.md`: PR #59/#60 and migration 041 recorded as active-draft assets, not V1 entry-path work
- `docs/WORK_LOG.md`: this direction decision and evidence index

#### EXPLICITLY NOT CHANGED
- crypto semantics: unchanged
- DB/migration semantics: unchanged; migration 041 remains an unapplied active-draft asset
- product semantics: Control Tower direction update only; no implementation claim
- Production: NOT APPLIED

#### VERIFICATION
- `git diff --check`: PASS — no whitespace errors
- live `gh pr view 61`: PASS — branch/head verified before writing
- `rg` canonical chat/core references: PASS — remaining references identify DEFERRED/frozen historical assets or future review
- remote Supabase catalog and production migration state: UNVERIFIED

#### REVIEW IMPACT
- DELTA — canonical product/roadmap/current-state direction changed; prior chat-product direction reviews do not authorize a V1 chat entry path

#### BLOCKERS
- code: none for the separate Conversation Bridge implementation branch
- environment: remote Supabase catalog remains UNVERIFIED
- external/manual: none

#### STOPPED AT
- exact completed boundary: canonical direction updated; no application or migration files changed on PR #61

#### REMAINING
- create separate `origin/master`-based code branch and implement Conversation Bridge V1

#### NEXT ACTION
- next owner: Codex implementation owner
- tool/model: Terra / High
- 기준 SHA: current `origin/master`
- exact next task: extend existing P3 talk-about metadata/list path without using P5.3/P5.4 chat branches

#### DO NOT ADVANCE UNTIL
- canonical commit is pushed to PR #61
- new code branch is created from live `origin/master`

#### PRODUCTION
- NOT APPLIED — no remote mutation, migration, or deployment

---

### 2026-08-15 · [Control Tower / Conversation Bridge V1] private-source privacy clarification

#### PLAN POSITION
- Phase: P4 / M2
- Workstream: Product privacy clarification
- Step: private-source transition exception for Conversation Bridge unavailable state
- Previous Gate: Conversation Bridge canonical direction update `def18da`
- This Gate: shared → private removes coordination metadata before the partner can see an unavailable item

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: preceding Conversation Bridge entry — YES
- Does this task conflict with canonical direction: NO — it resolves an ambiguity in favor of the existing private-record non-disclosure rule
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Terra / High
- Role: Control Tower implementation owner
- PR: #61
- Branch: `docs/control-tower-governance`
- Base SHA: `def18da6a5764268262d41dea71ef959470c7f2f`
- Old HEAD: `def18da6a5764268262d41dea71ef959470c7f2f`
- New HEAD / Reviewed HEAD: this commit

#### CHANGED / REVIEWED
- `docs/PRODUCT_V3.md`: a deleted/stale source remains generic unavailable; a shared → private transition removes the metadata so no private-record existence or mark state is disclosed
- `docs/WORK_LOG.md`: this privacy interpretation index

#### EXPLICITLY NOT CHANGED
- crypto semantics: unchanged
- DB/migration semantics: unchanged in this documentation commit
- product semantics: no self-chat or scope expansion
- Production: NOT APPLIED

#### VERIFICATION
- `git diff --check`: PASS
- remote Supabase catalog / production migration state: UNVERIFIED

#### REVIEW IMPACT
- DELTA — product privacy wording; aligned with private-record non-disclosure invariant

#### BLOCKERS
- code: implementation is on separate `codex/conversation-bridge-v1` branch
- environment: remote migration state UNVERIFIED
- external/manual: none

#### STOPPED AT
- exact completed boundary: canonical privacy wording clarified; no code or remote action on PR #61

#### REMAINING
- review and merge decisions remain separate

#### NEXT ACTION
- next owner: release owner
- tool/model: Terra / High
- 기준 SHA: current PR #61 head after commit
- exact next task: review the separate Conversation Bridge implementation branch

#### DO NOT ADVANCE UNTIL
- no Production migration without separate authorization

#### PRODUCTION
- NOT APPLIED

---

### 2026-08-15 · [Control Tower / Core Privacy Foundation V1] canonical integration-gate correction

#### PLAN POSITION
- Phase: P5.5
- Workstream: Core Privacy Foundation / P4 Conversation Bridge + P5.1 + P5.2
- Step: active integration base와 P6 entry gate 정정
- Previous Gate: Conversation Bridge CORE / chat FROZEN-DEFERRED decision
- This Gate: chat stack을 V1/P6 필수 선행 조건에서 분리하고, active migration ordering과 native gate를 명시

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 2026-08-15 Conversation Bridge direction entries — YES
- MASTER PLAN version / 기준일: Control Tower latest product decision / 2026-08-15
- Does this task conflict with canonical direction: NO
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Terra / High
- Role: Control Tower implementation owner
- PR: #61
- Branch: `docs/control-tower-governance`
- Base SHA: `006257ae6a737f9db1dae2a5ce5d3635a4783262`
- Old HEAD: `006257ae6a737f9db1dae2a5ce5d3635a4783262`
- New HEAD / Reviewed HEAD: this commit; related integration branch `codex/core-privacy-foundation-v1` at `35da04cf739649667c4d405a6c64c522d9e000e3`

#### CHANGED / REVIEWED
- `docs/ENGINEERING_ROADMAP.md`: P5.5를 P4 + P5.1 + P5.2 Core Privacy Foundation integration gate로 정확히 정정. frozen P5.3/P5.4를 삭제하거나 숨기지 않고 current V1/P6 dependency에서만 제외.
- `docs/CURRENT_STATE.md`: integration branch, 043/044 migration assets, runtime/local test 사실, master/production 미병합·미적용 상태를 분리해 기록.
- `docs/WORK_LOG.md`: 이 canonical correction의 source·gate·unverified evidence index.

#### EXPLICITLY NOT CHANGED
- crypto semantics: PMK/CSK/HRK 규칙과 P5 native gate 변경 없음
- DB/migration semantics: 이 docs commit은 migration을 적용하거나 SQL을 변경하지 않음
- product semantics: Conversation Bridge CORE / self-chat DEFERRED 결정을 재확인했을 뿐 새 제품 범위를 추가하지 않음
- Production: NOT APPLIED

#### VERIFICATION
- command: related integration branch `npm run test:p5`
- PASS: 93 assertions including authenticated unlink actor path and mutation proof; local temporary PostgreSQL only
- command: related integration branch targeted Vitest (`runtimeSession`, `runtime`, migration contracts)
- PASS: 115 tests; runtime session guard/verified install and migration latest-function contracts covered
- command: `git diff --check`
- PASS: whitespace 오류 없음
- UNVERIFIED: remote Supabase catalog, production migration history, browser/native E2E, physical iPhone/Android keystore behavior

#### REVIEW IMPACT
- DELTA — P5.5/P6 dependency wording changed. Earlier chat reviews remain valid only for their frozen draft heads and do not authorize a V1 chat path.

#### BLOCKERS
- code: merge/review of the Core Privacy Foundation integration branch
- environment: real-device native validation and remote staging/production catalog evidence
- external/manual: no Production migration without separate authorization

#### STOPPED AT
- exact completed boundary: canonical gate corrected; integration branch was pushed separately; no chat or P6 code integrated

#### REMAINING
- independent review of `35da04c`
- real iPhone/Android DeviceKeys/LCK validation
- staging migration/RLS rollout rehearsal for 039/040/043/044

#### NEXT ACTION
- next owner: security reviewer
- tool/model: Terra / High
- 기준 SHA: `35da04cf739649667c4d405a6c64c522d9e000e3`
- exact next task: review Core Privacy Foundation integration diff, especially session lifecycle and 044 unlink semantics

#### DO NOT ADVANCE UNTIL
- native device gate and staging actor/RLS rehearsal are evidenced
- P6 must not reuse frozen migration 042; any restart uses a reviewed 045+ forward migration

#### PRODUCTION
- NOT APPLIED — no remote mutation, migration, deployment, or Supabase catalog change

---

### 2026-08-17 · [Control Tower / PR #61] canonical governance convergence fix

#### PLAN POSITION
- Phase: Control Tower canonical convergence
- Workstream: PR #61 documentation/governance correction
- Step: R-1~R-5 correction before targeted canonical delta review
- Previous Gate: Opus final canonical review target `deec2acb53f5f09405422397729a5abf98d5a0e6` returned REQUEST CANONICAL CHANGES; Product/Business/Engineering consistency itself passed, while parallel canonical ownership with #62–#67 was the blocker
- This Gate: Option A — #61 canonical merge first, then #62–#67 alignment

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES; strategy unchanged
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — no business strategy change
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: prior PR #61 canonical integration-gate entry — YES
- Does this task conflict with canonical direction: NO
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Luna / High
- Role: PR #61 Canonical Governance Fix Worker
- PR: #61
- Branch: `docs/control-tower-governance`
- Base SHA: `42ac1f307f19e84e8a3891311aa2a3d19179eed1`
- Old HEAD: `deec2acb53f5f09405422397729a5abf98d5a0e6`
- New HEAD / Reviewed HEAD: this documentation commit; verify live after push

#### CHANGED / REVIEWED
- R-1: added one canonical write-owner lock to `AGENTS.md`
- R-2: recorded live #62–#67 draft stack and the Option A convergence order in `CURRENT_STATE.md`; added development-only, NOT APPLIED / remote UNVERIFIED status for migrations 045/046 while retaining 041/042 frozen/deferred reality
- R-3: made `CLAUDE.md`, `PRODUCT_V3.md`, and `CURRENT_STATE.md` the README entry path without rewriting historical/general orientation
- R-4: downgraded `docs/kiro/AI_HANDOFF.md` to structural-traps / historical implementation notes that must be verified against current code and canonical docs
- R-5: marked the two business/production packet files as local user-supplied, not present in the repository, and not canonical
- PR #62–#67 branches, commits, migrations, application code, security code, native code, and Production were not changed

#### LIVE STACK
- #61 `docs/control-tower-governance` @ `deec2acb53f5f09405422397729a5abf98d5a0e6`, base `master` @ `42ac1f3`
- #62 `codex/device-protection-recovery-v1` @ `c7f9d13b1f8ba10d8be6ee422ed163044a05201b`
- #63 `codex/notification-reentry-v1` @ `de4eaf63eaad1b2c58aca5e63714b149936c8317`
- #64 `codex/lv-core-ux-v1` @ `fa68c72a86610e095ff77e322b7703e049972743`
- #65 `codex/p6-readiness-audit-v1` @ `e97b95160cccf65fa9d4f0ae5d71a3695f38c8b5`
- #66 `codex/sol-integration-audit-v1` @ `d1bace6f53f1f071ce8ab2eb9a9fd0cb3efdcbb5`
- #67 `codex/opus-security-blockers-v1` @ `e96a5e68a1639f0eccd125e8986758d1c0246413`
- All #61–#67 are OPEN / DRAFT; #61 is not merged and the stack is not Production.

#### VERIFICATION
- command: full Vitest through the repository test runner
- PASS: 143 test files, 2,147 tests
- command: `git diff --check`
- PASS: no whitespace errors
- command: `scripts/agent/validate.sh docs`
- NOT RUN: script is absent from this HEAD (`No such file or directory`)
- checked: no `src/`, `supabase/migrations/`, or native paths changed by this diff
- checked: local submission packets were not staged
- remote Supabase catalog / Production migration state: UNVERIFIED; no remote mutation performed

#### REVIEW IMPACT
- Previous Opus canonical review at `deec2ac` is STALE after this commit.
- Required next review: targeted canonical delta review of R-1~R-5 only.

#### STOPPED AT
- exact completed boundary: documentation/governance fixes prepared; no merge, security-stack alignment, migration, native, or Production action

#### REMAINING
- commit and push the documentation-only delta to PR #61
- update PR #61 body with the stale-review and targeted-review handoff
- obtain targeted Opus canonical delta review
- keep #62–#67 untouched until after #61 canonical merge

#### NEXT ACTION
- next owner: Opus canonical reviewer
- exact next task: targeted review of R-1~R-5 against the effective PR #61 diff

#### DO NOT ADVANCE UNTIL
- targeted canonical delta review is complete
- do not merge #61 in this task; do not align #62–#67; do not start P6

#### PRODUCTION
- NOT APPLIED — no remote migration, deployment, or Supabase mutation

---

### 2026-08-15 · [P4 / M2] Conversation Bridge V1 implementation

#### PLAN POSITION
- Phase: P4 / M2
- Workstream: Conversation Bridge
- Step: P3 `talk_about_marks` extension — pending list, exact source, completion, unavailable source
- Previous Gate: Control Tower canonical update `def18da` on PR #61
- This Gate: local implementation and actor-RLS verification complete; remote migration remains unapplied

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES (Control Tower branch `def18da`)
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES (Control Tower branch `def18da`)
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES (Control Tower branch `def18da`)
- Current-state checked: `docs/CURRENT_STATE.md` — YES (Control Tower branch `def18da`)
- Latest relevant Work Log checked: Control Tower Conversation Bridge direction entry — YES
- MASTER PLAN version / 기준일: Control Tower explicit decision / 2026-08-15
- Does this task conflict with canonical direction: NO — implemented the explicitly approved Conversation Bridge V1; P5.3/P5.4 were not used
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Terra / High
- Role: implementation owner
- PR: not opened
- Branch: `codex/conversation-bridge-v1`
- Base SHA: `88cb7a9528e31692224d2c71c9fb35c09cef1482` (`origin/master`)
- Old HEAD: `88cb7a9528e31692224d2c71c9fb35c09cef1482`
- New HEAD / Reviewed HEAD: this commit (verified after commit)

#### CHANGED / REVIEWED
- `supabase/migrations/043_conversation_bridge_completion.sql`: adds monotonic `is_completed` coordination metadata, active-couple UPDATE RLS, retains only an opaque source id after record deletion, and removes marks atomically when a shared record becomes private
- `src/lib/talkAbout.ts`, `talkAboutList.ts`, `store.tsx`, `sync.ts`: pending-only hydration, realtime invalidation, account/workspace guards, exact-source unavailable handling
- `TalkAboutListWidget.tsx`: Home `오늘 이야기할 것 · N`, author/date/safe preview, explicit original view and completion action
- regression tests and local actor-RLS harness: updated for completion, unavailable sources, account-switch isolation, duplicate and authorization paths

#### EXPLICITLY NOT CHANGED
- crypto semantics: unchanged
- DB/migration semantics outside `talk_about_marks`: unchanged
- product semantics: no self-chat, external messenger SDK, share-sheet transfer, media, AI, archive, or redesign
- Production: NOT APPLIED

#### VERIFICATION
- targeted Vitest (`store`, `sync`, `talkAboutList`, widget, RecordPage): PASS — 106 tests
- `node scripts/phase0/storage-authz-harness.mjs`: PASS — 125 actor/RLS assertions on throwaway PostgreSQL
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- remote Supabase catalog / production migration state / physical device: UNVERIFIED

#### REVIEW IMPACT
- FULL — new RLS-enabled migration and authorization lifecycle path; independent review required for this HEAD

#### BLOCKERS
- code: none
- environment: remote migration state is UNVERIFIED
- external/manual: Production application is intentionally not authorized

#### STOPPED AT
- exact completed boundary: local code and migration are verified only; no remote mutation or deployment

#### REMAINING
- independent review result, intentional commit/push/PR handoff

#### NEXT ACTION
- next owner: reviewer, then release owner
- tool/model: Terra / High
- 기준 SHA: this branch HEAD after commit
- exact next task: review Conversation Bridge migration and lifecycle diff; apply no Production migration without separate approval

#### DO NOT ADVANCE UNTIL
- independent review has no unresolved security finding
- migration is separately rehearsed and authorized before any remote application

#### PRODUCTION
- NOT APPLIED

---

### 2026-08-14 · P5 PR #54 review follow-up — revision/CAS와 unavailable surface 정합화

독립 보안 리뷰의 B1/B2/H1/H2/M2/M3 지적을 실제 코드와 PostgreSQL harness에 대조해
수정했다. `saveRecordToDB()`는 이제 create/update intent를 명시적으로 받고, create는
`INSERT`, update는 소유자·커플 조건이 붙은 `UPDATE`를 사용한다. 암호화 행은
`INSERT=1`, `UPDATE=expectedRevision+1`을 GLE1과 DB CAS 양쪽에 전달하며,
`content_revision`을 PostgREST 응답에서 다시 읽어 store의 다음 attachment patch와
후속 편집에 반영한다. `mapRow()`는 legacy plaintext row의 실제 revision도 보존한다.

`상대방의 오늘`은 authorized-but-unreadable row를 빈 clickable row로 렌더링하지 않고
중립 unavailable 상태로 표시하며, emotion-flow briefing도 동일한 availability gate를
사용한다. GLK2 scope-key provisioning은 domain/epoch뿐 아니라 scope key id·owner·scope
까지 비교하도록 강화했다. 이는 새 암호를 추가한 것이 아니라 기존 signed GLK2 header와
verified certificate-chain 전제를 `RecordCryptoEnvironment` 계약에 명시한 것이다.

실제 PostgreSQL 17 harness에 legacy revision `2 → ciphertext 3`, encrypted
`1 → 2 → 3`, attachment/metadata patch, stale CAS, lost-response INSERT replay,
former-partner RLS mutation을 추가했다. H2는 runtime bootstrap이 아직
`setRecordCryptoEnvironment`/`setOutboxLocalCacheKey`를 호출하지 않는다는 사실을
`CURRENT_STATE.md`와 코드 주석에 명시했다. P5 migration은 계속 **신규 / 어디에도
미적용**이며 Production mutation은 없었다.

검증은 최종적으로 `npm run test:p5` 85 assertions PASS(14 mutation boundary 포함),
`npm run test:p0` 76 PASS, `npm run test:rollback` PASS, targeted E2EE flow 20 PASS,
`npm test` 149 files / 2243 tests PASS, typecheck PASS, lint PASS, placeholder build
PASS, `git diff --check` PASS였다. 첫 전체 suite 실행에서는 새 4번째 write-intent 인자를
반영하기 전 테스트 1건이 실패했고, exact GLK2 owner 보강 직후에는 partner-assist
flow 1건이 실패했으나 둘 다 원인 수정 후 새 프로세스로 재실행해 통과시켰다. 환경변수
없는 bare build는 의도대로 `VITE_SUPABASE_URL` 누락으로 중단됐고, 실제 비밀값이 아닌
CI placeholder로 재실행해 통과했다.

### 2026-08-14 · P5 — `daily_records` E2EE 수직 슬라이스

P4 완료 후 다음 단계인 P5를 구현했다. 시작 시점 `origin/master` HEAD `7c660e6`
(로컬 `6cc9f72`와 트리 동일 — `7c660e6`은 같은 내용의 머지 커밋).

**구현 전 조사에서 발견한 것 — 032가 남긴 진짜 공백.** 032는 암호화된 행의
`log_text`·`reaction`·`attachments`·`emotion_flow`·`record_time`을 전부 금지하는데,
**암호문을 담을 컬럼을 추가하지 않았다.** 즉 032만으로는 암호화된
`daily_records` 행을 쓸 수 없다 — R4를 지키는 클라이언트는 방금 암호화한 내용을
넣을 곳이 없다. P5의 중심은 write floor가 아니라 이 공백이었다.

**추가로 발견한 P0 결함 (이미 머지된 032).** `enforce_e2ee_write_floor()`에
`SECURITY DEFINER`가 없어서 호출자 권한으로 실행되고, 첫 문장이
`e2ee_floor_for()`를 호출하는데 그 함수는 `authenticated`에게서 EXECUTE가
회수되어 있다(032:71, 의도된 회수). 따라서 032를 적용하면 **모든 실제 사용자의
`daily_records` 쓰기가 평문까지 포함해 전부 `42501`로 실패한다.** 기존 P0
하네스가 `daily_records`에 한 번도 쓰지 않아 드러나지 않았다. 039가
`ALTER FUNCTION ... SECURITY DEFINER`로 고친다 — 본문을 다시 선언하면 032와
039에 규칙이 두 벌 생기므로 속성만 바꿨고, 그 사실을 테스트로 고정했다.

| 파일 | 변경 |
|---|---|
| `supabase/migrations/039_daily_records_content_envelope.sql` | 신규. `content_envelope BYTEA` + 헤더/라우팅 일치 검증 + 032 P0 수정 |
| `scripts/e2ee/p5-harness.mjs`, `scripts/e2ee/p5-baseline.sql` | 신규. 실제 PostgreSQL 17 · 실제 RLS 액터 · mutation testing |
| `src/crypto/recordContent.ts` (+ 테스트) | 신규. 기록 콘텐츠 문서 · PMK/CSK 라우팅 · GLE1 AAD |
| `src/app/records/contentCrypto.ts` (+ 테스트) | 신규. 유스케이스 — floor/epoch/domain 판단, 평문 fallback 없음 |
| `src/lib/outboxCrypto.ts` (+ 테스트) | 신규. 오프라인 큐 암호화 (LCK) |
| `src/lib/records.ts` | 읽기/쓰기 경로가 유스케이스를 통과 |
| `src/lib/outbox.ts`, `src/lib/store.tsx` | 큐에 암호문 저장, 전송 시점에 개봉 |
| `src/lib/e2eeLayering.test.ts` | Phase 1A 트립와이어를 P5 범위 불변식으로 전환 (cycle 경로는 그대로 동결) |

**검증.** `test:p5` PASS (74 assertions, mutation 13종), `test:p0` PASS (76),
`test:rollback` PASS, `npm run test` PASS (2221), typecheck·lint·build PASS.

**하지 않은 것.** 프로덕션 조회·적용 없음. 039는 어디에도 적용되지 않았다.
실제 두 계정 기기 간 E2E, 키 프로비저닝 UI, 레거시 행 일괄 마이그레이션 실행,
채팅·미디어·주기는 범위 밖이다.

### 2026-08-14 · P5 master 정합화 및 재검증

최신 `origin/master` `88cb7a9`를 P5 브랜치에 병합했다. 실제 충돌은
`docs/WORK_LOG.md` 하나였고 `docs/work-log only`로 분류했다. 최신 master의
PRODUCT_V3·PROJECT_HANDOFF·문서 정규화 내용을 우선 보존하면서 P5 구현 기록을 유지했다.
코드·migration·E2EE 의미 충돌은 없었다.

재검증 결과: `npm run test:p5` 74 assertions PASS(13 mutation), `npm run test:p0`
76 assertions PASS, `npm run test:rollback` PASS, `npm test` 148 files / 2235 tests PASS,
typecheck PASS, lint PASS, build PASS. 최초 전체 테스트는 불완전한 `node_modules`로 iOS
privacy manifest 2건이 실패했으나 `npm ci` 후 재실행해 통과했다. build는 실제 비밀값 없이
형식 검증용 Supabase placeholder를 프로세스 환경에만 주입했다. Production Supabase
migration/deploy는 실행하지 않았다.

---

### 2026-08-16 · Device Protection & Recovery UX V1 — local implementation

`35da04c` Core Privacy Foundation integration을 기준으로 `daily_records` P5 actor/RLS
harness를 다시 실행했고, 93 assertions가 통과했다. Production·remote Supabase에는
조회나 변경을 하지 않았다.

- Settings는 runtime과 같은 protected-local-state namespace를 읽고, verified runtime/LCK
  기준의 `보호됨 / 설정 필요 / 복구 필요 / 보안 저장소 사용 불가 / 일시 확인 불가`를
  표시한다. 상태를 알 수 없을 때 보호됨으로 표시하지 않는다.
- 최초 native 설정은 recovery code와 기존 canonical recovery anchor artifact를 명시적으로
  저장·재입력한 뒤에만 완료한다. 자동 clipboard 복사는 하지 않는다. ceremony는 명시적
  `VITE_E2EE_DEVICE_PROTECTION_ENABLED=true` build flag가 있어야 시작한다.
- 실제 결함을 수정했다: Settings가 runtime과 다른 namespace를 읽어 bootstrap을 놓치던
  문제와, `recoverWithKit`가 server ACTIVE device를 만든 뒤 local runtime-discovery state를
  저장하지 않던 문제. recovery artifact는 새 crypto format이 아니라 기존 canonical anchor
  bytes의 display/transport form이다.
- 검증: targeted Vitest 42 tests PASS, `npm run test:p5` 93 assertions PASS,
  `npm run typecheck` PASS. Native device/restart/logout/recovery drill, remote catalog,
  migration deployment은 UNVERIFIED / NOT APPLIED.

---

### 2026-08-16 · PR #67 — independent security delta fix (Codex / Luna / High)

이 기록은 PR #67의 독립 보안 delta 작업 이력이다. `d1bace6` 기반의 R1/R2/R3
검토에서, 연결된 커플이 write-floor 활성화 중에도 기존 floor=0 경로로 평문 기록을
시도할 수 있는 경로와, 활성화 결과·계정 전환·복구 상태를 함께 다뤄야 하는 공백을
확인했다.

원본 security code commit은 `08063a1d3e9e8650484149f5e8cde6fe045e1f8d`이고, 이후
문서-only handoff commit이 별도로 이어졌다.

- `coupleProtectionBarrier`를 계정·정확한 couple scope에만 묶어 연결 상태가 공개되기
  전부터 shared write를 fail closed로 만들고, 서버 floor가 실제 활성화된 뒤에만
  해제했다. runtime/session/store의 single-flight와 teardown도 같은 범위로 정합화했다.
- `KEY_MISSING`/`UNREADABLE` protected local state는 안전한 kit-verified 교체 프로토콜이
  정의되지 않았으므로 `SETUP_REQUIRED`나 대체 authority를 만들지 않고 보호 저장소
  사용 불가로 남겼다. 이 복구 범위는 PARTIAL이며 향후 Architect 결정이 필요하다.
- PMK/CSK/HRK, GLE1/GLK2, migration 031–046, 제품 방향, P6, Production은 이 delta에서
  바꾸지 않았다. 원격 Supabase와 Production은 NOT APPLIED다.
- 당시 기록된 검증은 targeted/full Vitest, write-floor/P0/Phase 0/P5/rollback/native,
  typecheck/lint/build/diff-check였으며, 실기기·원격 catalog·staging·Production은
  UNVERIFIED였다. 새 정렬 head에서는 독립 delta 재검토가 필요하다.

---

### 2026-08-18 · LV readiness core-flow audit — missed-day recovery closure

#### PLAN POSITION
- Phase: LV — Limited Validation Gate / M3 prerequisite
- Workstream: Core V1 product-flow verification
- Step: read-only audit, then minimal missed-context repair and regression coverage
- Previous Gate: P5.5 landing on master `7a83665299a1f0096f2f81da393f28a97142c9ba`
- This Gate: local core-flow verification complete; independent post-landing security audit remains external

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` — YES
- Business source checked: `docs/BUSINESS_MEMORY_ROADMAP_V1.md` — YES
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 2026-08-16 Limited Validation Ready Core UX entry — YES
- MASTER PLAN version / 기준일: PRODUCT V3 / 2026-08-15
- Does this task conflict with canonical direction: NO
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Codex
- Model: Terra / High requested; local execution model identity is not independently verified
- Role: implementation verifier + bounded product bug fixer
- PR: pending draft creation
- Branch: `codex/lv-readiness-audit-v1`
- Base SHA: `7a83665299a1f0096f2f81da393f28a97142c9ba`
- Old HEAD: `8dac249de023c1519494316ef06e944ccbc96aa2`
- New HEAD / Reviewed HEAD: this commit

#### CHANGED / REVIEWED
- `PartnerDayTimelineWidget`: replaces calendar-today-only filtering with a device-local last-checked lower bound (or an initial seven-day window), retains exact record routing, and records the checkpoint only after render.
- `CareHintWidget`: uses the same missed-context window as the partner-day surface.
- `store` / state types: carries the per-device checkpoint across local-state hydration without treating it as server truth.
- regression tests: cover initial and checkpoint-based recovery, post-render checkpointing, care-hint alignment, exact original, bilateral talk-about, completion, and private/unavailable source behavior.

#### EXPLICITLY NOT CHANGED
- crypto semantics: unchanged
- DB/migration semantics: unchanged
- product semantics: no chat, P6, media, navigation, or visual redesign
- Production: NOT APPLIED

#### VERIFICATION
- `npm run verify`: PASS — typecheck, lint, full Vitest, and production build completed locally.
- targeted account/couple/authoring tests: PASS — 129 tests.
- targeted privacy/original/talk-about/missed-context tests: PASS — 148 tests.
- `npm run test:e2e -- e2e/coupleMatrix.spec.ts`: UNVERIFIED — all 37 browser cases stopped before execution because the required Playwright Chromium headless-shell executable is absent locally.
- remote Supabase catalog, Production migration state, actual devices: UNVERIFIED; no remote query or mutation performed.

#### REVIEW IMPACT
- DELTA — client-only product-flow and local-state behavior; no authorization, RLS, crypto, schema, native, or migration delta.

#### BLOCKERS
- code: none after the missed-day recovery fix.
- environment: local Playwright browser binary is absent; real browser evidence is not refreshed at this HEAD.
- external/manual: post-landing independent security audit acceptance is outside this task.

#### STOPPED AT
- exact completed boundary: local audit and bounded client-only fix; draft PR pending normal push.

#### REMAINING
- Control Tower must accept the parallel post-landing security audit and obtain browser/controlled-pair evidence for this exact HEAD before treating LV as a launch decision.

#### NEXT ACTION
- next owner: Control Tower
- tool/model: independent security reviewer, then controlled-pair browser validator
- 기준 SHA: this commit
- exact next task: review this client-only delta alongside the accepted security audit, then run the controlled browser pair on an environment with Playwright Chromium.

#### DO NOT ADVANCE UNTIL
- no outstanding security-audit finding applies to the landed P5.5 baseline.
- browser and controlled-pair evidence are recorded for the reviewed HEAD.

#### PRODUCTION
- NOT APPLIED

### 2026-08-19 · LV — PR #70 missed-context repair + two-person launch pack

#### PLAN POSITION
- Phase: LV — Limited Validation Gate / M3 prerequisite
- Workstream: Core V1 product-flow correctness
- Step: repair the accepted review findings on #70, then traverse the LV loop as two people
- Previous Gate: #70 independent review verdict `CHANGES_REQUIRED`
- This Gate: #70 findings closed; #71 opened for the non-security flow defects found in traversal

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` §6.1–6.5, §7.1–7.5, §8 — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — client-only product-flow correctness; no customer, BM, pricing, AI-scope, storage or KPI impact
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` §0–1 — YES
- Latest relevant Work Log checked: 2026-08-18 LV readiness core-flow audit — YES
- MASTER PLAN version / 기준일: PRODUCT V3 / 2026-08-15
- Does this task conflict with canonical direction? NO
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Claude Code
- Model: Opus 5
- Role: implementation owner (NOT reviewer of its own work)
- PR: #70 (repair) and #71 (two-person launch pack, stacked on #70)
- Branch: `codex/lv-readiness-audit-v1`, then `claude/lv-two-person-launch-pack-v1`
- Base SHA: `7a83665299a1f0096f2f81da393f28a97142c9ba`
- Old HEAD: `b5663c7c8db409ed84b70542eda3b368b8b6799b` (the reviewed HEAD; unmoved by others)
- New/Reviewed HEAD: #70 `922938eff3e842bc343227b4abb176e57a277891` · #71 `0903e33c6adaaca3ff07161e66b6e36271ba3a52`

#### CHANGED / REVIEWED
- `src/lib/partnerDay.ts` (new): sole owner of §6.5's window sentence — checkpoint lower bound or 7-day fallback, upper bound today; localStorage receipt keyed `viewer:couple`; prefix-acknowledgement helper; date-label helper.
- `src/components/widgets/PartnerDayTimelineWidget.tsx`: mount-driven `useEffect` receipt removed; advancement now only via an explicit `여기까지 확인했어요` confirming the rendered chronological prefix; per-row date context; heading becomes `놓친 하루` when the window reaches back.
- `src/components/widgets/CareHintWidget.tsx`: same window source; copy no longer names a day it cannot vouch for.
- `src/lib/store.tsx`, `storeContext.ts`, `types/index.ts`, `utils.ts`: `partnerDayLastCheckedAt` and `markPartnerDayChecked` removed; device-preference carry-over set is now the exported `DEVICE_PREF_CARRY_OVER_KEYS`.
- `src/lib/accountDeletionRecovery.test.tsx`: guard now pins the declared carry-over constant, not only the persisted JSON keys.
- `src/lib/widgets.tsx`: partner-day catalogue description no longer claims today-only; literal backticks removed from a user-facing string.
- `src/components/widgets/TalkAboutListWidget.tsx` (#71): `외 N개` becomes the control that opens the remaining 이야기거리.
- `src/pages/recordAuthoringEntryPoint.test.tsx` (#71, new): §7.1 authoring contract for BOTH roles.

#### EXPLICITLY NOT CHANGED
- crypto semantics: none. No key hierarchy, device trust, recovery authority or write-floor path touched.
- DB/migration semantics: none. No SQL added or modified.
- product semantics: no surface renamed, no funnel added, no Home redesign, no chat, no P6.
- Production: untouched.

#### VERIFICATION
- command: `npm run verify` on both HEADs — PASS (EXIT=0). #70: 2353 tests / 159 files. #71: 2366 tests / 160 files. Typecheck, lint, both build directions included.
- command: `git diff --check` — PASS on both.
- command: mutation checks (applied, observed failing, reverted) — PASS. Restoring the mount effect fails 8 widget tests; dropping the `date <= today` bound fails 3; acknowledging the whole window instead of the visible prefix fails the anti-collapse regression; re-adding `partnerDayLastCheckedAt` to the carry-over set fails the repaired guard.
- command: GitHub Actions on #70 `922938e` — PASS, 14/14 checks, including `Real-browser creator/partner matrix` (run 32164413345, 3m54s). That job is the two-person browser evidence for this HEAD.
- command: `npx playwright test e2e/coupleMatrix.spec.ts` locally — **UNVERIFIED**. This sandbox cannot download Playwright Chromium (headless shell fetch blocked; the headed binary will not launch here). CI is the authority for browser evidence.
- what it actually proves: client-side product semantics and copy under jsdom, plus the real production bundle in CI's mocked-backend browser matrix. It proves nothing about RLS, remote Supabase, or physical devices.
- #71 GitHub Actions: **NONE, structurally.** Every workflow in `.github/workflows/` triggers on exactly one base branch (`master` for master-validation and native-release-validation; three `kiro/*` bases for the others). No workflow triggers on base `codex/lv-readiness-audit-v1`, so a PR stacked there receives zero Actions checks — only Vercel reported. The workflow headers cite `.kiro/steering/merge-policy.md` forbidding a widened trigger, so no workflow was edited. #71's only automated evidence is the local `npm run verify` above; retargeting it to `master` after #70 lands is what makes `master validation` fire.

#### REVIEW IMPACT
- FULL for #70: the implementation of every accepted finding changed, so the `b5663c7` review is stale.
- FULL for #71: never reviewed.

#### BLOCKERS
- code: none known.
- environment: Playwright Chromium unavailable locally (network-blocked). Not a code defect.
- external/manual: real-device and remote-Supabase evidence remain outside this session.

#### STOPPED AT
- exact completed boundary: #70 @ `922938e` pushed, 14/14 CI green. #71 @ `0903e33` pushed as a Draft based on #70's branch.

#### REMAINING
- not completed: independent review of both HEADs. Local browser traversal. Controlled real-couple validation.

#### NEXT ACTION
- next owner: a fresh independent Claude review session
- tool/model: Claude Code / Opus 5
- 기준 SHA: `922938eff3e842bc343227b4abb176e57a277891` then `0903e33c6adaaca3ff07161e66b6e36271ba3a52`
- exact next task: review #70's checkpoint semantics and scope, then #71's flow fixes. #70 lands before #71.

#### DO NOT ADVANCE UNTIL
- an independent review accepts #70's checkpoint semantics.
- #71 is retargeted to `master` after #70 lands, so `master validation` actually runs on it. No workflow trigger may be widened to cover the stacked base.

#### PRODUCTION
- NOT APPLIED


## 유지 규칙

- 세션이 끝나면 이 문서에 **한 항목**을 추가한다. 커밋 메시지를 여기 복사하지 않는다.
  링크와 요약이면 충분하다.
- 제품 방향이 바뀌면 `PRODUCT_V3.md`를 먼저 고치고, 여기에는 "고쳤다"만 남긴다.
- 운영 배포 상태를 여기에 쓰지 않는다. 마이그레이션 ledger가 유일한 출처다.
