-- 048: Delivery metadata for act-only push notifications.
--
-- This migration adds the ONLY server-side state push needs, and the shape is
-- chosen so that the forbidden product is not merely unbuilt but unbuildable.
--
-- PRODUCT_V3 §14.3 (2026-08-21 revision):
--
--   * Notifications carry ACTS ONLY. Observations -- read receipts, app opens,
--     "no record for N days" -- are never delivered. ABSENCE IS NOT AN EVENT.
--     That single rule is what makes streak, nag and re-engagement notifications
--     structurally impossible rather than merely unimplemented.
--   * Delivery is driven by ONE MERGED FLAG per recipient, not an event queue.
--     There is no count anywhere: `3개` is a debt, `새로운 소식` is an invitation.
--   * At most ONE send per recipient per day.
--   * Every event kind produces the SAME single phrase, because a lock screen is
--     read over a shoulder. Someone glancing at a 생활관 bunk must not be able to
--     tell a care signal from a diary entry. This is why the payload is decided
--     on the device and the server carries no event kind at all.
--   * Send time comes from `contact_preferences` -- hours the user TYPED IN --
--     never from learned access patterns (§19).
--   * The sender has NO CONTENT ACCESS. `push_delivery_candidates()` cannot read
--     `daily_records`; it returns a user id, a platform and a token.
--
-- What this deliberately does NOT add: an event table, a notification history, a
-- delivery receipt, a per-kind template, or any column naming what happened. None
-- of those are needed to send one generic phrase once a day, and each would be a
-- surface the next feature could grow a debt counter on.

BEGIN;

-- =============================================================
-- 1. device_push_tokens
-- =============================================================
--
-- A token is device identity for delivery, not user content. It is owned by the
-- account it was registered from and by nobody else -- notably NOT by the
-- partner, who has no reason to learn how many devices someone carries.

CREATE TABLE public.device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  -- UNIQUE because APNs/FCM reissue a token to whichever install now holds it.
  -- A device handed to another person, or an app reinstalled under a second
  -- account, must MOVE the token rather than leave the previous owner able to
  -- receive that device's notifications.
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_device_push_tokens_user
  ON public.device_push_tokens (user_id);

-- SELECT only. Every write goes through `register_push_token()` below, because a
-- direct INSERT cannot express the one thing registration has to do: take the
-- token away from whoever held it last. See that function for why.
CREATE POLICY "Users read only their own push tokens"
  ON public.device_push_tokens FOR SELECT
  USING (user_id = auth.uid());

-- =============================================================
-- 2. The merged flag, in a table only its owner can read
-- =============================================================
--
-- The strategy specified these as columns on `couple_members`. Building it that
-- way and testing it proved that wrong, so it is a table instead. The reason is
-- worth stating precisely, because the column position IS the product rule here:
--
--   `couple_members` has carried this SELECT policy since migration 001 --
--       user_id = auth.uid() OR couple_id = get_my_active_couple_id()
--   -- so an active partner reads the OTHER member's row in full. It has to:
--   that is how each side learns the other exists and is still connected.
--
-- Put `has_unseen` on that row and the partner can read it. And `has_unseen` is
-- exactly "they have not been invited back yet", which is to say "they have not
-- opened it". That is a READ RECEIPT, assembled out of a column nobody meant as
-- one -- and §14.3 forbids read receipts absolutely, not by degree. RLS is
-- row-level, so no policy on that table can withhold one column from a partner
-- who is legitimately entitled to the row.
--
-- Here the flag lives on a row keyed by the person it belongs to, readable by
-- them alone. The partner has no policy that selects it, so the leak is not
-- mitigated -- it is absent.
--
-- `has_unseen` means "there is something to invite this person back for". It
-- never means "unread", because nothing here can reach the other side to say so.

CREATE TABLE public.push_delivery_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_unseen BOOLEAN NOT NULL DEFAULT FALSE,
  -- A day-boundary decision, not a behavioural record. Overwritten on the next
  -- send, read by no product surface, and never exposed to the partner (§19
  -- forbids precise timestamps as analytics).
  last_notified_at TIMESTAMPTZ
);

ALTER TABLE public.push_delivery_state ENABLE ROW LEVEL SECURITY;

-- Read-only, and only one's own. Every write goes through a function below, so
-- no client can raise its own flag or lower the partner's.
CREATE POLICY "Users read only their own delivery state"
  ON public.push_delivery_state FOR SELECT
  USING (user_id = auth.uid());

-- =============================================================
-- 3. Raising the flag, in the database rather than in the client
-- =============================================================
--
-- A trigger, so no client can forget to raise it and no client can raise it for
-- an event that did not happen.
--
-- PRIVATE RECORDS RAISE NOTHING. A `나만 보기` entry is invisible to the partner,
-- so notifying them would leak the one fact the privacy setting exists to keep:
-- that something was written at all. This is the single most important line in
-- the file.

CREATE OR REPLACE FUNCTION public.raise_partner_unseen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_private IS TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.push_delivery_state (user_id, has_unseen)
  SELECT m.user_id, TRUE
  FROM public.couple_members m
  WHERE m.couple_id = NEW.couple_id
    AND m.user_id <> NEW.user_id
    AND m.status = 'active'
  ON CONFLICT (user_id) DO UPDATE SET has_unseen = TRUE;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_daily_records_partner_unseen
  AFTER INSERT ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.raise_partner_unseen();

-- =============================================================
-- 4. Who to send to -- the sender's entire view of the world
-- =============================================================
--
-- `service_role` only. This is what the Edge Function calls, and it is the reason
-- that function can be said to have no content access: there is no join to
-- `daily_records` here, no event kind, and no count. The function literally
-- cannot learn what happened, only that someone should be invited back.
--
-- The daily cap and the contact window are enforced HERE rather than in the
-- sender, so a bug or a rewrite in the Edge Function cannot produce a second send
-- or a 03:00 delivery.

CREATE OR REPLACE FUNCTION public.push_delivery_candidates(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (user_id UUID, platform TEXT, token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- The product's calendar is Korean-local. Comparing against UTC would move the
  -- daily boundary to 09:00 KST and shift every contact window by nine hours.
  v_local_time TIME := (p_now AT TIME ZONE 'Asia/Seoul')::TIME;
  v_local_date DATE := (p_now AT TIME ZONE 'Asia/Seoul')::DATE;
  v_is_weekend BOOLEAN := EXTRACT(ISODOW FROM (p_now AT TIME ZONE 'Asia/Seoul')) >= 6;
BEGIN
  -- The grant is not the only gate. Migration 029 established this shape: a
  -- caller who somehow holds EXECUTE but is not the service role is refused in
  -- the body, so a mis-issued GRANT cannot by itself expose every couple's
  -- delivery schedule.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  RETURN QUERY
  SELECT t.user_id, t.platform, t.token
  FROM public.couple_members m
  JOIN public.push_delivery_state s ON s.user_id = m.user_id
  JOIN public.device_push_tokens t ON t.user_id = m.user_id
  LEFT JOIN public.contact_preferences c ON c.user_id = m.user_id
  -- `active` membership is still required, so an ended relationship produces no
  -- candidate even if a flag were somehow left raised.
  WHERE m.status = 'active'
    AND s.has_unseen IS TRUE
    -- At most one send per recipient per Korean-local day.
    AND (
      s.last_notified_at IS NULL
      OR (s.last_notified_at AT TIME ZONE 'Asia/Seoul')::DATE < v_local_date
    )
    -- Hours the user typed in. A member who has never set them gets the
    -- `contact_preferences` defaults from migration 001 rather than a send at an
    -- arbitrary hour, which is why this is a LEFT JOIN with COALESCE and not an
    -- inner join that would silently drop them.
    AND v_local_time >= COALESCE(
      CASE WHEN v_is_weekend THEN c.weekend_start ELSE c.weekday_start END,
      CASE WHEN v_is_weekend THEN TIME '12:00' ELSE TIME '18:00' END
    )
    AND v_local_time <= COALESCE(
      CASE WHEN v_is_weekend THEN c.weekend_end ELSE c.weekday_end END,
      TIME '21:00'
    );
END;
$$;

-- =============================================================
-- 5. Recording that a send happened
-- =============================================================
--
-- Lowering the flag and stamping the day are one statement, so a crash between
-- them cannot produce a recipient who is permanently silent or permanently
-- notified. `last_notified_at` holds a DAY BOUNDARY decision, not a behavioural
-- record: it is overwritten on the next send and is never read by any product
-- surface (§19 forbids precise timestamps as analytics).

CREATE OR REPLACE FUNCTION public.mark_push_delivered(p_user_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  INSERT INTO public.push_delivery_state (user_id, has_unseen, last_notified_at)
  VALUES (p_user_id, FALSE, p_now)
  ON CONFLICT (user_id) DO UPDATE
    SET has_unseen = FALSE, last_notified_at = p_now;
END;
$$;

-- =============================================================
-- 6. Clearing one's own flag
-- =============================================================
--
-- Someone who already opened the app should not be invited back to what they are
-- looking at. This is the ONLY flag-clearing path a client gets, it acts on the
-- caller's own row, and it is invisible to the partner -- who has no policy that
-- selects this column on someone else's membership.
--
-- This is not a read receipt. A read receipt is defined by the PARTNER learning
-- something; nothing here reaches them.

CREATE OR REPLACE FUNCTION public.clear_my_unseen()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.push_delivery_state
  SET has_unseen = FALSE
  WHERE user_id = v_uid;
END;
$$;

-- =============================================================
-- 7. Revoking tokens
-- =============================================================
--
-- §14.3 requires immediate invalidation on unlink, sign-out, account deletion and
-- account switch. Three of those are covered without new code:
--
--   * account deletion -- ON DELETE CASCADE from auth.users
--   * unlink           -- the membership stops being `active`, so §4 stops
--                         selecting it; the tokens are also dropped below
--   * account switch   -- the arriving account claims the token by UNIQUE
--
-- Sign-out is the one that needs an explicit call, because the row would
-- otherwise outlive the session that created it.

-- Registering a token, which is really TAKING it.
--
-- APNs and FCM issue a token to a device+install, and they reissue that same
-- token to whoever installs next. So a phone handed to a sibling, or an app
-- reinstalled under a second account, arrives holding a token the previous
-- account still owns a row for.
--
-- A plain INSERT cannot express this. The UNIQUE constraint would reject it, and
-- RLS forbids deleting the other account's row -- so the registration would fail,
-- the arriving account would get no notifications, and the DEPARTED account would
-- keep receiving that device's. §14.3 requires the opposite: an account switch
-- invalidates the token immediately.
--
-- Hence a function. It removes whoever held the token, then claims it for the
-- caller. Handing a device over cannot leave the previous owner listening.
CREATE OR REPLACE FUNCTION public.register_push_token(p_platform TEXT, p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Not a security boundary: the table's CHECK constraint already refuses any
  -- other platform, and a mutation test confirms it does so with this block
  -- removed. This exists so the failure names the problem instead of surfacing a
  -- constraint violation.
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Unsupported push platform' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Empty push token' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM public.device_push_tokens WHERE token = p_token;

  INSERT INTO public.device_push_tokens (user_id, platform, token)
  VALUES (v_uid, p_platform, p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_push_tokens()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.device_push_tokens WHERE user_id = v_uid;
END;
$$;

-- Unlink drops the disconnecting member's tokens outright rather than relying on
-- the `active` predicate alone. Defence in depth: a future change to §4's filter
-- must not be able to resurrect delivery to a relationship that ended.
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

  -- Serialize against a concurrent invitation or a second disconnect before
  -- changing either relationship membership or crypto authority.
  PERFORM 1 FROM public.couples WHERE id = v_couple_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_couple_id
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Active couple not found';
  END IF;

  UPDATE public.crypto_pairings
  SET state = 'UNLINKED', updated_at = now()
  WHERE couple_id = v_couple_id
    AND state IN (
      'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE',
      'CONFIRMED_BOTH', 'EPOCH_PREPARING', 'CRYPTO_ACTIVE'
    );

  -- Both sides lose delivery, and both merged flags are lowered. A flag left
  -- raised on a disconnected row would fire the moment a new relationship made
  -- that row active again.
  DELETE FROM public.device_push_tokens
  WHERE user_id IN (
    SELECT user_id FROM public.couple_members
    WHERE couple_id = v_couple_id AND status = 'active'
  );

  UPDATE public.push_delivery_state
  SET has_unseen = FALSE
  WHERE user_id IN (
    SELECT user_id FROM public.couple_members
    WHERE couple_id = v_couple_id AND status = 'active'
  );

  UPDATE public.couple_members
  SET status = 'disconnected'
  WHERE couple_id = v_couple_id
    AND status = 'active';

  UPDATE public.couples SET updated_at = now() WHERE id = v_couple_id;
END;
$$;

-- =============================================================
-- 8. Permissions
-- =============================================================

-- Table grants. RLS decides WHICH rows; without a grant the role cannot reach the
-- table at all and every denial would look like a missing privilege rather than a
-- policy decision, which is what migration 012 established for the core tables.
-- Read-only. Someone may see which of their own devices are registered; every
-- write is a function, so no client can claim a token for another account or
-- leave a departed account listening on a handed-over phone.
GRANT SELECT ON public.device_push_tokens TO authenticated;
-- Read-only by design: every write to delivery state goes through a function.
GRANT SELECT ON public.push_delivery_state TO authenticated;

REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.clear_my_unseen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_my_unseen() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_my_unseen() TO authenticated;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_my_push_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_my_push_tokens() FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_tokens() TO authenticated;

REVOKE ALL ON FUNCTION public.raise_partner_unseen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_partner_unseen() FROM anon;
REVOKE ALL ON FUNCTION public.raise_partner_unseen() FROM authenticated;

REVOKE ALL ON FUNCTION public.disconnect_couple() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disconnect_couple() FROM anon;
GRANT EXECUTE ON FUNCTION public.disconnect_couple() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
