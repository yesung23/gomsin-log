# 인수인계 — A1 일기장 지면 (`diary_pages`)

> 2026-08-23 opus 작성. **이 문서 하나로 이어받을 수 있게 쓴다.**
> 대화 기억은 source of truth가 아니므로, 여기 적힌 것과 코드가 다르면 **코드가 이긴다.**

## 0. 한 줄

서버 쪽(테이블·RLS·계약)은 **끝났고 검증됐다.** 클라이언트는 **하나도 없다.**
운영 적용도 안 됐다.

## 1. 무엇을 만들려는가

> **요청 원문 (2026-08-23):** "탭의 중간 + 부분에는 스토리와 게시물을 조합해서
> 나만의 일기장을 만들 수 있게 하고"

지금 `일기장`(`/diary`)은 한 달치를 **자동으로만** 엮는다(`buildDiaryMonths`). 그 달의
모든 기록이 들어가고 사용자는 고를 수 없다. 요청은 **고르게 하는 것**이다 — 무엇을
넣고 뺄지 정해 한 지면으로 만든다.

제품 근거는 `PRODUCT_V3` §5.5다. `우리`와의 경계가 여기 있고 이 선을 지워서는 안 된다.

| | 성격 | 단위 | 동사 |
|---|---|---|---|
| 우리 | 자동으로 쌓인다 | 하루 칸 | 본다 |
| 일기장 | 내가 만든다 | 한 달 지면 | 만든다 |

## 2. 왜 테이블이 필요했나 — 이 판단을 다시 하지 마라

고른 결과를 **어디에도 저장할 수 없어서** 막혀 있었다.

- **`daily_records`에 플래그로 못 넣는다.** 지면은 기록 하나의 속성이 아니라 여러 기록을
  고른 결과다. `in_diary` 같은 열을 두면 같은 달의 지면을 두 번 만들 수 없고, 무엇을
  **뺐는지**도 남지 않는다.
- **기기에 못 넣는다.** 저장되는 로컬 키는 정확히 넷(`widgetLayout` ·
  `soldierWidgetLayout` · `hasSeenInstallPrompt` · `theme`)이고
  `src/lib/accountDeletionRecovery.test.tsx:325`가 **그 목록을 정확히 못 박는다.**
  지면 구성은 사용자 콘텐츠라 거기 들어가면 안 된다 — 계정 삭제보다 오래 살아남는다.

그래서 `056_diary_pages.sql`을 썼다.

## 3. 지어진 것 — 서버 (DONE, 검증됨)

`supabase/migrations/056_diary_pages.sql`

```
diary_pages
  id                uuid pk
  couple_id         uuid  → couples(id) on delete cascade
  created_by        uuid  → auth.users(id)     ※ 트리거가 auth.uid()로 덮어씀
  month_key         text  CHECK ^\d{4}-(0[1-9]|1[0-2])$
  content_envelope  bytea NOT NULL, octet_length >= 108   ※ 평문 경로 없음
  key_domain        text  CHECK = 'couple'
  key_epoch         bigint CHECK >= 1
  created_at / updated_at
  UNIQUE (couple_id, month_key)
```

핵심 성질 넷. **고칠 때 이 넷을 깨지 마라.**

1. **평문 지면은 표현될 수 없다.** `content_envelope`가 `NOT NULL`이라 `daily_records`와
   달리 write floor로 막을 문이 없다. 무엇을 골랐는가는 그 자체로 사용자가 한 말이다
   (§5.5).
2. **커플 도메인 하나뿐.** health(2)·personal(1) 봉투는 트리거가 거절한다. HRK가 CSK
   자리에 서는 대체가 이 테이블에 **표현될 수 없어야** 한다(architecture V2.1 §2).
3. **작성자는 세션이 정한다.** 트리거가 `NEW.created_by := auth.uid()`로 덮는다. 인자를
   믿으면 남의 이름으로 지면을 만들 수 있다.
4. **한 커플의 한 달에 지면은 하나.** 둘이 각자 만들면 어느 쪽이 「우리의 한 달」인지
   답할 수 없고, 상품이 되는 순간 그 질문에 답해야 한다(BUSINESS §9.2).

검증 — `scripts/phase0/storage-authz-harness.mjs` 끝에 **계약 14개**. 실행:

```bash
npm run test:phase0     # 빈 PostgreSQL 17에 001–056 적용, 296 passed
```

mutation proof도 실제로 돌렸다: 도메인 검사를 빼면 2개, 세션 판정을 빼면 1개가 정확히
실패하고 되돌리면 14개가 돌아온다.

**함정 하나 기록해 둔다.** 처음에 거절 케이스 셋이 같은 달(`2026-10`)을 썼다. 그러면
하나가 통과했을 때 나머지가 **규칙이 아니라 UNIQUE 제약** 때문에 거절되어, 규칙을 빼도
초록으로 남는다. mutation proof가 그것을 잡았다. 거절 케이스를 더할 때 **달을 겹치지
마라.**

## 4. 지어지지 않은 것 — 클라이언트 (전부)

### 4.1 암호 계층

`content_envelope`에 무엇을 넣을지 정하고 봉투를 만드는 코드가 없다.

- 봉투 포맷: `GLE1` — `src/crypto/`가 소유한다. `daily_records`의 `content_envelope`를
  만드는 경로를 그대로 따라가면 된다(`039_daily_records_content_envelope.sql`의 헤더
  레이아웃과 같다: magic 0..3, version 4, domain 7, epoch 12..19 big-endian).
- 도메인은 **couple(3) 고정**. epoch는 현재 CSK epoch.
- 평문 payload 제안(정해진 것 아님):
  ```json
  { "v": 1, "recordIds": ["..."], "order": ["..."], "note": "" }
  ```
  `stickers`는 아직 넣지 마라 — §5.5의 스티커는 별도 게이트다.

### 4.2 읽기·쓰기

`src/lib/diaryPages.ts` (없음) — `fetchDiaryPage(coupleId, monthKey)` ·
`saveDiaryPage(...)`. `src/lib/records.ts`의 봉투 처리 방식을 따른다.
**`select('*')`를 쓰지 마라** — 백로그 §F1의 이유.

### 4.3 화면

- `/diary`가 지면을 읽어 **고른 것만** 그린다. 없으면 지금처럼 자동 편성으로 보여준다.
- 고르는 화면. 요청은 "중간 `+`"였다. **탭 자리를 옮기지 않고** 하는 방법이 있다:
  `/compose`에 `오늘 남기기` / `지면 만들기` 두 모드를 두는 것. 가운데 칸은 인스타에서도
  **만들기**이므로 문법을 지키면서 만드는 대상만 늘리는 것이 된다.
  - **먼저 읽어라: `docs/V4_AS_BUILT.md` §6.1.** 탭 세트는 이미 세 번 갈아엎었고 마지막에
    인스타 배치로 되돌렸다. 네 번째로 옮기려면 그때 되돌린 이유가 지금은 왜 안 통하는지
    말할 수 있어야 한다.

### 4.4 연결 해제·계정 삭제

- RLS가 `get_my_active_couple_id()`를 쓰므로 **연결이 해제되면 지면도 안 보인다.** 의도된
  것이다(이 앱이 unlink에 대해 이미 정한 규칙).
- 계정 삭제 경로(`supabase/functions/delete-account`)가 `diary_pages`를 **아직 모른다.**
  `couple_id` FK에 `ON DELETE CASCADE`가 있어 커플이 지워지면 같이 지워지지만, 삭제
  함수가 세는 목록과 preflight에 넣을지 확인해야 한다. → **보안 검토 대상**

## 5. 남은 게이트

| 무엇 | 누가 여는가 |
|---|---|
| **운영 적용** | 사용자가 Supabase 대시보드 SQL Editor에서 직접. 이 저장소는 운영을 변경하지 않는다 |
| 계정 삭제 경로에 포함 | `gomsin-security-review` |
| 스티커 | 별도 테이블. `V4_BACKLOG.md` §C |
| `한 권으로 만들기` 결제 | `P-MP` 게이트 셋 |

## 6. 이어받는 사람이 먼저 할 것

```bash
bash scripts/agent/session-start.sh
npm run test:phase0          # 056 계약 14개가 초록인지
```

그다음 §4.1부터. **§3의 성질 넷을 깨지 않는 한** 나머지는 판단해서 지어도 된다.

## 7. 이 문서를 닫는 조건

§4가 다 지어지고 운영에 적용되면 이 파일을 지우고 `V4_AS_BUILT.md`에 한 줄 넣는다.
