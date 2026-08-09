-- Restore the profile field required by onboarding and the service-status editor.
-- The production project was missing this column even though it is part of 001.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS military_info JSONB;

UPDATE public.profiles
SET military_info = '{}'::jsonb
WHERE military_info IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN military_info SET DEFAULT '{}'::jsonb,
  ALTER COLUMN military_info SET NOT NULL;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
