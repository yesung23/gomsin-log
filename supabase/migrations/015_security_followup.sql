-- 015_security_followup.sql
--
-- Security and concurrency follow-up for migrations 009, 013, and 014.
-- Apply this migration before deploying the matching client and delete-account
-- Edge Function. Back up and validate in staging first.

BEGIN;

-- A six-digit code can collide across couples. Never choose one matching row:
-- keep at most one unused hash and let the unique index serialize future issue
-- and redemption transactions. Ambiguous legacy codes are all invalidated so
-- no holder can be routed to the wrong couple; their owners can regenerate.
UPDATE public.invitation_codes
SET used = true,
    used_at = COALESCE(used_at, now())
WHERE used = false
  AND expires_at <= now();

WITH ambiguous_hashes AS (
  SELECT code_hash
  FROM public.invitation_codes
  WHERE used = false
  GROUP BY code_hash
  HAVING count(*) > 1
)
UPDATE public.invitation_codes AS invitation
SET used = true,
    used_at = COALESCE(invitation.used_at, now())
FROM ambiguous_hashes
WHERE invitation.code_hash = ambiguous_hashes.code_hash
  AND invitation.used = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_codes_one_unused_hash
  ON public.invitation_codes (code_hash)
  WHERE used = false;

-- Couple creation participates in the same unused-hash uniqueness invariant.
-- A conflicting issuance raises and rolls the whole atomic creation back.
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
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_role NOT IN ('gomsin', 'soldier') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE user_id = v_uid AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'User already in an active couple';
  END IF;

  -- Expired rows no longer reserve their hash. The partial unique index then
  -- arbitrates concurrent issuance without a cross-topology advisory lock.
  UPDATE public.invitation_codes
  SET used = true, used_at = now()
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at <= now();

  INSERT INTO public.couples DEFAULT VALUES RETURNING id INTO v_couple_id;
  INSERT INTO public.couple_members (couple_id, user_id, role, status)
  VALUES (v_couple_id, v_uid, p_role, 'active');
  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);
  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_couple_and_invitation(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Invitation redemption: one authenticated JSONB API, durable failures
-- ---------------------------------------------------------------------------
-- The old wrapper re-raised after writing invitation_attempts, which rolled the
-- write back with the RPC statement. Expected failures now return stable codes
-- so their ledger rows commit. A per-user advisory lock makes the throttle
-- check and attempt write one serialized operation.
DROP FUNCTION IF EXISTS public.redeem_invitation(TEXT);

CREATE FUNCTION public.redeem_invitation(p_code_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_invite RECORD;
  v_active_count INTEGER;
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

  -- Hash collisions only serialize extra callers; they cannot weaken safety.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 15013));

  BEGIN
    SELECT
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > now() - INTERVAL '10 minutes'
      ),
      count(*) FILTER (
        WHERE succeeded = false
          AND attempted_at > now() - INTERVAL '24 hours'
      )
    INTO v_recent_failures, v_daily_failures
    FROM public.invitation_attempts
    WHERE user_id = v_uid
      AND attempted_at > now() - INTERVAL '24 hours';

    IF v_recent_failures >= 5 OR v_daily_failures >= 20 THEN
      v_error_code := 'rate_limited';
    ELSIF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
      v_error_code := 'invalid_request';
    ELSIF EXISTS (
      SELECT 1
      FROM public.couple_members
      WHERE user_id = v_uid
        AND status = 'active'
    ) THEN
      v_error_code := 'already_connected';
    ELSE
      -- Read only enough to discover the topology lock. The invitation is
      -- revalidated and consumed only after its parent couple row is locked.
      SELECT id, couple_id, created_by
      INTO v_invite
      FROM public.invitation_codes
      WHERE code_hash = p_code_hash
        AND used = false
        AND expires_at > now();

      IF v_invite IS NULL THEN
        v_error_code := 'invalid_or_expired';
      ELSIF v_invite.created_by = v_uid THEN
        v_error_code := 'self_invitation';
      ELSE
        PERFORM 1
        FROM public.couples
        WHERE id = v_invite.couple_id
        FOR UPDATE;

        -- Revalidate caller and invitation after waiting for the canonical
        -- parent lock. All membership changes happen below this lock.
        IF EXISTS (
          SELECT 1
          FROM public.couple_members
          WHERE user_id = v_uid
            AND status = 'active'
        ) THEN
          v_error_code := 'already_connected';
        ELSE
          SELECT count(*), min(role)
          INTO v_active_count, v_inviter_role
          FROM public.couple_members
          WHERE couple_id = v_invite.couple_id
            AND status = 'active';

          IF v_active_count >= 2 THEN
            v_error_code := 'couple_full';
          ELSIF v_active_count <> 1
            OR v_inviter_role NOT IN ('gomsin', 'soldier')
          THEN
            v_error_code := 'invalid_or_expired';
          ELSE
            UPDATE public.invitation_codes
            SET used = true,
                used_by = v_uid,
                used_at = now()
            WHERE id = v_invite.id
              AND used = false
              AND expires_at > now()
              AND created_by <> v_uid;

            IF NOT FOUND THEN
              v_error_code := 'invalid_or_expired';
            ELSE
              v_invitee_role := CASE v_inviter_role
                WHEN 'soldier' THEN 'gomsin'
                ELSE 'soldier'
              END;

              INSERT INTO public.couple_members (couple_id, user_id, role, status)
              VALUES (v_invite.couple_id, v_uid, v_invitee_role, 'active')
              ON CONFLICT (couple_id, user_id)
              DO UPDATE SET status = 'active', role = EXCLUDED.role;

              UPDATE public.couples
              SET updated_at = now()
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
    -- A concurrent active-membership insert is an expected closed failure.
    v_error_code := CASE
      WHEN EXISTS (
        SELECT 1 FROM public.couple_members
        WHERE user_id = v_uid AND status = 'active'
      ) THEN 'already_connected'
      ELSE 'couple_full'
    END;
  WHEN OTHERS THEN
    -- The subtransaction rolls back partial redemption work. Do not re-raise:
    -- the failure ledger insert below must commit with the stable response.
    v_error_code := 'internal_error';
  END;

  INSERT INTO public.invitation_attempts (user_id, succeeded)
  VALUES (v_uid, false);

  RETURN jsonb_build_object(
    'ok', false,
    'couple_id', NULL,
    'error_code', COALESCE(v_error_code, 'internal_error')
  );
END;
$$;

COMMENT ON FUNCTION public.redeem_invitation(TEXT) IS
  'Authenticated invitation redemption API. Returns {ok,couple_id,error_code}; expected failures are logged and never raised.';

REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- Bare consumption remains for migration compatibility but is no longer a
-- client API. This explicit revoke closes grants made by earlier migrations.
REVOKE ALL ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_invitation(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.consume_invitation(TEXT) FROM authenticated;

-- Regeneration uses the same parent-couple-first lock topology as redemption.
CREATE OR REPLACE FUNCTION public.regenerate_invitation(p_code_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_active_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation code hash';
  END IF;

  SELECT couple_id
  INTO v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active'
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;

  -- Membership may have changed while waiting for the parent row.
  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active couple to invite to';
  END IF;

  SELECT count(*)
  INTO v_active_count
  FROM public.couple_members
  WHERE couple_id = v_couple_id
    AND status = 'active';

  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'Couple space is already connected';
  END IF;

  UPDATE public.invitation_codes
  SET used = true, used_at = now()
  WHERE code_hash = p_code_hash
    AND used = false
    AND expires_at <= now();

  UPDATE public.invitation_codes
  SET used = true, used_at = now()
  WHERE couple_id = v_couple_id
    AND used = false;

  INSERT INTO public.invitation_codes (couple_id, code_hash, created_by)
  VALUES (v_couple_id, p_code_hash, v_uid);

  RETURN v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regenerate_invitation(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.regenerate_invitation(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_invitation(TEXT) TO authenticated;

-- Symmetric disconnect also takes the couple topology lock before any member.
CREATE OR REPLACE FUNCTION public.disconnect_couple()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT couple_id
  INTO v_couple_id
  FROM public.couple_members
  WHERE user_id = v_uid
    AND status = 'active'
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  UPDATE public.couple_members
  SET status = 'disconnected'
  WHERE couple_id = v_couple_id
    AND status = 'active';

  UPDATE public.couples SET updated_at = now() WHERE id = v_couple_id;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_couple() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disconnect_couple() FROM anon;
REVOKE ALL ON FUNCTION public.disconnect_couple() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Controlled account-deletion database preparation
-- ---------------------------------------------------------------------------
-- Identity is immutable for authenticated clients. The only exception is a
-- service-role RPC with both a role check and a transaction-local capability.
CREATE OR REPLACE FUNCTION public.enforce_event_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transfer_allowed BOOLEAN := COALESCE(
    auth.role() = 'service_role'
    AND current_setting('app.plan_ownership_transfer', true) = 'on',
    false
  );
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR (
      NEW.created_by IS DISTINCT FROM OLD.created_by
      AND NOT v_transfer_allowed
    )
  THEN
    RAISE EXCEPTION 'Event identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_event_identity_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_event_identity_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_event_identity_immutable() FROM authenticated;

CREATE OR REPLACE FUNCTION public.enforce_trip_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transfer_allowed BOOLEAN := COALESCE(
    auth.role() = 'service_role'
    AND current_setting('app.plan_ownership_transfer', true) = 'on',
    false
  );
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR (
      NEW.created_by IS DISTINCT FROM OLD.created_by
      AND NOT v_transfer_allowed
    )
  THEN
    RAISE EXCEPTION 'Trip identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_trip_identity_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_trip_identity_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_trip_identity_immutable() FROM authenticated;

DROP TRIGGER IF EXISTS enforce_trip_identity_immutable ON public.trips;
CREATE TRIGGER enforce_trip_identity_immutable
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_identity_immutable();

DROP POLICY IF EXISTS "Active members can insert trips" ON public.trips;
CREATE POLICY "Active members can insert trips"
  ON public.trips FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

-- A non-destructive pending marker closes the Storage race between the final
-- empty listing and relational deletion. It is created before media cleanup,
-- blocks new client uploads, and is removed automatically with the auth user.
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expected_record_ids UUID[] NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.account_deletion_requests FROM anon;
REVOKE ALL ON TABLE public.account_deletion_requests FROM authenticated;

CREATE OR REPLACE FUNCTION public.is_my_account_deletion_pending()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.account_deletion_requests
      WHERE user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.is_my_account_deletion_pending() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_my_account_deletion_pending() FROM anon;
REVOKE ALL ON FUNCTION public.is_my_account_deletion_pending() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_account_deletion_pending() TO authenticated;

DROP POLICY IF EXISTS "Active members can insert into couple-media" ON storage.objects;
CREATE POLICY "Active members can insert into couple-media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'couple-media'
    AND NOT public.is_my_account_deletion_pending()
    AND (storage.foldername(name))[1] = public.get_my_active_couple_id()::TEXT
    AND EXISTS (
      SELECT 1 FROM public.daily_records
      WHERE id::TEXT = (storage.foldername(name))[2]
        AND user_id = auth.uid()
        AND couple_id::TEXT = (storage.foldername(name))[1]
    )
  );

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
  IF p_user_id IS NULL OR p_expected_record_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload';
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

  INSERT INTO public.account_deletion_requests (
    user_id, expected_record_ids, requested_at
  ) VALUES (
    p_user_id, p_expected_record_ids, now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET expected_record_ids = EXCLUDED.expected_record_ids,
      requested_at = EXCLUDED.requested_at;

  -- Drain metadata INSERT transactions that passed the old policy snapshot.
  -- The committed marker rejects later uploads when this brief barrier releases.
  LOCK TABLE storage.objects IN SHARE MODE;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_account_deletion(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_account_deletion(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.begin_account_deletion(UUID, UUID[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.begin_account_deletion(UUID, UUID[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion(UUID, UUID[]) TO service_role;

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
  DELETE FROM public.account_deletion_requests WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.cancel_account_deletion(UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(
  p_user_id UUID,
  p_expected_record_ids UUID[] DEFAULT '{}'::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_membership RECORD;
  v_partner_id UUID;
  v_count INTEGER;
  v_private_events INTEGER := 0;
  v_shared_events INTEGER := 0;
  v_trips INTEGER := 0;
  v_records INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_user_id IS NULL OR p_expected_record_ids IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload';
  END IF;

  PERFORM 1
  FROM public.account_deletion_requests
  WHERE user_id = p_user_id
    AND expected_record_ids @> p_expected_record_ids
    AND p_expected_record_ids @> expected_record_ids
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion was not prepared for media cleanup';
  END IF;

  -- Fail rather than delete records whose media was not part of the confirmed
  -- preflight. Arrays are compared as sets after duplicate elimination.
  IF EXISTS (
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
    EXCEPT
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
  ) OR EXISTS (
    SELECT DISTINCT id FROM unnest(p_expected_record_ids) AS expected(id)
    EXCEPT
    SELECT id FROM public.daily_records WHERE user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Account records changed during media cleanup';
  END IF;

  PERFORM set_config('app.plan_ownership_transfer', 'on', true);

  -- UUID ordering makes multi-couple deletion deterministic. Each couple row
  -- is locked before plans or membership-dependent data for that couple.
  FOR v_membership IN
    SELECT DISTINCT couple_id
    FROM public.couple_members
    WHERE user_id = p_user_id
    ORDER BY couple_id
  LOOP
    PERFORM 1
    FROM public.couples
    WHERE id = v_membership.couple_id
    FOR UPDATE;

    SELECT other.user_id
    INTO v_partner_id
    FROM public.couple_members AS other
    WHERE other.couple_id = v_membership.couple_id
      AND other.user_id <> p_user_id
    ORDER BY (other.status = 'active') DESC, other.joined_at, other.id
    LIMIT 1;

    DELETE FROM public.events
    WHERE couple_id = v_membership.couple_id
      AND created_by = p_user_id
      AND is_private = true;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_private_events := v_private_events + v_count;

    IF v_partner_id IS NOT NULL THEN
      UPDATE public.events
      SET created_by = v_partner_id,
          updated_at = now()
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id
        AND is_private = false;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_shared_events := v_shared_events + v_count;

      UPDATE public.trips
      SET created_by = v_partner_id,
          updated_at = now()
      WHERE couple_id = v_membership.couple_id
        AND created_by = p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_trips := v_trips + v_count;
    END IF;
  END LOOP;

  DELETE FROM public.invitation_codes
  WHERE created_by = p_user_id OR used_by = p_user_id;

  DELETE FROM public.briefings WHERE recipient_id = p_user_id;

  DELETE FROM public.daily_records WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_records = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'private_events_deleted', v_private_events,
    'shared_events_transferred', v_shared_events,
    'trips_transferred', v_trips,
    'records_deleted', v_records
  );
END;
$$;

COMMENT ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) IS
  'Service-role-only transactional DB preparation after media cleanup and before auth deletion.';

REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(UUID, UUID[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Do not leak private-only event activity through invalidations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_event_collaboration_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_private = true THEN
      RETURN OLD;
    END IF;
    v_couple_id := OLD.couple_id;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.is_private = true THEN
      RETURN NEW;
    END IF;
    v_couple_id := NEW.couple_id;
  ELSE
    IF OLD.is_private = true AND NEW.is_private = true THEN
      RETURN NEW;
    END IF;
    v_couple_id := NEW.couple_id;
  END IF;

  INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
  VALUES (v_couple_id, 'events', clock_timestamp())
  ON CONFLICT (couple_id, slice)
  DO UPDATE SET updated_at = EXCLUDED.updated_at;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.emit_event_collaboration_invalidation() IS
  'Emits for shared event insert/delete/update and shared/private transitions, never private-to-private activity.';

REVOKE ALL ON FUNCTION public.emit_event_collaboration_invalidation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emit_event_collaboration_invalidation() FROM anon;
REVOKE ALL ON FUNCTION public.emit_event_collaboration_invalidation() FROM authenticated;

DROP TRIGGER IF EXISTS emit_event_collaboration_invalidation ON public.events;
CREATE TRIGGER emit_event_collaboration_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.emit_event_collaboration_invalidation();

-- ---------------------------------------------------------------------------
-- 4. Trip URL and deterministic per-day ordering invariants
-- ---------------------------------------------------------------------------
UPDATE public.trip_items SET url = NULL WHERE url IS NOT NULL AND btrim(url) = '';
UPDATE public.trip_items SET url = btrim(url) WHERE url IS NOT NULL;

ALTER TABLE public.trip_items
  DROP CONSTRAINT IF EXISTS trip_items_http_url_check;
ALTER TABLE public.trip_items
  ADD CONSTRAINT trip_items_http_url_check CHECK (
    url IS NULL OR (
      char_length(url) <= 2048
      AND url ~* '^https?://[^/?#[:space:]]+([/?#][^[:space:]]*)?$'
    )
  ) NOT VALID;
-- Validation intentionally fails without discarding a legacy non-http URL.
-- Normalize such data explicitly before retrying this transactional migration.
ALTER TABLE public.trip_items VALIDATE CONSTRAINT trip_items_http_url_check;

-- Metadata-only updates must not acquire item->trip locks. Actual topology/rank
-- changes are blocked from direct table writes and reserved for parent-first
-- database paths, preventing a reorder deadlock cycle.
CREATE OR REPLACE FUNCTION public.enforce_trip_item_date_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.trip_id IS NOT DISTINCT FROM OLD.trip_id
    AND NEW.item_date IS NOT DISTINCT FROM OLD.item_date
  THEN
    RETURN NEW;
  END IF;

  SELECT start_date, end_date
  INTO v_start_date, v_end_date
  FROM public.trips
  WHERE id = NEW.trip_id
  FOR UPDATE;

  IF v_start_date IS NULL OR NEW.item_date < v_start_date OR NEW.item_date > v_end_date THEN
    RAISE EXCEPTION 'Trip item date must be within the parent trip range';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_trip_item_date_range() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_trip_item_date_range() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_trip_item_date_range() FROM authenticated;

-- Canonicalize legacy gaps/duplicates before adding the uniqueness backstop.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY trip_id, item_date
           ORDER BY sort_order, created_at, id
         ) - 1 AS normalized_order
  FROM public.trip_items
)
UPDATE public.trip_items AS item
SET sort_order = ranked.normalized_order,
    updated_at = now()
FROM ranked
WHERE item.id = ranked.id
  AND item.sort_order IS DISTINCT FROM ranked.normalized_order;

CREATE OR REPLACE FUNCTION public.block_direct_trip_item_topology_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR NEW.item_date IS DISTINCT FROM OLD.item_date
  THEN
    RAISE EXCEPTION 'Trip item topology fields are immutable';
  END IF;
  IF NEW.sort_order IS DISTINCT FROM OLD.sort_order
    AND current_setting('app.trip_item_reorder', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Trip item order must be changed through reorder_trip_items';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.block_direct_trip_item_topology_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_direct_trip_item_topology_update() FROM anon;
REVOKE ALL ON FUNCTION public.block_direct_trip_item_topology_update() FROM authenticated;

DROP TRIGGER IF EXISTS block_direct_trip_item_topology_update ON public.trip_items;
CREATE TRIGGER block_direct_trip_item_topology_update
  BEFORE UPDATE OF trip_id, item_date, sort_order ON public.trip_items
  FOR EACH ROW EXECUTE FUNCTION public.block_direct_trip_item_topology_update();

ALTER TABLE public.trip_items
  DROP CONSTRAINT IF EXISTS trip_items_unique_day_order;
ALTER TABLE public.trip_items
  ADD CONSTRAINT trip_items_unique_day_order
  UNIQUE (trip_id, item_date, sort_order)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE OR REPLACE FUNCTION public.allocate_trip_item_append_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The parent row serializes appends and reorders for every day in a trip.
  -- This trigger deliberately ignores a client-provided insert rank.
  PERFORM 1 FROM public.trips WHERE id = NEW.trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent trip not found';
  END IF;

  SELECT COALESCE(max(sort_order), -1) + 1
  INTO NEW.sort_order
  FROM public.trip_items
  WHERE trip_id = NEW.trip_id
    AND item_date = NEW.item_date;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.allocate_trip_item_append_order() IS
  'Allocates the next per-day trip item rank while holding the parent trip lock.';

REVOKE ALL ON FUNCTION public.allocate_trip_item_append_order() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_trip_item_append_order() FROM anon;
REVOKE ALL ON FUNCTION public.allocate_trip_item_append_order() FROM authenticated;

DROP TRIGGER IF EXISTS allocate_trip_item_append_order ON public.trip_items;
CREATE TRIGGER allocate_trip_item_append_order
  BEFORE INSERT ON public.trip_items
  FOR EACH ROW EXECUTE FUNCTION public.allocate_trip_item_append_order();

CREATE OR REPLACE FUNCTION public.reorder_trip_items(
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
  v_count INTEGER;
  v_trip_id UUID;
  v_item_date DATE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_item_ids IS NULL OR p_sort_orders IS NULL
    OR cardinality(p_item_ids) = 0
    OR cardinality(p_item_ids) <> cardinality(p_sort_orders)
    OR EXISTS (SELECT 1 FROM unnest(p_item_ids) AS value WHERE value IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(p_sort_orders) AS value WHERE value IS NULL OR value < 0)
    OR (SELECT count(*) FROM unnest(p_item_ids) AS value)
       <> (SELECT count(DISTINCT value) FROM unnest(p_item_ids) AS value)
    OR (SELECT count(*) FROM unnest(p_sort_orders) AS value)
       <> (SELECT count(DISTINCT value) FROM unnest(p_sort_orders) AS value)
  THEN
    RAISE EXCEPTION 'Invalid trip item reorder payload';
  END IF;

  -- Discover, then lock, then revalidate: parent row is always first.
  SELECT count(*), min(trip_id::TEXT)::UUID, min(item_date)
  INTO v_count, v_trip_id, v_item_date
  FROM public.trip_items
  WHERE id = ANY(p_item_ids);

  IF v_count <> cardinality(p_item_ids) OR v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip items are not in the active couple workspace';
  END IF;

  PERFORM 1
  FROM public.trips
  WHERE id = v_trip_id
    AND couple_id = public.get_my_active_couple_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip items are not in the active couple workspace';
  END IF;

  PERFORM 1
  FROM public.trip_items
  WHERE id = ANY(p_item_ids)
  ORDER BY id
  FOR UPDATE;

  IF (SELECT count(*) FROM public.trip_items WHERE id = ANY(p_item_ids))
      <> cardinality(p_item_ids)
    OR EXISTS (
      SELECT 1 FROM public.trip_items
      WHERE id = ANY(p_item_ids)
        AND (trip_id <> v_trip_id OR item_date <> v_item_date)
    )
    OR EXISTS (
      SELECT 1
      FROM public.trip_items AS untouched
      WHERE untouched.trip_id = v_trip_id
        AND untouched.item_date = v_item_date
        AND NOT (untouched.id = ANY(p_item_ids))
        AND untouched.sort_order = ANY(p_sort_orders)
    )
  THEN
    RAISE EXCEPTION 'Invalid or conflicting trip item reorder payload';
  END IF;

  SET CONSTRAINTS trip_items_unique_day_order DEFERRED;
  PERFORM set_config('app.trip_item_reorder', 'on', true);
  UPDATE public.trip_items AS item
  SET sort_order = input.sort_order,
      updated_at = now()
  FROM unnest(p_item_ids, p_sort_orders) AS input(id, sort_order)
  WHERE item.id = input.id;
END;
$$;

COMMENT ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) IS
  'Atomically reorders same-day items after duplicate and untouched-rank collision validation.';

REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) FROM anon;
REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) TO authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- Rollback guidance
-- ---------------------------------------------------------------------------
-- Back up first. In one transaction: restore the couple-media INSERT policy
-- from migration 007; drop begin/cancel/prepare_account_deletion,
-- is_my_account_deletion_pending, account_deletion_requests,
-- emit_event_collaboration_invalidation, enforce_trip_identity_immutable,
-- block_direct_trip_item_topology_update, and allocate_trip_item_append_order
-- (plus their triggers); drop idx_invitation_codes_one_unused_hash,
-- trip_items_unique_day_order, and trip_items_http_url_check; restore the event
-- invalidation trigger, identity/date functions, trip insert policy, invitation
-- creation/redemption/regeneration RPCs, disconnect_couple, and
-- reorder_trip_items from migrations 009/013/014. Rank normalization and
-- invalidated ambiguous invitation codes are data changes and are not reversed.
-- Re-granting authenticated execute on consume_invitation is NOT recommended:
-- rolling back that revoke reopens the throttle bypass. Deploy the matching
-- previous client/Edge Function only after the database rollback completes.
