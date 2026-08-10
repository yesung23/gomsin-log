-- =============================================================
-- 026_projection_requires_consent.sql
-- 동의를 철회하면 파트너 공유도 즉시 멈춘다.
-- =============================================================
--
-- 025 는 공유 토글만 확인했다. 그래서 소유자가 민감정보 동의를 철회한 뒤에도
-- 켜져 있던 토글이 그대로 남아 파트너에게 계속 정보가 전달됐다. 실제로 확인했다:
-- `user_sensitive_consents.revoked_at` 을 채운 뒤에도 파트너 호출이
-- `has_prediction_window = true` 와 예상 날짜를 반환했다.
--
-- 철회는 "더 이상 이 데이터를 이렇게 쓰지 말라"는 뜻이고, 파트너 공유는 그 사용의
-- 일부다. 그러므로 동의가 유효하지 않으면 projection 은 아무것도 공유하지 않는다.
--
-- 클라이언트에서도 철회 시 토글을 끄지만, 그 쓰기가 실패하거나 다른 기기에서
-- 철회한 경우가 있다. 서버가 마지막 판단 주체여야 한다.
--
-- 동의 버전은 검사하지 않는다. 버전이 올라가서 재동의가 필요한 상태는
-- 소유자에게 다시 묻는 문제이고, 그동안 이미 켜 둔 공유를 조용히 끄는 것은
-- 소유자가 의도하지 않은 변화다. 명시적 철회만 공유를 멈춘다.

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
  v_consent_revoked BOOLEAN;
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

  -- 요청자의 단일 active couple. 두 개 이상이면 여기서 예외가 난다.
  v_couple_id := public.get_my_active_couple_id();
  IF v_couple_id IS NULL THEN
    RETURN;
  END IF;

  -- 그 커플의 상대. active 상태여야 한다. 연결이 끊기면 projection 도 사라진다.
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

  -- 동의를 명시적으로 철회했는지 확인한다. 행이 아예 없는 경우는 아래 공유
  -- 설정이 전부 OFF 라서 자연히 아무것도 공유되지 않는다.
  SELECT (revoked_at IS NOT NULL)
    INTO v_consent_revoked
  FROM public.user_sensitive_consents
  WHERE user_id = v_partner_id
    AND consent_type = 'cycle';

  IF COALESCE(v_consent_revoked, false) THEN
    RETURN QUERY SELECT false, false, false, NULL::DATE, NULL::DATE, false, NULL::DATE, NULL::DATE;
    RETURN;
  END IF;

  -- 상대가 켜 둔 공유 설정만 읽는다. 행이 없으면 전부 OFF 로 본다.
  SELECT share_current_period, share_prediction_window, share_fertility_window
    INTO v_share_current, v_share_prediction, v_share_fertility
  FROM public.cycle_sharing_preferences
  WHERE user_id = v_partner_id;

  v_share_current := COALESCE(v_share_current, false);
  v_share_prediction := COALESCE(v_share_prediction, false);
  v_share_fertility := COALESCE(v_share_fertility, false);

  -- 하나도 켜져 있지 않으면 아무 행도 돌려주지 않는다. 클라이언트가
  -- "공유되는 정보 없음" 과 "아직 확인 못함" 을 구분할 수 있어야 하므로
  -- 빈 결과가 아니라 전부 false 인 한 행을 돌려준다.
  IF NOT (v_share_current OR v_share_prediction OR v_share_fertility) THEN
    RETURN QUERY SELECT false, false, false, NULL::DATE, NULL::DATE, false, NULL::DATE, NULL::DATE;
    RETURN;
  END IF;

  IF v_share_current THEN
    -- 진행 중인지 여부만. 시작일은 계산에만 쓰고 반환하지 않는다.
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

  -- 가임 예상은 예상 시작일에서 14일 앞을 배란 추정으로 두고 -5 ~ +1 일.
  -- 달력 계산에 따른 추정이며 피임 수단이 아니다. 이 문구는 UI 가 함께 보여준다.
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
  'Partner-facing sanitized cycle projection. Shares nothing once the owner revokes sensitive consent. Never returns ids, symptoms, flow, pain, mood, notes, or actual period dates.';

REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated;

NOTIFY pgrst, 'reload schema';
