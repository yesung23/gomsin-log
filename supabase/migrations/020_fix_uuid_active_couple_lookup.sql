-- 020_fix_uuid_active_couple_lookup.sql
--
-- Production repair for PostgreSQL 42883 during an authenticated
-- `couple_members` read.
--
-- Migrations 005 and 009 used `min(couple_id)` while `couple_id` is UUID.
-- PostgreSQL does not provide the built-in `min(uuid)` aggregate, so the helper
-- raised 42883 when the partner-membership RLS policy evaluated it. Because the
-- helper is also used by records, events, trips and Storage policies, this broke
-- the whole authenticated workspace rather than only the initial membership read.
--
-- Keep the duplicate-active-membership integrity check, but select the UUID in a
-- separate scalar query after count(*) proves there is at most one row.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_count BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
    INTO v_count
  FROM public.couple_members AS member
  WHERE member.user_id = v_uid
    AND member.status = 'active';

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Multiple active couples found for user';
  END IF;

  SELECT member.couple_id
    INTO v_couple_id
  FROM public.couple_members AS member
  WHERE member.user_id = v_uid
    AND member.status = 'active'
  LIMIT 1;

  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_active_couple_id() FROM anon;
REVOKE ALL ON FUNCTION public.get_my_active_couple_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;

COMMENT ON FUNCTION public.get_my_active_couple_id() IS
  'Returns auth.uid()''s single active couple using a UUID-safe scalar lookup.';

NOTIFY pgrst, 'reload schema';

COMMIT;
