BEGIN;

-- Read-only reconciliation point for the delete-account Edge Function.
--
-- Auth app_metadata and the relational deletion fence live in different
-- systems, so neither can be changed atomically with the other. The handler
-- inspects this state after reasserting a newly begun request and again after a
-- safe exact-attempt cancellation. Sharing the deletion advisory-lock namespace
-- makes each observation linear with begin/cancel without changing their phase
-- or authorization semantics.
CREATE OR REPLACE FUNCTION public.inspect_account_deletion_fence_v2(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt_id UUID;
  v_phase TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::TEXT, 15013)
  );

  SELECT deletion.attempt_id, deletion.phase
  INTO v_attempt_id, v_phase
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'pending', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pending', true,
    'attempt_id', v_attempt_id,
    'phase', v_phase
  );
END;
$$;

COMMENT ON FUNCTION public.inspect_account_deletion_fence_v2(UUID) IS
  'Service-only read of the current account-deletion attempt, serialized with begin and cancel.';

REVOKE ALL ON FUNCTION public.inspect_account_deletion_fence_v2(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inspect_account_deletion_fence_v2(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
