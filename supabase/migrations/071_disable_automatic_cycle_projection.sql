-- 071_disable_automatic_cycle_projection.sql
--
-- Privacy correction: a value derived from private cycle records is still
-- health information. The current consent and privacy notice authorize owner-
-- only tracking plus a separately chosen, short-lived care signal; they do not
-- authorize automatic partner projection of period status, predicted dates or
-- fertility guesses.
--
-- This migration preserves every raw cycle/health row. It only closes the three
-- legacy projection toggles, keeps the old eight-column RPC shape fail-closed for
-- installed clients, and removes the now-unused owner-id prediction helper.
-- Remote application is a separate, explicitly verified release action.

BEGIN;

-- Add the invariant without scanning first, close every legacy opt-in, then
-- validate. A failed or interrupted deployment can therefore never validate a
-- partially backfilled table as safe.
ALTER TABLE public.cycle_sharing_preferences
  ADD CONSTRAINT cycle_sharing_preferences_automatic_projection_disabled
  CHECK (
    NOT share_current_period
    AND NOT share_prediction_window
    AND NOT share_fertility_window
  ) NOT VALID;

UPDATE public.cycle_sharing_preferences
SET share_current_period = false,
    share_prediction_window = false,
    share_fertility_window = false,
    updated_at = now()
WHERE share_current_period
   OR share_prediction_window
   OR share_fertility_window;

ALTER TABLE public.cycle_sharing_preferences
  VALIDATE CONSTRAINT cycle_sharing_preferences_automatic_projection_disabled;

-- 070 allowed an all-false write without current health consent so a revoke
-- could clean up stale preferences. Preserve that privacy-friendly path, but no
-- authenticated client (including an old one) may turn any projection back on.
DROP POLICY IF EXISTS "Current cycle consent required for sharing insert"
  ON public.cycle_sharing_preferences;
CREATE POLICY "Automatic cycle projection remains disabled on insert"
  ON public.cycle_sharing_preferences
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT share_current_period
    AND NOT share_prediction_window
    AND NOT share_fertility_window
  );

DROP POLICY IF EXISTS "Current cycle consent required for sharing update"
  ON public.cycle_sharing_preferences;
CREATE POLICY "Automatic cycle projection remains disabled on update"
  ON public.cycle_sharing_preferences
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    NOT share_current_period
    AND NOT share_prediction_window
    AND NOT share_fertility_window
  );

-- Keep the legacy return signature so an installed client receives a clean
-- all-false answer rather than a schema/parsing failure. The function reads no
-- relation and derives no health value, so invoker rights are sufficient.
CREATE OR REPLACE FUNCTION public.get_partner_cycle_projection()
RETURNS TABLE (
  has_current_period_status BOOLEAN,
  current_period_active BOOLEAN,
  has_prediction_window BOOLEAN,
  prediction_window_start DATE,
  prediction_window_end DATE,
  has_fertility_window BOOLEAN,
  fertility_window_start DATE,
  fertility_window_end DATE
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    false,
    false,
    false,
    NULL::DATE,
    NULL::DATE,
    false,
    NULL::DATE,
    NULL::DATE;
$$;

COMMENT ON FUNCTION public.get_partner_cycle_projection() IS
  'Compatibility-only fail-closed projection. Automatic cycle/health sharing is disabled; returns only false/null values.';

REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated;

-- This helper accepted an arbitrary owner UUID and existed solely for the old
-- partner projection. It is no longer part of an active call path.
REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM authenticated;
DROP FUNCTION public.cycle_prediction_window(UUID);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- DOWN / rollback policy:
-- Do not restore automatic health projection merely to roll back the app. A
-- future re-enable requires a separate partner-provision consent, a new consent
-- version and legal review. Operational rollback keeps this migration applied
-- and deploys a client that also treats every projection as empty.
