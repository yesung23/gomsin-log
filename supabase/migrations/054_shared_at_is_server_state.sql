-- 054: `shared_at` is delivery state, so the client must not be able to write it.
--
-- 053 introduced `daily_records.shared_at` and made the whole cancellation rule
-- depend on it: `partner_has_pending_act()` decides whether the partner's
-- invitation still has a subject by comparing that column against the
-- recipient's boundary. It is therefore SERVER STATE that happens to live on a
-- client-writable table.
--
-- It was writable. `authenticated` holds a table-level `UPDATE` grant on
-- `daily_records` (migration 012), RLS is row-level and cannot withhold a single
-- column, and 053's stamping trigger fired only `BEFORE INSERT OR UPDATE OF
-- is_private`. An UPDATE that does not name `is_private` never ran it at all --
-- and one that names it at an UNCHANGED value ran it into a branch that assigns
-- nothing, so the value the client sent survived either way.
--
-- Reproduced against the real chain, as the record's own author through RLS:
--
--   A has an old shared record R1; B opens the app, so B's boundary moves past it.
--   A: UPDATE daily_records SET shared_at = now() + interval '100 years' WHERE id = R1
--   A shares R2, then retracts R2 -- the only new act, withdrawn.
--   `partner_has_pending_act` still sees R1 as pending, so B's `has_unseen`
--   STAYS RAISED. Measured: `t`, where 053 alone gives `f`.
--
-- `push_delivery_candidates()` reads `has_unseen` and nothing else, so that is a
-- delivered notification with no act behind it -- the exact false invitation
-- 051 §3, 052 and 053 were each written to remove, reachable again through the
-- column 053 added to remove it.
--
-- THE CLASS, which matters more than this instance. This is 051 §2 a second
-- time: a column whose correctness the server depends on, protected by a
-- mechanism that only covers the path its author had in mind. There the DEFAULT
-- applied solely when the column was omitted; here the trigger applied solely
-- when `is_private` was named. Both read as airtight in the migration and both
-- left the column open to a client that simply mentions it.
--
-- THE FIX is to stop treating the incoming value as input on any path. The
-- trigger now fires on EVERY insert and update, and every branch ASSIGNS --
-- including the no-transition branch, which restores `OLD.shared_at` rather than
-- leaving whatever arrived. A BEFORE trigger cannot be bypassed by a client, so
-- the column becomes unwritable from outside without revoking the table grant
-- and re-granting it column by column, which would have to be revisited every
-- time a column is added.
--
-- What does NOT change: the product semantics 053 states. Sharing stamps,
-- retracting erases, editing while shared does not restamp. Only the source of
-- the value changes -- from "the client's, unless the trigger happened to run"
-- to "the server's, always."

BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_record_shared_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A submitted `shared_at` is discarded here too: the value is a function of
    -- visibility, never something the writer gets to state.
    NEW.shared_at := CASE WHEN NEW.is_private IS TRUE THEN NULL ELSE now() END;
    RETURN NEW;
  END IF;

  IF NEW.is_private IS TRUE THEN
    -- Retracted, or still private. The act is withdrawn and so is its timestamp:
    -- keeping it would leave a record of when someone briefly shared something
    -- and thought better of it, which is a history of changing one's mind.
    NEW.shared_at := NULL;
  ELSIF OLD.is_private IS TRUE THEN
    -- Became visible just now.
    NEW.shared_at := now();
  ELSE
    -- Shared before and shared still. Editing is not an act that raises the
    -- flag, so it must not be one that keeps it up either -- the stamp does not
    -- move. This branch is the fix: it ASSIGNS the old value rather than
    -- falling through, which is what let a client-supplied one survive.
    NEW.shared_at := OLD.shared_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_record_shared_at() FROM PUBLIC, anon, authenticated;

-- The repair runs with NO stamping trigger attached, and that ordering is the
-- whole of this block.
--
-- The first draft installed the trigger above and repaired below it. Every row
-- the repair targets is `is_private = FALSE` and stays that way, so the UPDATE
-- landed in the no-transition branch -- `NEW.shared_at := OLD.shared_at` -- and
-- the trigger put back the exact value the statement existed to erase. Two
-- statements ran, both reported rows updated, and neither changed anything.
--
-- Measured on the real upgrade path rather than argued: apply 001..053, forge
-- `shared_at` to `now() + 100 years` as the record's own author through RLS,
-- then apply 054. Both forged rows still read year 2126 afterwards. The fix
-- above was sound and the migration carrying it was inert on the only path that
-- needed it -- which is this file's own thesis a third time, a guard that
-- covers the path its author pictured and not the one in front of it.
--
-- Dropping the trigger first opens no window a client can use: the DROP takes
-- ACCESS EXCLUSIVE on the table and this is one transaction, so no other
-- session touches `daily_records` between here and COMMIT.
DROP TRIGGER IF EXISTS trg_daily_records_shared_at ON public.daily_records;

-- Any row a client already skewed is restored to the honest value. A shared
-- record became visible no later than it was last touched, and the backfill 053
-- used for history is the same rule.
--
-- This bounds the stamp from ABOVE only, deliberately. A stamp forged into the
-- PAST is not recoverable from anything the row still knows, and it fails in the
-- safe direction: it drops the author's own record behind the recipient's
-- boundary, costing that author a notification for their own act, rather than
-- summoning the recipient to something that is not there. Suppressing your own
-- act is a thing you can already do by retracting it.
UPDATE public.daily_records
   SET shared_at = LEAST(shared_at, GREATEST(updated_at, created_at))
 WHERE is_private = FALSE
   AND shared_at IS NOT NULL
   AND shared_at > GREATEST(updated_at, created_at);

UPDATE public.daily_records SET shared_at = NULL WHERE is_private = TRUE AND shared_at IS NOT NULL;

-- `UPDATE` rather than `UPDATE OF is_private`. Narrowing it to that column is
-- precisely what left the other update paths unstamped, and the body is a few
-- comparisons -- cheaper than the row write it rides along with.
CREATE TRIGGER trg_daily_records_shared_at
  BEFORE INSERT OR UPDATE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_record_shared_at();

COMMIT;

NOTIFY pgrst, 'reload schema';
