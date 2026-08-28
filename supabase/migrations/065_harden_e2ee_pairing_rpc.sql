-- 065_harden_e2ee_pairing_rpc.sql
-- Forward hardening of the two-person CSK pairing ceremony RPCs.
--
-- Preserves 062 and 064 security guarantees while hardening:
--   1. e2ee_start_couple_pairing explicitly checks IS NULL on nonce,
--      transcript, and transcript_hash in addition to exact length.
--   2. e2ee_confirm_couple_pairing explicitly checks IS NULL on signature.
--   3. When a pairing is expired (or has NULL expires_at while not CRYPTO_ACTIVE),
--      e2ee_confirm_couple_pairing transitions state to 'TRANSCRIPT_EXPIRED'
--      and returns 'TRANSCRIPT_EXPIRED' as TEXT so the transaction commits the
--      state change instead of rolling back with an exception.
--   4. e2ee_confirm_couple_pairing returns 'TRANSCRIPT_EXPIRED' idempotently
--      when the pairing is already in 'TRANSCRIPT_EXPIRED' state.
--   5. Table privileges on public.crypto_pairings remain locked down to SELECT-only
--      for authenticated, with zero permissions for PUBLIC and anon (064 parity).

BEGIN;

-- 062's length predicates evaluated to SQL NULL for NULL evidence, so a direct
-- 062-era call could have persisted an incomplete live row. Quarantine any such
-- row before replacing the RPCs. This is deliberately a forward repair: terminal
-- rows remain historical, while no incomplete row can retain active authority.
UPDATE public.crypto_pairings
SET state = 'TRANSCRIPT_EXPIRED', updated_at = clock_timestamp()
WHERE state NOT IN ('TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED')
  AND (
    pairing_nonce IS NULL OR octet_length(pairing_nonce) <> 32
    OR transcript IS NULL OR octet_length(transcript) <> 440
    OR transcript_hash IS NULL OR octet_length(transcript_hash) <> 32
  );

CREATE OR REPLACE FUNCTION public.e2ee_start_couple_pairing(
  p_couple_id UUID,
  p_pairing_nonce BYTEA,
  p_transcript BYTEA,
  p_transcript_hash BYTEA,
  p_created_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pairing public.crypto_pairings%ROWTYPE;
  v_pairing_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_couple_id IS NULL
     OR p_couple_id IS DISTINCT FROM public.get_my_active_couple_id() THEN
    RAISE EXCEPTION 'not_active_couple_member' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.couple_members
      WHERE couple_id = p_couple_id AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'pairing_requires_exactly_two_active_members' USING ERRCODE = '23514';
  END IF;
  IF p_pairing_nonce IS NULL
     OR p_transcript IS NULL
     OR p_transcript_hash IS NULL
     OR octet_length(p_pairing_nonce) <> 32
     OR octet_length(p_transcript_hash) <> 32
     OR octet_length(p_transcript) <> 440 THEN
    RAISE EXCEPTION 'invalid_pairing_evidence' USING ERRCODE = '22023';
  END IF;
  IF p_created_at IS NULL OR p_expires_at IS NULL
     OR p_created_at < clock_timestamp() - interval '1 minute'
     OR p_created_at > clock_timestamp() + interval '1 minute'
     OR p_expires_at <= clock_timestamp()
     OR p_expires_at > p_created_at + interval '10 minutes' THEN
    RAISE EXCEPTION 'invalid_pairing_expiry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pairing
  FROM public.crypto_pairings
  WHERE couple_id = p_couple_id
    AND state NOT IN ('TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED')
  FOR UPDATE;

  IF FOUND THEN
    IF (v_pairing.expires_at IS NULL OR v_pairing.expires_at <= clock_timestamp())
       AND v_pairing.state <> 'CRYPTO_ACTIVE' THEN
      UPDATE public.crypto_pairings
      SET state = 'TRANSCRIPT_EXPIRED', updated_at = clock_timestamp()
      WHERE id = v_pairing.id;
    ELSIF v_pairing.state = 'CRYPTO_PENDING'
       AND v_pairing.pairing_nonce IS NULL
       AND v_pairing.transcript IS NULL
       AND v_pairing.transcript_hash IS NULL THEN
      UPDATE public.crypto_pairings
      SET state = 'TRANSCRIPT_PROPOSED',
          pairing_nonce = p_pairing_nonce,
          transcript = p_transcript,
          transcript_hash = p_transcript_hash,
          proposed_by_user_id = v_uid,
          expires_at = p_expires_at,
          created_at = p_created_at,
          updated_at = clock_timestamp()
      WHERE id = v_pairing.id;
      RETURN v_pairing.id;
    ELSIF v_pairing.pairing_nonce = p_pairing_nonce
       AND v_pairing.transcript_hash = p_transcript_hash
       AND v_pairing.transcript = p_transcript THEN
      RETURN v_pairing.id;
    ELSE
      RAISE EXCEPTION 'live_pairing_already_exists' USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.crypto_pairings (
    couple_id, state, pairing_nonce, transcript, transcript_hash,
    proposed_by_user_id, expires_at, created_at, updated_at
  ) VALUES (
    p_couple_id, 'TRANSCRIPT_PROPOSED', p_pairing_nonce, p_transcript,
    p_transcript_hash, v_uid, p_expires_at, p_created_at, clock_timestamp()
  )
  RETURNING id INTO v_pairing_id;

  RETURN v_pairing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.e2ee_confirm_couple_pairing(
  p_pairing_id UUID,
  p_device_id UUID,
  p_signature BYTEA
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pairing public.crypto_pairings%ROWTYPE;
  v_low_user_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_signature IS NULL OR octet_length(p_signature) <> 64 THEN
    RAISE EXCEPTION 'invalid_pairing_signature' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pairing
  FROM public.crypto_pairings
  WHERE id = p_pairing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pairing.couple_id IS DISTINCT FROM public.get_my_active_couple_id()
     OR NOT EXISTS (
       SELECT 1 FROM public.couple_members
       WHERE couple_id = v_pairing.couple_id AND user_id = v_uid AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'not_active_couple_member' USING ERRCODE = '42501';
  END IF;

  IF v_pairing.pairing_nonce IS NULL OR octet_length(v_pairing.pairing_nonce) <> 32
     OR v_pairing.transcript IS NULL OR octet_length(v_pairing.transcript) <> 440
     OR v_pairing.transcript_hash IS NULL OR octet_length(v_pairing.transcript_hash) <> 32 THEN
    UPDATE public.crypto_pairings
    SET state = 'TRANSCRIPT_EXPIRED', updated_at = clock_timestamp()
    WHERE id = p_pairing_id;
    RETURN 'TRANSCRIPT_EXPIRED';
  END IF;

  IF v_pairing.state = 'TRANSCRIPT_EXPIRED' THEN
    RETURN 'TRANSCRIPT_EXPIRED';
  END IF;

  IF (v_pairing.expires_at IS NULL OR v_pairing.expires_at <= clock_timestamp())
     AND v_pairing.state <> 'CRYPTO_ACTIVE' THEN
    UPDATE public.crypto_pairings
    SET state = 'TRANSCRIPT_EXPIRED', updated_at = clock_timestamp()
    WHERE id = p_pairing_id;
    RETURN 'TRANSCRIPT_EXPIRED';
  END IF;

  IF v_pairing.state NOT IN ('TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE', 'CONFIRMED_BOTH') THEN
    RAISE EXCEPTION 'pairing_not_confirmable' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.devices
    WHERE id = p_device_id AND user_id = v_uid AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'confirming_device_not_active_owner' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_low_user_id
  FROM public.couple_members
  WHERE couple_id = v_pairing.couple_id AND status = 'active'
  ORDER BY user_id::text
  LIMIT 1;

  IF v_uid = v_low_user_id THEN
    IF v_pairing.confirmed_low_signature IS NOT NULL
       AND (v_pairing.confirmed_low_device_id <> p_device_id
            OR v_pairing.confirmed_low_signature <> p_signature) THEN
      RAISE EXCEPTION 'pairing_confirmation_already_bound' USING ERRCODE = '23505';
    END IF;
    UPDATE public.crypto_pairings
    SET confirmed_low_device_id = p_device_id,
        confirmed_low_signature = p_signature,
        updated_at = clock_timestamp()
    WHERE id = p_pairing_id;
  ELSE
    IF v_pairing.confirmed_high_signature IS NOT NULL
       AND (v_pairing.confirmed_high_device_id <> p_device_id
            OR v_pairing.confirmed_high_signature <> p_signature) THEN
      RAISE EXCEPTION 'pairing_confirmation_already_bound' USING ERRCODE = '23505';
    END IF;
    UPDATE public.crypto_pairings
    SET confirmed_high_device_id = p_device_id,
        confirmed_high_signature = p_signature,
        updated_at = clock_timestamp()
    WHERE id = p_pairing_id;
  END IF;

  UPDATE public.crypto_pairings
  SET state = CASE
      WHEN confirmed_low_signature IS NOT NULL
       AND confirmed_high_signature IS NOT NULL THEN 'CONFIRMED_BOTH'
      ELSE 'CONFIRMED_ONE'
    END,
    updated_at = clock_timestamp()
  WHERE id = p_pairing_id
  RETURNING state INTO v_pairing.state;

  RETURN v_pairing.state;
END;
$$;

CREATE OR REPLACE FUNCTION public.e2ee_mark_couple_pairing_active(
  p_pairing_id UUID,
  p_scope_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_pairing public.crypto_pairings%ROWTYPE;
  v_low_user_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pairing
  FROM public.crypto_pairings
  WHERE id = p_pairing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pairing.couple_id IS DISTINCT FROM public.get_my_active_couple_id() THEN
    RAISE EXCEPTION 'not_active_couple_member' USING ERRCODE = '42501';
  END IF;
  IF v_pairing.pairing_nonce IS NULL OR octet_length(v_pairing.pairing_nonce) <> 32
     OR v_pairing.transcript IS NULL OR octet_length(v_pairing.transcript) <> 440
     OR v_pairing.transcript_hash IS NULL OR octet_length(v_pairing.transcript_hash) <> 32 THEN
    RAISE EXCEPTION 'invalid_persisted_pairing_evidence' USING ERRCODE = '22023';
  END IF;

  SELECT user_id INTO v_low_user_id
  FROM public.couple_members
  WHERE couple_id = v_pairing.couple_id AND status = 'active'
  ORDER BY user_id::text
  LIMIT 1;
  IF v_uid <> v_low_user_id THEN
    RAISE EXCEPTION 'canonical_pairing_owner_required' USING ERRCODE = '42501';
  END IF;
  IF v_pairing.state = 'CRYPTO_ACTIVE' THEN
    RETURN;
  END IF;
  IF v_pairing.state <> 'CONFIRMED_BOTH'
     OR v_pairing.confirmed_low_signature IS NULL
     OR v_pairing.confirmed_high_signature IS NULL THEN
    RAISE EXCEPTION 'both_pairing_confirmations_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scope_keys
    WHERE id = p_scope_key_id
      AND domain = 'couple'
      AND scope_id = v_pairing.couple_id
      AND owner_user_id IS NULL
      AND owner_couple_id = v_pairing.couple_id
      AND state = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'active_couple_scope_key_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.crypto_pairings
  SET state = 'CRYPTO_ACTIVE', updated_at = clock_timestamp()
  WHERE id = p_pairing_id;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE public.crypto_pairings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crypto_pairings TO authenticated;

REVOKE ALL ON FUNCTION public.e2ee_start_couple_pairing(UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.e2ee_confirm_couple_pairing(UUID, UUID, BYTEA)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.e2ee_mark_couple_pairing_active(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_start_couple_pairing(UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_confirm_couple_pairing(UUID, UUID, BYTEA)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_couple_pairing_active(UUID, UUID)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   Do not restore the vulnerable 062 function bodies or broaden table privileges.
--   If repair is needed, ship a forward migration that replaces only the affected
--   function body, then re-assert the 064 SELECT-only table privilege boundary.
