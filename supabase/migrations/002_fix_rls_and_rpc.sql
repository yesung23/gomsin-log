-- 1. Create atomic function to create couple space & invitation code
CREATE OR REPLACE FUNCTION public.create_couple_and_invitation(p_role TEXT, p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id UUID;
BEGIN
  -- Insert new couple
  INSERT INTO public.couples DEFAULT VALUES
  RETURNING id INTO v_couple_id;

  -- Insert active member for creator
  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, auth.uid(), p_role, 'active')
  ON CONFLICT (couple_id, user_id) DO UPDATE SET status = 'active';

  -- Create invitation code entry
  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, auth.uid());

  RETURN v_couple_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) TO authenticated;

-- 2. Fix RLS policies on couples table
DROP POLICY IF EXISTS "Active members can view couple" ON public.couples;
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;

CREATE POLICY "Active members can view couple"
  ON public.couples FOR SELECT
  USING (
    id = public.get_my_active_couple_id()
    OR id IN (SELECT couple_id FROM public.couple_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create couples"
  ON public.couples FOR INSERT
  WITH CHECK (true);

-- 3. Fix RLS policies on couple_members table
DROP POLICY IF EXISTS "Active members can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;

CREATE POLICY "Users can view couple members"
  ON public.couple_members FOR SELECT
  USING (true);

CREATE POLICY "Users can insert couple members"
  ON public.couple_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update couple members"
  ON public.couple_members FOR UPDATE
  USING (user_id = auth.uid());
