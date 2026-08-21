-- 055: a notification covers the acts that existed when it was DECIDED, and the
-- boundary must say so.
--
-- 053 gave each recipient a boundary, `push_delivery_state.notified_through`,
-- and made `partner_has_pending_act()` mean "an act newer than that boundary
-- exists". `mark_push_delivered()` then set the boundary to its OWN clock:
--
--     SET has_unseen = FALSE, last_notified_at = p_now, notified_through = p_now
--
-- with `p_now DEFAULT now()`, and the Edge Function called it with no argument.
-- So the boundary landed at the moment the SEND WAS RECORDED, while the
-- notification it recorded was decided earlier -- at `push_delivery_candidates()`.
-- Everything shared in between fell behind a boundary drawn by a notification
-- that could not have contained it.
--
-- Reproduced deterministically against the real chain (001..054), as real
-- actors, with no sleeps and no thread interleaving -- just the four steps in
-- the order the Edge Function performs them:
--
--   B looks at the app          -> boundary set
--   A shares R1                 -> has_unseen = t
--   send-push lists candidates  -> decision at 23:48:00.566, B is a candidate
--   [ delivery of R1 succeeds ]
--   A shares R2                 -> shared_at   23:48:00.588   (AFTER the decision)
--   mark_push_delivered(B)      -> notified_through 23:48:00.610
--
--   measured afterwards:  has_unseen = f,  partner_has_pending_act = f
--
-- R2 is not delayed. It is GONE. The flag is down, so no run selects B again;
-- the stamp is behind the boundary, so `partner_has_pending_act` will never
-- count it however long it waits. The act is erased from the pending set
-- permanently, and the only thing that resurrects it is A sharing something
-- else. That is the failure 048, 051, 052 and 053 were each written to prevent,
-- arriving from the other side: those four removed notifications with no act
-- behind them, and this one removes an act with no notification behind it.
--
-- The window is small and that is not a defence. It is exactly the window in
-- which the interesting writes happen -- a send fires because someone just
-- posted, and the moment right after someone posts is the moment their partner
-- is most likely to post back. The race is biased toward firing, not away.
--
-- THE FIX, and what it deliberately is not.
--
-- The boundary becomes the DECISION time, which is the only instant that
-- describes what the notification covered. `push_delivery_candidates()` already
-- computes that instant -- `p_now`, defaulted to `now()` -- and now returns it,
-- so the sender hands back the database's own clock rather than its own.
-- Threading the Edge runtime's wall clock instead would reintroduce this bug as
-- clock skew: a sender running five minutes fast would draw the boundary five
-- minutes into the future and swallow everything written in between.
--
-- `has_unseen` is then RECOMPUTED rather than assigned FALSE, through
-- `partner_has_pending_act()` -- 053's single source of truth for that question,
-- reused rather than restated, because the retraction and removal paths drifting
-- apart is how 048 and 051 came to cover three of four transitions.
--
-- What this does NOT add, restated because each was available and each is
-- forbidden by §14.3/§16/§19: no event-history table, no per-notification row,
-- no pending count, no "N unread", no read receipt, no partner-visible
-- observation state. The recipient's row holds exactly what it held before --
-- one boolean and two timestamps, readable only by its owner. The sender learns
-- one new thing: the time at which it itself asked. It knew that already.
--
-- Unchanged: at most one send per recipient per Korean-local day (the cap lives
-- in `push_delivery_candidates`, untouched); a failed delivery still marks
-- nothing, so the next run retries it; the sender still cannot read content,
-- because `decided_at` is a clock reading and not a fact about anybody.

BEGIN;

-- =============================================================
-- 1. The decision time comes back with the decision
-- =============================================================
--
-- DROP then CREATE, not CREATE OR REPLACE: the return type changes, and
-- PostgreSQL refuses to replace a function's OUT columns. Dropping first also
-- keeps 051 §1's rule intact -- exactly ONE signature per application function,
-- never an overload left behind for a caller to bind to by accident.

DROP FUNCTION IF EXISTS public.push_delivery_candidates(TIMESTAMPTZ);

CREATE FUNCTION public.push_delivery_candidates(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (user_id UUID, platform TEXT, token TEXT, decided_at TIMESTAMPTZ)
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
  SELECT t.user_id, t.platform, t.token, p_now
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

REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_delivery_candidates(TIMESTAMPTZ) TO service_role;

-- =============================================================
-- 2. Recording a send, against the instant it was decided
-- =============================================================
--
-- DROP then CREATE again, because the second parameter is being RENAMED. The
-- name is the documentation here: `p_now` invited exactly the reading that
-- caused this bug -- "whatever time it is when you call me" -- and the value
-- this function needs is not that.

DROP FUNCTION IF EXISTS public.mark_push_delivered(UUID, TIMESTAMPTZ);

-- NO DEFAULT on `p_decided_at`, and that is the load-bearing part.
--
-- `p_now TIMESTAMPTZ DEFAULT now()` is what made this bug silent. The Edge
-- Function called `mark_push_delivered(p_user_id)`, the default quietly supplied
-- the wrong instant, and the result was a correct-looking call that erased acts.
-- Required means a caller that forgets gets `function does not exist` on its
-- first run instead of losing one notification per race, forever, unnoticed --
-- the whole failure mode being that nobody is there to notice.
CREATE FUNCTION public.mark_push_delivered(
  p_user_id UUID,
  p_decided_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple UUID;
  v_author UUID;
  v_pending BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  /*
    The boundary only ever moves FORWARD.

    `GREATEST` is not decoration. A recipient who opened the app between the
    decision and this call already has a LATER boundary from `clear_my_unseen()`,
    and writing `p_decided_at` flat would drag it backwards -- re-pending acts
    they have already looked at, and notifying them tomorrow about something they
    read today. Their own look always outranks our record of a send.
  */
  INSERT INTO public.push_delivery_state (user_id, has_unseen, last_notified_at, notified_through)
  VALUES (p_user_id, FALSE, p_decided_at, p_decided_at)
  ON CONFLICT (user_id) DO UPDATE
    SET has_unseen = FALSE,
        last_notified_at = p_decided_at,
        notified_through = GREATEST(
          COALESCE(push_delivery_state.notified_through, p_decided_at),
          p_decided_at
        );

  /*
    Now ask whether anything is STILL owed, instead of asserting nothing is.

    The boundary is written first on purpose: `partner_has_pending_act` reads it
    from the row, so this measures the question against the boundary we just
    drew rather than against a value passed alongside it that could disagree.

    Across every active partner, because the flag is one merged boolean for the
    recipient and not one per relationship. EXIT on the first hit -- the answer
    is a boolean, and counting how many partners are owed would be building the
    pending count §14.3 forbids, one loop iteration at a time.
  */
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
    -- Raised again, and the daily cap stamped just above is what keeps this from
    -- becoming a second send today. The act waits for tomorrow's run rather than
    -- disappearing, which is the entire point of this migration.
    UPDATE public.push_delivery_state SET has_unseen = TRUE WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
