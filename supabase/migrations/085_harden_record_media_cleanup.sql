-- 085_harden_record_media_cleanup.sql
--
-- Close two forward-only gaps in the 083/084 record-media lifecycle:
-- immutable daily-record routing identity and a defensive account-deletion
-- fence over every non-deleted object in a namespace attributable to the
-- deleting owner. No prior migration is rewritten and no browser Storage
-- DELETE authority is restored.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.record_media_cleanup_jobs') IS NULL
    OR to_regclass('public.record_media_mutations') IS NULL
    OR to_regclass('public.record_media_objects') IS NULL
    OR to_regprocedure('public.commit_record_media_mutation()') IS NULL
    OR to_regprocedure(
      'public.assert_account_record_media_cleanup_complete(uuid,uuid)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'migration_085_requires_083_084'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.enforce_daily_record_identity_immutable()') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.daily_records'::regclass
        AND tgname = 'aab_085_daily_record_identity_immutable'
        AND NOT tgisinternal
    )
  THEN
    RAISE EXCEPTION 'migration_085_already_applied'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

CREATE FUNCTION public.enforce_daily_record_identity_immutable()
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
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_daily_record_identity_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aab_085_daily_record_identity_immutable
  BEFORE UPDATE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_record_identity_immutable();

-- `aab_085_daily_record_identity_immutable` sorts before the existing
-- `zzz_084_commit_record_media_mutation`, so an invalid identity cannot commit
-- a valid media operation or move object lifecycle state before being rejected.

CREATE INDEX record_media_objects_owner_live_namespace_idx
  ON public.record_media_objects (
    owner_user_id,
    record_id,
    couple_id,
    media_object_id
  )
  WHERE state <> 'deleted';

CREATE INDEX record_media_cleanup_jobs_owner_namespace_idx
  ON public.record_media_cleanup_jobs (owner_user_id, record_id, couple_id);

CREATE INDEX record_media_mutations_owner_namespace_idx
  ON public.record_media_mutations (
    owner_user_id,
    record_id,
    couple_id,
    operation_id
  );

-- Prefix completion follows a fresh exhaustive empty Storage listing in the
-- worker. Retire every ledger row in that exact immutable namespace so the
-- defensive deletion fence has a truthful terminal state, including rows that
-- were active, reserved, blocked or superseded before full-prefix cleanup won.
CREATE OR REPLACE FUNCTION public.complete_record_media_cleanup_job(
  p_record_id UUID,
  p_lease_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state TEXT;
  v_lease_id UUID;
  v_couple_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.state, job.lease_id, job.couple_id
  INTO v_state, v_lease_id, v_couple_id
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;

  IF v_state = 'completed' AND v_lease_id = p_lease_id THEN
    RETURN true;
  END IF;
  IF v_state IS DISTINCT FROM 'leased'
    OR v_lease_id IS DISTINCT FROM p_lease_id
    OR v_couple_id IS NULL
  THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.record_id = p_record_id
    AND media.couple_id = v_couple_id
  ORDER BY media.media_object_id
  FOR UPDATE;

  UPDATE public.record_media_objects AS media
  SET state = 'deleted',
      lease_id = NULL,
      lease_expires_at = NULL,
      deleted_at = coalesce(deleted_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE media.record_id = p_record_id
    AND media.couple_id = v_couple_id
    AND media.state <> 'deleted';

  UPDATE public.record_media_cleanup_jobs
  SET state = 'completed',
      lease_expires_at = NULL,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE record_id = p_record_id
    AND lease_id = p_lease_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  TO service_role;

-- A namespace is attributable to the deleting owner when current record state
-- or any durable historical ledger names that owner. Once attributable, every
-- non-deleted object in the exact record/couple namespace blocks account close,
-- even if an old inconsistency left that individual object with another owner.
-- The service-only caller receives one generic error and no object facts.
CREATE OR REPLACE FUNCTION public.assert_account_record_media_cleanup_complete(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id
    AND deletion.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.owner_user_id = p_user_id
    AND job.state <> 'completed'
  ORDER BY job.record_id
  FOR UPDATE;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.state <> 'deleted'
    AND (
      media.owner_user_id = p_user_id
      OR EXISTS (
        SELECT 1
        FROM public.daily_records AS record
        WHERE record.id = media.record_id
          AND record.couple_id = media.couple_id
          AND record.user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.record_media_cleanup_jobs AS namespace_job
        WHERE namespace_job.record_id = media.record_id
          AND namespace_job.couple_id = media.couple_id
          AND namespace_job.owner_user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.record_media_mutations AS mutation
        WHERE mutation.record_id = media.record_id
          AND mutation.couple_id = media.couple_id
          AND mutation.owner_user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.record_media_objects AS owned_media
        WHERE owned_media.record_id = media.record_id
          AND owned_media.couple_id = media.couple_id
          AND owned_media.owner_user_id = p_user_id
      )
    )
  ORDER BY media.media_object_id
  FOR UPDATE OF media;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.owner_user_id = p_user_id
      AND job.state <> 'completed'
  ) OR EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    WHERE media.state <> 'deleted'
      AND (
        media.owner_user_id = p_user_id
        OR EXISTS (
          SELECT 1
          FROM public.daily_records AS record
          WHERE record.id = media.record_id
            AND record.couple_id = media.couple_id
            AND record.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.record_media_cleanup_jobs AS namespace_job
          WHERE namespace_job.record_id = media.record_id
            AND namespace_job.couple_id = media.couple_id
            AND namespace_job.owner_user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.record_media_mutations AS mutation
          WHERE mutation.record_id = media.record_id
            AND mutation.couple_id = media.couple_id
            AND mutation.owner_user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.record_media_objects AS owned_media
          WHERE owned_media.record_id = media.record_id
            AND owned_media.couple_id = media.couple_id
            AND owned_media.owner_user_id = p_user_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_pending' USING ERRCODE = '55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_account_record_media_cleanup_complete(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback is forward-only: pause the scheduler/Edge artifact, preserve every
-- tombstone and direct-DELETE revocation, then ship a higher-numbered fix.
