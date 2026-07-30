-- 010_revoke_anon_rpc_access.sql
-- Explicitly remove any legacy grants made directly to the Supabase anon role.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_active_couple_id() FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_partner_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_partner_profile() FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

COMMIT;
