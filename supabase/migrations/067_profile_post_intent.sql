-- 067: distinguish explicit profile posts from ordinary Story records.
--
-- Existing photo records are intentionally NOT backfilled. The old schema did
-- not preserve whether a photo was deliberately published to the profile grid,
-- and guessing would repeat the automatic Story-to-grid behaviour this migration
-- removes.

BEGIN;

ALTER TABLE public.daily_records
  ADD COLUMN is_profile_post BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.daily_records.is_profile_post IS
  'True only when the author explicitly publishes this record to the profile grid.';

NOTIFY pgrst, 'reload schema';

COMMIT;
