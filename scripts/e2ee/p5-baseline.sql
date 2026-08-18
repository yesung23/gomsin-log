-- =============================================================
-- Pre-031 baseline for the P5 daily_records E2EE harness.
-- =============================================================
--
-- NOT a production schema and never applied to one. This differs from
-- `baseline.sql` in one deliberate way: that file declares only the columns
-- 032's trigger *inspects*, with no RLS and no grants, because the rollback
-- harness diffs a schema inventory and does not act as a user.
--
-- P5 asserts authorization, so the actors have to be real. That means this file
-- must carry the ACTUAL `daily_records` shape, the ACTUAL RLS policies and the
-- ACTUAL grants, or every "partner is denied" assertion would be denied by an
-- absent GRANT and would prove nothing. Each block below therefore names the
-- migration it is copied from, and `p5-harness.mjs` re-derives the policy
-- predicates from those migration files and fails if this copy has drifted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT
);

-- Supabase's `auth.uid()`, reading the same claim PostgREST sets.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$;

CREATE TABLE IF NOT EXISTS public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anniversary_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- From 020: `LIMIT 1` over active memberships only. A disconnected member gets
-- NULL here, which is what makes "a former partner cannot write" true.
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

-- ---------------------------------------------------------------------------
-- daily_records — the real shape (001 + 003 + 009 + 019)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  record_time TIME NOT NULL DEFAULT CURRENT_TIME,
  log_text TEXT NOT NULL DEFAULT '',
  reaction TEXT CHECK (reaction IN ('good', 'event', 'hard', 'thought_of_you')),
  attachments JSONB DEFAULT '[]'::jsonb,
  is_private BOOLEAN NOT NULL DEFAULT false,
  emotion_flow JSONB DEFAULT '[]'::jsonb,
  emotion_updated_at TIMESTAMPTZ,
  talk_about BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;

-- Verbatim from 009:137-155. These two policies are the entire row-level
-- authorization model for records, and the harness diffs them against 009.
DROP POLICY IF EXISTS "Author can manage own records" ON public.daily_records;
CREATE POLICY "Author can manage own records"
  ON public.daily_records
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

DROP POLICY IF EXISTS "Active partner can read shared records" ON public.daily_records;
CREATE POLICY "Active partner can read shared records"
  ON public.daily_records
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND user_id <> auth.uid()
    AND is_private = false
  );

-- From 012: `anon` holds nothing, `authenticated` holds table-level DML and RLS
-- decides the rest.
REVOKE ALL ON TABLE public.daily_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_records TO authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_active_couple_id() TO anon, authenticated;
GRANT SELECT ON public.couple_members, public.couples TO authenticated;

-- From 014: metadata-only invalidation channel required by migration 038.
-- The P5 baseline represents the already-applied pre-E2EE schema, so this is a
-- prerequisite rather than part of the forward chain under test.
CREATE TABLE IF NOT EXISTS public.collaboration_invalidations (
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  slice TEXT NOT NULL CHECK (slice IN ('events', 'cycle_support')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (couple_id, slice)
);

ALTER TABLE public.collaboration_invalidations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active members can read collaboration invalidations"
  ON public.collaboration_invalidations FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

REVOKE ALL ON TABLE public.collaboration_invalidations FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.collaboration_invalidations TO authenticated;

CREATE OR REPLACE FUNCTION public.emit_collaboration_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple_id UUID;
BEGIN
  v_couple_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.couple_id ELSE NEW.couple_id END;
  INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
  VALUES (v_couple_id, TG_ARGV[0], clock_timestamp())
  ON CONFLICT (couple_id, slice)
  DO UPDATE SET updated_at = EXCLUDED.updated_at;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_collaboration_invalidation() FROM PUBLIC, anon;
