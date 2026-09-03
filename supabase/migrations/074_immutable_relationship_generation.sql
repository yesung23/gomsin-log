-- 074_immutable_relationship_generation.sql
--
-- A couple UUID is a relationship generation, not a reusable room. Once that
-- generation closes, no old membership, invitation, pairing, delivery state,
-- or user-owned row may make it active for a future partner.
--
-- Production preflight before applying this migration:
--
--   SELECT c.id,
--          count(*) FILTER (WHERE m.status IN ('active', 'pending')) AS open_members,
--          count(*) FILTER (WHERE m.status = 'disconnected') AS former_members
--   FROM public.couples c
--   LEFT JOIN public.couple_members m ON m.couple_id = c.id
--   GROUP BY c.id
--   HAVING count(*) FILTER (WHERE m.status IN ('active', 'pending')) > 0
--      AND count(*) FILTER (WHERE m.status = 'disconnected') > 0;
--
-- Any returned row needs explicit operator review. Automatically choosing
-- whether its active or former member owns the history could expose one
-- person's old content to another, so this migration refuses the topology.

BEGIN;

ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.couples.closed_at IS
  'Terminal time at which this immutable relationship generation stopped accepting active or pending members.';

-- A partially applied/manual predecessor must not leave a closed generation
-- with live authority. Refuse instead of silently disconnecting real users.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.couples AS relationship
    WHERE relationship.closed_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.couple_id = relationship.id
          AND member.status IN ('active', 'pending')
      )
  ) THEN
    RAISE EXCEPTION 'relationship_generation_closed_with_open_membership'
      USING ERRCODE = 'P0001';
  END IF;

  -- A legacy generation containing both a former member and an open member is
  -- ambiguous: accepting a new partner could expose the former relationship,
  -- while automatically closing it could interrupt a current relationship.
  -- Stop for explicit data review; do not guess or rewrite memberships.
  IF EXISTS (
    SELECT 1
    FROM public.couples AS relationship
    WHERE EXISTS (
      SELECT 1
      FROM public.couple_members AS former_member
      WHERE former_member.couple_id = relationship.id
        AND former_member.status = 'disconnected'
    )
      AND EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.couple_id = relationship.id
          AND member.status IN ('active', 'pending')
      )
  ) THEN
    RAISE EXCEPTION 'relationship_generation_mixed_legacy_state'
      USING ERRCODE = 'P0001';
  END IF;
END;
$migration$;

-- Safe additive backfill: these generations have no active or pending member,
-- so marking them closed grants nobody new access and removes no row. The exact
-- historical unlink time is unknown; CURRENT_TIMESTAMP honestly records when
-- the server first enforced terminal-generation semantics. No other column is
-- rewritten by this backfill.
UPDATE public.couples AS relationship
SET closed_at = CURRENT_TIMESTAMP
WHERE relationship.closed_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    WHERE member.couple_id = relationship.id
      AND member.status IN ('active', 'pending')
  );

-- ---------------------------------------------------------------------------
-- 1. Structural backstops
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_relationship_generation_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL
    AND NEW.closed_at IS DISTINCT FROM OLD.closed_at
  THEN
    RAISE EXCEPTION 'relationship_generation_is_terminal'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL THEN
    IF auth.role() IS NULL
      OR auth.role() NOT IN ('authenticated', 'service_role')
      OR current_setting('gomsinlog.relationship_terminal_close', true)
        IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION 'relationship_generation_close_not_authorized'
        USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.couple_members AS member
      WHERE member.couple_id = NEW.id
        AND member.status IN ('active', 'pending')
    ) THEN
      RAISE EXCEPTION 'relationship_generation_has_open_membership'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_relationship_generation_terminal()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_relationship_generation_terminal ON public.couples;
CREATE TRIGGER trg_relationship_generation_terminal
  BEFORE UPDATE OF closed_at ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.enforce_relationship_generation_terminal();

CREATE OR REPLACE FUNCTION public.enforce_open_relationship_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_at TIMESTAMPTZ;
BEGIN
  IF NEW.status IN ('active', 'pending') THEN
    -- The parent lock is the shared serialization point for redeem, close, and
    -- every lower-level membership write. If a close is in progress this waits,
    -- then reads the committed terminal marker before permitting the row.
    SELECT relationship.closed_at
    INTO v_closed_at
    FROM public.couples AS relationship
    WHERE relationship.id = NEW.couple_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW; -- The foreign key supplies the canonical missing-parent error.
    END IF;

    IF v_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'closed_relationship_generation'
        USING ERRCODE = '42501';
    END IF;

    -- In the new invariant, the first disconnected membership closes the whole
    -- generation. This guard also protects any reviewed legacy row even before
    -- an operator records its terminal timestamp.
    IF EXISTS (
      SELECT 1
      FROM public.couple_members AS former_member
      WHERE former_member.couple_id = NEW.couple_id
        AND former_member.status = 'disconnected'
    ) THEN
      RAISE EXCEPTION 'historical_relationship_generation_cannot_reactivate'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_open_relationship_membership()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_open_relationship_membership ON public.couple_members;
CREATE TRIGGER trg_open_relationship_membership
  BEFORE INSERT OR UPDATE OF couple_id, status ON public.couple_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_open_relationship_membership();

CREATE OR REPLACE FUNCTION public.enforce_open_relationship_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_at TIMESTAMPTZ;
BEGIN
  IF NEW.used = false THEN
    -- This protects the retained legacy create_invitation RPC as well as all
    -- future writers. Taking the same parent lock means an invitation either
    -- exists before closure and is invalidated by it, or waits and is refused.
    SELECT relationship.closed_at
    INTO v_closed_at
    FROM public.couples AS relationship
    WHERE relationship.id = NEW.couple_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW; -- The foreign key supplies the canonical missing-parent error.
    END IF;

    IF v_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'closed_relationship_generation'
        USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.couple_members AS former_member
      WHERE former_member.couple_id = NEW.couple_id
        AND former_member.status = 'disconnected'
    ) THEN
      RAISE EXCEPTION 'historical_relationship_generation_cannot_invite'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_open_relationship_invitation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_open_relationship_invitation ON public.invitation_codes;
CREATE TRIGGER trg_open_relationship_invitation
  BEFORE INSERT OR UPDATE OF couple_id, used ON public.invitation_codes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_open_relationship_invitation();

-- ---------------------------------------------------------------------------
-- 2. One private terminal-close primitive
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_relationship_generation_internal(
  p_couple_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_closed_at TIMESTAMPTZ;
  v_has_claim_columns BOOLEAN;
BEGIN
  IF p_couple_id IS NULL THEN
    RAISE EXCEPTION 'relationship_generation_id_required'
      USING ERRCODE = '22004';
  END IF;

  IF auth.role() IS NULL
    OR auth.role() NOT IN ('authenticated', 'service_role')
    OR current_setting('gomsinlog.relationship_terminal_close', true)
      IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'relationship_generation_close_not_authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT relationship.closed_at
  INTO v_closed_at
  FROM public.couples AS relationship
  WHERE relationship.id = p_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship_generation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotence is required by account-deletion retries. A terminal generation
  -- has already had every live authority revoked by this transaction boundary.
  IF v_closed_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('public.crypto_pairings') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.crypto_pairings
      SET state = 'UNLINKED', updated_at = CURRENT_TIMESTAMP
      WHERE couple_id = $1
        AND state IN (
          'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE',
          'CONFIRMED_BOTH', 'EPOCH_PREPARING', 'CRYPTO_ACTIVE'
        )
    $sql$ USING p_couple_id;
  END IF;

  IF to_regclass('public.device_push_tokens') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM public.device_push_tokens AS token
      WHERE token.user_id IN (
        SELECT member.user_id
        FROM public.couple_members AS member
        WHERE member.couple_id = $1
      )
    $sql$ USING p_couple_id;
  END IF;

  IF to_regclass('public.push_delivery_state') IS NOT NULL THEN
    SELECT count(*) = 3
    INTO v_has_claim_columns
    FROM information_schema.columns AS column_definition
    WHERE column_definition.table_schema = 'public'
      AND column_definition.table_name = 'push_delivery_state'
      AND column_definition.column_name IN (
        'claim_id', 'claimed_at', 'claimed_until'
      );

    IF v_has_claim_columns THEN
      EXECUTE $sql$
        UPDATE public.push_delivery_state AS delivery
        SET has_unseen = false,
            claim_id = NULL,
            claimed_at = NULL,
            claimed_until = NULL
        WHERE delivery.user_id IN (
          SELECT member.user_id
          FROM public.couple_members AS member
          WHERE member.couple_id = $1
        )
      $sql$ USING p_couple_id;
    ELSE
      EXECUTE $sql$
        UPDATE public.push_delivery_state AS delivery
        SET has_unseen = false
        WHERE delivery.user_id IN (
          SELECT member.user_id
          FROM public.couple_members AS member
          WHERE member.couple_id = $1
        )
      $sql$ USING p_couple_id;
    END IF;
  END IF;

  UPDATE public.invitation_codes
  SET used = true,
      used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
  WHERE couple_id = p_couple_id
    AND used = false;

  UPDATE public.couple_members
  SET status = 'disconnected'
  WHERE couple_id = p_couple_id
    AND status IN ('active', 'pending');

  UPDATE public.couples
  SET closed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = p_couple_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.close_relationship_generation_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.close_relationship_generation_internal(UUID) IS
  'Owner-only implementation primitive. Callers need a fixed role check, the transaction-local close capability, and database-owner function execution.';

-- ---------------------------------------------------------------------------
-- 3. Authenticated product RPCs, forward-replaced from the latest hardening
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_couple_and_invitation(
  p_role TEXT,
  p_code_hash TEXT
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
  IF p_role NOT IN ('gomsin', 'soldier') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  -- Shared with redemption and account deletion, so deletion cannot close its
  -- observed set and then race with this account creating a fresh generation.
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

  -- There is intentionally no lookup or reactivation of a historical member.
  -- A new relationship always receives a new UUID and future key scope.
  INSERT INTO public.couples DEFAULT VALUES
  RETURNING id INTO v_couple_id;

  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, p_role, 'active');

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT)
  TO authenticated;

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
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'couple_id', NULL,
      'error_code', 'not_authenticated'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15013));

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
        SELECT relationship.*
        INTO v_relationship
        FROM public.couples AS relationship
        WHERE relationship.id = v_invite.couple_id
        FOR UPDATE;

        IF NOT FOUND OR v_relationship.closed_at IS NOT NULL THEN
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

              -- Plain INSERT is deliberate. An existing historical membership
              -- is never revived by invitation redemption.
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
  WHEN OTHERS THEN
    -- Keep migration 015's durable failure semantics: the subtransaction rolls
    -- back partial redemption, then the rate-limit ledger commits below.
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
  'Authenticated, throttled invitation redemption. Closed or historical relationship generations are indistinguishable from invalid codes.';

REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- The unaudited legacy consumption path stays unavailable.
REVOKE ALL ON FUNCTION public.consume_invitation(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_relationship public.couples%ROWTYPE;
  v_member_count INTEGER;
  v_active_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15013));

  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Account deletion pending' USING ERRCODE = '42501';
  END IF;

  SELECT member.couple_id
  INTO v_couple_id
  FROM public.couple_members AS member
  JOIN public.couples AS relationship ON relationship.id = member.couple_id
  WHERE member.user_id = v_uid
    AND member.status = 'active'
    AND relationship.closed_at IS NULL
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  SELECT relationship.*
  INTO v_relationship
  FROM public.couples AS relationship
  WHERE relationship.id = v_couple_id
  FOR UPDATE;

  IF NOT FOUND OR v_relationship.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = v_uid
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    WHERE member.couple_id = v_couple_id
      AND member.user_id = v_uid
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE member.status = 'active')
  INTO v_member_count, v_active_count
  FROM public.couple_members AS member
  WHERE member.couple_id = v_couple_id;

  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'Couple space is already connected';
  END IF;

  IF v_member_count <> 1 OR v_active_count <> 1 THEN
    RAISE EXCEPTION 'Relationship generation is not inviteable'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.invitation_codes
  SET used = true, used_at = CURRENT_TIMESTAMP
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at <= CURRENT_TIMESTAMP;

  UPDATE public.invitation_codes
  SET used = true, used_at = CURRENT_TIMESTAMP
  WHERE couple_id = v_couple_id
    AND used = false;

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_invitation(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_invitation(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_closed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15013));

  SELECT member.couple_id
  INTO v_couple_id
  FROM public.couple_members AS member
  JOIN public.couples AS relationship ON relationship.id = member.couple_id
  WHERE member.user_id = v_uid
    AND member.status = 'active'
    AND relationship.closed_at IS NULL
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  PERFORM 1
  FROM public.couples AS relationship
  WHERE relationship.id = v_couple_id
    AND relationship.closed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    WHERE member.couple_id = v_couple_id
      AND member.user_id = v_uid
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'on',
    true
  );
  v_closed := public.close_relationship_generation_internal(v_couple_id);
  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'off',
    true
  );

  IF NOT v_closed THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_couple()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Service-role account-deletion close
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_account_relationship_generations(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_relationship RECORD;
  v_closed_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;

  -- Same per-user lock as creation/redemption. Once this call has enumerated
  -- open generations, later creation attempts observe the durable deletion
  -- request and refuse rather than racing Auth deletion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 15013));

  PERFORM 1
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion was not prepared for relationship closure'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'on',
    true
  );

  -- The internal primitive takes each parent row lock. Stable UUID ordering
  -- prevents two concurrent partner deletions from acquiring shared generations
  -- in opposite orders.
  FOR v_relationship IN
    SELECT DISTINCT relationship.id
    FROM public.couples AS relationship
    JOIN public.couple_members AS member
      ON member.couple_id = relationship.id
    WHERE member.user_id = p_user_id
      AND relationship.closed_at IS NULL
    ORDER BY relationship.id
  LOOP
    IF public.close_relationship_generation_internal(v_relationship.id) THEN
      v_closed_count := v_closed_count + 1;
    END IF;
  END LOOP;

  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'off',
    true
  );

  RETURN jsonb_build_object(
    'ok', true,
    'closed_count', v_closed_count
  );
END;
$$;

COMMENT ON FUNCTION public.close_account_relationship_generations(UUID) IS
  'Service-role-only idempotent account-deletion step. Terminally closes every current relationship generation after relational preparation and before Auth deletion.';

REVOKE ALL ON FUNCTION public.close_account_relationship_generations(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_account_relationship_generations(UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback boundary:
-- Keep closed_at and every terminal timestamp. A later forward migration may
-- replace RPC bodies or revoke execution, but reopening a closed generation or
-- reactivating its memberships would reintroduce former-partner data spill.
