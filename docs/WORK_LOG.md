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

- **`68959db` → `2365d0b`로 전량 revert.** 홈에 대화형(인스타 채팅형) 표현을 추가했다가
  **실제로 렌더해 보고** 되돌렸다. 문제 둘 다 미관이 아니었다 — 요약 카드가 바로 아래
  말풍선을 그대로 반복했고(§6 위반), 기록 2건짜리 하루는 화면 위 1/3에 몰리고 아래가
  비었다. **하루에 기록 몇 건인 제품에, 화면이 빌 일 없는 앱의 문법을 가져온 것이
  전제부터 틀렸다.** 반복하지 말 것: 대화 문법은 밀린 backlog가 있어야 값을 한다.
  `homeStyle`·`ConversationHome`·설정 토글 제거, device-pref 허용목록과 간격 사다리도
  함께 원복(둘 다 이것 때문에만 바뀌었다).
- `44d410b` **개인 클라우드 검토 — Google 경로 포함**
  (`PERSONAL_CLOUD_EVALUATION_2026-08-20.md`, 제안서만). 두 가지를 분리했다:
  Google Drive `appDataFolder`(사용자 소유, iCloud 대응물) vs Google Cloud Storage
  (회사 소유 — §12가 완화하려는 비용 곡선이 이름만 바뀐다).
  **핵심 발견: 개인 클라우드는 어느 벤더에서도 공유를 나르지 못한다.** CloudKit엔
  `CKShare`가 있으나 Drive `appDataFolder`엔 사용자 간 공유가 없다. 따라서 ARCH-P6의
  `CKShare read-only partner`는 iPhone+Galaxy 커플에서 동작하지 않으며, 이는 Android
  출시 시점이 아니라 **혼합 커플 가입 첫날의 문제**다.
- `7a3d256` **온보딩 첫 화면.** 로그인 버튼이 준비된 것처럼 보이는데 동의 없이 누르면
  가장자리 토스트만 떴다 — 첫 실행에서 **앱이 고장난 걸로 읽힌다.** 동의를 버튼 위로
  올리고 미충족 시 `aria-disabled` + 이유를 실제 요소로 노출했다. `disabled`가 아닌
  이유: 진짜 disabled는 탭 순서에서 빠져 키보드·스크린리더 사용자에게 왜인지조차
  전달되지 않는다. hero는 카테고리가 아니라 문제를 말하고, 번호 3줄로 **상대가 필요하다는
  사실을 로그인 전에** 알린다(전에는 step 3에서야 알았다). 이메일 로그인 제거.
  **브라우저로 보고 2건을 더 고쳤다**: 보조 버튼이 화면에서 가장 무거워 위계가 뒤집혀
  있었고, `justify-between`이 짧아진 콘텐츠를 늘려 가운데를 비웠다(revert한 대화형 홈과
  같은 결함이 온보딩에도 있었다).

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

### 2026-08-21 · LV · migration 047 delta re-review — APPROVED WITH NOTES (독립 READ-ONLY)

> reviewer가 남긴 READY-TO-COPY 판정의 반영이다. 대상: `claude/047-cycle-pain-gated`
> HEAD **`d0e2c0a`** (= PR #76 head, live 확인). 판정은 이 커밋에만 결속된다.

- **평결: APPROVED WITH NOTES** — PR #74(`9b0d4b3`) 이후 PR #76의 master landing에 대해.
  운영 적용은 별도 후속 게이트이며 047은 여전히 어디에도 NOT APPLIED.
- **선행 finding 마감 전부 확인**: F1 CLOSED(`CYCLE_SUPPORT_KINDS` 정확히 5종,
  `feeling_unwell` 단일 추가, CHECK 일치, `pain_*`는 부정 픽스처·이력 주석에만 존재,
  `PRODUCT_V3` §21 무개정 판단에 동의 — §21 하위 절이 이 메커니즘을 그대로 서술한다,
  NEVER_SHARED 절대문 복원·사실 참) · F2 CLOSED(harness ORDER 포함) · F3 CLOSED
  (`비의료적` src 0건) · F4 CLOSED(원장 표 + 개정 이력).
- §21/§13 회귀 없음: 컴포저는 daily-log 데이터에 구조적으로 도달 불가, 모든 `setKind`는
  press에서만, preview=파트너 렌더 동일 map, 반려된 `pain_*` 문자열은 payload guard에서
  거부, kind별 알림·분석 문자열 0.
- in-place migration 정정의 정당성 확인: `9680a1b`를 포함한 branch는 이 PR의 branch뿐,
  master에 `047_*` 없음, 원장 기준 적용된 곳 없음.
- **reviewer가 직접 실행**: d0e2c0a export에서 phase0 harness — 실제 PostgreSQL 17.10,
  45 migration 적용, **125 assertions 전부 PASS**, exit 0 / targeted vitest 5파일
  **99/99 PASS** / 전체 정적 diff·grep·branch containment / PR #74·#76 live CI 확인.
- 실행하지 않음: 전체 Vitest·typecheck·lint·build 로컬 실행(PR #76 CI PASS 관찰만),
  원격 Supabase 조회.
- **NOTE 2건과 처분**: (N1·MEDIUM) PR #73 branch에 반려된
  `047_cycle_pain_care_signal.sql`이 잔존 — 이후 merge되면 master에 두 번째 `047_*`가
  생긴다 → **#73을 즉시 CLOSED 처리함**(branch는 역사 보존). (N2·LOW) harness
  머리말/배너의 "through 045" 문구가 047 체인과 불일치(선행 결함) → **#76 merge 후
  후속으로 수정**, 승인된 head를 stale하게 만들지 않는다.
- code/migration/production 변경: 없음 (READ-ONLY).

### 2026-08-21 · LV · 047 review 반영 — 어휘를 승인된 한 종류로 축소, 실제 DB 증거 확보

#### PLAN POSITION
- Phase: LV / Workstream: 배려 신호 (migration 047)
- Step: independent review `CHANGES_REQUIRED` 반영 → delta re-review 대기
- Previous Gate: 아래 항목의 review verdict (F1 HIGH · F2 MEDIUM)
- This Gate: delta re-review 통과 전 PR #76 merge 금지

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §21(불변 유지 확인), `V1_LAUNCH_DECISIONS` §5(feeling_unwell 한 종류) — YES
- Business source: NOT APPLICABLE / Engineering source: `AGENTS` §19, `docs/skills/migration-gate.md` §3 — YES
- Does this task conflict with canonical direction? NO — 충돌하던 것은 반려된 3단계 어휘였고, 이 작업이 canonical에 맞춘다. canonical 개정 불요(§21 그대로 참)

#### OWNERSHIP
- Tool: Claude Code / Model: Fable 5 / Role: Worker (review 반영; 재심사는 별도 independent delta reviewer)
- PR: #76 / Branch: `claude/047-cycle-pain-gated` / `9680a1b` → **`d0e2c0a`**

#### CHANGED / REVIEWED
- **F1(HIGH) 해소 — 어휘 축소.** `pain_mild/moderate/severe` 3단계 제거, `CYCLE_SUPPORT_KINDS`에 `feeling_unwell`("오늘은 몸이 힘들어요") 하나 추가(4→5). 별도 pain fieldset·`CYCLE_PAIN_SHARE_KINDS`·`CyclePainShareKind`·`CycleSignalKind`·predicate 2종 전부 삭제 — 배려 신호는 다시 한 개념이다. 전송 전 preview는 유지(별도 승인된 D4 수정). `cyclePartnerMessage`의 절대 문구("증상, 출혈량, 통증, 기분, 메모는 어떤 경우에도 보이지 않아요") 복원 — feeling_unwell은 기록값·등급이 없는 독립 opt-in이므로 이 문장은 참이다
- migration을 `047_care_signal_feeling_unwell.sql`로 개명·정정(5값 CHECK). **적용된 곳도 merge된 곳도 없는 파일이므로 in-place 정정이 정당한 유일한 시점**이며, DOWN은 해당 kind row 존재 시 거부 유지. 반려된 `pain_*` 문자열은 payload guard에서 unknown으로 거부됨을 negative test로 고정
- **F2(MEDIUM) 해소.** `scripts/phase0/storage-authz-harness.mjs` ORDER에 047 추가, **실제 PostgreSQL 17로 실행 — 001→047 fresh chain 적용 + 전 baseline contract PASS**
- F3: 컴포저의 "비의료적" 절대 수식어 제거 / F4: ledger 표 결합 + 초안→개정 이력 명기
- 테스트: `cyclePainShare.test.ts` 전면 재작성(등급 kind 영구 금지 — `/^pain_/`·`mild|moderate|severe` 매칭 kind는 실패), `featurePrivacy`·`CycleSupportSection`·`cyclePartnerMessage` guard를 5-kind 어휘로 갱신

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음 / RLS·GRANT·함수: 없음(047은 여전히 CHECK 어휘만)
- product semantics: preview·당일 만료·철회·기본 꺼짐 불변
- Production: 미접촉. 047은 여전히 어디에도 NOT APPLIED

#### VERIFICATION
- 실행함: `typecheck` PASS · `lint --max-warnings 0` PASS · **full Vitest 2636/2636 PASS** · `build` PASS · `node scripts/phase0/storage-authz-harness.mjs` PASS(실제 PostgreSQL 17, 001→047)
- 실행하지 않음: e2e(이 delta는 cycle 화면 한정, CI가 실행) · 원격 Supabase 조회 · 실기기

#### REVIEW IMPACT
- DELTA — 원 review가 "어휘 변경 시 DELTA로 충분"이라 명시. independent delta reviewer에게 `d0e2c0a` 재심사 요청함

#### BLOCKERS / STOPPED AT / NEXT ACTION
- external: delta re-review 판정 대기 → 통과 시 #74 merge 후 #76 merge 가능
- STOPPED AT: `d0e2c0a` pushed, PR #76 본문 갱신
- next owner: independent delta reviewer → 사용자(merge)

#### DO NOT ADVANCE UNTIL
- delta re-review 승인 전 #76 merge 금지 · #74보다 먼저 merge 금지

#### PRODUCTION
- NOT APPLIED

### 2026-08-21 · LV · migration 047 delta — independent READ-ONLY security review (원 3단계 어휘에 대한 판정)

> reviewer가 남긴 READY-TO-COPY 판정의 반영이다. 판정 대상은 **개정 전** tree
> `709a11b`(delta `aeccca2` = `9680a1b`)이며, 위 항목의 `d0e2c0a`가 이 판정의 시정이다.

- **VERDICT: CHANGES_REQUIRED.** 메커니즘(파생 금지·독립 opt-in·당일 만료·철회·RLS 상속)은 §21을 양방향으로 지키며 negative test로 고정되어 있다. 차단 사유는 어휘와 증거.
- F1(HIGH): 구현 어휘 `pain_mild/moderate/severe`(3단계)가 결정 기록과 다르다. `V1_LAUNCH_DECISIONS` §5는 `feeling_unwell` **한 종류**를 승인했고, `PRODUCT_V3` §21은 개정되지 않았다. 개인 HRK 어휘와 1:1 등급 대응이며 §20상 kind는 서버 가시 metadata다.
- F2(MEDIUM): 047이 어떤 harness 체인에도 없어 live PostgreSQL 증거 0 — migration-gate §3 위반.
- F3(LOW-MED): "비의료적 응원 신호만" 문구가 같은 화면의 통증 선택기와 모순. F4(LOW): ledger 표 분리. F5(INFO): CURRENT_STATE 미기재(→ #75 convergence checkpoint가 소유).
- 이상 없음 확인: RLS·GRANT·trigger 상속 안전(anon·전 파트너·NULL actor 거부는 014 정책 원문으로 확인), invalidation payload에 kind 없음, 알림 전용 문구 pre-commit 없음, `CyclePartnerProjection` 건강 필드 0, preview=파트너 렌더 동일 map, 기본 꺼짐·당일 만료·철회 보존, log→signal 다리 없음.
- 검증 실행함: tree `709a11b`를 scratchpad로 export 후 targeted vitest **102/102 PASS** + git 정적 검증 전체. 실행하지 않음: 전체 suite·e2e·모든 live PostgreSQL 검증·원격 catalog("RLS verified" 주장 없음).
- 판정은 tree `709a11b`에 결속되며 HEAD 변경 시 승계되지 않는다(AGENTS §19).

### 2026-08-21 · Phase 0 · 전략 승인 집행 — 두 계보 수렴과 canonical 개정 반영

같은 날 아래 전략 검토 항목의 승인("승인한다") 이후 이어진 집행 세션이다.

#### PLAN POSITION
- Phase: Phase 0 — 마감과 정합 (전략 문서 §8)
- Workstream: 두 계보 수렴 선결 + canonical 개정 + 047 분리
- Step: #74 CI 수리 → green → canon 반영 → 047 gated branch → #73 처분 준비
- Previous Gate: 전략 검토 승인 (사용자, 2026-08-21)
- This Gate: **#74 master merge는 사용자 실행 대기** — `.claude/hooks/block-dangerous-bash.sh`가 PR merge를 사용자에게 예약한다

#### DIRECTION CHECK
- Product/Business/Engineering/Current-state/Work Log: 같은 세션에서 전수 복구 완료 (아래 항목)
- Does this task conflict with canonical direction? NO — §11 충돌 항목은 사용자 승인으로 해소되었고, 이 세션이 canonical에 반영했다

#### OWNERSHIP
- Tool: Claude Code / Model: Fable 5 / Role: integrator + docs writer (047 내용은 리뷰하지 않음 — independent reviewer 별도)
- PR/Branch: #74 `release/v1-gate1-gate2` @ `9b0d4b3` (CI 수리) · `claude/canon-amendments-2026-08-21` (canonical 개정 + 전략 문서) · `claude/047-cycle-pain-gated` (047 분리)

#### CHANGED / REVIEWED
- `e2e/coupleMatrix.spec.ts`·`e2e/realUsability.spec.ts` — 한 이름 통일(`기록 남기기`) 이후 stale locator 2건 수정. `e2e/mediaGallery.spec.ts` 주석 정합. `docs/PHASE_NEXT_ARCHITECTURE_2026-08-20.md` box mockup trailing whitespace 제거 → **#74 CI 14/14 GREEN**
- canonical 3문서 개정 (승인분): `PRODUCT_V3` §5.2 역할별 홈·§6.1 역할 해석·§7.6 연결 전 기록 사후 공유·§8 통화 모드·§10 하루 격자·§14.3 알림 정책(행위만·하루 1회·단일 문구·토큰 무효화)·§14.5 E2EE 단계별 표현 계약 / `ENGINEERING_ROADMAP` ARCH-P6 개정(공유=중립 암호문 저장, 개인 클라우드=선택 보존 계층, Android deferred 폐기)·LV 진입 조건 2건(계측·표현 일치) / `BUSINESS` §9.2 전역 1순위 가설
- `CURRENT_STATE` 2026-08-21 convergence checkpoint 추가
- 047 delta를 `claude/047-cycle-pain-gated`로 분리 (내용 불변 이동)

#### EXPLICITLY NOT CHANGED
- crypto·DB·migration semantics: 없음. 047은 기존 commit의 branch 이동일 뿐 내용 불변
- product 코드: e2e 테스트 파일 외 0줄
- Production: 미접촉

#### VERIFICATION
- 실행함: 실패했던 e2e 3건을 로컬 실제 Chrome + production build로 PASS (creator/partner protection_required, primary-action sweep) / `typecheck`·`lint` PASS / doc-guard 62 tests PASS / `git diff --check` clean / #74 CI 재실행 **14/14 GREEN** @ `9b0d4b3`
- 실행하지 않음: full unit suite(이 docs branch에서는 CI가 실행) / remote Supabase / 실기기
- 047 independent security review: 이 세션이 별도 read-only reviewer로 실행 — 결과는 047 PR에 기록

#### BLOCKERS
- external/manual: ① #74 master merge (사용자) ② merge 후 canon PR·#73 닫기 ③ 047 review 승인

#### STOPPED AT
- #74 green·merge 대기. canon branch와 047 branch push + PR 생성까지

#### NEXT ACTION
- next owner: 사용자 — #74 merge → canon PR merge → #73 close. 이후 Worker가 Phase 0 UI 결함 목록(전략 문서 §8 Phase 0) 착수
- 기준 SHA: #74 `9b0d4b3`

#### DO NOT ADVANCE UNTIL
- #74가 master에 merge되기 전에 canon PR·047 PR을 merge하지 않는다
- 047은 independent security review 승인 전 merge 금지

#### PRODUCTION
- NOT APPLIED

### 2026-08-21 · Strategy · CPO 제품 전략 종합 검토 — 검증 부채 판정과 로드맵 재고정

#### PLAN POSITION
- Phase: LV 진입 전 전략 검토 (구현 없음)
- Workstream: 제품 전략·실행 로드맵 재설계 검토 (사용자 요청: 전 영역 first-principles 재검토)
- Step: canonical 전체 복구 → 저장소 구조·UI 감사(서브에이전트 2) → live GitHub 검증 → 결정 제안 문서
- Previous Gate: Gate 1·2 구현 완료(`d45c760`), 047 independent security review 대기
- This Gate: 없음 — 분석·제안만. canonical 개정은 사용자 승인 대기

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3.md` 전체 — YES
- Business source checked: `BUSINESS_MEMORY_ROADMAP_V1.md` 전체 — YES (BM·AI·저장·미디어·KPI 전 영역 검토이므로 필수)
- Engineering source checked: `ENGINEERING_ROADMAP.md`, `AGENTS.md` — YES
- Current-state checked: `CURRENT_STATE.md` + live git/GitHub (`master` `21e7dfb`, PR #59–#74, CI) — YES
- Latest relevant Work Log checked: 2026-08-20 전 세션 + 2026-08-20 결정 문서군 5종 — YES
- MASTER PLAN version / 기준일: PRODUCT V3 / 2026-08-15
- Does this task conflict with canonical direction? NO (분석 자체는 충돌 없음). 제안 중 canonical 개정이 필요한 항목은 문서 §11에 분리했고 승인 전 미적용
- If YES, what conflict: N/A

#### OWNERSHIP
- Tool: Claude Code / Model: Fable 5 / Role: CPO-level 전략 검토자 (docs-only writer)
- PR: #73 브랜치 위 docs-only commit / Branch: `claude/v1-launch-readiness`
- Base SHA: `d45c760` → New HEAD: 이 commit

#### CHANGED / REVIEWED
- new: `docs/PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` — 제품 코어·여정·IA·AI·프라이버시·리텐션·수익화·Phase 0–4 로드맵·아키텍처 리뷰·최종 결정 + canonical 개정 목록(§11)
- 코드 감사에서 확인한 문서-코드 격차: E2EE feature flag 기본 OFF(`VITE_E2EE_DEVICE_PROTECTION_ENABLED` 미설정) · 커플 키 페어링/2기기/복구의 UI 호출자 0(`useCases.ts` 도달 불가) · 컴포저에 평문 영상·음성 캡처 칩 활성(§12.3와 불일치) · §19 계측 0줄 · iOS `Pods/` 부재(이 트리에서 빌드된 적 없음) · Android `capacitor.plugins.json` stale
- live 발견: PR #74(`release/v1-gate1-gate2`, non-draft)는 이 브랜치 18 commit 중 047 commit 하나만 뺀 동일 내용 재작성 계보. 실패 check 3건(Boundary/diff · Real-browser matrix · Capacitor sync reproducibility)
- 핵심 결정(제안): LV를 유일 최상위 목표로 고정 / LV는 E2EE flag OFF + 사진만(영상·음성 칩 비활성) + 신규 Supabase 프로젝트 / 계측을 LV 선행 조건으로 / ARCH-P6를 "공유=플랫폼 중립 암호문 저장, 개인 클라우드=선택 보존 계층"으로 개정 채택 / #74를 landing 계보로 확정하고 #73은 047+문서로 축소

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음 / DB·migration semantics: 없음 (코드 0줄, SQL 0줄)
- product semantics: canonical 문서 미수정. 모든 개정은 §11 승인 대기
- Production: 미접촉. 원격 조회·변경 없음

#### VERIFICATION
- 실행함: `scripts/agent/live-state.sh`, `git`/`gh` live 조회(master tip·branch delta·PR #74 CI), 서브에이전트 감사 2건(src 구조 92k LOC 맵 / UI 스크린샷 112장 검토)
- 실행하지 않음: `npm run verify`/test 일체(docs-only 변경), remote Supabase catalog 조회, 실기기 검증
- what it actually proves: 저장소·GitHub의 현재 사실만. 운영·실기기 상태는 UNVERIFIED 유지

#### REVIEW IMPACT
- NONE — 코드 무변경. 기존 review 유효성에 영향 없음

#### BLOCKERS
- code: 없음 / environment: 없음
- external/manual: §11 canonical 개정에 대한 사용자 승인, 047 independent security review

#### STOPPED AT
- 전략 문서 + 이 원장 항목 commit까지. push는 하지 않았다

#### REMAINING
- §10 방향·§11 개정의 사용자 승인 → Phase 0 착수(PR #74 실패 check 3건 수리 → landing → #73 축소 → UI 결함 마감 목록)

#### NEXT ACTION
- next owner: 사용자(승인) → Worker(Phase 0)
- 기준 SHA: 이 commit
- exact next task: 문서 §10·§11 승인 여부 결정. 승인 시 Phase 0의 선결 항목(두 계보 수렴)부터

#### DO NOT ADVANCE UNTIL
- 047 review 전 #73 전체를 master로 merge하지 않는다(기존 규칙 유지)
- §11 항목은 canonical 개정 전에 구현하지 않는다

#### PRODUCTION
- NOT APPLIED

### 2026-08-20 · LV · 감정 provenance·추론 시점 + 세 갈래 작업 통합

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: 감정 파이프라인 정직성 + 온디바이스 추론 정책 + 병렬 세션 통합
- Step: 감사 → 결정기록 → 감정 구현 → 시각 재설계 통합 → 통증 배려신호 cherry-pick
- Previous Gate: `21e7dfb`
- This Gate: 없음 — LV 진입 조건이 아니다. 047은 **security review gate 대기 중**

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §6.2 결정성·LLM 금지, §13 감정·기계추론, §16 비목표, §19 행동감시 금지, §20 데이터 분류, §21 주기 공유
- Business source checked: `BUSINESS_MEMORY_ROADMAP_V1` §7 AI 역할·온디바이스, §8 개인 클라우드, §17 전략 가드 — AI 역할·저장 전략에 닿는 작업이므로 필수였다
- Engineering source checked: `ENGINEERING_ROADMAP` §2·§2.5(LV)·§3, `AGENTS.md` §1·§7·§13·§17
- Current-state checked: live git `21e7dfb`, `CONSOLIDATION_LEDGER`
- Latest relevant Work Log checked: 2026-08-19 LV PartnerDay clean replacement
- Does this task conflict with canonical direction? NO — 단, 요청 하나를 그대로 구현하지 않았다.
  사용자의 "통증은 명시적 선택 시 공유"는 §21의 "통증은 어떤 설정에서도 공유되지 않는다"와
  문자 그대로는 충돌한다. HRK projection 확장 대신 배려 신호로 구현해 §21을 건드리지 않고
  같은 의도를 달성했다. 근거는 `V1_LAUNCH_DECISIONS_2026-08-20.md` §5.

#### OWNERSHIP
- Tool: Claude Code / Model: claude-opus-5 / Role: Worker + integrator
- PR: 없음 / Branch: `claude/v1-launch-readiness`
- Base SHA: `21e7dfb146985547150736a7efe3d5d50b6306b2`
- New HEAD: `7a3d256` (`4d071ab` → `b9b7459` → `aeccca2` → `a35a23d` → `56fec01` →
  `68959db` → **`2365d0b` revert** → `44d410b` → `7a3d256`)

#### 시작 시 발견한 것 — 잘못된 계보에서 작업할 뻔했다
세션은 `codex/lv-readiness-audit-v1`(PR #70) worktree에서 시작했다. 그 계보는
2026-08-20 consolidation에서 **탈락한 쪽**이다 — `partnerDay.ts`의
`unavailable`/`corrupt` 출현이 1회(master는 35회)이고 master보다 21 commit 뒤처져
있었다. `CONSOLIDATION_LEDGER`로 확인한 뒤 master 기준으로 branch를 다시 만들었다.
**HEAD가 더 최신이라는 것은 그 계보가 옳다는 증거가 아니다.**

#### CHANGED / REVIEWED
- new: `docs/V1_LAUNCH_DECISIONS_2026-08-20.md` — 이번 작업의 결정 기록. 감사에서 확인한
  "이미 되어 있던 것 9개"와 "실제 결함 4개"를 분리하고, 추론 시점 6후보를 UX·배터리·
  발열·latency·privacy·정확도로 비교했다.
- new: `src/lib/onDeviceInference.ts` (+ test 13) — 추론 시점 정책, 기기 tier, 내용 해시 memo.
- new: `src/components/emotion/EmotionSuggestionReview.tsx` — 단정이 아니라 질문하는 표면.
- file: `src/lib/emotionCandidates.ts` — `candidatesToFlowItems`가 `source: 'user_confirmed'`를
  하드코딩하던 것을 실제 provenance로 교체. `confirmedIds` 누락 시 fail closed.
- file: `src/lib/useEmotionCandidates.ts` — `useEmotionCandidatesAtBoundary` 추가. 타이핑
  디바운스 기반 훅을 대체한다. 저장된 기록을 다시 여는 경로는 이미 확인된 항목을
  pre-answered로 seed해 교정 세션이 확정 감정을 제안으로 강등시키지 않게 했다.
- file: `src/lib/basicEmotions.ts` — `BASIC_EMOTION_EMOJI` 삭제. OS가 그리는 이모지는
  두 사람이 같은 감정을 볼 때 서로 다른 그림을 보게 만든다.
- file: `TodayLogWidget.tsx` / `EmotionChipEditor.tsx` / `PartnerEmotionWidgets.tsx` — 감정
  시각언어를 오리지널 캐릭터로 통일.
- **통합**: 같은 worktree에서 병렬로 진행된 시각 재설계 세션의 미커밋 작업(33 파일)을
  검증하고 `4d071ab`로 커밋했다. 그 세션은 내 미커밋 변경이 만든 실제 결함
  (`onBlur` settle → review 렌더 → 저장 버튼이 손가락 밑에서 밀림 → 첫 탭 무시)을
  추적해 고쳤다. 두 작업의 파일이 겹쳐 완전한 분리는 불가능했고, 분리 기준은
  "무엇을 바꿨는가"로 정했다.
- **cherry-pick**: `security-review/cycle-pain-care-signal`의 `a59da87` → `aeccca2`.
  그 branch는 master보다 10 commit 뒤처진 `d1d3c1a` 위의 단일 commit이라 **merge하면
  master의 최신 작업이 되돌아간다.** cherry-pick이 맞는 연산이었다. import 충돌 1건
  (`Card` vs 통증 타입) 수동 해결.

#### 이어서 — 통합 이후 추가 작업 (`a35a23d`, `56fec01`)
- `a35a23d` **어디서든 한 탭 작성.** 컴포저는 `/record`의 floating CTA와 홈 위젯(삭제
  가능)에만 있었다. 일정·우리·마이에서, 그리고 위젯을 지운 홈에서 기록은 이동부터
  시작했다. §7.1이 요구하는 30초 중 3초가 이동이었다. **6번째 탭이 아니다** — §5가 5탭을
  고정하므로 장소가 아니라 행동으로서 바 위에 뜬다.
  - `ownsPrimaryAction`을 prefix 목록이 아니라 predicate로 쓴 이유는 여행 화면이
    갈라지기 때문이다. `/trips/:id`는 자기 CTA 쌍을 고정하고 `/trips`는 아무것도 고정하지
    않는다. prefix가 목록까지 삼켜서, **여행을 되돌아보며 기억이 떠오르기 가장 쉬운
    화면이 그것을 남길 방법이 없는 유일한 화면**이 됐었다. 반대를 가정한 테스트가 실패해서 잡았다.
  - 목적지는 router state가 아니라 `?compose=1`이다. §7.5가 기록에 요구하는 것과 같은
    이유 — 새로고침·딥링크·알림이 도달할 수 있어야 한다. 닫으면 flag를 제거한다.
  - **한 동작에 이름 하나.** CTA는 `지금의 마음 남기기`, 새 버튼은 `기록 남기기`였다.
    한 화면에서 배운 컨트롤을 다음 화면에서 못 알아보게 만든다. 감정이 저장 이후 별도로
    묻는 질문이 된 지금 `마음`은 기록의 정의와도 어긋난다. 셋 다 `기록 남기기`로 통일하고
    guard test로 고정했다.
- `56fec01` **기록 상세에서 감정을 다시 묻는다.** 컴포저는 composition boundary에서 한 번
  묻는다. 쓰고 바로 저장하는 사람은 답하지 않고, 미확인 읽기는 저장되지 않으므로,
  그 경로는 감정 없이 끝나고 추가할 곳도 없었다 — **내가 만든 회귀이며 이전보다 나빴다.**
  `onDeviceInference.ts`가 선언만 해두고 아무도 쓰지 않던 `record-opened` boundary를
  `RecordPage`가 소유한다. 읽기는 **caller가 계산해 prop으로 전달**하므로
  `RecordMoodSection`의 기존 import guard("스스로 감정을 만들 수 없다")가 그대로 유지된다.
  확인은 공유가 아니다 — `author_only`로 쓴다.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음. 키 계층·device trust·recovery·write floor 미접촉.
- DB/migration semantics: `047`이 저장소에 들어왔으나 **어디에도 적용하지 않았다.**
  원격 Supabase 호출 없음. `cycle_support_signals.kind` CHECK 어휘 확장 하나이며
  컬럼·정책·함수·GRANT 추가 없음.
- product semantics: 5탭·`확인했어요`/`이야기했어요` 의미·PartnerDay state·원본 이동 계약 불변.
- privacy semantics: **강화 방향으로만** 바뀌었다. 미확인 기계 추론은 이제 저장되지도
  공유되지도 않는다. `visibleRecordsForViewer`·`emotionFlowForStorage`의 계약 자체는 그대로다.
- Production: 미접촉.

#### VERIFICATION
- 실행함: `npm run typecheck` PASS / `npm run lint` PASS (`--max-warnings 0`) /
  `npm test` **PASS — 172 files, 2618 tests** / `npm run build` PASS.
- **실제 브라우저 검증 실행함** (온보딩 첫 화면 320/390). `playwright install`은 이
  환경에서 실패하지만 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 로컬 Chrome을 쓰면 돈다.
  **이 확인으로 결함 2건을 잡았다** — 추론만으로는 나오지 않았을 것들이다(아래).
- 증가분: 2544(기준선) → 2576(시각 재설계) → 2594(감정 + 통증) → 2605(한 탭 작성)
  → 2610(다시 묻기) → 2618(온보딩 게이트). **회귀 0건.**
- 실행하지 않음: `npm run test:e2e` — 이 세션에서 직접 돌리지 않았다. 시각 재설계 세션이
  로컬 Chrome으로 85 passed / 0 failed를 보고했으나 그것은 `aeccca2` 이전 트리에 대한
  결과이며, cherry-pick 이후로는 **UNVERIFIED**다.
- 실행하지 않음: `check:edge`/`test:edge` — deno 없음. edge function 미접촉.
- 실행하지 않음: 실기기 검증, 원격 Supabase catalog 조회.

#### REVIEW IMPACT
- **FULL — `047`에 대해.** migration + 파트너 가시 어휘 확장이므로 `AGENTS.md` §19의
  분류 C에 해당한다. 원 commit이 스스로 independent security review를 요구했고 그 요구는
  cherry-pick으로 사라지지 않는다.
- 감정·시각 변경은 DELTA. 프라이버시 경계를 넓히지 않고 좁혔다.

#### BLOCKERS
- code: 없음.
- environment: playwright 브라우저 설치가 이 환경에서 실패한다(stale `__dirlock`).
- external/manual: `047`의 independent security review.

#### STOPPED AT
- `claude/v1-launch-readiness` `7a3d256`. 전체 검증 green (2618 tests).

#### REMAINING
- 요청 7항목 전부 착수. 아래는 남는다.
- **`047` independent security review** — 미수행. 이 branch의 master merge 선행 조건.
- **실기기 검증**(실제 iPhone/Android 단말) — 미수행. 브라우저 확인은 대체가 아니다.
- **ARCH-P6 개정** — `CKShare` 공유가 혼합 커플에서 불가하다는 발견의 로드맵 반영은
  P6 gate 소관이며 이번 세션이 하지 않았다.
- 홈이 여전히 위젯 대시보드다. §6은 홈을 "상대방의 오늘" 한 표면으로 정의하고
  "무관한 카드의 대시보드로 만들지 않는다"고 명시하므로, 이것은 스타일 문제가 아니라
  canonical과의 불일치다. 위젯 시스템 제거는 기능 제거라 별도 제품 판단이 필요하다.
  **대화형이 답이 아니라는 것은 이번에 확인했다**(위 revert).
- 기록 상세에 감정 편집기가 둘(`RecordMoodSection` 캐릭터 + `RecordEmotionCorrection`
  chip) 공존한다. 후자의 정당화는 "근거 문구를 보여준다"인데 근거 문구는 저장되지
  않으므로 이미 사실이 아니다. 통합 후보.

#### NEXT ACTION
- next owner: independent security reviewer (047), 그다음 Worker
- 기준 SHA: `7a3d256`
- exact next task: `047` security review → 통과 시에만 master 경로 검토.

#### DO NOT ADVANCE UNTIL
- **이 branch는 `047` review 이전에 master로 merge하지 않는다.** review 대기 작업이
  올라타 있어 merge하면 gate를 우회하게 된다.

#### PRODUCTION
- NOT APPLIED. 원격 mutation 없음.

### 2026-08-20 · LV · Instagram 문법의 시각 재설계 — Astryx 기반 + 미디어 우선

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: 시각 재설계 — 컴포넌트 기반 교체와 미디어 표현
- Step: Astryx foundation → 미디어 갤러리 → 사진 아카이브 → AppBar 전역화
- Previous Gate: `21e7dfb`
- This Gate: 없음 — LV 진입 조건이 아니다

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §5 5탭 불변, §12.2 사진은 V1 코어, §16 비목표
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — BM·가격·저장 미접촉
- Engineering source checked: `AGENTS.md`, `ENGINEERING_ROADMAP` §LV
- Current-state checked: live git `21e7dfb`
- Latest relevant Work Log checked: 바로 아래 항목
- Does this task conflict with canonical direction? NO — 단, 경계를 하나 명시했다.
  Instagram에서 가져온 것은 **시각 문법뿐**이다. 좋아요·팔로워·공개 피드·알고리즘 정렬·
  연속 기록·무한 스크롤·광고는 §16 비목표이며 도입하지 않았다. 근거는 `DESIGN_V2` 2026-08-20 절.

#### OWNERSHIP
- Tool: Claude Code / Model: claude-opus-5[1m] / Role: Worker + self-verification
- PR: 없음 / Branch: `claude/v1-launch-readiness`
- Base SHA: `21e7dfb146985547150736a7efe3d5d50b6306b2`
- New HEAD: 커밋하지 않음 — working tree 변경으로 남겨 둔다(아래 STOPPED AT)

#### CHANGED / REVIEWED
- new: `src/styles/astryx-gomsin.css` — Astryx의 토큰을 이 앱의 OKLCH 토큰으로 가리키는
  단방향 매핑. 모든 값이 `var()`이라 dark 블록이 없다. `[data-astryx-theme='gomsin']`으로
  scope되며 Astryx 자체 theme 패키지와 같은 방식이다.
- file: `src/styles/index.css` — `@import "tailwindcss"`를 3분할하고 그 사이에
  `astryx-base` / `astryx-theme` layer를 끼웠다. `base` 뒤·`utilities` 앞이라는 위치가
  전부다. **`tailwind-theme.css`와 `reset.css`는 의도적으로 import하지 않았다** — 전자는
  `--color-card`/`--color-muted`/`--color-border`/`--color-primary`를 재선언해 앱 전체
  `bg-card`를 조용히 Astryx 회색으로 바꾸고, 후자는 두 번째 전역 Preflight다.
- new: `src/lib/astryxFoundation.test.ts` (12) — 위 두 negative import, layer 순서,
  "theme 파일에 색 리터럴 없음", 두 frame의 `data-astryx-theme` 존재를 고정.
- new: `src/components/media/RecordMediaGallery.tsx` — 미디어를 68px 열에서 본문 폭
  4:5로 옮긴다. 2장 이상은 Astryx `Carousel`(snap), 사진 탭은 `Lightbox`(zoom).
  영상은 인라인 재생, 음성은 carousel 밖. 확대 버튼은 미디어의 **형제**다 —
  `[data-testid="record-attachment"]`가 `<button>` 조상을 가지면 안 되기 때문.
- new: `src/components/media/MediaArchiveGrid.tsx` — 기간 전체 사진 3열 그리드.
- new: `src/components/ui/AppBar.tsx` + `AppBarAction` — 열두 화면이 각자 손으로 쓴 헤더를
  대체. 기록·마이·우리·일정·여행·복무·약관 7개 화면 적용.
- file: `src/pages/RecordPage.tsx` — 타임라인 행 재구성(미디어를 본문 아래 전체 폭으로),
  `타임라인 | 사진` 렌즈 토글(Astryx `SegmentedControl`), 상세 시트의 첨부를 갤러리 +
  소유자 전용 삭제 목록으로 분리. 삭제 버튼이 스와이프되는 갤러리 안에 있으면 안 된다.
- file: `src/components/widgets/PartnerDayTimelineWidget.tsx` — `상대방의 오늘`도 같은 갤러리.
- file: `src/pages/SettingsPage.tsx`, `src/pages/TripDetailPage.tsx` — AppBar 적용으로
  롤아웃 완료. 손으로 쓴 헤더가 있던 9개 화면 전부가 이제 같은 컴포넌트를 쓴다.
  `LegalPage`·`SettingsPage`의 `<div className="w-8" />` 중앙정렬 hack도 함께 사라졌다.
- file: `src/pages/RecordPage.tsx` — `사진` 렌즈는 **기간에 사진이 하나라도 있을 때만**
  나타난다. 갈 곳이 빈 화면뿐인 토글은 빈 화면이 가져야 할 단 하나의 다음 행동과
  경쟁한다(`FEATURE_SPEC` §11). 조건은 선택한 날이 아니라 기간 기준이다 — 사진이 있는
  달에서 사진 없는 날을 보고 있을 때가 바로 그리드가 필요한 순간이기 때문이다.
  함께 `showTimeline = lens === 'timeline' || !periodHasVisualMedia`로 바꿔
  **타임라인을 기본값이 아니라 fallback으로** 만들었다. `lens`는 state이고
  "이 기간에 사진이 있나"는 파생값이라 둘이 어긋날 수 있다 — 사진 렌즈에서 사진 없는 달로
  넘기면 되돌아갈 토글 자체가 사라지고, fallback이 없으면 두 뷰 모두 렌더되지 않는다.
  **mutation으로 검증했다**: `|| !periodHasVisualMedia`를 빼면 그 회귀 테스트가 실패한다.
- file: `src/lib/themeTokens.test.ts` — C6 hit-target guard에 `via` 개념 추가. 공유
  컴포넌트가 대신 선언하는 경우 그 컴포넌트를 검사하고, 화면이 실제로 그것을 import하는지도
  확인한다. ±400자 근접 스캔은 컴포넌트 추출에 반대할 근거가 없다. **mutation으로 검증했다** —
  `AppBar`의 44px을 줄이면 2건이 실패하고 되돌리면 통과한다.
- file: `src/components/widgets/TodayLogWidget.tsx` — `저장` 버튼에 `onMouseDown`
  preventDefault **한 줄**. 미커밋 감정 작업이 만든 "첫 탭이 먹히지 않는" 결함의 수정이며,
  커밋을 나눌 때 이 줄은 시각 재설계가 아니라 감정 작업 쪽에 속한다(아래 STOPPED AT).
- file: `e2e/emotionRedesign.spec.ts`, `e2e/completeness.spec.ts` — stale spec 재작성.
- file: `src/components/AttachmentMedia.tsx` — 주석만. 이 pass 이후 **production 경로에
  없다**는 사실을 파일에 남겼다(아래 REMAINING).
- new: `src/components/media/RecordMediaGallery.test.tsx` (14) — "player가 button 안에
  들어가지 않는다", "음성은 swipe 집합에 없다", 그리드의 정렬·비공개 표시·voice 제외.
- file: `src/test/setup.ts` — `ResizeObserver` no-op stub. **이것을 쓰다가 실제 결함을
  찾았다**: Astryx `Carousel`은 mount에서 `ResizeObserver`를 무조건 생성하는데 jsdom에는
  없어서, 사진 2장 이상인 기록은 render에서 `ResizeObserver is not defined`로 throw했다.
  기존 스위트에 그 경우를 렌더하는 테스트가 하나도 없어서 2556건이 전부 green인 채로
  multi-photo 경로가 통째로 테스트 불가능한 상태였다. 이 앱 자신의 코드는
  (`MobileShell`) `typeof ResizeObserver === 'undefined'`를 이미 방어하고 있었다.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음. key hierarchy·device trust·recovery·write floor 미접촉.
- DB/migration semantics: 없음. SQL 변경 없음.
- privacy semantics: 없음. `visibleRecordsForViewer` / `emotionFlowForStorage` /
  §13 감정 노출 규칙 미접촉. 갤러리·그리드 모두 caller가 이미 필터한 기록만 받는다.
- product semantics: 5탭·화면 이름·funnel·기능 추가 없음. 렌즈 토글은 같은 데이터의 두 번째
  시점이지 새 기능이 아니다. chat 없음. P6 없음.
- 감정 캐릭터: 미접촉. 여섯 SVG와 `--emotion-*` 토큰 그대로다.
- Production: 미접촉.

#### VERIFICATION
- 실행함: `npm run typecheck` PASS / `npm run lint` PASS (`--max-warnings 0`) /
  `npm test` **PASS — 169 files, 2576 tests** / `npm run build` PASS.
- 기준선 대조: 작업 시작 시 `21e7dfb`에서 167 files / 2544 tests PASS를 먼저 확보했다.
  증가분 32 = `astryxFoundation.test.ts` 12 + `RecordMediaGallery.test.tsx` 16 +
  `RecordPage.test.tsx`의 렌즈 4건.
  **기존 2544건 중 회귀 0건.**
- **실제 브라우저 검증 실행함.** `npx playwright install`은 이 환경에서 계속 실패하지만
  (stale `__dirlock`, 부분 추출), `playwright.config.ts`가 이미 제공하는
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 로컬 Chrome을 쓰면 전체 suite가 돈다.
  `npm run test:e2e` 상당: **78 passed / 5 failed**.
- **최종: 85 passed / 0 failed.** 아래 "제품 결함 1건"을 고친 뒤의 수치다.
- 처음에는 5건이 실패했고 **그것이 이 세션의 것이 아님을 먼저 증명했다**: `HEAD`(`21e7dfb`)
  worktree에 이 세션 이전부터 있던 감정 작업 파일 12개만 복사하고 돌리면 정확히 같은 5건이
  실패한다. 깨끗한 HEAD에서는 50/50 통과한다. 원인은 미커밋 감정 작업이었다.
  그 5건을 이 세션에서 끝까지 추적해 고쳤다(아래).
- guard mutation 1건 실제 수행(위 C6): `AppBar`의 44px을 줄이면 2건 실패, 되돌리면 통과.

#### 이 세션이 실제로 만든 회귀 1건 — 발견하고 고침
- `e2e/realUsability.spec.ts`(8개 route의 모든 조작 44px 실측)가 `/record :: 타임라인
  176x24`, `사진 176x24`로 실패했다. Astryx의 control 높이는 28/32/36px이고 이 앱의
  하한은 44px이다. **Astryx control을 그대로 쓰면 구조적으로 접근성 위반**이라는 뜻이다.
- 고침: `astryx-gomsin.css`에서 `--size-element-*`를 48/48/52로 올렸다. 44가 아니라 48인
  이유는 `SegmentedControlItem`이 `calc(var(--size-element-sm) - 4px)`이기 때문이다 —
  44를 넣으면 40px이 되어 여전히 실패한다. 48이면 가장 작은 Astryx control이 정확히
  44px이 되므로 caller가 어떤 `size`를 넘기든 하한이 유지된다.

#### 제품 결함 1건 — 미커밋 감정 작업이 만든 것, 추적해서 고침
- **증상: `저장`을 처음 누르면 아무 일도 일어나지 않는다.** toast도, 네트워크 요청도 없다.
  두 번째로 누르면 저장된다. 사용자 입장에서 최악의 형태다 — 앱이 기록을 흘린 게 아니라
  자기가 잘못 눌렀다고 읽힌다.
- **원인**: textarea가 blur에서 composition을 settle하고(`onBlur={settleComposition}`),
  settle하면 `EmotionSuggestionReview`가 **action row 바로 위에** 렌더된다. `저장`을 누르면
  → field가 blur → review가 나타남 → 버튼이 손가락 밑에서 밀려남 → click이 전달되지 않음.
  제거된 300ms debounce가 그동안 이 문제를 가리고 있었다.
- **격리 방법**: 클릭 전에 textarea를 먼저 blur시키면 첫 클릭이 정상 저장된다. 그 대조가
  reflow가 원인임을 확정했다. 그 전까지는 `runPost`의 조용한 early return을 의심했는데,
  버튼이 `저장 중...`으로 바뀌지 않고 `disabled`도 되지 않는다는 관측으로 배제했다.
- **고침**: `저장` 버튼에 `onMouseDown={(e) => e.preventDefault()}`. focus 이동을 막아
  reflow 자체를 없애면서 click은 그대로 전달된다. 키보드 사용자는 영향 없다(Tab으로 도달,
  Enter/Space는 mousedown을 거치지 않는다). 이 경로에서 분석을 건너뛰는 비용은 0이다 —
  저장되는 것은 **확인된** 마음뿐이고 미확인 제안은 payload에 아무것도 넣지 않는다.
- **mutation으로 검증했다**: `onMouseDown`을 지우면 새 회귀 테스트가 실패하고, 되돌리면 통과.

#### stale e2e 3개 재작성 — 규약이 바뀐 것이지 테스트가 틀린 게 아니다
- `emotionRedesign.spec.ts`의 `분노 → 행복 with no tap required`는 **전제가 뒤집혔다.**
  §13은 기계의 읽기가 작성자의 마음이 되려면 명시적 행위를 요구하며, 거부하지 않은 것은
  그 행위가 아니다. 그래서 같은 자리를 정반대 규약으로 다시 썼다: 읽기는 보이되
  `data-answered="false"`이고, 확인된 항목만 먹는 flow preview는 **아직 존재하면 안 된다.**
- 새로 추가: `answering the readings is what produces the flow` — 확인해야 비로소 flow가
  생긴다는 것을 브라우저에서 고정한다. 그리고 위 저장 회귀 1건.
- ▲▼ stepper는 사라졌으므로 `다른 마음` → 6개 picker 경로로 다시 썼다. 44px 실측은 유지.
- `completeness.spec.ts`의 draft 회귀는 `emotion-chip-list`를 **동기화 지점으로만** 쓰고
  있었다. 무관한 서브시스템에 결합돼 있었던 것이라, 이 테스트가 실제로 필요로 하는
  "field가 draft를 들고 있다"로 바꿔 결합을 끊었다.

#### 브라우저에서만 드러난 결함 3건 (유닛이 구조적으로 못 봄)
1. **Astryx carousel slide가 폭 0으로 붕괴.** Astryx는 슬라이드를 `flex-shrink:0`에
   **폭 없이** 감싼다. `w-full`은 폭 없는 부모에 대해 100%라 붕괴하고, `AspectRatio`는
   "definite width를 가진 조상"을 요구한다. `@container` + `w-[100cqw]`로 고쳤고,
   `e2e/mediaGallery.spec.ts`가 슬라이드 폭 > track 폭 × 0.7을 실측한다.
2. **그리드 마지막 줄의 빈 칸이 border 색으로 채워짐.** 1px gutter를 컨테이너
   `bg-border`로 만들었더니 3열에 4장일 때 마지막 줄 빈 트랙 2칸이 통짜 색 블록으로
   그려졌다. gutter를 페이지 배경이 비치는 방식으로 바꿨다.
3. **e2e fixture가 미디어를 표현할 수 없었다.** 아래 별도 항목.

#### e2e fixture 결함 2건 — 고침 (제품 결함 아님)
- `e2e/fixtures/mockBackend.ts`의 signed-URL stub이 **`createSignedUrl`(단수)의 shape**을
  돌려주는데 앱은 **`createSignedUrls`(복수)**를 쓴다. 복수형은 배열을 요구하므로
  supabase-js가 `data.map is not a function`으로 throw했고, 그것이 StorageError가 아니라
  rethrow되어 기록 로드를 중단시켰다 — 화면에는 전체 화면 `계정 정보를 확인하지 못했어요 /
  UNEXPECTED-UNKNOWN`이 떴다. 두 shape을 모두 답하도록 고쳤다.
- 같은 stub의 `signedURL`이 `/storage/v1/...`로 시작해서, supabase-js가 자기 storage
  base를 앞에 붙이면 `/storage/v1/storage/v1/...`가 되어 404였다. `/object/...`로 고쳤다.
- **두 결함 모두 3년치 fixture에서 한 번도 드러난 적이 없다.** `e2e/scenarios.ts`의 모든
  기록이 `attachments: []`라 signing 분기가 단 한 번도 실행되지 않았기 때문이다.
  미디어는 브라우저 suite에서 **구조적으로 검증 불가능한 상태**였다.

#### 새 브라우저 커버리지
- `e2e/mediaGallery.spec.ts` (6, 전부 PASS): carousel 슬라이드 실측 폭, **사진이 실제로
  decode되었는지**(`naturalWidth > 0`), 단일 사진이 자기 row를 벗어나지 않는지,
  사진 그리드 개수, Lightbox 열림/Escape 닫힘, **320px 두 렌즈 모두 가로 오버플로 0**,
  `상대방의 오늘`의 파트너 사진.
- 이 spec을 쓰면서 스스로 만든 함정 하나를 기록해 둔다: 손으로 적은 base64 PNG가
  유효하지 않아서 Chromium이 200 `image/png`로 응답해도 `<img>`가 `error`를 냈고,
  갤러리는 정상적으로 `이 파일을 열 수 없어요`로 degrade했다. 그동안 모든 geometry
  assertion은 **빈 aspect box 위에서 통과**했다. `naturalWidth` 검사를 넣은 이유다.

#### 캡처
- `ui-audit-results/after/` — 5탭 × 2역할 × 2테마 + 로딩/빈/저하/오류/서브화면 36장,
  그리고 미디어 6장(carousel 390, grid 390/320, lightbox 390, timeline 320, partner-day).

#### REVIEW IMPACT
- FULL. 시각 기반을 교체했고 독립 review는 없다.

#### BLOCKERS
- code: 없음.
- environment: `npx playwright install`이 이 환경에서 실패한다. 로컬 Chrome을
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 지정하면 우회된다 — config가 이미 지원한다.
- external/manual: independent review, 실기기, remote Supabase 증거, 실제 커플 사용 평가.

#### STOPPED AT
- 커밋하지 않았다. 이 tree에는 이 세션 이전부터 감정 시스템의 미커밋 작업이 섞여 있다.
  그쪽이 깨뜨렸던 e2e 5건은 이 세션에서 전부 해소했지만(85/0), 두 작업을 한 커밋으로 합치면
  어느 쪽도 독립적으로 되돌릴 수 없다. 분리는 소유자 판단이다.
  주의: `TodayLogWidget.tsx`의 `onMouseDown` 한 줄은 **감정 작업 쪽 커밋**에 속한다 —
  그 파일의 blur 경계가 만든 결함의 수정이지 시각 재설계가 아니다.
- `ui-audit-results/`는 이 세션 이전에 생긴 untracked 디렉터리이며 `.gitignore`에 없다.

#### REMAINING
- `AttachmentMedia.tsx`는 production 경로에서 빠졌다. 삭제 여부는 별도 결정이며,
  삭제하면 `AttachmentMedia.test.tsx`(12건)와 `lintGateStrictness.test.ts`의 참조도
  함께 정리해야 한다.
- 감정 작업과 시각 작업의 커밋 분리.
- 실기기(iOS/Android WebView)에서의 carousel 스와이프 감각과 Lightbox 제스처.

#### NEXT ACTION
- next owner: 커밋 분리 + 감정 작업 e2e 수정
- 기준 SHA: `21e7dfb146985547150736a7efe3d5d50b6306b2` + 이 working tree
- exact next task: 시각 재설계 파일만 골라 커밋 → 감정 작업 + `onMouseDown` 수정 + 재작성한 e2e를 별도 커밋

#### DO NOT ADVANCE UNTIL
- 커밋을 분리하기 전까지 이 tree 전체를 하나로 landing하지 않는다. 시각 재설계와 감정 작업은
  독립적으로 되돌릴 수 있어야 한다.

#### PRODUCTION
- NOT APPLIED

### 2026-08-20 · LV · 나머지 화면 마감 — touch hygiene 전역화, ErrorNote, sheet drag 확대

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: design-preview 기반 UI/UX 완성 — 나머지 화면
- Step: 일정·우리·마이·온보딩·설정·여행·기록의 press response / 실패 표면 / sheet 통일
- Previous Gate: `73f62b7`
- This Gate: 없음 — LV 진입 조건이 아니다

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` canonical tabs 불변. 화면 구조·기능 변경 없음
- Business source checked / NOT APPLICABLE: NOT APPLICABLE
- Engineering source checked: `ENGINEERING_ROADMAP` §LV
- Current-state checked: live git `73f62b7`
- Latest relevant Work Log checked: 바로 아래 항목
- Does this task conflict with canonical direction? NO

#### OWNERSHIP
- Tool: Claude Code / Model: claude-opus-5[1m] / Role: Worker + self-verification
- PR: 없음 / Branch: `master`
- Base SHA: 73f62b7c4332522b2692ea611826ec7648653b12
- New HEAD: `91709ed`

#### CHANGED / REVIEWED
- file: `src/styles/index.css` — `touch-action: manipulation` + tap-highlight 제거를
  `@layer base`의 `button`/`[role=button]`/`[role=tab]`/`summary`로 **전역화**.
  opt-in class에 얹혀 있어서 미적용 화면 100여 개 버튼이 탭마다 ~300ms를 계속 지불하고
  있었다. 앱에 double-tap 제스처가 없음을 확인하고 넣었고, 그 전제를 테스트로 고정했다
- file: `src/components/widgets/WidgetWrapper.tsx` — drag handle에 `touchAction: 'none'`.
  dnd-kit `attributes`가 이 값을 주지 않아 실제로는 위젯을 끌면 홈이 스크롤됐다
- file: 9개 화면 — `press-response` / `press-response-row` **86개 버튼**.
  filled CTA 17개는 row tint(→`--muted`)면 coral 버튼이 회색으로 번쩍이므로 scale로 재분류.
  strip regex가 `active:scale-[0.98]`의 `]`를 5곳에 남긴 것도 정정
- file: `src/components/ui/ErrorNote.tsx`(신규) — 실패 표면 단일화. cause / kept / retry를
  **별도 prop**으로 분리(한 문자열이면 다시 "연결을 확인" 한 문장으로 붕괴한다).
  `kept`는 `role="alert"` **내부**에 둬서 스크린리더가 읽게 했다. 10개 사이트 전환
- file: `src/components/ui/SheetHandle.tsx`(신규) + TripsPage / TripDetailPage(2) /
  RecordPage(2) — sheet drag 확대(2 → 7). 각 sheet는 자기 write 진행 중 비활성,
  기록 상세는 편집 중·삭제 확인 중에도 비활성
- file: `accessibilityInvariants.test.ts`(+5), `ErrorNote.test.tsx`(신규 9)

#### EXPLICITLY NOT CHANGED
- crypto / DB / migration semantics: 변경 없음. SQL 0건
- product semantics: 화면 구조·탭·기능·문구 의미 불변. presentation과 실패 표면만
- Production: 미접촉

#### VERIFICATION
- command: `npm run verify`
- PASS — typecheck, lint(0 warnings), **2523 tests / 166 files**, build
- command: 빌드 산출물에서 `touch-action:manipulation`·tap-highlight 실착지 확인 — PASS
- command: **mobile visual check (320/390/430, light/dark, 양 역할)**
- **NOT DONE** — 이전 세션과 동일. Playwright 브라우저 미설치, 설치 미완료,
  Chrome extension 미연결. 스크린샷을 찍지 않았으므로 통과로 적지 않는다
- command: `check:edge` / `test:edge`
- **NOT RUN** — deno 미설치. `supabase/functions/` 미접촉
- what it actually proves: 클래스·토큰·불변식의 정확성과 번들 도달. 실제 기기에서의
  체감 지연 감소와 시각적 판단은 증명하지 않는다

#### REVIEW IMPACT
- DELTA — presentation + 실패 표면. security/privacy/제품 의미 delta 없음

#### BLOCKERS
- code: 없음
- environment: Playwright 브라우저 미설치, deno 미설치

#### STOPPED AT
- exact completed boundary: `91709ed`까지 master 착지

#### REMAINING
- not completed: 시각 검증, 통증 공유 security review(`security-review/cycle-pain-care-signal`,
  로컬 전용), 화면별 빈/로딩 상태 보강(우리·온보딩·서비스는 아직 shared ui primitive 미사용),
  `EmptyState`/`Skeleton` 채택 확대

#### NEXT ACTION
- next owner: 사용자(시각 검증), independent security reviewer(047)
- 기준 SHA: `91709ed`
- exact next task: 실기기에서 탭 반응·sheet drag 체감 확인

#### DO NOT ADVANCE UNTIL
- next-step conditions: 047 계열은 independent security review 전까지 master 금지.
  P6는 NOT AUTHORIZED

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED: NOT APPLIED

---

### 2026-08-20 · LV · 감정 캐릭터·기록 속 마음·주기 시각화, 그리고 통증 공유(미착지)

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: design-preview 기반 UI/UX 완성 + Cycle UX
- Step: 감정 캐릭터 / 기록 속 마음 / 증상 2종 / 가임·배란 시각화 / 공유 경계 / 배려 신호 UX
  → master 착지. 통증 공유는 별도 branch에서 구현만.
- Previous Gate: interaction quality layer (`2184bed`)
- This Gate: 없음 — LV 진입 조건이 아니다

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` canonical tabs 불변, §13(감정은 author-only 기본),
  §8(이야기거리는 task manager 아님)
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 고객·BM·가격·KPI 변경 없음
- Engineering source checked: `ENGINEERING_ROADMAP` §LV
- Current-state checked: `CURRENT_STATE.md`, live git (`2184bed`)
- Latest relevant Work Log checked: 바로 아래 interaction-quality entry
- Abandoned-strategy guard(`AGENTS.md` §17): 해당 없음. AI 자동 감정 확정을 요청 문서가
  독립적으로 금지했고 구현도 그에 따랐다
- Does this task conflict with canonical direction? NO
  (직전 세션의 §L 통증 공유 충돌은 이번에 Control Tower 제품 결정으로 해소되었다)

#### OWNERSHIP
- Tool: Claude Code / Model: claude-opus-5[1m] / Role: Worker + self-verification
- PR: 없음
- Branch: `master` (UI) + `security-review/cycle-pain-care-signal` (통증 공유, **로컬 전용**)
- Base SHA: 2184bedd7a2a02cb6575aae374a02c4e4a34ad4a
- New HEAD: `7e0d8a7` (master), `a59da87` (review branch, 미push)

#### CHANGED / REVIEWED
- file: `src/components/emotion/EmotionCharacter.tsx`(신규) — 6감정 original SVG.
  silhouette가 1차 신호, 색이 2차, 한글 label이 3차. loop/idle animation 없음
- file: `src/components/emotion/RecordMoodSection.tsx`(신규) + `RecordPage.tsx` —
  기록 상세의 **기록 속 마음**. 저장된 감정이 처음부터 선택 상태, 변경은 1탭.
  기존 `RecordEmotionCorrection`은 다른 질문(어떤 추정을 남길지)이라 그대로 둔다
- file: `src/styles/index.css` — `--emotion-*` 12종(light/dark)
- file: `src/types/index.ts`, `cycleFormatting.ts` — 증상 `nausea`·`breast_tenderness`
- file: `src/lib/cyclePrediction.ts` — `fertilityOccursOnDate`·`ovulationOccursOnDate`
  (**읽기 전용**. 엔진 산술 미변경)
- file: `src/components/cycle/CycleDayMarker.tsx`(신규) + `CycleCalendar.tsx` —
  4상태 color+symbol, 기록=solid / 예상=outline, legend 필수
- file: `cyclePartnerMessage.ts` + `CycleSharingSettings.tsx` — 공유/비공유 2블록 분리
- file: `CycleSupportSection.tsx` — 배려 요청 `<select>` → 카드 4종, 기본 선택 없음
- file: `design-preview/screensNew.tsx`(신규), `registry.ts` — 신규 컴포넌트 갤러리 + 430 뷰포트
- **미착지**: `supabase/migrations/047_cycle_pain_care_signal.sql`,
  `CYCLE_PAIN_SHARE_KINDS`, 통증 공유 UI/preview — `security-review/...` branch에만 있다

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음
- DB/migration semantics: **master에는 변경 없음.** 047은 review branch에만 있고
  어디에도 적용하지 않았다
- product semantics: canonical tabs·PartnerDay·§8·§13 불변.
  `CyclePartnerMessageInput`은 여전히 증상/출혈량/기분/메모를 담을 필드가 없다
- Production: 미접촉. remote Supabase mutation 없음

#### VERIFICATION
- command: `npm run verify` (master)
- PASS — typecheck, lint(0 warnings), **2509 tests / 165 files**, build
- command: `npm run verify` (review branch)
- PASS — **2527 tests / 166 files**, build
- command: `test:p0`/`test:p5`/`test:rollback`/`test:write-floor`/`test:phase0` (review branch,
  schema를 건드리므로 실행)
- PASS — 76 / 93 / 3케이스 / 39 assertions / Phase 0 계약 유지
- command: 빌드 산출물에서 `--emotion-*` light·dark 실착지 확인 — PASS
- command: **mobile visual check (320/390/430, light/dark)**
- **NOT DONE** — Playwright 브라우저가 이 머신에 없고 `npx playwright install`이 완료되지
  않았다(다운로드 624K에서 정지). Chrome extension 경로도 미연결. 스크린샷을 찍지 못했으므로
  시각 검증은 통과로 적지 않는다. `design-preview`에 갤러리 화면과 430 뷰포트를 추가해
  두 줄 명령으로 실행 가능한 상태로 남겼다
- command: `check:edge` / `test:edge`
- **NOT RUN** — deno 미설치. `supabase/functions/` 미접촉
- what it actually proves: 토큰·컴포넌트 로직·privacy 경계·migration blast radius의
  정확성. 실제 화면에서의 시각적 판단과 실기기 터치는 증명하지 않는다

#### REVIEW IMPACT
- master: DELTA — presentation + 개인 기록 어휘. privacy 경계 변화 없음
- review branch: **FULL — independent security review 필요.** partner-visible 어휘와
  migration이 바뀐다

#### BLOCKERS
- code: 없음
- environment: Playwright 브라우저 미설치, deno 미설치
- external/manual: 통증 공유는 security review 전까지 master 금지

#### STOPPED AT
- exact completed boundary: master에 `7e0d8a7`까지 착지. 통증 공유는 `a59da87`로
  **로컬 커밋만** 했고 push하지 않았다. patch 사본은 scratchpad에 있다

#### REMAINING
- not completed: 통증 공유 security review, 시각 검증, 나머지 화면(Home/Schedule/Us/My/
  onboarding)의 개별 디자인 패스, `ErrorNote` 등 design-preview 원시 컴포넌트 이식

#### NEXT ACTION
- next owner: independent security reviewer(047), 이후 사용자(시각 검증)
- 기준 SHA: `7e0d8a7` (master), `a59da87` (review branch)
- exact next task: 047 review → 통과 시 master 착지 → staging 적용 검증

#### DO NOT ADVANCE UNTIL
- next-step conditions: 047과 통증 공유 계열은 independent security review 이전에
  master·remote 어디에도 올리지 않는다. P6는 여전히 NOT AUTHORIZED

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED: NOT APPLIED. 047은 어디에도 미적용

---

### 2026-08-20 · LV · Apple 수준 interaction quality layer — foundation + core loop

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: interaction quality layer (design-preview visual identity 유지)
- Step: foundation(press response · spring · a11y preference · tracking) + LV core loop 적용
- Previous Gate: 2026-08-20 branch consolidation (`1a7c55e`)
- This Gate: 없음 — 이 작업은 LV 진입 조건이 아니다 (아래 DIRECTION CHECK 참조)

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` canonical tabs(홈/기록/일정/우리/마이) 불변, §8 이야기거리는
  대화 목록이지 task manager가 아님, §7.1 기록 작성 진입점
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 고객·BM·가격·AI 역할·KPI 변경 없음
- Engineering source checked: `ENGINEERING_ROADMAP` §LV. LV 진입 조건은 기능·안전 기준이며
  interaction quality는 그 조건이 **아니다**. gate를 전진시키지 않고, 위협하지도 않는다
- Current-state checked: `CURRENT_STATE.md` §1 consolidation checkpoint
- Latest relevant Work Log checked: 바로 아래 consolidation entry
- Abandoned-strategy guard (`AGENTS.md` §17): 해당 없음. 요청 문서가 AI 자동 감정 선정을
  독립적으로 금지하고 있어 §17과 일치
- Does this task conflict with canonical direction? **YES — 한 항목**
- If YES, what conflict: 요청 문서 §L "통증 정도는 선택적으로 공유 가능".
  `src/lib/cyclePartnerMessage.ts`의 `CyclePartnerMessageInput`은 symptoms·flow·pain·mood·note를
  **타입 수준에서 담을 수 없게** 만들어 둔 privacy boundary다. 통증 공유를 추가하려면 그 경계를
  넓혀야 하므로 security review + 제품 결정이 필요하다. **구현하지 않고 사용자에게 보고했다.**
  같은 문서의 "출혈량은 제외"는 이미 충족되어 있으며, 요청보다 강하게(런타임 검사가 아니라 타입으로)
  보장되고 있다. "상대방에게 이렇게 보여요" preview도 이미 존재한다

#### OWNERSHIP
- Tool: Claude Code
- Model: claude-opus-5[1m]
- Role: Worker + self-verification
- PR: 없음 (사용자 지시로 master 직접 착지)
- Branch: `master`
- Base SHA: 1a7c55e65a166f8a09717d0209e19f57db49914c
- Old HEAD: 1a7c55e65a166f8a09717d0209e19f57db49914c
- New/Reviewed HEAD: e51269e (아래 STOPPED AT 참조)

#### CHANGED / REVIEWED
- file: `src/styles/index.css` — `press-response` / `press-response-row` 신규,
  step별 `--text-*--letter-spacing` 7종 신규,
  `@media (prefers-reduced-transparency: reduce)` · `@media (prefers-contrast: more)` 신규.
  미사용 `@keyframes cell-press` 제거
- file: `src/lib/motion.ts` — `prefersReducedTransparency`/`prefersHighContrast`,
  closed-form spring(`springStep`·`springAtRest`), `projectMomentum`, `rubberband` 추가.
  기존 `prefersReducedMotion`/`scrollBehavior` 의미 불변
- file: `src/lib/useSheetDrag.ts` (신규) — 1:1 추적 · rubberband · velocity handoff ·
  interruptible spring. `enabled: !busy` 지원
- file: `src/components/ui/Button.tsx` — `transition active:scale-[0.99]` → `press-response`.
  앱 전체 버튼에 touch-action/tap-highlight가 한 번에 적용됨
- file: `MobileShell.tsx`(탭바), `CycleCalendar.tsx`(날짜·월 이동),
  `CycleSheet.tsx`(drag dismiss + busy 가드), `AddWidgetBottomSheet.tsx`(drag dismiss),
  `PartnerDayTimelineWidget.tsx`(타임라인 행), `TalkAboutListWidget.tsx`(원본 행·확인·overflow)
- file: `src/lib/motion.test.ts`(신규 19), `accessibilityInvariants.test.ts`(+6),
  `typeScale.test.ts`(+2)
- why: 탭바를 포함한 핵심 컨트롤이 pointer-down이 아니라 navigation/release에 반응했고,
  `backdrop-blur` 14곳에 대응하는 transparency/contrast 선호 처리가 전무했다

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음 (E2EE·키·복호화 미접촉)
- DB/migration semantics: 변경 없음 (SQL 0건)
- product semantics: canonical tabs·PartnerDay 상태 기계·§8·§7.1 의미 불변.
  `cyclePartnerMessage.ts` 미접촉
- Production: 미접촉. Supabase remote mutation 없음

#### VERIFICATION
- command: `npm run verify`
- PASS — typecheck, lint(0 warnings), **2477 tests / 163 files**, build
  (build는 CI와 동일한 non-secret placeholder를 프로세스 환경에만 주입)
- command: 빌드 산출물에서 신규 CSS 실착지 확인
- PASS — `dist`에 `prefers-reduced-transparency`·`prefers-contrast`·`press-response` 존재.
  `.text-display{...letter-spacing:var(--tw-tracking,-.02em)}`,
  `.text-caption{...letter-spacing:var(--tw-tracking,.01em)}` — tracking이 실제로 컴파일됨
- command: `npx vitest run src/lib/motion.test.ts`
- PASS (19) — critically damped는 target을 넘지 않음, momentum spring은 넘음,
  0.1s 1회 = 0.01s 10회(closed form의 timestep 독립성), 250ms stall 후 정상 복귀
- command: `npm run check:edge` / `npm run test:edge`
- **NOT RUN** — 이 머신에 deno 미설치. `supabase/functions/` 미접촉이라 위험은 낮으나 실행하지 않았다
- 실행하지 않음: 실기기 터치 검증, 실제 브라우저에서의 press latency 측정,
  `prefers-reduced-transparency`를 켠 실제 OS에서의 육안 확인
- what it actually proves: 토큰·CSS·spring 수학·불변식의 정확성과 빌드 산출물 도달.
  실제 손가락으로 만졌을 때의 체감은 증명하지 않는다

#### REVIEW IMPACT
- DELTA — presentation layer에 한정. security/privacy/제품 의미 delta 없음
- whether an earlier review is stale: NO. consolidation 시점의 판정은 그대로 유효하다

#### BLOCKERS
- code: 없음
- environment: deno 미설치
- external/manual: 실기기 검증 미실시

#### STOPPED AT
- exact completed boundary: foundation + LV core loop 적용 + 테스트 + `npm run verify` 통과,
  `e51269e` 커밋. 이 entry를 담은 commit이 추가되면 최종 SHA는 그만큼 앞선다

#### REMAINING
- not completed: 나머지 화면(12 pages 중 core loop 외), 전체 한글 타이포그래피 육안 검수,
  material/depth 확장, haptics(Capacitor haptics 의존성 미추가 — 요청 문서가 haptic만을 위한
  새 의존성 추가를 금지), 독립 review

#### NEXT ACTION
- next owner: 사용자 판단(적용 범위 확대 여부), 이후 독립 Reviewer
- tool/model: Kiro Reviewer 또는 Claude (read-only)
- 기준 SHA: push 후의 새 origin/master
- exact next task: 실기기에서 탭바·시트 drag 체감 확인, 그리고 §L 통증 공유를 열지 여부의 제품 결정

#### DO NOT ADVANCE UNTIL
- next-step conditions: `cyclePartnerMessage.ts`의 타입 수준 privacy boundary를 넓히는 작업은
  security review 없이 시작하지 않는다. P6는 여전히 NOT AUTHORIZED

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED: NOT APPLIED

---

### 2026-08-20 · LV · 전 branch consolidation — 흩어진 유효 작업을 master로 회수

#### PLAN POSITION
- Phase: LV (Limited Validation)
- Workstream: branch consolidation / minimum-loss master reconstruction
- Step: remote branch 76개 전수 감사 → 유효 고유 작업만 회수 → master 착지
- Previous Gate: P5.5 landing (`eb2d9a4`), master `7a83665`
- This Gate: LV 코어 작업(PartnerDay 상태 기계 + 이야기거리 도달성 + §7.1 authoring)이
  한 tree에 모이고 `npm run verify`가 통과함

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` §6.1/§6.5(놓친 하루), §7.1(기록 진입점),
  §7.5(원본 동일성), §8(이야기거리는 대화 목록이지 task manager가 아님)
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 고객·BM·가격·저장정책·AI 역할
  변경 없음
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md`
- Current-state checked: 저장소 코드와 live git/GitHub. 문서의 과거 SHA·PR 서술은
  근거로 쓰지 않았다
- Latest relevant Work Log checked: 2026-08-19 두 entry(#70 repair, identity-transition)
- MASTER PLAN version / 기준일: 2026-08-20
- Does this task conflict with canonical direction? NO
- If YES, what conflict: —

#### OWNERSHIP
- Tool: Claude Code
- Model: claude-opus-5[1m]
- Role: Senior Git Integrator + Software Archaeologist (write-capable)
- PR: 없음. **PR을 만들지 않는 것이 이번 작업의 지시였다**
- Branch: `consolidation/all-valid-work-v1` (전용 clean worktree에서 작업)
- Base SHA: 7a83665299a1f0096f2f81da393f28a97142c9ba
- Old HEAD: 7a83665299a1f0096f2f81da393f28a97142c9ba
- New/Reviewed HEAD: eadf647f81f9acfa4509a640278cfc88e71cc978 (+1, 아래 STOPPED AT)

#### CHANGED / REVIEWED
- 판정 근거 전체: `docs/CONSOLIDATION_LEDGER.md` (branch 76개가 각각 정확히 한 번 등장).
  여기에 그 내용을 복제하지 않는다
- file: `src/lib/partnerDay.ts` / `partnerDay.test.ts` / `usePartnerDay.ts` /
  `partnerDaySimulation.test.ts` — PR #72 계보(`609a891`)를 회수. 적용 후 트리가 `609a891`과
  byte-identical임을 확인
- file: `TalkAboutListWidget.tsx`/`.test.tsx`, `recordAuthoringEntryPoint.test.tsx`,
  `src/lib/widgets.tsx` — PR #71 계보의 이야기거리 overflow 수정과 §7.1 계약
- file: `control-tower/**` — PR #70 계보의 Obsidian vault·LV architecture report.
  같은 branch의 PartnerDay production code는 회수하지 않았다
- file: `docs/CONSOLIDATION_LEDGER.md`(신규), `docs/CURRENT_STATE.md`,
  `docs/WORK_LOG.md`, `control-tower/Current Gate.md`, `Dashboard.md`,
  `tasks/PartnerDay Checkpoint State Machine.md`
- why: 유효한 고유 작업이 세 branch에 흩어져 있었고, 그중 하나(PR #70)는 **더 최신
  HEAD를 가졌지만 더 약한 PartnerDay 구현**을 담고 있었다. 시각이 아니라 의미로 판정했다

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음. E2EE·키·복호화 경로 미접촉. local-only stack의 security
  파일 6종이 master와 byte-identical임을 blob 단위로 확인
- DB/migration semantics: 변경 없음. SQL 파일 0건 추가·수정. migration 041/042 미접촉
- product semantics: chat FROZEN 유지, P6 미착수, 감정 추론·관계 점수·이별 예측·자동
  중요 기록 선정 부재를 최종 tree에서 재확인
- Production: 미접촉. Supabase remote mutation 없음

#### VERIFICATION
- command: `npm ci && npm run verify`
- PASS — typecheck, lint(0 warnings), **2450 tests / 162 files**, build
  (build는 CI와 동일한 non-secret placeholder를 프로세스 환경에만 주입해 실행)
- command: `npm run test:p0` / `test:p5` / `test:rollback` / `test:write-floor` / `test:phase0`
- PASS — 각각 76 / 93 assertions, rollback 3케이스, 39 assertions, Phase 0 계약 유지
- command: `npm run verify:native`
- PASS — 85 tests / 4 files
- command: PartnerDay·이야기거리·authoring·account deletion·couple lifecycle 표적 실행
- PASS — 213 tests / 10 files
- command: `npm run check:edge` / `test:edge`
- **NOT RUN** — 이 머신에 deno 미설치. 이번 변경은 `supabase/functions/`를 전혀 건드리지
  않았으므로 위험은 낮지만 실행하지 않았다는 사실은 그대로 남긴다
- command: 최종 tree 회귀 감사 (금지 기능 부재 + 필수 의미 존재 grep)
- PASS — 특히 `emotionPipelineSingleSource.test.ts`가 삭제된 두 번째 감정 엔진 파일의
  **부재를 단언**하며 통과한다. 옛 branch에서 그 파일을 되살렸다면 master 자신의 테스트가
  깨졌을 것이다
- what it actually proves: 로컬 저장소 수준의 정확성과 통합 무결성. 실기기·staging·
  production 증거가 아니며 독립 review도 아니다

#### REVIEW IMPACT
- FULL — PartnerDay 상태 기계 의미가 master에서 전면 교체되었다
- whether an earlier review is stale: YES. PR #70 기준의 이전 판정은 이 tree에 적용되지
  않는다. PR #72 계보에 대한 독립 review는 아직 없다

#### BLOCKERS
- code: 없음
- environment: deno 미설치로 edge 검증 미실행
- external/manual: `git push origin master`가 `.claude/hooks/block-dangerous-bash.sh`의
  `direct push to master` 규칙에 의해 결정적으로 차단된다. hook 자체가 명시한 예외
  경로("the user must run it themselves")를 따랐고, hook을 우회하거나 수정하지 않았다

#### STOPPED AT
- exact completed boundary: 감사·회수·검증·문서화 완료. `consolidation/all-valid-work-v1`을
  origin에 push했고 local `master`를 `eadf647`로 fast-forward했다. **remote master ref
  갱신만 남았다.** 이 entry를 담은 commit이 추가되면 최종 SHA는 그만큼 앞선다

#### REMAINING
- not completed: `git push origin master` (사용자 실행). 독립 review 미실시.
  remote branch 정리 미실시(이번 pass에서 0개 삭제)

#### NEXT ACTION
- next owner: 사용자(push), 이후 독립 Reviewer
- tool/model: Kiro Reviewer 또는 Claude (read-only)
- 기준 SHA: push 후의 새 origin/master
- exact next task: 불확정 `OUTSTANDING` 증가에 대한 저장 용량 제품 결정, 그리고 실기기
  다일차 검증

#### DO NOT ADVANCE UNTIL
- next-step conditions: 미확인 기록 보존이 저장 용량보다 우선한다는 제품 결정이 확정될 때까지
  `OUTSTANDING` 상한 관련 구현을 시작하지 않는다. P6는 여전히 NOT AUTHORIZED

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED: NOT APPLIED. remote Supabase catalog UNVERIFIED,
  실기기 UNVERIFIED

---

### 2026-08-19 · LV · Partner Day 미확인 기록 소실 — clean replacement

#### PLAN POSITION
- Phase: LV (Partner Day 놓친 하루 복구)
- Workstream: partner-day checkpoint state machine
- Step: W1–W8 clean replacement (PR #70 코드 patch 아님, 새 설계로 재구현)
- Previous Gate: 8ce544e (1000-day simulation 복구)
- This Gate: 미확인 기록이 시간 경과로 사라지지 않음이 테스트로 증명됨

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` §6.1, §6.5 (`마지막 확인점 이후, 없으면 최근 7일, 상한 오늘`), §1.11, §7.5
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 고객/과금/저장정책/AI 역할 변경 없음
- Engineering source checked: `AGENTS.md` §2 core product contract, §13 scope discipline
- Current-state checked: 저장소 실제 코드 (`src/lib/partnerDay.ts` at 8ce544e)
- Latest relevant Work Log checked: 2026-08-18 P5.5 Final Landing
- MASTER PLAN version / 기준일: 2026-08-19
- Does this task conflict with canonical direction? NO
- If YES, what conflict: —

§6.5의 "없으면 최근 7일"은 유지되지만 그 의미를 재확인했다. 이는 **첫 접촉 1회의
discovery 상한**이며 보존 규칙이 아니다. 이전 구현은 이 7일을 memory로 사용해서
§1.11("놓친 하루의 맥락을 복구")을 위반했다.

#### OWNERSHIP
- Tool: Codex (desktop)
- Model: claude-opus-5
- Role: Worker + self-verification
- PR: #72 (`claude/lv-partner-day-clean-v2`)
- Branch: `claude/lv-partner-day-clean-v2`, base `7a83665` (master)
- Base SHA: 7a83665299a1f0096f2f81da393f28a97142c9ba
- Old HEAD: 7a83665299a1f0096f2f81da393f28a97142c9ba
- New HEAD / Reviewed HEAD: 609a8911c5e3465fe97728c463fdded9f6f4cd12

> 이 항목은 작성 시점에 `codex/lv-readiness-audit-v1`의 uncommitted working tree를
> 가리켰다. 그 상태는 그대로 커밋되지 않았다. 같은 설계가 master 위에서 clean
> replacement 세 커밋(`8429883` → `27703a5` → `609a891`)으로 다시 구현되었고,
> 2026-08-20 consolidation이 회수한 것은 그 세 커밋이다. 위 provenance는 실제로
> 착지한 계보로 정정했다. 본문의 설계 서술은 원문 그대로 둔다.

#### CHANGED / REVIEWED
- file: `src/lib/partnerDay.ts` — 전면 교체. `PartnerDayCheckpoint`가
  `{version, confirmedRecordIds, outstandingRecordIds, knownRecordIds}`.
  `observedRecordIds` → `knownRecordIds`, `confirmedAt` 제거.
  `projectPartnerDay` (first-contact / discovery), `acknowledgePartnerDayRecords`
  (유일한 CONFIRMED writer) 신규. `missedPartnerRecords`,
  `advancePartnerDayCheckpoint`, `partnerDayFallbackWindow` 제거.
- file: `src/lib/usePartnerDay.ts` (신규) — viewer/couple/todayStr을 한 closure에서
  구성해 eligibility와 persistence가 동일 값을 사용. 저장 실패 시 state 미전진.
- file: `src/components/widgets/PartnerDayTimelineWidget.tsx` — hook 사용,
  확인 버튼만 CONFIRMED 기록.
- file: `src/components/widgets/CareHintWidget.tsx` — 동일 surface를 읽기 전용으로 사용.
- file: `src/lib/partnerDay.test.ts` (재작성, 56 tests), `src/lib/partnerDaySimulation.test.ts`
  (신규, 12 tests), 위젯/identity 테스트 signature 갱신.
- why: 이전 구현은 "surface 되었지만 확인하지 않은" 상태를 저장하지 않았고, 그 역할을
  rolling 7-day date window가 대신했다. 날짜 window는 잊는다. day 0에 보였고 day 8에
  사라졌으며 아무도 확인 버튼을 누르지 않았다.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 변경 없음 (E2EE·키·복호화 경로 미접촉)
- DB/migration semantics: 변경 없음 (SQL·migration·Supabase 미접촉)
- product semantics: §6.5 첫 접촉 7일 상한, 확인 버튼 UX, 시각 디자인 유지
- Production: 미접촉

#### VERIFICATION
- command: `npx vitest run src/lib/partnerDayOutstandingSurvival.test.ts` (at 8ce544e, 임시 파일)
- FAIL — day 0 `['never-acknowledged']` → day 8 `[]`. 결함 재현 확인 후 파일 삭제, 정식 테스트로 이전.
- command: `npx vitest run src/lib/partnerDay.test.ts`
- PASS (56) — day 8 / 30 / 400일 미확인 생존, 확인 버튼만 CONFIRMED 기록, 저장 실패 시 미전진.
- command: `npx vitest run src/lib/partnerDaySimulation.test.ts`
- PASS (12) — seed 20260819 / 7 / 991 × diligent · partial · observer.
  observer(1000일 동안 확인 버튼 0회): surfaced≈2769–2905, survivingOutstanding≈2755–2890,
  confirmed=0, stranded=0.
- command: mutation test 1 — surface에 7일 date floor 재도입
- 22 FAIL (regression 4건 + simulation 9건 전부). 테스트가 vacuous하지 않음을 증명.
- command: mutation test 2 — `projectPartnerDay`가 outstanding을 CONFIRMED에 자동 기록
- 14 FAIL (mount 시 CONFIRMED 금지 포함). 복원 확인.
- command: `npm run verify`
- PASS — typecheck, lint(0 warnings), 2406 tests / 161 files, build 양방향.
- what it actually proves: 로컬 저장소 수준의 상태 기계·위젯 경로 정확성. 실제 기기,
  staging, production 증거는 아님.

#### REVIEW IMPACT
- FULL — 상태 기계 의미가 전면 교체되었으므로 8ce544e 기준 이전 review는 승계되지 않는다.
- whether an earlier review is stale: YES. PR #70에 대한 이전 판정은 이 트리에 적용되지 않는다.

#### BLOCKERS
- code: 없음
- environment: 없음
- external/manual: 실제 기기에서 여러 날에 걸친 수동 검증 미실시 (시간 경과가 필요)

#### STOPPED AT
- exact completed boundary: W1–W8 구현 + 테스트 + `npm run verify` 통과. 작성 시점에는
  커밋하지 않았다. 이후 같은 설계가 `8429883`로 커밋되었고, corrupt/unavailable receipt
  처리(`27703a5`, `609a891`)가 그 위에 추가되어 PR #72가 되었다.

#### REMAINING
- not completed: 작성 시점 기준 commit / push / PR 없음. 2026-08-20 consolidation에서
  PR #72 계보로 회수되어 master에 착지했다. 독립 review는 여전히 미실시.

#### NEXT ACTION
- next owner: 사용자 판단 (커밋 여부), 이후 독립 Reviewer
- tool/model: Kiro Reviewer 또는 Claude (read-only)
- 기준 SHA: 커밋 후의 새 HEAD
- exact next task: OUTSTANDING 무한 성장에 대한 저장 용량 운영 판단 검토

#### DO NOT ADVANCE UNTIL
- next-step conditions: 미확인 기록 보존이 저장 용량보다 우선한다는 제품 결정 확인

#### PRODUCTION
- APPLIED / NOT APPLIED / UNVERIFIED: NOT APPLIED

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


### 2026-08-19 · LV — identity-transition blocker, checkpoint hardening, launch-pack coverage

같은 날 앞선 항목을 대체하지 않고 이어진다. 앞 항목에 적힌 HEAD는 이미 낡았다.

#### PLAN POSITION
- Phase: LV — Limited Validation Gate / M3 prerequisite
- Workstream: missed-context correctness + two-person launch pack
- Step: A5 blocker 수정 → adversarial self-check → #71 검증
- Previous Gate: #70 self-review verdict `CHANGES_REQUIRED` (A5 identity transition)
- This Gate: A5 닫힘, #70 CI 14/14 green, #71 검증 완료

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` §6.1–6.5, §7.1, §8 — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — client-only correctness
- Engineering source checked: `AGENTS.md`, `docs/ENGINEERING_ROADMAP.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 2026-08-19 앞 항목 — YES
- Does this task conflict with canonical direction? NO

#### OWNERSHIP
- Tool: Claude Code
- Model: Opus 5
- Role: implementation owner. **Independent review는 아직 없다** — 지금까지의 모든 review pass는 작성자 본인이 했다.
- PR: #70, #71
- Base SHA: `7a83665299a1f0096f2f81da393f28a97142c9ba`
- #70: `922938e` → `fe7b9f7529ed17e41037e123e5cd0afbd3ff8e9b`
- #71: `4daed22` → `72d0bd27c0ccefbd81747a79f6676bb9dd473bfb`

#### CHANGED / REVIEWED
- `src/features/home/WidgetDashboard.tsx` — registry-rendered 위젯에 `${id}:${userId}:${coupleId}` React key. lifecycle identity 전용이며 `id` prop·SortableContext·저장된 layout은 plain registry id를 유지한다. `CallBriefingWidget`이 이미 갖고 있던 key를 전체로 확장한 것이다.
- `src/lib/partnerDay.ts` — `advancePartnerDayCheckpoint`가 window 전체를 받아 아직 남아 있는 가장 이른 기록에서 bound를 멈춘다. 이 기기가 아직 복호화하지 못하는 기록을 건너뛰지 않기 위함이다. "bound를 뒤로 되돌리지 않는다" 규칙은 제거했다. 되돌리는 쪽이 안전한 방향이기 때문이다.
- `src/components/widgets/PartnerDayTimelineWidget.tsx` — acknowledgement가 readable prefix와 함께 missed window 전체를 넘긴다.
- 신규 테스트: `src/features/home/widgetIdentityTransition.test.tsx`, 그리고 partnerDay / PartnerDay / TalkAbout 스위트 보강.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음. key hierarchy·device trust·recovery authority·write floor 미접촉.
- DB/migration semantics: 없음. SQL 변경 없음.
- product semantics: surface 이름·funnel·Home 구조 변경 없음. chat 없음. P6 없음.
- Production: 미접촉.

#### VERIFICATION
- `npm run verify` — PASS (EXIT=0). #70 `fe7b9f7`: 2369 tests / 160 files. #71 `72d0bd2`: 2374 tests / 160 files. 결합 tree(#71 + 최종 #70): 2382 tests / 161 files, PASS.
- `git diff --check` — PASS, 양쪽 브랜치.
- 구 HEAD 실패 증명: identity-transition regression 7개 중 6개가 `922938e`에서 실패하고 수정본에서 전부 통과한다. 나머지 1개는 key가 sortable id로 새는 것을 막는 guard이므로 양쪽에서 통과하는 것이 정상이다.
- 복호화 불가 기록이 사라지는 문제는 고치기 전에 실패하는 테스트로 재현한 뒤 수정했다.
- **#70 CI @ `fe7b9f7`: 14/14 PASS**, `Real-browser creator/partner matrix` 포함. 직전 `dc7f1d6`은 Vitest step 2개가 FAIL이었고 원인은 제품 코드가 아니라 테스트였다 — jsdom이 `localStorage.setItem`을 own property로 두는지 prototype에 두는지가 환경마다 달라서 spy가 CI에서 조용히 빗나갔다. 이제 module boundary에서 실패시킨다.
- **#71 CI: 구조적으로 없음.** 모든 workflow는 정확히 하나의 base branch에서만 trigger하고 `codex/lv-readiness-audit-v1`은 그중에 없다. `.kiro/steering/merge-policy.md`가 trigger 확대를 금지하므로 workflow는 건드리지 않았다. #71의 자동 증거는 로컬 `npm run verify`뿐이다.
- 로컬 Playwright: **UNVERIFIED**. 이 sandbox에서 Chromium 다운로드가 차단된다. 브라우저 증거는 CI가 authority다.
- remote Supabase / production / 실기기: **UNVERIFIED, 미접촉.**

#### REVIEW IMPACT
- FULL, 양쪽. #70의 구현이 다시 바뀌었고 #71은 review된 적이 없다.

#### BLOCKERS
- code: 없음.
- environment: 로컬 Playwright 불가. #71은 stacked base 때문에 Actions 없음.
- external/manual: independent review, 실기기, remote Supabase 증거.

#### STOPPED AT
- #70 `fe7b9f7` pushed, CI 14/14 green. #71 `72d0bd2` pushed, Draft, base는 #70 branch.
- #71을 최종 #70과 합치는 통합 commit은 만들지 않았다. `.claude/hooks/block-dangerous-bash.sh`가 해당 명령을 차단하며 이는 user 권한이다. 두 브랜치가 건드리는 파일 집합은 서로 겹치지 않으므로(#71 5개, #70 6개, 교집합 0) conflict가 발생할 수 없고, #70이 master에 들어간 뒤 #71은 깨끗하게 합쳐진다. 결합 tree는 로컬에서 이미 검증했다.

#### REMAINING
- 양쪽 HEAD에 대한 independent review. #70 landing 후 #71 retarget과 CI. 통제된 실제 커플 검증.

#### NEXT ACTION
- next owner: fresh independent review session
- 기준 SHA: `fe7b9f7529ed17e41037e123e5cd0afbd3ff8e9b`, 그다음 `72d0bd27c0ccefbd81747a79f6676bb9dd473bfb`
- exact next task: #70 review → landing 판단 → #71을 master로 retarget → #71 CI 확보 → #71 review

#### DO NOT ADVANCE UNTIL
- independent reviewer가 #70의 checkpoint semantics와 identity lifecycle을 승인할 때까지.
- #71이 master를 base로 실제 CI를 통과할 때까지.

#### PRODUCTION
- NOT APPLIED


### 2026-08-21 · Phase 0 — 결함 마감과 정합 (Fable 전략 §8 Phase 0)

#### PLAN POSITION
- Phase: Phase 0 — 마감과 정합 (`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` §8)
- Workstream: UI 결함 마감 · S6 편집기 통합 · 죽은 코드 제거
- Step: Phase 0 결함 목록 전수 마감 → Phase 1 진입 준비
- Previous Gate: #74/#75/#76 세 PR 모두 CI 14/14 green, #76 delta 재검토 APPROVED WITH NOTES
- This Gate: Phase 0 결함 목록 소진 + `npm run verify` green. **landing은 미완 — 병합은 user 권한**

#### DIRECTION CHECK
- Product source checked: `docs/PRODUCT_V3.md` §3.1(원본이 주인공) · §3.6(불안 금지) · §8 · §13 — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 결함 마감이며 사업 범위·BM 무변경
- Engineering source checked: `docs/ENGINEERING_ROADMAP.md`, `AGENTS.md` — YES
- Current-state checked: `docs/CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 2026-08-19 · 2026-08-20 항목 — YES
- MASTER PLAN version / 기준일: `PRODUCT_STRATEGY_REDESIGN_2026-08-21` (Fable, 사용자 승인)
- Does this task conflict with canonical direction? NO

#### OWNERSHIP
- Tool: Claude Code
- Model: Opus 5
- Role: implementation owner. **independent review 없음** — 이 세션의 모든 검증은 작성자 본인이 했다
- PR: 신규 (아래 STOPPED AT)
- Branch: `claude/phase0-defect-closure`
- Base SHA: `9b0d4b3` (= PR #74 head, 승인된 landing 계보)
- Old HEAD: `27b2384`
- New HEAD: 아래 STOPPED AT

#### CHANGED / REVIEWED
- `src/lib/records.ts` · `records.test.ts` · `RecordPage.test.tsx` — 영상·음성 gate가 남긴 stale
  spec 6개가 실패 중이었다. 새 계약으로 교체하고 `MEDIA_POLICY_REFUSAL`을 export해 "정책 거부"와
  "읽을 수 없는 형식"이 한 문장으로 합쳐지지 못하게 고정했다. 크기 검사보다 정책 검사가 먼저이므로
  작은 영상도 큰 영상과 동일하게 거부됨을 assert한다.
- `RecordMoodSection.tsx` · `RecordPage.tsx` · `RecordEmotionCorrection.tsx` **삭제** — S6.
  두 번째 편집기의 존재 이유(근거 문구 표시)가 코드에서 거짓임을 먼저 확인했다
  (`emotionCandidates.ts:246` — `evidence: ''`, "the phrase was never saved"). 유일한 고유 기능인
  항목 제거를 `RecordMoodSection`으로 옮긴 뒤 제거했다. sequence 연속 재번호와 미확인 추정치
  비승격이 핵심이며 둘 다 mutation으로 검증했다.
- `AttachmentMedia.tsx` + test **삭제**, `src/lib/useMediaAttachment.test.tsx` **신규** —
  삭제 전에 발견한 함정: 이 죽은 컴포넌트의 suite가 `useMediaAttachment`의 **유일한** 커버리지였고,
  그 훅은 live 컴포넌트 3곳(`RecordMediaGallery`·`MediaArchiveGrid`·`MonthGrid`)이 쓴다. 예정대로
  지웠다면 서명 URL 복구 로직의 증명이 조용히 사라졌을 것이다. 훅으로 먼저 이관한 뒤 삭제했다.
- `CycleTrackerSection.tsx` — 마이 탭 동의 카드 재구성. PIPA §23 고지 4항목과 거부권 문장은 전부
  유지하고 순서·비중만 뒤집었다(제안 먼저, 고지 다음). 순서 회귀와 항목 누락을 각각 테스트가 잡는다.
- `RecordPage.tsx` — `EmotionFlowSummarySection`을 타임라인 **아래**로 이동(§3.1 위반 해소).
  빈 하루 empty state가 공간을 차지하도록 변경(약 420px 공백 해소).
- `monthTexture.ts` · `UsPage.tsx` — 건너뛴 달의 조용한 표시(`조용히 지나간 N개월`). 연도 경계에서
  음수가 나오지 않도록 순수 함수로 분리했다.
- `e2e/phase0Layout.spec.ts` **신규** — 위 레이아웃 결함 3건의 실브라우저 기하 검증.
- `.gitignore` — `ui-audit-results/` 제외.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음. key hierarchy · device trust · recovery authority · write floor 미접촉.
- DB/migration semantics: 없음. SQL 파일 한 줄도 바뀌지 않았다.
- product semantics: 탭 구조 · funnel · surface 이름 무변경. chat 없음. P6 없음.
- Production / remote Supabase: **미접촉, 조회조차 하지 않음.**

#### VERIFICATION
- `npm run verify` — **PASS (EXIT=0)**. 172 files / 2633 tests. 세션 시작 시 baseline은
  172 files / 2617 tests 중 **6 failing**이었고(직전 commit `27b2384`가 남긴 stale spec), 그것을
  가장 먼저 닫았다.
- `npm run typecheck` · `npm run lint` — PASS.
- mutation 검증(적용 → 실패 확인 → 복원): 감정 항목 제거의 재번호·비승격 2건, 훅의 loop guard ·
  unchanged-URL · coupleId guard · upstream-supersedes 4건, 동의 카드의 순서 · 필수 고지 2건.
  **총 8건 전부 의도한 테스트만 실패시켰다.** `disabled` 내부 guard 1건은 mutation이 통과했다 —
  버튼이 DOM `disabled`라 핸들러가 애초에 실행되지 않기 때문이며, 테스트는 사용자에게 보이는
  계약(버튼 비활성 + 쓰기 없음)을 지킨다.
- **로컬 브라우저: UNVERIFIED.** 이 기기에 headed Chromium은 있으나 headless shell이 없고
  headed 바이너리는 실행 시 SIGABRT로 죽는다. 2026-08-19 기록과 동일한 제약이며 코드 결함이 아니다.
  `e2e/phase0Layout.spec.ts`의 3개 assertion은 **CI가 authority**다.
- **CI: 이 HEAD에서 아직 실행되지 않음.** PR 생성 후에만 돈다.
- remote Supabase / production / 실기기: **UNVERIFIED, 미접촉.**

#### REVIEW IMPACT
- FULL. 이 branch는 review된 적이 없다.

#### BLOCKERS
- code: 없음.
- environment: 로컬 Playwright 실행 불가(headless shell 부재 + headed SIGABRT).
- external/manual: **PR 병합은 user 권한이다.** `.claude/hooks/block-dangerous-bash.sh`가 해당
  명령들을 결정적으로 차단한다("master merge and PR merge are reserved for the user").
  #74 → #75 → #76 순서로 사용자가 직접 병합해야 Phase 0이 landing된다.

#### STOPPED AT
- Phase 0 결함 목록은 소진했고 `npm run verify`는 green이다. **master는 아직 `21e7dfb`에 그대로 있다.**

#### REMAINING
- 미해결로 남긴 것 하나: **빈 홈 화면의 약 390px 공백**(`30-home-empty` 스크린샷). 기록 탭 쪽은
  단일 메시지 아래 공백이라 고쳤지만, 홈의 공백은 위젯이 적어서 생기는 **구조적 희소함**이다.
  내용을 만들어 채우는 것은 2026-08-20에 되돌린 "대화형 홈"이 정확히 그 이유로 실패한 방향이므로
  하지 않았다. 디자인 결정 + 육안 확인이 필요한 항목으로 남긴다.
- `Lightbox 레이어링`은 **현재 트리에서 결함이 아니다.** Astryx `Lightbox`는 `dialog.showModal()`을
  쓰므로 브라우저 top layer로 올라가고, 어떤 z-index stacking context보다 위에 그려진다. 조사만 하고
  코드는 바꾸지 않았다.

#### NEXT ACTION
- next owner: 사용자(병합), 그다음 independent review
- exact next task: 이 branch CI green 확인 → #74 landing → 이 branch retarget → Phase 1 Gate 4(통화 모드)

#### DO NOT ADVANCE UNTIL
- 이 HEAD가 base `master` PR에서 실제 CI를 통과할 때까지. stacked base에서는 어떤 workflow도 돌지 않는다.

#### PRODUCTION
- NOT APPLIED


### 2026-08-21 · Phase 1 — Gate 4 통화 모드 + Gate 3 push의 서버 절반

Phase 0(같은 날 앞 항목)을 잇는다. 앞 항목의 HEAD는 이미 낡았다.

#### PLAN POSITION
- Phase: Phase 1 — 루프의 물리적 완결 (`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` §8)
- Workstream: Gate 4 통화 모드(완료) · Gate 3 push(서버 절반 완료, 클라이언트 미착수)
- Step: 루프의 마지막 화살표 → 첫 화살표의 DB·발송자
- Previous Gate: Phase 0 PR #77 CI 14/14 green
- This Gate: PR #78 CI 14/14 green. Gate 3는 migration + Edge Function까지

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §8 통화 모드(2026-08-21 개정) · §14.3 알림 정책 · §19 계측 허용목록 — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE — 수익화·시장 무관
- Engineering source checked: `ENGINEERING_ROADMAP`, `AGENTS.md`, `docs/skills/migration-gate.md`, `docs/skills/security-review.md` — YES
- Current-state checked: `CURRENT_STATE.md` — YES
- Latest relevant Work Log checked: 같은 날 Phase 0 항목 — YES
- MASTER PLAN version / 기준일: Fable 전략 2026-08-21 (사용자 승인)
- Does this task conflict with canonical direction? NO

#### OWNERSHIP
- Tool: Claude Code / Model: Opus 5
- Role: implementation owner. **independent review 없음**
- PR: #78 (Gate 4), Gate 3는 아래 STOPPED AT
- Branch: `claude/phase1-call-mode-v2` → `claude/phase1-gate3-push`

#### CHANGED / REVIEWED

**Gate 4 — 통화 모드 (PR #78, CI 14/14 green)**
- `src/pages/CallModePage.tsx` 신규 + 라우트 `/call` + `TalkAboutListWidget` 진입점.
- §8 개정판의 금지 세 가지를 구조로 고정했다: 전화 걸지 않음(`tel:` 없음) · 통화 관련 기록 0 ·
  `다음`은 쓰기 없는 건너뛰기. 끝까지 건너뛰면 **완료 화면에 도달하지 않는다** — 전부 미완인데
  완료했다고 말하는 것은 앱이 관찰할 수 없는 대화에 대해 거짓을 주장하는 것이다(§3.2).
- 각 `이야기했어요`는 독립 쓰기다. 통화는 갑자기 끊기므로 마지막에 일괄 저장하면 가장 흔한
  종료 방식이 세션 전체를 버린다.
- 가장 미묘한 부분: **완료가 인덱스를 전진시키지 않는다.** 항목이 목록에서 빠지므로 같은 위치가
  이미 다음을 가리킨다. 함께 전진시키면 아무도 못 본 항목을 건너뛴다.

**Gate 3 — push의 서버 절반**
- `supabase/migrations/048_push_delivery_metadata.sql` 신규.
- **승인된 계획을 하나 뒤집었다.** 전략은 `couple_members.has_unseen`을 지정했으나, 001의 SELECT
  정책이 활성 파트너에게 상대 행 전부를 보여준다. 그 자리의 `has_unseen`은 "아직 안 열어봤다"이고
  이는 **읽음 표시**다 — §14.3이 절대 금지한다. RLS는 row 단위라 컬럼 하나만 가릴 수 없다.
  전용 테이블 `push_delivery_state`로 옮겨 파트너에게 **읽을 정책 자체가 없게** 했다.
- **가장 중요한 한 줄:** 비공개 기록은 아무 플래그도 올리지 않는다. `나만 보기` 기록으로 알림이
  가면 그 설정이 숨기려던 단 하나의 사실 — 무언가 쓰였다는 것 — 이 샌다.
- 보안 리뷰에서 **기기 이양 결함**을 찾아 고쳤다. APNs·FCM은 재설치·기기 이양 시 같은 토큰을
  넘겨주는데, 평범한 INSERT는 UNIQUE에 걸려 새 계정이 알림을 못 받고 **떠난 계정이 그 기기
  알림을 계속 받는다**(§14.3 위반). `register_push_token()`이 기존 소유자 행을 먼저 지운다.
- 발송자는 `service_role`만 호출 가능하며 029와 같은 in-body gate를 둔다. 하루 1회 상한과 연락
  가능 시간은 발송자가 아니라 **DB가** 강제하므로 Edge Function을 다시 써도 두 번 보내거나
  새벽에 보낼 수 없다.
- `supabase/functions/send-push/` 신규 — 순수 `handler.ts` + 얇은 `index.ts`. 문구는 상수 import이며
  `deliver`의 인자가 아니다. 이벤트 종류별 문구가 들어갈 자리가 코드에 없다.
- **실패한 전송은 전달된 것으로 처리하지 않는다.** 시도 시점에 표시하면 네트워크 1분 장애가
  "이 사람은 들었다"가 되고 하루 상한 때문에 내일까지 못 듣는다.

#### EXPLICITLY NOT CHANGED
- crypto semantics: 없음. key hierarchy · device trust · write floor 미접촉.
- `disconnect_couple`은 재작성했으나 crypto pairing 전이와 멤버십 전이는 **한 글자도 바뀌지 않았다**.
  p5 · write-floor · rollback harness 전부 통과가 그 증거다.
- product semantics: 탭 구조 무변경. chat 없음. P6 없음.
- Production / remote Supabase: **미접촉, 조회조차 하지 않음.**

#### VERIFICATION
- `npm run verify` — PASS (EXIT=0).
- **실제 PostgreSQL 17.10**: fresh chain 001→048(45개) 적용, phase0 harness **161 assertions**
  (048이 37개). `test:p5` 93 · `test:write-floor` 39 · `test:rollback` PASS.
- **mutation 6건 전부 실패 확인**(적용 → 실패 관찰 → 복원): 비공개 누출 · 하루 1회 상한 ·
  연락 가능 시간 · NULL actor · 기기 이양 · service_role in-body gate.
  **1건은 통과했고 그 이유를 주석에 남겼다** — 플랫폼 검증은 테이블 CHECK가 이미 막으므로
  함수 쪽은 에러 메시지용이다.
- Gate 4: 14 + 3 specs, mutation 5건 전부 실패 확인. FCM OAuth 인코딩 10 specs, mutation 3건 확인(base64url 치환·이스케이프 개행·`aud` 오지정). **테스트 1개는 mutation이 살아남아 다시 썼다** —
  store를 stub하면 성공/실패가 화면상 구별되지 않아 vacuous했다.
- **Deno: 로컬 실행됨.** 세션 중 CI가 `npm:google-auth-library` 미해석으로 실패하는 것을 잡았고
  (Deno는 npm specifier를 node_modules에서 찾는데 이 저장소에 없다), 그 의존성을 package.json에
  추가하는 것은 **잘못된 해법**이라 판단했다 — 브라우저 번들의 의존성 그래프에 서버 전용 Google
  SDK가 들어가고, 이 저장소는 외부 SDK 0을 지킨다. Web Crypto로 직접 구현하고 인코딩 헬퍼를
  분리해 테스트했다. 그리고 **deno를 로컬에 설치**해 이제 `check:edge`가 여기서 돈다 —
  13개 edge 모듈 전부 통과.
- **브라우저: 로컬 미실행.** headless shell 부재 + headed SIGABRT. CI가 authority.
- **실제 알림 전달: UNVERIFIED.** APNs/FCM 자격증명과 실기기가 필요하며 둘 다 외부 게이트다.

#### REVIEW IMPACT
- FULL. Gate 3는 review된 적이 없다. Gate 4도 마찬가지다.

#### BLOCKERS
- code: 없음.
- environment: 로컬 브라우저 없음(headless shell 부재 + headed SIGABRT). Android SDK 없음(JVM 테스트는 CI가 authority). **Deno는 이제 있다.**
- external/manual: **PR 병합은 user 권한** · APNs/FCM 자격증명 · 실기기 2대 · 원격 Supabase 적용.

#### STOPPED AT
- Gate 3의 서버 절반과 **클라이언트 절반 모두**. 앞서 "실기기 없이 검증 불가"로 판단해 미착수로
  두었던 것을 **재검토해 뒤집었다** — 토큰 lifecycle은 이 저장소가 다른 모든 클라이언트 동작을
  검증하는 방식 그대로 검증 가능하고, §14.3이 명시적으로 negative test를 요구하는 부분이다.
  실기기가 필요한 것은 **실제 전달뿐**이다.
- `@capacitor/push-notifications@7.0.7` 설치, `cap sync android` 완료, Podfile/Podfile.lock 갱신.
- **iOS `pod install`은 실패했다** — 이 기기에 Xcode가 없고 Command Line Tools만 있다.
  Podfile.lock은 SPEC/PODFILE checksum 모두 일관되게 갱신됐으므로(CocoaPods가 해결까지는 마쳤고
  실패는 이후 Xcode 프로젝트 통합 단계) 커밋은 안전하다. 실제 iOS 빌드는 CI가 authority.
- **`aps-environment` entitlement는 의도적으로 추가하지 않았다.** 서명과 분리 불가능하며 Apple
  Developer portal에서 실제 자격증명으로 capability를 켜야 한다. 프로파일 없이 키만 넣으면
  기기 서명이 실패하고, 시뮬레이터 빌드는 entitlement를 무시하므로 CI도 그 불일치를 못 잡는다.
  TestFlight 설정 시 portal capability와 **함께** 추가해야 한다 — entitlements 파일에 명시했다.

#### REMAINING
- S4 대기 구간 · 최소 계측 · LV 환경 · TestFlight.
- 연결 직후 권한 요청은 **이 세션에서 닫았다.** 처음에는 호출자 0인 채로 두었는데, 그것이 바로
  security-review §1이 이 저장소의 최빈 결함으로 지목하는 "미연결 구현"이라 그대로 둘 수 없었다.
  `coupleLifecycle`이 `connected`가 될 때 등록한다 — 파트너 합류를 감지하는 폴링 지점에 걸지
  않은 이유는 그 폴링이 **초대한 쪽 기기에서, 합류가 일어난 그 한 번만** 돌기 때문이다.
  거기 걸었다면 합류한 쪽은 영원히 미등록이고 초대한 쪽도 재설치 후 미등록이 된다.
  함수에 호출자가 없으면 그 함수에 대한 모든 테스트가 통과하므로, 소스에서 호출자를 세는
  테스트를 따로 뒀다.
- `briefings` drop: **파괴적 변경이라 착수하지 않았다.** migration-gate §4가 명시적 승인을 요구한다.

#### NEXT ACTION
- next owner: 사용자(병합 결정), 그다음 independent review
- exact next task: #74 → #75 → #76 → #77 → #78 순서 병합 → Gate 3 PR 검토 → 클라이언트 절반

#### DO NOT ADVANCE UNTIL
- 048이 independent security review를 통과할 때까지. 원격 적용은 그 이후에도 별도 게이트다.

#### PRODUCTION
- NOT APPLIED


### 2026-08-21 · Phase 1 — S4 대기 구간의 자동 노출 결함 (§7.6)

같은 날 앞 항목들을 잇는다.

#### PLAN POSITION
- Phase: Phase 1 (`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` §8)
- Workstream: ⟨대기⟩ 구간 (S4) — §7.6 연결 전 기록의 사후 공유
- Previous Gate: Gate 3 양쪽 절반 완료, PR #79 CI 14/14 green
- This Gate: 자동 노출 결함을 닫음. §7.6의 "묻기"는 미완

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §7.6(2026-08-21 신설) · §13 · §14.2 — YES
- Business source checked / NOT APPLICABLE: NOT APPLICABLE
- Engineering source checked: `ENGINEERING_ROADMAP`, `AGENTS.md` — YES
- Current-state checked: YES / Latest Work Log checked: YES
- Does this task conflict with canonical direction? NO

#### CHANGED / REVIEWED
- `src/components/widgets/TodayLogWidget.tsx` — 파트너가 없으면
  (1) 공개/비공개 토글을 감추고 사실을 문장으로 말하며,
  (2) **저장 자체를 비공개로 강제하고**,
  (3) 성공 토스트가 "전했어요"라고 거짓말하지 않는다.
- `src/features/home/waitingPeriodPrivacy.test.tsx` 신규 — 6 specs.

#### 왜 이것이 결함이었나
기록의 기본 공개 범위는 **공유**다. 커플 공간은 초대 코드를 만든 순간 존재하므로,
파트너가 합류하기 며칠 전부터 기록이 그 공간에 쌓인다. 그 기록들은 누군가 합류하는
**순간 전부 읽을 수 있게 된다.** §7.6이 이름을 붙여 금지하는 바로 그 자동 노출이며,
"아무도 읽을 수 없던 날 공유하기를 눌렀다"는 것은 §7.6이 요구하는 명시적 노출 행위가 아니다.

UI에서 토글을 감추는 것만으로는 부족하다 — 그건 문구이고, 저장되는 값이 계약이다.
연결 상태에서 쓴 draft가 연결 해제 후 저장되면 `isPrivate: false`를 그대로 들고 간다.
mutation 검증에서 "UI만 숨기고 쓰기는 그대로" 변형이 정확히 잡히는 것이 그 증거다.

#### EXPLICITLY NOT CHANGED
- crypto · migration · Production: 미접촉.
- 이미 저장된 기존 기록: 건드리지 않았다. 이 변경은 앞으로의 쓰기에만 적용된다.

#### VERIFICATION
- 6 specs, mutation 3건 전부 실패 확인(쓰기 강제 제거 · 대기 중 토글 노출 · 연결 후에도 강제 비공개).
- `npm run verify` — PASS (EXIT=0).
- **첫 실행은 EXIT=1이었고 그 이유를 남긴다.** 테스트 6개가 전부 "통과"했는데도 verify가 실패했다.
  내 mock이 `addRecordWithMedia`의 성공 형태를 `{ ok: true }`로만 만들었는데 실제로는
  `failedFiles`도 반환하고, `runPost`가 저장 직후 `result.failedFiles.length`를 읽는다.
  각 테스트가 **assertion을 마친 뒤에** unhandled rejection이 났으므로 스위트는 초록이고
  프로세스는 실패했다. 부분 mock이 통과하는 테스트를 만든 사례이며, verify를 돌리지 않았다면
  CI에서야 드러났을 것이다.

#### REMAINING — §7.6의 나머지 절반
- **"연결 전에 남긴 기록을 보여줄까요?" 질문은 아직 없다.** 지금은 대기 중 기록이 비공개로
  남고 사용자가 기록 상세에서 개별 전환할 수 있을 뿐이다. 노출은 여전히 명시적 행위이므로
  §7.6의 프라이버시 규칙은 지켜지지만, 명세가 요구하는 **한 번 묻기**는 빠져 있다.
- **"막혀 있다"고 적었던 앞선 판단을 정정한다.** 파트너 합류 시각이 필요한데 조회 경로가
  없다고 썼으나, 확인해 보니 `couple_members.joined_at`은 이미 존재하고 001의 SELECT 정책이
  활성 파트너에게 그 행을 읽게 한다. harness에 실측 assertion을 추가해 확인했다
  (`§7.6 an active member CAN read the partner's joined_at`). **새 SQL은 필요 없다.**
- 실제로 남은 설계 문제는 다른 것이다: §7.6은 "**한 번** 묻는다"고 명시하는데, 그 "한 번"을
  기억할 상태가 없다. 후보(합류 이전 본인 비공개 기록)는 사용자가 아무것도 고르지 않으면
  그대로 남으므로 다음 실행에서 또 후보가 된다. device-local 플래그로 풀 수 있지만
  `saveState`의 whitelist를 넓혀야 하고, 그 목록은 **계정 삭제 후 잔존을 막으려고** 테스트로
  정확히 고정돼 있다. 넓히는 것은 별도 판단이다.
- 또 하나: 후보 집합은 "의도적으로 비공개로 남긴 기록"과 "대기 중이라 비공개가 된 기록"을
  구별하지 못한다. §7.6이 요구하는 것은 명시적 선택이므로 둘 다 보여주고 고르게 하는 것이
  안전한 방향이지만, 문구가 그 사실을 정확히 말해야 한다.
- 양 역할 `ContactPreferences`는 **이 세션에서 닫았다.** 곰신은 복무 정보와 연락 시간을
  **둘 다** 건너뛰고 있었다. 알림이 없던 동안에는 무해했지만 migration 048과 함께 무해하지
  않게 됐다 — 발송은 **각 수신자 본인이 선언한 시간창 안에서** 일어나므로(§14.3: 전송 시각은
  사용자가 직접 입력한 시간만 쓴다), 한 번도 묻지 않은 곰신은 **군인의 하루를 전제로 쓰인
  스키마 기본값**을 물려받았을 것이다. 이제 곰신은 5단계이고 복무 정보만 건너뛴다.
- 문구는 역할별로 다르다. 같은 값을 저장하지만 묻는 것이 다르기 때문이다 — 군화에게는
  제약(폰이 닿는 시간)이고, 곰신에게는 선호(앱이 방해해도 되는 시간)다.

#### PRODUCTION
- NOT APPLIED


### 2026-08-21 · Phase 1 — §19 최소 계측 (LV 진입 조건)

#### PLAN POSITION
- Phase: Phase 1 (`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` §8, 리텐션 루프 ⑥)
- Workstream: 최소 계측 — `ENGINEERING_ROADMAP`이 2026-08-21에 LV 진입 조건으로 추가한 항목
- This Gate: migration 049 + 클라이언트 emitter + 네 지점 연결

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §19 허용/금지 표와 그 아래 네 원칙 — YES
- Engineering source checked: `ENGINEERING_ROADMAP` LV 진입 조건(2026-08-21 추가) — YES
- Does this task conflict with canonical direction? NO

#### CHANGED / REVIEWED
- `supabase/migrations/049_product_events.sql` 신규
- `src/lib/productEvents.ts` + test 신규 (16 specs)
- 연결: 컴포저 `record_composed` · 통화 모드 `call_mode_opened`/`talk_about_resolved` ·
  이야기거리 목록 `talk_about_resolved` · store `couple_connected`

#### 설계의 핵심 — 금지 항목이 들어갈 자리를 없앤다
계측 계층은 이 제품에서 **거부하기로 한 것을 가장 쉽게 만들 수 있는 자리**다. 그래서 목표를
"조심히 수집한다"가 아니라 "금지된 컬럼이 갈 곳이 없다"로 잡았다.

- **이 테이블에는 timestamp 컬럼이 아예 없다.** `occurred_on DATE`뿐이다. 다른 모든 테이블이
  갖는 `created_at TIMESTAMPTZ DEFAULT now()`를 여기 두면 누가 언제 앱을 여는지의 분 단위
  기록이 되고, 그게 §19가 금지하는 행동 감시다. **리뷰에서 아무도 의심하지 않을 기본값으로
  도착한다**는 점이 가장 위험하다. mutation으로 그 컬럼을 추가하면 harness가 실패한다.
- `kind`·`screen`은 CHECK 제약의 닫힌 집합. 이벤트 추가는 migration이고 곧 리뷰다.
- `subject_id`는 UUID. 기록 id는 들어가고 기록의 첫 줄은 못 들어간다.
- 파트너에게 **read 정책이 아예 없다.** §19는 건강 도메인에서 불리언조차 파트너 축 집계를
  금지하는데, 이 테이블은 건강 종류가 없고 파트너 read도 없어 더 강한 형태로 같은 규칙을 만족한다.
- UPDATE·DELETE 정책이 없다. 이벤트는 사실이고, 세션이 탈취돼도 자기 활동 기록을 고쳐 쓸 수 없다.

**의도적으로 없는 것:** session/dwell 이벤트(체류시간은 §19가 이름으로 금지) · 기록 개수 ·
연속 사용일수(§19가 성공 지표로 금지, §16의 불안 엔진) · read/seen 이벤트(반대편에서 본
읽음 표시) · 감정 종류(§19가 라벨과 개수를 함께 금지).

#### VERIFICATION
- 실제 PostgreSQL 17.10: fresh chain 001→049, phase0 harness **180 assertions**(049가 19개).
- mutation 4건 전부 실패 확인: `created_at` 추가 · 자유 텍스트 컬럼 · 파트너 read 허용 ·
  금지 이벤트 종류 추가.
- 클라이언트 16 specs, mutation 2건 확인(계측 미연결 · 절대 시각 전송).
- 연결 검증은 **호출자를 센다** — emitter에 호출자가 없으면 emitter에 대한 모든 테스트가
  통과하기 때문이다. LV 조건은 "계측이 존재한다"가 아니라 "이벤트가 착지한다"이다.

#### REMAINING
- **선언된 8종 전부에 emit 지점이 생겼다.** 처음엔 4종만 연결하고 나머지를 남기려 했으나,
  선언만 되고 emit되지 않는 종류는 LV 리드아웃 시점에 빈 칸으로 드러나고 그때는 늦다.
  테스트가 union을 파싱해 **모든 종류에 호출자가 있는지** 검사한다.
  - `briefing_opened`는 분모다. `briefing_to_original`만으로는 개수일 뿐이고, 나누어야
    전략이 실제로 묻는 "요약→원본 이동률"이 된다. 브리핑에 내용이 있을 때만 mount당 한 번
    발생한다 — 빈 위젯은 전환에 실패한 브리핑이 아니므로 세면 비율이 왜곡된다.
  - `notifications_disabled`는 **kill metric**이며 OFF 전이에서만 발생한다. 다시 켜는 것은
    신호가 아니고, 둘 다 세면 이 이벤트가 만들려는 단 하나의 판독이 흐려진다.
- 이벤트 조회·집계 도구는 여전히 없다. LV 리드아웃 시점에 필요하다.

#### PRODUCTION
- NOT APPLIED


### 2026-08-21 · Phase 1 마감 — §7.6 사후 공개 · 양 역할 알림 시간 · §19 판독

Codex의 전수 감사 직전 상태다. **안전하게 구현 가능한 로드맵 항목을 모두 소진했다.**

#### PLAN POSITION
- Phase: Phase 1 (`PRODUCT_STRATEGY_REDESIGN_2026-08-21.md` §8) — 내부 구현 경계까지
- This Gate: 세 항목 완료. 남은 것은 전부 외부 게이트이거나 사용자 승인 대기

#### DIRECTION CHECK
- Product source checked: `PRODUCT_V3` §7.6 · §13 · §14.2 · §14.3 · §19 — YES
- Engineering source checked: `ENGINEERING_ROADMAP` LV 진입 조건, `docs/skills/migration-gate.md` — YES
- Does this task conflict with canonical direction? NO

#### 1. §7.6 — 연결 전 기록의 사후 공개
- `src/lib/waitingPeriodReveal.ts` (순수) + `WaitingPeriodRevealCard.tsx` + `coupleTimeline.ts`
- **"한 번"을 저장하지 않는다.** 그것이 이 설계의 핵심이다. "물었음"을 기억하려면 새 영속 사실이
  필요하고, device-preference whitelist는 **계정 삭제 후 잔존을 막으려고** 테스트로 고정돼 있다.
  대신 `couple_members.joined_at`(001부터 canonical, 활성 멤버가 파트너 행을 읽을 수 있음)에서
  **창(7일)** 을 계산한다. 아무것도 쓰지 않고 "한 번"이 성립한다.
- 창이 지나도 기록은 그대로 비공개이며 기록 상세에서 개별 전환할 수 있다. 창은 **묻지 않은 질문**을
  제한하는 것이지 답할 권리를 제한하지 않는다.
- 자동 공개는 어떤 경로로도 없다. 카드를 닫든, 무시하든, 못 보든 전부 그대로 비공개다.
- 부분 실패를 부분 실패로 보고한다. 5개 중 2개가 실패하면 3개는 **이미 파트너에게 보인다** —
  일괄 실패로 보고하면 공개된 기록을 비공개로 믿게 되고, 그게 §7.6이 막으려는 오류가
  막으려는 장치를 통해 발생하는 것이다.

#### 2. 양 역할 알림 시간
- `ContactHoursSection.tsx` 신규. 설정에서 **양 역할 모두 편집 가능**.
- 이전에는 군화 전용 + 읽기 전용 + 설명이 "브리핑 추천에 반영"이었다. 048 이후 셋 중 둘이 틀렸다 —
  이 값이 **각자의 알림 발송 시간**을 정한다.
- 끝이 시작보다 이르면 저장 전에 거부한다. DB는 받아들이고 `push_delivery_candidates`가 영영
  매치하지 않아 **화면에 아무 설명 없이 알림이 끊긴다.**
- 주말 시간도 표시한다. 저장되고 사용되는데 보이지 않았다.

#### 3. §19 판독 — migration 050
현재 파이프가 LV 퍼널을 측정하기에 **충분하지 않았다.** 두 격차:
- **측정 단위 부재.** 전략은 획득 단위가 "연결된 커플 1쌍"이라고 못박는데 `product_events`에는
  `user_id`만 있었다. 한 커플의 두 사람과 남남 두 사람이 구별되지 않아 커플 단위 지표 2개를
  아예 계산할 수 없었다. `couple_id`를 `get_my_active_couple_id()` DEFAULT로 추가했다 —
  세션에서 파생되므로 클라이언트가 위조할 수 없다. **파트너 축은 생기지 않는다**: RLS 범위 불변,
  파트너 read 정책 여전히 없음, 커플로 묶을 수 있는 것은 숫자만 반환하는 집계 함수뿐이다.
- **판독이 곧 행 조회.** 함수가 없으면 `service_role`이 raw 행을 긁고, 그건 한 사람의 개별 행동을
  순서대로 보는 것이다 — §19가 금지하는 형태가 "숫자가 필요하다"는 뒷문으로 도착한다.
  `lv_funnel_readout`은 `(metric, value)`만 반환하며 행 반환 경로가 없다.
  `lv_couple_return_count`는 **몇 커플이** 돌아왔는지를 주고 어느 커플인지는 주지 않는다.
- 의도적으로 없는 것: 일별 시계열(5쌍 코호트의 일별 카운트는 행동 타임라인이다) · 사용자별 분해 ·
  커플 간 순위 · 건강/감정/콘텐츠/시각.

#### EXPLICITLY NOT CHANGED
- crypto · write floor · Production · remote Supabase: 미접촉.
- `briefings` drop: **하지 않았다.** 파괴적 변경이며 migration-gate §4의 명시적 승인이 필요하다.

#### VERIFICATION
- 실제 PostgreSQL 17.10: fresh chain 001→050(47개), phase0 harness **197 assertions**(050이 16개).
- `test:p5` 93 · `test:write-floor` 39 · `test:rollback` PASS.
- mutation: 050에서 5건(클라이언트 위조 couple_id · service_role gate · 커플 대신 계정 집계 ·
  재방문이 커플 id 반환 · 역순 범위 허용) 전부 실패 확인. §7.6에서 5건, ContactHours 포함 총 10건+.
- `npm run verify` — 아래 STOPPED AT.
- **같은 실수를 세 번 했다.** 테스트 헬퍼의 기본 매개변수가 명시적 `undefined`를 삼켜
  "값이 없을 때" 케이스가 아무것도 검증하지 않았다(`useMediaAttachment` · `waitingPeriodReveal` ·
  `waitingPeriodRevealCard`). 첫 파일의 원래 suite에 이미 경고 주석이 있었다. 셋 다 고쳤다.
- **`verify`가 결함 하나를 더 잡았다.** 테스트 2778개가 전부 통과했는데 EXIT=1이었다 —
  `fetchPartnerJoinedAt`이 `{ error }`는 처리하면서 **throw는 처리하지 않았다.** 이 함수는
  `useEffect` 안에서 불리므로 rejection이 곧 unhandled rejection이다. `recordProductEvent`는
  이미 그 형태를 갖고 있었는데 이건 아니었다. **부가 조회가 앱을 깨뜨릴 수 있으면 안 된다** —
  이 조회가 실패하면 §7.6 프롬프트가 안 뜰 뿐이고, 프롬프트는 스스로 아무것도 공개하지 않으므로
  안 뜨는 쪽이 항상 보수적이다. try/catch를 넣고 6개 spec으로 고정했다.

#### REMAINING — 전부 외부 게이트이거나 승인 대기
- PR 병합(user) · APNs/FCM 자격증명 · `aps-environment` entitlement · 실기기 2대 ·
  iOS `pod install`(Xcode 부재) · LV 전용 Supabase 환경 · `briefings` drop 승인 ·
  §14.5 문장 대조 · **independent review 전무**

#### PRODUCTION
- NOT APPLIED. 048 · 049 · 050 모두 어느 원격에도 적용되지 않았고 조회조차 하지 않았다.


### 2026-08-21 · 저자 측 전수 감사 — 결합 트리 (#74→#79)

Codex 독립 감사 직전의 마지막 저자 패스다. **새 기능 없음. 투기적 리팩터 없음.**

#### PLAN POSITION
- Phase: 감사·최적화 (제품 설계 단계 아님)
- 감사 대상: **결합 트리** — #79 단독이 아니라 #74→#75→#76→#77→#78→#79를 합친 상태
- 방법: PR 병합 없이 로컬 scratch 브랜치 `audit/combined-scratch`에 #75·#76을 cherry-pick

#### 필수 첫 검사 — 001→047→048→049→050
**PASS.** 48개 migration이 빈 PostgreSQL 17.10에 순서대로 적용되고 **205 assertions** 통과.
이 결합 체인은 이 감사 전까지 **한 번도 실행된 적이 없었다.** 릴리스 블로커 아님.

> 이 실행은 `audit/combined-scratch` 브랜치(`d5471f3`)에서 했다. 047은 PR #76이 소유하므로
> **이 브랜치(#79)에는 없고**, 여기서는 47개 / 197 assertions가 정상이다. 결합 전용 산출물
> (harness의 047 ORDER 항목과 8개 assertion, 원장의 047 행, CURRENT_STATE의 #75 정정)은
> scratch 브랜치에 있으며 landing 후 적용된다.

#### 결합 과정에서 드러난 것 — 문서 충돌 2건
cherry-pick이 실제 landing에서도 발생할 충돌을 미리 드러냈다.
- `docs/CURRENT_STATE.md`: #75의 convergence checkpoint와 #79의 LV 조건표가 같은 자리를 놓고
  충돌. 둘 다 유지하는 것이 맞고, 해결본을 결합 트리에 반영했다.
- `supabase/migrations/README.md` · `storage-authz-harness.mjs`: 047 행/ORDER 항목이 048~050과
  충돌. **번호 순서(047 → 048)로 해결**하는 것이 유일하게 옳다.

#### 발견하고 고친 결함

1. **047의 DB 계약이 검증되지 않았다.** 047은 harness 체인에 "적용된다"만 확인됐고, CHECK 어휘가
   무엇을 받고 무엇을 거부하는지는 실제 DB에서 검증된 적이 없었다. 결합 트리에서는 048~050이
   **047 뒤에 처음 실행**되므로, 후속 migration이 그 제약을 재정의했어도 아무도 몰랐을 것이다.
   8개 assertion 추가. 그 과정에서 014의 workspace 트리거도 함께 건넜다 — 어휘 검사만이
   이 테이블 앞을 지키는 것이 아니다.

2. **푸시 리스너·타이머 누수.** `setUpPushNotifications`는 연결 전이마다 실행되는데
   `registration`/`registrationError` 리스너와 10초 타이머를 정리하지 않았다. 이미 settled된
   promise를 위한 네이티브 브리지 핸들이 재연결·재실행마다 쌓인다.

3. **`listenForPushTaps`의 호출자가 0이었다.** 알림을 탭해도 아무 일도 일어나지 않았다.
   "미연결 구현"을 경계한다고 적어놓고 같은 것을 남겼다. `App`에 연결하고 teardown을 반환하게 했다.

4. **§7.6이 연결 상태를 보지 않았다.** 해제 후에도 `partnerJoinedAt`이 남아 있으면 **없는
   파트너에게 보여주자고 제안**하고, 고른 기록은 **재연결 시 다음 사람에게 보인다.** 실제로는
   store가 couple 객체를 재구성하며 그 키를 함께 버리지만 그건 **우연한 방어**다 — 그 재구성에
   필드가 하나 추가되면 조용히 되살아난다. 순수 함수에 `connected`를 필수 인자로 넣었다.

5. **050의 주석이 코드가 보장하지 않는 것을 주장했다.** "일별 시계열 없음"이라고 썼지만 호출자가
   하루짜리 창을 반복 호출하면 만들 수 있다. §19가 날짜 버킷을 허용하므로 위반은 아니지만
   **함수가 막는 것도 아니다.** 주석을 정직하게 고쳤다 — 그 구분은 LV 운영 규율이 진다.

6. **문서 divergence 2건.** #75가 남긴 "push 알림 미구현, §19 계측 미구현"이 결합 트리에서 거짓.
   PR #79 설명이 §7.6과 readout을 "없다"고 서술. 둘 다 정정.

7. **오프라인 일관성.** `ContactHoursSection`만 오프라인 가드가 없어 실패 원인을 정확히 말하지
   못했다. 다른 두 표면과 같은 패턴으로 맞췄다.

8. **중복 제출 가드 일관성.** 같은 컴포넌트만 진입부 가드가 없고 `disabled`에만 의존했다 —
   이 브랜치에서 이미 mutation이 살아남은 적 있는 패턴이다.

9. **dead state 제거.** `authSyncCode`는 진단 코드 화면 표시를 없애면서 소비자가 0이 됐다.
   state·context에서 빼고 실패 지점의 `console.warn`으로 옮겼다 — 정보는 남고 죽은 인터페이스만 사라진다.

10. **§19 kill metric이 권한 거부를 opt-out으로 셌다.** 열 개 중 **유일하게 숫자를 틀리게 만드는**
    결함이다. emit이 preference를 쓰는 함수 안에 있었고 그 함수에는 호출자가 둘이다. 권한 요청이
    denied로 돌아오면 `systemEnabled: false`를 쓰는데, OS 설정에서 나중에 취소된 grant의 `true`가
    저장돼 있었다면 그것이 OFF 전이다. **"허용"을 누른 사람이 opt-out한 사람으로 기록됐다.**
    "설계가 실패했다"를 뜻하는 유일한 지표가 사용자가 알림을 *더* 원한 순간에 올라간다.
    emit을 사람이 실제로 조작하는 토글에 붙였다.

    이 규칙에는 테스트가 있었지만 **소스 문자열 대조**였다. 그런 검사는 코드가 그 표현을
    *포함하기만* 하면 통과하므로 결함이 존재한 내내 초록이었고, 버그가 아니라 **수정에서**
    깨졌다. 실패 방향이 거꾸로다. 렌더·클릭하는 5개 동작 테스트로 옮겼고 mutation 2종
    (emit을 되돌리기, OFF 비교 뒤집기) 모두 실패한다. `productEvents.test.ts`에는 같은 모양이
    더 있다 — 전부 통과하므로 감사 규칙에 따라 두었지만 **인스턴스가 아니라 부류**다.

#### 확인했고 문제 없던 것
- **unhandled rejection 0건, Errors 0건.** 지시된 최우선 클래스가 결합 트리에서 깨끗하다.
- 기본 매개변수 전수 조사: `error = null` 류는 "없음"이 테스트 케이스가 아니라 무해하다.
- tesseract.js는 `await import()`로 lazy-load되며 번들에 없다(전략 §1.4 확인 요구사항).
- 네이티브: Android 권한 3개(INTERNET·ACCESS_NETWORK_STATE·POST_NOTIFICATIONS),
  iOS usage 키는 카메라 하나뿐, 마이크·추적 없음, `NSPrivacyTracking = false`.
- 접근성: 새 표면 전부 44px 터치 타깃과 aria 라벨을 갖췄다.
- React: 새 컴포넌트가 `useMemo`를 쓰고, join 시각 조회는 연결 전이당 1회다.

#### VERIFICATION

| 무엇 | 어디서 | 결과 |
|---|---|---|
| `npm run verify` | 결합 트리 | **EXIT=0** — 185 files / 2808 tests |
| `npm run verify` | #79 최종 | **EXIT=0** — 185 files / 2796 tests, Errors 0 |
| `npm run test:phase0` | 결합 트리 | **48 migrations / 205 assertions** |
| `npm run test:phase0` | #79 최종 | 47 migrations / 197 assertions |
| `test:p5` · `test:write-floor` · `test:rollback` | 결합 트리 | PASS (93 · 39 · PASS) |
| `npm audit --omit=dev` | — | 취약점 0 |
| CI | #79 `a9f7dc0` | 14/14 |
| mutation | 이번 감사에서만 6종 | 전부 실패 확인 후 복원 |

**실행하지 않은 것:** 로컬 브라우저(CI가 authority) · Android SDK · iOS 빌드(Xcode 부재) ·
실제 알림 전달(자격증명·기기 없음) · 원격 Supabase 조회.

vitest의 unhandled-rejection 탐지가 살아 있는지 probe로 확인했다: assertion은 통과하되
rejection을 남기는 테스트를 넣으면 `Tests 1 passed / Errors 1 error / EXIT=1`이 된다.
지시받은 최우선 클래스를 잡는 장치가 실제로 작동한다는 뜻이다.

#### PRODUCTION
- NOT APPLIED. 047·048·049·050 모두 어느 원격에도 적용되지 않았고 조회조차 하지 않았다.

#### 정확한 중단 지점
저자 측 감사 완료. **다음은 Codex의 독립 감사이며 그 역할은 시작하지 않았다.**
그 앞에 user 전용 게이트가 하나 있다: #74→#75→#76→#77→#78→#79 순서 병합.


## 유지 규칙

- 세션이 끝나면 이 문서에 **한 항목**을 추가한다. 커밋 메시지를 여기 복사하지 않는다.
  링크와 요약이면 충분하다.
- 제품 방향이 바뀌면 `PRODUCT_V3.md`를 먼저 고치고, 여기에는 "고쳤다"만 남긴다.
- 운영 배포 상태를 여기에 쓰지 않는다. 마이그레이션 ledger가 유일한 출처다.
