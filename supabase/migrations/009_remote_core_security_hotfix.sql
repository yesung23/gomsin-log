-- 009_remote_core_security_hotfix.sql
--
-- Purpose:
--   Repair the currently deployed core schema without depending on optional
--   events/trips/cycle tables that are not present in the remote project.
--
-- Safe application order for the currently observed remote project:
--   1. Back up the database/schema.
--   2. Apply this file as one transaction in a staging project.
--   3. Run the A/B/C checks in docs/rls-test-matrix.md.
--   4. Apply to the current remote project only after staging passes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Non-recursive active-couple lookup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID;
  v_couple_id UUID;
  v_count INTEGER;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*), min(couple_id)
    INTO v_count, v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active';

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Multiple active couples found for user';
  END IF;

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Membership integrity and RLS
-- ---------------------------------------------------------------------------
-- The legacy index allowed only one active row per couple.
DROP INDEX IF EXISTS public.idx_couple_active_members;

CREATE INDEX IF NOT EXISTS idx_couple_members_active_lookup
  ON public.couple_members (couple_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_active_couple
  ON public.couple_members (user_id)
  WHERE status = 'active';

ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Anyone can view couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view own couple membership" ON public.couple_members;
DROP POLICY IF EXISTS "Users can view active partner couple membership" ON public.couple_members;
DROP POLICY IF EXISTS "Users can insert couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update couple members" ON public.couple_members;
DROP POLICY IF EXISTS "Users can update their own couple member status" ON public.couple_members;

CREATE POLICY "Users can view own couple membership"
  ON public.couple_members
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view active partner couple membership"
  ON public.couple_members
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND status = 'active'
    AND couple_id = public.get_my_active_couple_id()
  );

-- No direct INSERT/UPDATE/DELETE policies are created. Membership mutations
-- must use the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- 3. Couple RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can view couple" ON public.couples;
DROP POLICY IF EXISTS "Active members can update couple" ON public.couples;
DROP POLICY IF EXISTS "Users can create couples" ON public.couples;

CREATE POLICY "Active members can view couple"
  ON public.couples
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active members can update couple"
  ON public.couples
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND id = public.get_my_active_couple_id()
  );

-- ---------------------------------------------------------------------------
-- 4. Daily-record RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS emotion_flow JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS emotion_updated_at TIMESTAMPTZ;

ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Author can manage own records" ON public.daily_records;
DROP POLICY IF EXISTS "Active partner can read shared records" ON public.daily_records;

CREATE POLICY "Author can manage own records"
  ON public.daily_records
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active partner can read shared records"
  ON public.daily_records
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND user_id <> auth.uid()
    AND is_private = false
  );

-- ---------------------------------------------------------------------------
-- 5. Atomic couple creation
-- ---------------------------------------------------------------------------
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
REVOKE EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Atomic invitation consumption
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_invite RECORD;
  v_couple_id UUID;
  v_inviter_role TEXT;
  v_invitee_role TEXT;
  v_active_count INTEGER;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couple_members
    WHERE user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'User already in an active couple';
  END IF;

  UPDATE public.invitation_codes
  SET used = true,
      used_by = v_uid,
      used_at = now()
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at > now()
    AND created_by <> v_uid
  RETURNING * INTO v_invite;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already used invitation code, or self-invite attempted';
  END IF;

  v_couple_id := v_invite.couple_id;

  PERFORM 1
  FROM public.couples
  WHERE id = v_couple_id
  FOR UPDATE;

  SELECT count(*)
    INTO v_active_count
  FROM public.couple_members
  WHERE couple_id = v_couple_id
    AND status = 'active';

  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'Couple space is full';
  END IF;

  SELECT role
    INTO v_inviter_role
  FROM public.couple_members
  WHERE couple_id = v_couple_id
    AND status = 'active'
  LIMIT 1;

  IF v_inviter_role = 'soldier' THEN
    v_invitee_role := 'gomsin';
  ELSIF v_inviter_role = 'gomsin' THEN
    v_invitee_role := 'soldier';
  ELSE
    RAISE EXCEPTION 'Invalid inviter role or inviter not found';
  END IF;

  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, v_invitee_role, 'active')
  ON CONFLICT (couple_id, user_id)
  DO UPDATE SET
    status = 'active',
    role = EXCLUDED.role;

  UPDATE public.couples
  SET updated_at = now()
  WHERE id = v_couple_id;

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Symmetric disconnect
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS VOID
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

  SELECT couple_id
    INTO v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active'
  FOR UPDATE;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  UPDATE public.couple_members
  SET status = 'disconnected'
  WHERE couple_id = v_couple_id
    AND status = 'active';

  UPDATE public.couples
  SET updated_at = now()
  WHERE id = v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM anon;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

-- Existing partner-profile RPC is read-only but must not be callable by anon.
REVOKE EXECUTE ON FUNCTION public.get_partner_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_profile() TO authenticated;

COMMIT;
