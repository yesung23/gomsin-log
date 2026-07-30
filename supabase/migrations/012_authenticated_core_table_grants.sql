-- 012_authenticated_core_table_grants.sql
--
-- Give signed-in users the table privileges required by the client.
-- Row Level Security remains enabled and continues to decide which rows each
-- user may read or change. Anonymous users keep no access to private tables.

BEGIN;

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.couples FROM anon;
REVOKE ALL ON TABLE public.couple_members FROM anon;
REVOKE ALL ON TABLE public.invitation_codes FROM anon;
REVOKE ALL ON TABLE public.daily_records FROM anon;
REVOKE ALL ON TABLE public.briefings FROM anon;
REVOKE ALL ON TABLE public.contact_preferences FROM anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.couples TO authenticated;
GRANT SELECT ON TABLE public.couple_members TO authenticated;
GRANT SELECT ON TABLE public.invitation_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_records TO authenticated;
GRANT SELECT ON TABLE public.briefings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_preferences TO authenticated;

COMMIT;
