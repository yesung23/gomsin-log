-- One bounded, owner-keyed profile thumbnail. This is private profile data,
-- not E2EE or record media. No Storage object or second deletion transaction.
-- Forward-only: duplicate installation fails atomically.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.assert_account_write_open(uuid[],boolean)') IS NULL
    OR to_regprocedure('public.enforce_account_deletion_write_statement()') IS NULL
    OR to_regprocedure('public.enforce_account_deletion_write_row()') IS NULL
  THEN
    RAISE EXCEPTION 'migration_089_account_write_fence_required' USING ERRCODE = '55000';
  END IF;
END
$preflight$;

-- Bounded structural JPEG parser, not an entropy decoder. Accept 8-bit
-- baseline/progressive Huffman JPEGs only. Read actual SOF dimensions, reject
-- duplicate frames, malformed segment bounds, missing scans and trailing data.
-- Pixel decoding/re-encoding and EXIF removal remain the client's responsibility.
CREATE FUNCTION public.profile_avatar_jpeg_is_valid(p_jpeg BYTEA)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_size INTEGER := octet_length(p_jpeg);
  v_pos INTEGER := 2;
  v_marker INTEGER;
  v_length INTEGER;
  v_end INTEGER;
  v_cursor INTEGER;
  v_count INTEGER;
  v_index INTEGER;
  v_value INTEGER;
  v_total INTEGER;
  v_width INTEGER;
  v_height INTEGER;
  v_components INTEGER;
  v_component_ids INTEGER[] := ARRAY[]::INTEGER[];
  v_scan_ids INTEGER[];
  v_frame INTEGER;
  v_have_scan BOOLEAN := false;
  v_in_scan BOOLEAN := false;
  v_entropy_bytes INTEGER := 0;
  v_have_quantization BOOLEAN := false;
  v_have_huffman BOOLEAN := false;
  v_spectral_start INTEGER;
  v_spectral_end INTEGER;
  v_approximation INTEGER;
BEGIN
  IF v_size < 20 OR v_size > 65536 THEN RETURN false; END IF;
  IF get_byte(p_jpeg, 0) <> 255 OR get_byte(p_jpeg, 1) <> 216 THEN RETURN false; END IF;
  WHILE v_pos < v_size LOOP
    IF v_in_scan THEN
      -- Entropy bytes may contain FF00 and restart markers, not new frames.
      WHILE v_pos < v_size LOOP
        IF get_byte(p_jpeg, v_pos) <> 255 THEN
          v_entropy_bytes := v_entropy_bytes + 1;
          v_pos := v_pos + 1;
          CONTINUE;
        END IF;
        IF v_pos + 1 >= v_size THEN RETURN false; END IF;
        v_value := get_byte(p_jpeg, v_pos + 1);
        IF v_value = 0 OR v_value BETWEEN 208 AND 215 THEN
          v_entropy_bytes := v_entropy_bytes + 1;
          v_pos := v_pos + 2;
        ELSIF v_value = 255 THEN
          v_pos := v_pos + 1;
        ELSE
          EXIT;
        END IF;
      END LOOP;
      IF v_entropy_bytes = 0 OR v_pos >= v_size THEN RETURN false; END IF;
      v_in_scan := false;
    END IF;
    IF get_byte(p_jpeg, v_pos) <> 255 THEN RETURN false; END IF;
    WHILE v_pos < v_size AND get_byte(p_jpeg, v_pos) = 255 LOOP
      v_pos := v_pos + 1;
    END LOOP;
    IF v_pos >= v_size THEN RETURN false; END IF;
    v_marker := get_byte(p_jpeg, v_pos);
    v_pos := v_pos + 1;
    IF v_marker = 217 THEN
      RETURN v_have_scan AND v_frame IS NOT NULL AND v_pos = v_size;
    END IF;
    IF v_marker NOT IN (192, 194, 196, 218, 219, 221, 254)
      AND v_marker NOT BETWEEN 224 AND 239
    THEN RETURN false; END IF;
    IF v_pos + 2 > v_size THEN RETURN false; END IF;
    v_length := get_byte(p_jpeg, v_pos) * 256 + get_byte(p_jpeg, v_pos + 1);
    v_end := v_pos + v_length;
    IF v_length < 2 OR v_end > v_size THEN RETURN false; END IF;

    IF v_marker IN (192, 194) THEN
      IF v_frame IS NOT NULL OR v_length < 11 THEN RETURN false; END IF;
      v_frame := v_marker;
      IF get_byte(p_jpeg, v_pos + 2) <> 8 THEN RETURN false; END IF;
      v_height := get_byte(p_jpeg, v_pos + 3) * 256 + get_byte(p_jpeg, v_pos + 4);
      v_width := get_byte(p_jpeg, v_pos + 5) * 256 + get_byte(p_jpeg, v_pos + 6);
      v_components := get_byte(p_jpeg, v_pos + 7);
      IF v_width NOT BETWEEN 1 AND 256 OR v_height <> v_width
        OR v_components NOT IN (1, 3) OR v_length <> 8 + 3 * v_components
      THEN RETURN false; END IF;
      FOR v_index IN 0..v_components - 1 LOOP
        v_cursor := v_pos + 8 + 3 * v_index;
        v_value := get_byte(p_jpeg, v_cursor);
        IF v_value = ANY(v_component_ids) THEN RETURN false; END IF;
        v_component_ids := array_append(v_component_ids, v_value);
        v_value := get_byte(p_jpeg, v_cursor + 1);
        IF (v_value / 16) NOT BETWEEN 1 AND 4 OR (v_value % 16) NOT BETWEEN 1 AND 4
          OR get_byte(p_jpeg, v_cursor + 2) > 3
        THEN RETURN false; END IF;
      END LOOP;
    ELSIF v_marker = 219 THEN
      v_cursor := v_pos + 2;
      IF v_cursor = v_end THEN RETURN false; END IF;
      WHILE v_cursor < v_end LOOP
        v_value := get_byte(p_jpeg, v_cursor);
        IF v_value / 16 > 1 OR v_value % 16 > 3 THEN RETURN false; END IF;
        v_cursor := v_cursor + 1 + 64 * (1 + v_value / 16);
        IF v_cursor > v_end THEN RETURN false; END IF;
      END LOOP;
      v_have_quantization := true;
    ELSIF v_marker = 196 THEN
      v_cursor := v_pos + 2;
      IF v_cursor = v_end THEN RETURN false; END IF;
      WHILE v_cursor < v_end LOOP
        IF v_cursor + 17 > v_end THEN RETURN false; END IF;
        v_value := get_byte(p_jpeg, v_cursor);
        IF v_value / 16 > 1 OR v_value % 16 > 3 THEN RETURN false; END IF;
        v_total := 0;
        FOR v_index IN 1..16 LOOP
          v_total := v_total + get_byte(p_jpeg, v_cursor + v_index);
        END LOOP;
        IF v_total NOT BETWEEN 1 AND 256 THEN RETURN false; END IF;
        v_cursor := v_cursor + 17 + v_total;
        IF v_cursor > v_end THEN RETURN false; END IF;
      END LOOP;
      v_have_huffman := true;
    ELSIF v_marker = 221 THEN
      IF v_length <> 4 THEN RETURN false; END IF;
    ELSIF v_marker = 218 THEN
      IF v_frame IS NULL OR NOT v_have_quantization OR NOT v_have_huffman
        OR v_length < 8
      THEN RETURN false; END IF;
      v_count := get_byte(p_jpeg, v_pos + 2);
      IF v_count < 1 OR v_count > v_components OR v_length <> 6 + 2 * v_count
      THEN RETURN false; END IF;
      v_scan_ids := ARRAY[]::INTEGER[];
      FOR v_index IN 0..v_count - 1 LOOP
        v_value := get_byte(p_jpeg, v_pos + 3 + 2 * v_index);
        IF NOT (v_value = ANY(v_component_ids)) OR v_value = ANY(v_scan_ids)
        THEN RETURN false; END IF;
        v_scan_ids := array_append(v_scan_ids, v_value);
        v_value := get_byte(p_jpeg, v_pos + 4 + 2 * v_index);
        IF v_value / 16 > 3 OR v_value % 16 > 3 THEN RETURN false; END IF;
      END LOOP;
      v_spectral_start := get_byte(p_jpeg, v_end - 3);
      v_spectral_end := get_byte(p_jpeg, v_end - 2);
      v_approximation := get_byte(p_jpeg, v_end - 1);
      IF v_frame = 192 THEN
        IF v_spectral_start <> 0 OR v_spectral_end <> 63 OR v_approximation <> 0
        THEN RETURN false; END IF;
      ELSE
        IF v_spectral_start > v_spectral_end OR v_spectral_end > 63
          OR (v_spectral_start = 0 AND v_spectral_end <> 0)
          OR (v_spectral_start > 0 AND v_count <> 1)
          OR v_approximation / 16 > 13 OR v_approximation % 16 > 13
          OR (v_approximation / 16 > 0 AND v_approximation / 16 <> v_approximation % 16 + 1)
        THEN RETURN false; END IF;
      END IF;
      v_have_scan := true;
      v_in_scan := true;
      v_entropy_bytes := 0;
    END IF;
    v_pos := v_end;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.profile_avatar_jpeg_is_valid(BYTEA)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.profile_avatars (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  jpeg BYTEA,
  version UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT profile_avatars_bounded_jpeg CHECK (
    jpeg IS NULL OR (octet_length(jpeg) BETWEEN 1 AND 65536
      AND public.profile_avatar_jpeg_is_valid(jpeg))
  )
);
ALTER TABLE public.profile_avatars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_avatars FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profile_avatars TO authenticated;

-- Break the private membership/deletion RLS recursion with a boolean-only
-- helper. It never reads an avatar and never accepts a caller identity.
CREATE FUNCTION public.profile_avatar_read_allowed(p_owner_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.role() = 'authenticated'
    AND auth.uid() IS NOT NULL
    AND p_owner_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.account_deletion_requests AS deletion
      WHERE deletion.user_id IN (auth.uid(), p_owner_user_id)
    )
    AND (
      p_owner_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.couple_members AS viewer
        JOIN public.couple_members AS owner ON owner.couple_id = viewer.couple_id
        JOIN public.couples AS relationship ON relationship.id = viewer.couple_id
        WHERE viewer.user_id = auth.uid() AND viewer.status = 'active'
          AND owner.user_id = p_owner_user_id AND owner.status = 'active'
          AND relationship.closed_at IS NULL
      )
    );
$$;
REVOKE ALL ON FUNCTION public.profile_avatar_read_allowed(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_avatar_read_allowed(UUID) TO authenticated;
CREATE POLICY "Owner and current active partner can read profile avatar"
  ON public.profile_avatars FOR SELECT TO authenticated
  USING (public.profile_avatar_read_allowed(user_id));

-- Explicitly enroll the new table: migration 076's list is not dynamic.
-- Auth-admin FK cascades have no JWT role and retain the existing 076 behavior.
CREATE TRIGGER aaa_076_account_write_statement
  BEFORE INSERT OR UPDATE OR DELETE ON public.profile_avatars
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_account_deletion_write_statement('true');
CREATE TRIGGER aaa_076_account_write_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.profile_avatars
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_deletion_write_row('true');

CREATE FUNCTION public.get_profile_avatar(p_owner_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'user_id', avatar.user_id,
    'version', avatar.version,
    'jpeg_base64', translate(encode(avatar.jpeg, 'base64'), E'\n\r', '')
  ) INTO v_result
  FROM public.profile_avatars AS avatar
  WHERE avatar.user_id = p_owner_user_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_profile_avatar(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_avatar(UUID) TO authenticated;

CREATE FUNCTION public.set_my_profile_avatar(
  p_expected_user_id UUID,
  p_expected_version UUID,
  p_operation_id UUID,
  p_jpeg_base64 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_jpeg BYTEA;
  v_old public.profile_avatars%ROWTYPE;
  v_exists BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_expected_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'profile_avatar_actor_mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'profile_avatar_operation_required' USING ERRCODE = '22023';
  END IF;
  IF p_jpeg_base64 IS NOT NULL THEN
    IF octet_length(p_jpeg_base64) NOT BETWEEN 4 AND 87384
      OR length(p_jpeg_base64) % 4 <> 0
      OR p_jpeg_base64 !~ '^[A-Za-z0-9+/]+={0,2}$'
    THEN
      RAISE EXCEPTION 'profile_avatar_invalid_jpeg' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_jpeg := decode(p_jpeg_base64, 'base64');
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION 'profile_avatar_invalid_jpeg' USING ERRCODE = '22023';
    END;
    IF translate(encode(v_jpeg, 'base64'), E'\n\r', '') IS DISTINCT FROM p_jpeg_base64
      OR NOT public.profile_avatar_jpeg_is_valid(v_jpeg)
    THEN
      RAISE EXCEPTION 'profile_avatar_invalid_jpeg' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Acquire the existing ordered account/relationship boundary BEFORE any
  -- child tuple. It serializes first insert, CAS, disconnect and deletion.
  PERFORM public.assert_account_write_open(ARRAY[v_uid]::UUID[], true);
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_avatar_profile_missing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM public.profile_avatars WHERE user_id = v_uid FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND v_old.version = p_operation_id THEN
    IF v_old.jpeg IS DISTINCT FROM v_jpeg THEN
      RAISE EXCEPTION 'profile_avatar_operation_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('user_id', v_uid, 'version', v_old.version);
  END IF;
  IF (v_exists AND v_old.version IS DISTINCT FROM p_expected_version)
    OR (NOT v_exists AND p_expected_version IS NOT NULL)
  THEN
    RAISE EXCEPTION 'profile_avatar_version_conflict' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.profile_avatars(user_id, jpeg, version)
  VALUES (v_uid, v_jpeg, p_operation_id)
  ON CONFLICT (user_id) DO UPDATE
    SET jpeg = EXCLUDED.jpeg, version = EXCLUDED.version, updated_at = clock_timestamp();

  -- No raw bytes in Realtime. Pure replays/unchanged bytes need no signal.
  -- Removal retains its CAS row. FK cascade emits no write while deleting.
  IF v_old.jpeg IS DISTINCT FROM v_jpeg THEN
    INSERT INTO public.collaboration_invalidations(couple_id, slice, updated_at)
    SELECT DISTINCT viewer.couple_id, 'profile', clock_timestamp()
    FROM public.couple_members AS viewer
    JOIN public.couple_members AS partner ON partner.couple_id = viewer.couple_id
      AND partner.user_id <> v_uid AND partner.status = 'active'
    JOIN public.couples AS relationship ON relationship.id = viewer.couple_id
      AND relationship.closed_at IS NULL
    WHERE viewer.user_id = v_uid AND viewer.status = 'active'
    ON CONFLICT (couple_id, slice) DO UPDATE SET updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN jsonb_build_object('user_id', v_uid, 'version', p_operation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_profile_avatar(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_profile_avatar(UUID, UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: disable the avatar client surface and preserve the private table,
-- FK cascade and deletion fences. Correct SQL with a higher-numbered migration;
-- never widen read/DML grants or convert existing media buckets to public.
