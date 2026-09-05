-- 084_record_media_object_lifecycle.sql
--
-- Forward-only media contract for encrypted records.  PostgreSQL stores only
-- opaque UUID identity, bounded lifecycle state, counts and timing metadata.
-- Storage paths are resolved transiently while a browser mutation or leased
-- worker is executing and are never written to a public ledger.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.record_media_mutations') IS NOT NULL
    OR to_regclass('public.record_media_mutation_items') IS NOT NULL
    OR to_regclass('public.record_media_objects') IS NOT NULL
    OR to_regprocedure('public.record_media_cleanup_contract_version()') IS NOT NULL
  THEN
    RAISE EXCEPTION 'migration_084_already_applied'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS media_contract_version SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_manifest_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_media_operation_id UUID;

ALTER TABLE public.daily_records
  ADD CONSTRAINT daily_records_media_contract_version_check
    CHECK (media_contract_version IN (0, 1)),
  ADD CONSTRAINT daily_records_media_manifest_revision_check
    CHECK (media_manifest_revision >= 0),
  ADD CONSTRAINT daily_records_media_contract_shape_check
    CHECK (
      (media_contract_version = 0
        AND media_manifest_revision = 0
        AND last_media_operation_id IS NULL)
      OR
      (media_contract_version = 1
        AND media_manifest_revision >= 1
        AND last_media_operation_id IS NOT NULL)
    );

-- No foreign keys are intentional.  Object tombstones must survive deletion
-- of Auth, couple and record rows, and direct table access is denied below.
CREATE TABLE public.record_media_mutations (
  operation_id UUID PRIMARY KEY,
  record_id UUID NOT NULL,
  couple_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  base_content_revision BIGINT NOT NULL CHECK (base_content_revision >= 1),
  target_content_revision BIGINT NOT NULL,
  desired_object_count SMALLINT NOT NULL
    CHECK (desired_object_count BETWEEN 0 AND 32),
  upload_reservation_count SMALLINT NOT NULL
    CHECK (upload_reservation_count BETWEEN 0 AND 32),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'committed', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  committed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  CHECK (target_content_revision = base_content_revision + 1),
  CHECK (upload_reservation_count <= desired_object_count),
  CHECK ((state = 'committed') = (committed_at IS NOT NULL)),
  CHECK ((state = 'abandoned') = (abandoned_at IS NOT NULL))
);

CREATE TABLE public.record_media_mutation_items (
  operation_id UUID NOT NULL,
  media_object_id UUID NOT NULL,
  upload_reservation BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id, media_object_id)
);

CREATE TABLE public.record_media_objects (
  media_object_id UUID PRIMARY KEY,
  storage_object_id UUID UNIQUE,
  record_id UUID NOT NULL,
  couple_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  reservation_operation_id UUID,
  state TEXT NOT NULL
    CHECK (
      state IN (
        'reserved',
        'active',
        'cleanup_pending',
        'leased',
        'blocked',
        'deleted',
        'superseded'
      )
    ),
  failure_count SMALLINT NOT NULL DEFAULT 0
    CHECK (failure_count BETWEEN 0 AND 8),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT
    CHECK (last_error_code IS NULL OR last_error_code ~ '^E_[A-Z0-9_]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ,
  CHECK ((state = 'leased') = (lease_expires_at IS NOT NULL)),
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE INDEX record_media_mutations_record_idx
  ON public.record_media_mutations (record_id, created_at, operation_id);
CREATE INDEX record_media_mutations_stale_idx
  ON public.record_media_mutations (created_at, operation_id)
  WHERE state = 'pending';
CREATE UNIQUE INDEX record_media_mutations_one_pending_record_idx
  ON public.record_media_mutations (record_id)
  WHERE state = 'pending';
CREATE INDEX record_media_mutation_items_object_idx
  ON public.record_media_mutation_items (media_object_id, operation_id);
CREATE INDEX record_media_objects_record_idx
  ON public.record_media_objects (record_id, media_object_id);
CREATE INDEX record_media_objects_claim_idx
  ON public.record_media_objects (next_attempt_at, created_at, media_object_id)
  WHERE state IN ('cleanup_pending', 'leased');
CREATE INDEX record_media_objects_owner_barrier_idx
  ON public.record_media_objects (owner_user_id, media_object_id)
  WHERE state IN ('cleanup_pending', 'leased', 'blocked');

ALTER TABLE public.record_media_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_media_mutation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_media_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.record_media_mutations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.record_media_mutation_items
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.record_media_objects
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_record_media_ledger_identity_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'record_media_mutations' THEN
    IF OLD.operation_id IS DISTINCT FROM NEW.operation_id
      OR OLD.record_id IS DISTINCT FROM NEW.record_id
      OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
      OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
      OR OLD.base_content_revision IS DISTINCT FROM NEW.base_content_revision
      OR OLD.target_content_revision IS DISTINCT FROM NEW.target_content_revision
      OR OLD.desired_object_count IS DISTINCT FROM NEW.desired_object_count
      OR OLD.upload_reservation_count IS DISTINCT FROM NEW.upload_reservation_count
    THEN
      RAISE EXCEPTION 'record_media_mutation_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'record_media_objects' THEN
    IF OLD.media_object_id IS DISTINCT FROM NEW.media_object_id
      OR OLD.record_id IS DISTINCT FROM NEW.record_id
      OR OLD.couple_id IS DISTINCT FROM NEW.couple_id
      OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
      OR (
        OLD.storage_object_id IS NOT NULL
        AND OLD.storage_object_id IS DISTINCT FROM NEW.storage_object_id
      )
    THEN
      RAISE EXCEPTION 'record_media_object_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_record_media_ledger_identity_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aaa_084_mutation_identity_immutable
  BEFORE UPDATE ON public.record_media_mutations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_record_media_ledger_identity_immutable();
CREATE TRIGGER aaa_084_object_identity_immutable
  BEFORE UPDATE ON public.record_media_objects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_record_media_ledger_identity_immutable();

CREATE FUNCTION public.record_media_uuid_from_name(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stem TEXT;
BEGIN
  v_stem := split_part(p_name, '.', 1);
  IF v_stem ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN v_stem::UUID;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_media_uuid_from_name(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- SELECT must stop at logical removal, not minutes later at physical cleanup.
-- A ledger identity (including an unbound canonical reservation) is
-- authoritative even while its record is still v0.  Only a truly unledgered
-- v0 object receives the legacy compatibility rule from migration 028.
CREATE FUNCTION public.can_read_record_media_object(
  p_storage_object_id UUID,
  p_object_name TEXT,
  p_record_id TEXT,
  p_couple_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_media_contract_version SMALLINT;
  v_media_object_id UUID;
  v_state TEXT;
  v_bound_storage_object_id UUID;
  v_ledger_record_id UUID;
  v_ledger_couple_id UUID;
BEGIN
  IF v_uid IS NULL
    OR p_storage_object_id IS NULL
    OR p_object_name IS NULL
    OR p_record_id IS NULL
    OR p_couple_id IS NULL
    OR array_length(storage.foldername(p_object_name), 1) IS DISTINCT FROM 2
    OR (storage.foldername(p_object_name))[1] IS DISTINCT FROM p_couple_id
    OR (storage.foldername(p_object_name))[2] IS DISTINCT FROM p_record_id
  THEN
    RETURN false;
  END IF;

  SELECT record.media_contract_version
  INTO v_media_contract_version
  FROM public.daily_records AS record
  JOIN public.couples AS relationship
    ON relationship.id = record.couple_id
   AND relationship.closed_at IS NULL
  JOIN public.couple_members AS member
    ON member.couple_id = relationship.id
   AND member.user_id = v_uid
   AND member.status = 'active'
  WHERE record.id::TEXT = p_record_id
    AND record.couple_id::TEXT = p_couple_id
    AND (record.user_id = v_uid OR record.is_private = false);
  IF NOT FOUND THEN RETURN false; END IF;

  v_media_object_id := public.record_media_uuid_from_name(
    storage.filename(p_object_name)
  );
  SELECT media.state,
         media.storage_object_id,
         media.record_id,
         media.couple_id
  INTO v_state,
       v_bound_storage_object_id,
       v_ledger_record_id,
       v_ledger_couple_id
  FROM public.record_media_objects AS media
  WHERE media.storage_object_id = p_storage_object_id
    OR (v_media_object_id IS NOT NULL AND media.media_object_id = v_media_object_id)
  ORDER BY (media.storage_object_id = p_storage_object_id) DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN v_state IS NOT DISTINCT FROM 'active'
      AND v_bound_storage_object_id IS NOT DISTINCT FROM p_storage_object_id
      AND v_ledger_record_id::TEXT IS NOT DISTINCT FROM p_record_id
      AND v_ledger_couple_id::TEXT IS NOT DISTINCT FROM p_couple_id;
  END IF;
  RETURN v_media_contract_version = 0;
END;
$$;
REVOKE ALL ON FUNCTION public.can_read_record_media_object(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_record_media_object(UUID, TEXT, TEXT, TEXT)
  TO authenticated;

DROP POLICY IF EXISTS "Active members can read couple-media" ON storage.objects;
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
    AND public.can_read_record_media_object(
      id,
      name,
      (storage.foldername(name))[2],
      (storage.foldername(name))[1]
    )
  );

-- Begin adopts every pre-v1 object under this exact record prefix.  The path
-- exists only in this stack frame; only Storage UUIDs and opaque media UUIDs
-- enter the ledger.  The record row serializes competing begin calls.
CREATE FUNCTION public.begin_record_media_mutation(
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
    OR v_path_count + v_new_count > 32
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

CREATE FUNCTION public.record_media_mutation_status(
  p_operation_id UUID,
  p_record_id UUID,
  p_expected_user_id UUID,
  p_expected_couple_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_state TEXT;
  v_base BIGINT;
  v_target BIGINT;
  v_count SMALLINT;
BEGIN
  IF v_uid IS NULL OR p_expected_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  IF public.account_write_scope_has_pending(ARRAY[v_uid]::UUID[], true) THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  SELECT mutation.state,
         mutation.base_content_revision,
         mutation.target_content_revision,
         mutation.desired_object_count
  INTO v_state, v_base, v_target, v_count
  FROM public.record_media_mutations AS mutation
  JOIN public.couples AS relationship
    ON relationship.id = mutation.couple_id
   AND relationship.closed_at IS NULL
  JOIN public.couple_members AS member
    ON member.couple_id = relationship.id
   AND member.user_id = v_uid
   AND member.status = 'active'
  WHERE mutation.operation_id = p_operation_id
    AND mutation.record_id = p_record_id
    AND mutation.owner_user_id = v_uid
    AND mutation.couple_id = p_expected_couple_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  RETURN jsonb_build_object(
    'operation_id', p_operation_id,
    'state', v_state,
    'base_content_revision', v_base,
    'target_content_revision', v_target,
    'desired_object_count', v_count
  );
END;
$$;

CREATE FUNCTION public.abandon_record_media_mutation(
  p_operation_id UUID,
  p_record_id UUID,
  p_expected_user_id UUID,
  p_expected_couple_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_state TEXT;
  v_object RECORD;
  v_storage_id UUID;
  v_match_count INTEGER;
BEGIN
  IF v_uid IS NULL OR p_expected_user_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  PERFORM public.assert_account_write_open(ARRAY[v_uid]::UUID[], true);
  PERFORM 1
  FROM public.couples AS relationship
  JOIN public.couple_members AS member ON member.couple_id = relationship.id
  WHERE relationship.id = p_expected_couple_id
    AND relationship.closed_at IS NULL
    AND member.user_id = v_uid
    AND member.status = 'active'
  FOR UPDATE OF relationship;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  PERFORM 1 FROM public.daily_records AS record
  WHERE record.id = p_record_id
    AND record.user_id = v_uid
    AND record.couple_id = p_expected_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  SELECT mutation.state
  INTO v_state
  FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = p_operation_id
    AND mutation.record_id = p_record_id
    AND mutation.couple_id = p_expected_couple_id
    AND mutation.owner_user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  IF v_state IN ('committed', 'abandoned') THEN
    RETURN jsonb_build_object('operation_id', p_operation_id, 'state', v_state);
  END IF;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.reservation_operation_id = p_operation_id
  ORDER BY media.media_object_id
  FOR UPDATE;

  -- Drain a reservation upload that already passed its BEFORE INSERT check,
  -- without serializing Storage traffic for any other record.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('record-media-record:' || p_record_id::TEXT, 0)
  );

  FOR v_object IN
    SELECT media.media_object_id, media.storage_object_id
    FROM public.record_media_objects AS media
    WHERE media.reservation_operation_id = p_operation_id
      AND media.state = 'reserved'
    ORDER BY media.media_object_id
  LOOP
    v_storage_id := v_object.storage_object_id;
    IF v_storage_id IS NULL THEN
      SELECT count(*), (array_agg(object.id ORDER BY object.id))[1]
      INTO v_match_count, v_storage_id
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) = 2
        AND (storage.foldername(object.name))[1] = p_expected_couple_id::TEXT
        AND (storage.foldername(object.name))[2] = p_record_id::TEXT
        AND lower(storage.filename(object.name))
          ~ ('^' || v_object.media_object_id::TEXT || '[.][a-z0-9]{1,10}$');
      IF v_match_count > 1 THEN
        RAISE EXCEPTION 'media_upload_identity_ambiguous' USING ERRCODE = '55000';
      END IF;
    END IF;

    UPDATE public.record_media_objects
    SET storage_object_id = coalesce(storage_object_id, v_storage_id),
        state = CASE WHEN v_storage_id IS NULL THEN 'deleted' ELSE 'cleanup_pending' END,
        deleted_at = CASE WHEN v_storage_id IS NULL THEN clock_timestamp() ELSE NULL END,
        next_attempt_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE media_object_id = v_object.media_object_id;
  END LOOP;

  UPDATE public.record_media_mutations
  SET state = 'abandoned',
      abandoned_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('operation_id', p_operation_id, 'state', 'abandoned');
END;
$$;

REVOKE ALL ON FUNCTION public.begin_record_media_mutation(UUID, UUID, UUID, UUID, BIGINT, BIGINT, TEXT[], UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_media_mutation_status(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.abandon_record_media_mutation(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_record_media_mutation(UUID, UUID, UUID, UUID, BIGINT, BIGINT, TEXT[], UUID[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_media_mutation_status(UUID, UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_record_media_mutation(UUID, UUID, UUID, UUID)
  TO authenticated;

-- Alphabetically after both E2EE BEFORE UPDATE triggers.  This trigger never
-- inspects encrypted or plaintext record content; the already-validated
-- content_revision is its CAS boundary.
CREATE FUNCTION public.commit_record_media_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.record_media_mutations%ROWTYPE;
  v_object RECORD;
  v_storage_id UUID;
  v_match_count INTEGER;
BEGIN
  IF OLD.media_contract_version = 1
    AND NEW.media_contract_version < OLD.media_contract_version
  THEN
    RAISE EXCEPTION 'media_contract_downgrade' USING ERRCODE = '42501';
  END IF;

  IF NEW.last_media_operation_id IS NULL
    OR NEW.last_media_operation_id IS NOT DISTINCT FROM OLD.last_media_operation_id
  THEN
    IF OLD.media_contract_version = 1 THEN
      RAISE EXCEPTION 'media_operation_required' USING ERRCODE = '40001';
    END IF;
    NEW.media_contract_version := 0;
    NEW.media_manifest_revision := 0;
    NEW.last_media_operation_id := NULL;
    RETURN NEW;
  END IF;

  SELECT mutation.*
  INTO v_operation
  FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = NEW.last_media_operation_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_operation.state IS DISTINCT FROM 'pending'
    OR v_operation.record_id IS DISTINCT FROM OLD.id
    OR v_operation.couple_id IS DISTINCT FROM OLD.couple_id
    OR v_operation.owner_user_id IS DISTINCT FROM OLD.user_id
    OR v_operation.base_content_revision IS DISTINCT FROM OLD.content_revision
    OR v_operation.target_content_revision IS DISTINCT FROM NEW.content_revision
  THEN
    RAISE EXCEPTION 'media_mutation_revision_or_identity_mismatch'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.record_id = OLD.id
  ORDER BY media.media_object_id
  FOR UPDATE;

  -- An ambiguous upload response can be followed immediately by this CAS while
  -- the Storage INSERT transaction is still finishing. Drain only this
  -- record's writer after deterministic record/mutation/object locks, then
  -- resolve the reserved UUID from the committed Storage catalog.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('record-media-record:' || OLD.id::TEXT, 0)
  );

  FOR v_object IN
    SELECT media.media_object_id, media.storage_object_id, media.state,
           media.reservation_operation_id
    FROM public.record_media_mutation_items AS item
    JOIN public.record_media_objects AS media
      ON media.media_object_id = item.media_object_id
    WHERE item.operation_id = v_operation.operation_id
    ORDER BY media.media_object_id
  LOOP
    IF v_object.state = 'reserved' THEN
      IF v_object.reservation_operation_id IS DISTINCT FROM v_operation.operation_id THEN
        RAISE EXCEPTION 'media_upload_reservation_required' USING ERRCODE = '42501';
      END IF;
      v_storage_id := v_object.storage_object_id;
      IF v_storage_id IS NULL THEN
        SELECT count(*), (array_agg(object.id ORDER BY object.id))[1]
        INTO v_match_count, v_storage_id
        FROM storage.objects AS object
        WHERE object.bucket_id = 'couple-media'
          AND array_length(storage.foldername(object.name), 1) = 2
          AND (storage.foldername(object.name))[1] = OLD.couple_id::TEXT
          AND (storage.foldername(object.name))[2] = OLD.id::TEXT
          AND lower(storage.filename(object.name))
            ~ ('^' || v_object.media_object_id::TEXT || '[.][a-z0-9]{1,10}$');
        IF v_match_count IS DISTINCT FROM 1 THEN
          RAISE EXCEPTION 'media_upload_incomplete_or_ambiguous'
            USING ERRCODE = '55000';
        END IF;
        UPDATE public.record_media_objects
        SET storage_object_id = v_storage_id,
            updated_at = clock_timestamp()
        WHERE media_object_id = v_object.media_object_id;
      END IF;
    ELSIF v_object.state IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'media_object_not_committable' USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.record_media_mutation_items AS item
      WHERE item.operation_id = v_operation.operation_id)
     IS DISTINCT FROM v_operation.desired_object_count
  THEN
    RAISE EXCEPTION 'media_manifest_count_mismatch' USING ERRCODE = '55000';
  END IF;

  UPDATE public.record_media_objects AS media
  SET state = 'cleanup_pending',
      next_attempt_at = clock_timestamp(),
      lease_id = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE media.record_id = OLD.id
    AND media.state = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM public.record_media_mutation_items AS item
      WHERE item.operation_id = v_operation.operation_id
        AND item.media_object_id = media.media_object_id
    );

  UPDATE public.record_media_objects AS media
  SET state = 'active',
      updated_at = clock_timestamp()
  WHERE media.record_id = OLD.id
    AND media.media_object_id IN (
      SELECT item.media_object_id
      FROM public.record_media_mutation_items AS item
      WHERE item.operation_id = v_operation.operation_id
    )
    AND media.state IN ('active', 'reserved');

  UPDATE public.record_media_mutations
  SET state = 'committed',
      committed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE operation_id = v_operation.operation_id;

  NEW.media_contract_version := 1;
  NEW.media_manifest_revision := NEW.content_revision;
  NEW.last_media_operation_id := v_operation.operation_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_record_media_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zzz_084_commit_record_media_mutation ON public.daily_records;
CREATE TRIGGER zzz_084_commit_record_media_mutation
  BEFORE UPDATE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.commit_record_media_mutation();

-- Replace 083's row gate while retaining every full-prefix rule.  Browser
-- DELETE remains impossible.  A service DELETE needs either the exact prefix
-- lease or the exact immutable Storage object UUID held by an object lease.
CREATE OR REPLACE FUNCTION public.enforce_record_media_cleanup_storage_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := auth.role();
  v_uid UUID := auth.uid();
  v_parts TEXT[];
  v_record_id UUID;
  v_couple_id UUID;
  v_media_object_id UUID;
  v_record_contract SMALLINT;
  v_has_pending_mutation BOOLEAN;
BEGIN
  IF v_role IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_role = 'service_role' THEN
    -- Account-deletion capability may still admit its ordinary non-media
    -- maintenance, but it is never a substitute for cleanup-worker authority
    -- over couple-media. Every such DELETE is bound to one live prefix or
    -- immutable Storage-object lease below.
    IF TG_OP = 'DELETE' AND OLD.bucket_id = 'couple-media' THEN
      IF array_length(storage.foldername(OLD.name), 1) >= 2
        AND EXISTS (
          SELECT 1
          FROM public.record_media_cleanup_jobs AS job
          WHERE job.state = 'leased'
            AND job.lease_expires_at > statement_timestamp()
            AND job.couple_id::TEXT = (storage.foldername(OLD.name))[1]
            AND job.record_id::TEXT = (storage.foldername(OLD.name))[2]
        )
      THEN
        RETURN OLD;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.record_media_objects AS media
        WHERE media.state = 'leased'
          AND media.lease_expires_at > statement_timestamp()
          AND media.storage_object_id = OLD.id
      )
      THEN
        RETURN OLD;
      END IF;

      RAISE EXCEPTION 'record_media_cleanup_lease_required'
        USING ERRCODE = '42501';
    END IF;

    IF public.has_account_write_capability() THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    RAISE EXCEPTION 'record_media_cleanup_lease_required'
      USING ERRCODE = '42501';
  END IF;

  IF v_role IS DISTINCT FROM 'authenticated' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;
  IF public.account_write_scope_has_pending(ARRAY[v_uid]::UUID[], true) THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'record_media_delete_requires_worker' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (OLD.id IS DISTINCT FROM NEW.id
      OR OLD.bucket_id IS DISTINCT FROM NEW.bucket_id
      OR OLD.name IS DISTINCT FROM NEW.name)
  THEN
    RAISE EXCEPTION 'record_media_object_identity_immutable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.bucket_id = 'couple-media' THEN
    v_parts := storage.foldername(NEW.name);
    IF array_length(v_parts, 1) >= 2
      AND v_parts[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND v_parts[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN
      v_couple_id := v_parts[1]::UUID;
      v_record_id := v_parts[2]::UUID;
      -- This is the first record-scoped synchronization point in Storage.
      -- Hold it through INSERT commit so begin/commit/abandon/expiry/delete can
      -- drain an earlier writer without a project-wide table lock.
      PERFORM pg_advisory_xact_lock(
        hashtextextended('record-media-record:' || v_record_id::TEXT, 0)
      );
    END IF;

    IF v_record_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.record_media_cleanup_jobs AS job
        WHERE job.couple_id = v_couple_id
          AND job.record_id = v_record_id
      )
    THEN
      RAISE EXCEPTION 'record_id_retired_for_media_cleanup' USING ERRCODE = '42501';
    END IF;

    IF array_length(v_parts, 1) = 2
      AND v_record_id IS NOT NULL
      AND v_couple_id IS NOT NULL
    THEN
      v_media_object_id := public.record_media_uuid_from_name(storage.filename(NEW.name));
      SELECT record.media_contract_version,
             EXISTS (
               SELECT 1
               FROM public.record_media_mutations AS mutation
               WHERE mutation.record_id = record.id
                 AND mutation.state = 'pending'
             )
      INTO v_record_contract, v_has_pending_mutation
      FROM public.daily_records AS record
      WHERE record.id = v_record_id
        AND record.couple_id = v_couple_id;

      -- A canonical UUID already present anywhere in the ledger is
      -- authoritative even if the record itself is still v0. This prevents an
      -- abandoned/deleted reservation from being recreated through the legacy
      -- compatibility branch; only a truly unledgered v0 filename stays
      -- upload-compatible.
      IF coalesce(v_record_contract, 0) = 1
        OR coalesce(v_has_pending_mutation, false)
        OR (
          v_media_object_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.record_media_objects AS known_media
            WHERE known_media.media_object_id = v_media_object_id
          )
        )
      THEN
        IF v_media_object_id IS NULL
          OR storage.filename(NEW.name) !~* '^[0-9a-f-]{36}[.][a-z0-9]{1,10}$'
          OR NOT EXISTS (
            SELECT 1
            FROM public.record_media_objects AS media
            JOIN public.record_media_mutations AS mutation
              ON mutation.operation_id = media.reservation_operation_id
            WHERE media.media_object_id = v_media_object_id
              AND media.record_id = v_record_id
              AND media.couple_id = v_couple_id
              AND media.owner_user_id = v_uid
              AND media.state = 'reserved'
              AND media.storage_object_id IS NULL
              AND mutation.state = 'pending'
              AND mutation.record_id = media.record_id
              AND mutation.base_content_revision = (
                SELECT record.content_revision
                FROM public.daily_records AS record
                WHERE record.id = media.record_id
              )
          )
        THEN
          RAISE EXCEPTION 'media_upload_reservation_required' USING ERRCODE = '42501';
        END IF;

        PERFORM pg_advisory_xact_lock(
          hashtextextended('record-media-object:' || v_media_object_id::TEXT, 0)
        );
        IF EXISTS (
          SELECT 1
          FROM storage.objects AS object
          WHERE object.bucket_id = 'couple-media'
            AND array_length(storage.foldername(object.name), 1) = 2
            AND (storage.foldername(object.name))[1] = v_parts[1]
            AND (storage.foldername(object.name))[2] = v_parts[2]
            AND lower(storage.filename(object.name))
              ~ ('^' || v_media_object_id::TEXT || '[.][a-z0-9]{1,10}$')
        ) THEN
          RAISE EXCEPTION 'media_object_id_retired' USING ERRCODE = '55000';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_record_media_cleanup_storage_row()
  FROM PUBLIC, anon, authenticated, service_role;

-- Supersede exact-object work before the prefix tombstone.  An active object
-- lease wins and record deletion retries; otherwise the prefix job safely owns
-- every object after the record-scoped advisory lock drains earlier uploads.
CREATE OR REPLACE FUNCTION public.enqueue_record_media_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.record_media_mutations AS mutation
  WHERE mutation.record_id = OLD.id
  ORDER BY mutation.operation_id
  FOR UPDATE;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.record_id = OLD.id
  ORDER BY media.media_object_id
  FOR UPDATE;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('record-media-record:' || OLD.id::TEXT, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    WHERE media.record_id = OLD.id
      AND media.state = 'leased'
      AND media.lease_expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'record_media_object_cleanup_leased' USING ERRCODE = '40001';
  END IF;

  UPDATE public.record_media_mutations
  SET state = 'abandoned',
      abandoned_at = coalesce(abandoned_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE record_id = OLD.id
    AND state = 'pending';

  UPDATE public.record_media_objects
  SET state = 'superseded',
      lease_id = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE record_id = OLD.id
    AND state <> 'deleted';

  INSERT INTO public.record_media_cleanup_jobs (record_id, couple_id, owner_user_id)
  VALUES (OLD.id, OLD.couple_id, OLD.user_id)
  ON CONFLICT (record_id) DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.record_media_cleanup_jobs AS job
    WHERE job.record_id = OLD.id
      AND job.couple_id = OLD.couple_id
      AND job.owner_user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_conflict' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_record_media_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

-- Convert one abandoned browser operation into object jobs.  Daily row first,
-- then mutation, objects in UUID order, and only then Storage lookup.
CREATE FUNCTION public.expire_stale_record_media_mutation()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate RECORD;
  v_object RECORD;
  v_storage_id UUID;
  v_match_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT mutation.operation_id, mutation.record_id, mutation.couple_id
  INTO v_candidate
  FROM public.record_media_mutations AS mutation
  WHERE mutation.state = 'pending'
    AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
  ORDER BY mutation.created_at, mutation.operation_id
  LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public.daily_records AS record
  WHERE record.id = v_candidate.record_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = v_candidate.operation_id
    AND mutation.state = 'pending'
    AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public.record_media_objects AS media
  WHERE media.reservation_operation_id = v_candidate.operation_id
  ORDER BY media.media_object_id
  FOR UPDATE;

  -- See abandon_record_media_mutation: expiry must not classify a still-
  -- uncommitted, already-authorized upload as absent. The fence is record-local.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('record-media-record:' || v_candidate.record_id::TEXT, 0)
  );

  FOR v_object IN
    SELECT media.media_object_id
    FROM public.record_media_objects AS media
    WHERE media.reservation_operation_id = v_candidate.operation_id
      AND media.state = 'reserved'
    ORDER BY media.media_object_id
  LOOP
    SELECT count(*), (array_agg(object.id ORDER BY object.id))[1]
    INTO v_match_count, v_storage_id
    FROM storage.objects AS object
    WHERE object.bucket_id = 'couple-media'
      AND array_length(storage.foldername(object.name), 1) = 2
      AND (storage.foldername(object.name))[1] = v_candidate.couple_id::TEXT
      AND (storage.foldername(object.name))[2] = v_candidate.record_id::TEXT
      AND lower(storage.filename(object.name))
        ~ ('^' || v_object.media_object_id::TEXT || '[.][a-z0-9]{1,10}$');
    IF v_match_count > 1 THEN
      UPDATE public.record_media_objects
      SET state = 'blocked',
          failure_count = 8,
          last_error_code = 'E_STORAGE_OBJECT_ID_AMBIGUOUS',
          updated_at = clock_timestamp()
      WHERE media_object_id = v_object.media_object_id;
    ELSIF v_storage_id IS NULL THEN
      UPDATE public.record_media_objects
      SET state = 'deleted', deleted_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE media_object_id = v_object.media_object_id;
    ELSE
      UPDATE public.record_media_objects
      SET storage_object_id = v_storage_id,
          state = 'cleanup_pending',
          next_attempt_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE media_object_id = v_object.media_object_id;
    END IF;
  END LOOP;

  UPDATE public.record_media_mutations
  SET state = 'abandoned', abandoned_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE operation_id = v_candidate.operation_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.claim_record_media_object_cleanup_job(
  p_lease_id UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  media_object_id UUID,
  storage_object_id UUID,
  record_id UUID,
  couple_id UUID,
  lease_id UUID,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_lease_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION 'invalid_record_media_object_cleanup_lease' USING ERRCODE = '22023';
  END IF;

  PERFORM public.expire_stale_record_media_mutation();

  RETURN QUERY
  WITH candidate AS (
    SELECT media.media_object_id
    FROM public.record_media_objects AS media
    WHERE media.storage_object_id IS NOT NULL
      AND (
        (media.state = 'cleanup_pending' AND media.next_attempt_at <= clock_timestamp())
        OR (media.state = 'leased' AND media.lease_expires_at <= clock_timestamp())
      )
    ORDER BY media.next_attempt_at, media.created_at, media.media_object_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.record_media_objects AS media
    SET state = 'leased',
        lease_id = p_lease_id,
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = clock_timestamp()
    FROM candidate
    WHERE media.media_object_id = candidate.media_object_id
    RETURNING media.media_object_id, media.storage_object_id, media.record_id,
              media.couple_id, media.lease_id, media.lease_expires_at
  )
  SELECT claimed.media_object_id, claimed.storage_object_id, claimed.record_id,
         claimed.couple_id, claimed.lease_id, claimed.lease_expires_at
  FROM claimed;
END;
$$;

CREATE FUNCTION public.resolve_record_media_object_cleanup_path(
  p_media_object_id UUID,
  p_storage_object_id UUID,
  p_lease_id UUID
)
RETURNS TABLE (storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT object.name
  FROM public.record_media_objects AS media
  JOIN storage.objects AS object
    ON object.id = media.storage_object_id
   AND object.bucket_id = 'couple-media'
  WHERE media.media_object_id = p_media_object_id
    AND media.storage_object_id = p_storage_object_id
    AND media.lease_id = p_lease_id
    AND media.state = 'leased'
    AND media.lease_expires_at > statement_timestamp();
END;
$$;

CREATE FUNCTION public.settle_record_media_object_cleanup_job(
  p_media_object_id UUID,
  p_storage_object_id UUID,
  p_lease_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state TEXT;
  v_lease_id UUID;
  v_storage_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT media.state, media.lease_id, media.storage_object_id
  INTO v_state, v_lease_id, v_storage_id
  FROM public.record_media_objects AS media
  WHERE media.media_object_id = p_media_object_id
  FOR UPDATE;

  IF v_state = 'deleted'
    AND v_lease_id = p_lease_id
    AND v_storage_id = p_storage_object_id
  THEN
    RETURN true;
  END IF;
  IF v_state IS DISTINCT FROM 'leased'
    OR v_lease_id IS DISTINCT FROM p_lease_id
    OR v_storage_id IS DISTINCT FROM p_storage_object_id
  THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.id = p_storage_object_id
      AND object.bucket_id = 'couple-media'
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.record_media_objects
  SET state = 'deleted',
      lease_expires_at = NULL,
      deleted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE media_object_id = p_media_object_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.fail_record_media_object_cleanup_job(
  p_media_object_id UUID,
  p_storage_object_id UUID,
  p_lease_id UUID,
  p_error_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state TEXT;
  v_lease_id UUID;
  v_storage_id UUID;
  v_last_error_code TEXT;
  v_failure_count SMALLINT;
  v_next_failure_count SMALLINT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^E_[A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'invalid_record_media_object_cleanup_error_code' USING ERRCODE = '22023';
  END IF;

  SELECT media.state, media.lease_id, media.storage_object_id,
         media.last_error_code, media.failure_count
  INTO v_state, v_lease_id, v_storage_id, v_last_error_code, v_failure_count
  FROM public.record_media_objects AS media
  WHERE media.media_object_id = p_media_object_id
  FOR UPDATE;

  IF v_state IN ('cleanup_pending', 'blocked')
    AND v_lease_id = p_lease_id
    AND v_storage_id = p_storage_object_id
    AND v_last_error_code = p_error_code
  THEN
    RETURN CASE WHEN v_state = 'cleanup_pending' THEN 'pending' ELSE 'blocked' END;
  END IF;
  IF v_state IS DISTINCT FROM 'leased'
    OR v_lease_id IS DISTINCT FROM p_lease_id
    OR v_storage_id IS DISTINCT FROM p_storage_object_id
  THEN
    RETURN NULL;
  END IF;

  v_next_failure_count := least(v_failure_count + 1, 8);
  UPDATE public.record_media_objects
  SET state = CASE WHEN v_next_failure_count >= 8 THEN 'blocked' ELSE 'cleanup_pending' END,
      failure_count = v_next_failure_count,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      next_attempt_at = clock_timestamp()
        + make_interval(secs => least(300, (2 ^ v_next_failure_count)::INTEGER)),
      updated_at = clock_timestamp()
  WHERE media_object_id = p_media_object_id;
  RETURN CASE WHEN v_next_failure_count >= 8 THEN 'blocked' ELSE 'pending' END;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_record_media_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_record_media_object_cleanup_job(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_record_media_object_cleanup_path(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_record_media_object_cleanup_job(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_record_media_object_cleanup_job(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_record_media_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_record_media_object_cleanup_job(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_record_media_object_cleanup_path(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_record_media_object_cleanup_job(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_record_media_object_cleanup_job(UUID, UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_account_record_media_cleanup_complete(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.account_deletion_requests AS deletion
  WHERE deletion.user_id = p_user_id
    AND deletion.attempt_id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_account_deletion_attempt' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.owner_user_id = p_user_id
    AND job.state <> 'completed'
  ORDER BY job.record_id
  FOR UPDATE;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.owner_user_id = p_user_id
    AND media.state IN ('cleanup_pending', 'leased', 'blocked')
  ORDER BY media.media_object_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.record_media_cleanup_jobs AS job
    WHERE job.owner_user_id = p_user_id AND job.state <> 'completed'
  ) OR EXISTS (
    SELECT 1 FROM public.record_media_objects AS media
    WHERE media.owner_user_id = p_user_id
      AND media.state IN ('cleanup_pending', 'leased', 'blocked')
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_pending' USING ERRCODE = '55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_account_record_media_cleanup_complete(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_media_cleanup_contract_version()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  RETURN 2;
END;
$$;
REVOKE ALL ON FUNCTION public.record_media_cleanup_contract_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_media_cleanup_contract_version()
  TO service_role;

-- One deployment-time drain closes the cutover race with INSERT transactions
-- that started under migration 083's trigger body and therefore do not yet
-- hold the record advisory lock. Once this lock is granted, queued writers can
-- resume only after COMMIT exposes the 084 trigger; steady-state RPCs never
-- take a project-wide Storage table lock.
LOCK TABLE storage.objects IN SHARE MODE;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback is forward-only: pause the scheduler and old/new Edge artifacts,
-- keep authenticated Storage DELETE revoked, and ship a higher migration.
-- Never drop lifecycle rows or restore browser DELETE as a rollback shortcut.
