# Codex 전수 감사 인계 — 2026-08-21

> **이 문서는 감사 시작점이다.** 정본은 각 canonical 문서이며, 여기에 사실을 복제하지 않고
> 어디를 봐야 하는지와 무엇이 검증되지 않았는지를 적는다.
>
> 작성자: Claude Code / Opus 5. **이 세션의 모든 검증은 작성자 본인이 했다.**

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
| 6 | #79 | `claude/phase1-gate3-push` | **`a9f7dc0`** | 이 HEAD는 CI 진행 중 |

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
| `npm run verify` (#79) | **PASS (EXIT=0)** — 184 files / 2792 tests, unhandled rejection 0 |
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

6과 7은 이 브랜치 앞부분에서 **똑같은 모양의 mutation이 살아남은 적이 있는데도** 남아
있던 것이다. `disabled`는 다음 렌더에 적용되므로 핸들러 안의 가드가 실제로 버티는 것이다.

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
