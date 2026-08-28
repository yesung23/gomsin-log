-- 064_lock_crypto_pairings_table_privileges.sql
-- Lock down table privileges on public.crypto_pairings.
--
-- 062 revoked direct INSERT, UPDATE, DELETE on public.crypto_pairings from authenticated
-- but left REFERENCES, TRIGGER, TRUNCATE intact. Because TRUNCATE bypasses RLS,
-- an authenticated role could execute TRUNCATE and bypass row-level security.
--
-- Revoke all table privileges from PUBLIC, anon, and authenticated, then
-- re-grant SELECT only to authenticated. Mutation is strictly gated by the 062
-- SECURITY DEFINER RPCs.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.crypto_pairings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crypto_pairings TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   Do not restore broad table privileges (TRUNCATE, REFERENCES, TRIGGER, INSERT, UPDATE, DELETE).
--   If rollback or repair is required, re-grant SELECT only or ship a forward repair:
--   BEGIN;
--   REVOKE ALL PRIVILEGES ON TABLE public.crypto_pairings FROM PUBLIC, anon, authenticated;
--   GRANT SELECT ON TABLE public.crypto_pairings TO authenticated;
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
