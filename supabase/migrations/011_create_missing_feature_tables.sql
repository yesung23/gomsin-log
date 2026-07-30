-- 011_create_missing_feature_tables.sql
-- Create feature tables missing from the currently deployed remote project.
-- Requires 009_remote_core_security_hotfix.sql first.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared/private couple events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('visit', 'vacation', 'anniversary', 'trip', 'other')
  ),
  start_date DATE NOT NULL,
  end_date DATE,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_events_couple_start_date
  ON public.events (couple_id, start_date);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage events" ON public.events;
DROP POLICY IF EXISTS "Creator can manage own events" ON public.events;
DROP POLICY IF EXISTS "Active partner can read shared events" ON public.events;

CREATE POLICY "Creator can manage own events"
  ON public.events
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active partner can read shared events"
  ON public.events
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND created_by <> auth.uid()
    AND is_private = false
  );

REVOKE ALL ON TABLE public.events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;

-- ---------------------------------------------------------------------------
-- Shared trip planner
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (
    status IN ('planned', 'ongoing', 'completed')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_trips_couple_start_date
  ON public.trips (couple_id, start_date);

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trips" ON public.trips;

CREATE POLICY "Active members can manage trips"
  ON public.trips
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

REVOKE ALL ON TABLE public.trips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trips TO authenticated;

CREATE TABLE IF NOT EXISTS public.trip_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  item_date DATE NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  category TEXT NOT NULL DEFAULT 'activity' CHECK (
    category IN ('activity', 'food', 'lodging', 'transport')
  ),
  memo TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_items_trip_date_order
  ON public.trip_items (trip_id, item_date, sort_order);

ALTER TABLE public.trip_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trip items" ON public.trip_items;

CREATE POLICY "Active members can manage trip items"
  ON public.trip_items
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips
      WHERE trips.id = trip_items.trip_id
        AND trips.couple_id = public.get_my_active_couple_id()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips
      WHERE trips.id = trip_items.trip_id
        AND trips.couple_id = public.get_my_active_couple_id()
    )
  );

REVOKE ALL ON TABLE public.trip_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.trip_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL CHECK (length(trim(item_name)) BETWEEN 1 AND 100),
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_checklists_trip
  ON public.trip_checklists (trip_id, created_at);

ALTER TABLE public.trip_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trip checklists" ON public.trip_checklists;

CREATE POLICY "Active members can manage trip checklists"
  ON public.trip_checklists
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips
      WHERE trips.id = trip_checklists.trip_id
        AND trips.couple_id = public.get_my_active_couple_id()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips
      WHERE trips.id = trip_checklists.trip_id
        AND trips.couple_id = public.get_my_active_couple_id()
    )
  );

REVOKE ALL ON TABLE public.trip_checklists FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_checklists TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner-only menstrual cycle data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cycle_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  average_cycle_length INTEGER NOT NULL DEFAULT 28 CHECK (
    average_cycle_length BETWEEN 15 AND 60
  ),
  average_period_length INTEGER NOT NULL DEFAULT 5 CHECK (
    average_period_length BETWEEN 1 AND 15
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cycle_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle settings" ON public.cycle_settings;

CREATE POLICY "Owner can manage own cycle settings"
  ON public.cycle_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

REVOKE ALL ON TABLE public.cycle_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.cycle_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, start_date),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_cycle_entries_user_start
  ON public.cycle_entries (user_id, start_date DESC);

ALTER TABLE public.cycle_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle entries" ON public.cycle_entries;

CREATE POLICY "Owner can manage own cycle entries"
  ON public.cycle_entries
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

REVOKE ALL ON TABLE public.cycle_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication for shared live updates
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'daily_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_records;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  END IF;
END;
$$;

COMMIT;
