-- =============================================================
-- 032_e2ee_write_floor.sql
-- E2EE Phase 1A: the irreversible per-scope write floor.
-- =============================================================
--
-- Additive and inert. Every existing row becomes `cipher_format = 0`
-- (explicitly plaintext) and `content_revision = 1`, no floor is activated for
-- anybody, and the current client keeps working unchanged. This migration
-- installs the mechanism; Phase 1B activates it per account before that
-- account's first encrypted write.
--
-- What the mechanism has to survive is a client that has never heard of any of
-- these columns. PostgREST composes an UPDATE from only the keys in the request
-- body and leaves everything else at its OLD value, and an INSERT that omits a
-- column takes its DEFAULT. That is what makes the three rules below work
-- without trusting a client version string, a header, or anything else the
-- caller controls.
--
-- After activation, for a scope:
--
--   old client INSERTs new plaintext                     -> REJECTED (R1)
--   old client UPDATEs a legacy row, leaving it plaintext -> REJECTED (R2)
--   any client downgrades ciphertext to plaintext         -> REJECTED (R3)
--
-- Legacy rows stay readable forever; SELECT is untouched.

BEGIN;

-- -------------------------------------------------------------
-- 1. Content columns  (explicit, never inferred)
-- -------------------------------------------------------------
-- `cipher_format = 0` MEANS plaintext. Nothing anywhere decides encryption
-- state by looking at whether a value happens to resemble base64; that
-- inference is precisely what makes mixed-version clients unsafe.
-- `record_time` becomes nullable so an encrypted row can carry no plaintext
-- clock value. Existing rows keep theirs and the DEFAULT still applies, so the
-- current client is unaffected.
ALTER TABLE public.daily_records ALTER COLUMN record_time DROP NOT NULL;

ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS cipher_format SMALLINT NOT NULL DEFAULT 0
    CHECK (cipher_format BETWEEN 0 AND 127),
  ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 1
    CHECK (content_revision >= 1),
  ADD COLUMN IF NOT EXISTS key_domain TEXT
    CHECK (key_domain IS NULL OR key_domain IN ('personal', 'couple')),
  ADD COLUMN IF NOT EXISTS key_epoch BIGINT
    CHECK (key_epoch IS NULL OR key_epoch >= 1);

COMMENT ON COLUMN public.daily_records.cipher_format IS
  '0 = legacy plaintext (explicit). 1 = GLE1. Never inferred from the value shape.';
COMMENT ON COLUMN public.daily_records.content_revision IS
  'Server-validated monotonic counter. Bound into the GLE1 associated data and used as the migration CAS, which is why no plaintext hash is stored anywhere.';

-- -------------------------------------------------------------
-- 2. Floor lookup
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.e2ee_floor_for(p_user_id UUID, p_couple_id UUID)
RETURNS SMALLINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(MAX(min_cipher_format), 0)::SMALLINT
  FROM public.crypto_write_floor
  WHERE (scope_kind = 'user' AND scope_id = p_user_id)
     OR (scope_kind = 'couple' AND scope_id = p_couple_id);
$$;

REVOKE ALL ON FUNCTION public.e2ee_floor_for(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------
-- 3. The enforcement trigger
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_e2ee_write_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_floor SMALLINT;
BEGIN
  v_floor := public.e2ee_floor_for(NEW.user_id, NEW.couple_id);

  -- R0 ORDERING. An encrypted write is impossible before the floor exists, so
  -- activation necessarily precedes the first encrypted row rather than
  -- following the migration. This is what makes the ordering mechanical instead
  -- of procedural.
  IF NEW.cipher_format >= 1 AND v_floor = 0 THEN
    RAISE EXCEPTION 'E2EE_FLOOR_NOT_ACTIVE: activate the write floor before writing ciphertext'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- R3 DOWNGRADE. Unconditional, floor or no floor: a row that has ever been
  -- written encrypted can never go back to plaintext.
  IF TG_OP = 'UPDATE' AND OLD.cipher_format >= 1 AND NEW.cipher_format < OLD.cipher_format THEN
    RAISE EXCEPTION 'E2EE_DOWNGRADE_FORBIDDEN: ciphertext cannot be rewritten as plaintext'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_floor >= 1 THEN
    -- R1 INSERT. A legacy client omits cipher_format, so it defaults to 0 and
    -- lands here.
    IF TG_OP = 'INSERT' AND NEW.cipher_format < v_floor THEN
      RAISE EXCEPTION 'E2EE_WRITE_FLOOR: new rows in this scope must be encrypted'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- R2 UPDATE. A legacy client omits cipher_format, so NEW keeps OLD's 0 and
    -- lands here. A legacy row can therefore only be modified by a client that
    -- transitions it to ciphertext in the same statement — atomically, because
    -- it is one UPDATE.
    IF TG_OP = 'UPDATE' AND NEW.cipher_format < v_floor THEN
      RAISE EXCEPTION 'E2EE_WRITE_FLOOR: this row must transition to ciphertext when modified'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- R4 RESIDUE. Every protected column, not just log_text.
  --
  -- The inventory below is the whole `daily_records` content surface across the
  -- migration history (001, 003/009, 019), classified in the report. An earlier
  -- revision checked log_text alone, which let an encrypted row keep its
  -- reaction, emotion flow, attachment manifest and record time in the clear —
  -- the manifest carries file names, so that was the leak that mattered most.
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

  -- R7 DOMAIN BINDING. Visibility and key domain must agree.
  --
  -- A private record wrapped under the couple key would be readable by the
  -- partner the moment the RLS predicate were bypassed or the flag flipped; a
  -- shared record wrapped under the personal key would be unreadable by the
  -- partner who is supposed to see it. Neither is recoverable after the fact,
  -- so both are refused at write time.
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

  -- R5 EPOCH. Encrypted rows must name a live ACTIVE epoch, so a stale writer
  -- holding a retired epoch fails loudly instead of writing content nobody
  -- routes correctly.
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

  -- R6 REVISION. For encrypted rows the client supplies the revision because it
  -- is bound into the associated data, so it is checked as an optimistic CAS
  -- and a concurrent write loses. For legacy plaintext rows the server assigns
  -- it, which is what keeps the existing client working untouched.
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

REVOKE ALL ON FUNCTION public.enforce_e2ee_write_floor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_daily_records_write_floor ON public.daily_records;
CREATE TRIGGER trg_daily_records_write_floor
  BEFORE INSERT OR UPDATE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_e2ee_write_floor();

-- -------------------------------------------------------------
-- 4. PostgREST schema cache
-- -------------------------------------------------------------
-- 031 and 032 add functions that clients call as RPCs. Without this the cache
-- keeps the old signature list and callers get PGRST202 until someone reloads
-- by hand, which is exactly the failure 017 introduced this convention to end.
-- One reload refreshes everything, so it belongs in the last migration of the
-- pair.
NOTIFY pgrst, 'reload schema';

COMMIT;
