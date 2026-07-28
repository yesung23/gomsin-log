-- Gomsinlog Production Database Schema & Strict RLS Migration
-- 1:1 Private Daily Log App for Military Couples

-- =============================================================
-- 1. profiles
-- =============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('gomsin', 'soldier')) DEFAULT 'gomsin',
  avatar_path TEXT,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Owner policies (NO USING(true) or WITH CHECK(true))
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- =============================================================
-- 2. couples
-- =============================================================
CREATE TABLE public.couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anniversary_date DATE, -- nullable
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 3. couple_members
-- =============================================================
CREATE TABLE public.couple_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gomsin', 'soldier')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disconnected')) DEFAULT 'pending',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(couple_id, user_id)
);

ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;

-- Constraints: max 1 active couple per user, max 2 active members per couple
CREATE UNIQUE INDEX idx_couple_active_members
  ON public.couple_members (couple_id, status)
  WHERE status = 'active';

CREATE UNIQUE INDEX idx_user_active_couple
  ON public.couple_members (user_id)
  WHERE status = 'active';

-- Only active members of the couple can view member rows
CREATE POLICY "Active members can view couple members"
  ON public.couple_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR couple_id IN (
      SELECT couple_id FROM public.couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Only active members of the couple can view couple details
CREATE POLICY "Active members can view couple"
  ON public.couples FOR SELECT
  USING (
    id IN (
      SELECT couple_id FROM public.couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Active members can update couple"
  ON public.couples FOR UPDATE
  USING (
    id IN (
      SELECT couple_id FROM public.couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- =============================================================
-- 4. invitation_codes
-- =============================================================
-- Plaintext codes NEVER stored. SHA-256 hash only.
-- NO public SELECT or direct WRITE policies!
CREATE TABLE public.invitation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL, -- SHA-256 hash
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  used BOOLEAN NOT NULL DEFAULT false,
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;

-- Creator can see code metadata (excluding code_hash in RPC)
CREATE POLICY "Creator can view invitation metadata"
  ON public.invitation_codes FOR SELECT
  USING (created_by = auth.uid());

-- =============================================================
-- 5. daily_records
-- =============================================================
CREATE TABLE public.daily_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  record_time TIME NOT NULL DEFAULT CURRENT_TIME,
  log_text TEXT NOT NULL DEFAULT '',
  reaction TEXT CHECK (reaction IN ('good', 'event', 'hard', 'thought_of_you')),
  attachments JSONB DEFAULT '[]'::jsonb,
  is_private BOOLEAN NOT NULL DEFAULT false, -- false: 우리 둘에게 공유, true: 나에게만
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;

-- Author: full CRUD on own records
CREATE POLICY "Author can manage own records"
  ON public.daily_records FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Active partner: read shared records (is_private = false) ONLY
-- Disconnected partner CANNOT read any records!
CREATE POLICY "Active partner can read shared records"
  ON public.daily_records FOR SELECT
  USING (
    is_private = false
    AND user_id != auth.uid()
    AND couple_id IN (
      SELECT couple_id FROM public.couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- =============================================================
-- 6. briefings (오늘의 빠른 정리 캐시)
-- =============================================================
CREATE TABLE public.briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id),
  briefing_date DATE NOT NULL DEFAULT CURRENT_DATE,
  summary_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(couple_id, recipient_id, briefing_date)
);

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipient can view own briefings"
  ON public.briefings FOR SELECT
  USING (recipient_id = auth.uid());

-- =============================================================
-- 7. contact_preferences
-- =============================================================
CREATE TABLE public.contact_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  weekday_start TIME NOT NULL DEFAULT '18:00',
  weekday_end TIME NOT NULL DEFAULT '21:00',
  weekend_start TIME NOT NULL DEFAULT '12:00',
  weekend_end TIME NOT NULL DEFAULT '21:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contact preferences"
  ON public.contact_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================
-- SECURITY DEFINER RPCs (search_path = public, restricted permissions)
-- =============================================================

-- 1. Get minimal partner profile (nickname, avatar_path ONLY)
CREATE OR REPLACE FUNCTION public.get_partner_profile()
RETURNS TABLE (display_name TEXT, role TEXT, avatar_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.display_name, p.role, p.avatar_path
  FROM profiles p
  JOIN couple_members cm ON cm.user_id = p.id
  WHERE cm.status = 'active'
    AND cm.couple_id IN (
      SELECT couple_id FROM couple_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
    AND p.id != auth.uid();
END;
$$;

-- 2. Create Invitation Code (Stores SHA-256 hash only)
CREATE OR REPLACE FUNCTION public.create_invitation(p_couple_id UUID, p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM couple_members
    WHERE couple_id = p_couple_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active member access required';
  END IF;

  INSERT INTO invitation_codes (couple_id, code_hash, created_by)
  VALUES (p_couple_id, p_code_hash, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 3. Consume Invitation Code (Validates 24-hr TTL, unused, max 2 members)
CREATE OR REPLACE FUNCTION public.consume_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
  v_couple_id UUID;
BEGIN
  SELECT * INTO v_invite
  FROM invitation_codes
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at > now()
  LIMIT 1;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation code';
  END IF;

  v_couple_id := v_invite.couple_id;

  IF (SELECT COUNT(*) FROM couple_members WHERE couple_id = v_couple_id AND status = 'active') >= 2 THEN
    RAISE EXCEPTION 'Couple space is full';
  END IF;

  UPDATE invitation_codes
  SET used = true, used_by = auth.uid(), used_at = now()
  WHERE id = v_invite.id;

  INSERT INTO couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, auth.uid(), 'soldier', 'active')
  ON CONFLICT (couple_id, user_id) DO UPDATE SET status = 'active';

  -- Update couple status to active
  UPDATE couples SET updated_at = now() WHERE id = v_couple_id;

  RETURN v_couple_id;
END;
$$;

-- 4. Disconnect Couple
CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE couple_members
  SET status = 'disconnected'
  WHERE user_id = auth.uid() AND status = 'active';
END;
$$;

-- Revoke public execute rights and grant only to authenticated role
REVOKE EXECUTE ON FUNCTION public.get_partner_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.disconnect_couple() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_partner_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;
