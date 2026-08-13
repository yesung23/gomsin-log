-- =============================================================
-- 028_restore_couple_media_authorization.sql
-- Restore the missing read/delete authorization for couple-media.
-- =============================================================
--
-- Production audit on 2026-08-11 found a private bucket with only the INSERT
-- policy from migration 015. A repository migration existing is not proof that
-- it reached production, so this forward migration restates the complete final
-- policy set instead of editing 007 or assuming its SELECT/DELETE policies ran.
--
-- Canonical object path: {couple_id}/{record_id}/{filename}
-- Authorization is never granted from the path alone. Every policy also checks
-- the referenced daily_records row and the caller's current active couple.
--
-- The four name guards are not decoration. Without the length check a deeper
-- path keeps a valid couple/record prefix and would pass; `(^|/)\.` removes dot
-- segments; `//` removes empty ones; and `/$` rejects a trailing slash, which
-- otherwise yields a two-element foldername with an empty filename and escapes
-- the canonical shape while still satisfying every other predicate.

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('couple-media', 'couple-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Active members can insert into couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can read couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can delete from couple-media" ON storage.objects;
-- These names have never been canonical, but dropping them makes a replay safe
-- if an operator created either policy while trying to repair production.
DROP POLICY IF EXISTS "Active members can update couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update couple-media" ON storage.objects;

CREATE POLICY "Active members can insert into couple-media"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'couple-media'
    AND auth.uid() IS NOT NULL
    AND NOT public.is_my_account_deletion_pending()
    AND array_length(storage.foldername(name), 1) = 2
    AND name !~ '(^|/)\.'
    AND name !~ '//'
    AND name !~ '/$'
    AND (storage.foldername(name))[1] = public.get_my_active_couple_id()::TEXT
    AND EXISTS (
      SELECT 1
      FROM public.daily_records AS record
      WHERE record.id::TEXT = (storage.foldername(name))[2]
        AND record.couple_id::TEXT = (storage.foldername(name))[1]
        AND record.couple_id = public.get_my_active_couple_id()
        AND record.user_id = auth.uid()
    )
  );

CREATE POLICY "Active members can read couple-media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'couple-media'
    AND auth.uid() IS NOT NULL
    AND array_length(storage.foldername(name), 1) = 2
    AND name !~ '(^|/)\.'
    AND name !~ '//'
    AND name !~ '/$'
    AND (storage.foldername(name))[1] = public.get_my_active_couple_id()::TEXT
    AND EXISTS (
      SELECT 1
      FROM public.daily_records AS record
      WHERE record.id::TEXT = (storage.foldername(name))[2]
        AND record.couple_id::TEXT = (storage.foldername(name))[1]
        AND record.couple_id = public.get_my_active_couple_id()
        AND (
          record.user_id = auth.uid()
          OR (record.user_id <> auth.uid() AND record.is_private = false)
        )
    )
  );

CREATE POLICY "Active members can delete from couple-media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'couple-media'
    AND auth.uid() IS NOT NULL
    AND array_length(storage.foldername(name), 1) = 2
    AND name !~ '(^|/)\.'
    AND name !~ '//'
    AND name !~ '/$'
    AND (storage.foldername(name))[1] = public.get_my_active_couple_id()::TEXT
    AND EXISTS (
      SELECT 1
      FROM public.daily_records AS record
      WHERE record.id::TEXT = (storage.foldername(name))[2]
        AND record.couple_id::TEXT = (storage.foldername(name))[1]
        AND record.couple_id = public.get_my_active_couple_id()
        AND record.user_id = auth.uid()
    )
  );

-- Deliberately no UPDATE policy. Neither an owner nor a partner needs in-place
-- object mutation: uploads use upsert=false and replacements get a new path.
-- With RLS enabled, the absence of an UPDATE policy is the deny rule.

COMMIT;

-- Safe rollback direction (do not restore the broken production state):
-- keep the bucket private and keep owner-only SELECT/DELETE policies. If partner
-- reads cause a release issue, replace only the SELECT policy with the DELETE
-- policy's owner predicate. Never switch the bucket to public and never use
-- USING (true).
