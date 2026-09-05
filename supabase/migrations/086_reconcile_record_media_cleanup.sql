-- 086_reconcile_record_media_cleanup.sql
--
-- Forward-only repair for cleanup contract v2. Reconcile recoverable legacy
-- work without deleting Storage metadata, make completed-prefix settlement
-- recheck PostgreSQL truth, and fence owner-attributable unledgered objects.

BEGIN;

DO $preflight$
DECLARE
  v_definition TEXT;
BEGIN
  IF to_regclass('public.daily_records') IS NULL
    OR to_regclass('public.record_media_cleanup_jobs') IS NULL
    OR to_regclass('public.record_media_mutations') IS NULL
    OR to_regclass('public.record_media_objects') IS NULL
    OR to_regclass('storage.objects') IS NULL
    OR to_regprocedure('public.record_media_uuid_from_name(text)') IS NULL
    OR to_regprocedure('public.complete_record_media_cleanup_job(uuid,uuid)') IS NULL
    OR to_regprocedure(
      'public.assert_account_record_media_cleanup_complete(uuid,uuid)'
    ) IS NULL
    OR to_regprocedure('public.record_media_cleanup_contract_version()') IS NULL
  THEN
    RAISE EXCEPTION 'migration_086_requires_exact_083_085'
      USING ERRCODE = '55000';
  END IF;

  -- Hosted Storage currently keeps deprecated `owner` UUID beside the
  -- authoritative `owner_id` TEXT claim. Require both known shapes so a future
  -- catalog change cannot silently alter attribution during this migration.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.objects'::regclass
      AND attname = 'owner'
      AND atttypid = 'uuid'::regtype
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.objects'::regclass
      AND attname = 'owner_id'
      AND atttypid = 'text'::regtype
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'storage.objects'::regclass
      AND attname = 'id'
      AND atttypid = 'uuid'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'migration_086_storage_catalog_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.daily_records'::regclass
      AND attname = 'media_contract_version'
      AND atttypid = 'smallint'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.record_media_cleanup_jobs'::regclass
      AND attname = 'owner_user_id'
      AND atttypid = 'uuid'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.record_media_objects'::regclass
      AND attname = 'storage_object_id'
      AND atttypid = 'uuid'::regtype
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'migration_086_record_media_catalog_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    WHERE trigger.tgrelid = 'public.daily_records'::regclass
      AND trigger.tgname = 'aab_083_enqueue_record_media_cleanup'
      AND procedure.proname = 'enqueue_record_media_cleanup'
      AND NOT trigger.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    WHERE trigger.tgrelid = 'public.daily_records'::regclass
      AND trigger.tgname = 'aab_085_daily_record_identity_immutable'
      AND procedure.proname = 'enforce_daily_record_identity_immutable'
      AND NOT trigger.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    WHERE trigger.tgrelid = 'storage.objects'::regclass
      AND trigger.tgname = 'aaa_083_account_write_row'
      AND procedure.proname = 'enforce_record_media_cleanup_storage_row'
      AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'migration_086_trigger_catalog_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.record_media_cleanup_contract_version()'::regprocedure
  ) INTO v_definition;
  IF v_definition !~* 'RETURN[[:space:]]+2[[:space:]]*;'
    OR v_definition !~* 'auth[.]role[(][)] IS DISTINCT FROM ''service_role'''
  THEN
    RAISE EXCEPTION 'migration_086_contract_predecessor_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_get_functiondef(
    'public.complete_record_media_cleanup_job(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  IF v_definition !~* 'record_media_objects'
    OR v_definition !~* 'state[[:space:]]*=[[:space:]]*''deleted'''
    OR v_definition !~* 'FOR UPDATE'
  THEN
    RAISE EXCEPTION 'migration_086_completion_predecessor_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Stop concurrent record/ledger writers and fail immediately rather than wait
-- behind an unknown Storage transaction. Deployment must retry only after the
-- scheduler and writers are quiescent.
LOCK TABLE public.daily_records IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.record_media_mutations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.record_media_objects IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.record_media_cleanup_jobs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE storage.objects IN SHARE MODE NOWAIT;

DO $reconcile$
DECLARE
  v_namespace RECORD;
  v_record RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs
    WHERE state = 'leased'
      AND lease_expires_at > statement_timestamp()
  ) OR EXISTS (
    SELECT 1
    FROM public.record_media_objects
    WHERE state = 'leased'
      AND lease_expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'migration_086_active_cleanup_lease'
      USING ERRCODE = '55000';
  END IF;

  -- A record UUID has one immutable routing identity across every durable
  -- ledger. Refuse to choose between conflicting owners or couples.
  IF EXISTS (
    WITH ledger_identity AS (
      SELECT mutation.record_id, mutation.couple_id, mutation.owner_user_id
      FROM public.record_media_mutations AS mutation
      UNION ALL
      SELECT media.record_id, media.couple_id, media.owner_user_id
      FROM public.record_media_objects AS media
    )
    SELECT 1
    FROM ledger_identity
    GROUP BY record_id
    HAVING count(DISTINCT (couple_id, owner_user_id)) <> 1
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    JOIN public.record_media_mutations AS mutation
      ON mutation.record_id = job.record_id
    WHERE mutation.couple_id IS DISTINCT FROM job.couple_id
      OR mutation.owner_user_id IS DISTINCT FROM job.owner_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    JOIN public.record_media_objects AS media
      ON media.record_id = job.record_id
    WHERE media.couple_id IS DISTINCT FROM job.couple_id
      OR media.owner_user_id IS DISTINCT FROM job.owner_user_id
  ) OR EXISTS (
    SELECT 1
    FROM public.daily_records AS record
    JOIN public.record_media_cleanup_jobs AS job ON job.record_id = record.id
    WHERE record.couple_id IS DISTINCT FROM job.couple_id
      OR record.user_id IS DISTINCT FROM job.owner_user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  -- A Storage UUID is the immutable exact-object identity. Every extant row
  -- already bound to the ledger must still agree on bucket, routing prefix and
  -- the current Storage owner claim before any reconciliation is attempted.
  IF EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    JOIN storage.objects AS object
      ON object.id = media.storage_object_id
    WHERE object.bucket_id IS DISTINCT FROM 'couple-media'
      OR array_length(storage.foldername(object.name), 1) IS DISTINCT FROM 2
      OR (storage.foldername(object.name))[1] IS DISTINCT FROM media.couple_id::TEXT
      OR (storage.foldername(object.name))[2] IS DISTINCT FROM media.record_id::TEXT
      OR CASE
        WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN object.owner_id::UUID
        ELSE NULL
      END IS DISTINCT FROM media.owner_user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  -- Every object beneath a durable prefix job must still identify that job's
  -- owner through current Storage `owner_id`; deprecated `owner` is never used
  -- as authority.
  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    JOIN storage.objects AS object
      ON object.bucket_id = 'couple-media'
     AND array_length(storage.foldername(object.name), 1) >= 2
     AND (storage.foldername(object.name))[1] = job.couple_id::TEXT
     AND (storage.foldername(object.name))[2] = job.record_id::TEXT
    WHERE CASE
      WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN object.owner_id::UUID
      ELSE NULL
    END IS DISTINCT FROM job.owner_user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  -- Turn a recordless ledger namespace into one prefix job. Existing live
  -- records keep their ledger; only an exact matching identity is accepted.
  FOR v_namespace IN
    WITH ledger_identity AS (
      SELECT mutation.record_id, mutation.couple_id, mutation.owner_user_id
      FROM public.record_media_mutations AS mutation
      UNION ALL
      SELECT media.record_id, media.couple_id, media.owner_user_id
      FROM public.record_media_objects AS media
    )
    SELECT ledger.record_id,
           min(ledger.couple_id::TEXT)::UUID AS couple_id,
           min(ledger.owner_user_id::TEXT)::UUID AS owner_user_id,
           count(DISTINCT (ledger.couple_id, ledger.owner_user_id)) AS identity_count
    FROM ledger_identity AS ledger
    GROUP BY ledger.record_id
    ORDER BY ledger.record_id
  LOOP
    IF v_namespace.identity_count IS DISTINCT FROM 1::BIGINT THEN
      RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
        USING ERRCODE = '55000';
    END IF;

    SELECT record.id, record.couple_id, record.user_id
    INTO v_record
    FROM public.daily_records AS record
    WHERE record.id = v_namespace.record_id;
    IF FOUND THEN
      IF v_record.couple_id IS DISTINCT FROM v_namespace.couple_id
        OR v_record.user_id IS DISTINCT FROM v_namespace.owner_user_id
      THEN
        RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
          USING ERRCODE = '55000';
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) >= 2
        AND (storage.foldername(object.name))[1] = v_namespace.couple_id::TEXT
        AND (storage.foldername(object.name))[2] = v_namespace.record_id::TEXT
        AND CASE
          WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN object.owner_id::UUID
          ELSE NULL
        END IS DISTINCT FROM v_namespace.owner_user_id
    ) THEN
      RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.record_media_mutations
    SET state = 'abandoned',
        abandoned_at = coalesce(abandoned_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE record_id = v_namespace.record_id
      AND state = 'pending';

    UPDATE public.record_media_objects
    SET state = 'superseded',
        lease_id = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE record_id = v_namespace.record_id
      AND state <> 'deleted';

    -- A pre-existing prefix job already owns this retired namespace, but that
    -- never keeps a stale browser mutation pending. The completed-job repair
    -- below reopens the job when physical or ledger residue remains.
    IF EXISTS (
      SELECT 1
      FROM public.record_media_cleanup_jobs AS job
      WHERE job.record_id = v_namespace.record_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.record_media_cleanup_jobs (
      record_id,
      couple_id,
      owner_user_id
    ) VALUES (
      v_namespace.record_id,
      v_namespace.couple_id,
      v_namespace.owner_user_id
    );
  END LOOP;

  -- A live v0 record may legitimately have no ledger yet. A v1 record may not,
  -- and no live record may own an object through a mismatched current owner_id.
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object
    JOIN public.daily_records AS record
      ON record.id::TEXT = (storage.foldername(object.name))[2]
    WHERE object.bucket_id = 'couple-media'
      AND array_length(storage.foldername(object.name), 1) = 2
      AND (storage.foldername(object.name))[1]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND (storage.foldername(object.name))[2]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND public.record_media_uuid_from_name(storage.filename(object.name)) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.record_media_objects AS media
        WHERE media.storage_object_id = object.id
      )
      AND (
        (
          record.media_contract_version = 0
          AND (
            record.couple_id::TEXT IS DISTINCT FROM (storage.foldername(object.name))[1]
            OR object.owner_id IS NULL
            OR object.owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            OR object.owner_id::UUID IS DISTINCT FROM record.user_id
          )
        )
        OR record.media_contract_version = 1
      )
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  -- Completed jobs contaminated by a matching ledger row or exact Storage
  -- prefix become ordinary pending work again. Identity mismatches were
  -- rejected above, and no active lease exists while these states move.
  UPDATE public.record_media_mutations AS mutation
  SET state = 'abandoned',
      abandoned_at = coalesce(mutation.abandoned_at, clock_timestamp()),
      updated_at = clock_timestamp()
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = mutation.record_id
    AND job.state = 'completed'
    AND mutation.state = 'pending'
    AND (
      EXISTS (
        SELECT 1
        FROM public.record_media_objects AS media
        WHERE media.record_id = job.record_id
          AND media.couple_id = job.couple_id
          AND media.owner_user_id = job.owner_user_id
          AND media.state <> 'deleted'
      )
      OR EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = 'couple-media'
          AND array_length(storage.foldername(object.name), 1) >= 2
          AND (storage.foldername(object.name))[1] = job.couple_id::TEXT
          AND (storage.foldername(object.name))[2] = job.record_id::TEXT
      )
    );

  UPDATE public.record_media_objects AS media
  SET state = 'superseded',
      lease_id = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = media.record_id
    AND job.couple_id = media.couple_id
    AND job.owner_user_id = media.owner_user_id
    AND job.state = 'completed'
    AND media.state <> 'deleted';

  UPDATE public.record_media_cleanup_jobs AS job
  SET state = 'pending',
      lease_id = NULL,
      lease_expires_at = NULL,
      completed_at = NULL,
      next_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE job.state = 'completed'
    AND (
      EXISTS (
        SELECT 1
        FROM public.record_media_objects AS media
        WHERE media.record_id = job.record_id
          AND media.couple_id = job.couple_id
          AND media.owner_user_id = job.owner_user_id
          AND media.state <> 'deleted'
      )
      OR EXISTS (
        SELECT 1
        FROM storage.objects AS object
        WHERE object.bucket_id = 'couple-media'
          AND array_length(storage.foldername(object.name), 1) >= 2
          AND (storage.foldername(object.name))[1] = job.couple_id::TEXT
          AND (storage.foldername(object.name))[2] = job.record_id::TEXT
      )
    );

  -- Every valid two-folder, recordless and jobless v0 object can be cleaned by
  -- immutable Storage UUID. Canonical names retain their media UUID; legacy
  -- names receive an opaque ledger UUID. Never derive a broad prefix job from
  -- owner_id alone.
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'couple-media'
      AND array_length(storage.foldername(object.name), 1) = 2
      AND (storage.foldername(object.name))[1]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND (storage.foldername(object.name))[2]
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND NOT EXISTS (
        SELECT 1 FROM public.daily_records AS record
        WHERE record.id::TEXT = (storage.foldername(object.name))[2]
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.record_media_cleanup_jobs AS job
        WHERE job.record_id::TEXT = (storage.foldername(object.name))[2]
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.record_media_objects AS media
        WHERE media.storage_object_id = object.id
      )
      AND (
        object.owner_id IS NULL
        OR object.owner_id !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        OR storage.filename(object.name) = ''
        OR char_length(storage.filename(object.name)) > 1024
        OR storage.filename(object.name) IN ('.', '..')
        OR position(E'\\' IN storage.filename(object.name)) > 0
        OR storage.filename(object.name) ~ '[[:cntrl:]]'
      )
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    WITH candidate AS (
      SELECT object.id AS storage_object_id,
             public.record_media_uuid_from_name(storage.filename(object.name)) AS media_object_id
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) = 2
        AND (storage.foldername(object.name))[1]
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND (storage.foldername(object.name))[2]
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND public.record_media_uuid_from_name(storage.filename(object.name)) IS NOT NULL
        AND object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM public.daily_records AS record
          WHERE record.id::TEXT = (storage.foldername(object.name))[2]
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.record_media_cleanup_jobs AS job
          WHERE job.record_id::TEXT = (storage.foldername(object.name))[2]
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.record_media_objects AS media
          WHERE media.storage_object_id = object.id
        )
    )
    SELECT 1
    FROM candidate
    LEFT JOIN public.record_media_objects AS existing
      ON existing.media_object_id = candidate.media_object_id
    GROUP BY candidate.media_object_id
    HAVING count(DISTINCT candidate.storage_object_id) <> 1
      OR count(existing.media_object_id) <> 0
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.record_media_objects (
    media_object_id,
    storage_object_id,
    record_id,
    couple_id,
    owner_user_id,
    state,
    next_attempt_at
  )
  SELECT coalesce(
           public.record_media_uuid_from_name(storage.filename(object.name)),
           gen_random_uuid()
         ),
         object.id,
         (storage.foldername(object.name))[2]::UUID,
         (storage.foldername(object.name))[1]::UUID,
         object.owner_id::UUID,
         'cleanup_pending',
         clock_timestamp()
  FROM storage.objects AS object
  WHERE object.bucket_id = 'couple-media'
    AND array_length(storage.foldername(object.name), 1) = 2
    AND (storage.foldername(object.name))[1]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (storage.foldername(object.name))[2]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND storage.filename(object.name) <> ''
    AND char_length(storage.filename(object.name)) <= 1024
    AND storage.filename(object.name) NOT IN ('.', '..')
    AND position(E'\\' IN storage.filename(object.name)) = 0
    AND storage.filename(object.name) !~ '[[:cntrl:]]'
    AND object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND NOT EXISTS (
      SELECT 1 FROM public.daily_records AS record
      WHERE record.id::TEXT = (storage.foldername(object.name))[2]
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.record_media_cleanup_jobs AS job
      WHERE job.record_id::TEXT = (storage.foldername(object.name))[2]
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.record_media_objects AS media
      WHERE media.storage_object_id = object.id
    )
  ORDER BY object.id;
END
$reconcile$;

-- Keep every 084 browser/account fence, but require the current Storage row to
-- agree with durable ledger or prefix identity before a service-role DELETE is
-- authorized. The trigger is the final database check immediately before the
-- Storage metadata row can disappear.
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
  v_bound_record_id UUID;
  v_bound_couple_id UUID;
  v_bound_owner_user_id UUID;
  v_bound_state TEXT;
  v_bound_lease_expires_at TIMESTAMPTZ;
  v_prefix_owner_user_id UUID;
BEGIN
  IF v_role IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      v_parts := storage.foldername(OLD.name);

      SELECT media.record_id,
             media.couple_id,
             media.owner_user_id,
             media.state,
             media.lease_expires_at
      INTO v_bound_record_id,
           v_bound_couple_id,
           v_bound_owner_user_id,
           v_bound_state,
           v_bound_lease_expires_at
      FROM public.record_media_objects AS media
      WHERE media.storage_object_id = OLD.id;

      IF FOUND THEN
        IF OLD.bucket_id IS DISTINCT FROM 'couple-media'
          OR array_length(v_parts, 1) IS DISTINCT FROM 2
          OR v_parts[1] IS DISTINCT FROM v_bound_couple_id::TEXT
          OR v_parts[2] IS DISTINCT FROM v_bound_record_id::TEXT
          OR (CASE
            WHEN OLD.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN OLD.owner_id::UUID
            ELSE NULL
          END) IS DISTINCT FROM v_bound_owner_user_id
        THEN
          RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
            USING ERRCODE = '55000';
        END IF;

        IF v_bound_state = 'leased'
          AND v_bound_lease_expires_at > statement_timestamp()
        THEN
          RETURN OLD;
        END IF;
      END IF;

      IF OLD.bucket_id = 'couple-media' THEN
        IF array_length(v_parts, 1) >= 2 THEN
          SELECT job.owner_user_id
          INTO v_prefix_owner_user_id
          FROM public.record_media_cleanup_jobs AS job
          WHERE job.state = 'leased'
            AND job.lease_expires_at > statement_timestamp()
            AND job.couple_id::TEXT = v_parts[1]
            AND job.record_id::TEXT = v_parts[2];

          IF FOUND THEN
            IF (CASE
              WHEN OLD.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN OLD.owner_id::UUID
              ELSE NULL
            END) IS DISTINCT FROM v_prefix_owner_user_id
            THEN
              RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
                USING ERRCODE = '55000';
            END IF;
            RETURN OLD;
          END IF;
        END IF;

        RAISE EXCEPTION 'record_media_cleanup_lease_required'
          USING ERRCODE = '42501';
      END IF;
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

-- Retire every stale pending mutation whose record is already gone before
-- selecting the oldest live mutation. This prevents one recordless row from
-- permanently occupying the head of the ordered queue.
CREATE OR REPLACE FUNCTION public.expire_stale_record_media_mutation()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate RECORD;
  v_record RECORD;
  v_object RECORD;
  v_storage_id UUID;
  v_match_count INTEGER;
  v_recordless_abandoned INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  -- Existing jobs and physical residue do not keep a recordless browser
  -- mutation pending. Refuse the repair only when durable/current identity is
  -- contradictory; otherwise abandonment is terminal and set-based.
  IF EXISTS (
    SELECT 1
    FROM public.record_media_mutations AS mutation
    WHERE mutation.state = 'pending'
      AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.daily_records AS record
        WHERE record.id = mutation.record_id
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.record_media_cleanup_jobs AS job
          WHERE job.record_id = mutation.record_id
            AND (
              job.couple_id IS DISTINCT FROM mutation.couple_id
              OR job.owner_user_id IS DISTINCT FROM mutation.owner_user_id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.record_media_objects AS media
          WHERE media.record_id = mutation.record_id
            AND (
              media.couple_id IS DISTINCT FROM mutation.couple_id
              OR media.owner_user_id IS DISTINCT FROM mutation.owner_user_id
            )
        )
        OR EXISTS (
          SELECT 1
          FROM storage.objects AS object
          WHERE object.bucket_id = 'couple-media'
            AND array_length(storage.foldername(object.name), 1) >= 2
            AND (storage.foldername(object.name))[1] = mutation.couple_id::TEXT
            AND (storage.foldername(object.name))[2] = mutation.record_id::TEXT
            AND CASE
              WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN object.owner_id::UUID
              ELSE NULL
            END IS DISTINCT FROM mutation.owner_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.record_media_objects AS media
          JOIN storage.objects AS object ON object.id = media.storage_object_id
          WHERE media.record_id = mutation.record_id
            AND (
              object.bucket_id IS DISTINCT FROM 'couple-media'
              OR array_length(storage.foldername(object.name), 1) IS DISTINCT FROM 2
              OR (storage.foldername(object.name))[1] IS DISTINCT FROM media.couple_id::TEXT
              OR (storage.foldername(object.name))[2] IS DISTINCT FROM media.record_id::TEXT
              OR CASE
                WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  THEN object.owner_id::UUID
                ELSE NULL
              END IS DISTINCT FROM media.owner_user_id
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.record_media_mutations AS mutation
  SET state = 'abandoned',
      abandoned_at = coalesce(mutation.abandoned_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE mutation.state = 'pending'
    AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.daily_records AS record
      WHERE record.id = mutation.record_id
    );
  GET DIAGNOSTICS v_recordless_abandoned = ROW_COUNT;

  SELECT mutation.operation_id,
         mutation.record_id,
         mutation.couple_id,
         mutation.owner_user_id
  INTO v_candidate
  FROM public.record_media_mutations AS mutation
  WHERE mutation.state = 'pending'
    AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
    AND EXISTS (
      SELECT 1 FROM public.daily_records AS record
      WHERE record.id = mutation.record_id
    )
  ORDER BY mutation.created_at, mutation.operation_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN v_recordless_abandoned > 0;
  END IF;

  SELECT record.couple_id, record.user_id
  INTO v_record
  FROM public.daily_records AS record
  WHERE record.id = v_candidate.record_id
  FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.record_media_mutations AS mutation
    SET state = 'abandoned',
        abandoned_at = coalesce(mutation.abandoned_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE mutation.operation_id = v_candidate.operation_id
      AND mutation.state = 'pending'
      AND mutation.created_at <= clock_timestamp() - interval '15 minutes';
    RETURN FOUND OR v_recordless_abandoned > 0;
  END IF;
  IF v_record.couple_id IS DISTINCT FROM v_candidate.couple_id
    OR v_record.user_id IS DISTINCT FROM v_candidate.owner_user_id
  THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  PERFORM 1
  FROM public.record_media_mutations AS mutation
  WHERE mutation.operation_id = v_candidate.operation_id
    AND mutation.record_id = v_candidate.record_id
    AND mutation.couple_id = v_candidate.couple_id
    AND mutation.owner_user_id = v_candidate.owner_user_id
    AND mutation.state = 'pending'
    AND mutation.created_at <= clock_timestamp() - interval '15 minutes'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN v_recordless_abandoned > 0;
  END IF;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.reservation_operation_id = v_candidate.operation_id
  ORDER BY media.media_object_id
  FOR UPDATE;

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
    IF EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) = 2
        AND (storage.foldername(object.name))[1] = v_candidate.couple_id::TEXT
        AND (storage.foldername(object.name))[2] = v_candidate.record_id::TEXT
        AND lower(storage.filename(object.name))
          ~ ('^' || v_object.media_object_id::TEXT || '[.][a-z0-9]{1,10}$')
        AND CASE
          WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN object.owner_id::UUID
          ELSE NULL
        END IS DISTINCT FROM v_candidate.owner_user_id
    ) THEN
      RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
        USING ERRCODE = '55000';
    END IF;

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
      SET state = 'deleted',
          deleted_at = clock_timestamp(),
          updated_at = clock_timestamp()
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
  SET state = 'abandoned',
      abandoned_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE operation_id = v_candidate.operation_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_record_media_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_record_media_mutation()
  TO service_role;

-- Resolving an exact object is authorization-sensitive: read and validate the
-- current Storage row in one query before returning its path. Absence remains
-- idempotent and is settled by the existing exact-object completion RPC.
CREATE OR REPLACE FUNCTION public.resolve_record_media_object_cleanup_path(
  p_media_object_id UUID,
  p_storage_object_id UUID,
  p_lease_id UUID
)
RETURNS TABLE (storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_storage_path TEXT;
  v_bucket_id TEXT;
  v_owner_id TEXT;
  v_parts TEXT[];
  v_record_id UUID;
  v_couple_id UUID;
  v_owner_user_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT object.name,
         object.bucket_id,
         object.owner_id,
         storage.foldername(object.name),
         media.record_id,
         media.couple_id,
         media.owner_user_id
  INTO v_storage_path,
       v_bucket_id,
       v_owner_id,
       v_parts,
       v_record_id,
       v_couple_id,
       v_owner_user_id
  FROM public.record_media_objects AS media
  JOIN storage.objects AS object ON object.id = media.storage_object_id
  WHERE media.media_object_id = p_media_object_id
    AND media.storage_object_id = p_storage_object_id
    AND media.lease_id = p_lease_id
    AND media.state = 'leased'
    AND media.lease_expires_at > statement_timestamp();
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_bucket_id IS DISTINCT FROM 'couple-media'
    OR array_length(v_parts, 1) IS DISTINCT FROM 2
    OR v_parts[1] IS DISTINCT FROM v_couple_id::TEXT
    OR v_parts[2] IS DISTINCT FROM v_record_id::TEXT
    OR (CASE
      WHEN v_owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN v_owner_id::UUID
      ELSE NULL
    END) IS DISTINCT FROM v_owner_user_id
  THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  storage_path := v_storage_path;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_record_media_object_cleanup_path(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_record_media_object_cleanup_path(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_record_media_cleanup_job(
  p_record_id UUID,
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
  v_couple_id UUID;
  v_owner_user_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT job.state, job.lease_id, job.couple_id, job.owner_user_id
  INTO v_state, v_lease_id, v_couple_id, v_owner_user_id
  FROM public.record_media_cleanup_jobs AS job
  WHERE job.record_id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.record_media_objects AS media
  WHERE media.record_id = p_record_id
  ORDER BY media.media_object_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    WHERE media.record_id = p_record_id
      AND (
        media.couple_id IS DISTINCT FROM v_couple_id
        OR media.owner_user_id IS DISTINCT FROM v_owner_user_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.record_media_mutations AS mutation
    WHERE mutation.record_id = p_record_id
      AND (
        mutation.couple_id IS DISTINCT FROM v_couple_id
        OR mutation.owner_user_id IS DISTINCT FROM v_owner_user_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'couple-media'
      AND array_length(storage.foldername(object.name), 1) >= 2
      AND (storage.foldername(object.name))[1] = v_couple_id::TEXT
      AND (storage.foldername(object.name))[2] = p_record_id::TEXT
      AND CASE
        WHEN object.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN object.owner_id::UUID
        ELSE NULL
      END IS DISTINCT FROM v_owner_user_id
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_identity_ambiguous'
      USING ERRCODE = '55000';
  END IF;

  IF v_state = 'completed' AND v_lease_id = p_lease_id THEN
    IF EXISTS (
      SELECT 1
      FROM public.record_media_objects AS media
      WHERE media.record_id = p_record_id
        AND media.couple_id = v_couple_id
        AND media.owner_user_id = v_owner_user_id
        AND media.state <> 'deleted'
    ) OR EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'couple-media'
        AND array_length(storage.foldername(object.name), 1) >= 2
        AND (storage.foldername(object.name))[1] = v_couple_id::TEXT
        AND (storage.foldername(object.name))[2] = p_record_id::TEXT
    ) THEN
      UPDATE public.record_media_mutations
      SET state = 'abandoned',
          abandoned_at = coalesce(abandoned_at, clock_timestamp()),
          updated_at = clock_timestamp()
      WHERE record_id = p_record_id
        AND state = 'pending';

      UPDATE public.record_media_objects
      SET state = 'superseded',
          lease_id = NULL,
          lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE record_id = p_record_id
        AND couple_id = v_couple_id
        AND owner_user_id = v_owner_user_id
        AND state <> 'deleted';

      UPDATE public.record_media_cleanup_jobs
      SET state = 'pending',
          lease_id = NULL,
          lease_expires_at = NULL,
          completed_at = NULL,
          next_attempt_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE record_id = p_record_id;
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  IF v_state IS DISTINCT FROM 'leased'
    OR v_lease_id IS DISTINCT FROM p_lease_id
    OR v_couple_id IS NULL
    OR v_owner_user_id IS NULL
  THEN
    RETURN false;
  END IF;

  -- The worker's HTTP listing is advisory until PostgreSQL confirms that the
  -- exact immutable prefix is still empty in this settlement transaction.
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'couple-media'
      AND array_length(storage.foldername(object.name), 1) >= 2
      AND (storage.foldername(object.name))[1] = v_couple_id::TEXT
      AND (storage.foldername(object.name))[2] = p_record_id::TEXT
  ) THEN
    UPDATE public.record_media_cleanup_jobs
    SET state = 'pending',
        lease_id = NULL,
        lease_expires_at = NULL,
        completed_at = NULL,
        next_attempt_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE record_id = p_record_id
      AND lease_id = p_lease_id;
    RETURN false;
  END IF;

  UPDATE public.record_media_objects AS media
  SET state = 'deleted',
      lease_id = NULL,
      lease_expires_at = NULL,
      deleted_at = coalesce(media.deleted_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE media.record_id = p_record_id
    AND media.couple_id = v_couple_id
    AND media.owner_user_id = v_owner_user_id
    AND media.state <> 'deleted';

  UPDATE public.record_media_cleanup_jobs
  SET state = 'completed',
      lease_expires_at = NULL,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE record_id = p_record_id
    AND lease_id = p_lease_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_record_media_cleanup_job(UUID, UUID)
  TO service_role;

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
  WHERE media.state <> 'deleted'
    AND (
      media.owner_user_id = p_user_id
      OR EXISTS (
        SELECT 1 FROM public.daily_records AS record
        WHERE record.id = media.record_id
          AND record.couple_id = media.couple_id
          AND record.user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.record_media_cleanup_jobs AS namespace_job
        WHERE namespace_job.record_id = media.record_id
          AND namespace_job.couple_id = media.couple_id
          AND namespace_job.owner_user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.record_media_mutations AS mutation
        WHERE mutation.record_id = media.record_id
          AND mutation.couple_id = media.couple_id
          AND mutation.owner_user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.record_media_objects AS owned_media
        WHERE owned_media.record_id = media.record_id
          AND owned_media.couple_id = media.couple_id
          AND owned_media.owner_user_id = p_user_id
      )
    )
  ORDER BY media.media_object_id
  FOR UPDATE OF media;

  PERFORM 1
  FROM storage.objects AS object
  WHERE object.bucket_id = 'couple-media'
    AND object.owner_id = p_user_id::TEXT
    AND NOT EXISTS (
      SELECT 1
      FROM public.record_media_objects AS media
      WHERE media.storage_object_id = object.id
    )
  ORDER BY object.id
  FOR UPDATE OF object;

  IF EXISTS (
    SELECT 1
    FROM public.record_media_cleanup_jobs AS job
    WHERE job.owner_user_id = p_user_id
      AND job.state <> 'completed'
  ) OR EXISTS (
    SELECT 1
    FROM public.record_media_objects AS media
    WHERE media.state <> 'deleted'
      AND (
        media.owner_user_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM public.daily_records AS record
          WHERE record.id = media.record_id
            AND record.couple_id = media.couple_id
            AND record.user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.record_media_cleanup_jobs AS namespace_job
          WHERE namespace_job.record_id = media.record_id
            AND namespace_job.couple_id = media.couple_id
            AND namespace_job.owner_user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.record_media_mutations AS mutation
          WHERE mutation.record_id = media.record_id
            AND mutation.couple_id = media.couple_id
            AND mutation.owner_user_id = p_user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.record_media_objects AS owned_media
          WHERE owned_media.record_id = media.record_id
            AND owned_media.couple_id = media.couple_id
            AND owned_media.owner_user_id = p_user_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'couple-media'
      AND object.owner_id = p_user_id::TEXT
      AND NOT EXISTS (
        SELECT 1
        FROM public.record_media_objects AS media
        WHERE media.storage_object_id = object.id
      )
  ) THEN
    RAISE EXCEPTION 'record_media_cleanup_pending' USING ERRCODE = '55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_account_record_media_cleanup_complete(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_account_record_media_cleanup_complete(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_media_cleanup_contract_version()
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
  RETURN 3;
END;
$$;
REVOKE ALL ON FUNCTION public.record_media_cleanup_contract_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_media_cleanup_contract_version()
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Rollback remains forward-only: pause the scheduler and v3 Edge artifacts,
-- preserve every tombstone/fence/direct-DELETE revocation, then ship a higher
-- numbered correction. Never delete Storage metadata directly in SQL.
