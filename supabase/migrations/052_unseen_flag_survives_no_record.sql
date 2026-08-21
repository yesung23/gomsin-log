-- 052: The flag outlived the record, on the one path 051 did not cover.
--
-- 048 raised the partner's `has_unseen` on INSERT. 051 added the two UPDATE
-- directions -- lower on retraction, raise on share. Both migrations reasoned
-- about `is_private` changing, and neither about the row ceasing to exist.
--
-- So deleting a shared record left the invitation standing. The partner is
-- summoned to a couple space with nothing in it, which is the same wrong that
-- 051 §3 fixed for retraction, arriving through the door 051 did not check.
--
-- The worse instance is not deletion by hand. `daily_records.user_id` is
-- ON DELETE CASCADE from `auth.users`, so closing an account deletes every
-- record that account wrote -- and left the surviving partner's flag raised.
-- They would then be notified, in their next contact window, that their partner
-- had ACTED. What actually happened is that their partner left. A generic
-- payload does not say which, but the notification exists only because someone
-- did something, and the one thing they did was go.
--
-- §14.3 draws this line explicitly: a notification announces an act, never an
-- absence. An account closing is the largest absence the product has.

BEGIN;

CREATE OR REPLACE FUNCTION public.lower_partner_unseen_on_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A private record never raised anything, so its removal has nothing to undo.
  IF OLD.is_private IS TRUE THEN
    RETURN OLD;
  END IF;

  -- Same rule 051 §3 established: another shared record of theirs is still a
  -- real thing the partner has not been told about, and clearing the flag would
  -- swallow it. The flag drops only when nothing shared remains.
  IF EXISTS (
    SELECT 1 FROM public.daily_records r
     WHERE r.couple_id = OLD.couple_id
       AND r.user_id = OLD.user_id
       AND r.is_private = FALSE
  ) THEN
    RETURN OLD;
  END IF;

  UPDATE public.push_delivery_state s
     SET has_unseen = FALSE
   WHERE s.has_unseen IS TRUE
     AND s.user_id IN (
       SELECT m.user_id FROM public.couple_members m
        WHERE m.couple_id = OLD.couple_id
          AND m.user_id <> OLD.user_id
          AND m.status = 'active'
     );

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.lower_partner_unseen_on_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_records_partner_unseen_removed ON public.daily_records;
CREATE TRIGGER trg_daily_records_partner_unseen_removed
  AFTER DELETE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.lower_partner_unseen_on_removal();

/*
  One limit, stated rather than implied.

  On account closure this depends on the CASCADE reaching `daily_records` while
  the departing account's `couple_members` row is still there, because the
  subquery reads that row to find the partner. PostgreSQL does not order cascaded
  deletes between tables, so the opposite order leaves the flag up exactly as
  before -- no worse than today, and not reliably better.

  `disconnect_couple` is the path that does not depend on ordering: it lowers
  both members' flags explicitly (048), and a closure that goes through it is
  covered regardless. This trigger is the safety net for the paths that do not,
  and the harness proves the hand-deletion case rather than the racy one.
*/

COMMIT;

NOTIFY pgrst, 'reload schema';
