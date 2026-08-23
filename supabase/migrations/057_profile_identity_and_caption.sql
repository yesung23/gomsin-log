-- 057_profile_identity_and_caption.sql
-- Profile identity is owner-only profile metadata. No RPC or shared projection is added.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS profile_caption TEXT,
  ADD COLUMN IF NOT EXISTS profile_date_type TEXT;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
    CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,19}$'),
  ADD CONSTRAINT profiles_profile_caption_length_check
    CHECK (profile_caption IS NULL OR char_length(profile_caption) <= 80),
  ADD CONSTRAINT profiles_profile_date_type_check
    CHECK (profile_date_type IS NULL OR profile_date_type IN ('together', 'meeting', 'discharge'));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
