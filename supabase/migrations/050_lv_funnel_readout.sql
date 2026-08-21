-- 050: Make the LV funnel actually readable, without making it surveillance.
--
-- Migration 049 built the measurement pipe. Checking it against the LV read-out
-- list in PRODUCT_STRATEGY_REDESIGN §8 Phase 2 found two gaps, and this closes
-- both.
--
-- GAP 1 — the unit of measurement was missing.
--
--   The strategy is explicit that the unit of acquisition is "a connected couple",
--   not a download. Two of its measures are couple-scoped: 주간 기록 커플 비율 and
--   4주 커플 재사용률. `product_events` had only `user_id`, so neither could be
--   computed at all -- two people in one couple were indistinguishable from two
--   unrelated accounts.
--
--   `couple_id` is added with a DEFAULT of `get_my_active_couple_id()`, so it is
--   derived from the session exactly as `user_id` is. A client cannot send one,
--   and therefore cannot attribute its events to a couple it does not belong to.
--   Nullable on purpose: an event emitted before a couple exists is still a real
--   event, and a NOT NULL here would silently drop the pre-connection funnel.
--
--   This does NOT create a partner axis. RLS still scopes every row to the
--   account that wrote it, the partner still has no read policy, and the only
--   thing that can group by couple is the aggregate below, which returns numbers.
--
-- GAP 2 — reading it meant reading rows.
--
--   Without a function, a read-out means `service_role` selecting raw event rows:
--   one person's individual actions, in order. That is the shape §19 forbids
--   becoming possible, arriving through the back door of "we need the numbers".
--
--   `lv_funnel_readout` returns AGGREGATES ONLY -- a metric name and a number.
--   There is no row-returning path, no user id in the output, and no way to ask
--   it about one person.
--
-- What is still absent, deliberately: no per-day series (a series of daily counts
-- for a five-couple cohort is a behavioural timeline), no per-user breakdown, no
-- ordering of one couple against another, and nothing about health, emotion,
-- content, or time of day.

BEGIN;

-- =============================================================
-- 1. The couple axis
-- =============================================================

ALTER TABLE public.product_events
  ADD COLUMN couple_id UUID;

-- Derived from the session, never from the payload -- the same rule `user_id`
-- already follows. `get_my_active_couple_id()` is the SECURITY DEFINER helper
-- migration 001 introduced for exactly this kind of lookup.
ALTER TABLE public.product_events
  ALTER COLUMN couple_id SET DEFAULT public.get_my_active_couple_id();

CREATE INDEX idx_product_events_couple_day
  ON public.product_events (couple_id, occurred_on)
  WHERE couple_id IS NOT NULL;

-- =============================================================
-- 2. The read-out
-- =============================================================
--
-- One row per metric. The caller gets counts and ratios; it cannot get a person.
--
-- Bounded by an explicit date range so a read-out is a deliberate question about
-- a period rather than a standing export of everything.

CREATE OR REPLACE FUNCTION public.lv_funnel_readout(p_from DATE, p_to DATE)
RETURNS TABLE (metric TEXT, value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- The grant is not the only gate (migration 029's shape). A mis-issued GRANT
  -- must not by itself turn this into an export anyone can run.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Invalid read-out range' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT * FROM public.product_events
    WHERE occurred_on BETWEEN p_from AND p_to
  )
  -- Activation.
  SELECT 'couples_connected'::TEXT,
         COUNT(DISTINCT couple_id)::NUMERIC
    FROM scoped WHERE kind = 'couple_connected'

  UNION ALL
  -- Whether the relationship, not the account, is writing.
  SELECT 'couples_writing',
         COUNT(DISTINCT couple_id)::NUMERIC
    FROM scoped WHERE kind = 'record_composed' AND couple_id IS NOT NULL

  UNION ALL
  SELECT 'records_composed', COUNT(*)::NUMERIC FROM scoped WHERE kind = 'record_composed'

  UNION ALL
  -- The 30-second target, as a proportion rather than an average: one person
  -- writing an essay should not move the number for everyone else.
  SELECT 'compose_within_30s_ratio',
         CASE WHEN COUNT(*) FILTER (WHERE duration_ms IS NOT NULL) = 0 THEN 0
              ELSE ROUND(
                COUNT(*) FILTER (WHERE duration_ms <= 30000)::NUMERIC
                / COUNT(*) FILTER (WHERE duration_ms IS NOT NULL), 4)
         END
    FROM scoped WHERE kind = 'record_composed'

  UNION ALL
  -- The loop's middle, as a rate. The denominator is why `briefing_opened` exists.
  SELECT 'briefings_opened', COUNT(*)::NUMERIC FROM scoped WHERE kind = 'briefing_opened'

  UNION ALL
  SELECT 'briefing_to_original_ratio',
         CASE WHEN (SELECT COUNT(*) FROM scoped WHERE kind = 'briefing_opened') = 0 THEN 0
              ELSE ROUND(
                (SELECT COUNT(*) FROM scoped WHERE kind = 'briefing_to_original')::NUMERIC
                / (SELECT COUNT(*) FROM scoped WHERE kind = 'briefing_opened'), 4)
         END

  UNION ALL
  -- Conversation intent, and whether it completed.
  SELECT 'talk_about_marked', COUNT(*)::NUMERIC FROM scoped WHERE kind = 'talk_about_marked'
  UNION ALL
  SELECT 'talk_about_resolved', COUNT(*)::NUMERIC FROM scoped WHERE kind = 'talk_about_resolved'
  UNION ALL
  SELECT 'call_mode_opened', COUNT(*)::NUMERIC FROM scoped WHERE kind = 'call_mode_opened'

  UNION ALL
  -- The kill metric. If this rises, the design failed and no other number says so.
  SELECT 'accounts_disabling_notifications',
         COUNT(DISTINCT user_id)::NUMERIC
    FROM scoped WHERE kind = 'notifications_disabled';
END;
$$;

-- =============================================================
-- 3. Retention, as a count rather than a cohort table
-- =============================================================
--
-- 4주 커플 재사용률 needs two windows compared. Returning the couple ids that
-- appear in both would be a list of who came back, so this returns how many did.

CREATE OR REPLACE FUNCTION public.lv_couple_return_count(
  p_first_from DATE, p_first_to DATE,
  p_later_from DATE, p_later_to DATE
)
RETURNS TABLE (metric TEXT, value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_first_to < p_first_from OR p_later_to < p_later_from THEN
    RAISE EXCEPTION 'Invalid read-out range' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH first_window AS (
    SELECT DISTINCT couple_id FROM public.product_events
    WHERE couple_id IS NOT NULL AND occurred_on BETWEEN p_first_from AND p_first_to
  ), later_window AS (
    SELECT DISTINCT couple_id FROM public.product_events
    WHERE couple_id IS NOT NULL AND occurred_on BETWEEN p_later_from AND p_later_to
  )
  SELECT 'couples_active_first'::TEXT, (SELECT COUNT(*) FROM first_window)::NUMERIC
  UNION ALL
  SELECT 'couples_returned',
         (SELECT COUNT(*) FROM first_window f
           WHERE EXISTS (SELECT 1 FROM later_window l WHERE l.couple_id = f.couple_id))::NUMERIC;
END;
$$;

-- =============================================================
-- 4. Permissions
-- =============================================================

REVOKE ALL ON FUNCTION public.lv_funnel_readout(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_funnel_readout(DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.lv_funnel_readout(DATE, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_funnel_readout(DATE, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
