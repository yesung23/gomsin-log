-- 059_partner_managed_username.sql
-- Let an active partner choose the other person's username without widening
-- ordinary profiles SELECT/UPDATE policies.

BEGIN;

-- The global profile username remains owner-visible, but its mutation authority
-- is intentionally the active partner's session. The dedicated RPC below is
-- SECURITY DEFINER and therefore is the only authenticated path that can pass
-- this trigger for another profile row.
CREATE OR REPLACE FUNCTION public.enforce_partner_managed_username()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND NEW.username IS DISTINCT FROM OLD.username
    AND auth.uid() = OLD.id
  THEN
    RAISE EXCEPTION 'username_is_partner_managed' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL AND NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_partner_managed_username() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_partner_managed_username ON public.profiles;
CREATE TRIGGER enforce_partner_managed_username
  BEFORE UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_managed_username();

DROP FUNCTION IF EXISTS public.set_partner_username(text);
CREATE FUNCTION public.set_partner_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_partner_id UUID;
  v_username TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_username IS NULL THEN
    RAISE EXCEPTION 'invalid_username' USING ERRCODE = '22023';
  END IF;
  v_username := lower(btrim(p_username));
  IF v_username !~ '^[a-z][a-z0-9_]{2,19}$' THEN
    RAISE EXCEPTION 'invalid_username' USING ERRCODE = '22023';
  END IF;

  SELECT cm.couple_id INTO v_couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = v_uid
    AND cm.status = 'active'
  LIMIT 1;
  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'inactive_couple' USING ERRCODE = '42501';
  END IF;

  -- The same couple lock serializes this operation with disconnect_couple().
  PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'inactive_couple' USING ERRCODE = '42501';
  END IF;

  SELECT cm.user_id INTO v_partner_id
  FROM public.couple_members cm
  WHERE cm.couple_id = v_couple_id
    AND cm.status = 'active'
    AND cm.user_id <> v_uid
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_not_connected' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests
    WHERE user_id IN (v_uid, v_partner_id)
  ) THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET username = v_username,
         updated_at = now()
   WHERE id = v_partner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
  VALUES (v_couple_id, 'profile', clock_timestamp())
  ON CONFLICT (couple_id, slice)
  DO UPDATE SET updated_at = EXCLUDED.updated_at;

  RETURN v_username;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'username_taken' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.set_partner_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_partner_username(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.set_partner_username(text);
