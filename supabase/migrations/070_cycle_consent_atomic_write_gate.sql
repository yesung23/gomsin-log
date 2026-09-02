-- 070_cycle_consent_atomic_write_gate.sql
--
-- Raw cycle and health records require positive, current sensitive-data
-- consent at the database write boundary. The consent row is locked in SHARE
-- mode so a concurrent revoke and write have one deterministic order:
--
--   * a write that owns the lock may finish, then revocation becomes final;
--   * a revoke that owns the lock commits first, then the waiting write fails.
--
-- Existing owner SELECT and DELETE paths stay unchanged so revocation never
-- traps a person's data. Sharing preferences may always move to all-off, while
-- enabling any partner projection requires current consent.

BEGIN;

-- A grant is compare-and-set against the revision most recently observed by
-- that device. A revoke never needs an expected revision: it always advances
-- the row, so an older grant cannot arrive later and erase the stop request.
ALTER TABLE public.user_sensitive_consents
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.user_sensitive_consents'::pg_catalog.regclass
      AND conname = 'user_sensitive_consents_revision_nonnegative'
  ) THEN
    ALTER TABLE public.user_sensitive_consents
      ADD CONSTRAINT user_sensitive_consents_revision_nonnegative
      CHECK (revision >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_sensitive_consent_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- The identity of a tombstone is immutable. Otherwise an authenticated
  -- legacy client could move the row away from `cycle`, recreating revision 0.
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cycle_consent_identity_immutable' USING ERRCODE = '22023';
  END IF;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_sensitive_consent_revision
  ON public.user_sensitive_consents;
CREATE TRIGGER bump_sensitive_consent_revision
  BEFORE UPDATE ON public.user_sensitive_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_sensitive_consent_revision();

REVOKE ALL ON FUNCTION public.bump_sensitive_consent_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_sensitive_consent_revision() FROM anon;
REVOKE ALL ON FUNCTION public.bump_sensitive_consent_revision() FROM authenticated;

-- Replace 022's broad owner FOR ALL policy. Current clients mutate through the
-- two RPCs below. UPDATE remains only as a privacy-preserving compatibility
-- path for an already-installed client that sends `revoked_at = now()`; RLS
-- makes every direct attempt to clear `revoked_at` fail.
DROP POLICY IF EXISTS "Owner can manage own sensitive consents"
  ON public.user_sensitive_consents;
DROP POLICY IF EXISTS "Owner can read own sensitive consents"
  ON public.user_sensitive_consents;
CREATE POLICY "Owner can read own sensitive consents"
  ON public.user_sensitive_consents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner can directly revoke sensitive consent"
  ON public.user_sensitive_consents;
CREATE POLICY "Owner can directly revoke sensitive consent"
  ON public.user_sensitive_consents
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND revoked_at IS NOT NULL
  );

REVOKE ALL ON TABLE public.user_sensitive_consents FROM PUBLIC;
REVOKE ALL ON TABLE public.user_sensitive_consents FROM anon;
REVOKE INSERT, DELETE ON TABLE public.user_sensitive_consents FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.user_sensitive_consents TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_cycle_sensitive_consent(
  p_expected_user_id UUID,
  p_expected_revision BIGINT,
  p_version TEXT
)
RETURNS TABLE (
  applied BOOLEAN,
  granted BOOLEAN,
  revision BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_required_version CONSTANT TEXT := '2026-08-09';
  v_row public.user_sensitive_consents%ROWTYPE;
  v_revision BIGINT;
BEGIN
  IF v_uid IS NULL OR p_expected_user_id IS NULL OR v_uid <> p_expected_user_id THEN
    RAISE EXCEPTION 'cycle_consent_wrong_actor' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'cycle_consent_invalid_revision' USING ERRCODE = '22023';
  END IF;
  IF p_version IS DISTINCT FROM v_required_version THEN
    RAISE EXCEPTION 'cycle_consent_invalid_version' USING ERRCODE = '22023';
  END IF;

  -- Account deletion inserts take ROW EXCLUSIVE on this table. SHARE makes the
  -- two operations linearizable: if grant is first, deletion waits and then
  -- removes it; if deletion is first, this waits and then sees the marker.
  LOCK TABLE public.account_deletion_requests IN SHARE MODE;
  IF public.is_my_account_deletion_pending() THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;

  SELECT consent.*
    INTO v_row
  FROM public.user_sensitive_consents AS consent
  WHERE consent.user_id = v_uid
    AND consent.consent_type = 'cycle'
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.revision <> p_expected_revision THEN
      RETURN QUERY SELECT
        false,
        (v_row.version = v_required_version AND v_row.revoked_at IS NULL),
        v_row.revision;
      RETURN;
    END IF;

    UPDATE public.user_sensitive_consents AS consent
       SET version = v_required_version,
           granted_at = pg_catalog.clock_timestamp(),
           revoked_at = NULL
     WHERE consent.user_id = v_uid
       AND consent.consent_type = 'cycle'
     RETURNING consent.revision INTO v_revision;

    RETURN QUERY SELECT true, true, v_revision;
    RETURN;
  END IF;

  IF p_expected_revision <> 0 THEN
    RETURN QUERY SELECT false, false, 0::BIGINT;
    RETURN;
  END IF;

  INSERT INTO public.user_sensitive_consents (
    user_id,
    consent_type,
    version,
    granted_at,
    revoked_at,
    revision
  ) VALUES (
    v_uid,
    'cycle',
    v_required_version,
    pg_catalog.clock_timestamp(),
    NULL,
    1
  )
  ON CONFLICT (user_id, consent_type) DO NOTHING
  RETURNING user_sensitive_consents.revision INTO v_revision;

  IF FOUND THEN
    RETURN QUERY SELECT true, true, v_revision;
    RETURN;
  END IF;

  -- A concurrent first grant or revoke inserted the row. This request observed
  -- revision 0, so it must not mutate the newer authority.
  SELECT consent.*
    INTO v_row
  FROM public.user_sensitive_consents AS consent
  WHERE consent.user_id = v_uid
    AND consent.consent_type = 'cycle'
  FOR UPDATE;

  RETURN QUERY SELECT
    false,
    COALESCE(v_row.version = v_required_version AND v_row.revoked_at IS NULL, false),
    COALESCE(v_row.revision, 0::BIGINT);
END;
$$;

COMMENT ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT) IS
  'Compare-and-set cycle consent grant. Only the initiating auth.uid() and its last observed revision may advance authority.';

REVOKE ALL ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_cycle_sensitive_consent(
  p_expected_user_id UUID
)
RETURNS TABLE (
  applied BOOLEAN,
  granted BOOLEAN,
  revision BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_required_version CONSTANT TEXT := '2026-08-09';
  v_revision BIGINT;
BEGIN
  IF v_uid IS NULL OR p_expected_user_id IS NULL OR v_uid <> p_expected_user_id THEN
    RAISE EXCEPTION 'cycle_consent_wrong_actor' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_sensitive_consents (
    user_id,
    consent_type,
    version,
    granted_at,
    revoked_at,
    revision
  ) VALUES (
    v_uid,
    'cycle',
    v_required_version,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp(),
    1
  )
  ON CONFLICT (user_id, consent_type) DO UPDATE
     SET revoked_at = pg_catalog.clock_timestamp()
  RETURNING user_sensitive_consents.revision INTO v_revision;

  RETURN QUERY SELECT true, false, v_revision;
END;
$$;

COMMENT ON FUNCTION public.revoke_cycle_sensitive_consent(UUID) IS
  'Privacy-wins cycle consent revoke. Creates a tombstone when absent and monotonically advances every existing row.';

REVOKE ALL ON FUNCTION public.revoke_cycle_sensitive_consent(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_cycle_sensitive_consent(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_cycle_sensitive_consent(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_cycle_sensitive_consent(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_current_cycle_write_consent()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_authorized BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT true
    INTO v_authorized
  FROM public.user_sensitive_consents AS consent
  WHERE consent.user_id = v_uid
    AND consent.consent_type = 'cycle'
    AND consent.version = '2026-08-09'
    AND consent.revoked_at IS NULL
  FOR SHARE;

  RETURN COALESCE(v_authorized, false);
END;
$$;

COMMENT ON FUNCTION public.has_current_cycle_write_consent() IS
  'Returns current raw-cycle write authority for auth.uid() and holds a SHARE lock on the matching consent row through the caller transaction.';

REVOKE ALL ON FUNCTION public.has_current_cycle_write_consent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_current_cycle_write_consent() FROM anon;
REVOKE ALL ON FUNCTION public.has_current_cycle_write_consent() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.has_current_cycle_write_consent() TO authenticated;

ALTER TABLE public.cycle_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_sharing_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Current cycle consent required for period insert"
  ON public.cycle_periods;
CREATE POLICY "Current cycle consent required for period insert"
  ON public.cycle_periods
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for period update"
  ON public.cycle_periods;
CREATE POLICY "Current cycle consent required for period update"
  ON public.cycle_periods
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for daily-log insert"
  ON public.cycle_daily_logs;
CREATE POLICY "Current cycle consent required for daily-log insert"
  ON public.cycle_daily_logs
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for daily-log update"
  ON public.cycle_daily_logs;
CREATE POLICY "Current cycle consent required for daily-log update"
  ON public.cycle_daily_logs
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for settings insert"
  ON public.cycle_settings;
CREATE POLICY "Current cycle consent required for settings insert"
  ON public.cycle_settings
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for settings update"
  ON public.cycle_settings;
CREATE POLICY "Current cycle consent required for settings update"
  ON public.cycle_settings
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for legacy-entry insert"
  ON public.cycle_entries;
CREATE POLICY "Current cycle consent required for legacy-entry insert"
  ON public.cycle_entries
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for legacy-entry update"
  ON public.cycle_entries;
CREATE POLICY "Current cycle consent required for legacy-entry update"
  ON public.cycle_entries
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (public.has_current_cycle_write_consent());

DROP POLICY IF EXISTS "Current cycle consent required for sharing insert"
  ON public.cycle_sharing_preferences;
CREATE POLICY "Current cycle consent required for sharing insert"
  ON public.cycle_sharing_preferences
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      NOT share_current_period
      AND NOT share_prediction_window
      AND NOT share_fertility_window
    )
    OR public.has_current_cycle_write_consent()
  );

DROP POLICY IF EXISTS "Current cycle consent required for sharing update"
  ON public.cycle_sharing_preferences;
CREATE POLICY "Current cycle consent required for sharing update"
  ON public.cycle_sharing_preferences
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    (
      NOT share_current_period
      AND NOT share_prediction_window
      AND NOT share_fertility_window
    )
    OR public.has_current_cycle_write_consent()
  );

-- Keep the exact eight-column partner API from 069. Nullable scalar dates make
-- current-only sharing safe even when no prediction row was assigned.
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
VOLATILE
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
  v_expected_start DATE;
  v_window_start DATE;
  v_window_end DATE;
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

  SELECT (
      consent.version = v_required_consent_version
      AND consent.revoked_at IS NULL
    )
    INTO v_consent_valid
  FROM public.user_sensitive_consents AS consent
  WHERE consent.user_id = v_partner_id
    AND consent.consent_type = 'cycle'
  FOR SHARE;

  v_consent_valid := COALESCE(v_consent_valid, false);

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
    SELECT prediction.expected_start, prediction.window_start, prediction.window_end
      INTO v_expected_start, v_window_start, v_window_end
    FROM public.cycle_prediction_window(v_partner_id) AS prediction;
  END IF;

  IF v_share_fertility AND v_expected_start IS NOT NULL THEN
    v_ovulation := v_expected_start - 14;
  END IF;

  RETURN QUERY SELECT
    v_share_current,
    CASE WHEN v_share_current THEN v_active ELSE false END,
    (v_share_prediction AND v_window_start IS NOT NULL),
    CASE WHEN v_share_prediction THEN v_window_start ELSE NULL END,
    CASE WHEN v_share_prediction THEN v_window_end ELSE NULL END,
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
