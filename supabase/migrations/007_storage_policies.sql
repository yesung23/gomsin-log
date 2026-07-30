-- 007_storage_policies.sql
-- 1. Create or Update bucket to be strictly private
INSERT INTO storage.buckets (id, name, public)
VALUES ('couple-media', 'couple-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Drop existing policies to prevent conflicts
DROP POLICY IF EXISTS "Active members can insert into couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can read couple-media" ON storage.objects;
DROP POLICY IF EXISTS "Active members can delete from couple-media" ON storage.objects;

-- 3. Path structure: {coupleId}/{recordId}/{attachmentId}.{ext}
-- foldername[1] = coupleId
-- foldername[2] = recordId

CREATE POLICY "Active members can insert into couple-media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'couple-media' AND
    (storage.foldername(name))[1] = public.get_my_active_couple_id()::text AND
    -- Ensure recordId exists and caller is the owner
    EXISTS (
      SELECT 1 FROM public.daily_records
      WHERE id::text = (storage.foldername(name))[2]
        AND user_id = auth.uid()
        AND couple_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Active members can read couple-media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'couple-media' AND
    (storage.foldername(name))[1] = public.get_my_active_couple_id()::text AND
    EXISTS (
      SELECT 1 FROM public.daily_records
      WHERE id::text = (storage.foldername(name))[2]
        AND couple_id::text = (storage.foldername(name))[1]
        AND (is_private = false OR user_id = auth.uid())
    )
  );

CREATE POLICY "Active members can delete from couple-media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'couple-media' AND
    (storage.foldername(name))[1] = public.get_my_active_couple_id()::text AND
    EXISTS (
      SELECT 1 FROM public.daily_records
      WHERE id::text = (storage.foldername(name))[2]
        AND user_id = auth.uid()
    )
  );
