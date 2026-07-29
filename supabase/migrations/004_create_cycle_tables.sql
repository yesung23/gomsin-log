-- =============================================================
-- 1. cycle_settings (곰신 개인 생리주기 설정)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cycle_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  average_cycle_length INTEGER NOT NULL DEFAULT 28 CHECK (average_cycle_length BETWEEN 15 AND 60),
  average_period_length INTEGER NOT NULL DEFAULT 5 CHECK (average_period_length BETWEEN 1 AND 15),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cycle_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage own cycle settings"
  ON public.cycle_settings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================
-- 2. cycle_entries (곰신 개인 생리 시작일 기록)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.cycle_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, start_date)
);

ALTER TABLE public.cycle_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage own cycle entries"
  ON public.cycle_entries FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
