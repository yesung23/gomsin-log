-- =============================================================
-- 044_unlink_crypto_pairing_authority.sql
-- Couple lifecycle must revoke the cryptographic pairing too.
-- =============================================================
--
-- 031 introduced the terminal UNLINKED pairing state, but the last
-- disconnect_couple() definition only changed couple_members.  That left the
-- server's pairing row claiming CRYPTO_ACTIVE after the active-membership RLS
-- boundary had been removed.  This forward migration makes both transitions
-- one SECURITY DEFINER transaction. It does not delete historical key rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT couple_id
  INTO v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active'
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  -- Serialize against a concurrent invitation or a second disconnect before
  -- changing either relationship membership or crypto authority.
  PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  UPDATE public.crypto_pairings
  SET state = 'UNLINKED', updated_at = now()
  WHERE couple_id = v_couple_id
    AND state IN (
      'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE',
      'CONFIRMED_BOTH', 'EPOCH_PREPARING', 'CRYPTO_ACTIVE'
    );

  UPDATE public.couple_members
  SET status = 'disconnected'
  WHERE couple_id = v_couple_id
    AND status = 'active';

  UPDATE public.couples SET updated_at = now() WHERE id = v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_couple() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disconnect_couple() FROM anon;
REVOKE ALL ON FUNCTION public.disconnect_couple() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
