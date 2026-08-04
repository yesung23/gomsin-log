-- 017_partner_profile_hardening_and_schema_reload.sql
--
-- Additive, idempotent, forward-only. Two things, both of which had to be a NEW
-- file rather than an edit: migrations 001-016 have already been applied
-- remotely, so they are immutable.
--
-- WHY THIS MIGRATION EXISTS
--
-- 1. `public.get_partner_profile()` is the only SECURITY DEFINER function in the
--    tree whose `search_path` is not pinned to `public, pg_temp`. It was created
--    once, at `001_initial_schema.sql:278-282`, with `SET search_path = public`,
--    and never redefined -- 009 and 010 only changed its grants. Every other
--    SECURITY DEFINER function (005, 006, 008, 009, 013, 014, 015, 016) pins
--    `pg_temp`.
--
--    Without `pg_temp` in the search_path, a caller who can create objects in
--    their own temporary schema can shadow an unqualified name the function body
--    resolves, and the body then runs as the DEFINER. This function's body does
--    qualify its reads, so this is defence-in-depth rather than a known live
--    exploit -- but it is the one inconsistency, and inconsistency is what makes
--    the next function easy to get wrong. Four client call sites depend on it:
--    `store.tsx`, `sync.ts`, `OnboardingPage.tsx`, `SettingsPage.tsx`.
--
--    The signature and the returned columns are IDENTICAL to 001. This migration
--    hardens the function; it does not change the client contract. `role` and
--    `avatar_path` are unread by the client today and are kept anyway, because
--    dropping columns from the result would be a contract change that has to
--    happen with a client release, not inside a security fix.
--
-- 2. NO migration in the tree ever executed `NOTIFY pgrst, 'reload schema'`. The
--    single grep hit before this file was a COMMENT (`016:52`). Migrations 013,
--    014, 015 and 016 all create or change RPC signatures -- 015 even changes the
--    RETURN TYPE of `redeem_invitation` via DROP + CREATE -- and every one of them
--    relied on an operator remembering to reload the PostgREST schema cache by
--    hand. Until that reload happens, PostgREST answers `PGRST202` ("function not
--    found in schema cache") for the new signature, which on the redemption path
--    is the only API a partner has.
--
--    The NOTIFY below is inside the transaction on purpose: Postgres delivers
--    notifications at COMMIT, so a rolled-back migration cannot ask PostgREST to
--    reload a schema it never got. One reload covers the whole cache, so this
--    single NOTIFY also settles the 013-016 signatures for any project that is
--    applying the migrations in order.
--
-- IDEMPOTENCY / RE-RUNNABILITY
--
-- `DROP FUNCTION IF EXISTS` uses the EXACT signature before the create, which is
-- the rule 016 adopted after applying 013 remotely failed with
-- `cannot change return type of existing function redeem_invitation(text)`.
-- Re-running this file is a no-op: the function is redefined to the same body,
-- the grants are re-asserted to the same state, and a second NOTIFY is harmless.
--
-- DEPLOYMENT: apply in the Supabase SQL Editor. The reload is performed by this
-- file, so no manual "Settings -> API -> Reload schema" step is required; doing it
-- anyway is harmless.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. get_partner_profile -- unchanged behaviour, pinned search_path
--
--    SECURITY DEFINER: required, because `profiles` rows of the partner are not
--    directly selectable. The function is the whole security boundary, so it
--    filters strictly on `auth.uid()`, takes no parameter, and returns at most
--    the other ACTIVE member of the caller's own ACTIVE couple.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_partner_profile();

CREATE OR REPLACE FUNCTION public.get_partner_profile()
RETURNS TABLE (display_name TEXT, role TEXT, avatar_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT p.display_name, p.role, p.avatar_path
  FROM profiles p
  JOIN couple_members cm ON cm.user_id = p.id
  WHERE cm.status = 'active'
    AND cm.couple_id IN (
      SELECT couple_id FROM couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
    AND p.id != auth.uid();
END;
$$;

-- Mirrors the grant pattern of 015 and 016 exactly: revoke from everything, then
-- grant to `authenticated` only. `anon` and PUBLIC never receive EXECUTE -- an
-- unauthenticated caller must not be able to probe couple membership.
REVOKE ALL ON FUNCTION public.get_partner_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_profile() FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_profile() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_profile() TO authenticated;

COMMENT ON FUNCTION public.get_partner_profile() IS
  'Minimal profile of the other ACTIVE member of auth.uid()''s ACTIVE couple. '
  'SECURITY DEFINER with search_path pinned to public, pg_temp (migration 017); '
  'takes no parameter, so another couple''s membership cannot be requested.';

-- ---------------------------------------------------------------------------
-- 2. PostgREST schema cache reload
--
--    Delivered at COMMIT. Covers every function signature created or changed by
--    013, 014, 015, 016 and this file, so a fresh apply no longer leaves clients
--    on PGRST202 until someone reloads by hand.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Restores the pre-017 definition verbatim from 001_initial_schema.sql -- i.e.
-- the same function WITHOUT `pg_temp` in its search_path -- and re-asserts the
-- grants 010 left in place. Only do this if the pinned search_path is proven to
-- break something; it re-opens the inconsistency this migration closed.
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.get_partner_profile();
--   CREATE OR REPLACE FUNCTION public.get_partner_profile()
--   RETURNS TABLE (display_name TEXT, role TEXT, avatar_path TEXT)
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   BEGIN
--     RETURN QUERY
--     SELECT p.display_name, p.role, p.avatar_path
--     FROM profiles p
--     JOIN couple_members cm ON cm.user_id = p.id
--     WHERE cm.status = 'active'
--       AND cm.couple_id IN (
--         SELECT couple_id FROM couple_members
--         WHERE user_id = auth.uid() AND status = 'active'
--       )
--       AND p.id != auth.uid();
--   END;
--   $$;
--   REVOKE ALL ON FUNCTION public.get_partner_profile() FROM PUBLIC;
--   REVOKE ALL ON FUNCTION public.get_partner_profile() FROM anon;
--   GRANT EXECUTE ON FUNCTION public.get_partner_profile() TO authenticated;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
