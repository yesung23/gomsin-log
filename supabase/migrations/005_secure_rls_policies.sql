-- 005_secure_rls_policies.sql
-- 1. Helper Function
CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_couple_id uuid;
  v_count int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*), min(couple_id) INTO v_count, v_couple_id
  FROM couple_members
  WHERE user_id = v_uid AND status = 'active';

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Multiple active couples found for user';
  END IF;

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;

-- 2. couple_members
DROP POLICY IF EXISTS "Active members can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view own couple membership" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view active partner couple membership" ON public.couple_members;

CREATE POLICY "Users can view own couple membership"
  ON public.couple_members FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view active partner couple membership"
  ON public.couple_members FOR SELECT
  USING (
    status = 'active' AND
    couple_id = public.get_my_active_couple_id()
  );

-- 3. daily_records
DROP POLICY IF EXISTS "Author can manage own records" ON public.daily_records;
DROP POLICY IF EXISTS "Active partner can read shared records" ON public.daily_records;

CREATE POLICY "Author can manage own records"
  ON public.daily_records
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid() AND 
    couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active partner can read shared records"
  ON public.daily_records
  FOR SELECT
  USING (
    couple_id = public.get_my_active_couple_id() AND
    user_id != auth.uid() AND
    is_private = false
  );

-- 4. events
-- Make is_private the single source of truth by dropping visibility
ALTER TABLE public.events DROP COLUMN IF EXISTS visibility;

DROP POLICY IF EXISTS "Active members can manage events" ON public.events;
DROP POLICY IF EXISTS "Creator can manage own events" ON public.events;
DROP POLICY IF EXISTS "Active partner can read shared events" ON public.events;

CREATE POLICY "Creator can manage own events"
  ON public.events
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid() AND 
    couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active partner can read shared events"
  ON public.events
  FOR SELECT
  USING (
    couple_id = public.get_my_active_couple_id() AND
    created_by != auth.uid() AND
    is_private = false
  );
