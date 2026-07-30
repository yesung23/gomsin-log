-- 008_membership_integrity.sql
-- Finalize 1:1 membership integrity after the legacy 001/002 policies.

-- The legacy unique index on (couple_id, status) allowed only one active row
-- per couple, which prevented the invited partner from joining.
DROP INDEX IF EXISTS public.idx_couple_active_members;

CREATE INDEX IF NOT EXISTS idx_couple_members_active_lookup
  ON public.couple_members (couple_id)
  WHERE status = 'active';

-- Membership changes must happen only through the audited SECURITY DEFINER
-- functions. Remove the legacy direct-write policies left by migration 002.
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;

-- Couple creation must also go through create_couple_and_invitation so an
-- authenticated user cannot create orphaned or unlimited couple rows directly.
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;

CREATE OR REPLACE FUNCTION public.create_couple_and_invitation(
  p_role TEXT,
  p_code_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_couple_id UUID;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_role NOT IN ('gomsin', 'soldier') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF p_code_hash IS NULL OR length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couple_members
    WHERE user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'User already in an active couple';
  END IF;

  INSERT INTO public.couples DEFAULT VALUES
  RETURNING id INTO v_couple_id;

  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, p_role, 'active');

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) TO authenticated;
