-- =============================================================
-- 029_cleanup_solo_couples_on_account_deletion.sql
-- Remove relationship metadata only when the deleting user is the sole member.
-- =============================================================
--
-- `public.couples` has no foreign key to auth.users and carries relationship
-- metadata such as anniversary_date. Auth deletion cascades the user's
-- couple_members row, but it cannot delete the parent couple row. Without this
-- step a never-paired/sole-member account leaves an orphan couple indefinitely.
--
-- A couple with ANY other membership row is deliberately retained. That
-- includes active, pending and disconnected/former partners: deleting it could
-- cascade another person's records or shared plans.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_account_solo_couples(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload';
  END IF;

  -- Serialize against a concurrent deletion of the other member, the way
  -- prepare_account_deletion already does. Under READ COMMITTED two partners
  -- deleting at once would each still see the other's membership row, both
  -- would decline to delete, and the couple would survive with zero members --
  -- precisely the orphaned anniversary_date this function exists to remove.
  PERFORM 1
  FROM public.couples AS couple
  JOIN public.couple_members AS mine ON mine.couple_id = couple.id
  WHERE mine.user_id = p_user_id
  FOR UPDATE OF couple;

  DELETE FROM public.couples AS couple
  USING public.couple_members AS mine
  WHERE mine.couple_id = couple.id
    AND mine.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.couple_members AS other
      WHERE other.couple_id = couple.id
        AND other.user_id <> p_user_id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_account_solo_couples(UUID) IS
  'Service-role-only account-deletion cleanup. Deletes a couple only when the deleting account is its sole member; preserves every couple with another current or former member.';

REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_account_solo_couples(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Deleting the couple row cascades to every couple-scoped table, including the
-- E2EE `scope_keys` / `key_envelopes` / `crypto_pairings` that 031 deliberately
-- kept off `auth.users`. That is safe only because this runs exclusively when no
-- other membership row exists, so the partner's Auth row -- and with it their
-- devices, recovery identities and envelopes -- is already gone.
--
-- Note for future edits: this RPC runs in its OWN transaction, after
-- prepare_account_deletion has committed. It therefore does not carry that
-- function's transaction-local destruction GUC. No DELETE-blocking trigger sits
-- on the cascaded E2EE tables today; if one is ever added, this call will raise
-- at the worst possible point in the sequence and must be revisited.

-- Rollback order:
-- 1. Deploy the previous delete-account Edge Function that does not call this RPC.
-- 2. DROP FUNCTION public.cleanup_account_solo_couples(UUID).
-- Never delete or recreate couple rows as part of rollback.
