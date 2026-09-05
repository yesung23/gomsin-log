-- 090: optional photo pairs over the existing private record-media ledger.
-- Measurements are client-reported, NOT decoded/verified Storage bytes.
-- Attachment documents, crypto and cleanup contract 4 are unchanged.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.begin_record_media_mutation(uuid,uuid,uuid,uuid,bigint,bigint,text[],uuid[])') IS NULL
    OR to_regprocedure('public.record_media_cleanup_contract_version()') IS NULL THEN
    RAISE EXCEPTION 'photo_media_lifecycle_required';
  END IF;
  IF pg_get_functiondef('public.record_media_cleanup_contract_version()'::regprocedure)
    !~ 'RETURN 4;' THEN
    RAISE EXCEPTION 'photo_cleanup_contract_4_required';
  END IF;
END;
$$;
LOCK TABLE public.record_media_mutations IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE public.record_media_mutations
  DROP CONSTRAINT record_media_mutations_desired_object_count_check,
  DROP CONSTRAINT record_media_mutations_upload_reservation_count_check,
  ADD CONSTRAINT record_media_mutations_desired_object_count_check
    CHECK (desired_object_count BETWEEN 0 AND 64),
  ADD CONSTRAINT record_media_mutations_upload_reservation_count_check
    CHECK (upload_reservation_count BETWEEN 0 AND 64);

CREATE TABLE public.record_photo_metadata (
  master_media_object_id UUID PRIMARY KEY REFERENCES public.record_media_objects(media_object_id),
  thumbnail_media_object_id UUID UNIQUE NOT NULL REFERENCES public.record_media_objects(media_object_id),
  record_id UUID NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  couple_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  master_width_px INTEGER NOT NULL CHECK (master_width_px BETWEEN 1 AND 2048),
  master_height_px INTEGER NOT NULL CHECK (master_height_px BETWEEN 1 AND 2048),
  master_byte_size BIGINT NOT NULL CHECK (master_byte_size BETWEEN 1 AND 10485760),
  master_sha256 TEXT NOT NULL CHECK (master_sha256 ~ '^[0-9a-f]{64}$'),
  thumbnail_width_px INTEGER NOT NULL CHECK (thumbnail_width_px BETWEEN 1 AND 640),
  thumbnail_height_px INTEGER NOT NULL CHECK (thumbnail_height_px BETWEEN 1 AND 640),
  thumbnail_byte_size BIGINT NOT NULL CHECK (thumbnail_byte_size BETWEEN 1 AND 1048576),
  thumbnail_sha256 TEXT NOT NULL CHECK (thumbnail_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (master_media_object_id <> thumbnail_media_object_id),
  CHECK (thumbnail_width_px <= master_width_px AND thumbnail_height_px <= master_height_px)
);
CREATE INDEX record_photo_metadata_record_idx ON public.record_photo_metadata(record_id, master_media_object_id);
CREATE INDEX record_photo_metadata_operation_idx ON public.record_photo_metadata(operation_id);
ALTER TABLE public.record_photo_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.record_photo_metadata FROM PUBLIC, anon, authenticated, service_role;

-- Keep registration history private until record/account cascade: terminal
-- operation retries still need immutable descriptors to reject changed bytes.
-- This is ledger-bound history, never a source for Storage cleanup or read access.
CREATE FUNCTION public.guard_record_photo_metadata_090()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'photo_metadata_immutable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.record_photo_metadata AS photo
    WHERE photo.master_media_object_id = NEW.thumbnail_media_object_id
      OR photo.thumbnail_media_object_id = NEW.master_media_object_id
  ) OR (SELECT count(*) FROM public.record_media_objects AS media
    JOIN public.record_media_mutation_items AS item
      ON item.media_object_id = media.media_object_id
      AND item.operation_id = NEW.operation_id AND item.upload_reservation
    JOIN public.record_media_mutations AS mutation ON mutation.operation_id = item.operation_id
    WHERE media.media_object_id IN (NEW.master_media_object_id, NEW.thumbnail_media_object_id)
      AND media.record_id = NEW.record_id AND media.owner_user_id = NEW.owner_user_id
      AND media.couple_id = NEW.couple_id AND media.reservation_operation_id = NEW.operation_id
      AND media.state = 'reserved' AND mutation.state = 'pending'
      AND mutation.record_id = NEW.record_id AND mutation.owner_user_id = NEW.owner_user_id
      AND mutation.couple_id = NEW.couple_id) <> 2 THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_record_photo_metadata_090 BEFORE INSERT OR UPDATE ON public.record_photo_metadata
FOR EACH ROW EXECUTE FUNCTION public.guard_record_photo_metadata_090();

-- Exact 084 reservation implementation, copied here with only its private name
-- and physical bound changed. Public wrappers below own the logical bound.
CREATE FUNCTION public.begin_record_media_mutation_internal_090(
  p_operation_id UUID,
  p_record_id UUID,
  p_expected_user_id UUID,
  p_expected_couple_id UUID,
  p_base_content_revision BIGINT,
  p_target_content_revision BIGINT,
  p_existing_paths TEXT[],
  p_new_media_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_record public.daily_records%ROWTYPE;
  v_existing public.record_media_mutations%ROWTYPE;
  v_object RECORD;
  v_path TEXT;
  v_name TEXT;
  v_media_object_id UUID;
  v_ledger public.record_media_objects%ROWTYPE;
  v_desired_ids UUID[] := ARRAY[]::UUID[];
  v_existing_ids UUID[];
  v_matched_paths INTEGER := 0;
  v_path_count INTEGER := coalesce(array_length(p_existing_paths, 1), 0);
  v_new_count INTEGER := coalesce(array_length(p_new_media_ids, 1), 0);
  v_state TEXT;
BEGIN
  IF v_uid IS NULL
    OR p_operation_id IS NULL
    OR p_record_id IS NULL
    OR p_expected_user_id IS NULL
    OR p_expected_couple_id IS NULL
    OR p_expected_user_id IS DISTINCT FROM v_uid
    OR p_base_content_revision IS NULL
    OR p_base_content_revision < 1
    OR p_target_content_revision IS DISTINCT FROM p_base_content_revision + 1
    OR v_path_count + v_new_count > 64
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_existing_paths, ARRAY[]::TEXT[])) AS item WHERE item IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(coalesce(p_new_media_ids, ARRAY[]::UUID[])) AS item WHERE item IS NULL)
    OR v_path_count IS DISTINCT FROM (
      SELECT count(DISTINCT item) FROM unnest(coalesce(p_existing_paths, ARRAY[]::TEXT[])) AS item
    )
    OR v_new_count IS DISTINCT FROM (
      SELECT count(DISTINCT item) FROM unnest(coalesce(p_new_media_ids, ARRAY[]::UUID[])) AS item
    )
  THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_account_write_open(ARRAY[v_uid]::UUID[], true);

  PERFORM 1
  FROM public.couples AS relationship
  JOIN public.couple_members AS member
    ON member.couple_id = relationship.id
  WHERE relationship.id = p_expected_couple_id
    AND relationship.closed_at IS NULL
    AND member.user_id = v_uid
    AND member.status = 'active'
  FOR UPDATE OF relationship;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT record.*
  INTO v_record
  FROM public.daily_records AS record
  WHERE record.id = p_record_id
    AND record.user_id = v_uid
    AND record.couple_id = p_expected_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT mutation.*
  INTO v_existing
  FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.operation_id IS DISTINCT FROM p_operation_id
      OR v_existing.record_id IS DISTINCT FROM p_record_id
      OR v_existing.couple_id IS DISTINCT FROM p_expected_couple_id
      OR v_existing.owner_user_id IS DISTINCT FROM v_uid
      OR v_existing.base_content_revision IS DISTINCT FROM p_base_content_revision
      OR v_existing.target_content_revision IS DISTINCT FROM p_target_content_revision
      OR v_existing.desired_object_count IS DISTINCT FROM v_path_count + v_new_count
      OR v_existing.upload_reservation_count IS DISTINCT FROM v_new_count
    THEN
      RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
    END IF;
    IF v_existing.state IS DISTINCT FROM 'pending' THEN
      RETURN jsonb_build_object(
        'operation_id', p_operation_id,
        'state', v_existing.state,
        'base_content_revision', v_existing.base_content_revision,
        'target_content_revision', v_existing.target_content_revision,
        'desired_object_count', v_existing.desired_object_count
      );
    END IF;
  ELSE
    IF v_record.content_revision IS DISTINCT FROM p_base_content_revision THEN
      RAISE EXCEPTION 'media_mutation_stale_revision' USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.record_media_mutations AS mutation
      WHERE mutation.record_id = p_record_id
        AND mutation.state = 'pending'
    ) THEN
      RAISE EXCEPTION 'media_mutation_busy' USING ERRCODE = '40001';
    END IF;
    INSERT INTO public.record_media_mutations (
      operation_id,
      record_id,
      couple_id,
      owner_user_id,
      base_content_revision,
      target_content_revision,
      desired_object_count,
      upload_reservation_count
    ) VALUES (
      p_operation_id,
      p_record_id,
      p_expected_couple_id,
      v_uid,
      p_base_content_revision,
      p_target_content_revision,
      v_path_count + v_new_count,
      v_new_count
    );
    v_existing.state := 'pending';
  END IF;

  -- Existing ledger rows are locked before Storage is consulted.
  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.record_id = p_record_id
  ORDER BY media.media_object_id
  FOR UPDATE;

  -- Every canonical Storage INSERT holds this same transaction lock from its
  -- BEFORE trigger through commit.  Taking it after the deterministic
  -- record/mutation/object locks drains only this record's earlier uploader;
  -- unrelated records and couples remain concurrent.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('record-media-record:' || p_record_id::TEXT, 0)
  );

  FOREACH v_path IN ARRAY coalesce(p_existing_paths, ARRAY[]::TEXT[])
  LOOP
    IF array_length(storage.foldername(v_path), 1) IS DISTINCT FROM 2
      OR (storage.foldername(v_path))[1] IS DISTINCT FROM p_expected_couple_id::TEXT
      OR (storage.foldername(v_path))[2] IS DISTINCT FROM p_record_id::TEXT
      OR storage.filename(v_path) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
    THEN
      RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF v_record.media_contract_version = 0 THEN
    FOR v_object IN
      SELECT object.id, object.name
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) = 2
        AND (storage.foldername(object.name))[1] = p_expected_couple_id::TEXT
        AND (storage.foldername(object.name))[2] = p_record_id::TEXT
      ORDER BY object.id
    LOOP
      SELECT media.*
      INTO v_ledger
      FROM public.record_media_objects AS media
      WHERE media.storage_object_id = v_object.id;

      IF FOUND THEN
        IF v_ledger.record_id IS DISTINCT FROM p_record_id
          OR v_ledger.couple_id IS DISTINCT FROM p_expected_couple_id
          OR v_ledger.owner_user_id IS DISTINCT FROM v_uid
          OR v_ledger.state NOT IN ('active', 'reserved')
        THEN
          RAISE EXCEPTION 'media_object_id_retired' USING ERRCODE = '55000';
        END IF;
        v_media_object_id := v_ledger.media_object_id;
      ELSE
        v_name := storage.filename(v_object.name);
        v_media_object_id := public.record_media_uuid_from_name(v_name);
        IF v_media_object_id IS NULL THEN
          v_media_object_id := gen_random_uuid();
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.record_media_objects AS media
          WHERE media.media_object_id = v_media_object_id
        ) THEN
          RAISE EXCEPTION 'media_object_id_retired' USING ERRCODE = '55000';
        END IF;
        INSERT INTO public.record_media_objects (
          media_object_id,
          storage_object_id,
          record_id,
          couple_id,
          owner_user_id,
          state
        ) VALUES (
          v_media_object_id,
          v_object.id,
          p_record_id,
          p_expected_couple_id,
          v_uid,
          'active'
        );
      END IF;

      IF v_object.name = ANY(coalesce(p_existing_paths, ARRAY[]::TEXT[])) THEN
        v_desired_ids := array_append(v_desired_ids, v_media_object_id);
        v_matched_paths := v_matched_paths + 1;
      END IF;
    END LOOP;
  ELSE
    FOREACH v_path IN ARRAY coalesce(p_existing_paths, ARRAY[]::TEXT[])
    LOOP
      SELECT object.id
      INTO v_object
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND object.name = v_path;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
      END IF;

      SELECT media.*
      INTO v_ledger
      FROM public.record_media_objects AS media
      WHERE media.storage_object_id = v_object.id;
      IF NOT FOUND
        OR v_ledger.record_id IS DISTINCT FROM p_record_id
        OR v_ledger.couple_id IS DISTINCT FROM p_expected_couple_id
        OR v_ledger.owner_user_id IS DISTINCT FROM v_uid
        OR (
          v_ledger.state IS DISTINCT FROM 'active'
          AND NOT (
            v_ledger.state = 'reserved'
            AND v_ledger.reservation_operation_id = p_operation_id
          )
        )
      THEN
        RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
      END IF;
      v_desired_ids := array_append(v_desired_ids, v_ledger.media_object_id);
      v_matched_paths := v_matched_paths + 1;
    END LOOP;
  END IF;

  IF v_matched_paths IS DISTINCT FROM v_path_count THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  FOREACH v_media_object_id IN ARRAY coalesce(p_new_media_ids, ARRAY[]::UUID[])
  LOOP
    SELECT media.*
    INTO v_ledger
    FROM public.record_media_objects AS media
    WHERE media.media_object_id = v_media_object_id;
    IF FOUND THEN
      IF v_ledger.record_id IS DISTINCT FROM p_record_id
        OR v_ledger.couple_id IS DISTINCT FROM p_expected_couple_id
        OR v_ledger.owner_user_id IS DISTINCT FROM v_uid
        OR v_ledger.reservation_operation_id IS DISTINCT FROM p_operation_id
        OR v_ledger.state IS DISTINCT FROM 'reserved'
      THEN
        RAISE EXCEPTION 'media_object_id_retired' USING ERRCODE = '55000';
      END IF;
    ELSE
      INSERT INTO public.record_media_objects (
        media_object_id,
        record_id,
        couple_id,
        owner_user_id,
        reservation_operation_id,
        state
      ) VALUES (
        v_media_object_id,
        p_record_id,
        p_expected_couple_id,
        v_uid,
        p_operation_id,
        'reserved'
      );
    END IF;
    v_desired_ids := array_append(v_desired_ids, v_media_object_id);
  END LOOP;

  IF coalesce(array_length(v_desired_ids, 1), 0) IS DISTINCT FROM v_path_count + v_new_count
    OR coalesce(array_length(v_desired_ids, 1), 0) IS DISTINCT FROM (
      SELECT count(DISTINCT item) FROM unnest(v_desired_ids) AS item
    )
  THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.record_media_mutation_items (
    operation_id,
    media_object_id,
    upload_reservation
  )
  SELECT
    p_operation_id,
    desired.media_object_id,
    desired.media_object_id = ANY(coalesce(p_new_media_ids, ARRAY[]::UUID[]))
  FROM unnest(v_desired_ids) AS desired(media_object_id)
  ON CONFLICT (operation_id, media_object_id) DO NOTHING;

  SELECT array_agg(item.media_object_id ORDER BY item.media_object_id)
  INTO v_existing_ids
  FROM public.record_media_mutation_items AS item
  WHERE item.operation_id = p_operation_id;

  SELECT array_agg(item ORDER BY item)
  INTO v_desired_ids
  FROM unnest(v_desired_ids) AS item;

  IF coalesce(v_existing_ids, ARRAY[]::UUID[]) IS DISTINCT FROM coalesce(v_desired_ids, ARRAY[]::UUID[])
    OR EXISTS (
      SELECT 1
      FROM public.record_media_mutation_items AS item
      WHERE item.operation_id = p_operation_id
        AND item.upload_reservation IS DISTINCT FROM
          (item.media_object_id = ANY(coalesce(p_new_media_ids, ARRAY[]::UUID[])))
    )
  THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT mutation.state
  INTO v_state
  FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'state', v_state,
    'base_content_revision', p_base_content_revision,
    'target_content_revision', p_target_content_revision,
    'desired_object_count', v_path_count + v_new_count
  );
END;
$$;

CREATE FUNCTION public.normalize_record_photos_090(p_photos JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_photo JSONB; v_part JSONB; v_role TEXT; v_key TEXT;
  v_result JSONB := '[]'::JSONB; v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF jsonb_typeof(p_photos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_photos) > 32 THEN
    RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_photo IN SELECT value FROM jsonb_array_elements(p_photos) LOOP
    IF jsonb_typeof(v_photo) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v_photo) key)
      IS DISTINCT FROM ARRAY['screen_master','thumbnail']::TEXT[] THEN
      RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['screen_master','thumbnail'] LOOP
      v_part := v_photo -> v_role;
      IF jsonb_typeof(v_part) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
      END IF;
      IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v_part) key)
        IS DISTINCT FROM ARRAY['byte_size','height_px','media_object_id','sha256','width_px']::TEXT[]
        OR jsonb_typeof(v_part->'media_object_id') IS DISTINCT FROM 'string'
        OR (v_part->>'media_object_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR jsonb_typeof(v_part->'sha256') IS DISTINCT FROM 'string'
        OR (v_part->>'sha256') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
      END IF;
      FOREACH v_key IN ARRAY ARRAY['width_px','height_px','byte_size'] LOOP
        IF jsonb_typeof(v_part->v_key) IS DISTINCT FROM 'number'
          OR (v_part->>v_key) !~ '^[1-9][0-9]{0,7}$' THEN
          RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      IF (v_part->>'width_px')::INTEGER > (CASE WHEN v_role='thumbnail' THEN 640 ELSE 2048 END)
        OR (v_part->>'height_px')::INTEGER > (CASE WHEN v_role='thumbnail' THEN 640 ELSE 2048 END)
        OR (v_part->>'byte_size')::BIGINT > (CASE WHEN v_role='thumbnail' THEN 1048576 ELSE 10485760 END) THEN
        RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
      END IF;
      v_ids := array_append(v_ids, (v_part->>'media_object_id')::UUID);
    END LOOP;
    IF (v_photo->'thumbnail'->>'width_px')::INTEGER > (v_photo->'screen_master'->>'width_px')::INTEGER
      OR (v_photo->'thumbnail'->>'height_px')::INTEGER > (v_photo->'screen_master'->>'height_px')::INTEGER THEN
      RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
    END IF;
    v_result := v_result || jsonb_build_array(v_photo);
  END LOOP;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT id) FROM unnest(v_ids) id) THEN
    RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(value ORDER BY value->'screen_master'->>'media_object_id')
    FROM jsonb_array_elements(v_result)), '[]'::JSONB);
END;
$$;

-- Private common entry: acquire the same account/couple/record locks as 084
-- BEFORE inspecting/expanding pair bindings. No new object/advisory lock order.
CREATE FUNCTION public.begin_record_photo_dispatch_090(
  p_operation_id UUID, p_record_id UUID, p_expected_user_id UUID, p_expected_couple_id UUID,
  p_base_content_revision BIGINT, p_target_content_revision BIGINT,
  p_existing_paths TEXT[], p_new_media_ids UUID[], p_new_photos JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_paths TEXT[] := coalesce(p_existing_paths, ARRAY[]::TEXT[]);
  v_ids UUID[] := coalesce(p_new_media_ids, ARRAY[]::UUID[]);
  v_photos JSONB; v_photo JSONB; v_registered JSONB;
  v_pair public.record_photo_metadata%ROWTYPE;
  v_master_path TEXT; v_thumb_path TEXT;
  v_logical INTEGER; v_result JSONB;
  v_operation public.record_media_mutations%ROWTYPE;
  v_desired UUID[]; v_old_ids UUID[];
BEGIN
  IF v_uid IS NULL OR v_uid IS DISTINCT FROM p_expected_user_id
    OR p_operation_id IS NULL OR p_record_id IS NULL OR p_expected_couple_id IS NULL THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_ndims(v_paths),1) <> 1 OR coalesce(array_ndims(v_ids),1) <> 1
    OR cardinality(v_paths) > 64 OR cardinality(v_ids) > 32
    OR EXISTS (SELECT 1 FROM unnest(v_paths) x WHERE x IS NULL)
    OR EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE x IS NULL)
    OR cardinality(v_paths) <> (SELECT count(DISTINCT x) FROM unnest(v_paths) x)
    OR cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE = '42501';
  END IF;
  -- Validate namespace before 084's terminal replay fast path, too.
  IF EXISTS (SELECT 1 FROM unnest(v_paths) path
    WHERE array_length(storage.foldername(path),1) IS DISTINCT FROM 2
      OR (storage.foldername(path))[1] IS DISTINCT FROM p_expected_couple_id::TEXT
      OR (storage.foldername(path))[2] IS DISTINCT FROM p_record_id::TEXT
      OR storage.filename(path) !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$') THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;
  IF p_new_photos IS NOT NULL THEN
    v_photos := public.normalize_record_photos_090(p_new_photos);
    SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::UUID[]) INTO v_ids FROM (
      SELECT (value->'screen_master'->>'media_object_id')::UUID id FROM jsonb_array_elements(v_photos)
      UNION ALL
      SELECT (value->'thumbnail'->>'media_object_id')::UUID FROM jsonb_array_elements(v_photos)
    ) ids;
  END IF;
  PERFORM public.assert_account_write_open(ARRAY[v_uid]::UUID[], true);
  PERFORM 1 FROM public.couples c JOIN public.couple_members m ON m.couple_id=c.id
    WHERE c.id=p_expected_couple_id AND c.closed_at IS NULL AND m.user_id=v_uid AND m.status='active'
    FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.daily_records r WHERE r.id=p_record_id
    AND r.user_id=v_uid AND r.couple_id=p_expected_couple_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501'; END IF;

  IF v_photos IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.record_media_objects media WHERE media.media_object_id=ANY(v_ids)
      AND (media.record_id IS DISTINCT FROM p_record_id
        OR media.owner_user_id IS DISTINCT FROM v_uid
        OR media.couple_id IS DISTINCT FROM p_expected_couple_id)
  ) THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;
  v_logical := cardinality(v_paths) + CASE WHEN v_photos IS NULL
    THEN cardinality(v_ids) ELSE jsonb_array_length(v_photos) END;
  FOR v_pair IN SELECT * FROM public.record_photo_metadata
    WHERE record_id=p_record_id AND owner_user_id=v_uid AND couple_id=p_expected_couple_id LOOP
    v_master_path := p_expected_couple_id::TEXT||'/'||p_record_id::TEXT||'/'||v_pair.master_media_object_id::TEXT||'.jpg';
    v_thumb_path := p_expected_couple_id::TEXT||'/'||p_record_id::TEXT||'/'||v_pair.thumbnail_media_object_id::TEXT||'.jpg';
    IF v_thumb_path = ANY(v_paths) THEN
      IF NOT v_master_path = ANY(v_paths) THEN
        RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
      END IF;
      v_logical := v_logical - 1;
    ELSIF v_master_path = ANY(v_paths) THEN
      v_paths := array_append(v_paths,v_thumb_path);
    END IF;
  END LOOP;
  IF v_logical > 32 THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_operation FROM public.record_media_mutations
    WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND AND v_photos IS NOT NULL THEN
    IF v_operation.record_id IS DISTINCT FROM p_record_id
      OR v_operation.owner_user_id IS DISTINCT FROM v_uid
      OR v_operation.couple_id IS DISTINCT FROM p_expected_couple_id THEN
      RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'screen_master',jsonb_build_object('media_object_id',master_media_object_id,'width_px',master_width_px,
        'height_px',master_height_px,'byte_size',master_byte_size,'sha256',master_sha256),
      'thumbnail',jsonb_build_object('media_object_id',thumbnail_media_object_id,'width_px',thumbnail_width_px,
        'height_px',thumbnail_height_px,'byte_size',thumbnail_byte_size,'sha256',thumbnail_sha256))
      ORDER BY master_media_object_id), '[]'::JSONB)
    INTO v_registered FROM public.record_photo_metadata WHERE operation_id=p_operation_id;
    -- Validate the manifest even on a terminal operation (084 returns early).
    SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::UUID[]) INTO v_desired FROM (
      SELECT unnest(v_ids) id UNION ALL
      SELECT coalesce(media.media_object_id, public.record_media_uuid_from_name(storage.filename(path)))
      FROM unnest(v_paths) path
      LEFT JOIN storage.objects object ON object.bucket_id='couple-media' AND object.name=path
      LEFT JOIN public.record_media_objects media ON media.storage_object_id=object.id
    ) desired;
    SELECT coalesce(array_agg(media_object_id ORDER BY media_object_id),ARRAY[]::UUID[])
      INTO v_old_ids FROM public.record_media_mutation_items WHERE operation_id=p_operation_id;
    IF v_registered IS DISTINCT FROM v_photos OR v_desired IS DISTINCT FROM v_old_ids
      OR v_operation.base_content_revision IS DISTINCT FROM p_base_content_revision
      OR v_operation.target_content_revision IS DISTINCT FROM p_target_content_revision
      OR EXISTS (SELECT 1 FROM public.record_media_mutation_items item WHERE item.operation_id=p_operation_id
        AND item.upload_reservation IS DISTINCT FROM (item.media_object_id=ANY(v_ids))) THEN
      RAISE EXCEPTION 'photo_operation_conflict' USING ERRCODE='40001';
    END IF;
  END IF;

  BEGIN
    v_result := public.begin_record_media_mutation_internal_090(p_operation_id,p_record_id,v_uid,p_expected_couple_id,
      p_base_content_revision,p_target_content_revision,v_paths,v_ids);
  EXCEPTION WHEN unique_violation THEN
    -- Another record/couple can race on a caller-supplied global UUID. Roll
    -- back this reservation and expose no conflicting row identity/details.
    IF v_photos IS NOT NULL THEN
      RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
    END IF;
    RAISE;
  END;
  IF v_operation.operation_id IS NULL AND v_photos IS NOT NULL THEN
    FOR v_photo IN SELECT value FROM jsonb_array_elements(v_photos) LOOP
      INSERT INTO public.record_photo_metadata (
        master_media_object_id,thumbnail_media_object_id,record_id,owner_user_id,couple_id,operation_id,
        master_width_px,master_height_px,master_byte_size,master_sha256,
        thumbnail_width_px,thumbnail_height_px,thumbnail_byte_size,thumbnail_sha256
      ) VALUES (
        (v_photo->'screen_master'->>'media_object_id')::UUID,(v_photo->'thumbnail'->>'media_object_id')::UUID,
        p_record_id,v_uid,p_expected_couple_id,p_operation_id,
        (v_photo->'screen_master'->>'width_px')::INTEGER,(v_photo->'screen_master'->>'height_px')::INTEGER,
        (v_photo->'screen_master'->>'byte_size')::BIGINT,v_photo->'screen_master'->>'sha256',
        (v_photo->'thumbnail'->>'width_px')::INTEGER,(v_photo->'thumbnail'->>'height_px')::INTEGER,
        (v_photo->'thumbnail'->>'byte_size')::BIGINT,v_photo->'thumbnail'->>'sha256'
      );
    END LOOP;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_record_media_mutation(
  p_operation_id UUID,p_record_id UUID,p_expected_user_id UUID,p_expected_couple_id UUID,
  p_base_content_revision BIGINT,p_target_content_revision BIGINT,p_existing_paths TEXT[],p_new_media_ids UUID[]
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.begin_record_photo_dispatch_090(p_operation_id,p_record_id,p_expected_user_id,p_expected_couple_id,
    p_base_content_revision,p_target_content_revision,p_existing_paths,p_new_media_ids,NULL::JSONB);
$$;
CREATE FUNCTION public.begin_record_photo_mutation(
  p_operation_id UUID,p_record_id UUID,p_expected_user_id UUID,p_expected_couple_id UUID,
  p_base_content_revision BIGINT,p_target_content_revision BIGINT,p_existing_paths TEXT[],p_new_photos JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;
  IF p_new_photos IS NULL THEN
    RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE='22023';
  END IF;
  RETURN public.begin_record_photo_dispatch_090(p_operation_id,p_record_id,p_expected_user_id,p_expected_couple_id,
    p_base_content_revision,p_target_content_revision,p_existing_paths,ARRAY[]::UUID[],p_new_photos);
END;
$$;

-- Defense at publication as well as reservation: no half-pair manifests, and
-- reported JPEG pairs use canonical .jpg names. This does not inspect bytes.
CREATE FUNCTION public.guard_record_photo_publication_090()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count INTEGER; v_thumbs INTEGER;
BEGIN
  IF NEW.last_media_operation_id IS NULL
    OR NEW.last_media_operation_id IS NOT DISTINCT FROM OLD.last_media_operation_id THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.record_photo_metadata photo WHERE photo.record_id=NEW.id
    AND EXISTS (SELECT 1 FROM public.record_media_mutation_items item
      WHERE item.operation_id=NEW.last_media_operation_id
        AND item.media_object_id IN(photo.master_media_object_id,photo.thumbnail_media_object_id))
    AND (SELECT count(*) FROM public.record_media_mutation_items item
      WHERE item.operation_id=NEW.last_media_operation_id
        AND item.media_object_id IN(photo.master_media_object_id,photo.thumbnail_media_object_id)) <> 2
  ) THEN RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501'; END IF;
  SELECT count(*) INTO v_count FROM public.record_media_mutation_items
    WHERE operation_id=NEW.last_media_operation_id;
  SELECT count(*) INTO v_thumbs FROM public.record_photo_metadata photo
    JOIN public.record_media_mutation_items item ON item.media_object_id=photo.thumbnail_media_object_id
    WHERE item.operation_id=NEW.last_media_operation_id AND photo.record_id=NEW.id;
  IF v_count > 64 OR v_count-v_thumbs > 32 THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.record_photo_metadata photo
    JOIN public.record_media_objects media
      ON media.media_object_id IN(photo.master_media_object_id,photo.thumbnail_media_object_id)
    JOIN public.record_media_mutation_items item ON item.media_object_id=media.media_object_id
      AND item.operation_id=NEW.last_media_operation_id
    LEFT JOIN storage.objects object ON object.id=media.storage_object_id
    WHERE photo.record_id=NEW.id AND (object.id IS NULL OR object.bucket_id<>'couple-media'
      OR object.name IS DISTINCT FROM NEW.couple_id::TEXT||'/'||NEW.id::TEXT||'/'||media.media_object_id::TEXT||'.jpg')
  ) THEN RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zzz_090_record_photo_publication BEFORE UPDATE ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION public.guard_record_photo_publication_090();

CREATE FUNCTION public.can_read_record_photo_metadata_090(p_record_id UUID,p_master_id UUID,p_thumbnail_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.daily_records r
    JOIN public.couples c ON c.id=r.couple_id AND c.closed_at IS NULL
    JOIN public.couple_members m ON m.couple_id=c.id AND m.user_id=auth.uid() AND m.status='active'
    JOIN public.couple_members owner_member ON owner_member.couple_id=c.id
      AND owner_member.user_id=r.user_id AND owner_member.status='active'
    JOIN public.record_photo_metadata photo ON photo.record_id=r.id
      AND photo.master_media_object_id=p_master_id AND photo.thumbnail_media_object_id=p_thumbnail_id
      AND photo.owner_user_id=r.user_id AND photo.couple_id=r.couple_id
    JOIN public.record_media_mutations mutation ON mutation.operation_id=photo.operation_id AND mutation.state='committed'
    JOIN public.record_media_objects master ON master.media_object_id=photo.master_media_object_id
      AND master.state='active' AND master.record_id=r.id AND master.owner_user_id=r.user_id
      AND master.couple_id=r.couple_id AND master.reservation_operation_id=photo.operation_id
    JOIN public.record_media_objects thumb ON thumb.media_object_id=photo.thumbnail_media_object_id
      AND thumb.state='active' AND thumb.record_id=r.id AND thumb.owner_user_id=r.user_id
      AND thumb.couple_id=r.couple_id AND thumb.reservation_operation_id=photo.operation_id
    JOIN storage.objects master_object ON master_object.id=master.storage_object_id
      AND master_object.bucket_id='couple-media'
      AND master_object.name=r.couple_id::TEXT||'/'||r.id::TEXT||'/'||master.media_object_id::TEXT||'.jpg'
    JOIN storage.objects thumb_object ON thumb_object.id=thumb.storage_object_id
      AND thumb_object.bucket_id='couple-media'
      AND thumb_object.name=r.couple_id::TEXT||'/'||r.id::TEXT||'/'||thumb.media_object_id::TEXT||'.jpg'
    WHERE r.id=p_record_id AND r.cipher_format=0 AND r.media_contract_version=1
      AND r.couple_id=public.get_my_active_couple_id()
      AND (r.user_id=auth.uid() OR NOT r.is_private)
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d WHERE d.user_id IN(auth.uid(),r.user_id))
  );
$$;
-- No direct table grants, including authenticated. Same predicate is applied
-- explicitly inside the definer RPC because its owner bypasses table RLS.
CREATE POLICY record_photo_metadata_authorized_read ON public.record_photo_metadata FOR SELECT TO authenticated
USING(public.can_read_record_photo_metadata_090(record_id,master_media_object_id,thumbnail_media_object_id));

CREATE FUNCTION public.get_record_photo_metadata(p_record_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'media_mutation_unavailable' USING ERRCODE='42501';
  END IF;
  IF p_record_ids IS NULL OR coalesce(array_ndims(p_record_ids),1)<>1
    OR cardinality(p_record_ids)>100
    OR EXISTS(SELECT 1 FROM unnest(p_record_ids) id WHERE id IS NULL)
    OR cardinality(p_record_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_record_ids) id) THEN
    RAISE EXCEPTION 'photo_metadata_invalid' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'record_id',record_id,'media_id',master_media_object_id,'source_revision',operation_id,
    'screen_master',jsonb_build_object('media_object_id',master_media_object_id,'width_px',master_width_px,
      'height_px',master_height_px,'byte_size',master_byte_size,'sha256',master_sha256,'mime_type','image/jpeg'),
    'thumbnail',jsonb_build_object('media_object_id',thumbnail_media_object_id,'width_px',thumbnail_width_px,
      'height_px',thumbnail_height_px,'byte_size',thumbnail_byte_size,'sha256',thumbnail_sha256,'mime_type','image/jpeg')
    ) ORDER BY record_id,master_media_object_id),'[]'::JSONB) INTO v_result
  FROM public.record_photo_metadata WHERE record_id=ANY(p_record_ids)
    AND public.can_read_record_photo_metadata_090(record_id,master_media_object_id,thumbnail_media_object_id);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_record_photo_metadata_090() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_record_photo_publication_090() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.normalize_record_photos_090(JSONB) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.can_read_record_photo_metadata_090(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_record_media_mutation_internal_090(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],UUID[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_record_photo_dispatch_090(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],UUID[],JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_record_media_mutation(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],UUID[])
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_record_photo_mutation(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_record_photo_metadata(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_record_media_mutation(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_record_photo_mutation(UUID,UUID,UUID,UUID,BIGINT,BIGINT,TEXT[],JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_record_photo_metadata(UUID[]) TO authenticated;
-- Roll back by disabling the optional client path; retain this compatibility
-- wrapper while live pairs exist. Do not lower capacity/drop bindings on live data.
NOTIFY pgrst, 'reload schema';
COMMIT;
