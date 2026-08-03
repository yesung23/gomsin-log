-- 016_couple_state_visibility.sql
--
-- Additive, idempotent, forward-only. Adds ONE read-only RPC and changes no
-- existing object, no existing grant and no existing policy.
--
-- WHY THIS MIGRATION EXISTS
--
-- Migration 013 §6 revoked all client SELECT on `public.invitation_codes`:
--
--     REVOKE SELECT ON TABLE public.invitation_codes FROM authenticated;
--
-- That was the right call -- a client that can read those rows can probe hashes
-- and read another couple's metadata. The consequence, though, is that the client
-- has NO way to answer a question it must answer on every launch:
--
--   * "I created a space and my partner has not joined yet"  (pending)
--   * "My invitation code has expired"                       (pending, expired)
--   * "I am in no couple space at all"                       (personal)
--
-- All three looked identical, so a creator holding a live invitation was shown
-- personal-mode copy telling them to enter a code -- the one action
-- `redeem_invitation` rejects for them (`self_invitation`). Records could also be
-- refused for a user whose membership was real but locally invisible.
--
-- `get_my_couple_state()` is the minimum authoritative answer to that question.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
--
--   * no `code`      -- the plaintext only ever exists on the creator's device;
--   * no `code_hash` -- returning it would restore exactly the probing capability
--                       013 removed;
--   * no partner identity beyond a boolean -- `get_partner_profile()` remains the
--                       only source of the partner's display name.
--
-- It reports only: which couple (if any) the CALLER belongs to, the caller's own
-- membership row, whether a second active member exists, and whether an unused,
-- unexpired invitation is outstanding together with its expiry.
--
-- IDEMPOTENCY / RE-RUNNABILITY
--
-- Every function is dropped by EXACT SIGNATURE before it is created. Applying 013
-- remotely failed with:
--
--     cannot change return type of existing function redeem_invitation(text)
--
-- because `CREATE OR REPLACE FUNCTION` cannot change a return type. 015 fixed that
-- for itself with an explicit DROP; this migration adopts the same rule for every
-- function it defines, so re-running this file -- or changing the return shape in a
-- later revision of it -- can never hit that failure class.
--
-- DEPLOYMENT: apply in the Supabase SQL Editor, then reload the PostgREST schema
-- cache (Settings -> API -> Reload schema, or `NOTIFY pgrst, 'reload schema'`).
-- Without the reload the RPC answers PGRST202 and the client reports "not
-- deployed" rather than "no couple space" -- see `fetchMyCoupleState`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. get_my_couple_state
--
--    STABLE: it performs no writes, so PostgREST may treat it as a read.
--    SECURITY DEFINER: required, because `invitation_codes` is intentionally
--    unreadable by `authenticated`. The function is the whole security boundary,
--    so it filters strictly on `auth.uid()` and never accepts a parameter -- there
--    is no argument through which another user's state could be requested.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_couple_state();

CREATE FUNCTION public.get_my_couple_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_role TEXT;
  v_member_status TEXT;
  v_partner_present BOOLEAN := false;
  v_invitation_active BOOLEAN := false;
  v_invitation_expires_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- The caller's own membership row. `active` is preferred, but a non-active row
  -- is still reported so a disconnected user is not indistinguishable from a user
  -- who never had a space.
  SELECT couple_id, role, status
  INTO v_couple_id, v_role, v_member_status
  FROM public.couple_members
  WHERE user_id = v_uid
  ORDER BY (status = 'active') DESC, joined_at DESC NULLS LAST
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    -- Authoritative negative: no membership of any kind.
    RETURN jsonb_build_object(
      'couple_id', NULL,
      'role', NULL,
      'member_status', NULL,
      'partner_present', false,
      'invitation_active', false,
      'invitation_expires_at', NULL
    );
  END IF;

  -- A second ACTIVE member is what "connected" means. Counting any member would
  -- report a disconnected partner as still present.
  SELECT EXISTS (
    SELECT 1
    FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id <> v_uid
      AND status = 'active'
  )
  INTO v_partner_present;

  -- Outstanding invitation: unused AND unexpired. Only the expiry timestamp
  -- leaves this function; the hash never does.
  IF v_member_status = 'active' AND NOT v_partner_present THEN
    SELECT expires_at
    INTO v_invitation_expires_at
    FROM public.invitation_codes
    WHERE couple_id = v_couple_id
      AND used = false
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;

    v_invitation_active := v_invitation_expires_at IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'couple_id', v_couple_id,
    'role', v_role,
    'member_status', v_member_status,
    'partner_present', v_partner_present,
    'invitation_active', v_invitation_active,
    'invitation_expires_at', v_invitation_expires_at
  );
END;
$$;

-- Mirrors 015's grant pattern exactly: revoke from everything, then grant to
-- `authenticated` only. `anon` and PUBLIC never receive EXECUTE -- an unauthenticated
-- caller must not be able to probe couple existence.
REVOKE ALL ON FUNCTION public.get_my_couple_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_couple_state() FROM anon;
REVOKE ALL ON FUNCTION public.get_my_couple_state() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_couple_state() TO authenticated;

COMMENT ON FUNCTION public.get_my_couple_state() IS
  'Read-only couple lifecycle for auth.uid(): membership, partner presence and '
  'invitation validity. Never returns an invitation code or code hash. '
  'SECURITY DEFINER because invitation_codes is unreadable by authenticated '
  '(migration 013).';

COMMIT;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- This migration is purely additive: dropping the function restores the exact
-- pre-016 state. The client degrades to reporting the lifecycle as `unknown`,
-- which by contract never overwrites valid local state.
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.get_my_couple_state();
-- COMMIT;
--
-- Then reload the PostgREST schema cache.
