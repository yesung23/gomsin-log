-- 075_relationship_context_and_optional_gender.sql
--
-- A relationship's product context is generation metadata, not a membership
-- role. Existing and missing generations remain military; the new general path
-- keeps the same internal gomsin/soldier authorization slots. Optional gender
-- is private profile metadata and is not consulted by authorization or product
-- eligibility.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Immutable relationship context and optional owner-only profile metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS relationship_context TEXT;

UPDATE public.couples
SET relationship_context = 'military'
WHERE relationship_context IS NULL;

ALTER TABLE public.couples
  ALTER COLUMN relationship_context SET DEFAULT 'military',
  ALTER COLUMN relationship_context SET NOT NULL,
  ADD CONSTRAINT couples_relationship_context_check
    CHECK (relationship_context IN ('military', 'general'));

COMMENT ON COLUMN public.couples.relationship_context IS
  'Immutable relationship-generation context: military or general. Membership roles remain authorization slots.';

CREATE OR REPLACE FUNCTION public.enforce_relationship_context_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.relationship_context IS DISTINCT FROM OLD.relationship_context THEN
    RAISE EXCEPTION 'relationship_context_is_immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_relationship_context_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_relationship_context_immutable ON public.couples;
CREATE TRIGGER enforce_relationship_context_immutable
  BEFORE UPDATE OF relationship_context ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.enforce_relationship_context_immutable();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender_identity TEXT;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_gender_identity_check
    CHECK (gender_identity IS NULL OR gender_identity IN ('woman', 'man'));

COMMENT ON COLUMN public.profiles.gender_identity IS
  'Optional owner-only profile metadata. Never an authorization, health, AI, pricing, or membership input.';

-- ---------------------------------------------------------------------------
-- 2. General relationship creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_couple_and_invitation_v2(
  p_role TEXT,
  p_code_hash TEXT,
  p_relationship_context TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_role IS DISTINCT FROM 'gomsin' THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF p_relationship_context IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION 'Invalid relationship context';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  -- Match 074's participant namespace before observing deletion or membership.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15013));

  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Account deletion pending' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    WHERE member.user_id = v_uid
      AND member.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'User already in an open couple';
  END IF;

  UPDATE public.invitation_codes
  SET used = true, used_at = CURRENT_TIMESTAMP
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at <= CURRENT_TIMESTAMP;

  INSERT INTO public.couples (relationship_context)
  VALUES ('general')
  RETURNING id INTO v_couple_id;

  -- Reuse 074's complete advisory/deletion/parent boundary. A legacy direct
  -- marker inserted after the first check aborts and rolls back this generation.
  PERFORM public.lock_relationship_mutation_boundary(
    v_couple_id,
    ARRAY[v_uid]::UUID[]
  );

  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, 'gomsin', 'active');

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_couple_and_invitation_v2(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation_v2(TEXT, TEXT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Context-bound invitation redemption
-- ---------------------------------------------------------------------------

-- Keep the legacy signature and response shape, but only military generations
-- may pass its post-lock revalidation. A general code remains indistinguishable
-- from a missing, expired, closed, or already-used code.
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_code_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_invite RECORD;
  v_relationship public.couples%ROWTYPE;
  v_member_count INTEGER;
  v_active_count INTEGER;
  v_inviter_user_id UUID;
  v_inviter_role TEXT;
  v_invitee_role TEXT;
  v_recent_failures INTEGER;
  v_daily_failures INTEGER;
  v_error_code TEXT;
  v_boundary_message TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'couple_id', NULL,
      'error_code', 'not_authenticated'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15014));

  BEGIN
    SELECT
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      ),
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
      )
    INTO v_recent_failures, v_daily_failures
    FROM public.invitation_attempts
    WHERE user_id = v_uid
      AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours';

    IF v_recent_failures >= 5 OR v_daily_failures >= 20 THEN
      v_error_code := 'rate_limited';
    ELSIF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
      v_error_code := 'invalid_request';
    ELSIF EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS deletion
      WHERE deletion.user_id = v_uid
    ) THEN
      v_error_code := 'invalid_request';
    ELSIF EXISTS (
      SELECT 1
      FROM public.couple_members AS member
      WHERE member.user_id = v_uid
        AND member.status IN ('active', 'pending')
    ) THEN
      v_error_code := 'already_connected';
    ELSE
      SELECT invitation.id, invitation.couple_id, invitation.created_by
      INTO v_invite
      FROM public.invitation_codes AS invitation
      WHERE invitation.code_hash = p_code_hash
        AND invitation.used = false
        AND invitation.expires_at > CURRENT_TIMESTAMP;

      IF v_invite IS NULL THEN
        v_error_code := 'invalid_or_expired';
      ELSIF v_invite.created_by = v_uid THEN
        v_error_code := 'self_invitation';
      ELSE
        BEGIN
          PERFORM public.lock_relationship_mutation_boundary(
            v_invite.couple_id,
            ARRAY[v_uid, v_invite.created_by]::UUID[]
          );
        EXCEPTION WHEN SQLSTATE '42501' THEN
          GET STACKED DIAGNOSTICS v_boundary_message = MESSAGE_TEXT;
          IF v_boundary_message = 'relationship_deletion_pending' THEN
            IF EXISTS (
              SELECT 1
              FROM public.account_deletion_requests AS deletion
              WHERE deletion.user_id = v_uid
            ) THEN
              v_error_code := 'invalid_request';
            ELSE
              v_error_code := 'invalid_or_expired';
            END IF;
          ELSE
            RAISE;
          END IF;
        END;

        IF v_error_code IS NULL THEN
          SELECT relationship.*
          INTO v_relationship
          FROM public.couples AS relationship
          WHERE relationship.id = v_invite.couple_id
          FOR UPDATE;

          IF NOT FOUND OR v_relationship.closed_at IS NOT NULL THEN
            v_error_code := 'invalid_or_expired';
          ELSIF v_relationship.relationship_context IS DISTINCT FROM 'military' THEN
            v_error_code := 'invalid_or_expired';
          ELSIF EXISTS (
            SELECT 1
            FROM public.account_deletion_requests AS deletion
            WHERE deletion.user_id = v_uid
          ) THEN
            v_error_code := 'invalid_request';
          ELSIF EXISTS (
            SELECT 1
            FROM public.couple_members AS member
            WHERE member.user_id = v_uid
              AND member.status IN ('active', 'pending')
          ) THEN
            v_error_code := 'already_connected';
          ELSIF NOT EXISTS (
            SELECT 1
            FROM public.invitation_codes AS invitation
            WHERE invitation.id = v_invite.id
              AND invitation.couple_id = v_invite.couple_id
              AND invitation.code_hash = p_code_hash
              AND invitation.used = false
              AND invitation.expires_at > CURRENT_TIMESTAMP
              AND invitation.created_by <> v_uid
          ) THEN
            v_error_code := 'invalid_or_expired';
          ELSE
            SELECT
              count(*),
              count(*) FILTER (WHERE member.status = 'active')
            INTO v_member_count, v_active_count
            FROM public.couple_members AS member
            WHERE member.couple_id = v_invite.couple_id;

            SELECT member.user_id, member.role
            INTO v_inviter_user_id, v_inviter_role
            FROM public.couple_members AS member
            WHERE member.couple_id = v_invite.couple_id
              AND member.status = 'active'
            ORDER BY member.joined_at, member.id
            LIMIT 1;

            IF v_member_count <> 1
              OR v_active_count <> 1
              OR v_inviter_user_id IS DISTINCT FROM v_invite.created_by
              OR v_inviter_role NOT IN ('gomsin', 'soldier')
            THEN
              v_error_code := 'invalid_or_expired';
            ELSE
              UPDATE public.invitation_codes
              SET used = true,
                  used_by = v_uid,
                  used_at = CURRENT_TIMESTAMP
              WHERE id = v_invite.id
                AND couple_id = v_invite.couple_id
                AND code_hash = p_code_hash
                AND used = false
                AND expires_at > CURRENT_TIMESTAMP
                AND created_by <> v_uid;

              IF NOT FOUND THEN
                v_error_code := 'invalid_or_expired';
              ELSE
                v_invitee_role := CASE v_inviter_role
                  WHEN 'soldier' THEN 'gomsin'
                  ELSE 'soldier'
                END;

                INSERT INTO public.couple_members (
                  couple_id, user_id, role, status
                ) VALUES (
                  v_invite.couple_id, v_uid, v_invitee_role, 'active'
                );

                UPDATE public.couples
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = v_invite.couple_id;

                INSERT INTO public.invitation_attempts (user_id, succeeded)
                VALUES (v_uid, true);

                RETURN jsonb_build_object(
                  'ok', true,
                  'couple_id', v_invite.couple_id,
                  'error_code', NULL
                );
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    v_error_code := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.user_id = v_uid
          AND member.status IN ('active', 'pending')
      ) THEN 'already_connected'
      ELSE 'invalid_or_expired'
    END;
  WHEN SQLSTATE '40001' THEN
    RAISE;
  WHEN OTHERS THEN
    v_error_code := 'internal_error';
  END;

  IF COALESCE(v_error_code, 'internal_error') NOT IN (
    'rate_limited', 'already_connected', 'invalid_request'
  ) THEN
    INSERT INTO public.invitation_attempts (user_id, succeeded)
    VALUES (v_uid, false);
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'couple_id', NULL,
    'error_code', COALESCE(v_error_code, 'internal_error')
  );
END;
$$;

COMMENT ON FUNCTION public.redeem_invitation(TEXT) IS
  'Authenticated military-generation invitation redemption. Other contexts are indistinguishable from invalid codes.';

REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_invitation_v2(
  p_code_hash TEXT,
  p_expected_relationship_context TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_invite RECORD;
  v_relationship public.couples%ROWTYPE;
  v_member_count INTEGER;
  v_active_count INTEGER;
  v_inviter_user_id UUID;
  v_inviter_role TEXT;
  v_recent_failures INTEGER;
  v_daily_failures INTEGER;
  v_error_code TEXT;
  v_boundary_message TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'couple_id', NULL,
      'error_code', 'not_authenticated'
    );
  END IF;

  -- Keep the throttle namespace first. The inviter is unknown until the code
  -- lookup, so no relationship participant lock may be taken before this one.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15014));

  BEGIN
    SELECT
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      ),
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
      )
    INTO v_recent_failures, v_daily_failures
    FROM public.invitation_attempts
    WHERE user_id = v_uid
      AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours';

    IF v_recent_failures >= 5 OR v_daily_failures >= 20 THEN
      v_error_code := 'rate_limited';
    ELSIF p_expected_relationship_context IS DISTINCT FROM 'general' THEN
      v_error_code := 'invalid_request';
    ELSIF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
      v_error_code := 'invalid_request';
    ELSIF EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS deletion
      WHERE deletion.user_id = v_uid
    ) THEN
      v_error_code := 'invalid_request';
    ELSIF EXISTS (
      SELECT 1
      FROM public.couple_members AS member
      WHERE member.user_id = v_uid
        AND member.status IN ('active', 'pending')
    ) THEN
      v_error_code := 'already_connected';
    ELSE
      -- Discover only enough to acquire 074's complete participant boundary.
      -- Context is deliberately not filtered here; it is checked after the
      -- parent row is locked and the invitation is revalidated.
      SELECT invitation.id, invitation.couple_id, invitation.created_by
      INTO v_invite
      FROM public.invitation_codes AS invitation
      WHERE invitation.code_hash = p_code_hash
        AND invitation.used = false
        AND invitation.expires_at > CURRENT_TIMESTAMP;

      IF v_invite IS NULL THEN
        v_error_code := 'invalid_or_expired';
      ELSIF v_invite.created_by = v_uid THEN
        v_error_code := 'self_invitation';
      ELSE
        BEGIN
          -- 074 owns ordering inside this boundary: sorted namespace-15013
          -- locks, deletion marker rows, parent FOR UPDATE, participant recheck.
          PERFORM public.lock_relationship_mutation_boundary(
            v_invite.couple_id,
            ARRAY[v_uid, v_invite.created_by]::UUID[]
          );
        EXCEPTION WHEN SQLSTATE '42501' THEN
          GET STACKED DIAGNOSTICS v_boundary_message = MESSAGE_TEXT;
          IF v_boundary_message = 'relationship_deletion_pending' THEN
            IF EXISTS (
              SELECT 1
              FROM public.account_deletion_requests AS deletion
              WHERE deletion.user_id = v_uid
            ) THEN
              v_error_code := 'invalid_request';
            ELSE
              v_error_code := 'invalid_or_expired';
            END IF;
          ELSE
            RAISE;
          END IF;
        END;

        IF v_error_code IS NULL THEN
          SELECT relationship.*
          INTO v_relationship
          FROM public.couples AS relationship
          WHERE relationship.id = v_invite.couple_id
          FOR UPDATE;

          IF NOT FOUND OR v_relationship.closed_at IS NOT NULL THEN
            v_error_code := 'invalid_or_expired';
          ELSIF v_relationship.relationship_context IS DISTINCT FROM 'general' THEN
            v_error_code := 'invalid_or_expired';
          ELSIF EXISTS (
            SELECT 1
            FROM public.account_deletion_requests AS deletion
            WHERE deletion.user_id = v_uid
          ) THEN
            v_error_code := 'invalid_request';
          ELSIF EXISTS (
            SELECT 1
            FROM public.couple_members AS member
            WHERE member.user_id = v_uid
              AND member.status IN ('active', 'pending')
          ) THEN
            v_error_code := 'already_connected';
          ELSIF NOT EXISTS (
            SELECT 1
            FROM public.invitation_codes AS invitation
            WHERE invitation.id = v_invite.id
              AND invitation.couple_id = v_invite.couple_id
              AND invitation.code_hash = p_code_hash
              AND invitation.used = false
              AND invitation.expires_at > CURRENT_TIMESTAMP
              AND invitation.created_by <> v_uid
          ) THEN
            v_error_code := 'invalid_or_expired';
          ELSE
            SELECT
              count(*),
              count(*) FILTER (WHERE member.status = 'active')
            INTO v_member_count, v_active_count
            FROM public.couple_members AS member
            WHERE member.couple_id = v_invite.couple_id;

            SELECT member.user_id, member.role
            INTO v_inviter_user_id, v_inviter_role
            FROM public.couple_members AS member
            WHERE member.couple_id = v_invite.couple_id
              AND member.status = 'active'
            ORDER BY member.joined_at, member.id
            LIMIT 1;

            IF v_member_count <> 1
              OR v_active_count <> 1
              OR v_inviter_user_id IS DISTINCT FROM v_invite.created_by
              OR v_inviter_role IS DISTINCT FROM 'gomsin'
            THEN
              v_error_code := 'invalid_or_expired';
            ELSE
              UPDATE public.invitation_codes
              SET used = true,
                  used_by = v_uid,
                  used_at = CURRENT_TIMESTAMP
              WHERE id = v_invite.id
                AND couple_id = v_invite.couple_id
                AND code_hash = p_code_hash
                AND used = false
                AND expires_at > CURRENT_TIMESTAMP
                AND created_by <> v_uid;

              IF NOT FOUND THEN
                v_error_code := 'invalid_or_expired';
              ELSE
                INSERT INTO public.couple_members (
                  couple_id, user_id, role, status
                ) VALUES (
                  v_invite.couple_id, v_uid, 'soldier', 'active'
                );

                UPDATE public.couples
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = v_invite.couple_id;

                INSERT INTO public.invitation_attempts (user_id, succeeded)
                VALUES (v_uid, true);

                RETURN jsonb_build_object(
                  'ok', true,
                  'couple_id', v_invite.couple_id,
                  'error_code', NULL
                );
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    v_error_code := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.user_id = v_uid
          AND member.status IN ('active', 'pending')
      ) THEN 'already_connected'
      ELSE 'invalid_or_expired'
    END;
  WHEN SQLSTATE '40001' THEN
    RAISE;
  WHEN OTHERS THEN
    v_error_code := 'internal_error';
  END;

  IF COALESCE(v_error_code, 'internal_error') NOT IN (
    'rate_limited', 'already_connected', 'invalid_request'
  ) THEN
    INSERT INTO public.invitation_attempts (user_id, succeeded)
    VALUES (v_uid, false);
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'couple_id', NULL,
    'error_code', COALESCE(v_error_code, 'internal_error')
  );
END;
$$;

COMMENT ON FUNCTION public.redeem_invitation_v2(TEXT, TEXT) IS
  'Authenticated general-generation redemption. Context mismatch is opaque and never consumes the invitation.';

REVOKE ALL ON FUNCTION public.redeem_invitation_v2(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation_v2(TEXT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Authoritative context and military-only service projections
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_couple_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_relationship_context TEXT;
  v_role TEXT;
  v_member_status TEXT;
  v_partner_present BOOLEAN := false;
  v_invitation_active BOOLEAN := false;
  v_invitation_expires_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT
    member.couple_id,
    relationship.relationship_context,
    member.role,
    member.status
  INTO v_couple_id, v_relationship_context, v_role, v_member_status
  FROM public.couple_members AS member
  JOIN public.couples AS relationship ON relationship.id = member.couple_id
  WHERE member.user_id = v_uid
  ORDER BY (member.status = 'active') DESC, member.joined_at DESC NULLS LAST
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RETURN jsonb_build_object(
      'couple_id', NULL,
      'relationship_context', NULL,
      'role', NULL,
      'member_status', NULL,
      'partner_present', false,
      'invitation_active', false,
      'invitation_expires_at', NULL
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.couple_members AS partner
    WHERE partner.couple_id = v_couple_id
      AND partner.user_id <> v_uid
      AND partner.status = 'active'
  )
  INTO v_partner_present;

  IF v_member_status = 'active' AND NOT v_partner_present THEN
    SELECT invitation.expires_at
    INTO v_invitation_expires_at
    FROM public.invitation_codes AS invitation
    WHERE invitation.couple_id = v_couple_id
      AND invitation.used = false
      AND invitation.expires_at > CURRENT_TIMESTAMP
    ORDER BY invitation.created_at DESC
    LIMIT 1;

    v_invitation_active := v_invitation_expires_at IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'couple_id', v_couple_id,
    'relationship_context', v_relationship_context,
    'role', v_role,
    'member_status', v_member_status,
    'partner_present', v_partner_present,
    'invitation_active', v_invitation_active,
    'invitation_expires_at', v_invitation_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_couple_state()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_couple_state() TO authenticated;

COMMENT ON FUNCTION public.get_my_couple_state() IS
  'Read-only lifecycle and immutable relationship context for auth.uid(). Never returns invitation code material or private profile metadata.';

CREATE OR REPLACE FUNCTION public.get_partner_service_info()
RETURNS TABLE (
  branch TEXT,
  military_status TEXT,
  enlistment_date TEXT,
  expected_discharge_date TEXT,
  discharge_date TEXT,
  discharge_date_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.military_info ->> 'branch',
    profile.military_info ->> 'militaryStatus',
    profile.military_info ->> 'enlistmentDate',
    profile.military_info ->> 'expectedDischargeDate',
    profile.military_info ->> 'dischargeDate',
    profile.military_info ->> 'dischargeDateSource'
  FROM public.couple_members AS caller_member
  JOIN public.couples AS relationship
    ON relationship.id = caller_member.couple_id
  JOIN public.couple_members AS partner_member
    ON partner_member.couple_id = caller_member.couple_id
   AND partner_member.user_id <> caller_member.user_id
  JOIN public.profiles AS profile ON profile.id = partner_member.user_id
  WHERE caller_member.user_id = v_uid
    AND caller_member.status = 'active'
    AND caller_member.role = 'gomsin'
    AND partner_member.status = 'active'
    AND partner_member.role = 'soldier'
    AND relationship.closed_at IS NULL
    AND relationship.relationship_context = 'military'
    AND (
      SELECT count(*)
      FROM public.couple_members AS active_member
      WHERE active_member.couple_id = caller_member.couple_id
        AND active_member.status = 'active'
    ) = 2
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_service_info()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_service_info()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_relationship_snapshot_v2()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot JSONB;
  v_topology_invalid BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  WITH
  owner_memberships AS MATERIALIZED (
    SELECT
      owner_member.id,
      owner_member.couple_id,
      owner_member.role,
      owner_member.status,
      owner_member.joined_at
    FROM public.couple_members AS owner_member
    WHERE owner_member.user_id = v_uid
  ),
  owner_counts AS (
    SELECT
      count(*)::INTEGER AS owner_membership_count,
      count(*) FILTER (WHERE owner_memberships.status = 'active')::INTEGER
        AS owner_active_count,
      count(*) FILTER (WHERE owner_memberships.status = 'pending')::INTEGER
        AS owner_pending_count
    FROM owner_memberships
  ),
  selected_membership AS MATERIALIZED (
    SELECT
      owner_memberships.id,
      owner_memberships.couple_id,
      owner_memberships.role,
      owner_memberships.status,
      owner_memberships.joined_at
    FROM owner_memberships
    ORDER BY
      (owner_memberships.status = 'active') DESC,
      owner_memberships.joined_at DESC,
      owner_memberships.id DESC
    LIMIT 1
  ),
  selected_couple AS MATERIALIZED (
    SELECT
      relationship.id,
      relationship.membership_revision,
      relationship.relationship_context
    FROM selected_membership
    JOIN public.couples AS relationship
      ON relationship.id = selected_membership.couple_id
  ),
  active_members AS MATERIALIZED (
    SELECT
      active_member.user_id,
      active_member.role,
      active_member.joined_at
    FROM selected_membership
    JOIN public.couple_members AS active_member
      ON active_member.couple_id = selected_membership.couple_id
     AND active_member.status = 'active'
  ),
  active_counts AS (
    SELECT
      count(*)::INTEGER AS active_member_count,
      count(*) FILTER (WHERE active_members.user_id = v_uid)::INTEGER
        AS self_active_count,
      count(*) FILTER (WHERE active_members.user_id <> v_uid)::INTEGER
        AS partner_active_count
    FROM active_members
  ),
  partner_rows AS MATERIALIZED (
    SELECT
      partner_member.user_id,
      partner_member.joined_at,
      partner_profile.display_name,
      partner_profile.role,
      partner_profile.avatar_path,
      partner_profile.username,
      selected_couple.relationship_context = 'military'
        AND selected_membership.role = 'gomsin'
        AND partner_member.role = 'soldier' AS may_expose_service,
      partner_profile.military_info ->> 'branch' AS service_branch,
      partner_profile.military_info ->> 'militaryStatus' AS service_status,
      partner_profile.military_info ->> 'enlistmentDate' AS service_enlistment_date,
      partner_profile.military_info ->> 'expectedDischargeDate'
        AS service_expected_discharge_date,
      partner_profile.military_info ->> 'dischargeDate' AS service_discharge_date,
      partner_profile.military_info ->> 'dischargeDateSource'
        AS service_discharge_date_source
    FROM selected_membership
    JOIN selected_couple ON selected_couple.id = selected_membership.couple_id
    JOIN public.couple_members AS partner_member
      ON partner_member.couple_id = selected_membership.couple_id
     AND partner_member.status = 'active'
     AND partner_member.user_id <> v_uid
    JOIN public.profiles AS partner_profile ON partner_profile.id = partner_member.user_id
  ),
  partner_counts AS (
    SELECT count(*)::INTEGER AS partner_row_count
    FROM partner_rows
  ),
  invitation_rows AS MATERIALIZED (
    SELECT invitation.expires_at
    FROM selected_membership
    JOIN public.invitation_codes AS invitation
      ON invitation.couple_id = selected_membership.couple_id
    WHERE selected_membership.status = 'active'
      AND invitation.used = false
      AND invitation.expires_at > CURRENT_TIMESTAMP
  ),
  invitation_counts AS (
    SELECT
      count(*)::INTEGER AS invitation_row_count,
      max(invitation_rows.expires_at) AS invitation_expires_at
    FROM invitation_rows
  ),
  derived_state AS (
    SELECT
      owner_counts.owner_membership_count,
      owner_counts.owner_active_count,
      owner_counts.owner_pending_count,
      active_counts.active_member_count,
      active_counts.self_active_count,
      active_counts.partner_active_count,
      partner_counts.partner_row_count,
      invitation_counts.invitation_row_count,
      invitation_counts.invitation_expires_at,
      CASE
        WHEN owner_counts.owner_membership_count = 0 THEN 'personal'
        WHEN owner_counts.owner_active_count = 0
          AND owner_counts.owner_pending_count = 0 THEN 'disconnected'
        WHEN owner_counts.owner_active_count = 1
          AND active_counts.active_member_count = 1
          AND active_counts.self_active_count = 1
          AND active_counts.partner_active_count = 0 THEN 'pending'
        WHEN owner_counts.owner_active_count = 1
          AND active_counts.active_member_count = 2
          AND active_counts.self_active_count = 1
          AND active_counts.partner_active_count = 1 THEN 'active'
        ELSE NULL
      END AS lifecycle
    FROM owner_counts
    CROSS JOIN active_counts
    CROSS JOIN partner_counts
    CROSS JOIN invitation_counts
  ),
  service_payload AS (
    SELECT
      CASE
        WHEN partner_rows.may_expose_service THEN jsonb_build_object(
          'branch', partner_rows.service_branch,
          'military_status', partner_rows.service_status,
          'enlistment_date', partner_rows.service_enlistment_date,
          'expected_discharge_date', partner_rows.service_expected_discharge_date,
          'discharge_date', partner_rows.service_discharge_date,
          'discharge_date_source', partner_rows.service_discharge_date_source
        )
        ELSE NULL
      END AS service
    FROM partner_rows
  ),
  partner_payload AS (
    SELECT jsonb_build_object(
      'user_id', partner_rows.user_id,
      'joined_at', partner_rows.joined_at,
      'display_name', partner_rows.display_name,
      'role', partner_rows.role,
      'avatar_path', partner_rows.avatar_path,
      'username', partner_rows.username,
      'service', (SELECT service_payload.service FROM service_payload)
    ) AS partner
    FROM partner_rows
  ),
  finalized AS (
    SELECT
      (
        derived_state.owner_active_count > 1
        OR derived_state.owner_pending_count > 0
        OR derived_state.lifecycle IS NULL
        OR (
          derived_state.owner_membership_count > 0
          AND selected_couple.id IS NULL
        )
        OR (
          derived_state.lifecycle = 'disconnected'
          AND derived_state.active_member_count <> 0
        )
        OR (
          derived_state.lifecycle = 'active'
          AND derived_state.partner_row_count <> 1
        )
        OR (
          derived_state.lifecycle = 'pending'
          AND derived_state.invitation_row_count > 1
        )
      ) AS topology_invalid,
      jsonb_build_object(
        'contract_version', 2,
        'owner_user_id', v_uid,
        'lifecycle', derived_state.lifecycle,
        'couple_id', CASE
          WHEN derived_state.lifecycle = 'personal' THEN NULL
          ELSE selected_couple.id
        END,
        'relation_revision', selected_couple.membership_revision::TEXT,
        'partner', CASE
          WHEN derived_state.lifecycle = 'active'
            THEN (SELECT partner_payload.partner FROM partner_payload)
          ELSE NULL
        END,
        'invitation_active',
          derived_state.lifecycle = 'pending'
          AND derived_state.invitation_row_count = 1,
        'invitation_expires_at', CASE
          WHEN derived_state.lifecycle = 'pending'
            AND derived_state.invitation_row_count = 1
            THEN derived_state.invitation_expires_at
          ELSE NULL
        END
      ) AS snapshot
    FROM derived_state
    LEFT JOIN selected_couple ON true
  )
  SELECT finalized.topology_invalid, finalized.snapshot
  INTO v_topology_invalid, v_snapshot
  FROM finalized;

  IF v_topology_invalid THEN
    RAISE EXCEPTION 'relationship_topology_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_relationship_snapshot_v2()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_relationship_snapshot_v2()
  TO authenticated;

COMMENT ON FUNCTION public.get_my_relationship_snapshot_v2() IS
  'Version 2 authoritative relationship snapshot for auth.uid(). General generations preserve the response shape but never include service payload.';

NOTIFY pgrst, 'reload schema';

COMMIT;
