-- =============================================================
-- 030_harden_create_invitation_search_path.sql
-- Close the legacy SECURITY DEFINER temp-schema shadowing path.
-- =============================================================
--
-- The client has used create_couple_and_invitation() since migration 015, but
-- create_invitation(UUID, TEXT) remains an authenticated PostgREST RPC for
-- legacy callers. Its 001 definition used unqualified relation names with a
-- search_path that implicitly searched a caller's pg_temp schema first. A
-- caller could shadow couple_members, pass the membership check, and issue an
-- invitation code for a different couple.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_invitation(p_couple_id UUID, p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.couple_members
    WHERE couple_id = p_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active member access required';
  END IF;

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (p_couple_id, p_code_hash, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_invitation(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_invitation(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback: replace this function with the exact 001 definition only after a
-- compatibility failure is proven. Do not broaden EXECUTE permissions.
