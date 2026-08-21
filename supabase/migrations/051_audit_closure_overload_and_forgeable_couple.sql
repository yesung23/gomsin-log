-- 051: Five things an independent read of the whole chain found, and one lesson.
--
-- Everything here closes a defect that existed while every gate was green. None
-- were caught by review, by the harness, or by CI. They were found by applying
-- the entire active chain to a disposable PostgreSQL and driving the functions
-- as real RLS actors -- which is the only method that would have found any of
-- them, and is now the method the harness uses for each.
--
-- The lesson is in §2. A guarantee tested by reading the SQL that states it is
-- not tested at all.

BEGIN;

-- =============================================================
-- 1. A dropped function came back, without its guards
-- =============================================================
--
-- Migration 031 created `e2ee_commit_recovery_authentication(UUID, UUID)`.
-- Migration 034 DROPPED that signature and replaced it with a four-argument form
-- carrying three checks the two-argument body never had:
--
--   * E2EE_CHALLENGE_IDENTITY_MISMATCH
--   * E2EE_CHALLENGE_DEVICE_MISMATCH
--   * E2EE_RECOVERY_IDENTITY_SUPERSEDED   (the downgrade block)
--
-- Migration 035 then ran `CREATE OR REPLACE` on the TWO-argument signature. It
-- was editing 031's body to add a status-transition guard and did not know 034
-- had deleted that signature underneath it. Different signature, so PostgreSQL
-- OVERLOADED rather than replaced -- and 035 re-granted EXECUTE to service_role.
--
-- The chain therefore ended with both functions live and both callable. The weak
-- one authenticates a device the challenge was not issued for, under a recovery
-- identity the user has already rotated away from. That is exactly the attack
-- 034's header describes closing, reachable again three migrations later.
--
-- Not remotely exploitable today: the caller needs service_role, and
-- `verify-recovery` passes four arguments, so the live path is the hardened one.
-- But 034's whole argument is defence in depth AGAINST trusting that Edge
-- Function, and that argument is void while this overload exists.
--
-- The repository already knew this failure mode. `write-floor-scope-harness.mjs`
-- asserts an obsolete `e2ee_floor_for(uuid, uuid)` overload is absent, by count.
-- The same assertion was never written for this function.

DROP FUNCTION IF EXISTS public.e2ee_commit_recovery_authentication(UUID, UUID);

-- =============================================================
-- 2. `product_events.couple_id` was forgeable, and the test could not tell
-- =============================================================
--
-- Migration 050 gave the column a DEFAULT of `get_my_active_couple_id()` and its
-- header claimed: "A client cannot send one, and therefore cannot attribute its
-- events to a couple it does not belong to."
--
-- That was false. A DEFAULT applies only when the column is OMITTED. 049's INSERT
-- policy checks `user_id = auth.uid()` and nothing else, and its GRANT is
-- table-level, so any authenticated account could name any UUID -- including one
-- belonging to a couple it is not in, or one naming no couple at all, since there
-- is no foreign key.
--
-- Nothing confidential leaks: SELECT is still own-rows-only and the read-out
-- returns aggregates. What breaks is the numbers. `couples_connected`,
-- `couples_writing` and `lv_couple_return_count` all COUNT DISTINCT this column,
-- so one account could inflate every couple-scoped LV metric arbitrarily -- and
-- those metrics are an LV entry condition.
--
-- HOW IT SURVIVED, which matters more than the fix: the harness asserted the
-- column's DEFAULT EXPRESSION TEXT contains `get_my_active_couple_id`. That is a
-- substring check on a catalogue string. It is green for every possible value of
-- the actual behaviour. The `user_id` case ten lines earlier is tested properly,
-- by attempting a forged insert as a second real actor -- so the harness proved
-- the wrong one of two adjacent columns, using a method that cannot fail.
--
-- The policy below is the fix. The behavioural assertion in the harness is the
-- rest of it.

DROP POLICY IF EXISTS "Users write only their own events" ON public.product_events;

CREATE POLICY "Users write only their own events"
  ON public.product_events FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    -- `IS NOT DISTINCT FROM` rather than `=`, because both sides are NULL for an
    -- account with no active couple, and `NULL = NULL` is NULL, which WITH CHECK
    -- treats as a refusal. Written with `=` this would silently block the entire
    -- pre-connection funnel -- the events §19 most needs, from the accounts least
    -- able to report the problem.
    AND couple_id IS NOT DISTINCT FROM public.get_my_active_couple_id()
  );

-- =============================================================
-- 3. Retracting a record to private left the partner's flag raised
-- =============================================================
--
-- 048 attached `raise_partner_unseen()` to `AFTER INSERT` only. Its header calls
-- the private-record guard "the single most important line in the file", and at
-- INSERT it holds exactly. Across an UPDATE it did not.
--
-- Post a record, change your mind, make it private: the partner's `has_unseen`
-- was still true, so they received a notification and arrived to find nothing.
-- The payload is generic, so no content leaks -- but the bit that does leak is
-- the one the privacy switch exists to withhold: that something was written.
--
-- Migration 043 already established the pattern for this exact event, on this
-- exact table: `clear_talk_about_marks_when_record_private` fires on
-- `AFTER UPDATE OF is_private WHEN (OLD.is_private = false AND NEW.is_private = true)`.
-- This is that trigger's missing sibling.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it does not lower the flag unconditionally.
-- If the author has other shared records in this couple, those are still real
-- things the partner has not been told about, and clearing the flag would
-- swallow them. The flag drops only when retracting this record leaves nothing
-- shared -- when the notification would have nothing left to be about.
--
-- Note what is still absent, on purpose: this reads whether records EXIST, never
-- whether anyone looked at them. There is no seen-state here to consult, because
-- §14.3 forbids one existing.

CREATE OR REPLACE FUNCTION public.lower_partner_unseen_on_retraction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.daily_records r
     WHERE r.couple_id = NEW.couple_id
       AND r.user_id = NEW.user_id
       AND r.is_private = FALSE
  ) THEN
    -- Something of theirs is still shared. The flag still has a subject.
    RETURN NEW;
  END IF;

  UPDATE public.push_delivery_state s
     SET has_unseen = FALSE
   WHERE s.has_unseen IS TRUE
     AND s.user_id IN (
       SELECT m.user_id FROM public.couple_members m
        WHERE m.couple_id = NEW.couple_id
          AND m.user_id <> NEW.user_id
          AND m.status = 'active'
     );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lower_partner_unseen_on_retraction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_records_partner_unseen_retracted ON public.daily_records;
CREATE TRIGGER trg_daily_records_partner_unseen_retracted
  AFTER UPDATE OF is_private ON public.daily_records
  FOR EACH ROW
  WHEN (OLD.is_private = FALSE AND NEW.is_private = TRUE)
  EXECUTE FUNCTION public.lower_partner_unseen_on_retraction();

-- =============================================================
-- 4. The same gap in the other direction, which is worse
-- =============================================================
--
-- Writing §3's test surfaced the mirror image, and it silenced the one act §7.6
-- exists to make possible.
--
-- Sharing a record that was private is an UPDATE, not an INSERT, so 048's
-- trigger never saw it either. Every deliberate act of showing someone something
-- they could not see before produced no notification at all: turning a single
-- entry over from the record itself, and -- exactly -- accepting the
-- waiting-period offer. A person could hand over everything they wrote before
-- their partner joined, and their partner would not be told any of it arrived.
--
-- §14.3 says a notification announces that the partner ACTED. This is an act,
-- and a more deliberate one than writing a new entry.
--
-- It reuses `raise_partner_unseen()` unchanged: that function already returns
-- early when the row is private, so the only rows reaching it here are ones that
-- just became visible.

DROP TRIGGER IF EXISTS trg_daily_records_partner_unseen_shared ON public.daily_records;
CREATE TRIGGER trg_daily_records_partner_unseen_shared
  AFTER UPDATE OF is_private ON public.daily_records
  FOR EACH ROW
  WHEN (OLD.is_private = TRUE AND NEW.is_private = FALSE)
  EXECUTE FUNCTION public.raise_partner_unseen();

-- =============================================================
-- 5. A NULL range reported zero retention as a fact
-- =============================================================
--
-- `lv_funnel_readout` refuses NULL bounds. `lv_couple_return_count`, written
-- beside it in the same migration, validated only the ORDER of its bounds --
-- and `NULL < NULL` is NULL, so the guard passed and both windows matched
-- nothing.
--
-- The caller got `couples_active_first = 0, couples_returned = 0`: not an error,
-- a measurement. A malformed read-out that returns a number is worse than one
-- that raises, because zero retention is a result someone might act on.

CREATE OR REPLACE FUNCTION public.lv_couple_return_count(
  p_first_from DATE, p_first_to DATE,
  p_later_from DATE, p_later_to DATE
)
RETURNS TABLE (metric TEXT, value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_first_from IS NULL OR p_first_to IS NULL
     OR p_later_from IS NULL OR p_later_to IS NULL
     OR p_first_to < p_first_from OR p_later_to < p_later_from THEN
    RAISE EXCEPTION 'Invalid read-out range' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH first_window AS (
    SELECT DISTINCT couple_id FROM public.product_events
    WHERE couple_id IS NOT NULL AND occurred_on BETWEEN p_first_from AND p_first_to
  ), later_window AS (
    SELECT DISTINCT couple_id FROM public.product_events
    WHERE couple_id IS NOT NULL AND occurred_on BETWEEN p_later_from AND p_later_to
  )
  SELECT 'couples_active_first'::TEXT, (SELECT COUNT(*) FROM first_window)::NUMERIC
  UNION ALL
  SELECT 'couples_returned',
         (SELECT COUNT(*) FROM first_window f
           WHERE EXISTS (SELECT 1 FROM later_window l WHERE l.couple_id = f.couple_id))::NUMERIC;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_couple_return_count(DATE, DATE, DATE, DATE) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
