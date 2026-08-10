-- =============================================================
-- 023_lock_legacy_cycle_backup.sql
-- 022가 만든 legacy 백업 테이블을 잠근다.
-- =============================================================
--
-- 022의 `CREATE TABLE ... AS SELECT` 는 원본 테이블의 RLS 나 GRANT 를
-- 물려받지 않는다. 그 결과 `public.legacy_cycle_entries_backup` 은
-- RLS 가 꺼진 상태로 만들어지고, PostgREST 가 anon 역할로도 전체 행을
-- 읽을 수 있었다. 실제로 022 적용 직후 anon 키로 `select=*` 요청이
-- 200 과 다른 사용자의 생리 기록을 반환하는 것을 확인했다.
--
-- 이 마이그레이션은 백업 데이터를 지우지 않는다. 접근만 소유자로 제한한다.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'legacy_cycle_entries_backup'
  ) THEN
    EXECUTE 'ALTER TABLE public.legacy_cycle_entries_backup ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Owner can read own legacy cycle backup"
               ON public.legacy_cycle_entries_backup';
    EXECUTE 'CREATE POLICY "Owner can read own legacy cycle backup"
               ON public.legacy_cycle_entries_backup
               FOR SELECT
               USING (user_id = auth.uid())';

    EXECUTE 'REVOKE ALL ON TABLE public.legacy_cycle_entries_backup FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON TABLE public.legacy_cycle_entries_backup FROM anon';
    EXECUTE 'GRANT SELECT ON TABLE public.legacy_cycle_entries_backup TO authenticated';
  END IF;
END $$;

-- 새 프로젝트에 022 를 처음 적용하는 경우 이 023 을 반드시 함께 적용해야 한다.
-- 022 를 재실행해도 `CREATE TABLE IF NOT EXISTS` 는 이미 존재하는 백업 테이블을
-- 건드리지 않으므로 이 잠금은 유지된다.

NOTIFY pgrst, 'reload schema';
