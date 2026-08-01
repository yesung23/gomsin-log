# Supabase 배포 체크리스트 (비개발자용)

이 문서는 **개발을 몰라도** 순서대로 따라 할 수 있도록 썼습니다.
모든 단계는 Supabase 웹사이트(대시보드)에서 마우스로 할 수 있습니다.

> ⚠️ **이 작업은 아직 실행되지 않았습니다.**
> 원격 데이터베이스를 바꾸는 일이라 반드시 사람이 직접 확인하고 실행해야 합니다.

---

## 0. 준비물

- Supabase 계정과 이 앱의 프로젝트 접근 권한
- 시간 30분 정도
- **운영(실제 사용자용) 프로젝트와 별도로 스테이징(연습용) 프로젝트**
  - 없다면 만드는 것을 강력히 권합니다. 실수했을 때 되돌릴 수 있습니다.

---

## 1. 백업 만들기 (건너뛰지 마세요)

1. Supabase 대시보드 접속 → 프로젝트 선택
2. 왼쪽 메뉴에서 **Database** 클릭
3. **Backups** 클릭
4. 백업 목록에 최근 날짜가 있는지 확인
   - 유료 플랜: 자동 백업이 있습니다. 날짜만 확인하세요.
   - 무료 플랜: 자동 백업이 없습니다. 아래를 실행해 직접 내려받으세요.

무료 플랜에서 백업하는 법:
1. **Database → Backups → Download** 버튼이 없으면
2. 왼쪽 메뉴 **SQL Editor** → 새 쿼리 → 아래를 실행하고 결과를 복사해 보관

```sql
-- 데이터 양 확인 (숫자를 메모해 두세요. 나중에 비교용)
SELECT 'profiles' AS t, count(*) FROM profiles
UNION ALL SELECT 'couples', count(*) FROM couples
UNION ALL SELECT 'couple_members', count(*) FROM couple_members
UNION ALL SELECT 'daily_records', count(*) FROM daily_records
UNION ALL SELECT 'invitation_codes', count(*) FROM invitation_codes;
```

메모한 숫자: ______________________________

---

## 2. 마이그레이션 013 적용

**무엇을 하는 건가요?**
초대코드는 숫자 6자리입니다. 지금은 **아무나 코드를 계속 찍어보면 남의 커플
공간에 들어갈 수 있습니다.** 013은 그것을 막습니다. 또 초대코드를 잃어버렸을 때
새로 발급할 수 있게 해 줍니다.

### 2-1. 먼저 스테이징에서

1. 스테이징 프로젝트 선택
2. 왼쪽 메뉴 **SQL Editor** → **New query**
3. 이 저장소의 `supabase/migrations/013_invitation_hardening.sql` 파일을
   **전체 복사**해서 붙여넣기
4. 오른쪽 아래 **Run** 클릭
5. 초록색 성공 메시지가 나오는지 확인
   - 빨간 오류가 나오면 **아무것도 바뀌지 않았습니다** (파일이 하나의 트랜잭션으로
     묶여 있습니다). 오류 메시지를 그대로 개발자에게 전달하세요.

### 2-2. 검증

같은 SQL Editor에서 아래를 실행하고, 오른쪽에 적힌 기대값과 같은지 확인하세요.

```sql
-- (1) 함수 3개가 만들어졌는지  → 3개 행이 나와야 함
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation','regenerate_invitation','prune_invitation_attempts');

-- (2) 로그인하지 않은 사람은 실행 못 하는지  → 둘 다 false
SELECT has_function_privilege('anon','public.redeem_invitation(text)','EXECUTE');
SELECT has_function_privilege('anon','public.regenerate_invitation(text)','EXECUTE');

-- (3) 로그인한 사람은 실행 가능한지  → true
SELECT has_function_privilege('authenticated','public.redeem_invitation(text)','EXECUTE');

-- (4) 초대코드 표를 앱이 직접 못 읽는지  → false
SELECT has_table_privilege('authenticated','public.invitation_codes','SELECT');

-- (5) 시도 기록을 앱이 못 건드리는지  → 둘 다 false
SELECT has_table_privilege('authenticated','public.invitation_attempts','SELECT');
SELECT has_table_privilege('authenticated','public.invitation_attempts','INSERT');
```

**하나라도 기대값과 다르면 운영에 적용하지 마세요.**

### 2-3. 운영에 적용

스테이징에서 (1)~(5) 모두 통과하고, 앱에서 초대/연결이 정상 동작하면
운영 프로젝트에서 2-1, 2-2를 똑같이 반복합니다.

### 2-4. 마이그레이션 014 적용 (반드시 013 다음)

`014_feature_privacy_and_collaboration.sql`은 공유·개인 일정, 공동 여행, 개인 주기,
최소 배려 신호의 RLS/Realtime/DB 정합성을 추가합니다. **013 검증이 끝난 뒤** 같은
staging → production 순서로 적용하세요.

1. staging SQL Editor에 파일 전체를 붙여넣고 Run
2. 아래 검증 쿼리 실행
3. `MANUAL_TWO_ACCOUNT_TEST.md`의 일정·여행·주기·연결 해제 항목 통과
4. 그 다음에만 production에서 같은 순서 반복

```sql
-- 신규 테이블 2개가 있어야 함
SELECT to_regclass('public.cycle_support_signals'),
       to_regclass('public.collaboration_invalidations');

-- raw cycle은 publication에 없어야 하고, 협업용 5개는 있어야 함
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN (
    'couple_members', 'trip_items', 'trip_checklists',
    'cycle_support_signals', 'collaboration_invalidations',
    'cycle_entries', 'cycle_settings'
  )
ORDER BY tablename;
-- 기대: collaboration_invalidations, couple_members, cycle_support_signals,
--       trip_checklists, trip_items만 출력

-- 핵심 함수/트리거 존재 확인
SELECT proname FROM pg_proc
WHERE proname IN (
  'reorder_trip_items', 'enforce_trip_item_date_range',
  'prevent_trip_range_excluding_items', 'enforce_cycle_support_signal_contract',
  'emit_collaboration_invalidation', 'enforce_event_identity_immutable'
)
ORDER BY proname;
-- 6개 행

-- 클라이언트가 raw cycle은 소유자 권한으로만 접근하고,
-- invalidation은 읽기만 가능한지 확인
SELECT has_table_privilege('authenticated','public.collaboration_invalidations','SELECT');
SELECT has_table_privilege('authenticated','public.collaboration_invalidations','INSERT');
-- 기대: true, false
```

하나라도 다르면 production에 적용하지 말고 오류·결과를 보존하세요.

#### 014 롤백 원칙

롤백은 데이터 손실 가능성이 있어 자동 실행하지 않습니다. 적용 전 백업으로 복원하는
것이 가장 안전합니다. 수동 롤백이 필요하면 한 트랜잭션에서 다음 순서로 진행합니다.

1. `supabase_realtime`에서 014가 추가한 5개 테이블 publication 항목 제거
2. `collaboration_invalidations`, `cycle_support_signals` 백업 후 테이블/관련 트리거 제거
3. `emit_collaboration_invalidation`, event/trip/support trigger 함수 제거
4. `cycle_entries.symptoms`를 백업 후 constraint/column 제거
5. migration 011의 event/trip 정책과 event type constraint 복원

`event_type='date'` 행이나 support signal 데이터를 먼저 변환/백업하지 않고 constraint나
테이블을 제거하면 데이터가 사라질 수 있습니다. 상세 주석은 migration 014 하단과
`docs/kiro/ROLLBACK_GUIDE.md`를 따르세요.

### 2-5. 마이그레이션 015 적용 (반드시 014 다음)

`015_security_followup.sql`은 013·014에서 남은 보안 구멍과 경합을 막습니다.
**이 마이그레이션은 초대 연결 기능의 선행 조건입니다** — 현재 앱은 015의 새 응답
형태만 받아들이므로, 015 없이는 초대 코드 입력이 거부됩니다(의도된 fail closed).

> ⚠️ **먼저 이 쿼리를 돌리세요.** 결과가 한 줄이라도 나오면 015는 실패합니다.
> (일부러 그렇게 만들었습니다. 잘못된 주소를 조용히 버리지 않기 위해서입니다.)
>
> ```sql
> SELECT id, trip_id, title, url
> FROM public.trip_items
> WHERE url IS NOT NULL
>   AND NOT (
>     char_length(url) <= 2048
>     AND url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
>   );
> ```
>
> 나온 행의 `url` 을 올바른 `http(s)` 주소로 고치거나 비우고(`NULL`) 다시 시도하세요.

1. staging SQL Editor에 파일 전체를 붙여넣고 Run
2. 아래 검증 쿼리 실행
3. **Settings → API → "Reload schema cache" 를 누르세요.**
   015가 `redeem_invitation` 의 응답 형태를 바꾸기 때문에, 이걸 하지 않으면
   앱이 예전 형태로 보고 초대 연결을 거부합니다.
4. `supabase functions deploy delete-account` (아래 5번 항목) 를 015 **이후에** 실행
5. `MANUAL_TWO_ACCOUNT_TEST.md` 통과
6. 그 다음에만 production에서 1~4를 반복

```sql
-- 1) 초대 제한 우회 경로가 닫혔는지 (false 여야 함)
SELECT has_function_privilege('authenticated','public.consume_invitation(text)','EXECUTE');

-- 2) redeem_invitation 이 새 형태(jsonb)인지
SELECT pg_catalog.format_type(prorettype, NULL)
FROM pg_proc WHERE proname = 'redeem_invitation';
-- 기대: jsonb

-- 3) 계정 삭제 RPC 3개는 앱에서 호출 불가 (모두 false)
SELECT has_function_privilege('authenticated','public.begin_account_deletion(uuid,uuid[])','EXECUTE');
SELECT has_function_privilege('authenticated','public.prepare_account_deletion(uuid,uuid[])','EXECUTE');
SELECT has_function_privilege('authenticated','public.cancel_account_deletion(uuid)','EXECUTE');

-- 4) events 가 Realtime 목록에서 빠졌는지 (0 행이어야 함)
--    비공개 일정을 지운 "시각"이 상대에게 전달되는 통로였습니다.
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events';

-- 5) 대신 쓰는 무효화 통로는 남아 있어야 함 (1 행)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename = 'collaboration_invalidations';

-- 6) 제약/인덱스 생성 확인
SELECT conname FROM pg_constraint
WHERE conname IN ('trip_items_http_url_check','trip_items_unique_day_order');
-- 2 행
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_invitation_codes_one_unused_hash';
-- 1 행

-- 7) 사용되지 않은 초대 해시가 중복되지 않는지 (0 행)
SELECT code_hash, count(*) FROM public.invitation_codes
WHERE used = false GROUP BY code_hash HAVING count(*) > 1;
```

하나라도 다르면 production에 적용하지 말고 오류·결과를 보존하세요.

#### 015에서 사람이 직접 확인해야 하는 것

코드만 봐서는 알 수 없어 실제 프로젝트에서만 확인되는 항목입니다. 스테이징에서
이 4가지를 반드시 눈으로 확인하세요.

1. **계정 삭제가 권한 오류 없이 끝나는지.** 삭제 준비 단계에서 Storage 테이블을
   잠깐 잠그는데, 그 권한이 없으면 `42501` 오류로 실패합니다(데이터는 안전).
2. **A가 "나만 보기" 일정을 지웠을 때 B 화면이 반응하지 않는지.**
3. **같은 날 여행 항목 두 개의 순서를 서로 바꿀 때** 오류 없이 저장되는지.
4. **여행 항목의 제목만 수정해도** 저장되는지 (순서 관련 오류가 나오면 안 됩니다).

#### 015 롤백 원칙

상세 순서는 migration 015 파일 하단에 있습니다. 두 가지만 특별히 주의하세요.

- **`consume_invitation` 의 앱 실행 권한은 되돌리지 마세요.** 그것만 되돌려도
  초대코드 무차별 대입 제한이 통째로 우회됩니다.
- 015를 되돌리면 앱도 이전 버전으로 함께 되돌려야 합니다. 현재 앱은 015의
  새 응답 형태만 받아들입니다.

---

## 3. Storage(사진·영상·음성 저장소) 확인

사진 업로드가 동작하려면 아래가 맞아야 합니다.

1. 왼쪽 메뉴 **Storage**
2. `couple-media` 라는 버킷이 있는지 확인
   - 없으면 **New bucket** → 이름 `couple-media` → **Public bucket 체크 해제**
     (반드시 비공개여야 합니다) → Create
3. 이미 있으면 버킷 이름 옆 **⋯ → Edit bucket** 에서
   **Public** 이 **꺼져 있는지** 확인

그리고 SQL Editor에서:

```sql
-- 비공개여야 합니다 → public 컬럼이 false
SELECT id, public FROM storage.buckets WHERE id = 'couple-media';

-- 정책이 4개 정도 있어야 합니다 (insert/select/delete)
SELECT policyname FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';
```

정책이 없으면 `supabase/migrations/007_storage_policies.sql` 을 SQL Editor에서
실행하세요.

---

## 4. 로그인 설정 (Authentication)

1. 왼쪽 메뉴 **Authentication** → **URL Configuration**
2. **Site URL**: 앱을 올린 주소 (예: `https://gomsinlog.vercel.app`)
3. **Redirect URLs** 에 아래를 **모두** 추가

```
https://<앱-주소>/auth/callback
http://localhost:5173/auth/callback
gomsinlog://auth/callback
```

> 마지막 `gomsinlog://auth/callback` 은 안드로이드 앱에서 구글 로그인이
> 돌아올 주소입니다. 없으면 앱에서 로그인이 안 됩니다.

4. **Authentication → Providers → Google** 을 켜고, Google Cloud에서 받은
   Client ID / Secret 을 넣습니다.
5. Google Cloud Console → 해당 OAuth 클라이언트 → **승인된 리디렉션 URI** 에
   Supabase가 안내하는 주소(`https://<프로젝트>.supabase.co/auth/v1/callback`)를
   추가합니다.

---

## 5. Edge Function 배포 (계정 삭제 기능)

**이것을 하지 않으면 "계정 삭제" 버튼이 실패합니다.**

> ⚠️ **마이그레이션 015보다 먼저 배포하지 마세요.** 이 함수는 015가 만드는
> `begin/prepare/cancel_account_deletion` 을 호출합니다. 순서가 뒤바뀌면 삭제가
> 실패합니다(데이터는 지워지지 않습니다).

이 단계만은 컴퓨터에서 명령어를 입력해야 합니다. 개발자에게 아래를 전달하세요.

```bash
# 1) Supabase CLI 설치 (한 번만)
npm install -g supabase

# 2) 로그인
supabase login

# 3) 프로젝트 연결 (<project-ref>는 대시보드 주소에 있는 값)
supabase link --project-ref <project-ref>

# 4) 배포
supabase functions deploy delete-account
```

배포 후 대시보드 **Edge Functions → delete-account → Secrets** 에서
`SUPABASE_SERVICE_ROLE_KEY` 가 설정되어 있는지 확인하세요.
(보통 자동으로 주입되지만, 없으면 **Settings → API** 의 `service_role` 키를 넣습니다.)

> 🔐 `service_role` 키는 절대 앱 코드나 GitHub에 넣지 마세요. 이 키는 모든 보안
> 규칙을 무시할 수 있습니다.

### 5-1. `ALLOWED_ORIGINS` (필수, CORS 허용 목록)

**Edge Functions → delete-account → Secrets** 에 `ALLOWED_ORIGINS` 를 추가하세요.

형식은 **쉼표로 구분한 정확한 origin 목록**입니다. 와일드카드(`*`), 하위 도메인
패턴, 뒤에 붙는 슬래시는 지원하지 않습니다. 비교는 문자열 완전 일치입니다.

```
ALLOWED_ORIGINS=https://gomsinlog.app,https://www.gomsinlog.app
```

| 상황 | 함수 응답 |
| --- | --- |
| 목록에 있는 origin | 그 origin 을 그대로 반사 (`Access-Control-Allow-Origin`) |
| 목록에 없는 origin | `403`, `Access-Control-Allow-Origin` 없음 |
| `Origin` 헤더가 아예 없음 | 허용 (아래 설명 참고) |
| `ALLOWED_ORIGINS` 미설정 | **모든 요청에 `500`** (fail closed) |

- **미설정이면 함수가 완전히 멈춥니다.** 이것은 의도된 동작입니다. 예전처럼
  `*` 로 되돌아가는 fallback 은 존재하지 않습니다. 배포 후 반드시 설정하세요.
- **`Origin` 헤더가 없는 요청은 허용합니다 — 이것은 명시적으로 받아들인 위험입니다.**
  브라우저가 아닌 클라이언트(curl, 서버 간 호출)는 `Origin` 을 보내지 않으므로
  CORS 로 막을 수 없습니다. 보완 통제는 **Bearer 토큰 검증이 여전히 필수**라는
  점입니다. 토큰 없이는 `401` 이고, 어떤 계정도 삭제되지 않습니다.
- 모든 응답(성공·`403`·`401`·`405`·`500`·preflight)에 `Vary: Origin` 이 붙습니다.
  공용 캐시가 한 origin 의 응답을 다른 origin 에 재생하지 못하게 하기 위한 것이며,
  선택 사항이 아닙니다.

> 이 저장소는 `ALLOWED_ORIGINS` 를 어떤 원격 환경에도 설정하지 않았습니다.
> 값을 넣는 것은 운영자가 직접 해야 하는 단계입니다.

### 5-2. `app_metadata.account_deletion_pending` (운영자가 반드시 알아야 할 것)

`delete-account` 함수는 데이터를 지우기 **전에** service_role 키로 해당 계정의
Auth `app_metadata` 에 `account_deletion_pending: true` 를 기록합니다.

- 이 플래그는 **탈퇴 복구의 1차 권한(primary authority)** 입니다. 브라우저 저장소를
  지워도, 시크릿 창을 써도, 다른 기기에서 로그인해도 계정과 함께 따라옵니다.
  클라이언트는 이 값을 쓸 수 없습니다(`user_metadata` 가 아니라 `app_metadata`).
- **플래그 기록이 실패하면 아무것도 지우지 않습니다.** 응답은 `dataRemoved: false`
  이고 계정은 그대로 남습니다. 다시 시도하면 같은 값을 다시 쓰므로 안전합니다.
- **Auth 사용자 삭제가 실패하면 플래그는 의도적으로 그대로 남습니다.** 이것은
  정리해야 할 버그가 아닙니다. 데이터가 이미 사라진 계정을 복구 상태로 붙잡아 두는
  장치입니다.
- **운영자가 이 값을 손으로 지우면, 데이터가 이미 사라진 앱으로 사용자를 다시
  들여보내는 것입니다.** 그렇게 하지 마세요.
- Auth 사용자 삭제가 성공하면 사용자와 `app_metadata` 가 함께 사라지므로 플래그도
  같이 없어집니다. 성공 경로에서 플래그를 따로 지우는 호출은 없습니다.
- **서버가 확인해 주는 "탈퇴 취소" 절차는 현재 존재하지 않습니다.** 이 수정도 그런
  절차를 만들지 않았습니다. 어떤 운영 절차나 코드 경로도 그런 것이 있는 것처럼
  동작해서는 안 됩니다.

> 이 저장소는 함수를 배포하지 않았고, 원격 환경에 어떤 값도 설정하지 않았습니다.
> 배포와 설정은 운영자가 직접 해야 하는 단계입니다.

---
## 5-3. 의존성 보안 권고 처리 기록

`npm audit` 결과에 남는 항목은 아래 두 건뿐이며, 각각 근거가 기록되어 있습니다.

### `brace-expansion` — GHSA-mh99-v99m-4gvg (해결됨)

- 개발 도구 전용 경로(`eslint` → `minimatch@3` → `brace-expansion`)에서만 나타났던
  5건의 권고입니다. 런타임 번들에는 포함되지 않습니다.
- `package.json` 의 `overrides` 로 **1.1.18** 에 고정해 해결했습니다.
- 이전 감사 문서(7-3절)는 "1.x 라인에 패치된 릴리스가 없다"고 결론했지만,
  **레지스트리를 직접 확인한 결과 1.x 라인에 1.1.18 이 존재합니다**(5.x 라인은 5.0.9).
  레지스트리 확인이 감사 문서의 결론을 대체합니다.
- **5.x 가 아니라 1.x 를 선택한 이유**: `minimatch@3` 은 CommonJS `require` 형태로
  이 패키지를 불러옵니다. 5.x 는 export 형태가 바뀌어 lint 가 깨질 위험이 있고,
  그것이 감사 7-3절이 지적한 바로 그 위험입니다.
- **안전성 증거**: 고정 후 `npm run lint` 가 **에러 0건 / 경고 0건**입니다.
  `brace-expansion` 변경이 `minimatch@3` 의 CJS `require` 를 깨뜨린다면 그것은
  수정이 아니라 회귀이므로, 우회하지 말고 되돌려야 합니다.
- **`npm audit fix --force` 는 절대 실행하지 않습니다.**

### `react-router` — GHSA-qwww-vcr4-c8h2 (조건부 수용)

- 대상: `react-router` / `react-router-dom` **7.18.2** (핀 고정).
- **적용되지 않는 이유(전제 조건)**: 이 앱은 정적 Vite SPA 이고 `BrowserRouter` 만
  선언적으로 사용합니다. Framework Mode 없음, RSC 없음, `loader` 없음, `action` 없음,
  `useFetcher` 없음, react-router `<Form>` 없음, 서버 라우트 없음. 권고는 RSC 모드의
  action 실행 경로에 관한 것이므로 이 구성에서는 도달할 수 없습니다.
- **수용이 무효화되는 조건(invalidation trigger)**: 위 기능 **중 하나라도** 도입하면
  이 수용은 무효가 되며 즉시 재평가해야 합니다.
- 7.11.0 으로의 무조건 다운그레이드와 메이저 업그레이드는 **모두 금지**합니다.
  전자는 이 저장소가 검증한 동작을 되돌리고, 후자는 검증되지 않은 변경입니다.

---

## 6. 앱 환경변수

앱을 배포하는 곳(Vercel/Netlify 등)에 아래 두 개를 넣습니다.
`.env` 파일은 GitHub에 올리지 않습니다.

```
VITE_SUPABASE_URL=https://<프로젝트>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon / publishable 키>
```

`.env.example` 에 형식이 적혀 있습니다.
**`service_role` 키는 여기에 넣으면 안 됩니다.**

---

## 7. 마지막 확인

- [ ] 백업 완료
- [ ] `trip_items.url` 탐지 쿼리 결과 0 행 (015 실패 예방)
- [ ] 013 스테이징 적용 + 검증 통과
- [ ] 014 스테이징 적용 + 2계정/RLS/Realtime 검증 통과
- [ ] 015 스테이징 적용 + 검증 통과 + 사람 확인 4항목 통과
- [ ] 스테이징 schema cache 재적재 후 초대 코드 연결 성공 확인
- [ ] 013 운영 적용 + 검증 통과
- [ ] 014 운영 적용 + 검증 통과
- [ ] 015 운영 적용 + 검증 통과
- [ ] 운영 schema cache 재적재 (안 하면 초대 연결이 거부됩니다)
- [ ] `couple-media` 버킷 비공개 확인
- [ ] Storage 정책 존재 확인
- [ ] Redirect URLs 3개 등록 (`gomsinlog://` 포함)
- [ ] Google 로그인 제공자 설정
- [ ] `delete-account` 배포 + 시크릿 확인
- [ ] 배포 환경변수 2개 설정
- [ ] `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md` 의 2계정 테스트 통과

문제가 생기면 `docs/operations/rollback-runbook.md` 와
`docs/kiro/ROLLBACK_GUIDE.md` 를 보세요.
