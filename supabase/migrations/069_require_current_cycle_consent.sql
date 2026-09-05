-- 069_require_current_cycle_consent.sql
--
-- A partner projection is derived from highly sensitive health data. Migration
-- 026 stopped it after explicit revocation, but treated a missing consent row or
-- an obsolete consent version as permission whenever old sharing toggles were
-- still enabled. Require positive, current consent before reading preferences
-- or any health-derived value.
--
-- The eight-column API, raw-table RLS, helper privileges and stored data are
-- unchanged. Invalid consent returns the existing all-false/null compatibility
-- row, so older clients simply render no partner card.

BEGIN;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_partner_id UUID;
  v_required_consent_version CONSTANT TEXT := '2026-08-09';
  v_consent_valid BOOLEAN := false;
  v_share_current BOOLEAN := false;
  v_share_prediction BOOLEAN := false;
  v_share_fertility BOOLEAN := false;
  v_today DATE := ((now() AT TIME ZONE 'Asia/Seoul')::DATE);
  v_active BOOLEAN := false;
  v_window RECORD;
  v_ovulation DATE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_couple_id := public.get_my_active_couple_id();
  IF v_couple_id IS NULL THEN
    RETURN;
  END IF;

  SELECT other.user_id
    INTO v_partner_id
  FROM public.couple_members AS other
  WHERE other.couple_id = v_couple_id
    AND other.user_id <> v_uid
    AND other.status = 'active'
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  -- Consent is positive authority: no row, a superseded disclosure, or a
  -- revoked row all mean "do not derive or share". This check deliberately
  -- precedes both preferences and raw health reads.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_sensitive_consents
    WHERE user_id = v_partner_id
      AND consent_type = 'cycle'
      AND version = v_required_consent_version
      AND revoked_at IS NULL
  ) INTO v_consent_valid;

  IF NOT v_consent_valid THEN
    RETURN QUERY SELECT false, false, false, NULL::DATE, NULL::DATE, false, NULL::DATE, NULL::DATE;
    RETURN;
  END IF;

  SELECT share_current_period, share_prediction_window, share_fertility_window
    INTO v_share_current, v_share_prediction, v_share_fertility
  FROM public.cycle_sharing_preferences
  WHERE user_id = v_partner_id;

  v_share_current := COALESCE(v_share_current, false);
  v_share_prediction := COALESCE(v_share_prediction, false);
  v_share_fertility := COALESCE(v_share_fertility, false);

  IF NOT (v_share_current OR v_share_prediction OR v_share_fertility) THEN
    RETURN QUERY SELECT false, false, false, NULL::DATE, NULL::DATE, false, NULL::DATE, NULL::DATE;
    RETURN;
  END IF;

  IF v_share_current THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.cycle_periods
      WHERE user_id = v_partner_id
        AND start_date <= v_today
        AND (end_date IS NULL OR end_date >= v_today)
    ) INTO v_active;
  END IF;

  IF v_share_prediction OR v_share_fertility THEN
    SELECT * INTO v_window FROM public.cycle_prediction_window(v_partner_id);
  END IF;

  IF v_share_fertility AND v_window.expected_start IS NOT NULL THEN
    v_ovulation := v_window.expected_start - 14;
  END IF;

  RETURN QUERY SELECT
    v_share_current,
    CASE WHEN v_share_current THEN v_active ELSE false END,
    (v_share_prediction AND v_window.window_start IS NOT NULL),
    CASE WHEN v_share_prediction THEN v_window.window_start ELSE NULL END,
    CASE WHEN v_share_prediction THEN v_window.window_end ELSE NULL END,
    (v_share_fertility AND v_ovulation IS NOT NULL),
    CASE WHEN v_share_fertility THEN v_ovulation - 5 ELSE NULL END,
    CASE WHEN v_share_fertility THEN v_ovulation + 1 ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION public.get_partner_cycle_projection() IS
  'Partner-facing sanitized cycle projection. Requires current, non-revoked owner consent and explicit sharing toggles. Never returns ids, symptoms, flow, pain, mood, notes, or actual period dates.';

REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
