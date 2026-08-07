-- Shared planning improvements: explicit call topics and timed travel stops.
-- Run this after 018 in Supabase SQL Editor.
BEGIN;

ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS talk_about BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS talk_about BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.trip_items
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS talk_about BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.trip_items DROP CONSTRAINT IF EXISTS trip_items_start_time_check;
ALTER TABLE public.trip_items ADD CONSTRAINT trip_items_start_time_check
  CHECK (start_time IS NULL OR start_time::text ~ '^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$');

-- A private record/event cannot accidentally become a shared call topic.
ALTER TABLE public.daily_records DROP CONSTRAINT IF EXISTS daily_records_talk_about_shared_check;
ALTER TABLE public.daily_records ADD CONSTRAINT daily_records_talk_about_shared_check
  CHECK (NOT talk_about OR NOT is_private);
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_talk_about_shared_check;
ALTER TABLE public.events ADD CONSTRAINT events_talk_about_shared_check
  CHECK (NOT talk_about OR NOT is_private);

NOTIFY pgrst, 'reload schema';
COMMIT;
