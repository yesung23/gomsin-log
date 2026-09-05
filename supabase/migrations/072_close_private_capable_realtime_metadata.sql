-- 072_close_private_capable_realtime_metadata.sql
-- Replace private-capable source-table Realtime with content-free invalidations.

BEGIN;

ALTER TABLE public.collaboration_invalidations
  DROP CONSTRAINT IF EXISTS collaboration_invalidations_slice_check;
ALTER TABLE public.collaboration_invalidations
  ADD CONSTRAINT collaboration_invalidations_slice_check
  CHECK (slice IN ('events', 'cycle_support', 'talk_about', 'highlights', 'profile', 'records', 'tasks'));

CREATE OR REPLACE FUNCTION public.emit_private_capable_collaboration_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slice TEXT := TG_ARGV[0];
  v_old_couple_id UUID;
  v_new_couple_id UUID;
BEGIN
  IF TG_NARGS <> 1 OR TG_ARGV[0] NOT IN ('records', 'tasks') THEN
    RAISE EXCEPTION 'Invalid collaboration invalidation slice';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.is_private IS TRUE THEN
      RETURN OLD;
    END IF;
    v_old_couple_id := OLD.couple_id;
    INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
    SELECT v_old_couple_id, v_slice, clock_timestamp()
    FROM public.couples AS live_couple
    WHERE live_couple.id = v_old_couple_id
    ON CONFLICT (couple_id, slice)
    DO UPDATE SET updated_at = EXCLUDED.updated_at;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_private IS TRUE THEN
      RETURN NEW;
    END IF;
    v_new_couple_id := NEW.couple_id;
    INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
    SELECT v_new_couple_id, v_slice, clock_timestamp()
    FROM public.couples AS live_couple
    WHERE live_couple.id = v_new_couple_id
    ON CONFLICT (couple_id, slice)
    DO UPDATE SET updated_at = EXCLUDED.updated_at;
    RETURN NEW;
  END IF;

  IF OLD.is_private IS TRUE AND NEW.is_private IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Signal the visible old scope and visible new scope independently. This is
  -- fail-safe if a legacy row ever attempts to move between couple ids.
  IF OLD.is_private IS FALSE THEN
    v_old_couple_id := OLD.couple_id;
    INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
    SELECT v_old_couple_id, v_slice, clock_timestamp()
    FROM public.couples AS live_couple
    WHERE live_couple.id = v_old_couple_id
    ON CONFLICT (couple_id, slice)
    DO UPDATE SET updated_at = EXCLUDED.updated_at;
  END IF;
  IF NEW.is_private IS FALSE
    AND (OLD.is_private IS TRUE OR OLD.couple_id IS DISTINCT FROM NEW.couple_id)
  THEN
    v_new_couple_id := NEW.couple_id;
    INSERT INTO public.collaboration_invalidations (couple_id, slice, updated_at)
    SELECT v_new_couple_id, v_slice, clock_timestamp()
    FROM public.couples AS live_couple
    WHERE live_couple.id = v_new_couple_id
    ON CONFLICT (couple_id, slice)
    DO UPDATE SET updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_private_capable_collaboration_invalidation() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS emit_daily_records_collaboration_invalidation ON public.daily_records;
CREATE TRIGGER emit_daily_records_collaboration_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.emit_private_capable_collaboration_invalidation('records');

DROP TRIGGER IF EXISTS emit_couple_tasks_collaboration_invalidation ON public.couple_tasks;
CREATE TRIGGER emit_couple_tasks_collaboration_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.couple_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.emit_private_capable_collaboration_invalidation('tasks');

ALTER TABLE public.collaboration_invalidations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publication is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'collaboration_invalidations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.collaboration_invalidations;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'daily_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.daily_records;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'couple_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.couple_tasks;
  END IF;
END;
$$;

COMMIT;

-- Refresh PostgREST's cached function catalog only after the transaction is
-- durable. The trigger function is not client-executable, but keeping every
-- function-signature migration self-refreshing prevents stale catalog state.
NOTIFY pgrst, 'reload schema';
