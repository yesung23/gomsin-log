-- =============================================================
-- 024_cycle_v3_account_deletion.sql
-- 계정 삭제 시 V3 주기 데이터와 legacy 백업까지 정리한다.
-- =============================================================
--
-- 022 가 만든 네 테이블은 `auth.users ON DELETE CASCADE` 이므로 Auth 삭제
-- 시점에는 함께 사라진다. 그러나 이 저장소의 삭제 설계는 Auth 삭제 *이전*
-- 트랜잭션(`prepare_account_deletion`)에서 민감 데이터를 명시적으로 지우고,
-- 지운 건수를 보고하는 구조다. 주기 데이터는 이 앱에서 가장 민감한 데이터인데
-- 그 경로에 빠져 있었다.
--
-- 더 중요한 문제는 `public.legacy_cycle_entries_backup` 이다. 022 의
-- `CREATE TABLE ... AS SELECT` 로 만들어졌기 때문에 `user_id` 에 외래 키가
-- 없다. 따라서 Auth 삭제 cascade 가 이 테이블에는 닿지 않고, 계정을 지운 뒤에도
-- 과거 생리 기록이 그대로 남는다. 이 마이그레이션이 그것을 지운다.
--
-- 함수 시그니처와 반환 키는 015 와 호환된다. 기존 키는 하나도 제거하지 않고
-- `cycle_*_deleted` 키만 추가한다.

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(
  p_user_id UUID,
  p_expected_record_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_membership RECORD;
  v_partner_id UUID;
  v_count INTEGER;
  v_private_events INTEGER := 0;
  v_shared_events INTEGER := 0;
  v_orphaned_events INTEGER := 0;
  v_trips INTEGER := 0;
  v_orphaned_trips INTEGER := 0;
  v_records INTEGER := 0;
  v_cycle_periods INTEGER := 0;
  v_cycle_daily_logs INTEGER := 0;
  v_cycle_entries INTEGER := 0;
  v_cycle_legacy_backup INTEGER := 0;
  v_cycle_settings INTEGER := 0;
  v_cycle_sharing INTEGER := 0;
  v_cycle_signals INTEGER := 0;
  v_consents INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL OR p_expected_record_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload';
  END IF;

  PERFORM 1
  FROM public.account_deletion_requests
  WHERE user_id = p_user_id
    AND expected_record_ids @> p_expected_record_ids
    AND p_expected_record_ids @> expected_record_ids
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion was not prepared for media cleanup';
  END IF;

  -- Fail rather than delete records whose media was not part of the confirmed
  -- preflight. Arrays are compared as sets after duplicate elimination.
  IF EXISTS (
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
    EXCEPT
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
  ) OR EXISTS (
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
    EXCEPT
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Account records changed during media cleanup';
  END IF;

  PERFORM set_config('app.plan_ownership_transfer', 'on', true);

  -- UUID ordering makes multi-couple deletion deterministic. Each couple row
  -- is locked before plans or membership-dependent data for that couple.
  FOR v_membership IN
    SELECT DISTINCT couple_id
    FROM public.couple_members
    WHERE user_id = p_user_id
    ORDER BY couple_id
  LOOP
    PERFORM 1
    FROM public.couples
    WHERE id = v_membership.couple_id
    FOR UPDATE;

    SELECT other.user_id
    INTO v_partner_id
    FROM public.couple_members AS other
    WHERE other.couple_id = v_membership.couple_id
      AND other.user_id <> p_user_id
      AND other.status = 'active'
    ORDER BY other.joined_at, other.id
    LIMIT 1;

    DELETE FROM public.events
    WHERE couple_id = v_membership.couple_id
      AND created_by = p_user_id
      AND is_private = true;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_private_events := v_private_events + v_count;

    IF v_partner_id IS NOT NULL THEN
      UPDATE public.events
      SET created_by = v_partner_id,
          updated_at = now()
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id
        AND is_private = false;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_shared_events := v_shared_events + v_count;

      UPDATE public.trips
      SET created_by = v_partner_id,
          updated_at = now()
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_trips := v_trips + v_count;
    ELSE
      DELETE FROM public.events
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_orphaned_events := v_orphaned_events + v_count;

      DELETE FROM public.trips
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_orphaned_trips := v_orphaned_trips + v_count;
    END IF;
  END LOOP;

  -- Narrow the capability to the loop that needs it: the deletes below must not
  -- run with the identity-immutability triggers disarmed.
  PERFORM set_config('app.plan_ownership_transfer', 'off', true);

  DELETE FROM public.invitation_codes
  WHERE created_by = p_user_id OR used_by = p_user_id;

  DELETE FROM public.briefings WHERE recipient_id = p_user_id;

  DELETE FROM public.daily_records WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_records = ROW_COUNT;

  -- Cycle data. Deleted here, before Auth deletion, so the outcome is
  -- deliberate and reported rather than an invisible cascade side effect.
  -- `IF EXISTS` guards keep the function loadable on a database where 022 has
  -- not been applied yet; the counts then stay 0.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_periods') THEN
    DELETE FROM public.cycle_periods WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_periods = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_daily_logs') THEN
    DELETE FROM public.cycle_daily_logs WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_daily_logs = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_sharing_preferences') THEN
    DELETE FROM public.cycle_sharing_preferences WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_sharing = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'user_sensitive_consents') THEN
    DELETE FROM public.user_sensitive_consents WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_consents = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_entries') THEN
    DELETE FROM public.cycle_entries WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_entries = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_settings') THEN
    DELETE FROM public.cycle_settings WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_settings = ROW_COUNT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cycle_support_signals') THEN
    DELETE FROM public.cycle_support_signals WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_signals = ROW_COUNT;
  END IF;

  -- The legacy backup has NO foreign key to auth.users (022 created it with
  -- CREATE TABLE AS SELECT), so nothing else would ever remove these rows.
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'legacy_cycle_entries_backup') THEN
    DELETE FROM public.legacy_cycle_entries_backup WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_cycle_legacy_backup = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'private_events_deleted', v_private_events,
    'shared_events_transferred', v_shared_events,
    'shared_events_deleted', v_orphaned_events,
    'trips_transferred', v_trips,
    'trips_deleted', v_orphaned_trips,
    'records_deleted', v_records,
    'cycle_periods_deleted', v_cycle_periods,
    'cycle_daily_logs_deleted', v_cycle_daily_logs,
    'cycle_entries_deleted', v_cycle_entries,
    'cycle_settings_deleted', v_cycle_settings,
    'cycle_sharing_preferences_deleted', v_cycle_sharing,
    'cycle_support_signals_deleted', v_cycle_signals,
    'sensitive_consents_deleted', v_consents,
    'legacy_cycle_backup_deleted', v_cycle_legacy_backup
  );
END;
$$;

COMMENT ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) IS
  'Service-role-only transactional DB preparation after media cleanup and before auth deletion. Includes cycle V3 data.';

REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';
