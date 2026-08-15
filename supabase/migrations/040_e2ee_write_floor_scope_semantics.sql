-- =============================================================
-- 040_e2ee_write_floor_scope_semantics.sql
-- Forward correction: exact write-floor scope semantics.
-- =============================================================
--
-- 032's two-UUID helper used MAX across a personal and a couple row. That
-- makes one scope's irreversible floor silently govern another scope. This
-- migration replaces the helper and trigger in place; 031, 032 and 039 remain
-- historical, immutable migrations.

BEGIN;

-- -------------------------------------------------------------
-- 1. Exact-scope floor lookup
-- -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.e2ee_floor_for(UUID, UUID);

CREATE OR REPLACE FUNCTION public.e2ee_floor_for(
  p_scope_kind TEXT,
  p_scope_id UUID
)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor SMALLINT;
BEGIN
  IF p_scope_kind NOT IN ('user', 'couple') THEN
    RAISE EXCEPTION 'E2EE_FLOOR_BAD_SCOPE_KIND';
  END IF;
  SELECT cwf.min_cipher_format INTO v_floor
  FROM public.crypto_write_floor cwf
  WHERE cwf.scope_kind = p_scope_kind
    AND cwf.scope_id = p_scope_id;
  RETURN COALESCE(v_floor, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_floor_for(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------
-- 2. Exact-scope enforcement, retaining 032's R0-R7 rules
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_e2ee_write_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope_kind TEXT;
  v_scope_id UUID;
  v_floor SMALLINT;
BEGIN
  -- A private row is governed only by its personal scope. A shared row is
  -- governed only by its couple scope. Never MAX unrelated scopes.
  IF NEW.is_private THEN
    v_scope_kind := 'user';
    v_scope_id := NEW.user_id;
  ELSE
    v_scope_kind := 'couple';
    v_scope_id := NEW.couple_id;
  END IF;
  v_floor := public.e2ee_floor_for(v_scope_kind, v_scope_id);

  -- R0 ORDERING.
  IF NEW.cipher_format >= 1 AND v_floor = 0 THEN
    RAISE EXCEPTION 'E2EE_FLOOR_NOT_ACTIVE: activate the write floor before writing ciphertext'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- R3 DOWNGRADE.
  IF TG_OP = 'UPDATE' AND OLD.cipher_format >= 1 AND NEW.cipher_format < OLD.cipher_format THEN
    RAISE EXCEPTION 'E2EE_DOWNGRADE_FORBIDDEN: ciphertext cannot be rewritten as plaintext'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_floor >= 1 THEN
    -- R1 INSERT.
    IF TG_OP = 'INSERT' AND NEW.cipher_format < v_floor THEN
      RAISE EXCEPTION 'E2EE_WRITE_FLOOR: new rows in this scope must be encrypted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- R2 UPDATE.
    IF TG_OP = 'UPDATE' AND NEW.cipher_format < v_floor THEN
      RAISE EXCEPTION 'E2EE_WRITE_FLOOR: this row must transition to ciphertext when modified'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- R4 RESIDUE.
  IF NEW.cipher_format >= 1 THEN
    IF NEW.log_text IS NOT NULL AND NEW.log_text <> '' THEN
      RAISE EXCEPTION 'E2EE_PLAINTEXT_RESIDUE: log_text' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.reaction IS NOT NULL THEN
      RAISE EXCEPTION 'E2EE_PLAINTEXT_RESIDUE: reaction' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.attachments IS NOT NULL AND NEW.attachments <> '[]'::jsonb THEN
      RAISE EXCEPTION 'E2EE_PLAINTEXT_RESIDUE: attachments' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.emotion_flow IS NOT NULL AND NEW.emotion_flow <> '[]'::jsonb THEN
      RAISE EXCEPTION 'E2EE_PLAINTEXT_RESIDUE: emotion_flow' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.record_time IS NOT NULL THEN
      RAISE EXCEPTION 'E2EE_PLAINTEXT_RESIDUE: record_time' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- R7 DOMAIN BINDING.
  IF NEW.cipher_format >= 1 THEN
    IF NEW.is_private AND NEW.key_domain <> 'personal' THEN
      RAISE EXCEPTION 'E2EE_DOMAIN_BINDING: a private record must use the personal domain, not %', NEW.key_domain
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT NEW.is_private AND NEW.key_domain <> 'couple' THEN
      RAISE EXCEPTION 'E2EE_DOMAIN_BINDING: a shared record must use the couple domain, not %', NEW.key_domain
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- R5 EPOCH.
  IF NEW.cipher_format >= 1 THEN
    IF NEW.key_domain IS NULL OR NEW.key_epoch IS NULL THEN
      RAISE EXCEPTION 'E2EE_MISSING_KEY_ROUTING: encrypted rows must name a domain and epoch'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.scope_keys sk
      WHERE sk.state = 'ACTIVE'
        AND sk.domain = NEW.key_domain
        AND sk.key_epoch = NEW.key_epoch
        AND (
          (NEW.key_domain = 'couple' AND sk.owner_couple_id = NEW.couple_id)
          OR (NEW.key_domain = 'personal' AND sk.owner_user_id = NEW.user_id)
        )
    ) THEN
      RAISE EXCEPTION 'E2EE_STALE_EPOCH: % epoch % is not the active epoch for this scope',
        NEW.key_domain, NEW.key_epoch
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- R6 REVISION.
  IF TG_OP = 'INSERT' THEN
    IF NEW.cipher_format >= 1 AND NEW.content_revision <> 1 THEN
      RAISE EXCEPTION 'E2EE_REVISION_CAS: a new encrypted row starts at revision 1'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW.cipher_format >= 1 THEN
      IF NEW.content_revision <> OLD.content_revision + 1 THEN
        RAISE EXCEPTION 'E2EE_REVISION_CAS: expected revision %, got %',
          OLD.content_revision + 1, NEW.content_revision
          USING ERRCODE = 'serialization_failure';
      END IF;
    ELSE
      NEW.content_revision := OLD.content_revision + 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Preserve the 039 SECURITY DEFINER correction and the client revoke.
ALTER FUNCTION public.enforce_e2ee_write_floor() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.enforce_e2ee_write_floor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_records_write_floor ON public.daily_records;
CREATE TRIGGER trg_daily_records_write_floor
  BEFORE INSERT OR UPDATE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_e2ee_write_floor();

-- -------------------------------------------------------------
-- 3. Exact activation semantics
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_e2ee_write_floor(
  p_scope_kind TEXT,
  p_scope_id UUID,
  p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = p_device_id AND d.user_id = v_uid AND d.status <> 'REVOKED'
  ) THEN
    RAISE EXCEPTION 'E2EE_DEVICE_SCOPE_FORBIDDEN';
  END IF;

  IF p_scope_kind = 'user' THEN
    IF p_scope_id <> v_uid THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;
    -- Personal activation is PMK-only. HRK/health can never satisfy this.
    IF NOT EXISTS (
      SELECT 1 FROM public.scope_keys sk
      WHERE sk.state = 'ACTIVE'
        AND sk.domain = 'personal'
        AND sk.scope_id = p_scope_id
        AND sk.owner_user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'E2EE_FLOOR_NO_ACTIVE_PERSONAL_EPOCH';
    END IF;
  ELSIF p_scope_kind = 'couple' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.couple_members cm
      WHERE cm.couple_id = p_scope_id
        AND cm.user_id = v_uid
        AND cm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.scope_keys sk
      WHERE sk.state = 'ACTIVE'
        AND sk.domain = 'couple'
        AND sk.scope_id = p_scope_id
        AND sk.owner_couple_id = p_scope_id
    ) THEN
      RAISE EXCEPTION 'E2EE_FLOOR_NO_ACTIVE_COUPLE_EPOCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'E2EE_FLOOR_BAD_SCOPE_KIND';
  END IF;

  INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at, activated_by_device_id)
  VALUES (p_scope_kind, p_scope_id, 1, now(), p_device_id)
  ON CONFLICT (scope_kind, scope_id) DO UPDATE
    SET min_cipher_format = GREATEST(public.crypto_write_floor.min_cipher_format, 1),
        activated_at = COALESCE(public.crypto_write_floor.activated_at, now()),
        activated_by_device_id = COALESCE(public.crypto_write_floor.activated_by_device_id, p_device_id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_e2ee_write_floor(TEXT, UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
