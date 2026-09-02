-- 068_allow_story_product_event_screen.sql
--
-- V4's active partner briefing is `/story/partner`, but migration 049's closed
-- screen vocabulary predates that route and rejects `screen = 'story'`. Keep
-- the vocabulary closed while admitting the one production surface that now
-- owns both `briefing_opened` and `briefing_to_original`.
--
-- This changes no event kind, RLS policy, privilege, timestamp precision, or
-- payload shape. Existing rows are validated before the old constraint is
-- replaced, so an unexpected value aborts the transaction instead of silently
-- becoming accepted history.

BEGIN;

ALTER TABLE public.product_events
  ADD CONSTRAINT product_events_screen_check_v2
  CHECK (screen IS NULL OR screen IN (
    'home',
    'record',
    'schedule',
    'us',
    'my',
    'call',
    'story',
    'onboarding',
    'settings'
  )) NOT VALID;

ALTER TABLE public.product_events
  VALIDATE CONSTRAINT product_events_screen_check_v2;

ALTER TABLE public.product_events
  DROP CONSTRAINT product_events_screen_check;

ALTER TABLE public.product_events
  RENAME CONSTRAINT product_events_screen_check_v2 TO product_events_screen_check;

COMMIT;

NOTIFY pgrst, 'reload schema';
