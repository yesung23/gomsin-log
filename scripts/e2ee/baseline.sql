-- =============================================================
-- Minimal pre-031 baseline for the rollback harness.
-- =============================================================
--
-- NOT a production schema and never applied to one. This is the smallest set of
-- objects that migrations 031, 032 and 034 actually reference, so a throwaway
-- cluster can apply them and then be diffed against this starting point.
--
-- Reproducing all of 001..030 here would test those migrations, not the
-- rollback, and would drift from them the moment either side changed. The
-- references are enumerated instead:
--
--   031 -> auth.users, auth.uid(), public.couples, public.couple_members,
--          public.get_my_active_couple_id(), roles anon/authenticated/service_role
--   032 -> public.daily_records (user_id, couple_id, log_text, reaction,
--          attachments, emotion_flow, record_time, is_private)
--   034 -> public.recovery_challenges, public.recovery_identities, public.devices
--          (all created by 031)
--
-- If a future migration reaches for something else, the harness fails on the
-- missing object rather than passing over a silently narrower test.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase supplies these roles. `NOLOGIN` is enough for GRANT/REVOKE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- GoTrue reads the JWT claim. The harness only needs the signature and a stable
-- return type, so NULL is the honest stand-in for "no authenticated caller".
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

CREATE TABLE IF NOT EXISTS public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anniversary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.get_my_active_couple_id()
RETURNS UUID
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cm.couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = auth.uid() AND cm.status = 'active'
  LIMIT 1;
$$;

-- Only the columns 032's write-floor trigger inspects.
CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID REFERENCES public.couples(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  record_time TIME NOT NULL DEFAULT '00:00:00',
  is_private BOOLEAN NOT NULL DEFAULT false,
  log_text TEXT,
  reaction TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  emotion_flow JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
