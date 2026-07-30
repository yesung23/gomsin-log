-- 006_auth_and_rpc_fixes.sql
-- 1. disconnect_couple
CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_couple_id uuid;
  v_updated int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock the membership row to find active couple
  SELECT couple_id INTO v_couple_id 
  FROM couple_members 
  WHERE user_id = v_uid AND status = 'active'
  FOR UPDATE;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'active couple not found';
  END IF;

  -- Disconnect all active members of this couple
  UPDATE couple_members
  SET status = 'disconnected'
  WHERE couple_id = v_couple_id AND status = 'active';
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'active couple not found';
  END IF;

  UPDATE couples SET updated_at = now() WHERE id = v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

-- 2. consume_invitation
CREATE OR REPLACE FUNCTION public.consume_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_invite RECORD;
  v_couple_id UUID;
  v_inviter_role TEXT;
  v_invitee_role TEXT;
  v_active_count INT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller doesn't already have an active couple
  IF EXISTS (SELECT 1 FROM couple_members WHERE user_id = v_uid AND status = 'active') THEN
    RAISE EXCEPTION 'User already in an active couple';
  END IF;

  -- Lock and update the invitation in one step to prevent race conditions
  UPDATE invitation_codes
  SET used = true, used_by = v_uid, used_at = now()
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at > now()
    AND created_by != v_uid
  RETURNING * INTO v_invite;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already used invitation code, or self-invite attempted';
  END IF;

  v_couple_id := v_invite.couple_id;

  -- Lock couple row
  PERFORM 1 FROM couples WHERE id = v_couple_id FOR UPDATE;

  SELECT count(*) INTO v_active_count FROM couple_members WHERE couple_id = v_couple_id AND status = 'active';
  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'Couple space is full';
  END IF;

  -- Determine opposite role
  SELECT role INTO v_inviter_role 
  FROM couple_members 
  WHERE couple_id = v_couple_id AND status = 'active' 
  LIMIT 1;

  IF v_inviter_role = 'soldier' THEN
    v_invitee_role := 'gomsin';
  ELSIF v_inviter_role = 'gomsin' THEN
    v_invitee_role := 'soldier';
  ELSE
    RAISE EXCEPTION 'Invalid inviter role or inviter not found';
  END IF;

  -- Insert invitee as active member
  INSERT INTO couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, v_invitee_role, 'active')
  ON CONFLICT (couple_id, user_id) DO UPDATE SET status = 'active', role = v_invitee_role;

  -- Update couple status timestamp
  UPDATE couples SET updated_at = now() WHERE id = v_couple_id;

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;
