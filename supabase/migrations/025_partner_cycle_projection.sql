-- =============================================================
-- 025_partner_cycle_projection.sql
-- 파트너가 볼 수 있는 최소한의 주기 정보만 계산해서 돌려주는 RPC.
-- =============================================================
--
-- 왜 필요한가.
--
-- 022 가 `cycle_sharing_preferences` 를 만들었고 앱에는 공유 토글 3개가 있다.
-- 그런데 토글을 켜도 파트너가 그 정보를 볼 경로가 존재하지 않았다. 원본 테이블
-- (`cycle_periods`, `cycle_daily_logs`) 은 소유자 전용 RLS 라서 파트너가 읽을 수
-- 없고, 그것은 옳다. 하지만 그 사이를 잇는 sanitized projection 이 없어서
-- "공유 중"이라는 약속이 실제로는 아무것도 전달하지 않았다.
--
-- 이 함수가 그 사이를 잇는다. 파트너는 여전히 원본 테이블을 읽지 못하고,
-- 이 함수가 계산한 불리언과 날짜 범위만 받는다.
--
-- 절대 반환하지 않는 것:
--   period id, daily log id, 증상, 출혈량, 통증, 기분, 메모,
--   생리 시작일, 생리 종료일, 평균 주기 설정값
--
-- 반환하는 것:
--   지금 생리 중인지 여부 (share_current_period 가 ON 일 때만)
--   다음 예상 범위의 시작·종료일 (share_prediction_window 가 ON 일 때만)
--   가임 예상 범위의 시작·종료일 (share_fertility_window 가 ON 일 때만)
--
-- SECURITY DEFINER 이므로 이 저장소의 규칙을 그대로 따른다:
-- search_path 고정, auth.uid() 검증, active couple 검증, authenticated 만 EXECUTE.

-- -------------------------------------------------------------
-- 1. 예상 범위 계산 (서버 측)
-- -------------------------------------------------------------
-- `src/lib/cyclePrediction.ts` 의 `predictCycle()` 과 같은 규칙을 쓴다. 두
-- 구현이 어긋나면 소유자와 파트너가 서로 다른 날짜를 보게 되므로,
-- `src/lib/partnerCycleProjection.test.ts` 가 두 규칙의 일치를 고정한다.
--
--   - 유효한 시작일이 0개  → 아무것도 반환하지 않음
--   - 1~2개              → 설정 주기 기반, 폭은 ±2일 고정
--   - 3개 이상           → 최근 12개 간격의 중앙값, 폭은 min(변동폭, 3)일
--   - 15~60일 밖의 간격은 이상치로 제외
--
-- 소유자 본인의 데이터만 읽으므로 owner_id 를 인자로 받는다. 이 함수는
-- 파트너에게 직접 노출하지 않는다 (아래에서 EXECUTE 를 회수한다).
CREATE OR REPLACE FUNCTION public.cycle_prediction_window(p_owner_id UUID)
RETURNS TABLE (window_start DATE, window_end DATE, expected_start DATE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_starts DATE[];
  v_start_count INTEGER;
  v_intervals INTEGER[];
  v_interval_count INTEGER;
  v_median INTEGER;
  v_variability INTEGER;
  v_buffer INTEGER;
  v_cycle_length INTEGER;
  v_latest DATE;
  v_expected DATE;
BEGIN
  IF p_owner_id IS NULL THEN
    RETURN;
  END IF;

  -- 설정된 평균 주기. 없으면 28일.
  SELECT COALESCE(average_cycle_length, 28)
    INTO v_cycle_length
  FROM public.cycle_settings
  WHERE user_id = p_owner_id;
  v_cycle_length := COALESCE(v_cycle_length, 28);
  -- 설정값이 비현실적이면 기본값으로 되돌린다.
  IF v_cycle_length < 15 OR v_cycle_length > 60 THEN
    v_cycle_length := 28;
  END IF;

  -- 중복 제거한 시작일을 오름차순으로. 최근 13개면 최대 12개 간격이 나온다.
  SELECT array_agg(start_date ORDER BY start_date)
    INTO v_starts
  FROM (
    SELECT DISTINCT start_date
    FROM public.cycle_periods
    WHERE user_id = p_owner_id
    ORDER BY start_date DESC
    LIMIT 13
  ) AS recent;

  v_start_count := COALESCE(array_length(v_starts, 1), 0);

  -- 기록이 전혀 없으면 예상할 근거가 없다.
  IF v_start_count = 0 THEN
    RETURN;
  END IF;

  v_latest := v_starts[v_start_count];

  IF v_start_count < 3 THEN
    -- 기록이 1~2개다. 설정값으로 추정하고, 시작일 불확실성은 ±2일로 고정한다.
    -- 생리 지속 기간(average_period_length)은 시작일 예측의 불확실성과 별개의
    -- 값이므로 이 폭에 쓰지 않는다.
    v_expected := v_latest + v_cycle_length;
    RETURN QUERY SELECT v_expected - 2, v_expected + 2, v_expected;
    RETURN;
  END IF;

  -- 실제 간격. 생리적으로 불가능한 간격은 이상치로 제외한다.
  SELECT array_agg(gap)
    INTO v_intervals
  FROM (
    SELECT (v_starts[i + 1] - v_starts[i]) AS gap
    FROM generate_subscripts(v_starts, 1) AS i
    WHERE i < v_start_count
  ) AS gaps
  WHERE gap BETWEEN 15 AND 60;

  v_interval_count := COALESCE(array_length(v_intervals, 1), 0);

  IF v_interval_count = 0 THEN
    v_expected := v_latest + v_cycle_length;
    RETURN QUERY SELECT v_expected - 2, v_expected + 2, v_expected;
    RETURN;
  END IF;

  -- 중앙값. 짝수 개면 가운데 두 값의 평균을 반올림한다 (클라이언트와 동일).
  SELECT CASE
           WHEN v_interval_count % 2 = 1
             THEN sorted[(v_interval_count + 1) / 2]
           ELSE round(
                  (sorted[v_interval_count / 2]
                   + sorted[v_interval_count / 2 + 1])::NUMERIC / 2
                )::INTEGER
         END,
         GREATEST(1, round((sorted[v_interval_count] - sorted[1])::NUMERIC / 2)::INTEGER)
    INTO v_median, v_variability
  FROM (
    SELECT array_agg(gap ORDER BY gap) AS sorted
    FROM unnest(v_intervals) AS gap
  ) AS ordered;

  v_buffer := LEAST(v_variability, 3);
  v_expected := v_latest + v_median;
  RETURN QUERY SELECT v_expected - v_buffer, v_expected + v_buffer, v_expected;
END;
$$;

COMMENT ON FUNCTION public.cycle_prediction_window(UUID) IS
  'Internal helper: server-side next-period window for one owner. Not partner-facing.';

REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM authenticated;

-- -------------------------------------------------------------
-- 2. 파트너용 projection
-- -------------------------------------------------------------
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
  'Partner-facing sanitized cycle projection. Returns only booleans and date ranges the owner explicitly shared. Never returns ids, symptoms, flow, pain, mood, notes, or actual period dates.';

REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated;

NOTIFY pgrst, 'reload schema';
