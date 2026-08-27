-- 066: DB-backed per-recipient atomic push claim/lease.
--
-- ## The problem
--
-- Prior to this migration, `push_delivery_candidates()` selected all recipients
-- satisfying `has_unseen IS TRUE`, the Korean-local daily cap, and contact window,
-- but acquired no row locks or lease state on `push_delivery_state`.
-- If two `send-push` invocations ran concurrently or overlapped (e.g., cron retry,
-- manual trigger during slow FCM batch), both invocations selected the identical
-- recipients before either could commit `mark_push_delivered()`. Each invocation then
-- dispatched notifications to Apple/Google FCM, violating the one-send-per-day
-- lock-screen contract (§14.3).
--
-- ## The atomic claim/lease solution
--
-- 1. Three non-content coordination columns are added to `push_delivery_state`:
--    - `claim_id UUID`: Invocation-supplied lease identifier.
--    - `claimed_at TIMESTAMPTZ`: Instant the claim was acquired.
--    - `claimed_until TIMESTAMPTZ`: Expiry instant for automatic crash recovery.
--    A CHECK constraint ensures all three are NULL (idle) or all three are set with
--    `claimed_until > claimed_at` (active lease).
--
-- 2. `push_delivery_candidates()` uses CTE row locking with `FOR UPDATE OF s SKIP LOCKED`
--    on `push_delivery_state`. Concurrent workers will atomically skip already-locked
--    or currently-leased rows (`claimed_until >= p_now`) without blocking.
--
-- 3. `mark_push_delivered()` enforces matching `p_claim_id` when updating `push_delivery_state`,
--    clearing the lease fields (`claim_id = NULL`, `claimed_at = NULL`, `claimed_until = NULL`)
--    and preserving migration-055's `p_decided_at` GREATEST boundary arithmetic and
--    `partner_has_pending_act()` reconciliation. It does not reject solely because
--    `claimed_until` passed: if no contender reclaimed the row, the original worker
--    still owns it and may safely mark after a slow FCM batch, avoiding duplicates.
--
-- 4. `release_push_claim()` releases the claim immediately when delivery to all devices
--    fails, so the recipient is immediately retried on the next scheduler run rather
--    than waiting for lease expiry.
--
-- ## Distributed at-least-once residual
--
-- External transport (FCM/APNs) and database transactions cannot form an atomic 2PC.
-- Delivery occurs first, followed by `mark_push_delivered()`. If an Edge worker
-- crashes or loses database connectivity after FCM accepts a message but before
-- `mark_push_delivered()` commits, the claim expires at `claimed_until`, leaving
-- `has_unseen = TRUE`. The subsequent scheduler run will re-select the recipient and
-- re-deliver. This at-least-once residual under crash/disconnect is unavoidable and
-- is strictly safer than at-most-once marking before delivery (which would permanently
-- swallow notifications on transient transport errors).
--
-- ## Privacy constraints
--
-- No per-notification event history table is created. No unread counters or read
-- receipts are stored. `push_delivery_state` continues to hold only own-row delivery
-- coordination state with owner-only SELECT and service_role-only mutation.

BEGIN;

-- =============================================================
-- 1. Non-content coordination columns on push_delivery_state
-- =============================================================

ALTER TABLE public.push_delivery_state
  ADD COLUMN IF NOT EXISTS claim_id UUID,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ;

ALTER TABLE public.push_delivery_state
  DROP CONSTRAINT IF EXISTS push_delivery_state_claim_coherence;

ALTER TABLE public.push_delivery_state
  ADD CONSTRAINT push_delivery_state_claim_coherence CHECK (
    (claim_id IS NULL AND claimed_at IS NULL AND claimed_until IS NULL)
    OR (claim_id IS NOT NULL AND claimed_at IS NOT NULL AND claimed_until IS NOT NULL AND claimed_until > claimed_at)
  );

COMMENT ON COLUMN public.push_delivery_state.claim_id IS
  'Invocation lease ID held by an in-flight send-push execution.';
COMMENT ON COLUMN public.push_delivery_state.claimed_at IS
  'Timestamp when the current delivery claim was granted.';
COMMENT ON COLUMN public.push_delivery_state.claimed_until IS
  'Expiry timestamp for the delivery claim lease. Expired claims are eligible for reclamation.';

-- =============================================================
-- 2. Atomic selection with row lease
-- =============================================================

DROP FUNCTION IF EXISTS public.push_delivery_candidates(TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER);

CREATE FUNCTION public.push_delivery_candidates(
  p_claim_id UUID,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (user_id UUID, platform TEXT, token TEXT, decided_at TIMESTAMPTZ, claim_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_local_time TIME := (p_now AT TIME ZONE 'Asia/Seoul')::TIME;
  v_local_date DATE := (p_now AT TIME ZONE 'Asia/Seoul')::DATE;
  v_is_weekend BOOLEAN := EXTRACT(ISODOW FROM (p_now AT TIME ZONE 'Asia/Seoul')) >= 6;
  v_lease_until TIMESTAMPTZ;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'claim_id is required';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lease_seconds must be between 1 and 3600';
  END IF;

  v_lease_until := p_now + (p_lease_seconds || ' seconds')::INTERVAL;

  RETURN QUERY
  WITH eligible_recipients AS (
    SELECT s.user_id
    FROM public.push_delivery_state s
    LEFT JOIN public.contact_preferences c ON c.user_id = s.user_id
    WHERE s.has_unseen IS TRUE
      AND (
        s.last_notified_at IS NULL
        OR (s.last_notified_at AT TIME ZONE 'Asia/Seoul')::DATE < v_local_date
      )
      AND (
        s.claimed_until IS NULL
        OR s.claimed_until < p_now
      )
      AND v_local_time >= COALESCE(
        CASE WHEN v_is_weekend THEN c.weekend_start ELSE c.weekday_start END,
        CASE WHEN v_is_weekend THEN TIME '12:00' ELSE TIME '18:00' END
      )
      AND v_local_time <= COALESCE(
        CASE WHEN v_is_weekend THEN c.weekend_end ELSE c.weekday_end END,
        TIME '21:00'
      )
      AND EXISTS (
        SELECT 1 FROM public.couple_members m
        WHERE m.user_id = s.user_id AND m.status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM public.device_push_tokens t
        WHERE t.user_id = s.user_id
      )
    FOR UPDATE OF s SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.push_delivery_state s
    SET claim_id = p_claim_id,
        claimed_at = p_now,
        claimed_until = v_lease_until
    FROM eligible_recipients er
    WHERE s.user_id = er.user_id
    RETURNING s.user_id
  )
  SELECT t.user_id, t.platform, t.token, p_now, p_claim_id
  FROM claimed c
  JOIN public.device_push_tokens t ON t.user_id = c.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_candidates(UUID, TIMESTAMPTZ, INTEGER) TO service_role;

-- =============================================================
-- 3. Recording delivery against claim and decided_at boundary
-- =============================================================

DROP FUNCTION IF EXISTS public.mark_push_delivered(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID);

CREATE FUNCTION public.mark_push_delivered(
  p_user_id UUID,
  p_decided_at TIMESTAMPTZ,
  p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple UUID;
  v_author UUID;
  v_pending BOOLEAN := FALSE;
  v_rows_updated INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'user_id is required';
  END IF;

  IF p_decided_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'decided_at is required';
  END IF;

  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'claim_id is required';
  END IF;

  UPDATE public.push_delivery_state
  SET has_unseen = FALSE,
      last_notified_at = GREATEST(
        COALESCE(push_delivery_state.last_notified_at, p_decided_at),
        p_decided_at
      ),
      notified_through = GREATEST(
        COALESCE(push_delivery_state.notified_through, p_decided_at),
        p_decided_at
      ),
      claim_id = NULL,
      claimed_at = NULL,
      claimed_until = NULL
  WHERE user_id = p_user_id
    AND claim_id = p_claim_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Delivery claim mismatch';
  END IF;

  FOR v_couple, v_author IN
    SELECT them.couple_id, them.user_id
      FROM public.couple_members me
      JOIN public.couple_members them
        ON them.couple_id = me.couple_id AND them.user_id <> me.user_id
     WHERE me.user_id = p_user_id
       AND me.status = 'active'
       AND them.status = 'active'
  LOOP
    IF public.partner_has_pending_act(v_couple, v_author, p_user_id) THEN
      v_pending := TRUE;
      EXIT;
    END IF;
  END LOOP;

  IF v_pending THEN
    UPDATE public.push_delivery_state SET has_unseen = TRUE WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ, UUID) TO service_role;

-- =============================================================
-- 4. Releasing delivery claim on failed attempt
-- =============================================================

DROP FUNCTION IF EXISTS public.release_push_claim(UUID, UUID);

CREATE FUNCTION public.release_push_claim(
  p_user_id UUID,
  p_claim_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'user_id is required';
  END IF;

  IF p_claim_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'claim_id is required';
  END IF;

  UPDATE public.push_delivery_state
  SET claim_id = NULL,
      claimed_at = NULL,
      claimed_until = NULL
  WHERE user_id = p_user_id
    AND claim_id = p_claim_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Delivery claim mismatch or not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.release_push_claim(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_push_claim(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.release_push_claim(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_push_claim(UUID, UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
