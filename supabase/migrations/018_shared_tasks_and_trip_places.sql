BEGIN;

CREATE TABLE IF NOT EXISTS public.couple_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  due_date DATE NOT NULL,
  due_time TIME,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS couple_tasks_couple_due_idx
  ON public.couple_tasks(couple_id, due_date, due_time);
CREATE INDEX IF NOT EXISTS couple_tasks_assignee_idx
  ON public.couple_tasks(assignee_id, completed, due_date);

ALTER TABLE public.couple_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read visible couple tasks" ON public.couple_tasks;
CREATE POLICY "Members can read visible couple tasks" ON public.couple_tasks FOR SELECT
  USING (
    created_by = auth.uid()
    OR (NOT is_private AND couple_id = public.get_my_active_couple_id())
  );

DROP POLICY IF EXISTS "Members can create couple tasks" ON public.couple_tasks;
CREATE POLICY "Members can create couple tasks" ON public.couple_tasks FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
    AND (
      assignee_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.couple_members member
        WHERE member.couple_id = couple_tasks.couple_id
          AND member.user_id = assignee_id
          AND member.status = 'active'
      )
    )
  );

DROP POLICY IF EXISTS "Members can update visible couple tasks" ON public.couple_tasks;
CREATE POLICY "Members can update visible couple tasks" ON public.couple_tasks FOR UPDATE
  USING (
    couple_id = public.get_my_active_couple_id()
    AND (created_by = auth.uid() OR NOT is_private)
  )
  WITH CHECK (
    couple_id = public.get_my_active_couple_id()
    AND (created_by = auth.uid() OR NOT is_private)
  );

DROP POLICY IF EXISTS "Owners can delete couple tasks" ON public.couple_tasks;
CREATE POLICY "Owners can delete couple tasks" ON public.couple_tasks FOR DELETE
  USING (created_by = auth.uid() AND couple_id = public.get_my_active_couple_id());

DROP TRIGGER IF EXISTS enforce_couple_task_identity ON public.couple_tasks;
DROP FUNCTION IF EXISTS public.enforce_couple_task_identity();
CREATE FUNCTION public.enforce_couple_task_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Couple task identity fields are immutable';
  END IF;
  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.couple_members member
    WHERE member.couple_id = NEW.couple_id
      AND member.user_id = NEW.assignee_id
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Task assignee is not an active couple member';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_couple_task_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_couple_task_identity
  BEFORE UPDATE ON public.couple_tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_couple_task_identity();

REVOKE ALL ON TABLE public.couple_tasks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couple_tasks TO authenticated;

ALTER TABLE public.trip_items
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS business_hours TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.trip_items DROP CONSTRAINT IF EXISTS trip_items_address_length_check;
ALTER TABLE public.trip_items ADD CONSTRAINT trip_items_address_length_check
  CHECK (address IS NULL OR char_length(address) <= 300);
ALTER TABLE public.trip_items DROP CONSTRAINT IF EXISTS trip_items_business_hours_length_check;
ALTER TABLE public.trip_items ADD CONSTRAINT trip_items_business_hours_length_check
  CHECK (business_hours IS NULL OR char_length(business_hours) <= 500);
ALTER TABLE public.trip_items DROP CONSTRAINT IF EXISTS trip_items_coordinates_check;
ALTER TABLE public.trip_items ADD CONSTRAINT trip_items_coordinates_check CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
ALTER TABLE public.trip_items DROP CONSTRAINT IF EXISTS trip_items_source_check;
ALTER TABLE public.trip_items ADD CONSTRAINT trip_items_source_check
  CHECK (source IN ('manual', 'screenshot', 'kakao'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'couple_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_tasks;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
