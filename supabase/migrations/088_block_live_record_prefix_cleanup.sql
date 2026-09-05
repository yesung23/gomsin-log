-- 088_block_live_record_prefix_cleanup.sql
--
-- A prefix cleanup tombstone is valid only after its daily record is gone.
-- Migration 086 reconciled legacy ledgers but could leave a same-identity live
-- record beside a cleanup job. That combination must never be interpreted as
-- permission to delete the live record's Storage prefix.

BEGIN;

DO $preflight$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regclass('public.daily_records') IS NULL
    OR to_regclass('public.record_media_cleanup_jobs') IS NULL
    OR to_regclass('public.record_media_objects') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regprocedure('public.claim_record_media_cleanup_job(uuid,integer)') IS NULL
    OR to_regprocedure('public.complete_record_media_cleanup_job(uuid,uuid)') IS NULL
    OR to_regprocedure('public.record_media_cleanup_contract_version()') IS NULL
  THEN
    RAISE EXCEPTION 'migration_088_requires_exact_086_087'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure(
    'public.complete_record_media_cleanup_job_internal_088(uuid,uuid)'
  ) IS NOT NULL OR EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'storage.objects'::regclass
      AND tgname = 'aaz_088_live_record_prefix_cleanup_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'migration_088_already_applied'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.record_media_cleanup_contract_version()'::regprocedure
  ) INTO v_definition;
  IF v_definition !~* 'RETURN[[:space:]]+3[[:space:]]*;'
    OR v_definition !~* 'auth[.]role[(][)] IS DISTINCT FROM ''service_role'''
  THEN
    RAISE EXCEPTION 'migration_088_contract_predecessor_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.complete_record_media_cleanup_job(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  IF v_definition !~* 'record_media_objects'
    OR v_definition !~* 'storage[.]objects'
    OR v_definition !~* 'FOR UPDATE'
  THEN
    RAISE EXCEPTION 'migration_088_completion_predecessor_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Quiesce record deletion, cleanup claims and Storage deletion. Deployment
-- pauses the scheduler first; NOWAIT turns an unknown writer into a safe abort.
LOCK TABLE public.daily_records IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.record_media_cleanup_jobs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.record_media_objects IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE storage.objects IN SHARE MODE NOWAIT;

DO $live_prefix_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.daily_records AS record
    JOIN public.record_media_cleanup_jobs AS job
      ON job.record_id = record.id
  ) THEN
    RAISE EXCEPTION 'migration_088_live_record_cleanup_conflict'
      USING ERRCODE = '55000';
  END IF;
END
$live_prefix_preflight$;

-- A poisoned legacy row must not occupy the queue head. Skip every job whose
-- record still exists and continue to the oldest eligible recordless job.
CREATE OR REPLACE FUNCTION public.claim_record_media_cleanup_job(
  p_lease_id UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  record_id UUID,
  couple_id UUID,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid_record_media_cleanup_lease'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.record_id
    FROM public.record_media_cleanup_jobs AS job
    WHERE (
      (
        job.state = 'pending'
        AND job.next_attempt_at <= clock_timestamp()
      ) OR (
        job.state = 'leased'
        AND job.lease_expires_at <= clock_timestamp()
      )
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.daily_records AS record
        WHERE record.id = job.record_id
      )
    ORDER BY job.next_attempt_at, job.created_at, job.record_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.record_media_cleanup_jobs AS job
    SET state = 'leased',
        lease_id = p_lease_id,
        lease_expires_at = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    FROM candidate
    WHERE job.record_id = candidate.record_id
    RETURNING job.record_id, job.couple_id, job.lease_id, job.lease_expires_at
  )
  SELECT claimed.record_id,
         claimed.couple_id,
         claimed.lease_id,
         claimed.lease_expires_at
  FROM claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_record_media_cleanup_job(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_record_media_cleanup_job(UUID, INTEGER)
  TO service_role;

-- The 086 Storage trigger remains the primary lease/identity authority. This
-- second trigger executes after it and adds the one distinction it lacked:
-- an exact-object lease may clean an obsolete object from a live record, while
-- a broad prefix lease may never touch any live record namespace.
CREATE FUNCTION public.guard_live_record_prefix_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
  v_record_id UUID;
  v_couple_id UUID;
BEGIN
  IF TG_OP IS DISTINCT FROM 'DELETE'
    OR auth.role() IS DISTINCT FROM 'service_role'
    OR OLD.bucket_id IS DISTINCT FROM 'couple-media'
  THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Exact immutable-object cleanup is intentionally valid for a live record.
  IF EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    WHERE media.storage_object_id = OLD.id
      AND media.state = 'leased'
      AND media.lease_expires_at > statement_timestamp()
  ) THEN
    RETURN OLD;
  END IF;

  v_parts := storage.foldername(OLD.name);
  IF array_length(v_parts, 1) < 2
    OR v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN OLD;
  END IF;

  v_couple_id := v_parts[1]::UUID;
  v_record_id := v_parts[2]::UUID;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.record_id = v_record_id
      AND job.couple_id = v_couple_id
      AND job.state = 'leased'
      AND job.lease_expires_at > statement_timestamp()
  ) AND EXISTS (
    SELECT 1
    FROM public.daily_records AS record
    WHERE record.id = v_record_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_live_record_conflict'
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_live_record_prefix_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aaz_088_live_record_prefix_cleanup_guard
  BEFORE DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_live_record_prefix_cleanup();

-- Preserve the fully reviewed 086 settlement implementation behind a private
-- name. The public wrapper locks the namespace and refuses both first-time
-- completion and idempotent replay while a live row exists, before the old
-- implementation can reopen or settle any state.
ALTER FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  RENAME TO complete_record_media_cleanup_job_internal_088;
REVOKE ALL ON FUNCTION public.complete_record_media_cleanup_job_internal_088(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.complete_record_media_cleanup_job(
  p_record_id UUID,
  p_lease_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.daily_records AS record
  WHERE record.id = p_record_id
  FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'record_media_cleanup_live_record_conflict'
      USING ERRCODE = '55000';
  END IF;

  RETURN public.complete_record_media_cleanup_job_internal_088(
    p_record_id,
    p_lease_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_media_cleanup_contract_version()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  RETURN 4;
END;
$$;
REVOKE ALL ON FUNCTION public.record_media_cleanup_contract_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_media_cleanup_contract_version()
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback remains forward-only: pause the scheduler and every v3/v4 Edge
-- artifact, preserve the cleanup tombstones and Storage DELETE fences, then
-- ship a higher-numbered correction. Never remove the guard or delete Storage
-- metadata directly while a live-record conflict exists.
