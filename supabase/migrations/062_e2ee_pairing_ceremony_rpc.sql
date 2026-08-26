-- 062_e2ee_pairing_ceremony_rpc.sql
-- Product-safe writers for the two-person CSK pairing ceremony.
--
-- 031 intentionally created the pairing table before a product UI existed and
-- granted active members direct INSERT/UPDATE access.  That is too broad once
-- the ceremony becomes reachable: either member could write the other side's
-- confirmation columns.  These RPCs derive the actor from auth.uid(), lock the
-- live row, and let an actor write only their canonical side.

BEGIN;

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
  IF octet_length(p_pairing_nonce) <> 32
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
    IF v_pairing.expires_at <= clock_timestamp()
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
  IF octet_length(p_signature) <> 64 THEN
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
  IF v_pairing.expires_at IS NULL OR v_pairing.expires_at <= clock_timestamp() THEN
    UPDATE public.crypto_pairings
    SET state = 'TRANSCRIPT_EXPIRED', updated_at = clock_timestamp()
    WHERE id = p_pairing_id AND state <> 'CRYPTO_ACTIVE';
    RAISE EXCEPTION 'pairing_expired' USING ERRCODE = '22023';
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

REVOKE INSERT, UPDATE, DELETE ON TABLE public.crypto_pairings FROM authenticated;
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
