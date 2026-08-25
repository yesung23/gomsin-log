-- 061_reject_null_partner_profile_actor.sql
-- Fail closed when PostgREST reaches the partner projection without a JWT subject.
-- Keep the 060 return shape and active-couple projection unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_partner_profile_with_username()
RETURNS TABLE (display_name TEXT, role TEXT, avatar_path TEXT, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.display_name, p.role, p.avatar_path, p.username
  FROM public.profiles p
  JOIN public.couple_members partner_cm ON partner_cm.user_id = p.id
  WHERE partner_cm.status = 'active'
    AND partner_cm.couple_id IN (
      SELECT caller_cm.couple_id
      FROM public.couple_members caller_cm
      WHERE caller_cm.user_id = v_uid
        AND caller_cm.status = 'active'
    )
    AND p.id <> v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_profile_with_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_profile_with_username() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   Do not restore 060. Ship a higher-numbered forward fix that preserves the
--   explicit NULL-actor rejection and authenticated-only execution boundary.
