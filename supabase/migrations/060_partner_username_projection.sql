-- 060_partner_username_projection.sql
-- Expose only the active partner's English username to the other member.
-- The owner-managed profiles SELECT boundary stays unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_partner_profile_with_username()
RETURNS TABLE (display_name TEXT, role TEXT, avatar_path TEXT, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT p.display_name, p.role, p.avatar_path, p.username
  FROM public.profiles p
  JOIN public.couple_members cm ON cm.user_id = p.id
  WHERE cm.status = 'active'
    AND cm.couple_id IN (
      SELECT couple_id
      FROM public.couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
    AND p.id <> auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_profile_with_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_profile_with_username() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.get_partner_profile_with_username();
