-- 081_retire_apple_iap_v1_entrypoints.sql
--
-- Contract phase after V2 Edge deploy/canary proof. Keep both functions for
-- owner/internal projection use; retire only their external service-role path.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.iap_apply_verified_transaction(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, UUID, UUID
) FROM service_role;

REVOKE EXECUTE ON FUNCTION public.iap_process_verified_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT,
  BIGINT, BIGINT, TEXT, TEXT
) FROM service_role;

COMMIT;
