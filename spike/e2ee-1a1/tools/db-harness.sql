-- TEST ONLY — a minimal Supabase-compatible shim.
--
-- Reproduces just enough of the platform for migrations 031/032 to be exercised
-- with real SQL semantics: the auth schema, the three roles, `auth.uid()` driven
-- by a session setting, and the pre-existing tables the new migrations
-- reference. It is NOT a substitute for the real project and is never applied
-- anywhere but a throwaway local cluster.

CREATE SCHEMA IF NOT EXISTS auth;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT
);

-- `auth.uid()` reads the JWT claim in Supabase; here it reads a session GUC so a
-- test can switch actors.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::UUID;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- ---- pre-existing tables the new migrations depend on ----

CREATE TABLE IF NOT EXISTS public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anniversary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'gomsin',
  status TEXT NOT NULL DEFAULT 'pending',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (couple_id, user_id)
);
ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_couple_id UUID;
BEGIN
  SELECT couple_id INTO v_couple_id FROM public.couple_members
   WHERE user_id = auth.uid() AND status = 'active' LIMIT 1;
  RETURN v_couple_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  record_time TIME NOT NULL DEFAULT CURRENT_TIME,
  log_text TEXT NOT NULL DEFAULT '',
  reaction TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  emotion_flow JSONB DEFAULT '[]'::jsonb,
  emotion_updated_at TIMESTAMPTZ,
  talk_about BOOLEAN NOT NULL DEFAULT FALSE,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Author can manage own records" ON public.daily_records;
CREATE POLICY "Author can manage own records" ON public.daily_records FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Active partner can read shared records" ON public.daily_records;
CREATE POLICY "Active partner can read shared records" ON public.daily_records FOR SELECT
  USING (is_private = false AND user_id <> auth.uid() AND couple_id = public.get_my_active_couple_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.couples TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.couple_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO authenticated;
