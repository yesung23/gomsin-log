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
| `002_fix_rls_recursion.sql` | RLS 무한 재귀 수정 (002 중복 번호) | 적용됨으로 가정 |
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
| `013_invitation_hardening.sql` | 초대코드 무차별 대입 방어 + 코드 재발급 | **신규 / 원격 미적용** |
| `014_feature_privacy_and_collaboration.sql` | 일정/여행/주기 RLS, sanitized support, 협업 Realtime·정합성 | **신규 / 원격 미적용** |

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

### 013 적용 전에도 앱은 동작합니다

앱은 `redeem_invitation` 이 없으면 자동으로 기존 `consume_invitation` 으로
되돌아가고, 콘솔에 경고를 남깁니다. 초대코드 재발급 버튼은 "서버에 아직 배포되지
않았습니다" 라는 안내를 보여줍니다. 즉 **013은 보안상 반드시 필요하지만, 앱이
깨지지는 않습니다.**

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

## 적용 순서 (사람이 직접)

```
1. Supabase 대시보드 → Database → Backups 에서 백업 생성
2. 스테이징 프로젝트에서 013 실행 후 아래 013 검증
3. 스테이징 프로젝트에서 014 실행 후 배포 체크리스트의 014 검증
4. `docs/kiro/MANUAL_TWO_ACCOUNT_TEST.md`의 A/B/C 테스트 통과
5. 운영 프로젝트에 013 → 014 순서로 실행
6. 운영에서 초대/일정/여행/주기/연결 해제 흐름 재확인
```

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

## 014 롤백 주의

014는 새 테이블·column·정책·publication을 함께 변경하므로 먼저 백업으로 복원하는
방법을 우선합니다. 수동 롤백은 migration 파일 하단 순서대로 5개 Realtime 항목,
`collaboration_invalidations`/`cycle_support_signals`, 관련 함수·트리거,
`cycle_entries.symptoms`, event/trip 정책 순으로 처리합니다.

- `event_type='date'` 행을 변환하기 전에 예전 constraint를 복원하지 마세요.
- support/invalidation 테이블 삭제 전 필요한 감사 데이터를 백업하세요.
- 원격 적용·롤백 모두 아직 실행되지 않았습니다.

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
