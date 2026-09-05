-- 087_immutable_daily_record_created_at.sql
--
-- Extend migration 085's immutable daily-record routing identity with the
-- timestamp used by complete keyset pagination. The existing trigger remains
-- in place so its ordering before the media commit trigger cannot drift.

BEGIN;

DO $preflight$
DECLARE
  v_table_oid OID := to_regclass('public.daily_records');
  v_function_oid OID := to_regprocedure(
    'public.enforce_daily_record_identity_immutable()'
  );
BEGIN
  IF v_table_oid IS NULL
    OR v_function_oid IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_attribute
      WHERE attrelid = v_table_oid
        AND attname = 'created_at'
        AND atttypid = 'timestamp with time zone'::regtype
        AND attnotnull
        AND NOT attisdropped
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = v_table_oid
        AND tgname = 'aab_085_daily_record_identity_immutable'
        AND tgfoid = v_function_oid
        AND tgtype = 19
        AND tgenabled = 'O'
        AND NOT tgisinternal
    )
  THEN
    RAISE EXCEPTION 'migration_087_requires_exact_085_identity_trigger'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Keyset pagination deliberately accepts only canonical UTC RFC3339 timestamps
-- in the four-digit year range. PostgreSQL also permits +/-infinity and years
-- outside that wire contract; validating this CHECK scans existing rows before
-- the immutable trigger is extended, so an anomalous value aborts the whole
-- migration instead of becoming permanently unrepairable.
ALTER TABLE public.daily_records
  ADD CONSTRAINT daily_records_created_at_cursor_range
  CHECK (
    created_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND created_at < TIMESTAMPTZ '10000-01-01 00:00:00+00'
  );

CREATE OR REPLACE FUNCTION public.enforce_daily_record_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.user_id IS DISTINCT FROM NEW.user_id
    OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
  THEN
    RAISE EXCEPTION 'daily_record_identity_immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'daily_record_created_at_immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_daily_record_identity_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
