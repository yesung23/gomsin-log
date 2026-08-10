-- =============================================================
-- 022_cycle_v3_schema.sql
-- 곰신로그 생리주기 V3 Schema
-- =============================================================

-- 1. cycle_periods (실제 생리 기간 기록)
CREATE TABLE IF NOT EXISTS public.cycle_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cycle_periods_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
  UNIQUE(user_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_cycle_periods_user_start
  ON public.cycle_periods (user_id, start_date DESC);

ALTER TABLE public.cycle_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle periods" ON public.cycle_periods;
CREATE POLICY "Owner can manage own cycle periods"
  ON public.cycle_periods
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.cycle_periods FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_periods FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_periods TO authenticated;

-- 2. cycle_daily_logs (일별 컨디션/증상/노트)
CREATE TABLE IF NOT EXISTS public.cycle_daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  flow TEXT CHECK (flow IN ('spotting', 'light', 'medium', 'heavy')),
  pain_level TEXT CHECK (pain_level IN ('none', 'mild', 'moderate', 'severe')),
  symptoms TEXT[] NOT NULL DEFAULT '{}',
  mood TEXT CHECK (mood IN ('calm', 'sensitive', 'sad', 'tired', 'good')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_cycle_daily_logs_user_date
  ON public.cycle_daily_logs (user_id, log_date DESC);

ALTER TABLE public.cycle_daily_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle daily logs" ON public.cycle_daily_logs;
CREATE POLICY "Owner can manage own cycle daily logs"
  ON public.cycle_daily_logs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.cycle_daily_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_daily_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_daily_logs TO authenticated;

-- 3. user_sensitive_consents (서버 기반 민감정보 동의 이력)
CREATE TABLE IF NOT EXISTS public.user_sensitive_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL DEFAULT 'cycle',
  version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, consent_type)
);

ALTER TABLE public.user_sensitive_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own sensitive consents" ON public.user_sensitive_consents;
CREATE POLICY "Owner can manage own sensitive consents"
  ON public.user_sensitive_consents
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.user_sensitive_consents FROM PUBLIC;
REVOKE ALL ON TABLE public.user_sensitive_consents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_sensitive_consents TO authenticated;

-- 4. cycle_sharing_preferences (파트너 공유 옵션)
CREATE TABLE IF NOT EXISTS public.cycle_sharing_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  share_current_period BOOLEAN NOT NULL DEFAULT false,
  share_prediction_window BOOLEAN NOT NULL DEFAULT false,
  share_fertility_window BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cycle_sharing_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle sharing preferences" ON public.cycle_sharing_preferences;
CREATE POLICY "Owner can manage own cycle sharing preferences"
  ON public.cycle_sharing_preferences
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.cycle_sharing_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_sharing_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_sharing_preferences TO authenticated;

-- 5. Safe Idempotent Data Migration from legacy cycle_entries
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cycle_entries') THEN
    -- Migrate periods
    INSERT INTO public.cycle_periods (user_id, start_date, end_date, created_at, updated_at)
    SELECT user_id, start_date, end_date, created_at, updated_at
    FROM public.cycle_entries
    ON CONFLICT (user_id, start_date) DO UPDATE
    SET end_date = EXCLUDED.end_date, updated_at = EXCLUDED.updated_at;

    -- Migrate symptoms & notes into daily logs for the start_date
    INSERT INTO public.cycle_daily_logs (user_id, log_date, symptoms, note, created_at, updated_at)
    SELECT user_id, start_date, symptoms, notes, created_at, updated_at
    FROM public.cycle_entries
    WHERE (symptoms IS NOT NULL AND array_length(symptoms, 1) > 0) OR (notes IS NOT NULL AND notes <> '')
    ON CONFLICT (user_id, log_date) DO UPDATE
    SET symptoms = EXCLUDED.symptoms, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at;
  END IF;
END $$;
