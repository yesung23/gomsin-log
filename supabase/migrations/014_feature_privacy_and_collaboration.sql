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

-- Trip items must stay inside their parent trip, and a parent range cannot be
-- narrowed around existing collaborative items.
CREATE OR REPLACE FUNCTION public.enforce_trip_item_date_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  SELECT start_date, end_date
    INTO v_start_date, v_end_date
  FROM public.trips
  WHERE id = NEW.trip_id;

  IF v_start_date IS NULL OR NEW.item_date < v_start_date OR NEW.item_date > v_end_date THEN
    RAISE EXCEPTION 'Trip item date must be within the parent trip range';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_trip_item_date_range() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_trip_item_date_range() FROM anon;

DROP TRIGGER IF EXISTS enforce_trip_item_date_range ON public.trip_items;
CREATE TRIGGER enforce_trip_item_date_range
  BEFORE INSERT OR UPDATE OF trip_id, item_date ON public.trip_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trip_item_date_range();

CREATE OR REPLACE FUNCTION public.prevent_trip_range_excluding_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.start_date, NEW.end_date) IS DISTINCT FROM (OLD.start_date, OLD.end_date)
    AND EXISTS (
      SELECT 1
      FROM public.trip_items
      WHERE trip_id = OLD.id
        AND (item_date < NEW.start_date OR item_date > NEW.end_date)
    )
  THEN
    RAISE EXCEPTION 'Trip range must include all existing trip items';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_trip_range_excluding_items() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_trip_range_excluding_items() FROM anon;

DROP TRIGGER IF EXISTS prevent_trip_range_excluding_items ON public.trips;
CREATE TRIGGER prevent_trip_range_excluding_items
  BEFORE UPDATE OF start_date, end_date ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_trip_range_excluding_items();

-- Reorder all requested rows in one transaction. SECURITY DEFINER is tightly
-- scoped by an explicit active-couple check and fixed search_path.
CREATE OR REPLACE FUNCTION public.reorder_trip_items(
  p_item_ids UUID[],
  p_sort_orders INTEGER[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_trip_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_item_ids IS NULL OR p_sort_orders IS NULL
    OR cardinality(p_item_ids) = 0
    OR cardinality(p_item_ids) <> cardinality(p_sort_orders)
    OR EXISTS (
      SELECT 1 FROM unnest(p_sort_orders) AS value
      WHERE value IS NULL OR value < 0
    )
    OR (SELECT count(*) FROM unnest(p_item_ids) AS value)
       <> (SELECT count(DISTINCT value) FROM unnest(p_item_ids) AS value)
  THEN
    RAISE EXCEPTION 'Invalid trip item reorder payload';
  END IF;

  PERFORM 1
  FROM public.trip_items
  WHERE id = ANY(p_item_ids)
  FOR UPDATE;

  SELECT count(*), min(trip_id::TEXT)::UUID
    INTO v_count, v_trip_id
  FROM public.trip_items
  WHERE id = ANY(p_item_ids);

  IF v_count <> cardinality(p_item_ids)
    OR EXISTS (
      SELECT 1 FROM public.trip_items
      WHERE id = ANY(p_item_ids) AND trip_id <> v_trip_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.trips
      WHERE id = v_trip_id
        AND couple_id = public.get_my_active_couple_id()
    )
  THEN
    RAISE EXCEPTION 'Trip items are not in the active couple workspace';
  END IF;

  UPDATE public.trip_items AS item
  SET sort_order = input.sort_order,
      updated_at = now()
  FROM unnest(p_item_ids, p_sort_orders) AS input(id, sort_order)
  WHERE item.id = input.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_trip_items(UUID[], INTEGER[]) TO authenticated;

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
  shared_for_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::DATE),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cycle_support_signals
  ALTER COLUMN shared_for_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::DATE);

COMMENT ON TABLE public.cycle_support_signals IS
  'Explicit opt-in support only; optional message is user-entered partner-visible text and must not contain private details or raw cycle data.';
COMMENT ON COLUMN public.cycle_support_signals.message IS
  'Optional user-entered text shown verbatim to the partner; must not contain private details.';
COMMENT ON COLUMN public.cycle_support_signals.shared_for_date IS
  'Forced to the current Asia/Seoul date by the database; never derived from cycle_entries.';

CREATE OR REPLACE FUNCTION public.enforce_cycle_support_signal_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_korea_date DATE;
BEGIN
  v_korea_date := (v_now AT TIME ZONE 'Asia/Seoul')::DATE;
  IF auth.uid() IS NULL OR NEW.owner_id <> auth.uid()
    OR NEW.couple_id <> public.get_my_active_couple_id()
  THEN
    RAISE EXCEPTION 'Support signal is outside the active couple workspace';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := v_now;
    NEW.updated_at := v_now;
    NEW.shared_for_date := v_korea_date;
    NEW.revoked_at := NULL;
    IF NEW.expires_at <= v_now OR NEW.expires_at > v_now + INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'Support signal expiry must be within the next 24 hours';
    END IF;

    -- Serialize same-owner/day creation so concurrent inserts cannot both
    -- remain active before the unique index is checked.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.owner_id::TEXT || ':' || v_korea_date::TEXT, 0)
    );
    UPDATE public.cycle_support_signals
    SET revoked_at = v_now,
        updated_at = v_now
    WHERE owner_id = NEW.owner_id
      AND shared_for_date = v_korea_date
      AND revoked_at IS NULL;
    RETURN NEW;
  END IF;

  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.message IS DISTINCT FROM OLD.message
    OR NEW.shared_for_date IS DISTINCT FROM OLD.shared_for_date
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
  THEN
    RAISE EXCEPTION 'Support signal fields are immutable except one-way revoke';
  END IF;
  NEW.revoked_at := v_now;
  NEW.updated_at := v_now;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cycle_support_signal_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_cycle_support_signal_contract() FROM anon;

DROP TRIGGER IF EXISTS enforce_cycle_support_signal_contract
  ON public.cycle_support_signals;

-- Normalize pre-existing duplicates before adding the concurrency backstop.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY owner_id, shared_for_date ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.cycle_support_signals
  WHERE revoked_at IS NULL
)
UPDATE public.cycle_support_signals AS signal
SET revoked_at = now(), updated_at = now()
FROM ranked
WHERE signal.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_support_signals_one_active_owner_date
  ON public.cycle_support_signals (owner_id, shared_for_date)
  WHERE revoked_at IS NULL;

CREATE TRIGGER enforce_cycle_support_signal_contract
  BEFORE INSERT OR UPDATE ON public.cycle_support_signals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cycle_support_signal_contract();

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
    AND shared_for_date = (now() AT TIME ZONE 'Asia/Seoul')::DATE
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
        AND tablename = 'couple_members'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_members;
    END IF;

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
-- Back up first. In one transaction: remove the four new realtime entries,
-- drop cycle_support_signals, drop cycle_entries_symptoms_check and symptoms,
-- restore the event_type check/policies and trip policies from migration 011.
-- Data written with event_type = 'date' must be migrated before restoring the
-- old event_type constraint.
