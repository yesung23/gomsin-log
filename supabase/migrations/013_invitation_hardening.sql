-- 013_invitation_hardening.sql
--
-- Purpose:
--   1. Add server-side brute-force protection to invitation code redemption.
--   2. Allow a space creator to mint a replacement invitation code.
--   3. Tighten the invitation_codes read policy.
--
-- Why (1) matters:
--   Invitation codes are 6 numeric digits (10^6 possibilities) and stay valid
--   for 24 hours. `consume_invitation` had no attempt limit, so any
--   authenticated caller could enumerate the entire keyspace and join a
--   stranger's couple space. The client-side damper in src/lib/supabase.ts is
--   only a UX nicety -- it is trivially bypassed by calling the RPC directly,
--   so the limit has to live here.
--
-- Why (2) matters:
--   Only a SHA-256 hash of the code is stored, so the plaintext exists solely
--   on the creator's device. If they clear their browser storage before the
--   partner joins, the code is unrecoverable, and the unique-active-couple
--   index blocks creating a new space -- a dead end with no way out.
--
-- Safe application order:
--   1. Back up the database.
--   2. Apply this file as one transaction in a STAGING project.
--   3. Run the checks in docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md.
--   4. Apply to production only after staging passes.
--
-- Rollback: see the bottom of this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Attempt log for invitation redemption
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitation_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE public.invitation_attempts IS
  'Rate-limit ledger for consume_invitation. Written by a SECURITY DEFINER function only.';

CREATE INDEX IF NOT EXISTS idx_invitation_attempts_user_time
  ON public.invitation_attempts (user_id, attempted_at DESC);

ALTER TABLE public.invitation_attempts ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: only SECURITY DEFINER functions touch
-- this table, so clients can neither read nor forge entries.
REVOKE ALL ON TABLE public.invitation_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.invitation_attempts FROM anon;
REVOKE ALL ON TABLE public.invitation_attempts FROM authenticated;
REVOKE ALL ON SEQUENCE public.invitation_attempts_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.invitation_attempts_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.invitation_attempts_id_seq FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Housekeeping helper (safe to call from a cron job)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_invitation_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.invitation_attempts
  WHERE attempted_at < now() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_invitation_attempts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_invitation_attempts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_invitation_attempts() FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. consume_invitation with a per-user throttle
--
--    Limits: 5 failed attempts per 10 minutes, and 20 per 24 hours.
--    Successful redemptions are recorded but do not count toward the limit.
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
  v_recent_failures INTEGER;
  v_daily_failures INTEGER;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_code_hash IS NULL OR length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  -- Throttle BEFORE doing any lookup, so a blocked caller learns nothing about
  -- whether the code exists.
  SELECT count(*) INTO v_recent_failures
  FROM public.invitation_attempts
  WHERE user_id = v_uid
    AND succeeded = false
    AND attempted_at > now() - INTERVAL '10 minutes';

  SELECT count(*) INTO v_daily_failures
  FROM public.invitation_attempts
  WHERE user_id = v_uid
    AND succeeded = false
    AND attempted_at > now() - INTERVAL '24 hours';

  IF v_recent_failures >= 5 OR v_daily_failures >= 20 THEN
    RAISE EXCEPTION 'Too many invitation attempts. Please try again later.';
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
    -- NOTE: a RAISE here rolls back everything this function did, including any
    -- attempt row inserted above. That is why failures are logged by the
    -- `redeem_invitation` wrapper in section 4, which catches the exception and
    -- writes the ledger entry outside the failed subtransaction.
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

  INSERT INTO public.invitation_attempts (user_id, succeeded)
  VALUES (v_uid, true);

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Wrapper that records a failed attempt even when the inner call aborts.
--
--    A RAISE inside consume_invitation rolls back its own INSERT, so the
--    attempt ledger is written here, outside that transaction boundary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_code_hash TEXT)
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

  BEGIN
    v_couple_id := public.consume_invitation(p_code_hash);
  EXCEPTION WHEN OTHERS THEN
    -- Log the failure outside the failed subtransaction, then re-raise so the
    -- client still sees the original reason.
    INSERT INTO public.invitation_attempts (user_id, succeeded)
    VALUES (v_uid, false);
    RAISE;
  END;

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reissue an invitation code for an existing, not-yet-joined couple
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regenerate_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_couple_id UUID;
  v_active_count INTEGER;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_code_hash IS NULL OR length(p_code_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  SELECT couple_id INTO v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active'
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.couple_members
  WHERE couple_id = v_couple_id
    AND status = 'active';

  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'Couple space is already connected';
  END IF;

  -- Invalidate any outstanding code for this couple so only the newest one
  -- works. Marking them used (rather than deleting) preserves the audit trail.
  UPDATE public.invitation_codes
  SET used = true,
      used_at = now()
  WHERE couple_id = v_couple_id
    AND used = false;

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.regenerate_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerate_invitation(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Narrow the invitation_codes read policy
--
--    Clients never need to read these rows: the plaintext code lives on the
--    creator's device and every state transition happens inside a
--    SECURITY DEFINER function. Removing SELECT stops a caller from probing
--    hashes or reading another couple's metadata.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Creator can view own invitations" ON public.invitation_codes;
DROP POLICY IF EXISTS "Users can view own invitation codes" ON public.invitation_codes;

REVOKE SELECT ON TABLE public.invitation_codes FROM authenticated;
REVOKE ALL ON TABLE public.invitation_codes FROM anon;
REVOKE ALL ON TABLE public.invitation_codes FROM PUBLIC;

COMMIT;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.regenerate_invitation(TEXT);
--   DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);
--   DROP FUNCTION IF EXISTS public.prune_invitation_attempts();
--   DROP TABLE IF EXISTS public.invitation_attempts;
--   -- Restore consume_invitation by re-running section 6 of
--   -- 009_remote_core_security_hotfix.sql.
--   GRANT SELECT ON TABLE public.invitation_codes TO authenticated;
--   CREATE POLICY "Creator can view own invitations"
--     ON public.invitation_codes FOR SELECT
--     USING (created_by = auth.uid());
-- COMMIT;
