-- 046: Require an authenticated actor for the two device-provisioning transitions.
--
-- `e2ee_begin_device_provisioning` and `e2ee_finalize_device_provisioning` are
-- SECURITY DEFINER and are granted to `authenticated`. Both compared ownership
-- as `v_uid IS NOT NULL AND v_device.user_id <> v_uid`, so an execution context
-- where `auth.uid()` is NULL skipped the ownership comparison entirely and could
-- move another account's device to PROVISIONING or ACTIVE.
--
-- Migration 045 already established the correct shape for an irreversible
-- transition: a NULL actor is refused before any state is inspected. This
-- forward correction applies the same rule here. Every other check in both
-- functions is preserved exactly, including the revocation precedence, the
-- certificate requirement, the envelope-coverage requirement, the legal source
-- states, and the idempotent returns.
--
-- `service_role` retains EXECUTE for operational use, but it no longer inherits
-- an ownership bypass: a NULL-actor call now fails instead of proceeding.

BEGIN;

CREATE OR REPLACE FUNCTION public.e2ee_begin_device_provisioning(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.devices;
  v_uid UUID := auth.uid();
BEGIN
  -- Fail closed before reading or changing any device state.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_device.user_id <> v_uid THEN
    RAISE EXCEPTION 'E2EE_DEVICE_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_device.status = 'PROVISIONING' THEN
    RETURN 'PROVISIONING';
  END IF;
  IF v_device.status NOT IN ('PENDING', 'RECOVERY_AUTHENTICATED') THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_DEVICE_TRANSITION: % -> PROVISIONING', v_device.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.device_certificates dc
    WHERE dc.subject_device_id = p_device_id AND dc.user_id = v_device.user_id
  ) THEN
    RAISE EXCEPTION 'E2EE_DEVICE_UNCERTIFIED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', true);
  UPDATE public.devices SET status = 'PROVISIONING' WHERE id = p_device_id;
  PERFORM set_config('gomsinlog.e2ee_status_transition', 'off', true);

  RETURN 'PROVISIONING';
END;
$$;

CREATE OR REPLACE FUNCTION public.e2ee_finalize_device_provisioning(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.devices;
  v_uid UUID := auth.uid();
  v_certificate_id UUID;
  v_missing INTEGER;
BEGIN
  -- ACTIVE is the state that makes a device an envelope recipient, so an
  -- unauthenticated caller must never reach the checks below.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_device.user_id <> v_uid THEN
    RAISE EXCEPTION 'E2EE_DEVICE_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Revocation still precedes the idempotent shortcut: a revoked device sitting
  -- at ACTIVE must not have that state confirmed back as a healthy result.
  IF EXISTS (
    SELECT 1 FROM public.revocation_statements rs WHERE rs.revoked_device_id = p_device_id
  ) THEN
    RAISE EXCEPTION 'E2EE_DEVICE_REVOKED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_device.status = 'ACTIVE' THEN
    RETURN 'ACTIVE';  -- idempotent
  END IF;

  IF v_device.status NOT IN ('PROVISIONING', 'RECOVERY_AUTHENTICATED') THEN
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PROVISIONING: status is %', v_device.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT dc.id INTO v_certificate_id
  FROM public.device_certificates dc
  WHERE dc.subject_device_id = p_device_id AND dc.user_id = v_device.user_id
  ORDER BY dc.created_at DESC
  LIMIT 1;
  IF v_certificate_id IS NULL THEN
    RAISE EXCEPTION 'E2EE_DEVICE_UNCERTIFIED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_missing FROM public.e2ee_missing_device_coverage(p_device_id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'E2EE_PROVISIONING_INCOMPLETE: % required envelope(s) missing', v_missing
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', true);
  UPDATE public.devices SET status = 'ACTIVE' WHERE id = p_device_id;
  PERFORM set_config('gomsinlog.e2ee_status_transition', 'off', true);

  RETURN 'ACTIVE';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_begin_device_provisioning(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_begin_device_provisioning(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.e2ee_begin_device_provisioning(UUID) IS
  'PENDING/RECOVERY_AUTHENTICATED -> PROVISIONING. Requires an authenticated owner; a NULL actor is refused.';
COMMENT ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) IS
  'The only path to ACTIVE. Requires an authenticated owner, no revocation, a certificate, and full envelope coverage.';

-- Both functions were re-created above, so PostgREST must re-read the schema
-- cache rather than keep serving the previous definitions.
NOTIFY pgrst, 'reload schema';

COMMIT;
