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

## 유지 규칙

- 세션이 끝나면 이 문서에 **한 항목**을 추가한다. 커밋 메시지를 여기 복사하지 않는다.
  링크와 요약이면 충분하다.
- 제품 방향이 바뀌면 `PRODUCT_V3.md`를 먼저 고치고, 여기에는 "고쳤다"만 남긴다.
- 운영 배포 상태를 여기에 쓰지 않는다. 마이그레이션 ledger가 유일한 출처다.
