-- 014_feature_privacy_and_collaboration.sql
--
-- Privacy boundary:
--   Private events and raw cycle settings/entries are never partner-readable.
--   Partners only see explicit, short-lived cycle_support_signals, which contain
--   no cycle-entry foreign key, raw dates, symptoms, or prediction data.
--
-- Apply only after migrations 009-013 and verify in staging first.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Event types and operation-specific event privacy
-- ---------------------------------------------------------------------------
-- Replace any prior event_type check (the generated name can differ between
-- environments) with the current fixed vocabulary.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  FOR v_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.events DROP CONSTRAINT %I',
      v_constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check CHECK (
    event_type IN ('visit', 'vacation', 'anniversary', 'date', 'trip', 'other')
  );

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage events" ON public.events;
DROP POLICY IF EXISTS "Creator can manage own events" ON public.events;
DROP POLICY IF EXISTS "Active partner can read shared events" ON public.events;
DROP POLICY IF EXISTS "Event visibility is privacy scoped" ON public.events;
DROP POLICY IF EXISTS "Creators can insert events" ON public.events;
DROP POLICY IF EXISTS "Creators can update eligible events" ON public.events;
DROP POLICY IF EXISTS "Creators can delete eligible events" ON public.events;

-- Private rows stay author-only. Shared rows require current active membership,
-- including for the creator, so disconnect immediately removes shared access.
CREATE POLICY "Event visibility is privacy scoped"
  ON public.events
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      (is_private = true AND created_by = auth.uid())
      OR (
        is_private = false
        AND couple_id = public.get_my_active_couple_id()
      )
    )
  );

CREATE POLICY "Creators can insert events"
  ON public.events
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Creators can update eligible events"
  ON public.events
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND (
      is_private = true
      OR couple_id = public.get_my_active_couple_id()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND (
      is_private = true
      OR couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Creators can delete eligible events"
  ON public.events
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND (
      is_private = true
      OR couple_id = public.get_my_active_couple_id()
    )
  );

REVOKE ALL ON TABLE public.events FROM PUBLIC;
REVOKE ALL ON TABLE public.events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared trip planner: both active members have full CRUD
-- ---------------------------------------------------------------------------
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trips" ON public.trips;
DROP POLICY IF EXISTS "Active members can select trips" ON public.trips;
DROP POLICY IF EXISTS "Active members can insert trips" ON public.trips;
DROP POLICY IF EXISTS "Active members can update trips" ON public.trips;
DROP POLICY IF EXISTS "Active members can delete trips" ON public.trips;

CREATE POLICY "Active members can select trips"
  ON public.trips FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active members can insert trips"
  ON public.trips FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active members can update trips"
  ON public.trips FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active members can delete trips"
  ON public.trips FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

REVOKE ALL ON TABLE public.trips FROM PUBLIC;
REVOKE ALL ON TABLE public.trips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trips TO authenticated;

ALTER TABLE public.trip_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trip items" ON public.trip_items;
DROP POLICY IF EXISTS "Active members can select trip items" ON public.trip_items;
DROP POLICY IF EXISTS "Active members can insert trip items" ON public.trip_items;
DROP POLICY IF EXISTS "Active members can update trip items" ON public.trip_items;
DROP POLICY IF EXISTS "Active members can delete trip items" ON public.trip_items;

CREATE POLICY "Active members can select trip items"
  ON public.trip_items FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_items.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can insert trip items"
  ON public.trip_items FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_items.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can update trip items"
  ON public.trip_items FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_items.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_items.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can delete trip items"
  ON public.trip_items FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_items.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

REVOKE ALL ON TABLE public.trip_items FROM PUBLIC;
REVOKE ALL ON TABLE public.trip_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_items TO authenticated;

ALTER TABLE public.trip_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members can manage trip checklists" ON public.trip_checklists;
DROP POLICY IF EXISTS "Active members can select trip checklists" ON public.trip_checklists;
DROP POLICY IF EXISTS "Active members can insert trip checklists" ON public.trip_checklists;
DROP POLICY IF EXISTS "Active members can update trip checklists" ON public.trip_checklists;
DROP POLICY IF EXISTS "Active members can delete trip checklists" ON public.trip_checklists;

CREATE POLICY "Active members can select trip checklists"
  ON public.trip_checklists FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_checklists.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can insert trip checklists"
  ON public.trip_checklists FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_checklists.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can update trip checklists"
  ON public.trip_checklists FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_checklists.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_checklists.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

CREATE POLICY "Active members can delete trip checklists"
  ON public.trip_checklists FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.trips AS trip
      WHERE trip.id = trip_checklists.trip_id
        AND trip.couple_id = public.get_my_active_couple_id()
    )
  );

REVOKE ALL ON TABLE public.trip_checklists FROM PUBLIC;
REVOKE ALL ON TABLE public.trip_checklists FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_checklists TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner-only raw cycle data
-- ---------------------------------------------------------------------------
ALTER TABLE public.cycle_entries
  ADD COLUMN IF NOT EXISTS symptoms TEXT[];

UPDATE public.cycle_entries
SET symptoms = '{}'::TEXT[]
WHERE symptoms IS NULL;

ALTER TABLE public.cycle_entries
  ALTER COLUMN symptoms SET DEFAULT '{}'::TEXT[],
  ALTER COLUMN symptoms SET NOT NULL;

ALTER TABLE public.cycle_entries
  DROP CONSTRAINT IF EXISTS cycle_entries_symptoms_check;

ALTER TABLE public.cycle_entries
  ADD CONSTRAINT cycle_entries_symptoms_check CHECK (
    symptoms <@ ARRAY[
      'cramps',
      'headache',
      'fatigue',
      'bloating',
      'mood_changes',
      'backache'
    ]::TEXT[]
  );

ALTER TABLE public.cycle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own cycle settings" ON public.cycle_settings;
CREATE POLICY "Owner can manage own cycle settings"
  ON public.cycle_settings
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Owner can manage own cycle entries" ON public.cycle_entries;
CREATE POLICY "Owner can manage own cycle entries"
  ON public.cycle_entries
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

REVOKE ALL ON TABLE public.cycle_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_settings TO authenticated;

REVOKE ALL ON TABLE public.cycle_entries FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Explicit, sanitized support signals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cycle_support_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('resting', 'need_space', 'would_like_support', 'check_in_later')
  ),
  message TEXT CHECK (message IS NULL OR char_length(message) <= 80),
  shared_for_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cycle_support_signals IS
  'Explicit opt-in support only; never stores raw cycle dates, symptoms, predictions, or a cycle-entry reference.';
COMMENT ON COLUMN public.cycle_support_signals.shared_for_date IS
  'User-selected sharing date; it is not derived from cycle_entries.';

CREATE INDEX IF NOT EXISTS idx_cycle_support_signals_couple_date
  ON public.cycle_support_signals (couple_id, shared_for_date)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cycle_support_signals_owner_created
  ON public.cycle_support_signals (owner_id, created_at DESC);

ALTER TABLE public.cycle_support_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active owners can select support signals" ON public.cycle_support_signals;
DROP POLICY IF EXISTS "Active partners can select current support signals" ON public.cycle_support_signals;
DROP POLICY IF EXISTS "Active owners can insert support signals" ON public.cycle_support_signals;
DROP POLICY IF EXISTS "Active owners can update support signals" ON public.cycle_support_signals;
DROP POLICY IF EXISTS "Active owners can delete support signals" ON public.cycle_support_signals;

CREATE POLICY "Active owners can select support signals"
  ON public.cycle_support_signals FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND owner_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active partners can select current support signals"
  ON public.cycle_support_signals FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND owner_id <> auth.uid()
    AND couple_id = public.get_my_active_couple_id()
    AND shared_for_date = CURRENT_DATE
    AND revoked_at IS NULL
    AND expires_at > now()
  );

CREATE POLICY "Active owners can insert support signals"
  ON public.cycle_support_signals FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND owner_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active owners can update support signals"
  ON public.cycle_support_signals FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND owner_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND owner_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

CREATE POLICY "Active owners can delete support signals"
  ON public.cycle_support_signals FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND owner_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
  );

REVOKE ALL ON TABLE public.cycle_support_signals FROM PUBLIC;
REVOKE ALL ON TABLE public.cycle_support_signals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cycle_support_signals TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime: collaborative tables only, never raw cycle data
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'trip_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_items;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'trip_checklists'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_checklists;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'cycle_support_signals'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.cycle_support_signals;
    END IF;

    -- Enforce the privacy boundary even if these tables were added manually.
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'cycle_entries'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.cycle_entries;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'cycle_settings'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.cycle_settings;
    END IF;
  END IF;
END;
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Rollback approach
-- ---------------------------------------------------------------------------
-- Back up first. In one transaction: remove the three new realtime entries,
-- drop cycle_support_signals, drop cycle_entries_symptoms_check and symptoms,
-- restore the event_type check/policies and trip policies from migration 011.
-- Data written with event_type = 'date' must be migrated before restoring the
-- old event_type constraint.
