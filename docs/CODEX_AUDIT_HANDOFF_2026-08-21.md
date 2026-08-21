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
   → **4차 감사에서 그 배선 게이트가 실제로 무는 척만 하고 있었음을 확인하고 고쳤다.**
   같은 파일의 나머지 source-string 검사(union 어휘·필드 모양·emit 순서)는 그대로다
7. **partial mock / 기본 매개변수 함정** — 이 저장소에서 각각 여러 번 발생했다
8. **unhandled rejection** — vitest가 실제로 잡는 것은 probe로 확인했다(`Tests passed /
   Errors 1 / EXIT=1`). 잡히지 않는 경로가 있는가
9. **`051` 자체** — 저자가 방금 쓴 SQL이고 독립 리뷰를 받지 않았다. 특히 §3의 조건부
   플래그 하강이 파트너의 다른 기록을 삼키지 않는가

### 저자가 검증하지 못한 것 — 이 브랜치에서 유일하다

> **2026-08-21 4차 감사에서 닫혔다.** 아래는 그때까지의 기록이며, 무엇이 왜 어려웠는지가
> 여전히 읽을 값어치가 있어 남긴다. 현재 커버리지는 `src/lib/store-outbox-flush.test.tsx`다.

**오프라인 큐 flush 수정(`store.tsx`)에는 회귀 테스트가 없다.** 세 번 시도했고 셋 다 지웠다.

1. `store.test.tsx` 안의 두 케이스 — 단독 통과, 전체 스위트에서 그 파일의 다른 테스트가
   남긴 상태 때문에 실패.
2. 별도 파일로 격리 — 어디서나 통과했지만, **effect의 `flush`를 빈 함수로 바꿔도 통과했다.**
   `all()`은 flush뿐 아니라 큐 카운트 effect도 도달하기 때문이다.
3. 대신 `online` 리스너 존재를 확인 — `useOnlineStatus`가 어차피 하나 등록하므로 역시 통과.

**2번을 한때 "mutation으로 검증됨"이라고 보고했다. 틀렸다.** effect 전체를 지우면 빨개지는
것은 확인했지만, `flush`만 무력화하는 mutation은 통과했다. 주변 코드를 지워야만 실패하는
테스트는 그 코드를 테스트하지 않는다.

제대로 하려면 실제 큐 엔트리와 "전달이 **시도**되었다"는 assertion이 필요하고, 그런 outbox
fixture를 가진 테스트 파일이 현재 없다. 릴리스 브랜치에서 이 크기의 수정을 위해 만드는 것은
맞지 않는 거래라 판단했다. 그래서 **effect 자체에 미검증이라는 주석을 달았고**, 이 문서가
같은 말을 하며, 어디에서도 검증됐다고 세지 않는다. 이 브랜치의 나머지는 전부 mutation
검증을 거쳤고, 이것만 읽어서 확인했다.

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

### 2차 리뷰에서 추가로 닫은 것 (052)

독립 리뷰어가 실제 DB에서 재현해 가져온 것 중 둘을 더 닫았다.

- **공유 기록을 삭제하면 파트너 플래그가 남는다.** 048/051은 `is_private` 변화만 다뤘고
  행이 사라지는 경로가 없었다. 심각한 쪽은 손으로 지우는 경우가 아니라 **계정 탈퇴**다 —
  `daily_records.user_id`가 CASCADE라 기록이 전부 지워지고, 남은 파트너는 다음 연락 가능
  시간에 "상대가 무언가 했다"는 알림을 받는다. 실제로 일어난 일은 **떠난 것**이다.
  §14.3이 정확히 금지하는 것(행위가 아닌 부재의 통지)이다. → `052`
- **`clearOwnUnseen`에 프로덕션 호출자가 0이었다.** 앱을 열어 전부 읽어도 플래그가 내려가지
  않아 다음 연락 가능 시간에 또 알림이 온다. `listenForPushTaps`와 같은 부류가 같은 파일에
  하나 더 있었다. → `store.tsx` + 두 push 모듈의 export 전부에 대한 게이트

**"구현했지만 연결 안 됨"이 이 브랜치에서 세 번째다**(`listenForPushTaps`, `clearOwnUnseen`,
죽은 감정 편집기). 게이트를 만들었고, 그 게이트의 첫 버전은 **주석 처리된 호출을 호출로 셌다** —
mutation으로 잡아 고쳤다.

### 3차: 알림 상태 모델 자체가 틀렸다 (053)

user가 구체적 시퀀스를 지목했고, **재현되었다.**

> A에게 오래된 공유 기록 R1이 있다 → B가 `clear_my_unseen()`으로 확인 → A가 R2 공유
> (플래그 올라감) → A가 R2를 비공개로 바꾸거나 삭제 → **R1이 남아 있어 플래그가 유지된다.**

051/052의 하강 조건은 "작성자의 다른 공유 기록이 없으면"이었다. R1은 B의 마지막 확인보다
**오래됐으므로 pending act가 아니다.** 유일한 새 행위가 철회됐는데 B는 여전히 소환된다.

**하나의 boolean으로는 올바른 취소가 불가능하다.** `has_unseen`은 무언가 pending이라는
사실만 담고 어떤 행위인지·언제인지는 담지 않으므로, 철회 시점에 "그것이 유일했는가"를 물을
수 없다. 필요한 두 사실을 053이 추가했다 — 수신자별 경계(`push_delivery_state.notified_through`,
파트너 비가시)와 기록별 공개 시각(`daily_records.shared_at`, `updated_at`이 이미 드러내던 것).

**이벤트 테이블이 아니다.** 개수도 목록도 이력도 없다. `shared_at`은 덮어쓰이고 철회 시
지워지므로 "몇 번 마음을 바꿨는가"의 기록이 남지 않는다. 클라이언트는 여전히 `has_unseen`
하나만 읽으므로 debt UI를 만들 수 없다.

회귀 5종(실제 함수 경로를 구동): old-R1+clear+R2+retract · 같은 것을 삭제로 · 진짜 pending
2건 중 1건만 철회(유지되어야 함) · 행위 사이의 clear · 행위 사이의 전송. 053을 체인에서
빼면 그중 **취소 4건이 실패한다.**

> **감사자에게:** 053은 이 결함을 user가 지목해서 나왔다. 저자가 두 차례 감사에서 048·051·052를
> 훑고도 못 봤다는 뜻이며, 세 migration 모두 "shared 상태"와 "통지 안 된 행위"를 같은 것으로
> 다뤘다. 같은 혼동이 남아 있는 곳이 더 없는지가 이 영역의 첫 질문이다.

### 4차: 053이 만든 컬럼이 다시 위조 가능했다 (054), 그리고 클라이언트 결함 둘

같은 트리를 다시 감사했다. 이전 보고를 사실로 믿지 않고 live 상태를 재확인한 뒤 실제
PostgreSQL 17.10에 전체 체인을 적용하고 RLS 실행 주체로 함수를 구동했다.

| 심각도 | 무엇 | 어디서 닫혔나 |
|---|---|---|
| HIGH | **`daily_records.shared_at`을 클라이언트가 쓸 수 있었다.** 053의 취소 규칙 전체가 이 컬럼에 걸려 있는데, 스탬프 트리거가 `UPDATE OF is_private`에만 걸려 있어 그 컬럼을 적지 않은 UPDATE는 트리거를 돌리지 않았고, 값을 바꾸지 않고 적기만 한 UPDATE는 아무것도 대입하지 않는 분기로 들어갔다 | `054` |
| MEDIUM | 파트너 기록이 quarantine돼 화면에 없는 상태에서 `clear_my_unseen()`을 불러 053의 경계를 영구히 밀어버렸다 | `store.tsx` |
| MEDIUM | §19 배선 게이트가 **주석 처리된 호출을 호출로 셌다** — 진짜 emit 둘을 주석 처리해도 22개가 전부 초록이었다 | `productEvents.test.ts` |
| LOW | `App.entitlements`의 `aps-environment` 항목이 둘이고 하나가 Gate 3 이전의 거짓 진술 | `App.entitlements` |

**HIGH의 재현.** 기록 소유자로서 RLS를 통과해:
오래된 기록의 `shared_at`을 미래로 밀어두면 → 유일한 새 행위를 공유하고 철회해도 →
파트너 플래그가 **유지된다**(측정값 `t`, 053만으로는 `f`). `push_delivery_candidates()`는
`has_unseen`만 읽으므로 그것은 행위 없는 알림이다.

> **감사자에게, 그리고 이것이 이 문서에서 가장 중요한 문장이다.**
> 이것은 **051 §2와 완전히 같은 부류**다. 서버의 정확성이 걸린 컬럼을, 작성자가 떠올린
> 경로만 덮는 장치로 지켰다. 051에서는 DEFAULT가 컬럼을 **생략할 때만** 적용됐고, 여기서는
> 트리거가 `is_private`를 **적을 때만** 돌았다. 저자는 051에서 이 부류를 직접 진단하고
> 한 migration을 통째로 거기 썼는데, **두 migration 뒤에 같은 실수를 다시 했다.**
> 진단이 다음번을 막지 못했다는 뜻이므로, **"서버 상태인데 클라이언트가 쓸 수 있는 컬럼"을
> 저장소 전체에서 다시 세는 것이 이 영역의 첫 질문이다.**
>
> 그 세기를 이번에 한 번 돌렸고, 결과는 아래다. **전수 보증이 아니라 한 번의 통과이며,
> Codex가 독립적으로 다시 세야 한다.**
>
> - `authenticated`가 UPDATE할 수 있는 public 테이블은 20개다
> - `couple_members`는 그중에 **없다.** §7.6의 창을 계산하는 `joined_at`이 클라이언트
>   손에 없다는 뜻이고, 이 감사에서 가장 걱정했던 항목이었다
> - `push_delivery_state`·`device_push_tokens`·`product_events`는 UPDATE 권한 자체가
>   없다(각각 SELECT 전용, SELECT 전용, INSERT 전용)
> - `crypto_pairings`는 UPDATE가 되지만 정책이 `get_my_active_couple_id()`에 걸려 있어
>   **UNLINKED를 되살릴 수 없다** — 끊긴 뒤에는 그 함수가 NULL을 주므로 행이 매치되지
>   않는다. 실제로 시도해 확인했다
> - `key_envelopes`·`device_enrollments`·`migration_ledger`는 전부 row 소유자 범위이고,
>   민감 컬럼은 032/040/045의 write-floor 트리거가 지킨다
> - `daily_records`의 나머지 서버 관리 컬럼(`content_revision`·`cipher_format`·
>   `key_domain`·`key_epoch`·`content_envelope`)은 write-floor 트리거가
>   **조건 없는 `BEFORE INSERT OR UPDATE`**로 걸려 있다 — 054가 `shared_at`을 옮겨 놓은
>   바로 그 모양이다
>
> 즉 048~054 표면에서 이 부류의 인스턴스는 `shared_at` **하나뿐이었다.** 그러나 위 목록은
> 카탈로그 훑기와 표적 재현으로 만든 것이지 전수 증명이 아니다.

**오프라인 큐 flush는 더 이상 미검증이 아니다.** 지난 세션이 세 번 실패한 그 항목이다.
없던 것은 outbox fixture였고, `createIndexedDbOutbox`만 in-memory port로 바꾸면
`outbox.ts`의 판단은 전부 실제로 돈다. 관측 대상은 `saveRecordToDB` — 실제 배달 시도만이
도달한다. mutation 4건 전부 잡히며, 그중 **리스너는 두고 cold-launch 호출만 없애는** 것이
지난 시도가 살아남았던 형태다.

**저자만 확인했다고 적혀 있던 것들을 행위로 재확인했다.** 051 §1(약한 recovery 오버로드
부재 · 4-arg 한 서명), 051 §2(위조 4종 전부 거절), 051 §5(NULL 범위 예외), `disconnect_couple`
(한 호출로 토큰·플래그·pairing·membership 전부 전이, 인가 4종, 재호출 거절, 끊긴 멤버
candidate 0), 텔레메트리 판독 권한, 카탈로그 전수(search_path 미고정 0 · 앱 함수 오버로드 0 ·
RLS 미적용 0).

**고치지 않고 남긴 것 — Codex가 다시 볼 것.** `send-push`의 배달-표시 레이스: candidate
조회와 `mark_push_delivered` 사이에 공유된 행위는 삼켜진다. **거짓 알림이 아니라 누락**이고,
창은 1초 미만이며, 자격증명 부재로 현재 도달 불가능하다. 배달 코어를 릴리스 브랜치에서
건드릴 값어치가 없다고 판단했다. 판단 자체가 재검토 대상이다.

### 결함이 아니라 설계 선택인 것 — 리뷰어가 지적했으나 유지

- **051/052의 조건부 플래그 하강이 "다른 공유 기록이 하나라도 있으면" 무력하다.** 의도다.
  파트너가 그 기록들을 봤는지 알 수 없고, 알려면 seen-state가 필요한데 §14.3이 그것을
  금지한다. 주석에 명시했다.
- **`register_push_token`의 무조건 DELETE로 토큰을 아는 계정이 그 행을 가져갈 수 있다.**
  문서화된 기기 이양 메커니즘이며, 토큰 문자열은 cross-user로 읽을 수 없다(SELECT 정책이
  자기 행 전용). 고치면 같은 기기의 계정 전환이 깨진다. **감사자가 다시 볼 가치가 있는 곳**
  으로 §0의 공격 목록에 이미 올려두었다.

### 독립 리뷰어 중 결과를 내지 못한 것

재시도 결과: **048 푸시 가드·토큰 lifecycle은 독립 검토를 받았다** — 실제 DB에서 재현하며
20개 넘는 항목을 확인했고 위 052가 그 산출물이다.

**§7.6과 `disconnect_couple`, 그리고 `051`·`052` 자체는 끝내 독립 검토를 받지 못했다.**
재시도한 리뷰가 세션 한도로 중단됐다. 그 세 영역은 **저자만 확인했다.** 특히 `051`과 `052`는
저자가 이 세션에 쓴 SQL이고, 저자가 쓴 harness assertion만이 증거다 — 050이 정확히 같은
자리에서 틀렸다는 것을 감안하면 감사자가 가장 먼저 볼 곳이다.

또 하나 정직하게: 반증 검증자들도 같은 한도로 죽었다. 위 052로 이어진 발견들은 **반증
과정을 거치지 않았고**, 저자가 직접 재현해 확인했다. 반증되어 폐기된 것으로 기록된 항목은
실제로는 "검증되지 못한 것"이다.

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
