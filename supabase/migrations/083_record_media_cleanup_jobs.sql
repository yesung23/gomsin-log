-- 083_record_media_cleanup_jobs.sql
--
-- A record row is the authority for its media prefix. Deleting Storage first
-- destroys the only recoverable copy before PostgreSQL can confirm deletion.
-- This forward migration reverses that authority: every row deletion commits a
-- private, content-free cleanup tombstone in the same transaction, and a leased
-- service worker removes the now-orphaned prefix afterwards.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.record_media_cleanup_jobs') IS NOT NULL
     OR to_regprocedure(
       'public.close_account_relationship_generations_v2_internal_083(uuid,uuid)'
     ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'migration_083_already_applied'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Deliberately no foreign keys: the tombstone must outlive record, couple and
-- Auth cascades. It carries routing identity and bounded worker state only.
CREATE TABLE public.record_media_cleanup_jobs (
  record_id UUID PRIMARY KEY,
  couple_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'blocked', 'completed')),
  failure_count SMALLINT NOT NULL DEFAULT 0
    CHECK (failure_count BETWEEN 0 AND 8),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT
    CHECK (
      last_error_code IS NULL
      OR last_error_code ~ '^E_[A-Z0-9_]{1,63}$'
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  CHECK ((state = 'leased') = (lease_expires_at IS NOT NULL)),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX record_media_cleanup_jobs_claim_idx
  ON public.record_media_cleanup_jobs (next_attempt_at, created_at, record_id)
  WHERE state IN ('pending', 'leased');
CREATE INDEX record_media_cleanup_jobs_owner_barrier_idx
  ON public.record_media_cleanup_jobs (owner_user_id, record_id)
  WHERE state <> 'completed';

ALTER TABLE public.record_media_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.record_media_cleanup_jobs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_record_media_cleanup_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.record_id IS DISTINCT FROM NEW.record_id
    OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
  THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_record_media_cleanup_identity_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aab_083_cleanup_identity_immutable
  BEFORE UPDATE ON public.record_media_cleanup_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_record_media_cleanup_identity_immutable();

CREATE FUNCTION public.reject_retired_record_media_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.record_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'record_id_retired_for_media_cleanup'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_retired_record_media_id()
  FROM PUBLIC, anon, authenticated, service_role;

-- `aaa_076_account_write_row` runs first, so the established account/couple
-- advisory and parent locks are already held. The Storage SHARE lock comes
-- after the record tuple lock, drains INSERT/DELETE writers that started first,
-- and blocks newer uploads until the record deletion commits.
CREATE FUNCTION public.enqueue_record_media_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  LOCK TABLE storage.objects IN SHARE MODE;

  INSERT INTO public.record_media_cleanup_jobs (
    record_id,
    couple_id,
    owner_user_id
  ) VALUES (
    OLD.id,
    OLD.couple_id,
    OLD.user_id
  )
  ON CONFLICT (record_id) DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.record_id = OLD.id
      AND job.couple_id = OLD.couple_id
      AND job.owner_user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_conflict'
      USING ERRCODE = '55000';
  END IF;

  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_record_media_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aab_083_reject_retired_record_media_id
  BEFORE INSERT ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_retired_record_media_id();

CREATE TRIGGER aab_083_enqueue_record_media_cleanup
  BEFORE DELETE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_record_media_cleanup();

-- The only browser-facing delete path. SECURITY DEFINER bypasses broad table
-- RLS, so all authority checks are explicit and every inaccessible target is
-- collapsed to false. The account boundary is acquired before the row DELETE;
-- the row trigger then acquires Storage in the existing lock order.
CREATE FUNCTION public.delete_my_record(
  p_record_id UUID,
  p_expected_user_id UUID,
  p_expected_couple_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_couple_id UUID;
  v_deleted_id UUID;
BEGIN
  IF v_uid IS NULL
    OR p_record_id IS NULL
    OR p_expected_user_id IS NULL
    OR p_expected_couple_id IS NULL
    OR p_expected_user_id IS DISTINCT FROM v_uid
  THEN
    RETURN false;
  END IF;

  PERFORM public.assert_account_write_open(
    ARRAY[v_uid]::UUID[],
    true
  );

  SELECT relationship.id
  INTO v_active_couple_id
  FROM public.couples AS relationship
  JOIN public.couple_members AS member
    ON member.couple_id = relationship.id
  WHERE member.user_id = v_uid
    AND member.status = 'active'
    AND relationship.closed_at IS NULL
  ORDER BY relationship.id
  LIMIT 1
  FOR UPDATE OF relationship;

  IF v_active_couple_id IS DISTINCT FROM p_expected_couple_id THEN
    RETURN false;
  END IF;

  DELETE FROM public.daily_records
  WHERE id = p_record_id
    AND user_id = v_uid
    AND couple_id = p_expected_couple_id
  RETURNING id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_record(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_record(UUID, UUID, UUID)
  TO authenticated;

-- Old browsers must fail before they can destroy a blob. Keeping a DELETE RLS
-- policy absent is not enough: a zero-row DELETE can look successful to a
-- client, so the table privilege is revoked as well. The service role retains
-- its table privilege, but the trigger below still requires an exact live job
-- lease despite BYPASSRLS.
DROP POLICY IF EXISTS "Active members can delete from couple-media"
  ON storage.objects;
REVOKE DELETE ON storage.objects FROM authenticated;

DROP TRIGGER aaa_076_account_write_row ON storage.objects;

CREATE FUNCTION public.enforce_record_media_cleanup_storage_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
BEGIN
  -- Keep migration/operator and transaction-bound 076 capability behavior.
  IF v_role IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_role = 'service_role' THEN
    IF public.has_account_write_capability() THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE'
      AND OLD.bucket_id = 'couple-media'
      AND array_length(storage.foldername(OLD.name), 1) >= 2
      AND EXISTS (
        SELECT 1
        FROM public.record_media_cleanup_jobs AS job
        WHERE job.state = 'leased'
          AND job.lease_expires_at > statement_timestamp()
          AND job.couple_id::TEXT = (storage.foldername(OLD.name))[1]
          AND job.record_id::TEXT = (storage.foldername(OLD.name))[2]
      )
    THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'record_media_cleanup_lease_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_role IS DISTINCT FROM 'authenticated' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'account_deletion_pending'
      USING ERRCODE = '42501';
  END IF;

  IF public.account_write_scope_has_pending(
    ARRAY[v_uid]::UUID[],
    true
  ) THEN
    RAISE EXCEPTION 'account_deletion_pending'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'record_media_delete_requires_worker'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_record_media_cleanup_storage_row()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aaa_083_account_write_row
  BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_record_media_cleanup_storage_row();

CREATE FUNCTION public.claim_record_media_cleanup_job(
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
      job.state = 'pending'
      AND job.next_attempt_at <= clock_timestamp()
    ) OR (
      job.state = 'leased'
      AND job.lease_expires_at <= clock_timestamp()
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
  SELECT claimed.record_id, claimed.couple_id, claimed.lease_id, claimed.lease_expires_at
  FROM claimed;
END;
$$;

CREATE FUNCTION public.defer_record_media_cleanup_job(
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.state, job.lease_id
  INTO v_state, v_lease_id
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;

  IF v_state = 'pending' AND v_lease_id = p_lease_id THEN
    RETURN true;
  END IF;
  IF v_state IS DISTINCT FROM 'leased' OR v_lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN false;
  END IF;

  UPDATE public.record_media_cleanup_jobs
  SET state = 'pending',
      lease_expires_at = NULL,
      next_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE record_id = p_record_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.complete_record_media_cleanup_job(
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.state, job.lease_id
  INTO v_state, v_lease_id
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;

  IF v_state = 'completed' AND v_lease_id = p_lease_id THEN
    RETURN true;
  END IF;
  IF v_state IS DISTINCT FROM 'leased' OR v_lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN false;
  END IF;

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

CREATE FUNCTION public.fail_record_media_cleanup_job(
  p_record_id UUID,
  p_lease_id UUID,
  p_error_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state TEXT;
  v_lease_id UUID;
  v_last_error_code TEXT;
  v_failure_count SMALLINT;
  v_next_failure_count SMALLINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^E_[A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'invalid_record_media_cleanup_error_code'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.state, job.lease_id, job.last_error_code, job.failure_count
  INTO v_state, v_lease_id, v_last_error_code, v_failure_count
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;

  IF v_state IN ('pending', 'blocked')
    AND v_lease_id = p_lease_id
    AND v_last_error_code = p_error_code
  THEN
    RETURN v_state;
  END IF;
  IF v_state IS DISTINCT FROM 'leased' OR v_lease_id IS DISTINCT FROM p_lease_id THEN
    RETURN NULL;
  END IF;

  v_next_failure_count := least(v_failure_count + 1, 8);
  UPDATE public.record_media_cleanup_jobs
  SET state = CASE WHEN v_next_failure_count >= 8 THEN 'blocked' ELSE 'pending' END,
      failure_count = v_next_failure_count,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      next_attempt_at = clock_timestamp()
        + make_interval(secs => least(300, (2 ^ v_next_failure_count)::INTEGER)),
      updated_at = clock_timestamp()
  WHERE record_id = p_record_id;

  RETURN CASE WHEN v_next_failure_count >= 8 THEN 'blocked' ELSE 'pending' END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_record_media_cleanup_job(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.defer_record_media_cleanup_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_record_media_cleanup_job(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_record_media_cleanup_job(UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_record_media_cleanup_job(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_record_media_cleanup_job(UUID, UUID, TEXT)
  TO service_role;

-- This helper locks every unfinished owner job. A completing worker either wins
-- first and becomes visible, or waits behind this transaction; relationship
-- closure can never observe a job halfway through settlement.
CREATE FUNCTION public.assert_account_record_media_cleanup_complete(
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
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.owner_user_id = p_user_id
    AND job.state <> 'completed'
  ORDER BY job.record_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.owner_user_id = p_user_id
      AND job.state <> 'completed'
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_pending'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_account_record_media_cleanup_complete(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  RENAME TO close_account_relationship_generations_v2_internal_083;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2_internal_083(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.close_account_relationship_generations_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  -- Preserve 076's account advisory -> deletion marker -> relationship parent
  -- order before adding the cleanup-job locks. The renamed 076 wrapper opens
  -- its own nested capability later; both are transaction-local and reentrant.
  v_capability_id :=
    public.open_account_deletion_write_capability(
      p_user_id,
      p_attempt_id,
      ARRAY[
        'relational_prepared',
        'relationships_closed',
        'solo_cleanup_complete'
      ]::TEXT[]
    );
  BEGIN
    PERFORM public.assert_account_record_media_cleanup_complete(
      p_user_id,
      p_attempt_id
    );
    v_result := public.close_account_relationship_generations_v2_internal_083(
      p_user_id,
      p_attempt_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback direction: never restore authenticated Storage DELETE. Pause the
-- scheduler/Edge artifact if needed, keep tombstones and the account barrier,
-- then ship a higher-numbered forward fix for worker or lease defects.
