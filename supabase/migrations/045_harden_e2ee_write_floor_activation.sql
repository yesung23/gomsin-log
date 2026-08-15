-- 045: Bind irreversible write-floor activation to a fully provisioned device.
--
-- `devices.status` is operational state, not cryptographic proof. Migration 040
-- accepted every owned device except REVOKED, which allowed PENDING and failed
-- provisioning rows to activate an irreversible floor. This forward correction
-- requires the exact ACTIVE device to have both its immutable certificate and a
-- self-notarized envelope for the ACTIVE key epoch of the requested scope.

BEGIN;

CREATE OR REPLACE FUNCTION public.activate_e2ee_write_floor(
  p_scope_kind TEXT,
  p_scope_id UUID,
  p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_scope_key_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Serialize against the revocation trigger, which takes the same per-device
  -- lock. A device cannot pass the check and be revoked concurrently before
  -- this transaction records the irreversible floor.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id::TEXT, 0));

  -- ACTIVE is necessary but deliberately not sufficient. The certificate and
  -- scope-specific self-notarized envelope below are the cryptographic
  -- provisioning evidence; status alone is never treated as trust input.
  IF NOT EXISTS (
    SELECT 1
    FROM public.devices d
    WHERE d.id = p_device_id
      AND d.user_id = v_uid
      AND d.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1
        FROM public.revocation_statements rs
        WHERE rs.revoked_device_id = d.id
      )
  ) THEN
    RAISE EXCEPTION 'E2EE_DEVICE_SCOPE_FORBIDDEN';
  END IF;

  IF p_scope_kind = 'user' THEN
    IF p_scope_id <> v_uid THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;

    -- Personal activation is PMK-only. HRK/health can never satisfy this.
    SELECT sk.id INTO v_scope_key_id
    FROM public.scope_keys sk
    WHERE sk.state = 'ACTIVE'
      AND sk.domain = 'personal'
      AND sk.scope_id = p_scope_id
      AND sk.owner_user_id = v_uid;

    IF v_scope_key_id IS NULL THEN
      RAISE EXCEPTION 'E2EE_FLOOR_NO_ACTIVE_PERSONAL_EPOCH';
    END IF;
  ELSIF p_scope_kind = 'couple' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.couple_members cm
      WHERE cm.couple_id = p_scope_id
        AND cm.user_id = v_uid
        AND cm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;

    SELECT sk.id INTO v_scope_key_id
    FROM public.scope_keys sk
    WHERE sk.state = 'ACTIVE'
      AND sk.domain = 'couple'
      AND sk.scope_id = p_scope_id
      AND sk.owner_couple_id = p_scope_id;

    IF v_scope_key_id IS NULL THEN
      RAISE EXCEPTION 'E2EE_FLOOR_NO_ACTIVE_COUPLE_EPOCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'E2EE_FLOOR_BAD_SCOPE_KIND';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.device_certificates dc
    JOIN public.key_envelopes ke
      ON ke.sender_certificate_id = dc.id
    WHERE dc.user_id = v_uid
      AND dc.subject_device_id = p_device_id
      AND ke.scope_key_id = v_scope_key_id
      AND ke.recipient_kind = 'device'
      AND ke.recipient_device_id = p_device_id
      AND ke.sender_device_id = p_device_id
      AND ke.self_notarized = true
  ) THEN
    RAISE EXCEPTION 'E2EE_FLOOR_DEVICE_NOT_PROVISIONED';
  END IF;

  INSERT INTO public.crypto_write_floor (
    scope_kind,
    scope_id,
    min_cipher_format,
    activated_at,
    activated_by_device_id
  )
  VALUES (p_scope_kind, p_scope_id, 1, now(), p_device_id)
  ON CONFLICT (scope_kind, scope_id) DO UPDATE
    SET min_cipher_format = GREATEST(public.crypto_write_floor.min_cipher_format, 1),
        activated_at = COALESCE(public.crypto_write_floor.activated_at, now()),
        activated_by_device_id = COALESCE(
          public.crypto_write_floor.activated_by_device_id,
          p_device_id
        );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID) IS
  'Irreversible exact-scope floor activation. Requires an owned ACTIVE, non-revoked device plus its certificate and self-notarized envelope for the requested ACTIVE epoch.';

NOTIFY pgrst, 'reload schema';

COMMIT;
