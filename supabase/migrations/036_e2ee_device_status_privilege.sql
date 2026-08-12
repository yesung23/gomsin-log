-- =============================================================
-- 036_e2ee_device_status_privilege.sql
-- G2: devices.status stops being guarded by a signal the client can forge.
-- =============================================================
--
-- WHAT WAS WRONG
--
-- 035 gated privileged status transitions on a custom GUC:
--
--   current_setting('gomsinlog.e2ee_status_transition', true) = 'on'
--
-- and its own comment claimed "a client cannot forge it". That was simply
-- false. PostgreSQL lets any session set any custom GUC in a namespace it
-- invents; there is no privilege attached to `gomsinlog.*` at all. So the gate
-- asked the attacker whether the attacker was authorised, and reproducibly:
--
--   SET ROLE authenticated;
--   SELECT set_config('gomsinlog.e2ee_status_transition', 'on', false);
--   UPDATE public.devices SET status = 'ACTIVE' WHERE id = ...;   -- succeeded
--
-- One statement promoted a PENDING device — no certificate, no envelope, no
-- provisioning — straight to ACTIVE, and a set-based form promoted every device
-- the account owned at once.
--
-- WHY THE GUC WAS EVER REACHED
--
-- 031 granted `authenticated` table-level UPDATE on public.devices so the app
-- could maintain its own operational columns. A table-level UPDATE grant
-- authorises EVERY column, `status` included, so the trigger was the only thing
-- standing between a client and ACTIVE — and the trigger deferred to the GUC.
--
-- THE FIX
--
-- Make it a privilege question rather than a trigger question. `authenticated`
-- loses UPDATE on the table and is granted UPDATE on exactly the two columns it
-- genuinely owns, so `status` becomes unwritable by a client at the permission
-- layer — before any trigger, policy or application code is consulted. There is
-- nothing left to forge, because nothing is being asked.
--
-- The trigger stays as a second, independent layer, but it no longer reads any
-- client-settable value; it authorises on role membership, which a session
-- cannot grant itself.
--
-- NOTE ON 035
--
-- The four `set_config('gomsinlog.e2ee_status_transition', ...)` calls inside
-- 035's RPCs are left in place and are now inert: nothing reads that GUC after
-- this migration. They are harmless, and rewriting four security-critical
-- function bodies to delete a no-op would risk far more than it removes.

BEGIN;

-- -------------------------------------------------------------
-- 1. The privilege boundary
-- -------------------------------------------------------------
-- Table-level UPDATE cannot be narrowed by revoking a column: column
-- privileges are additive, and a table-level grant already covers every column.
-- The table-level grant therefore has to GO, and be replaced by an explicit
-- column list. SELECT/INSERT/DELETE are deliberately untouched — enrollment
-- still inserts (constrained to PENDING by trg_devices_insert_status), and RLS
-- still scopes every one of them to the owner's rows.
REVOKE UPDATE ON TABLE public.devices FROM authenticated;

-- The columns a client legitimately maintains for its own device:
--   label_ct      user-chosen name, encrypted under the personal key
--   last_seen_at  liveness for the device list
-- `status` is absent, and so are sig_spki/kem_spki/user_id/assurance/platform,
-- which are identity and must never move after enrollment.
GRANT UPDATE (label_ct, last_seen_at) ON TABLE public.devices TO authenticated;

-- -------------------------------------------------------------
-- 2. The trigger, with the forgeable input removed
-- -------------------------------------------------------------
-- Authorisation is now role membership. Inside a SECURITY DEFINER function the
-- effective role is the function's owner, so the provisioning RPCs satisfy this
-- while a client session never can: `authenticated` is not a member of the role
-- that owns these tables, and no session can make itself one.
--
-- This is defence in depth rather than the primary control. Section 1 already
-- makes a direct client UPDATE of `status` fail on permissions; this is what
-- still holds if a future migration re-grants the table by accident.
CREATE OR REPLACE FUNCTION public.enforce_device_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_privileged BOOLEAN := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- service_role provisions fixtures and runs deletion; it is not a client.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.pg_has_role(current_user, t.tableowner, 'MEMBER')
    INTO v_privileged
  FROM pg_catalog.pg_tables t
  WHERE t.schemaname = 'public' AND t.tablename = 'devices';

  IF coalesce(v_privileged, false) THEN
    RETURN NEW;
  END IF;

  -- No client-reachable exceptions remain. Retiring a device and recording a
  -- provisioning failure were the two transitions a client used to perform by
  -- direct UPDATE; both now go through the RPCs in section 3, which run
  -- privileged and check ownership themselves.
  RAISE EXCEPTION
    'E2EE_DEVICE_STATUS_FORBIDDEN: % -> % must go through a provisioning function',
    OLD.status, NEW.status
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_device_status_transition() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------
-- 3. The two transitions a client is still entitled to ask for
-- -------------------------------------------------------------
-- Neither is a promotion. Both narrow what a device can do, so an owner may
-- always request them for a device it owns — but they go through a function so
-- the write happens under a privilege the caller does not hold directly.

-- Retire a device. Terminal, and idempotent so a client retrying after a
-- dropped response does not get an error for work already done.
CREATE OR REPLACE FUNCTION public.e2ee_revoke_own_device(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNAUTHENTICATED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT user_id, status INTO v_owner, v_status
  FROM public.devices WHERE id = p_device_id FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'E2EE_DEVICE_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status = 'REVOKED' THEN
    RETURN v_status;
  END IF;

  UPDATE public.devices
     SET status = 'REVOKED', revoked_at = coalesce(revoked_at, now())
   WHERE id = p_device_id;

  RETURN 'REVOKED';
END;
$$;

-- Record that provisioning did not finish. Only from a state that was actually
-- mid-provisioning: it must not become a way to walk a REVOKED or ACTIVE device
-- backwards into a state some other check treats as benign.
CREATE OR REPLACE FUNCTION public.e2ee_mark_device_provisioning_failed(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNAUTHENTICATED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT user_id, status INTO v_owner, v_status
  FROM public.devices WHERE id = p_device_id FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'E2EE_DEVICE_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status = 'PROVISIONING_FAILED' THEN
    RETURN v_status;
  END IF;

  IF v_status NOT IN ('PENDING', 'PROVISIONING', 'RECOVERY_AUTHENTICATED') THEN
    RAISE EXCEPTION
      'E2EE_DEVICE_NOT_PROVISIONING: % cannot be marked failed', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.devices SET status = 'PROVISIONING_FAILED' WHERE id = p_device_id;

  RETURN 'PROVISIONING_FAILED';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_revoke_own_device(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.e2ee_mark_device_provisioning_failed(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_revoke_own_device(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_device_provisioning_failed(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 4. PostgREST schema cache
-- -------------------------------------------------------------
-- Two new RPCs, and a changed column privilege that PostgREST uses to decide
-- which columns it will accept in a PATCH body. Without this the client would
-- see PGRST202 for the RPCs and a confusing permission error on the columns.
NOTIFY pgrst, 'reload schema';

COMMIT;
