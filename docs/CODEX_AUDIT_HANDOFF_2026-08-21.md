# Codex 전수 감사 인계 — 2026-08-21

> **이 문서는 감사 시작점이다.** 정본은 각 canonical 문서이며, 여기에 사실을 복제하지 않고
> 어디를 봐야 하는지와 무엇이 검증되지 않았는지를 적는다.
>
> 작성자: Claude Code / Opus 5. **이 세션의 모든 검증은 작성자 본인이 했다.**

---

---

## 0. 이 문서보다 먼저 알아야 할 것 (2026-08-21 최종 갱신)

**최종 릴리스 트리는 PR #80 `release/phase1-gate3-clean-history`다.** #79는 gitleaks가
과거 커밋의 PEM 형태 fixture를 잡아 막혔고, #80이 그 tree를 clean history로 재구성한
대체본이다. 두 tree는 `8dade09`로 **정확히 동일**하다. #79는 provenance로 남기고 병합하지
않는다. 아래 §1의 표는 그 이전 checkpoint이며 **더 이상 landing 계획이 아니다.**

기본 브랜치 tip은 `f73ebfe`(#78까지). **#80 병합은 user 전용 게이트다.**

### 저자가 두 번째 감사에서 찾아 고친 것

첫 감사(§5-1) 이후 독립 리뷰어 6개를 병렬로 돌려 전수 감사를 했다. 상세와 검증 원장은
`WORK_LOG.md` 2026-08-21 마지막 항목이 소유한다. 여기에는 **감사자가 알아야 할 것만** 적는다.

| 심각도 | 무엇 | 어디서 닫혔나 |
|---|---|---|
| CRITICAL | 035가 034가 지운 recovery 함수를 **오버로드로 부활**시켰다 (약한 2-arg에 device/identity/downgrade 검사 없음) | `051` §1 |
| CRITICAL | **iOS가 APNs 토큰을 받을 수 없었다** — AppDelegate에 remote-notification 콜백 부재 | `AppDelegate.swift` |
| HIGH | `product_events.couple_id` **클라이언트 위조 가능** (DEFAULT는 컬럼 생략 시에만) | `051` §2 |
| HIGH | **어떤 워크플로우도 PostgreSQL harness를 돌리지 않았다** | `master-validation.yml` |
| HIGH | **오프라인 큐가 flush되지 않는다** (pending 커플 + 모든 cold launch) | `store.tsx` |
| MEDIUM | 비공개 회수 시 플래그 잔존, **그리고 공개 전환이 알림을 만들지 않았다**(§7.6이 조용했다) | `051` §3·§4 |
| MEDIUM | 푸시 탭 리스너가 라우트마다 재등록 | `App.tsx` |
| LOW | NULL 판독 범위가 0을 사실로 반환 | `051` §5 |

### 감사자가 특히 공격해야 할 곳

사용자가 지정한 목록에, 이번 감사가 만든 것을 더한다.

1. **`048`의 private-record 가드** — 이제 트리거가 셋(INSERT, 회수, 공개 전환)이다. 세
   경로 전부에서 비공개 기록이 알림을 만들지 않는가
2. **푸시 토큰 기기 이양의 동시성** — `register_push_token`은 토큰 문자열을 아는 누구든
   그 행을 가져갈 수 있다. 문서화된 이양 메커니즘이지만 제3자와 구분하지 못한다
3. **`disconnect_couple` 재작성** — harness 통과는 crypto가 안 깨졌다는 증거일 뿐이다
4. **`050`/`051`의 소집단 프라이버시** — 5커플 코호트에서 집계 조합으로 개인이 복원되는가
5. **§7.6 부분 실패의 정직성** — 5개 중 2개 실패 시 사용자에게 하는 말이 실제 상태와 맞는가
6. **source-string 대조 테스트** — `productEvents.test.ts`에 남아 있다. H3가 정확히 그
   부류에 당했다. 전부 통과하므로 감사 규칙에 따라 두었지만 **부류로 봐야 한다**
7. **partial mock / 기본 매개변수 함정** — 이 저장소에서 각각 여러 번 발생했다
8. **unhandled rejection** — vitest가 실제로 잡는 것은 probe로 확인했다(`Tests passed /
   Errors 1 / EXIT=1`). 잡히지 않는 경로가 있는가
9. **`051` 자체** — 저자가 방금 쓴 SQL이고 독립 리뷰를 받지 않았다. 특히 §3의 조건부
   플래그 하강이 파트너의 다른 기록을 삼키지 않는가

### 저자가 검증하지 못한 것 — 이 브랜치에서 유일하다

**오프라인 큐 flush 수정(`store.tsx`)에는 회귀 테스트가 없다.** 두 케이스 모두 단독
실행에서는 통과하고 전체 스위트에서는 테스트 간 간섭으로 실패했다. 원인을 추적하지 못한 채
중단했고, 빨간 테스트를 남기거나 통과할 때까지 조정하는 대신 제거했다. 근거는 기존 34개
store 테스트의 무회귀와 **읽기**뿐이다. 이 브랜치의 다른 모든 수정과 성격이 다르다.

### 수정하지 않고 남긴 것

프론트엔드 독립 리뷰어가 보고했고 재현했으나 **승인된 범위 밖이거나 새 기능이 필요해**
손대지 않았다. 전부 이번 릴리스 이전부터 있던 것이다.

- 데이터 내보내기가 네이티브 두 셸에서 no-op인데 성공이라 말한다 (`SettingsPage.tsx`)
- 곰신이 파트너의 복무 정보를 볼 수 없고, 편집기가 자기 프로필에 쓴다 — 파트너 미러가 없다
- `우리` 탭의 날짜 셀이 아무도 읽지 않는 `?date=` 파라미터로 이동한다
- 암호화된 기록당 `scope_keys` 쿼리 1회 (N+1). 평문 경로가 조기 반환하므로 현재는 잠복
- `daily_records` 조회가 무제한(`select('*')`, limit 없음)
- 초대 코드 재발급의 가드가 `await` 전에 풀린다
- 모달 12개 중 11개에 포커스 트랩·복원이 없다
- 온보딩 필수 입력 6개에 접근 가능한 이름이 없다

### 독립 리뷰어 중 결과를 내지 못한 것

048 푸시 가드·토큰 lifecycle, §7.6·`disconnect_couple` 두 영역은 이 문서를 쓰는 시점까지
리뷰어가 완료하지 않았다. **그 두 영역은 이번 감사에서 독립적으로 검토되지 않았다.**

---

## 1. 정확한 HEAD와 병합 순서

`master`는 아직 **`21e7dfb`** 다. 아래 중 어느 것도 landing되지 않았다.

| 순서 | PR | branch | HEAD | CI |
|---|---|---|---|---|
| 1 | #74 | `release/v1-gate1-gate2` | `9b0d4b3` | 14/14 |
| 2 | #75 | `claude/canon-amendments-2026-08-21` | `829e535` | 14/14 |
| 3 | #76 | `claude/047-cycle-pain-gated` | `d0e2c0a` | 14/14 |
| 4 | #77 | `claude/phase0-defect-closure` | `e1ea756` | 14/14 |
| 5 | #78 | `claude/phase1-call-mode-v2` | `ab01035` | 14/14 |
| 6 | #79 | `claude/phase1-gate3-push` | **브랜치 tip** | `a9f7dc0`에서 14/14 |

#79의 HEAD만 SHA 대신 브랜치로 적는다. 이 문서가 그 브랜치 위에 커밋되므로, 여기 적는
어떤 SHA도 **그것을 적는 커밋에 의해 곧바로 낡는다.** `CLAUDE.md`의 volatile fact 규칙이
같은 것을 말한다 — 문서의 PR·SHA는 checkpoint일 뿐이고 작업 시점에 live 확인한다.
나머지 다섯 개는 이 세션에서 움직이지 않았으므로 SHA가 유효하다.

각 PR은 앞선 것을 **포함**한다(#75·#76은 #74를, #77은 #74를, #78은 #77을, #79는 #78을).
순서대로 landing하면 뒤의 것은 자기 커밋만 남기고 줄어든다.

**결합 트리는 `audit/combined-scratch`(`d5471f3`)에 있다.** #79에 #75·#76을 cherry-pick한
것으로, landing 대상이 아니라 **검증 대상**이다. 병합 없이 최종 트리를 실행해 보기 위해
만들었고, 아래 §3의 결합 체인 결과는 거기서 나왔다. landing 후 이 브랜치는 버린다.

**PR 병합은 user 전용이다.** `.claude/hooks/block-dangerous-bash.sh`가 해당 명령들을 결정적으로
차단한다. 감사자도 병합하지 않는다.

---

## 2. 구현된 것

| 영역 | 어디를 볼 것인가 |
|---|---|
| Phase 0 결함 마감 | PR #77. S6 편집기 통합, 죽은 컴포넌트 제거(커버리지 이관 후), 마이 탭 동의 카드, §3.1 위반, 빈 상태, 우리 달 간격 |
| Gate 4 통화 모드 | `src/pages/CallModePage.tsx`. 전화 안 걺, 통화 기록 0, `다음`은 쓰기 없는 건너뛰기 |
| Gate 3 push 서버 | `supabase/migrations/048_push_delivery_metadata.sql` + `supabase/functions/send-push/` |
| Gate 3 push 클라이언트 | `src/lib/pushTokens.ts` · `pushNotifications.ts` · store의 연결 시 등록/로그아웃 시 회수 |
| §7.6 사후 공개 | `src/lib/waitingPeriodReveal.ts` · `WaitingPeriodRevealCard.tsx` · `coupleTimeline.ts` |
| 양 역할 알림 시간 | 온보딩 step 6(양 역할) + `src/components/ContactHoursSection.tsx` |
| §19 계측·판독 | `049_product_events.sql` · `050_lv_funnel_readout.sql` · `src/lib/productEvents.ts` |

### 감사자가 특히 볼 만한 판단 세 가지

1. **`couple_members.has_unseen`을 쓰지 않았다.** 전략이 그렇게 지정했으나, 001의 SELECT 정책이
   활성 파트너에게 그 행 전부를 보여주므로 그 자리의 플래그는 읽음 표시가 된다(§14.3 절대 금지).
   RLS는 row 단위라 컬럼 하나만 가릴 수 없어 전용 테이블로 옮겼다. → `048` §2

2. **§7.6의 "한 번"을 저장하지 않는다.** `couple_members.joined_at`에서 창(7일)을 계산한다.
   새 영속 사실이 없다. → `src/lib/waitingPeriodReveal.ts` 헤더

3. **`product_events`에 timestamp 컬럼이 없다.** `occurred_on DATE`뿐이다. 다른 테이블이 모두 갖는
   `created_at` 기본값이 여기 있으면 누가 언제 앱을 여는지의 분 단위 기록이 된다. → `049` 헤더

---

## 3. 실행한 검증

| 무엇 | 결과 |
|---|---|
| `npm run verify` (#79) | **PASS (EXIT=0)** — 185 files / 2796 tests, unhandled rejection 0 |
| `npm run verify` (결합) | **PASS (EXIT=0)** — 185 files / 2808 tests |
| `npm run test:phase0` (#79) | **47 migrations / 197 assertions** (048이 37개, 049가 19개, 050이 16개) |
| `npm run test:phase0` (결합) | **48 migrations / 205 assertions** — 047 포함 fresh chain, 첫 실행 |
| `npm run test:p5` | PASS (93) |
| `npm run test:write-floor` | PASS (39) |
| `npm run test:rollback` | PASS |
| `npm run check:edge` | PASS (deno, 이 세션에서 로컬 설치) |
| CI (#77·#78·#79) | 각 14/14 |
| mutation | **30건 이상** 적용 → 실패 확인 → 복원 |

**mutation 중 통과한 3건은 왜 통과했는지 코드 주석에 남겼다** — 안 무는 테스트를 무는 척
두지 않기 위해서다.

### 실행하지 않은 검증

- **로컬 브라우저 없음.** headless shell 부재 + headed 바이너리 SIGABRT. 브라우저 증거는
  **CI가 authority**.
- **Android SDK 없음.** JVM `NativeConfigTest`와 merged manifest 검사는 CI만 실행한다.
- **iOS 빌드 없음.** 이 기기에 Xcode 없이 Command Line Tools만 있어 `pod install`이 실패한다.
  `Podfile.lock`은 SPEC/PODFILE checksum 모두 일관되게 갱신됐다(CocoaPods가 해결까지는 마쳤고
  실패는 이후 Xcode 프로젝트 통합 단계).
- **실제 알림 전달 미검증.** 자격증명도 기기도 없다.

---

## 4. Migration — 전부 NOT APPLIED

| migration | 내용 | 원격 상태 |
|---|---|---|
| 047 | care signal `feeling_unwell` | **NOT APPLIED** (PR #76 소유) |
| 048 | push delivery metadata | **NOT APPLIED** |
| 049 | §19 product_events | **NOT APPLIED** |
| 050 | LV 판독 (couple 축 + 집계) | **NOT APPLIED** |

**원격 Supabase는 조회조차 하지 않았다.** 원장은 `supabase/migrations/README.md`가 소유한다.

~~⚠️ 047과 048~050을 합친 fresh chain은 한 번도 실행되지 않았다~~ → **2026-08-21 저자 감사에서
실행했고 통과했다.** `audit/combined-scratch`에서 001→…→047→048→049→050 48개가 빈
PostgreSQL 17.10에 순서대로 적용되고 205 assertions 통과. 겹치는 객체는 없었다.

그 실행에서 landing 시 재현될 충돌 세 가지가 드러났다. 원장과 harness ORDER 모두 047이
048 앞에 와야 하고(번호 순서가 유일한 정답), `CURRENT_STATE.md`는 #75의 수렴 checkpoint와
#79의 LV 조건표가 **둘 다 남아야 한다**(서로 다른 것을 서술하며 둘 다 참이다).

또한 047의 CHECK를 실제 DB에 대고 확인한 적이 없다는 것도 그때 드러났다. "적용된다"와
"승인된 종류를 받고 등급화된 종류를 거부한다"는 다른 주장이다. 8개 assertion을 추가했고,
그중 둘은 DB만 답할 수 있는 것이다 — 소유자가 승인된 종류를 보낼 수 있는가, 등급화된
통증 종류를 **클라이언트가 아니라 서버가** 거부하는가. 이 assertion들은 047이 있는
결합 트리에서만 의미가 있으므로 scratch에 있고, landing 후 적용된다.

---

## 5. 외부·수동 게이트 (교차하지 않음)

- **PR 병합** — user 전용
- **APNs/FCM 자격증명** — 없이는 전달 검증 불가
- **`aps-environment` entitlement** — 서명과 분리 불가능하다. Apple Developer portal에서
  capability를 켜야 하며, 키만 넣으면 기기 서명이 실패하고 시뮬레이터는 entitlement를 무시해
  CI도 그 불일치를 못 잡는다. `ios/App/App/App.entitlements`에 이유를 명시했다
- **실기기 2대 + TestFlight**
- **iOS `pod install`** — Xcode 필요
- **LV 전용 Supabase 프로젝트** — 001→050 순서 적용, 백업, kill switch, 내보내기 경로
- **`briefings` drop** — 파괴적 변경. `docs/skills/migration-gate.md` §4가 명시적 승인을 요구하며
  **하지 않았다**
- **§14.5 문장 대조** — 검증 빌드의 보안 표현을 LV 행과 맞춰본 적이 없다

---

## 5-1. 저자 감사에서 스스로 찾아 고친 것 (2026-08-21)

감사자가 "이건 이미 봤나"를 묻지 않아도 되도록 남긴다. 아래 아홉 가지는 **감사자가 아니라
저자가** 찾았고 이미 고쳐져 있다. 같은 자리를 다시 파는 것은 감사자의 자유지만, 적어도
새로 발견되기를 기대하고 있던 것은 아니다.

| # | 무엇 | 어디 |
|---|---|---|
| 1 | 047의 DB 계약이 검증된 적 없었다 | harness (결합 전용) |
| 2 | push 등록 promise가 리스너 2개와 타이머를 버렸다 | `pushNotifications.ts` |
| 3 | `listenForPushTaps`에 **호출자가 없었다** — 알림을 눌러도 아무 일도 안 났다 | `App.tsx` |
| 4 | §7.6이 연결 여부를 안 물었다 — 끊긴 뒤에도 공개를 제안할 수 있었다 | `waitingPeriodReveal.ts` |
| 5 | 050 주석이 코드가 안 하는 보장을 한다고 적혀 있었다 | `050`, 원장 |
| 6 | ContactHours의 오프라인 가드가 `disabled`뿐이었다 | `ContactHoursSection.tsx` |
| 7 | 같은 곳의 재진입 가드도 `disabled`뿐이었다 | 〃 |
| 8 | `authSyncCode`가 죽은 상태로 남아 있었다 | `store.tsx` |
| 9 | 문서 두 곳이 HEAD와 어긋나 있었다 | 이 문서, `CURRENT_STATE.md` |
| 10 | **§19 kill metric이 권한 거부를 opt-out으로 셌다** | `NotificationPreferencesSection.tsx` |

6과 7은 이 브랜치 앞부분에서 **똑같은 모양의 mutation이 살아남은 적이 있는데도** 남아
있던 것이다. `disabled`는 다음 렌더에 적용되므로 핸들러 안의 가드가 실제로 버티는 것이다.

10은 이 중 유일하게 **숫자를 틀리게 만드는** 결함이었다. emit이 preference를 쓰는 함수 안에
있었고 그 함수에는 호출자가 둘이다. 권한 요청이 denied로 돌아오면 `systemEnabled: false`를
쓰는데, OS 설정에서 나중에 취소된 grant의 `true`가 저장돼 있었다면 그것이 OFF 전이다.
**"허용"을 누른 사람이 opt-out한 사람으로 기록됐다** — 설계 실패를 뜻하는 지표가, 사용자가
알림을 더 원한 순간에 올라간 것이다.

> **감사자가 알아야 할 부류 하나.** 이 규칙은 테스트가 있었지만 **소스 문자열 대조**였다.
> 그런 검사는 코드가 그 표현을 *포함하기만* 하면 통과하므로 결함이 존재한 내내 초록이었고,
> 버그가 아니라 **수정에서** 깨졌다. 테스트가 실패하는 방향이 거꾸로다.
> `src/lib/productEvents.test.ts`에는 같은 모양이 더 있다. 지금 전부 통과하므로 감사 규칙에
> 따라 건드리지 않았지만, **인스턴스가 아니라 부류**로 봐야 한다.

## 6. 독립 리뷰를 받은 적 없는 것

**전부다.** 이 브랜치 계보에서 independent review를 통과한 것은 **PR #76의 047 하나뿐**이며,
그것도 이 세션 이전이다.

특히 다음은 작성자 본인만 확인했다:

- migration 048 · 049 · 050의 보안 형태(RLS, GRANT, SECURITY DEFINER, 고정 search_path, actor 가드)
- `disconnect_couple` 재작성 — crypto pairing 전이는 건드리지 않았고 p5/write-floor/rollback
  harness 통과가 그 증거지만, 재작성 자체는 리뷰되지 않았다
- push 토큰 lifecycle과 기기 이양 처리
- §7.6의 후보 판정과 부분 실패 처리
- §19 판독 함수가 개인을 식별할 수 없다는 주장

---

## 7. 알려진 미완 (코드 결함 아님)

- **§19 미측정 항목**: 3분 합류 실측 · 감정 확인율 · 위젯 계층 사용률. 전략 §8 Phase 2의
  측정 목록에 있으나 emit 지점이 없다
- **빈 홈 화면의 약 390px 공백** — 위젯이 적어 생기는 구조적 희소함. 내용을 만들어 채우는 것은
  2026-08-20에 되돌린 방향이라 하지 않았다. 디자인 결정이 필요하다
- **Android 권한 이중 선언** — TypeScript와 JVM 두 곳에서 같은 집합을 검사한다. 이 세션에서
  반대 방향으로 두 번 드리프트했으므로 **중복 자체가 결함**이지만, 통합은 별도 작업이다

---

## 8. 감사자에게 권하는 시작점

1. `docs/CURRENT_STATE.md`의 2026-08-21 항목들과 LV 진입 조건 대비표
2. `supabase/migrations/README.md`의 047~050 행
3. `docs/WORK_LOG.md`의 2026-08-21 항목 네 개
4. 그다음 `scripts/phase0/storage-authz-harness.mjs`를 직접 실행 — assertion들이 실제
   PostgreSQL에서 무엇을 증명하는지 보는 것이 이 브랜치를 가장 빨리 이해하는 길이다.
   #79에서는 197개, `audit/combined-scratch`에서는 047을 포함해 205개다

### 저자가 감사자에게 특히 권하는 다섯 곳

저자 감사가 이미 훑은 곳이 아니라, **저자가 자기 눈을 못 믿는 곳**이다.

1. **`048`의 `raise_partner_unseen()`** — `is_private` 가드가 전부다. 이 한 줄이 틀리면
   비공개 기록이 알림을 만든다. trigger가 붙은 테이블 전부에서 이 가드가 유효한가
2. **`disconnect_couple` 재작성** — p5·write-floor·rollback harness가 통과하지만
   그것은 crypto pairing이 안 깨졌다는 증거이지 재작성이 옳다는 증거가 아니다
3. **`050`이 개인을 식별할 수 없다는 주장** — 5커플 코호트에서 `COUNT(DISTINCT couple_id)`
   조합으로 개인이 복원되는 경로가 정말 없는가. 저자는 없다고 판단했고, 그 판단은
   리뷰되지 않았다
4. **§7.6 부분 실패 경로** — 5개 중 2개가 실패하면 3개는 이미 공개된 상태다. 그 사실을
   사용자에게 전하는 문구가 실제 상태와 어긋나는 경우가 있는가
5. **push 토큰 기기 이양** — 같은 토큰이 다른 계정에 재발급될 때 `DELETE … WHERE token`이
   먼저 도는 것에 의존한다. 동시성 하에서 그 순서가 깨지는 경로
