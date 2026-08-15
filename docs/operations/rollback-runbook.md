# Rollback Runbook

만약 005~007 마이그레이션을 데이터베이스에 배포(push)한 이후 심각한 서비스 장애가 발생했다면, 보안 수준을 치명적으로 낮추거나 사용자 데이터를 파괴(삭제)하지 않는 선에서 롤백(또는 Forward-fix)을 수행해야 합니다.

## 1. 정책 다운그레이드 원칙
- **절대 불가**: `USING (true)` 정책을 다시 부활시키거나, `couple-media` 버킷을 삭제/public으로 되돌리는 롤백은 금지됩니다.
- **방향성**: 문제가 되는 특정 RLS나 RPC를 부분적으로 완화(예: `is_private` 조건을 일시 무시)하거나, 008 Forward-fix 마이그레이션으로 덮어씁니다.

## 2. 장애별 대응 시나리오

### 장애 시나리오 A: 모든 사용자의 데이터가 안 보일 때 (RLS Helper Error)
`get_my_active_couple_id()`가 잘못 동작하여 모든 권한 검사가 실패하는 경우.
- **조치**: 008 마이그레이션을 통해 `get_my_active_couple_id()` 함수 내의 예외 발생 로직(`RAISE EXCEPTION`)을 완화하거나, 서브쿼리(`SELECT couple_id FROM couple_members WHERE user_id = auth.uid() LIMIT 1`) 방식으로 되돌려 빠른 복구를 시도합니다.

### 장애 시나리오 B: 이미지 업로드 / Signed URL 생성 실패
`create-media-signed-url` Edge Function 배포가 누락되었거나 Storage RLS와 충돌하는 경우.
- **조치**: Edge Function 코드를 긴급 수정하여 배포하거나, 만약 RLS 문제라면 008 마이그레이션을 통해 Storage의 SELECT 권한에서 `daily_records` JOIN 조건을 일시적으로 제거하여 `(storage.foldername(name))[1] = public.get_my_active_couple_id()::text` 까지만 검사하도록 완화합니다. 버킷 자체는 계속 private이어야 합니다.

### 장애 시나리오 C: 파트너가 연결 해제를 했는데 본인은 active로 남은 경우 (006 적용 전 발생 건)
이미 006 이전에 비대칭 해제가 발생한 유저들의 경우 006 코드가 소급 적용되지 않습니다.
- **조치**: 데이터베이스 콘솔(또는 스크립트)을 통해 한쪽만 `disconnected`된 커플 ID를 찾아 파트너의 상태도 일괄 업데이트하는 Data Patch SQL을 1회 실행합니다.

## 3. 완전 롤백 스크립트 (주의)
만약 005~007 마이그레이션 자체를 완전히 되돌려야 하는 최악의 상황이라면, 다음과 같이 001 시점의 최소 권한(002의 위험한 `USING(true)` 제외)으로 되돌리는 스크립트를 적용합니다. **단, 이미 업로드된 미디어 파일은 절대 삭제하면 안 됩니다.**

```sql
-- 008_emergency_rollback.sql

-- 1. Storage RLS 롤백 (버킷은 유지)
DROP POLICY IF EXISTS "Active members can insert into couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can read couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can delete from couple-media" ON storage.objects;
-- (필요시 001 수준의 느슨한 정책 재작성)

-- 2. RPC 롤백 (006 이전, 001 버전으로 복원하되 버그 포함 상태이므로 신중할 것)
CREATE OR REPLACE FUNCTION public.disconnect_couple() RETURNS void AS $$ BEGIN UPDATE couple_members SET status = 'disconnected' WHERE user_id = auth.uid() AND status = 'active'; END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Helper Function 및 RLS 롤백
DROP FUNCTION IF EXISTS public.get_my_active_couple_id() CASCADE;
CREATE OR REPLACE FUNCTION public.get_my_active_couple_id() RETURNS UUID AS $$ DECLARE v_couple_id UUID; BEGIN SELECT couple_id INTO v_couple_id FROM public.couple_members WHERE user_id = auth.uid() AND status = 'active' LIMIT 1; RETURN v_couple_id; END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- (나머지 001 수준 정책 복구)
```

## 4. E2EE write floor / Conversation Bridge / unlink (040·043·044·045)

이 migration들은 단순한 예전 함수 복원으로 rollback하지 않고 **forward-fix**로
복구한다. 특히 write floor가 한 번 활성화된 scope는 평문 쓰기로 낮출 수 없다.

- `040`/`045`: `crypto_write_floor` 행을 삭제하거나 `min_cipher_format`을 낮추지 않는다.
  활성화 RPC의 결함은 더 큰 번호의 `CREATE OR REPLACE FUNCTION`으로 고친다.
  한 scope에 floor가 활성화된 후에는 평문 `daily_records` 쓰기를 하는 구버전 클라이언트를
  재배포하지 않는다. 복구 버전도 현재 GLE1 봉투·exact-scope epoch·revision CAS를
  유지해야 하며, compatibility 검증 전에 writer를 낮추지 않는다.
- `043`: 원본 FK/policy만 부분 복원하면 완료 상태와 private-conversion trigger가 어괋나
  stale reference·privacy 규칙이 깨진다. 현재 PRODUCT 계약을 보존하는 forward migration으로만 수정한다.
- `044`: 이 문서 §3의 legacy `disconnect_couple()` 복원 SQL을 **044 적용 후에는 실행하지
  않는다.** 그 SQL은 상대 멤버십과 `crypto_pairings = UNLINKED`를 누락해 권한·정합성을
  후퇴시킨다.
- 복구 순서: 원격 catalog/read-only 확인 → 영향 scope 식별 → 스테이징 fresh-chain
  actor 검증 → 새 forward migration → 암호문 기록·private 전환·unlink 경로 재검증.

이 절은 rollback SQL이 아니라 금지조건과 안전한 복구 절차다. 원격 적용 여부가
`UNVERIFIED`이면 먼저 read-only catalog 조회로 사실을 확정한다.
