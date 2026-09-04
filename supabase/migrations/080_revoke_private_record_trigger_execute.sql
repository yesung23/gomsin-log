-- 080_revoke_private_record_trigger_execute.sql
--
-- Production advisor evidence on 2026-09-04 showed that the trigger-only
-- SECURITY DEFINER function below inherited explicit EXECUTE ACLs for anon,
-- authenticated and service_role. Migration 043 revoked PUBLIC only, which did
-- not remove those role-specific grants. The trigger itself does not need to be
-- exposed as a PostgREST RPC.
--
-- This release fix is intentionally exact. Changing ROLE postgres default
-- privileges without first inventorying the target project's non-public
-- postgres-owned functions would widen the blast radius beyond this defect.

BEGIN;

REVOKE ALL ON FUNCTION public.clear_talk_about_marks_when_record_private()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE') THEN
    RAISE EXCEPTION 'MIGRATION_080_ANON_EXECUTE_SURVIVED';
  END IF;
  IF has_function_privilege('authenticated', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE') THEN
    RAISE EXCEPTION 'MIGRATION_080_AUTHENTICATED_EXECUTE_SURVIVED';
  END IF;
  IF has_function_privilege('service_role', 'public.clear_talk_about_marks_when_record_private()', 'EXECUTE') THEN
    RAISE EXCEPTION 'MIGRATION_080_SERVICE_ROLE_EXECUTE_SURVIVED';
  END IF;
END;
$$;

COMMIT;
