-- 053: The flag has to mean "an act is pending", not "shared records exist".
--
-- 051 and 052 lower the partner's flag only when the author has no other shared
-- record left. Reproduced against the real chain, that rule fails the sequence
-- it most needs to handle:
--
--   A has an old shared record R1.
--   B opens the app; `clear_my_unseen()` lowers the flag.
--   A shares R2; the flag goes up.
--   A changes their mind and makes R2 private -- or deletes it.
--   R1 is still shared, so the flag STAYS UP.
--
--   Measured before this migration: `t`, on both the retract and the delete
--   path. B is still summoned. The only new act was withdrawn.
--
-- R1's existence does not prove there is a pending act. R1 predates B's last
-- clear, so it has already been accounted for. The rule was asking the wrong
-- question -- "is anything shared?" instead of "is anything shared that B has
-- not been told about?"
--
-- ## The boolean cannot answer that, and this says so plainly
--
-- `has_unseen` records THAT something is pending, never WHICH act or WHEN. So at
-- the moment an act is withdrawn there is no way to ask whether it was the only
-- one. Any correct cancellation needs two facts the current schema does not
-- hold: a boundary for the recipient (what have they already been told about)
-- and a time for each act (when did this become visible). Neither exists.
--
-- So the one-boolean model is genuinely unable to support correct cancellation.
-- What follows is the smallest thing that can, and it is deliberately NOT an
-- event table.
--
-- ## The two facts, and why neither is a new privacy surface
--
--   `push_delivery_state.notified_through` -- the recipient's boundary. Set by
--   `clear_my_unseen()` when they look, and by `mark_push_delivered()` when a
--   notification goes out. It lives on the recipient's OWN row, which has no
--   partner SELECT policy, so the author cannot read it. It is the same shape and
--   the same argument as `last_notified_at`, which 048 already put there.
--
--   Not a read receipt: a read receipt is defined by the OTHER side learning
--   something, and nothing here reaches them. It is not analytics either -- no
--   product surface reads it, and it is overwritten rather than accumulated.
--
--   `daily_records.shared_at` -- when this record last became visible. NULL
--   while private. The author's partner can read it, and that is not a new
--   disclosure: `updated_at` is already on that table, already partner-readable,
--   and already moves when a record is shared. `shared_at` is the same fact
--   stated precisely instead of inferred.
--
-- ## What is still absent, on purpose
--
-- No count of pending acts, anywhere. No list of them. No history: `shared_at`
-- is overwritten on each transition and erased when a record goes private, so
-- there is no record of how many times someone changed their mind. Nothing
-- reaches the partner. Nothing is exposed to any client surface that could
-- become a debt counter -- the app reads `has_unseen` and nothing else.
--
-- And absence is still not an event: every value here is set by an ACT, and the
-- boundary moves only when the recipient acts or a notification is sent.

BEGIN;

-- =============================================================
-- 1. The recipient's boundary
-- =============================================================

ALTER TABLE public.push_delivery_state
  ADD COLUMN IF NOT EXISTS notified_through TIMESTAMPTZ;

COMMENT ON COLUMN public.push_delivery_state.notified_through IS
  'Acts before this point have already been surfaced to this recipient. Own-row only; the partner has no policy that selects it.';

-- Existing rows have been notified through now: nothing that predates this
-- migration should suddenly count as pending.
UPDATE public.push_delivery_state SET notified_through = now() WHERE notified_through IS NULL;

-- =============================================================
-- 2. When each record became visible
-- =============================================================

ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

COMMENT ON COLUMN public.daily_records.shared_at IS
  'When this record last became visible to the partner. NULL while private. Overwritten, never accumulated.';

-- Backfill: an already-shared record became visible when it was written. The
-- alternative -- now() -- would make every historical record a pending act for
-- every recipient, which is the failure this migration exists to prevent,
-- arriving through its own backfill.
UPDATE public.daily_records SET shared_at = created_at
 WHERE is_private = FALSE AND shared_at IS NULL;

CREATE OR REPLACE FUNCTION public.stamp_record_shared_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_private IS TRUE THEN
    -- Retracted. The act is withdrawn, and so is its timestamp: keeping it would
    -- leave a record of when someone briefly shared something and thought better
    -- of it, which is a history of changing one's mind.
    NEW.shared_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.is_private IS TRUE THEN
    -- Became visible just now. A shared record edited while still shared does
    -- NOT restamp -- editing is not an act that raises the flag, so it must not
    -- be one that keeps it up either.
    NEW.shared_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_record_shared_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_records_shared_at ON public.daily_records;
CREATE TRIGGER trg_daily_records_shared_at
  BEFORE INSERT OR UPDATE OF is_private ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_record_shared_at();

CREATE INDEX IF NOT EXISTS idx_daily_records_pending_acts
  ON public.daily_records (couple_id, user_id, shared_at)
  WHERE is_private = FALSE;

-- =============================================================
-- 3. The question, asked correctly this time
-- =============================================================
--
-- One helper, so the retraction and deletion paths cannot drift apart -- which
-- is how 048 and 051 ended up covering three of the four transitions.

CREATE OR REPLACE FUNCTION public.partner_has_pending_act(
  p_couple_id UUID, p_author_id UUID, p_recipient_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_boundary TIMESTAMPTZ;
BEGIN
  SELECT s.notified_through INTO v_boundary
    FROM public.push_delivery_state s
   WHERE s.user_id = p_recipient_id;

  RETURN EXISTS (
    SELECT 1 FROM public.daily_records r
     WHERE r.couple_id = p_couple_id
       AND r.user_id = p_author_id
       AND r.is_private = FALSE
       AND r.shared_at IS NOT NULL
       -- No boundary means nothing has ever been cleared or delivered for this
       -- recipient, so every shared record is still pending for them.
       AND (v_boundary IS NULL OR r.shared_at > v_boundary)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_has_pending_act(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lower_partner_unseen_on_retraction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner UUID;
BEGIN
  FOR v_partner IN
    SELECT m.user_id FROM public.couple_members m
     WHERE m.couple_id = NEW.couple_id
       AND m.user_id <> NEW.user_id
       AND m.status = 'active'
  LOOP
    IF NOT public.partner_has_pending_act(NEW.couple_id, NEW.user_id, v_partner) THEN
      UPDATE public.push_delivery_state s
         SET has_unseen = FALSE
       WHERE s.user_id = v_partner AND s.has_unseen IS TRUE;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lower_partner_unseen_on_retraction() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lower_partner_unseen_on_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner UUID;
BEGIN
  IF OLD.is_private IS TRUE THEN
    RETURN OLD;
  END IF;

  FOR v_partner IN
    SELECT m.user_id FROM public.couple_members m
     WHERE m.couple_id = OLD.couple_id
       AND m.user_id <> OLD.user_id
       AND m.status = 'active'
  LOOP
    IF NOT public.partner_has_pending_act(OLD.couple_id, OLD.user_id, v_partner) THEN
      UPDATE public.push_delivery_state s
         SET has_unseen = FALSE
       WHERE s.user_id = v_partner AND s.has_unseen IS TRUE;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.lower_partner_unseen_on_removal() FROM PUBLIC, anon, authenticated;

-- =============================================================
-- 4. Moving the boundary
-- =============================================================
--
-- Both places where a recipient stops being owed a notification: they looked, or
-- one was sent. Without this the boundary never moves and every shared record
-- stays pending forever, which is the previous behaviour with extra columns.

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

  -- Upsert rather than update: an account that has never had a row still needs
  -- a boundary, or its first look would count for nothing.
  INSERT INTO public.push_delivery_state (user_id, has_unseen, notified_through)
  VALUES (v_uid, FALSE, now())
  ON CONFLICT (user_id) DO UPDATE
    SET has_unseen = FALSE, notified_through = now();
END;
$$;

REVOKE ALL ON FUNCTION public.clear_my_unseen() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_my_unseen() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_my_unseen() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_push_delivered(p_user_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;

  INSERT INTO public.push_delivery_state (user_id, has_unseen, last_notified_at, notified_through)
  VALUES (p_user_id, FALSE, p_now, p_now)
  ON CONFLICT (user_id) DO UPDATE
    SET has_unseen = FALSE, last_notified_at = p_now, notified_through = p_now;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_delivered(UUID, TIMESTAMPTZ) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
