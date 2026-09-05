-- 076_account_deletion_write_fence.sql
--
-- A committed account-deletion marker is a write fence, not merely a UI state.
-- Every authenticated INSERT/UPDATE now enters migration 074's namespace-15013
-- participant boundary before a child tuple can be locked.  Shared writes also
-- include every active/pending participant, so a surviving partner cannot add
-- data to a relationship while the other account is being deleted.
--
-- Service-role code receives no blanket bypass.  Reviewed mutating RPCs open a
-- private, transaction-bound capability only after taking the same boundary.
-- The account-deletion pipeline additionally proves the exact attempt and phase.
--
-- Replay policy: this migration intentionally fails atomically once installed.
-- Renamed implementation functions are the durable installation marker.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure(
       'public.lock_account_write_scope(uuid[],boolean)'
     ) IS NOT NULL
     OR to_regclass(
       'public.account_deletion_write_capabilities'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.reorder_trip_items_internal_076(uuid[],integer[])'
     ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'migration_076_already_applied'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Rows are both ungranted and RLS-protected.  The database owner reaches them
-- only through ungranted SECURITY DEFINER helpers.  backend + xid prevents a
-- capability from surviving or crossing transactions, and the random id lets a
-- wrapper close exactly the authority it opened.
CREATE TABLE public.account_deletion_write_capabilities (
  backend_pid INTEGER NOT NULL,
  transaction_id BIGINT NOT NULL,
  capability_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_kind TEXT NOT NULL
    CHECK (capability_kind IN ('trusted_service', 'account_deletion_v2')),
  subject_user_ids UUID[] NOT NULL,
  include_relationships BOOLEAN NOT NULL,
  deletion_user_id UUID,
  deletion_attempt_id UUID,
  deletion_phase TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (
      capability_kind = 'trusted_service'
      AND deletion_user_id IS NULL
      AND deletion_attempt_id IS NULL
      AND deletion_phase IS NULL
    )
    OR
    (
      capability_kind = 'account_deletion_v2'
      AND deletion_user_id IS NOT NULL
      AND deletion_attempt_id IS NOT NULL
      AND deletion_phase IS NOT NULL
    )
  )
);

CREATE INDEX account_deletion_write_capabilities_transaction
  ON public.account_deletion_write_capabilities (
    backend_pid,
    transaction_id
  );

ALTER TABLE public.account_deletion_write_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_write_capabilities
  FROM PUBLIC, anon, authenticated, service_role;

-- Snapshot -> sorted participant advisory locks -> marker rows -> sorted parent
-- locks -> participant recheck.  This is deliberately the same namespace and
-- ordering used by 074.  The return value lets the row gate distinguish a
-- normal write from one of the exact one-way reductions allowed below.
CREATE FUNCTION public.lock_account_write_scope(
  p_subject_user_ids UUID[],
  p_include_relationships BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couples_before UUID[];
  v_participants_before UUID[];
  v_couples_after UUID[];
  v_participants_after UUID[];
  v_participant UUID;
  v_pending BOOLEAN;
BEGIN
  IF p_subject_user_ids IS NULL
    OR p_include_relationships IS NULL
    OR EXISTS (
      SELECT 1
      FROM unnest(p_subject_user_ids) AS subject(user_id)
      WHERE subject.user_id IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  SELECT COALESCE(
    array_agg(scope.couple_id ORDER BY scope.couple_id),
    '{}'::UUID[]
  )
  INTO v_couples_before
  FROM (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE p_include_relationships
      AND member.user_id = ANY(p_subject_user_ids)
      AND member.status IN ('active', 'pending')
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_before
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT unnest(p_subject_user_ids) AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_before)
        AND member.status IN ('active', 'pending')
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  FOREACH v_participant IN ARRAY v_participants_before LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_participant::TEXT, 15013)
    );
  END LOOP;

  PERFORM 1
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = ANY(v_participants_before)
  ORDER BY deletion.user_id
  FOR UPDATE;

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
    WHERE p_include_relationships
      AND member.user_id = ANY(p_subject_user_ids)
      AND member.status IN ('active', 'pending')
  ) AS scope;

  SELECT COALESCE(
    array_agg(participant.user_id ORDER BY participant.user_id),
    '{}'::UUID[]
  )
  INTO v_participants_after
  FROM (
    SELECT DISTINCT candidate.user_id
    FROM (
      SELECT unnest(p_subject_user_ids) AS user_id
      UNION ALL
      SELECT member.user_id
      FROM public.couple_members AS member
      WHERE member.couple_id = ANY(v_couples_after)
        AND member.status IN ('active', 'pending')
    ) AS candidate
    WHERE candidate.user_id IS NOT NULL
  ) AS participant;

  IF v_couples_after IS DISTINCT FROM v_couples_before
    OR v_participants_after IS DISTINCT FROM v_participants_before
  THEN
    RAISE EXCEPTION 'account_write_participant_set_changed'
      USING ERRCODE = '40001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = ANY(v_participants_after)
  )
  INTO v_pending;

  RETURN v_pending;
END;
$$;

CREATE FUNCTION public.account_write_scope_has_pending(
  p_subject_user_ids UUID[],
  p_include_relationships BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH relationship_scope AS (
    SELECT DISTINCT member.couple_id
    FROM public.couple_members AS member
    WHERE p_include_relationships
      AND member.user_id = ANY(p_subject_user_ids)
      AND member.status IN ('active', 'pending')
  ),
  participants AS (
    SELECT subject.user_id
    FROM unnest(p_subject_user_ids) AS subject(user_id)
    WHERE subject.user_id IS NOT NULL
    UNION
    SELECT member.user_id
    FROM public.couple_members AS member
    WHERE member.couple_id IN (
      SELECT relationship_scope.couple_id
      FROM relationship_scope
    )
      AND member.status IN ('active', 'pending')
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id IN (
      SELECT participants.user_id
      FROM participants
    )
  );
$$;

CREATE FUNCTION public.assert_account_write_open(
  p_subject_user_ids UUID[],
  p_include_relationships BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.lock_account_write_scope(
    p_subject_user_ids,
    p_include_relationships
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;
END;
$$;

CREATE FUNCTION public.open_trusted_account_write_capability(
  p_subject_user_ids UUID[],
  p_include_relationships BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_account_write_open(
    p_subject_user_ids,
    p_include_relationships
  );

  INSERT INTO public.account_deletion_write_capabilities (
    backend_pid,
    transaction_id,
    capability_kind,
    subject_user_ids,
    include_relationships
  ) VALUES (
    pg_backend_pid(),
    txid_current(),
    'trusted_service',
    p_subject_user_ids,
    p_include_relationships
  )
  RETURNING capability_id INTO v_capability_id;

  RETURN v_capability_id;
END;
$$;

CREATE FUNCTION public.open_account_deletion_write_capability(
  p_user_id UUID,
  p_attempt_id UUID,
  p_expected_phases TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase TEXT;
  v_capability_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_phases IS NULL
    OR cardinality(p_expected_phases) = 0
  THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  v_phase := public.lock_account_deletion_attempt_v2(
    p_user_id,
    p_attempt_id
  );

  IF NOT (v_phase = ANY(p_expected_phases)) THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.account_deletion_write_capabilities (
    backend_pid,
    transaction_id,
    capability_kind,
    subject_user_ids,
    include_relationships,
    deletion_user_id,
    deletion_attempt_id,
    deletion_phase
  ) VALUES (
    pg_backend_pid(),
    txid_current(),
    'account_deletion_v2',
    ARRAY[p_user_id]::UUID[],
    true,
    p_user_id,
    p_attempt_id,
    v_phase
  )
  RETURNING capability_id INTO v_capability_id;

  RETURN v_capability_id;
END;
$$;

CREATE FUNCTION public.close_account_write_capability(
  p_capability_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.account_deletion_write_capabilities
  WHERE capability_id = p_capability_id
    AND backend_pid = pg_backend_pid()
    AND transaction_id = txid_current();
END;
$$;

CREATE FUNCTION public.has_account_write_capability()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.role() = 'service_role'
    AND EXISTS (
      SELECT 1
      FROM public.account_deletion_write_capabilities AS capability
      WHERE capability.backend_pid = pg_backend_pid()
        AND capability.transaction_id = txid_current()
    );
$$;

REVOKE ALL ON FUNCTION public.lock_account_write_scope(UUID[], BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_write_scope_has_pending(UUID[], BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_account_write_open(UUID[], BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.open_trusted_account_write_capability(UUID[], BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.open_account_deletion_write_capability(UUID, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_account_write_capability(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_account_write_capability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_account_deletion_write_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
  v_include_relationships BOOLEAN := TG_ARGV[0]::BOOLEAN;
BEGIN
  -- Migrations, FK cascades, and owner maintenance do not carry a JWT role.
  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_role = 'service_role' THEN
    IF public.has_account_write_capability() THEN
      RETURN NULL;
    END IF;
    -- The Storage service removes media in its own transaction between the v2
    -- marker and relational cleanup, so it cannot carry the SQL capability.
    -- Let only DELETE reach the row gate, which proves the exact marker phase,
    -- expected record, and owner before admitting that single object.
    IF TG_OP = 'DELETE'
      AND TG_TABLE_SCHEMA = 'storage'
      AND TG_TABLE_NAME = 'objects'
    THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  IF v_role IS DISTINCT FROM 'authenticated'
    OR v_uid IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  -- 074 deliberately drains pre-marker Storage writes with
  -- `LOCK TABLE storage.objects IN SHARE MODE`.  PostgreSQL acquires the
  -- writer's ROW EXCLUSIVE relation lock before this statement trigger runs;
  -- taking 15013 here would invert deletion's advisory -> relation order.
  -- Keep 074's relation-level serialization for authenticated Storage writes,
  -- then let the row gate reject every committed owner/partner marker.  The
  -- service-role branch above remains capability-only.
  IF TG_TABLE_SCHEMA = 'storage'
    AND TG_TABLE_NAME = 'objects'
  THEN
    RETURN NULL;
  END IF;

  -- Do not raise here: the row gate must be able to admit only the exact
  -- privacy/authority reductions below.  The xact locks stay held either way.
  PERFORM public.lock_account_write_scope(
    ARRAY[v_uid]::UUID[],
    v_include_relationships
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.enforce_account_deletion_write_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
  v_include_relationships BOOLEAN := TG_ARGV[0]::BOOLEAN;
BEGIN
  IF v_role IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_role = 'service_role' THEN
    IF public.has_account_write_capability() THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
      AND TG_TABLE_SCHEMA = 'storage'
      AND TG_TABLE_NAME = 'objects'
    THEN
      IF OLD.bucket_id = 'couple-media' THEN
        PERFORM 1
        FROM public.account_deletion_requests AS deletion
        JOIN public.daily_records AS record
          ON record.user_id = deletion.user_id
         AND record.id = ANY(deletion.expected_record_ids)
        WHERE deletion.phase = 'media_cleanup'
          AND deletion.cancellation_allowed = true
          AND deletion.attempt_id IS NOT NULL
          AND record.id::TEXT = (storage.foldername(OLD.name))[2]
          AND record.couple_id::TEXT = (storage.foldername(OLD.name))[1]
        FOR SHARE OF deletion;
        IF FOUND THEN
          RETURN OLD;
        END IF;
      END IF;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  IF v_role IS DISTINCT FROM 'authenticated'
    OR v_uid IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  IF NOT public.account_write_scope_has_pending(
    ARRAY[v_uid]::UUID[],
    v_include_relationships
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Deletion is fenced too.  Only two owner-controlled teardown paths remain:
  -- removing media attached to the caller's own exact record, and revoking the
  -- caller's own push token.  Every other DELETE waits at the same statement
  -- boundary and is rejected once a marker is visible.
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_SCHEMA = 'storage'
      AND TG_TABLE_NAME = 'objects'
    THEN
      IF OLD.bucket_id = 'couple-media'
        AND EXISTS (
          SELECT 1
          FROM public.daily_records AS record
          WHERE record.id::TEXT = (storage.foldername(OLD.name))[2]
            AND record.couple_id::TEXT = (storage.foldername(OLD.name))[1]
            AND record.user_id = v_uid
        )
      THEN
        RETURN OLD;
      END IF;
    END IF;

    IF TG_TABLE_SCHEMA = 'public'
      AND TG_TABLE_NAME = 'device_push_tokens'
    THEN
      IF OLD.user_id = v_uid THEN
        RETURN OLD;
      END IF;
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'account_deletion_pending';
  END IF;

  -- Revoking sensitive consent may update only revoked_at.  Migration 070's
  -- later alphabetic trigger owns revision/updated_at.
  IF TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'user_sensitive_consents'
  THEN
    IF TG_OP = 'INSERT'
      AND NEW.user_id = v_uid
      AND NEW.consent_type = 'cycle'
      AND NEW.version = '2026-08-09'
      AND NEW.revision = 1
      AND NEW.revoked_at IS NOT NULL
    THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD.user_id = v_uid
      AND NEW.user_id = v_uid
      AND NEW.revoked_at IS NOT NULL
      AND (
        OLD.revoked_at IS NULL
        OR NEW.revoked_at >= OLD.revoked_at
      )
      AND (
        to_jsonb(NEW) - ARRAY['revoked_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['revoked_at']
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Sharing may only converge to all-off; updated_at is non-authority metadata.
  IF TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'cycle_sharing_preferences'
  THEN
    IF NEW.user_id = v_uid
      AND NEW.share_current_period = false
      AND NEW.share_prediction_window = false
      AND NEW.share_fertility_window = false
    THEN
      IF TG_OP = 'INSERT' THEN
        RETURN NEW;
      END IF;
      IF TG_OP = 'UPDATE'
        AND OLD.user_id = v_uid
        AND (
          to_jsonb(NEW) - ARRAY[
            'share_current_period',
            'share_prediction_window',
            'share_fertility_window',
            'updated_at'
          ]
        ) IS NOT DISTINCT FROM (
          to_jsonb(OLD) - ARRAY[
            'share_current_period',
            'share_prediction_window',
            'share_fertility_window',
            'updated_at'
          ]
        )
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- A user may retire or fail only their own device, without smuggling an
  -- encrypted label or any other field change into the same statement.
  IF TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'devices'
  THEN
    IF TG_OP = 'UPDATE'
      AND OLD.user_id = v_uid
      AND NEW.user_id = v_uid
      AND NEW.status IN ('REVOKED', 'PROVISIONING_FAILED')
      AND (
        to_jsonb(NEW) - ARRAY['status', 'revoked_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'revoked_at']
      )
      AND (
        (NEW.status = 'REVOKED' AND NEW.revoked_at IS NOT NULL)
        OR (
          NEW.status = 'PROVISIONING_FAILED'
          AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at
        )
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- PREPARING/READY -> ABANDONED is terminal and cannot grant key authority.
  IF TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'scope_keys'
  THEN
    IF TG_OP = 'UPDATE'
      AND OLD.state IN ('PREPARING', 'READY')
      AND NEW.state = 'ABANDONED'
      AND (
        (OLD.owner_user_id = v_uid AND OLD.domain IN ('personal', 'health'))
        OR (
          OLD.domain = 'couple'
          AND OLD.owner_couple_id = public.get_my_active_couple_id()
        )
      )
      AND (
        to_jsonb(NEW) - ARRAY['state']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['state']
      )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- The existing append-only revocation contract validates cryptographic
  -- evidence and ordering.  Appending one's own statement only removes trust.
  IF TG_TABLE_SCHEMA = 'public'
    AND TG_TABLE_NAME = 'revocation_statements'
  THEN
    IF TG_OP = 'INSERT'
      AND NEW.user_id = v_uid
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = 'account_deletion_pending';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_account_deletion_write_statement()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_account_deletion_write_row()
  FROM PUBLIC, anon, authenticated, service_role;

-- false = personal owner scope; true = active relationship participants too.
DO $triggers$
DECLARE
  v_target RECORD;
BEGIN
  FOR v_target IN
    SELECT *
    FROM (VALUES
      ('public', 'profiles', false),
      ('public', 'contact_preferences', false),
      ('public', 'product_events', false),
      ('public', 'cycle_periods', false),
      ('public', 'cycle_daily_logs', false),
      ('public', 'cycle_settings', false),
      ('public', 'cycle_entries', false),
      -- 022 created this without a foreign key; 027's deletion pipeline is
      -- its only lifecycle cleanup, so service writes need the same fence.
      ('public', 'legacy_cycle_entries_backup', false),
      ('public', 'user_sensitive_consents', false),
      ('public', 'cycle_sharing_preferences', false),
      ('public', 'cycle_support_signals', true),
      ('public', 'device_push_tokens', false),
      ('public', 'push_delivery_state', true),
      ('public', 'recovery_identities', false),
      ('public', 'recovery_public_anchors', false),
      ('public', 'devices', false),
      ('public', 'device_certificates', false),
      ('public', 'device_enrollments', false),
      ('public', 'recovery_challenges', false),
      ('public', 'revocation_statements', false),
      ('public', 'migration_ledger', true),
      ('public', 'scope_keys', true),
      ('public', 'key_envelopes', true),
      ('public', 'crypto_write_floor', true),
      ('public', 'couples', true),
      ('public', 'couple_members', true),
      ('public', 'invitation_codes', true),
      ('public', 'invitation_attempts', true),
      ('public', 'daily_records', true),
      ('public', 'briefings', true),
      ('public', 'events', true),
      ('public', 'trips', true),
      ('public', 'trip_items', true),
      ('public', 'trip_checklists', true),
      ('public', 'couple_tasks', true),
      ('public', 'talk_about_marks', true),
      ('public', 'collaboration_invalidations', true),
      ('public', 'crypto_pairings', true),
      ('public', 'diary_pages', true),
      ('public', 'couple_highlights', true),
      ('public', 'couple_highlight_items', true),
      ('storage', 'objects', true)
    ) AS target(schema_name, table_name, include_relationships)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER aaa_076_account_write_statement '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON %I.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION '
      || 'public.enforce_account_deletion_write_statement(%L)',
      v_target.schema_name,
      v_target.table_name,
      v_target.include_relationships::TEXT
    );
    EXECUTE format(
      'CREATE TRIGGER aaa_076_account_write_row '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON %I.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION '
      || 'public.enforce_account_deletion_write_row(%L)',
      v_target.schema_name,
      v_target.table_name,
      v_target.include_relationships::TEXT
    );
  END LOOP;
END
$triggers$;

-- ---------------------------------------------------------------------------
-- Authenticated RPCs that lock child rows before their first DML statement.
-- Their reviewed implementations are renamed, made private, and called only
-- through a wrapper that acquires the account boundary first.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.reorder_trip_items(UUID[], INTEGER[])
  RENAME TO reorder_trip_items_internal_076;
REVOKE ALL ON FUNCTION public.reorder_trip_items_internal_076(UUID[], INTEGER[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reorder_trip_items(
  p_item_ids UUID[],
  p_sort_orders INTEGER[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  PERFORM public.reorder_trip_items_internal_076(
    p_item_ids,
    p_sort_orders
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[])
  TO authenticated;

ALTER FUNCTION public.save_couple_highlight(UUID, TEXT, UUID[], INTEGER)
  RENAME TO save_couple_highlight_internal_076;
REVOKE ALL ON FUNCTION public.save_couple_highlight_internal_076(UUID, TEXT, UUID[], INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.save_couple_highlight(
  p_highlight_id UUID,
  p_title TEXT,
  p_record_ids UUID[],
  p_sort_order INTEGER
)
RETURNS public.couple_highlights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result public.couple_highlights;
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  v_result := public.save_couple_highlight_internal_076(
    p_highlight_id,
    p_title,
    p_record_ids,
    p_sort_order
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_couple_highlight(UUID, TEXT, UUID[], INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_couple_highlight(UUID, TEXT, UUID[], INTEGER)
  TO authenticated;

ALTER FUNCTION public.set_partner_username(TEXT)
  RENAME TO set_partner_username_internal_076;
REVOKE ALL ON FUNCTION public.set_partner_username_internal_076(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.set_partner_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.set_partner_username_internal_076(p_username);
END;
$$;
REVOKE ALL ON FUNCTION public.set_partner_username(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_partner_username(TEXT)
  TO authenticated;

ALTER FUNCTION public.register_push_token(TEXT, TEXT)
  RENAME TO register_push_token_internal_076;
REVOKE ALL ON FUNCTION public.register_push_token_internal_076(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_push_token(
  p_platform TEXT,
  p_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      false
    );
  END IF;
  PERFORM public.register_push_token_internal_076(
    p_platform,
    p_token
  );
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT)
  TO authenticated;

ALTER FUNCTION public.clear_my_unseen()
  RENAME TO clear_my_unseen_internal_076;
REVOKE ALL ON FUNCTION public.clear_my_unseen_internal_076()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.clear_my_unseen()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  PERFORM public.clear_my_unseen_internal_076();
END;
$$;
REVOKE ALL ON FUNCTION public.clear_my_unseen()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_my_unseen()
  TO authenticated;

ALTER FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT)
  RENAME TO grant_cycle_sensitive_consent_internal_076;
REVOKE ALL ON FUNCTION public.grant_cycle_sensitive_consent_internal_076(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.grant_cycle_sensitive_consent(
  p_expected_user_id UUID,
  p_expected_revision BIGINT,
  p_version TEXT
)
RETURNS TABLE (
  applied BOOLEAN,
  granted BOOLEAN,
  revision BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      false
    );

    -- Keep 070's public contract visible at the outer boundary as well as in
    -- the private implementation.  The account advisory lock is already held,
    -- so this relation lock cannot recreate the old lock-order inversion.
    LOCK TABLE public.account_deletion_requests IN SHARE MODE;
    IF public.is_my_account_deletion_pending() THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'account_deletion_pending';
    END IF;
  END IF;
  RETURN QUERY
  SELECT *
  FROM public.grant_cycle_sensitive_consent_internal_076(
    p_expected_user_id,
    p_expected_revision,
    p_version
  );
END;
$$;
REVOKE ALL ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_cycle_sensitive_consent(UUID, BIGINT, TEXT)
  TO authenticated;

ALTER FUNCTION public.e2ee_start_couple_pairing(
  UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ
)
  RENAME TO e2ee_start_couple_pairing_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_start_couple_pairing_internal_076(
  UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_start_couple_pairing(
  p_couple_id UUID,
  p_pairing_nonce BYTEA,
  p_transcript BYTEA,
  p_transcript_hash BYTEA,
  p_created_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.e2ee_start_couple_pairing_internal_076(
    p_couple_id,
    p_pairing_nonce,
    p_transcript,
    p_transcript_hash,
    p_created_at,
    p_expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_start_couple_pairing(
  UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_start_couple_pairing(
  UUID, BYTEA, BYTEA, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ
)
  TO authenticated;

ALTER FUNCTION public.e2ee_confirm_couple_pairing(UUID, UUID, BYTEA)
  RENAME TO e2ee_confirm_couple_pairing_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_confirm_couple_pairing_internal_076(UUID, UUID, BYTEA)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_confirm_couple_pairing(
  p_pairing_id UUID,
  p_device_id UUID,
  p_signature BYTEA
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.e2ee_confirm_couple_pairing_internal_076(
    p_pairing_id,
    p_device_id,
    p_signature
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_confirm_couple_pairing(UUID, UUID, BYTEA)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_confirm_couple_pairing(UUID, UUID, BYTEA)
  TO authenticated;

ALTER FUNCTION public.e2ee_mark_couple_pairing_active(UUID, UUID)
  RENAME TO e2ee_mark_couple_pairing_active_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_mark_couple_pairing_active_internal_076(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_mark_couple_pairing_active(
  p_pairing_id UUID,
  p_scope_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  PERFORM public.e2ee_mark_couple_pairing_active_internal_076(
    p_pairing_id,
    p_scope_key_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_mark_couple_pairing_active(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_couple_pairing_active(UUID, UUID)
  TO authenticated;

ALTER FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID)
  RENAME TO activate_e2ee_write_floor_internal_076;
REVOKE ALL ON FUNCTION public.activate_e2ee_write_floor_internal_076(TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.activate_e2ee_write_floor(
  p_scope_kind TEXT,
  p_scope_id UUID,
  p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      p_scope_kind = 'couple'
    );
  END IF;
  RETURN public.activate_e2ee_write_floor_internal_076(
    p_scope_kind,
    p_scope_id,
    p_device_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID)
  TO authenticated;

ALTER FUNCTION public.e2ee_begin_device_provisioning(UUID)
  RENAME TO e2ee_begin_device_provisioning_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_begin_device_provisioning_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_begin_device_provisioning(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
  v_subject_user_id UUID;
  v_capability_id UUID;
  v_result TEXT;
BEGIN
  IF v_role = 'service_role' THEN
    SELECT device.user_id
    INTO v_subject_user_id
    FROM public.devices AS device
    WHERE device.id = p_device_id;

    IF v_subject_user_id IS NOT NULL THEN
      v_capability_id := public.open_trusted_account_write_capability(
        ARRAY[v_subject_user_id]::UUID[],
        true
      );
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;

  BEGIN
    v_result := public.e2ee_begin_device_provisioning_internal_076(
      p_device_id
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_capability_id IS NOT NULL THEN
      PERFORM public.close_account_write_capability(v_capability_id);
    END IF;
    RAISE;
  END;
  IF v_capability_id IS NOT NULL THEN
    PERFORM public.close_account_write_capability(v_capability_id);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_begin_device_provisioning(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_begin_device_provisioning(UUID)
  TO authenticated, service_role;

ALTER FUNCTION public.e2ee_finalize_device_provisioning(UUID)
  RENAME TO e2ee_finalize_device_provisioning_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_finalize_device_provisioning_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_finalize_device_provisioning(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
  v_subject_user_id UUID;
  v_capability_id UUID;
  v_result TEXT;
BEGIN
  IF v_role = 'service_role' THEN
    SELECT device.user_id
    INTO v_subject_user_id
    FROM public.devices AS device
    WHERE device.id = p_device_id;

    IF v_subject_user_id IS NOT NULL THEN
      v_capability_id := public.open_trusted_account_write_capability(
        ARRAY[v_subject_user_id]::UUID[],
        true
      );
    END IF;
  ELSIF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;

  BEGIN
    v_result := public.e2ee_finalize_device_provisioning_internal_076(
      p_device_id
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_capability_id IS NOT NULL THEN
      PERFORM public.close_account_write_capability(v_capability_id);
    END IF;
    RAISE;
  END;
  IF v_capability_id IS NOT NULL THEN
    PERFORM public.close_account_write_capability(v_capability_id);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_finalize_device_provisioning(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_finalize_device_provisioning(UUID)
  TO authenticated, service_role;

ALTER FUNCTION public.e2ee_mark_epoch_ready(UUID)
  RENAME TO e2ee_mark_epoch_ready_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_mark_epoch_ready_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_mark_epoch_ready(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.e2ee_mark_epoch_ready_internal_076(
    p_scope_key_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_mark_epoch_ready(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_epoch_ready(UUID)
  TO authenticated;

ALTER FUNCTION public.e2ee_activate_epoch(UUID)
  RENAME TO e2ee_activate_epoch_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_activate_epoch_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_activate_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.assert_account_write_open(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.e2ee_activate_epoch_internal_076(
    p_scope_key_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_activate_epoch(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_activate_epoch(UUID)
  TO authenticated;

ALTER FUNCTION public.e2ee_abandon_epoch(UUID)
  RENAME TO e2ee_abandon_epoch_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_abandon_epoch_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_abandon_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.lock_account_write_scope(
      ARRAY[v_uid]::UUID[],
      true
    );
  END IF;
  RETURN public.e2ee_abandon_epoch_internal_076(
    p_scope_key_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_abandon_epoch(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_abandon_epoch(UUID)
  TO authenticated;

ALTER FUNCTION public.e2ee_revoke_own_device(UUID)
  RENAME TO e2ee_revoke_own_device_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_revoke_own_device_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_revoke_own_device(p_device_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.lock_account_write_scope(
      ARRAY[v_uid]::UUID[],
      false
    );
  END IF;
  RETURN public.e2ee_revoke_own_device_internal_076(
    p_device_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_revoke_own_device(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_revoke_own_device(UUID)
  TO authenticated;

ALTER FUNCTION public.e2ee_mark_device_provisioning_failed(UUID)
  RENAME TO e2ee_mark_device_provisioning_failed_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_mark_device_provisioning_failed_internal_076(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_mark_device_provisioning_failed(
  p_device_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.lock_account_write_scope(
      ARRAY[v_uid]::UUID[],
      false
    );
  END IF;
  RETURN public.e2ee_mark_device_provisioning_failed_internal_076(
    p_device_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_mark_device_provisioning_failed(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_device_provisioning_failed(UUID)
  TO authenticated;

ALTER FUNCTION public.revoke_my_push_tokens()
  RENAME TO revoke_my_push_tokens_internal_076;
REVOKE ALL ON FUNCTION public.revoke_my_push_tokens_internal_076()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.revoke_my_push_tokens()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL THEN
    PERFORM public.lock_account_write_scope(
      ARRAY[v_uid]::UUID[],
      false
    );
  END IF;
  PERFORM public.revoke_my_push_tokens_internal_076();
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_my_push_tokens()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_tokens()
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Reviewed service mutators.  Each capability is opened outside a nested block
-- and explicitly closed both on success and when a caller catches an error.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA,
  UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
)
  RENAME TO e2ee_commit_device_approval_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_commit_device_approval_internal_076(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA,
  UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_commit_device_approval(
  p_enrollment_id UUID,
  p_new_device_id UUID,
  p_certificate BYTEA,
  p_certificate_fp BYTEA,
  p_transcript_hash BYTEA,
  p_approval_signature BYTEA,
  p_user_id UUID,
  p_recovery_identity_id UUID,
  p_recovery_version SMALLINT,
  p_subject_sig_spki BYTEA,
  p_subject_kem_spki BYTEA,
  p_issuer_certificate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
  v_result UUID;
BEGIN
  v_capability_id := public.open_trusted_account_write_capability(
    ARRAY[p_user_id]::UUID[],
    true
  );
  BEGIN
    v_result := public.e2ee_commit_device_approval_internal_076(
      p_enrollment_id,
      p_new_device_id,
      p_certificate,
      p_certificate_fp,
      p_transcript_hash,
      p_approval_signature,
      p_user_id,
      p_recovery_identity_id,
      p_recovery_version,
      p_subject_sig_spki,
      p_subject_kem_spki,
      p_issuer_certificate_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA,
  UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_device_approval(
  UUID, UUID, BYTEA, BYTEA, BYTEA, BYTEA,
  UUID, UUID, SMALLINT, BYTEA, BYTEA, UUID
)
  TO service_role;

ALTER FUNCTION public.e2ee_issue_recovery_challenge(
  UUID, UUID, BYTEA, INTEGER
)
  RENAME TO e2ee_issue_recovery_challenge_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_issue_recovery_challenge_internal_076(
  UUID, UUID, BYTEA, INTEGER
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_issue_recovery_challenge(
  p_user_id UUID,
  p_device_id UUID,
  p_challenge BYTEA,
  p_ttl_seconds INTEGER
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  recovery_identity_id UUID,
  recovery_version SMALLINT,
  new_device_id UUID,
  challenge_nonce BYTEA,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
BEGIN
  v_capability_id := public.open_trusted_account_write_capability(
    ARRAY[p_user_id]::UUID[],
    true
  );
  BEGIN
    RETURN QUERY
    SELECT *
    FROM public.e2ee_issue_recovery_challenge_internal_076(
      p_user_id,
      p_device_id,
      p_challenge,
      p_ttl_seconds
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_issue_recovery_challenge(
  UUID, UUID, BYTEA, INTEGER
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_issue_recovery_challenge(
  UUID, UUID, BYTEA, INTEGER
)
  TO service_role;

ALTER FUNCTION public.e2ee_commit_recovery_authentication(
  UUID, UUID, UUID, SMALLINT
)
  RENAME TO e2ee_commit_recovery_authentication_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_commit_recovery_authentication_internal_076(
  UUID, UUID, UUID, SMALLINT
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_commit_recovery_authentication(
  p_challenge_id UUID,
  p_device_id UUID,
  p_recovery_identity_id UUID,
  p_recovery_version SMALLINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_capability_id UUID;
  v_result BOOLEAN;
BEGIN
  SELECT challenge.user_id
  INTO v_user_id
  FROM public.recovery_challenges AS challenge
  WHERE challenge.id = p_challenge_id;

  IF v_user_id IS NULL THEN
    RETURN public.e2ee_commit_recovery_authentication_internal_076(
      p_challenge_id,
      p_device_id,
      p_recovery_identity_id,
      p_recovery_version
    );
  END IF;

  v_capability_id := public.open_trusted_account_write_capability(
    ARRAY[v_user_id]::UUID[],
    true
  );
  BEGIN
    v_result := public.e2ee_commit_recovery_authentication_internal_076(
      p_challenge_id,
      p_device_id,
      p_recovery_identity_id,
      p_recovery_version
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_commit_recovery_authentication(
  UUID, UUID, UUID, SMALLINT
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_recovery_authentication(
  UUID, UUID, UUID, SMALLINT
)
  TO service_role;

ALTER FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID)
  RENAME TO mark_push_delivered_internal_076;
REVOKE ALL ON FUNCTION public.mark_push_delivered_internal_076(UUID, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.mark_push_delivered(
  p_user_id UUID,
  p_decided_at TIMESTAMPTZ,
  p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
BEGIN
  v_capability_id := public.open_trusted_account_write_capability(
    ARRAY[p_user_id]::UUID[],
    true
  );
  BEGIN
    PERFORM public.mark_push_delivered_internal_076(
      p_user_id,
      p_decided_at,
      p_claim_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID)
  TO service_role;

ALTER FUNCTION public.release_push_claim(UUID, UUID)
  RENAME TO release_push_claim_internal_076;
REVOKE ALL ON FUNCTION public.release_push_claim_internal_076(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.release_push_claim(
  p_user_id UUID,
  p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
BEGIN
  v_capability_id := public.open_trusted_account_write_capability(
    ARRAY[p_user_id]::UUID[],
    true
  );
  BEGIN
    PERFORM public.release_push_claim_internal_076(
      p_user_id,
      p_claim_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
END;
$$;
REVOKE ALL ON FUNCTION public.release_push_claim(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_push_claim(UUID, UUID)
  TO service_role;

-- The 066 implementation takes a push-state row lock before it knows the
-- recipient's account boundary.  Reordering only this scheduler RPC is
-- necessary to avoid child-to-participant inversion.  Eligibility is
-- revalidated after the account locks, and SKIP LOCKED remains on the claim.
ALTER FUNCTION public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER)
  RENAME TO push_delivery_candidates_internal_076;
REVOKE ALL ON FUNCTION public.push_delivery_candidates_internal_076(
  UUID, TIMESTAMPTZ, INTEGER
)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.push_delivery_candidates(
  p_claim_id UUID,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  user_id UUID,
  platform TEXT,
  token TEXT,
  decided_at TIMESTAMPTZ,
  claim_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_time TIME := (p_now AT TIME ZONE 'Asia/Seoul')::TIME;
  v_local_date DATE := (p_now AT TIME ZONE 'Asia/Seoul')::DATE;
  v_is_weekend BOOLEAN :=
    EXTRACT(ISODOW FROM (p_now AT TIME ZONE 'Asia/Seoul')) >= 6;
  v_lease_until TIMESTAMPTZ;
  v_user_id UUID;
  v_claimed_user_id UUID;
  v_capability_id UUID;
  v_message TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION 'claim_id is required'
      USING ERRCODE = '22004';
  END IF;
  IF p_lease_seconds IS NULL
    OR p_lease_seconds <= 0
    OR p_lease_seconds > 3600
  THEN
    RAISE EXCEPTION 'lease_seconds must be between 1 and 3600'
      USING ERRCODE = '22023';
  END IF;

  v_lease_until :=
    p_now + (p_lease_seconds || ' seconds')::INTERVAL;

  FOR v_user_id IN
    SELECT state.user_id
    FROM public.push_delivery_state AS state
    LEFT JOIN public.contact_preferences AS preference
      ON preference.user_id = state.user_id
    WHERE state.has_unseen IS TRUE
      AND (
        state.last_notified_at IS NULL
        OR (
          state.last_notified_at AT TIME ZONE 'Asia/Seoul'
        )::DATE < v_local_date
      )
      AND (
        state.claimed_until IS NULL
        OR state.claimed_until < p_now
      )
      AND v_local_time >= COALESCE(
        CASE
          WHEN v_is_weekend THEN preference.weekend_start
          ELSE preference.weekday_start
        END,
        CASE
          WHEN v_is_weekend THEN TIME '12:00'
          ELSE TIME '18:00'
        END
      )
      AND v_local_time <= COALESCE(
        CASE
          WHEN v_is_weekend THEN preference.weekend_end
          ELSE preference.weekday_end
        END,
        TIME '21:00'
      )
      AND EXISTS (
        SELECT 1
        FROM public.couple_members AS member
        WHERE member.user_id = state.user_id
          AND member.status = 'active'
      )
      AND EXISTS (
        SELECT 1
        FROM public.device_push_tokens AS push_token
        WHERE push_token.user_id = state.user_id
      )
    ORDER BY state.user_id
  LOOP
    BEGIN
      v_capability_id :=
        public.open_trusted_account_write_capability(
          ARRAY[v_user_id]::UUID[],
          true
        );
    EXCEPTION WHEN SQLSTATE '42501' THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message = 'account_deletion_pending' THEN
        CONTINUE;
      END IF;
      RAISE;
    END;

    BEGIN
      v_claimed_user_id := NULL;
      WITH eligible_recipient AS (
        SELECT state.user_id
        FROM public.push_delivery_state AS state
        LEFT JOIN public.contact_preferences AS preference
          ON preference.user_id = state.user_id
        WHERE state.user_id = v_user_id
          AND state.has_unseen IS TRUE
          AND (
            state.last_notified_at IS NULL
            OR (
              state.last_notified_at AT TIME ZONE 'Asia/Seoul'
            )::DATE < v_local_date
          )
          AND (
            state.claimed_until IS NULL
            OR state.claimed_until < p_now
          )
          AND v_local_time >= COALESCE(
            CASE
              WHEN v_is_weekend THEN preference.weekend_start
              ELSE preference.weekday_start
            END,
            CASE
              WHEN v_is_weekend THEN TIME '12:00'
              ELSE TIME '18:00'
            END
          )
          AND v_local_time <= COALESCE(
            CASE
              WHEN v_is_weekend THEN preference.weekend_end
              ELSE preference.weekday_end
            END,
            TIME '21:00'
          )
          AND EXISTS (
            SELECT 1
            FROM public.couple_members AS member
            WHERE member.user_id = state.user_id
              AND member.status = 'active'
          )
          AND EXISTS (
            SELECT 1
            FROM public.device_push_tokens AS push_token
            WHERE push_token.user_id = state.user_id
          )
        FOR UPDATE OF state SKIP LOCKED
      ),
      claimed AS (
        UPDATE public.push_delivery_state AS state
        SET claim_id = p_claim_id,
            claimed_at = p_now,
            claimed_until = v_lease_until
        FROM eligible_recipient AS eligible
        WHERE state.user_id = eligible.user_id
        RETURNING state.user_id
      )
      SELECT claimed.user_id
      INTO v_claimed_user_id
      FROM claimed;

      IF v_claimed_user_id IS NOT NULL THEN
        RETURN QUERY
        SELECT
          push_token.user_id,
          push_token.platform,
          push_token.token,
          p_now,
          p_claim_id
        FROM public.device_push_tokens AS push_token
        WHERE push_token.user_id = v_claimed_user_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.close_account_write_capability(v_capability_id);
      RAISE;
    END;

    PERFORM public.close_account_write_capability(v_capability_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(
  UUID, TIMESTAMPTZ, INTEGER
)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_delivery_candidates(
  UUID, TIMESTAMPTZ, INTEGER
)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Exact account-deletion v2 phases.  begin/cancel stay as 074 defined them:
-- begin creates the marker under 15013; cancel removes only the matching
-- cancellable media_cleanup attempt.  Child cleanup phases alone receive the
-- private capability.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID)
  RENAME TO e2ee_prepare_account_deletion_v2_internal_076;
REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion_v2_internal_076(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.e2ee_prepare_account_deletion_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
  v_result JSONB;
BEGIN
  v_capability_id :=
    public.open_account_deletion_write_capability(
      p_user_id,
      p_attempt_id,
      ARRAY[
        'media_cleanup',
        'e2ee_prepared',
        'relational_prepared',
        'relationships_closed',
        'solo_cleanup_complete'
      ]::TEXT[]
    );
  BEGIN
    v_result :=
      public.e2ee_prepare_account_deletion_v2_internal_076(
        p_user_id,
        p_attempt_id
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion_v2(UUID, UUID)
  TO service_role;

ALTER FUNCTION public.prepare_account_deletion_v2(UUID, UUID[], UUID)
  RENAME TO prepare_account_deletion_v2_internal_076;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_v2_internal_076(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_account_deletion_v2(
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
  v_capability_id UUID;
  v_result JSONB;
BEGIN
  v_capability_id :=
    public.open_account_deletion_write_capability(
      p_user_id,
      p_attempt_id,
      ARRAY[
        'e2ee_prepared',
        'relational_prepared',
        'relationships_closed',
        'solo_cleanup_complete'
      ]::TEXT[]
    );
  BEGIN
    v_result :=
      public.prepare_account_deletion_v2_internal_076(
        p_user_id,
        p_expected_record_ids,
        p_attempt_id
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_v2(UUID, UUID[], UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion_v2(UUID, UUID[], UUID)
  TO service_role;

ALTER FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  RENAME TO close_account_relationship_generations_v2_internal_076;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2_internal_076(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.close_account_relationship_generations_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
  v_result JSONB;
BEGIN
  v_capability_id :=
    public.open_account_deletion_write_capability(
      p_user_id,
      p_attempt_id,
      ARRAY[
        'relational_prepared',
        'relationships_closed',
        'solo_cleanup_complete'
      ]::TEXT[]
    );
  BEGIN
    v_result :=
      public.close_account_relationship_generations_v2_internal_076(
        p_user_id,
        p_attempt_id
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_account_relationship_generations_v2(UUID, UUID)
  TO service_role;

ALTER FUNCTION public.cleanup_account_solo_couples_v2(UUID, UUID)
  RENAME TO cleanup_account_solo_couples_v2_internal_076;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples_v2_internal_076(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cleanup_account_solo_couples_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capability_id UUID;
  v_result JSONB;
BEGIN
  v_capability_id :=
    public.open_account_deletion_write_capability(
      p_user_id,
      p_attempt_id,
      ARRAY[
        'relationships_closed',
        'solo_cleanup_complete'
      ]::TEXT[]
    );
  BEGIN
    v_result :=
      public.cleanup_account_solo_couples_v2_internal_076(
        p_user_id,
        p_attempt_id
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.close_account_write_capability(v_capability_id);
    RAISE;
  END;
  PERFORM public.close_account_write_capability(v_capability_id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_account_solo_couples_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_account_solo_couples_v2(UUID, UUID)
  TO service_role;

COMMIT;

-- PostgREST listens transactionally, so emit only after the DDL commit.
NOTIFY pgrst, 'reload schema';
