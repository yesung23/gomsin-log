-- =============================================================
-- 035_e2ee_phase1a_p0_closure.sql
-- Phase 1A remaining P0 closure. Additive; no data is destroyed.
-- =============================================================
--
-- Every change here exists because a real PostgreSQL cluster rejected, or
-- silently mis-handled, something the in-memory test double accepted. The fake
-- is not the contract; this file is.
--
--   P0-1  the approval RPC inserted a second-device certificate with NEITHER
--         issuer_certificate_id NOR recovery_public_anchor_id, which violates
--         device_certificates_chain. Every honest second-device approval failed
--         against a real database. The issuer is now persisted, resolved and
--         re-validated server-side so a caller cannot substitute one.
--
--   P0-2  the same RPC set status = 'ACTIVE' the moment a certificate existed.
--         A certificate makes a device trustable; it does not give it a single
--         scope key. Approval now yields PROVISIONING, and only a narrow
--         SECURITY DEFINER finalization that proves envelope coverage may
--         activate. `authenticated` holds UPDATE on devices, so the transition
--         is additionally enforced by a trigger rather than by convention.
--
--   P0-3  epoch completeness was decided by the client re-reading recipient
--         envelopes. RLS correctly hides B's envelopes from A, so a complete
--         couple epoch looked incomplete and was ABANDONED. Completeness moves
--         into e2ee_mark_epoch_ready, which sees all rows because it is
--         SECURITY DEFINER, and returns only success or a failure code. No
--         SELECT policy is weakened and no partner ciphertext is exposed.
--
--   P0-5  the recovering client chose which couple scopes to rotate. The set is
--         now discovered from membership, server-side.
--
-- P0-4 (mandatory recovery-kit anchor) is a client-artifact change and has no
-- SQL surface; it is enforced in the crypto layer.

BEGIN;

-- -------------------------------------------------------------
-- 1. Granted domains, read from the signed certificate
-- -------------------------------------------------------------
-- GLDC1 carries the granted-domain mask at byte offset 10 of the canonical
-- body (docs/E2EE_PHASE_1A_ARCHITECTURE_V2_1.md section 3). Reading it from the
-- certificate rather than from a mutable column matters: the certificate is
-- immutable and signed, so this cannot be edited to widen a device's reach.
--
--   bit 0 (1) personal   bit 1 (2) couple   bit 2 (4) health
CREATE OR REPLACE FUNCTION public.e2ee_certificate_granted_domains(p_certificate BYTEA)
RETURNS SMALLINT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_certificate IS NULL OR octet_length(p_certificate) <> 445 THEN 0::SMALLINT
    ELSE get_byte(p_certificate, 10)::SMALLINT
  END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_certificate_granted_domains(BYTEA) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_certificate_granted_domains(BYTEA) TO authenticated, service_role;

COMMENT ON FUNCTION public.e2ee_certificate_granted_domains(BYTEA) IS
  'The GLDC1 granted-domain mask, read from the immutable signed certificate body.';

-- The newest certificate for a device, or NULL when it has none.
CREATE OR REPLACE FUNCTION public.e2ee_latest_certificate_id(p_device_id UUID)
RETURNS UUID
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT dc.id
  FROM public.device_certificates dc
  WHERE dc.subject_device_id = p_device_id
  ORDER BY dc.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.e2ee_latest_certificate_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_latest_certificate_id(UUID) TO service_role;

-- -------------------------------------------------------------
-- 2. P0-2 — status transitions are not the client's to choose
-- -------------------------------------------------------------
-- `authenticated` has UPDATE on devices (it owns operational metadata such as
-- the encrypted label and last_seen_at), so without this trigger the whole
-- provisioning gate is advisory: `UPDATE devices SET status='ACTIVE'` would
-- reach ACTIVE with no certificate and no envelope at all.
--
-- The privileged paths set gomsinlog.e2ee_status_transition for the duration of
-- their transaction. A client cannot forge it: set_config on a `gomsinlog.`
-- GUC is available to any session, but the only functions that set it are
-- SECURITY DEFINER and validate their own preconditions first, and reaching
-- ACTIVE additionally requires passing those checks.
CREATE OR REPLACE FUNCTION public.enforce_device_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_privileged BOOLEAN := coalesce(
    current_setting('gomsinlog.e2ee_status_transition', true) = 'on', false
  );
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- service_role provisions fixtures and runs deletion; it is not a client.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_privileged THEN
    RETURN NEW;
  END IF;

  -- A client may retire its own device or record a failure. It may never
  -- promote one: ACTIVE, PROVISIONING and RECOVERY_AUTHENTICATED are conclusions
  -- the server draws from evidence it has checked.
  IF NEW.status IN ('REVOKED', 'PROVISIONING_FAILED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'E2EE_DEVICE_STATUS_FORBIDDEN: % -> % must go through a provisioning function',
    OLD.status, NEW.status
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_device_status_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_devices_status_transition ON public.devices;
CREATE TRIGGER trg_devices_status_transition
  BEFORE UPDATE OF status ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_device_status_transition();

-- A device may not be INSERTed already ACTIVE either; that would sidestep the
-- trigger above entirely.
CREATE OR REPLACE FUNCTION public.enforce_device_insert_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'E2EE_DEVICE_MUST_START_PENDING: a new device may not be created as %', NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_device_insert_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_devices_insert_status ON public.devices;
CREATE TRIGGER trg_devices_insert_status
  BEFORE INSERT ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_device_insert_status();

-- -------------------------------------------------------------
-- 3. Required envelope coverage
-- -------------------------------------------------------------
-- Shared by the provisioning gate and the epoch readiness gate so the two can
-- never disagree about what "covered" means.
--
-- Returns the domains for which an ACTIVE epoch exists that this device is
-- granted and therefore MUST hold, but for which it has no self-notarized
-- envelope. An empty result means fully provisioned.
CREATE OR REPLACE FUNCTION public.e2ee_missing_device_coverage(p_device_id UUID)
RETURNS TABLE (domain TEXT, scope_id UUID)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_mask SMALLINT;
  v_couple_id UUID;
BEGIN
  SELECT d.user_id INTO v_user_id FROM public.devices d WHERE d.id = p_device_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- From the signed certificate, not from platform or status.
  SELECT public.e2ee_certificate_granted_domains(dc.certificate) INTO v_mask
  FROM public.device_certificates dc
  WHERE dc.subject_device_id = p_device_id
  ORDER BY dc.created_at DESC
  LIMIT 1;

  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'E2EE_DEVICE_UNCERTIFIED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT cm.couple_id INTO v_couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = v_user_id AND cm.status = 'active'
  LIMIT 1;

  -- Two kinds of gap, and both must be reported.
  --
  --   UNCOVERED  an ACTIVE epoch this device is granted but holds no
  --              self-notarized envelope for.
  --   ABSENT     a domain this device is granted for which no ACTIVE epoch
  --              exists at all. This is not "nothing to do": PMK is created at
  --              bootstrap, so a certified device of an established account
  --              that finds no personal epoch is looking at an anomalous
  --              account, and activating into it would produce a device that
  --              reports ACTIVE while holding nothing. Only the couple domain
  --              may legitimately have no epoch, because an unpaired account
  --              has no couple key.
  RETURN QUERY
  WITH required AS (
    SELECT 'personal'::TEXT AS domain, v_user_id AS scope_id WHERE (v_mask & 1) <> 0
    UNION ALL
    SELECT 'health'::TEXT, v_user_id WHERE (v_mask & 4) <> 0
    UNION ALL
    SELECT 'couple'::TEXT, v_couple_id
    WHERE (v_mask & 2) <> 0 AND v_couple_id IS NOT NULL
      -- Required only once the couple actually has a live epoch.
      AND EXISTS (
        SELECT 1 FROM public.scope_keys sk
        WHERE sk.domain = 'couple' AND sk.scope_id = v_couple_id AND sk.state = 'ACTIVE'
      )
  )
  SELECT r.domain, r.scope_id
  FROM required r
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.scope_keys sk
    JOIN public.key_envelopes ke ON ke.scope_key_id = sk.id
    WHERE sk.domain = r.domain
      AND sk.scope_id = r.scope_id
      AND sk.state = 'ACTIVE'
      AND ke.recipient_device_id = p_device_id
      -- Self-notarization is what makes the envelope verifiable without the
      -- provisioner's certificate. A device that has not re-wrapped its own
      -- envelope is not finished provisioning.
      AND ke.self_notarized = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_missing_device_coverage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_missing_device_coverage(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.e2ee_missing_device_coverage(UUID) IS
  'ACTIVE epochs this device is granted but holds no self-notarized envelope for. Empty means provisioned.';

-- -------------------------------------------------------------
-- 4. P0-2 — the only path to ACTIVE
-- -------------------------------------------------------------
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
  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Ownership, from the session rather than from the argument.
  IF v_uid IS NOT NULL AND v_device.user_id <> v_uid THEN
    RAISE EXCEPTION 'E2EE_DEVICE_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Revocation is checked BEFORE the idempotent shortcut. A revoked device that
  -- happens to sit at ACTIVE must not have that state confirmed back to a
  -- caller as though it were a healthy provisioning result.
  IF EXISTS (
    SELECT 1 FROM public.revocation_statements rs WHERE rs.revoked_device_id = p_device_id
  ) THEN
    RAISE EXCEPTION 'E2EE_DEVICE_REVOKED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_device.status = 'ACTIVE' THEN
    RETURN 'ACTIVE';  -- idempotent
  END IF;

  -- RECOVERY_AUTHENTICATED and PROVISIONING are the two states from which
  -- provisioning can legitimately complete. PENDING has not been approved at
  -- all, and REVOKED/PROVISIONING_FAILED are not silently recoverable.
  IF v_device.status NOT IN ('PROVISIONING', 'RECOVERY_AUTHENTICATED') THEN
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PROVISIONING: status is %', v_device.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A certificate must exist. Status is not evidence; this is.
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

REVOKE ALL ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.e2ee_finalize_device_provisioning(UUID) IS
  'The only path to devices.status = ACTIVE. Requires a certificate, no revocation, and full self-notarized envelope coverage.';

-- Move a recovery-authenticated device into PROVISIONING once it is certified.
CREATE OR REPLACE FUNCTION public.e2ee_begin_device_provisioning(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.devices;
  v_uid UUID := auth.uid();
BEGIN
  SELECT * INTO v_device FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_DEVICE' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_uid IS NOT NULL AND v_device.user_id <> v_uid THEN
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

REVOKE ALL ON FUNCTION public.e2ee_begin_device_provisioning(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_begin_device_provisioning(UUID) TO authenticated, service_role;

-- -------------------------------------------------------------
-- 5. P0-1 + P0-2 — approval persists the verified issuer, and yields PROVISIONING
-- -------------------------------------------------------------
-- The signature changes, so the old function is dropped rather than replaced;
-- leaving both callable would leave the defective one reachable.
DROP FUNCTION IF EXISTS public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA, UUID, UUID, SMALLINT, BYTEA, BYTEA
);

CREATE OR REPLACE FUNCTION public.e2ee_commit_device_approval(
  p_enrollment_id UUID,
  p_new_device_id UUID,
  p_certificate BYTEA,
  p_certificate_fp BYTEA,
  p_transcript_hash BYTEA,
  p_approval_signature BYTEA,
  p_user_id UUID,
  p_recovery_identity_id UUID,
  p_recovery_version SMALLINT,
  p_subject_sig_spki BYTEA,
  p_subject_kem_spki BYTEA,
  -- The certificate row the Edge Function already verified root-first. It is
  -- re-validated below rather than trusted, so a substituted id is rejected
  -- even though only service_role can reach this function.
  p_issuer_certificate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_certificate_id UUID;
  v_rows INTEGER;
  v_enrollment public.device_enrollments;
  v_issuer public.device_certificates;
BEGIN
  -- Lock the enrollment first so the issuer checks below cannot race a
  -- concurrent approval of the same enrollment.
  SELECT * INTO v_enrollment
  FROM public.device_enrollments
  WHERE id = p_enrollment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_ENROLLMENT' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_enrollment.user_id <> p_user_id OR v_enrollment.new_device_id <> p_new_device_id THEN
    RAISE EXCEPTION 'E2EE_ENROLLMENT_MISMATCH' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------
  -- P0-1: the issuer relationship, validated against server state.
  -- ---------------------------------------------------------------
  IF p_issuer_certificate_id IS NULL THEN
    RAISE EXCEPTION 'E2EE_ISSUER_CERTIFICATE_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_issuer
  FROM public.device_certificates
  WHERE id = p_issuer_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_ISSUER_CERTIFICATE' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Same account. A certificate from another user can never issue here.
  IF v_issuer.user_id <> p_user_id THEN
    RAISE EXCEPTION 'E2EE_ISSUER_WRONG_ACCOUNT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- It must be the certificate of the device that actually approved this
  -- enrollment, which is the row the transcript was built from.
  IF v_enrollment.approver_device_id IS NULL
     OR v_issuer.subject_device_id <> v_enrollment.approver_device_id THEN
    RAISE EXCEPTION 'E2EE_ISSUER_NOT_APPROVER' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same recovery generation as the certificate being issued.
  IF v_issuer.recovery_identity_id <> p_recovery_identity_id
     OR v_issuer.recovery_version <> p_recovery_version THEN
    RAISE EXCEPTION 'E2EE_ISSUER_RECOVERY_MISMATCH' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A revoked issuer certifies nothing. Revocation is chain-wide (V2.1 §13).
  IF EXISTS (
    SELECT 1 FROM public.revocation_statements rs
    WHERE rs.revoked_device_id = v_issuer.subject_device_id
  ) THEN
    RAISE EXCEPTION 'E2EE_ISSUER_REVOKED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No escalation: the issuer cannot grant a domain it does not itself hold.
  IF (public.e2ee_certificate_granted_domains(p_certificate)
      & ~public.e2ee_certificate_granted_domains(v_issuer.certificate)) <> 0 THEN
    RAISE EXCEPTION 'E2EE_ISSUER_GRANT_ESCALATION' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Consume the nonce conditionally. A replay finds consumed_at already set and
  -- updates zero rows, so exactly one caller proceeds.
  UPDATE public.device_enrollments
     SET consumed_at = now(),
         approved_at = now(),
         transcript_hash = p_transcript_hash,
         approval_signature = p_approval_signature
   WHERE id = p_enrollment_id
     AND consumed_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_NONCE_ALREADY_USED' USING ERRCODE = 'unique_violation';
  END IF;

  -- A device-issued certificate points at its issuer's certificate and NOT at
  -- the recovery anchor; device_certificates_chain requires exactly one.
  INSERT INTO public.device_certificates
    (user_id, subject_device_id, issuer_device_id, issuer_certificate_id,
     recovery_public_anchor_id, recovery_identity_id, recovery_version,
     certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
  VALUES
    (p_user_id, p_new_device_id, v_enrollment.approver_device_id, p_issuer_certificate_id,
     NULL, p_recovery_identity_id, p_recovery_version,
     p_certificate, p_certificate_fp, p_subject_sig_spki, p_subject_kem_spki)
  RETURNING id INTO v_certificate_id;

  -- ---------------------------------------------------------------
  -- P0-2: approval is not provisioning.
  -- ---------------------------------------------------------------
  -- The device now has a verifiable certificate and not one scope key. It
  -- cannot decrypt anything, so calling it ACTIVE would misreport its state to
  -- every other participant.
  PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', true);
  UPDATE public.devices
     SET status = 'PROVISIONING', enrollment_method = 'device_approval'
   WHERE id = p_new_device_id AND status = 'PENDING';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('gomsinlog.e2ee_status_transition', 'off', true);
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PENDING' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN v_certificate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA, UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA, UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
) TO service_role;

COMMENT ON FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA, UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
) IS
  'Atomic second-device approval. Persists the server-verified issuer certificate and leaves the device PROVISIONING, never ACTIVE.';

-- Recovery authentication must not leapfrog provisioning either.
CREATE OR REPLACE FUNCTION public.e2ee_commit_recovery_authentication(
  p_challenge_id UUID,
  p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_rows INTEGER;
BEGIN
  UPDATE public.recovery_challenges
     SET consumed_at = now()
   WHERE id = p_challenge_id
     AND consumed_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_CHALLENGE_ALREADY_USED' USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('gomsinlog.e2ee_status_transition', 'on', true);
  UPDATE public.devices
     SET status = 'RECOVERY_AUTHENTICATED', enrollment_method = 'recovery'
   WHERE id = p_device_id AND status = 'PENDING';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('gomsinlog.e2ee_status_transition', 'off', true);
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PENDING' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_commit_recovery_authentication(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_recovery_authentication(UUID, UUID) TO service_role;

-- -------------------------------------------------------------
-- 6. P0-3 — readiness is decided by the database, not by an RLS-blind client
-- -------------------------------------------------------------
-- The recipients an epoch must reach, computed from certificates and membership.
-- SECURITY DEFINER, so it sees both members' rows; it returns ids the caller is
-- entitled to act on and no ciphertext whatsoever.
CREATE OR REPLACE FUNCTION public.e2ee_required_epoch_recipients(p_scope_key_id UUID)
RETURNS TABLE (recipient_kind TEXT, recipient_id UUID)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.scope_keys;
  v_bit SMALLINT;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_bit := CASE v_key.domain WHEN 'personal' THEN 1 WHEN 'couple' THEN 2 ELSE 4 END;

  -- The users whose devices and recovery identities must be covered: the owner
  -- for a personal/health epoch, both active members for a couple epoch.
  RETURN QUERY
  WITH scope_users AS (
    SELECT v_key.owner_user_id AS user_id
    WHERE v_key.domain IN ('personal', 'health')
    UNION
    SELECT cm.user_id
    FROM public.couple_members cm
    WHERE v_key.domain = 'couple'
      AND cm.couple_id = v_key.owner_couple_id
      AND cm.status = 'active'
  ),
  -- One row per device that holds a certificate granting this domain and has
  -- not been revoked. Status is deliberately not consulted: trust is the
  -- certificate, and a device mid-provisioning still needs the key.
  certified AS (
    SELECT DISTINCT dc.subject_device_id AS device_id
    FROM public.device_certificates dc
    JOIN public.devices d ON d.id = dc.subject_device_id
    JOIN scope_users su ON su.user_id = dc.user_id
    WHERE (public.e2ee_certificate_granted_domains(dc.certificate) & v_bit) <> 0
      AND d.status NOT IN ('REVOKED', 'PROVISIONING_FAILED')
      AND NOT EXISTS (
        SELECT 1 FROM public.revocation_statements rs
        WHERE rs.revoked_device_id = dc.subject_device_id
      )
  )
  SELECT 'device'::TEXT, c.device_id FROM certified c
  UNION ALL
  -- Recovery coverage is mandatory for every live epoch: without it a later kit
  -- recovery cannot reach this scope at all (V2.1 §2, §7).
  SELECT 'recovery_identity'::TEXT, ri.id
  FROM public.recovery_identities ri
  JOIN scope_users su ON su.user_id = ri.user_id
  WHERE ri.superseded_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_required_epoch_recipients(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_required_epoch_recipients(UUID) TO authenticated, service_role;

-- Readiness, with completeness folded in. This replaces the "at least one
-- envelope exists" check, which was the only thing the old function could
-- verify once the client's own count became unreliable under RLS.
CREATE OR REPLACE FUNCTION public.e2ee_mark_epoch_ready(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.scope_keys;
  v_missing INTEGER;
  v_revoked INTEGER;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;

  -- `IS NOT TRUE`, not `NOT (...)`. e2ee_can_manage_scope_key compares against
  -- get_my_active_couple_id(), which is NULL for a user with no active couple —
  -- and `NOT NULL` is NULL, which does not satisfy an IF and so does not raise.
  -- An unrelated caller therefore walked straight past this check. The same
  -- three-valued-logic hole is closed in activate/abandon below.
  IF public.e2ee_can_manage_scope_key(v_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_key.state <> 'PREPARING' THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> READY', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every required recipient must already hold an envelope. Counted here, where
  -- all rows are visible, instead of in a client that RLS correctly blinds.
  SELECT count(*) INTO v_missing
  FROM public.e2ee_required_epoch_recipients(p_scope_key_id) req
  WHERE NOT EXISTS (
    SELECT 1 FROM public.key_envelopes ke
    WHERE ke.scope_key_id = p_scope_key_id
      AND ke.recipient_kind = req.recipient_kind
      AND (
        (req.recipient_kind = 'device' AND ke.recipient_device_id = req.recipient_id)
        OR (req.recipient_kind = 'recovery_identity' AND ke.recipient_recovery_id = req.recipient_id)
      )
  );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'E2EE_EPOCH_INCOMPLETE: % required recipient envelope(s) missing', v_missing
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- And no envelope may address a revoked device.
  SELECT count(*) INTO v_revoked
  FROM public.key_envelopes ke
  JOIN public.revocation_statements rs ON rs.revoked_device_id = ke.recipient_device_id
  WHERE ke.scope_key_id = p_scope_key_id;
  IF v_revoked > 0 THEN
    RAISE EXCEPTION 'E2EE_EPOCH_HAS_REVOKED_RECIPIENT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.scope_keys SET state = 'READY' WHERE id = p_scope_key_id;
  RETURN 'READY';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_mark_epoch_ready(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_epoch_ready(UUID) TO authenticated;

COMMENT ON FUNCTION public.e2ee_mark_epoch_ready(UUID) IS
  'PREPARING -> READY. Verifies full recipient coverage internally so partner envelopes stay unreadable while still being counted.';

-- The same three-valued-logic hole in the other two transitions. 031 wrote
-- `IF NOT public.e2ee_can_manage_scope_key(v_key)`, which is NULL — and
-- therefore not taken — for any caller with no active couple. An unrelated
-- authenticated user could consequently activate or abandon another couple's
-- epoch: abandoning a PREPARING epoch is a denial of service against a pairing
-- in progress, and activating one is worse. Rewritten with `IS NOT TRUE`,
-- otherwise unchanged.
CREATE OR REPLACE FUNCTION public.e2ee_activate_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.scope_keys;
  v_revoked INTEGER;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;
  IF public.e2ee_can_manage_scope_key(v_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The resurrection guard. RETIRED and ABANDONED are terminal.
  IF v_key.state <> 'READY' THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> ACTIVE', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_revoked
  FROM public.key_envelopes ke
  JOIN public.revocation_statements rs ON rs.revoked_device_id = ke.recipient_device_id
  WHERE ke.scope_key_id = p_scope_key_id;
  IF v_revoked > 0 THEN
    RAISE EXCEPTION 'E2EE_EPOCH_HAS_REVOKED_RECIPIENT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock and retire the outgoing epoch in the same transaction.
  PERFORM 1 FROM public.scope_keys
   WHERE domain = v_key.domain AND scope_id = v_key.scope_id AND state = 'ACTIVE'
   FOR UPDATE;

  UPDATE public.scope_keys
     SET state = 'RETIRED', superseded_at = now()
   WHERE domain = v_key.domain AND scope_id = v_key.scope_id AND state = 'ACTIVE';

  UPDATE public.scope_keys
     SET state = 'ACTIVE', activated_at = now()
   WHERE id = p_scope_key_id;

  RETURN 'ACTIVE';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_activate_epoch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_activate_epoch(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.e2ee_abandon_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_key public.scope_keys;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;
  IF public.e2ee_can_manage_scope_key(v_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_key.state NOT IN ('PREPARING', 'READY') THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> ABANDONED', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.scope_keys SET state = 'ABANDONED' WHERE id = p_scope_key_id;
  RETURN 'ABANDONED';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_abandon_epoch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_abandon_epoch(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 7. P0-5 — the server decides which couple scopes recovery must rotate
-- -------------------------------------------------------------
-- The recovering client cannot be the authority on this: a client that omits a
-- couple id would rotate PMK and HRK, skip the CSK, and still look successful.
CREATE OR REPLACE FUNCTION public.e2ee_owned_couple_scope_ids()
RETURNS TABLE (couple_id UUID)
LANGUAGE plpgsql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNAUTHENTICATED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every couple the caller is an active member of that has a live epoch. A
  -- couple with no epoch yet needs no rotation; one with a RETIRED-only history
  -- does not either.
  RETURN QUERY
  SELECT DISTINCT cm.couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = v_uid
    AND cm.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.scope_keys sk
      WHERE sk.domain = 'couple'
        AND sk.owner_couple_id = cm.couple_id
        AND sk.state IN ('ACTIVE', 'PREPARING', 'READY')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_owned_couple_scope_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_owned_couple_scope_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.e2ee_owned_couple_scope_ids() IS
  'Couple scopes the caller holds that require rotation. Authoritative for recovery; the UI must not supply this list.';

-- -------------------------------------------------------------
-- 8. PostgREST schema cache
-- -------------------------------------------------------------
-- `e2ee_commit_device_approval` gained a parameter and four functions are new, so
-- a stale cache would answer PGRST202 for every one of them — meaning second
-- device approval and provisioning would fail in production while the migration
-- itself looked applied. One reload refreshes the whole cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
