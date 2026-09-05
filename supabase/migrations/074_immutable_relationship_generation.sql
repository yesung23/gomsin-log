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

-- Every account-deletion invocation owns a fencing token. Rows created before
-- this migration cannot prove which invocation owns them, so they are moved to
-- an explicit non-cancellable operator-review phase instead of being guessed at
-- or adopted by a new request.
ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS attempt_id UUID,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_allowed BOOLEAN,
  ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMPTZ;

UPDATE public.account_deletion_requests
SET attempt_id = gen_random_uuid(),
    phase = 'legacy_blocked',
    cancellation_allowed = false,
    phase_updated_at = COALESCE(requested_at, CURRENT_TIMESTAMP)
WHERE attempt_id IS NULL
   OR phase IS NULL
   OR cancellation_allowed IS NULL
   OR phase_updated_at IS NULL;

ALTER TABLE public.account_deletion_requests
  ALTER COLUMN attempt_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN phase SET DEFAULT 'legacy_blocked',
  ALTER COLUMN cancellation_allowed SET DEFAULT false,
  ALTER COLUMN phase_updated_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN attempt_id SET NOT NULL,
  ALTER COLUMN phase SET NOT NULL,
  ALTER COLUMN cancellation_allowed SET NOT NULL,
  ALTER COLUMN phase_updated_at SET NOT NULL,
  ADD CONSTRAINT account_deletion_requests_phase_check
    CHECK (phase IN (
      'legacy_blocked',
      'media_cleanup',
      'e2ee_prepared',
      'relational_prepared',
      'relationships_closed',
      'solo_cleanup_complete'
    )),
  ADD CONSTRAINT account_deletion_requests_cancellation_phase_check
    CHECK ((phase = 'media_cleanup' AND cancellation_allowed)
      OR (phase <> 'media_cleanup' AND NOT cancellation_allowed));

COMMENT ON COLUMN public.account_deletion_requests.attempt_id IS
  'Invocation-scoped fencing token required by every destructive account-deletion RPC.';
COMMENT ON COLUMN public.account_deletion_requests.phase IS
  'Strict committed account-deletion phase; legacy_blocked requires operator review.';
COMMENT ON COLUMN public.account_deletion_requests.cancellation_allowed IS
  'True only before E2EE preparation has committed.';

-- Hold every authority source stable from preflight through backfill. ALTER
-- TABLE already holds the parent lock; these locks prevent an independent
-- token/claim write from landing after its check but before COMMIT.
LOCK TABLE public.couple_members, public.invitation_codes
  IN SHARE ROW EXCLUSIVE MODE;

DO $locks$
BEGIN
  IF to_regclass('public.crypto_pairings') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.crypto_pairings IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.device_push_tokens') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.device_push_tokens IN SHARE ROW EXCLUSIVE MODE';
  END IF;
  IF to_regclass('public.push_delivery_state') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.push_delivery_state IN SHARE ROW EXCLUSIVE MODE';
  END IF;
END;
$locks$;

-- A partially applied/manual predecessor must not leave a closed generation
-- with live authority. Refuse instead of silently disconnecting real users.
DO $migration$
DECLARE
  v_has_claim_columns BOOLEAN := false;
  v_has_legacy_authority BOOLEAN := false;
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

  -- Backfill is metadata-only. If a generation that would become historical
  -- still has live ancillary authority, abort this entire migration rather
  -- than silently retaining an invitation, pairing, token, or delivery claim.
  -- In particular, push tokens are user-global and may belong to the member's
  -- current relationship, so they must never be guessed at or mass-deleted.
  IF EXISTS (
    SELECT 1
    FROM public.couples AS relationship
    JOIN public.invitation_codes AS invitation
      ON invitation.couple_id = relationship.id
    WHERE invitation.used = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.couple_id = relationship.id
          AND member.status IN ('active', 'pending')
      )
  ) THEN
    RAISE EXCEPTION 'relationship_generation_legacy_unused_invitation'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.crypto_pairings') IS NOT NULL THEN
    EXECUTE $preflight$
      SELECT EXISTS (
        SELECT 1
        FROM public.couples AS relationship
        JOIN public.crypto_pairings AS pairing
          ON pairing.couple_id = relationship.id
        WHERE pairing.state NOT IN (
          'TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED'
        )
          AND NOT EXISTS (
            SELECT 1
            FROM public.couple_members AS member
            WHERE member.couple_id = relationship.id
              AND member.status IN ('active', 'pending')
          )
      )
    $preflight$ INTO v_has_legacy_authority;

    IF v_has_legacy_authority THEN
      RAISE EXCEPTION 'relationship_generation_legacy_live_pairing'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF to_regclass('public.device_push_tokens') IS NOT NULL THEN
    EXECUTE $preflight$
      SELECT EXISTS (
        SELECT 1
        FROM public.device_push_tokens AS token
        JOIN public.couple_members AS historical_member
          ON historical_member.user_id = token.user_id
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.couple_members AS open_member
          WHERE open_member.couple_id = historical_member.couple_id
            AND open_member.status IN ('active', 'pending')
        )
      )
    $preflight$ INTO v_has_legacy_authority;

    IF v_has_legacy_authority THEN
      RAISE EXCEPTION 'relationship_generation_legacy_push_token_ambiguous'
        USING ERRCODE = 'P0001';
    END IF;
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
      EXECUTE $preflight$
        SELECT EXISTS (
          SELECT 1
          FROM public.push_delivery_state AS delivery
          JOIN public.couple_members AS historical_member
            ON historical_member.user_id = delivery.user_id
          WHERE (
            delivery.has_unseen = true
            OR delivery.claim_id IS NOT NULL
            OR delivery.claimed_at IS NOT NULL
            OR delivery.claimed_until IS NOT NULL
          )
            AND NOT EXISTS (
              SELECT 1
              FROM public.couple_members AS open_member
              WHERE open_member.couple_id = historical_member.couple_id
                AND open_member.status IN ('active', 'pending')
            )
        )
      $preflight$ INTO v_has_legacy_authority;
    ELSE
      EXECUTE $preflight$
        SELECT EXISTS (
          SELECT 1
          FROM public.push_delivery_state AS delivery
          JOIN public.couple_members AS historical_member
            ON historical_member.user_id = delivery.user_id
          WHERE delivery.has_unseen = true
            AND NOT EXISTS (
              SELECT 1
              FROM public.couple_members AS open_member
              WHERE open_member.couple_id = historical_member.couple_id
                AND open_member.status IN ('active', 'pending')
            )
        )
      $preflight$ INTO v_has_legacy_authority;
    END IF;

    IF v_has_legacy_authority THEN
      RAISE EXCEPTION 'relationship_generation_legacy_delivery_state_ambiguous'
        USING ERRCODE = 'P0001';
    END IF;
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

-- Common lock boundary for every path that can create invitation or membership
-- authority. Reads may discover the participant set optimistically, but locks
-- are always acquired in this order:
--   sorted participant advisory locks -> deletion markers -> parent -> children.
-- If a committed writer changed the participant set while this function waited
-- for the parent, retrying the whole transaction is the only safe way to acquire
-- the newly discovered user's advisory lock in order.
CREATE OR REPLACE FUNCTION public.lock_relationship_mutation_boundary(
  p_couple_id UUID,
  p_subject_user_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before UUID[];
  v_after UUID[];
  v_user_id UUID;
BEGIN
  IF p_couple_id IS NULL OR p_subject_user_ids IS NULL THEN
    RAISE EXCEPTION 'relationship_mutation_scope_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_before
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT unnest(p_subject_user_ids) AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = p_couple_id
        AND member.status IN ('active', 'pending')
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  FOREACH v_user_id IN ARRAY v_before LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_user_id::TEXT, 15013)
    );
  END LOOP;

  -- Row locks make a marker that predates the advisory-lock protocol visible
  -- and stable as well. New fenced begin calls serialize on the advisory locks.
  PERFORM 1
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = ANY(v_before)
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'relationship_deletion_pending'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.couples AS relationship
  WHERE relationship.id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- The foreign key or caller supplies the canonical missing row error.
  END IF;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_after
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT unnest(p_subject_user_ids) AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = p_couple_id
        AND member.status IN ('active', 'pending')
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'relationship_participant_set_changed'
      USING ERRCODE = '40001';
  END IF;

  -- Recheck after the parent lock for legacy/direct marker writers that did not
  -- participate in the advisory-lock protocol.
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = ANY(v_after)
  ) THEN
    RAISE EXCEPTION 'relationship_deletion_pending'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_relationship_mutation_boundary(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_relationship_generation_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
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
      OR current_user IS DISTINCT FROM (
        SELECT pg_catalog.pg_get_userbyid(definition.proowner)
        FROM pg_catalog.pg_proc AS definition
        WHERE definition.oid =
          'public.enforce_relationship_generation_terminal()'::regprocedure
      )
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
  IF TG_OP = 'DELETE' THEN
    -- Do not take the parent row lock here. DELETE already owns the child row;
    -- waiting child-to-parent would invert the close path's parent-to-child
    -- order. A plain MVCC read either sees the generation open and refuses, or
    -- sees a committed terminal close and permits account/couple cleanup.
    SELECT relationship.closed_at
    INTO v_closed_at
    FROM public.couples AS relationship
    WHERE relationship.id = OLD.couple_id;

    IF FOUND AND v_closed_at IS NULL THEN
      RAISE EXCEPTION 'open_relationship_membership_delete_forbidden'
        USING ERRCODE = '42501';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
    )
  THEN
    RAISE EXCEPTION 'relationship_membership_identity_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IN ('active', 'pending') THEN
    PERFORM public.lock_relationship_mutation_boundary(
      NEW.couple_id,
      ARRAY[NEW.user_id]::UUID[]
    );

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
  BEFORE INSERT OR DELETE OR UPDATE OF couple_id, user_id, status ON public.couple_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_open_relationship_membership();

-- Browser clients never need to write membership identity directly. Couples
-- remain editable only through the two presentation fields used by the app;
-- terminal and revision state stay RPC/trigger owned even if an RLS policy is
-- accidentally broadened later.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.couple_members
  FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.couples FROM authenticated;
GRANT UPDATE (anniversary_date, updated_at) ON TABLE public.couples
  TO authenticated;

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
    PERFORM public.lock_relationship_mutation_boundary(
      NEW.couple_id,
      ARRAY[NEW.created_by]::UUID[]
    );

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
  BEFORE INSERT OR UPDATE ON public.invitation_codes
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

  -- Only this ungranted SECURITY DEFINER primitive can enter the terminal
  -- update window. The trigger additionally verifies current_user is the
  -- function owner, so a caller setting the custom GUC cannot forge authority.
  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'on',
    true
  );

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

  PERFORM set_config(
    'gomsinlog.relationship_terminal_close',
    'off',
    true
  );

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

-- Migration 030 left this legacy client name callable. Keep its UUID result
-- contract, but route it through the same participant/deletion lock boundary as
-- every newer invitation path.
CREATE OR REPLACE FUNCTION public.create_invitation(
  p_couple_id UUID,
  p_code_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Do not expose a target couple's deletion state to an unrelated caller.
  IF NOT EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    WHERE member.couple_id = p_couple_id
      AND member.user_id = v_uid
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active member access required' USING ERRCODE = '42501';
  END IF;

  PERFORM public.lock_relationship_mutation_boundary(
    p_couple_id,
    ARRAY[v_uid]::UUID[]
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.couple_members AS member
    JOIN public.couples AS relationship ON relationship.id = member.couple_id
    WHERE member.couple_id = p_couple_id
      AND member.user_id = v_uid
      AND member.status = 'active'
      AND relationship.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active member access required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (p_couple_id, p_code_hash, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(UUID, TEXT)
  TO authenticated;

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

  PERFORM public.lock_relationship_mutation_boundary(
    v_couple_id,
    ARRAY[v_uid]::UUID[]
  );

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
  v_boundary_message TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'couple_id', NULL,
      'error_code', 'not_authenticated'
    );
  END IF;

  -- The throttle ledger has its own namespace. Taking the relationship lock for
  -- only the invitee here would violate sorted participant ordering once the
  -- inviter is known from a valid code.
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
            -- The caller's own pending state is code-independent. A target
            -- participant's state is deliberately indistinguishable from a
            -- missing, expired, or already-used code.
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
    -- Participant-set drift must be retried from the beginning; converting it
    -- to an ordinary invalid-code result would hide the lock-order fence.
    RAISE;
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

  PERFORM public.lock_relationship_mutation_boundary(
    v_couple_id,
    ARRAY[v_uid]::UUID[]
  );

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

  PERFORM public.lock_relationship_mutation_boundary(
    v_couple_id,
    ARRAY[v_uid]::UUID[]
  );

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

  v_closed := public.close_relationship_generation_internal(v_couple_id);

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

  RETURN jsonb_build_object(
    'ok', true,
    'closed_count', v_closed_count
  );
END;
$$;

COMMENT ON FUNCTION public.close_account_relationship_generations(UUID) IS
  'Private compatibility primitive. Migration 074 callers must use the fenced v2 wrapper.';

REVOKE ALL ON FUNCTION public.close_account_relationship_generations(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Fenced account-deletion state machine
-- ---------------------------------------------------------------------------

-- Preserve the reviewed 027/029/037 implementations under owner-only names.
-- The public legacy signatures are recreated below as non-destructive shims,
-- so an older Edge deployment fails explicitly instead of bypassing the fence.
ALTER FUNCTION public.e2ee_prepare_account_deletion(UUID)
  RENAME TO e2ee_prepare_account_deletion_internal_074;
ALTER FUNCTION public.prepare_account_deletion(UUID, UUID[])
  RENAME TO prepare_account_deletion_internal_074;
ALTER FUNCTION public.cleanup_account_solo_couples(UUID)
  RENAME TO cleanup_account_solo_couples_internal_074;
ALTER FUNCTION public.close_account_relationship_generations(UUID)
  RENAME TO close_account_relationship_generations_internal_074;

REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion_internal_074(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_internal_074(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples_internal_074(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_internal_074(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- Tokenless mutation entry points cannot distinguish retries. Keep their names
-- for schema compatibility, but fail closed after 074.
CREATE OR REPLACE FUNCTION public.begin_account_deletion(
  p_user_id UUID,
  p_expected_record_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.e2ee_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(
  p_user_id UUID,
  p_expected_record_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_account_solo_couples(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.close_account_relationship_generations(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  RAISE EXCEPTION 'account_deletion_attempt_required'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.begin_account_deletion(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep the pre-074 service-only signatures discoverable for deployment-order
-- compatibility. Each one is a fail-closed shim and cannot mutate anything.
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(UUID, UUID[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(UUID, UUID[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_account_solo_couples(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lock_account_deletion_attempt_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couples_before UUID[];
  v_couples_after UUID[];
  v_participants_before UUID[];
  v_participants_after UUID[];
  v_participant UUID;
  v_phase TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;

  SELECT COALESCE(
    array_agg(scope.couple_id ORDER BY scope.couple_id),
    '{}'::UUID[]
  )
  INTO v_couples_before
  FROM (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE member.user_id = p_user_id
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_before
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT p_user_id AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_before)
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  FOREACH v_participant IN ARRAY v_participants_before LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_participant::TEXT, 15013)
    );
  END LOOP;

  SELECT deletion.phase
  INTO v_phase
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id
    AND deletion.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.couples AS relationship
  WHERE relationship.id = ANY(v_couples_before)
  ORDER BY relationship.id
  FOR UPDATE;

  SELECT COALESCE(
    array_agg(scope.couple_id ORDER BY scope.couple_id),
    '{}'::UUID[]
  )
  INTO v_couples_after
  FROM (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE member.user_id = p_user_id
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_after
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT p_user_id AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_after)
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  IF v_couples_after IS DISTINCT FROM v_couples_before
    OR v_participants_after IS DISTINCT FROM v_participants_before
  THEN
    RAISE EXCEPTION 'account_deletion_participant_set_changed'
      USING ERRCODE = '40001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = p_user_id
      AND deletion.attempt_id = p_attempt_id
      AND deletion.phase = v_phase
  ) THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_phase;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_account_deletion_attempt_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_v2(
  p_user_id UUID,
  p_expected_record_ids UUID[],
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couples_before UUID[];
  v_couples_after UUID[];
  v_participants_before UUID[];
  v_participants_after UUID[];
  v_participant UUID;
  v_phase TEXT;
  v_existing BOOLEAN := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL OR p_expected_record_ids IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;

  SELECT COALESCE(
    array_agg(scope.couple_id ORDER BY scope.couple_id),
    '{}'::UUID[]
  )
  INTO v_couples_before
  FROM (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE member.user_id = p_user_id
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_before
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT p_user_id AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_before)
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  FOREACH v_participant IN ARRAY v_participants_before LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_participant::TEXT, 15013)
    );
  END LOOP;

  SELECT deletion.phase
  INTO v_phase
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id
  FOR UPDATE;
  v_existing := FOUND;

  PERFORM 1
  FROM public.couples AS relationship
  WHERE relationship.id = ANY(v_couples_before)
  ORDER BY relationship.id
  FOR UPDATE;

  SELECT COALESCE(
    array_agg(scope.couple_id ORDER BY scope.couple_id),
    '{}'::UUID[]
  )
  INTO v_couples_after
  FROM (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE member.user_id = p_user_id
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_after
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT p_user_id AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_after)
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  IF v_couples_after IS DISTINCT FROM v_couples_before
    OR v_participants_after IS DISTINCT FROM v_participants_before
  THEN
    RAISE EXCEPTION 'account_deletion_participant_set_changed'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
    EXCEPT
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
  ) OR EXISTS (
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
    EXCEPT
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Account records changed before media cleanup';
  END IF;

  IF v_existing AND v_phase = 'legacy_blocked' THEN
    RAISE EXCEPTION 'legacy_account_deletion_requires_operator_review'
      USING ERRCODE = '55000';
  END IF;

  IF v_existing THEN
    UPDATE public.account_deletion_requests
    SET attempt_id = p_attempt_id,
        expected_record_ids = p_expected_record_ids,
        requested_at = CURRENT_TIMESTAMP,
        cancellation_allowed = (phase = 'media_cleanup'),
        phase_updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id
    RETURNING phase INTO v_phase;
  ELSE
    INSERT INTO public.account_deletion_requests (
      user_id,
      expected_record_ids,
      requested_at,
      attempt_id,
      phase,
      cancellation_allowed,
      phase_updated_at
    ) VALUES (
      p_user_id,
      p_expected_record_ids,
      CURRENT_TIMESTAMP,
      p_attempt_id,
      'media_cleanup',
      true,
      CURRENT_TIMESTAMP
    )
    RETURNING phase INTO v_phase;
  END IF;

  -- Drain metadata INSERT transactions that passed the pre-marker Storage
  -- policy snapshot. New uploads observe the committed deletion marker.
  LOCK TABLE storage.objects IN SHARE MODE;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_id', p_attempt_id,
    'phase', v_phase
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 15013));

  DELETE FROM public.account_deletion_requests
  WHERE user_id = p_user_id
    AND attempt_id = p_attempt_id
    AND phase = 'media_cleanup'
    AND cancellation_allowed = true;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.e2ee_prepare_account_deletion_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase TEXT;
  v_preparation JSONB;
  v_message TEXT;
  v_changed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  v_phase := public.lock_account_deletion_attempt_v2(p_user_id, p_attempt_id);

  IF v_phase IN (
    'e2ee_prepared', 'relational_prepared',
    'relationships_closed', 'solo_cleanup_complete'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'phase', v_phase,
      'already_completed', true,
      'preparation', NULL
    );
  ELSIF v_phase <> 'media_cleanup' THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    v_preparation := public.e2ee_prepare_account_deletion_internal_074(p_user_id);
    IF v_preparation IS NULL OR jsonb_typeof(v_preparation) <> 'object' THEN
      RAISE EXCEPTION 'invalid_e2ee_account_deletion_result'
        USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message ~
      '^E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch [0-9]+ has no surviving envelope for the remaining partner$'
    THEN
      -- The nested block is a PL/pgSQL subtransaction. Catching here proves
      -- every write made by the compatibility E2EE primitive was rolled back.
      RETURN jsonb_build_object(
        'ok', false,
        'phase', 'media_cleanup',
        'refusal_code', 'e2ee_would_orphan_partner',
        'rollback_confirmed', true
      );
    ELSE
      RAISE;
    END IF;
  END;

  UPDATE public.account_deletion_requests
  SET phase = 'e2ee_prepared',
      cancellation_allowed = false,
      phase_updated_at = CURRENT_TIMESTAMP
  WHERE user_id = p_user_id
    AND attempt_id = p_attempt_id
    AND phase = 'media_cleanup';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phase', 'e2ee_prepared',
    'preparation', v_preparation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_v2(
  p_user_id UUID,
  p_expected_record_ids UUID[],
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase TEXT;
  v_preparation JSONB;
  v_changed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_expected_record_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload'
      USING ERRCODE = '22004';
  END IF;
  v_phase := public.lock_account_deletion_attempt_v2(p_user_id, p_attempt_id);

  IF v_phase IN (
    'relational_prepared', 'relationships_closed', 'solo_cleanup_complete'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'phase', v_phase,
      'already_completed', true,
      'preparation', NULL
    );
  ELSIF v_phase <> 'e2ee_prepared' THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  v_preparation := public.prepare_account_deletion_internal_074(
    p_user_id,
    p_expected_record_ids
  );
  IF v_preparation IS NULL
    OR jsonb_typeof(v_preparation) <> 'object'
    OR (v_preparation -> 'ok') IS DISTINCT FROM 'true'::JSONB
  THEN
    RAISE EXCEPTION 'invalid_relational_account_deletion_result'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_deletion_requests
  SET phase = 'relational_prepared',
      cancellation_allowed = false,
      phase_updated_at = CURRENT_TIMESTAMP
  WHERE user_id = p_user_id
    AND attempt_id = p_attempt_id
    AND phase = 'e2ee_prepared';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phase', 'relational_prepared',
    'preparation', v_preparation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_account_relationship_generations_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase TEXT;
  v_closure JSONB;
  v_closed_count INTEGER;
  v_changed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  v_phase := public.lock_account_deletion_attempt_v2(p_user_id, p_attempt_id);

  IF v_phase IN ('relationships_closed', 'solo_cleanup_complete') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'phase', v_phase,
      'closed_count', 0,
      'already_completed', true
    );
  ELSIF v_phase <> 'relational_prepared' THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  v_closure := public.close_account_relationship_generations_internal_074(p_user_id);
  IF v_closure IS NULL
    OR jsonb_typeof(v_closure) <> 'object'
    OR (v_closure -> 'ok') IS DISTINCT FROM 'true'::JSONB
    OR (v_closure ->> 'closed_count') IS NULL
    OR jsonb_typeof(v_closure -> 'closed_count') <> 'number'
    OR (v_closure ->> 'closed_count') !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'invalid_relationship_closure_result'
      USING ERRCODE = 'P0001';
  END IF;
  v_closed_count := (v_closure ->> 'closed_count')::INTEGER;

  UPDATE public.account_deletion_requests
  SET phase = 'relationships_closed',
      cancellation_allowed = false,
      phase_updated_at = CURRENT_TIMESTAMP
  WHERE user_id = p_user_id
    AND attempt_id = p_attempt_id
    AND phase = 'relational_prepared';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phase', 'relationships_closed',
    'closed_count', v_closed_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_account_solo_couples_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase TEXT;
  v_deleted_count INTEGER;
  v_changed INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  v_phase := public.lock_account_deletion_attempt_v2(p_user_id, p_attempt_id);

  IF v_phase = 'solo_cleanup_complete' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'phase', v_phase,
      'deleted_count', 0,
      'already_completed', true
    );
  ELSIF v_phase <> 'relationships_closed' THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  v_deleted_count := public.cleanup_account_solo_couples_internal_074(p_user_id);
  IF v_deleted_count IS NULL OR v_deleted_count < 0 THEN
    RAISE EXCEPTION 'invalid_solo_cleanup_result'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.account_deletion_requests
  SET phase = 'solo_cleanup_complete',
      cancellation_allowed = false,
      phase_updated_at = CURRENT_TIMESTAMP
  WHERE user_id = p_user_id
    AND attempt_id = p_attempt_id
    AND phase = 'relationships_closed';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phase', 'solo_cleanup_complete',
    'deleted_count', v_deleted_count
  );
END;
$$;

COMMENT ON FUNCTION public.begin_account_deletion_v2(UUID, UUID[], UUID) IS
  'Starts or adopts a retry with an invocation fencing token while preserving any committed non-cancellable phase.';
COMMENT ON FUNCTION public.cancel_account_deletion_v2(UUID, UUID) IS
  'Cancels only the exact current attempt while it is still in cancellable media cleanup.';
COMMENT ON FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID) IS
  'Fenced E2EE preparation. Only the exact orphan refusal is converted to a structured rolled-back result.';

REVOKE ALL ON FUNCTION public.begin_account_deletion_v2(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_account_deletion_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_v2(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.begin_account_deletion_v2(UUID, UUID[], UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion_v2(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion_v2(UUID, UUID[], UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_account_solo_couples_v2(UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback boundary:
-- Keep closed_at and every terminal timestamp. A later forward migration may
-- replace RPC bodies or revoke execution, but reopening a closed generation or
-- reactivating its memberships would reintroduce former-partner data spill.
