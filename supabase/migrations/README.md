# Supabase 마이그레이션 안내

이 폴더의 `.sql` 파일은 **번호 순서대로** 적용합니다. 파일을 직접 수정하지 말고,
변경이 필요하면 새 번호의 파일을 추가하세요.

> ⚠️ 이 저장소의 코드만으로는 원격 Supabase 프로젝트의 실제 상태를 알 수 없습니다.
> 아래 "적용 순서"를 반드시 스테이징 프로젝트에서 먼저 검증하세요.

## 파일 목록

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `001_initial_schema.sql` | 최초 스키마 (profiles, couples, couple_members, invitation_codes, daily_records, briefings, events, trips, trip_items, trip_checklists, contact_preferences) | 적용됨으로 가정 |
| `002_fix_rls_and_rpc.sql` | 초기 RLS/RPC 수정 | 적용됨으로 가정 |
| `002_fix_rls_recursion.sql` | RLS 무한 재귀 수정 (002 중복 번호 — 아래 "002 번호 중복" 참고) | 적용됨으로 가정 |
| `003_add_emotion_flow.sql` | `daily_records.emotion_flow` 추가 | 적용됨으로 가정 |
| `004_create_cycle_tables.sql` | 주기 기록 테이블 | 적용됨으로 가정 |
| `005_secure_rls_policies.sql` | RLS 정책 강화, `events.visibility` → `is_private` | 적용됨으로 가정 |
| `006_auth_and_rpc_fixes.sql` | 인증/RPC 수정 | 적용됨으로 가정 |
| `007_storage_policies.sql` | `couple-media` 비공개 버킷 + Storage 정책 | **필수** |
| `008_membership_integrity.sql` | 멤버십 정합성 | 적용됨으로 가정 |
| `009_remote_core_security_hotfix.sql` | 핵심 보안 핫픽스 (`get_my_active_couple_id`, 커플/초대 RPC, daily_records RLS) | **필수** |
| `010_revoke_anon_rpc_access.sql` | `anon` 역할의 RPC 실행 권한 회수 | **필수** |
| `011_create_missing_feature_tables.sql` | events/trips/cycle 테이블 + Realtime publication | **필수** |
| `012_authenticated_core_table_grants.sql` | `authenticated` 역할 테이블 권한 | **필수** |
| `013_invitation_hardening.sql` | 초대코드 무차별 대입 방어 + 코드 재발급 | **테스트 프로젝트에 적용됨** (아래 주의 참고) |
| `014_feature_privacy_and_collaboration.sql` | 일정/여행/주기 RLS, sanitized support, 협업 Realtime·정합성 | **테스트 프로젝트에 적용됨** |
| `015_security_followup.sql` | 초대 우회·경합 차단, 계정 삭제 트랜잭션, 비공개 일정 알림 차단, 여행 URL/순서 제약 | **테스트 프로젝트에 적용됨** |
| `016_couple_state_visibility.sql` | `get_my_couple_state()` 읽기 전용 RPC (커플 생애주기·초대 유효성) | **신규 / 원격 미적용** |
| `017_partner_profile_hardening_and_schema_reload.sql` | `get_partner_profile()` 의 `search_path` 를 `public, pg_temp` 로 고정 + `NOTIFY pgrst, 'reload schema'` | **신규 / 원격 미적용** |
| `018_shared_tasks_and_trip_places.sql` | 커플 공동 할 일 + 여행 장소 주소·영업시간·좌표·입력 출처 | **신규 / 원격 미적용** |
| `019_call_topics_and_trip_timetable.sql` | 통화 주제 표시 + 여행 장소 방문 시간 | **신규 / 원격 미적용** |
| `020_fix_uuid_active_couple_lookup.sql` | `min(uuid)` 때문에 발생하는 로그인 후 `42883` 복구 | **운영 적용됨 (2026-08-09)** |
| `021_restore_profile_military_info.sql` | 운영에서 누락된 `profiles.military_info` 복구 | **운영 적용됨 (2026-08-09)** |

## 002 번호 중복 (이름을 바꾸지 않는 이유)

`002_fix_rls_and_rpc.sql` 와 `002_fix_rls_recursion.sql` 는 번호가 같습니다.
**둘 다 이미 원격에 적용되었으므로 파일 이름을 바꾸지 않습니다** — 이름을 바꾸면
마이그레이션 이력과 실제 DB 상태가 어긋납니다.

- 적용 순서는 파일 이름 전체의 사전순입니다. 즉 `_and_rpc` → `_recursion`.
- **신규 프로젝트에서 위 순서로 그대로 실행하면 002 단계에서 실패합니다.**
  `_recursion` 이 `Users can create couples` 등의 정책을 `DROP POLICY IF EXISTS`
  없이 다시 만들기 때문에 `policy already exists` 오류가 납니다.
  → 신규 프로젝트에서는 `_recursion` 의 `CREATE POLICY` 앞에 해당 정책을 먼저
  `DROP POLICY IF EXISTS` 로 지운 뒤 실행하세요. 두 파일이 만든 정책은 이후
  `005_secure_rls_policies.sql` 와 `009_remote_core_security_hotfix.sql` 가 다시
  정의하므로, 최종 상태는 순서와 무관하게 같습니다.
- 새 마이그레이션은 반드시 새 번호를 쓰세요. 이 규칙은
  `src/lib/migrationSecurityContracts.test.ts` 가 검사합니다 (017 이후 번호 중복 금지).

## 017이 하는 일

1. **`get_partner_profile()` 하드닝.** 트리 안에서 유일하게 `search_path` 에
   `pg_temp` 가 없던 SECURITY DEFINER 함수입니다(`001:278-282` 에서 한 번 만들어진 뒤
   재정의된 적이 없고, 009·010 은 권한만 바꿨습니다). 시그니처와 반환 컬럼은 001과
   **완전히 동일**하며 동작도 그대로입니다. 권한은 `authenticated` 만
   `EXECUTE` 합니다.
2. **PostgREST 스키마 캐시 리로드.** 이 저장소의 어떤 마이그레이션도
   `NOTIFY pgrst, 'reload schema'` 를 실행하지 않았습니다(016:52 는 주석입니다).
   013~016 이 만든/바꾼 함수 시그니처는 모두 사람이 대시보드에서 리로드해 주기를
   기다렸고, 그 사이 클라이언트는 `PGRST202` 를 받습니다. 017 은 트랜잭션 안에서
   `NOTIFY` 를 실행하므로(알림은 COMMIT 시 전달됩니다) 롤백된 적용이 캐시를
   리로드시키는 일은 없습니다. 리로드 한 번이 캐시 전체를 갱신합니다.

017 은 재실행해도 no-op 입니다(정확한 시그니처로 `DROP FUNCTION IF EXISTS` → 동일한
정의로 재생성 → 동일한 권한 재적용). 롤백 블록은 파일 하단에 주석으로 있습니다.
**아직 원격에 적용되지 않았습니다.**

> 013·014·015 는 테스트 Supabase 프로젝트에 수동으로 적용되었고 PostgREST 스키마
> 캐시도 리로드되었습니다. 013 적용 중
> `cannot change return type of existing function redeem_invitation(text)` 오류가
> 발생해, 해당 함수를 정확한 시그니처로 DROP 한 뒤 013~015 를 다시 실행하여
> 해결했습니다. 재발 방지 규칙은 아래 "함수 반환형 변경 규칙" 에 있습니다.
> **016 은 아직 어디에도 적용되지 않았습니다.**

## 013이 하는 일

1. **초대코드 무차별 대입 방어**
   초대코드는 숫자 6자리(100만 가지)이고 24시간 동안 유효합니다. 기존
   `consume_invitation` 에는 시도 횟수 제한이 없어서, 로그인한 사용자라면 누구나
   전체 조합을 대입해 **남의 커플 공간에 들어갈 수 있었습니다.**
   → 10분에 5회, 24시간에 20회 실패로 제한합니다.
   (앱 안에도 같은 제한이 있지만, 그것은 RPC를 직접 호출하면 우회되므로
   서버 쪽 제한이 실제 방어선입니다.)

2. **초대코드 재발급**
   서버에는 코드의 해시만 저장합니다. 그래서 코드를 만든 사람이 브라우저 저장소를
   지우면 코드를 되살릴 방법이 없고, "한 사람은 하나의 활성 커플만" 제약 때문에
   새 공간도 만들 수 없어 **막다른 길**이 됩니다.
   → `regenerate_invitation` 으로 새 코드를 발급하고 이전 코드는 무효화합니다.

3. **`invitation_codes` 읽기 권한 제거**
   앱은 이 테이블을 직접 읽을 필요가 없습니다(모든 변경은 SECURITY DEFINER 함수
   안에서 일어납니다). 읽기를 막아 해시 탐색과 타 커플 메타데이터 조회를 차단합니다.

### 013·015 적용 전에는 초대 연결이 동작하지 않습니다 (의도된 동작)

예전 클라이언트는 `redeem_invitation` 이 없으면 `consume_invitation` 으로
되돌아갔습니다. 그 fallback은 **제거했습니다.** `consume_invitation` 에는 시도
횟수 제한이 없어서, fallback이 남아 있으면 013이 막으려는 무차별 대입을 그대로
다시 열어주기 때문입니다.

이제 클라이언트는 015의 `{ok, couple_id, error_code}` 형태만 받아들이고, 함수가
없거나(`PGRST202`) 예전의 UUID 반환 형태이면 **연결을 거부하고** "서버에 안전한
초대 코드 확인 기능이 아직 배포되지 않았습니다" 를 보여줍니다.

즉 015 배포는 초대 기능의 **선행 조건**입니다. 나머지 화면(기록·일정·여행·주기)은
015 없이도 동작합니다.

## 014가 하는 일

1. **일정 프라이버시**: 비공개는 작성자만, 공유는 현재 활성 커플만 SELECT.
   INSERT/UPDATE/DELETE는 작성자와 활성 workspace를 operation별 정책으로 검사하고
   event 식별자 변경은 트리거로 금지합니다.
2. **공동 여행**: 활성 커플 양쪽이 parent/child를 공동 편집합니다. child 날짜는
   parent row를 잠근 뒤 범위를 검사하고, 순서는 `reorder_trip_items(UUID[], INTEGER[])`
   RPC에서 한 트랜잭션으로 변경합니다.
3. **개인 주기**: `cycle_entries`와 `cycle_settings`는 owner-only이며 Realtime
   publication에서 명시적으로 제거합니다.
4. **최소 배려 공유**: 별도 `cycle_support_signals`만 사용합니다. 사용자가 고른
   비의료 enum + 선택 80자 메시지이며 한국 기준 당일, 최대 24시간, one-way revoke,
   한 owner/couple/date당 active 1개를 강제합니다.
5. **안전한 무효화**: `collaboration_invalidations`에는 민감 본문 없이 couple/slice/time만
   저장해 공유→비공개·철회 시 파트너가 RLS 기준으로 다시 조회합니다.
6. **연결 해제 복구**: `couple_members`, trip children, support, invalidation을 Realtime에
   추가합니다. raw cycle은 추가하지 않습니다.

## 015가 하는 일

1. **초대 우회 차단**: `consume_invitation` 의 `authenticated` 실행 권한을 회수합니다.
   013이 만든 제한은 `redeem_invitation` 안에만 있었기 때문에, 클라이언트가
   `consume_invitation` 을 직접 호출하면 제한이 통째로 우회됐습니다.
2. **실패 기록이 사라지지 않게**: 예전 `redeem_invitation` 은 실패를 기록한 뒤
   `RAISE` 로 예외를 던졌고, 그러면 **같은 트랜잭션의 기록도 함께 롤백**됐습니다.
   → 예상된 실패는 예외 대신 `error_code` 로 반환합니다(반환형이 `JSONB` 로 바뀜).
   시도 횟수 초과(`rate_limited`)처럼 코드를 조회하기도 전에 결정되는 결과는
   횟수에 포함하지 않습니다. 포함하면 재시도하는 클라이언트가 자기 잠금을
   무한히 연장했습니다. "이미 2명" 도 `invalid_or_expired` 로 합칩니다. 구분해서
   알려주면 추측한 해시가 살아 있는 초대와 맞았다는 사실을 알려주게 됩니다.
3. **경합 차단**: 초대 사용·재발급·연결 해제·계정 삭제가 모두 `couples` 부모 row를
   먼저 잠그고, 잠금을 기다린 뒤 멤버십을 다시 확인합니다. 연결 해제와 초대 사용이
   겹칠 때 한쪽만 활성으로 남는 문제를 막습니다.
4. **계정 삭제**: `begin/prepare/cancel_account_deletion` (service_role 전용)으로
   미디어 정리 → 트랜잭션 정리 → auth 삭제 순서를 강제합니다. 공유 일정·여행은
   **활성 파트너에게만** 넘기고, 남은 사람이 없으면 명시적으로 삭제합니다.
   (예전에는 이미 연결이 끊긴 상대에게 넘겨서, 아무도 읽을 수 없는 데이터가
   영구히 남았습니다.)
5. **비공개 일정 알림 차단**: 무효화 트리거를 공유 일정 변화로 제한하고,
   **`public.events` 를 Realtime publication에서 제거합니다.** Realtime은 DELETE
   payload에 RLS를 적용하지 않아서, 트리거만 고쳐도 파트너는 "상대가 방금 비공개
   일정을 지웠다"는 타이밍을 계속 알 수 있었습니다.
6. **여행 정합성**: `url` 은 DB에서 `http(s)` 만 허용하고, 항목 순서는 하루 단위
   유니크 제약 + `reorder_trip_items` 의 permutation 검증으로 고정합니다.
7. **Storage 경로 고정**: `{couple_id}/{record_id}/{파일명}` 3단만 허용합니다.
   더 깊은 이름을 허용하면 Storage가 그 중간 단계를 "폴더"로 보고하고
   `remove()` 가 조용히 무시해서, 계정 삭제 시 폴더를 비울 수 없었습니다.

## 적용 순서 (사람이 직접)

```
1. Supabase 대시보드 → Database → Backups 에서 백업 생성
2. 스테이징 프로젝트에서 013 실행 후 아래 013 검증
3. 스테이징 프로젝트에서 014 실행 후 배포 체크리스트의 014 검증
4. 스테이징 프로젝트에서 015 실행 후 아래 015 검증
5. Supabase 대시보드 → Settings → API → "Reload schema cache" 실행
   (015가 redeem_invitation 의 반환형을 바꾸므로 PostgREST가 새 형태를
    인식해야 합니다. 이 단계를 빼면 클라이언트가 fail closed 로 거부합니다.)
6. `supabase functions deploy delete-account` (015 이후에)
7. `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md`의 A/B/C 테스트 통과
8. 운영 프로젝트에 013 → 014 → 015 순서로 실행하고 5~6단계를 반복
9. 운영에서 초대/일정/여행/주기/연결 해제/계정 삭제 흐름 재확인
```

> ⚠️ 015는 `trip_items.url` 에 `http(s)` 가 아닌 값이 하나라도 있으면 **전체가
> 취소됩니다** (의도된 동작 — 데이터를 조용히 버리지 않습니다). 실행 전에 파일
> 안의 탐지 쿼리를 먼저 돌려 해당 행을 정리하세요.

실행 방법: Supabase 대시보드 → **SQL Editor** → 파일 내용 전체 붙여넣기 → Run.
파일은 `BEGIN; ... COMMIT;` 으로 감싸져 있어 중간에 실패하면 전체가 취소됩니다.

## 013 검증 쿼리

```sql
-- 1. 함수가 생성되었는지
SELECT proname FROM pg_proc
WHERE proname IN ('redeem_invitation','regenerate_invitation','prune_invitation_attempts');
-- 3개 행이 나와야 합니다.

-- 2. anon 역할이 실행할 수 없는지 (결과가 false 여야 합니다)
SELECT has_function_privilege('anon', 'public.redeem_invitation(text)', 'EXECUTE');
SELECT has_function_privilege('anon', 'public.regenerate_invitation(text)', 'EXECUTE');

-- 3. authenticated 역할은 실행할 수 있는지 (true 여야 합니다)
SELECT has_function_privilege('authenticated', 'public.redeem_invitation(text)', 'EXECUTE');

-- 4. invitation_codes 직접 읽기가 막혔는지 (false 여야 합니다)
SELECT has_table_privilege('authenticated', 'public.invitation_codes', 'SELECT');

-- 5. 시도 기록 테이블에 클라이언트가 접근할 수 없는지 (모두 false)
SELECT has_table_privilege('authenticated', 'public.invitation_attempts', 'SELECT');
SELECT has_table_privilege('authenticated', 'public.invitation_attempts', 'INSERT');
```

## 015 검증 쿼리

```sql
-- 1. consume_invitation 우회 경로가 닫혔는지 (false 여야 합니다)
SELECT has_function_privilege('authenticated', 'public.consume_invitation(text)', 'EXECUTE');

-- 2. redeem_invitation 이 JSONB 를 반환하는지 ('jsonb' 여야 합니다)
SELECT pg_catalog.format_type(prorettype, NULL)
FROM pg_proc WHERE proname = 'redeem_invitation';

-- 3. 계정 삭제 RPC 는 service_role 만 (authenticated 는 모두 false)
SELECT has_function_privilege('authenticated', 'public.begin_account_deletion(uuid,uuid[])', 'EXECUTE');
SELECT has_function_privilege('authenticated', 'public.prepare_account_deletion(uuid,uuid[])', 'EXECUTE');
SELECT has_function_privilege('authenticated', 'public.cancel_account_deletion(uuid)', 'EXECUTE');

-- 4. events 가 Realtime publication 에서 빠졌는지 (0 행이어야 합니다)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events';

-- 5. 무효화 채널은 남아 있어야 합니다 (1 행)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename = 'collaboration_invalidations';

-- 6. 원본 주기 기록은 여전히 publication 밖 (0 행)
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  AND tablename IN ('cycle_entries','cycle_settings');

-- 7. 제약/인덱스가 생성되었는지 (3 행)
SELECT conname FROM pg_constraint
WHERE conname IN ('trip_items_http_url_check','trip_items_unique_day_order');
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_invitation_codes_one_unused_hash';

-- 8. 사용되지 않은 초대 해시가 하나뿐인지 (모든 행의 count 가 1)
SELECT code_hash, count(*) FROM public.invitation_codes
WHERE used = false GROUP BY code_hash HAVING count(*) > 1;
-- 0 행이어야 합니다.
```

### 스테이징에서 반드시 사람이 확인할 것

정적 분석으로는 판단할 수 없어 실제 프로젝트에서만 확인 가능한 항목입니다.

- `begin_account_deletion` 의 `LOCK TABLE storage.objects IN SHARE MODE` 가
  권한 오류(`42501`) 없이 통과하는지. 이 테이블은 `supabase_storage_admin`
  소유이고, 잠금이 유지되는 동안 프로젝트 전체 Storage 메타데이터 쓰기가 대기합니다.
- 비공개 일정을 A가 삭제할 때 B의 채널이 반응하지 **않는지** (4번 쿼리와 짝).
- `reorder_trip_items` 로 같은 날 두 항목의 순서를 바꿀 때 유니크 제약 위반이
  나지 않는지 (`DEFERRABLE` + `SET CONSTRAINTS ... DEFERRED` 동작 확인).
- 제목만 수정하는 저장이 `Trip item order must be changed through
  reorder_trip_items` 없이 성공하는지.
- 계정 삭제 후 상대의 공유 일정·여행이 남아 있고 열람 가능한지.

## 014 롤백 주의

014는 새 테이블·column·정책·publication을 함께 변경하므로 먼저 백업으로 복원하는
방법을 우선합니다. 수동 롤백은 migration 파일 하단 순서대로 5개 Realtime 항목,
`collaboration_invalidations`/`cycle_support_signals`, 관련 함수·트리거,
`cycle_entries.symptoms`, event/trip 정책 순으로 처리합니다.

- `event_type='date'` 행을 변환하기 전에 예전 constraint를 복원하지 마세요.
- support/invalidation 테이블 삭제 전 필요한 감사 데이터를 백업하세요.
- 원격 적용·롤백 모두 아직 실행되지 않았습니다.

## 015 롤백 주의

상세 순서는 `015_security_followup.sql` 파일 하단에 있습니다. 특히:

- **`consume_invitation` 의 `authenticated` 실행 권한은 되돌리지 마세요.**
  그 회수를 롤백하면 초대코드 시도 제한 우회가 다시 열립니다.
- 015를 되돌리면 클라이언트도 함께 되돌려야 합니다. 현재 클라이언트는 015의
  `JSONB` 형태만 받아들이고 예전 형태는 거부합니다.
- 순서 정규화와 모호한 초대코드 무효화는 데이터 변경이라 되돌아가지 않습니다.
- `public.events` 를 publication 에 다시 넣으면 비공개 일정 삭제 타이밍 유출도
  함께 돌아옵니다.

## 016이 하는 일

`016_couple_state_visibility.sql` 은 **추가만 하는(additive) 읽기 전용
마이그레이션**입니다. 기존 테이블·정책·권한·publication 은 하나도 건드리지
않습니다.

추가되는 것: `public.get_my_couple_state()` (`RETURNS JSONB`, `STABLE`,
`SECURITY DEFINER`, `authenticated` 에만 `EXECUTE`).

**왜 필요한가.** 013 §6 이 `invitation_codes` 의 클라이언트 `SELECT` 를 모두
회수했습니다(그 자체로는 올바른 조치입니다 — 해시 probing 을 막습니다). 그 결과
클라이언트가 아래 세 가지를 전혀 구분할 수 없게 되었습니다.

- 공간을 만들고 상대를 기다리는 중 (pending, 코드 유효)
- 초대 코드가 만료됨 (pending, 코드 만료)
- 커플 공간이 아예 없음 (personal)

그래서 초대 코드를 들고 있는 생성자에게 "초대 코드를 입력하세요" 라는 안내가
표시되었습니다. `redeem_invitation` 이 `self_invitation` 으로 거부하는 바로 그
행동입니다.

**반환하지 않는 것.** 초대 코드 평문도, `code_hash` 도 절대 반환하지 않습니다.
반환값은 `couple_id`, `role`, `member_status`, `partner_present`(불리언),
`invitation_active`(불리언), `invitation_expires_at` 뿐입니다. 파라미터가 없으므로
다른 사용자의 상태를 요청할 수단 자체가 없습니다.

**적용 상태: 원격에 아직 적용되지 않았습니다.** 적용 절차는
`docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` §2-6 을 따르세요. 적용 후
**PostgREST 스키마 캐시 리로드가 필수**입니다. 리로드하지 않으면 RPC 가
`PGRST202` 를 반환하고, 클라이언트는 이를 "서버에 기능이 배포되지 않음" 으로
표시합니다(커플 공간이 없다고 잘못 표시하지 않습니다).

### 함수 반환형 변경 규칙 (013 원격 실패에서 배운 것)

013 을 원격에 적용할 때 다음 오류가 발생했습니다.

```
cannot change return type of existing function redeem_invitation(text)
```

`CREATE OR REPLACE FUNCTION` 은 반환형을 바꿀 수 없습니다. 015 는
`DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);` 로 이미 이 문제를
해결했고, **016 이후 모든 마이그레이션은 정의하는 모든 함수에 대해 정확한 시그니처로
`DROP FUNCTION IF EXISTS` 를 먼저 실행합니다.** 이 규칙은
`src/lib/migration016.test.ts` 가 자동으로 검사합니다.

## 정리 작업 (선택)

`invitation_attempts` 는 계속 쌓입니다. Supabase 대시보드의
**Database → Cron** 에서 하루 한 번 정리하도록 등록할 수 있습니다.

```sql
SELECT cron.schedule('prune-invitation-attempts', '0 4 * * *',
  $$SELECT public.prune_invitation_attempts()$$);
```

## Edge Function

`supabase/functions/delete-account` 는 마이그레이션이 아니라 별도 배포입니다.

```
supabase functions deploy delete-account
```

배포 전에 `docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md` 를 확인하세요.
이 함수는 서비스 롤 키를 사용하므로 `SUPABASE_SERVICE_ROLE_KEY` 가 함수 환경변수로
설정되어 있어야 합니다.
## 019 — 통화 주제·여행 시간표

`019_call_topics_and_trip_timetable.sql`은 기록·일정·여행 장소에 `통화 때 꼭 얘기` 표시를 추가하고,
여행 장소에 방문 시간을 저장합니다. 018까지 적용한 뒤 Supabase SQL Editor에서 실행하세요.

## 022 — V3 cycle tables
`022_cycle_v3_schema.sql`은 생리 기간(`cycle_periods`), 일별 컨디션(`cycle_daily_logs`), 민감정보 동의(`user_sensitive_consents`), 공유 옵션(`cycle_sharing_preferences`) 테이블을 생성하고 legacy 데이터를 안전하게 이관합니다. (신규 / 원격 적용 미확인)
