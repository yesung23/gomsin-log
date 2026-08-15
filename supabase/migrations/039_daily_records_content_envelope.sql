-- =============================================================
-- 039_daily_records_content_envelope.sql
-- P5: where an encrypted `daily_records` row actually keeps its content.
-- =============================================================
--
-- 032 installed the write floor and, for an encrypted row, made every protected
-- plaintext column illegal: `log_text`, `reaction`, `attachments`,
-- `emotion_flow`, `record_time`. What it never added was somewhere for the
-- content to GO. The consequence is not cosmetic -- with 032 alone an encrypted
-- `daily_records` row is unwritable in practice, because a client that obeys R4
-- has nowhere to put the text it just encrypted. This migration adds that place
-- and nothing else about the enforcement model changes.
--
-- ONE column, not five. A GLE1 envelope per protected field would put five
-- 92-byte headers and five wrapped DEKs on every row to hide fields whose
-- lengths are already correlated, and it would let a client mix epochs and
-- domains WITHIN one record. Instead the client seals one canonical JSON
-- document containing all five field values under object type
-- `dailyRecord` (1) and field id `logText` (1), so a record has exactly one
-- envelope, one DEK, one epoch and one domain. `FIELD_ID` stays in GLE1's AAD
-- for other object types; here it is pinned.
--
-- WHAT THE SERVER STILL LEARNS for an encrypted row, in full: the ids, which
-- couple, whether it is private, `record_date`, `emotion_updated_at`,
-- `talk_about`, the cipher routing columns, the timestamps and the envelope
-- LENGTH. That is exactly the accepted-leakage set in architecture V2.1 §10 --
-- this migration adds no new plaintext surface.
--
-- The routing checks below deliberately do NOT trust the client's own
-- `key_domain` / `key_epoch` values as evidence of anything. They are declared
-- values, so they are checked against server-held state (`scope_keys`,
-- `couple_members`, `is_private`) and against the envelope's own header bytes.
-- A forged header cannot survive both, and the one thing a forger could still
-- do -- write a self-consistent envelope under a key nobody else holds -- makes
-- the row undecryptable rather than mis-routed, which is the honest limit and is
-- asserted as such in the harness.

BEGIN;

-- -------------------------------------------------------------
-- 0. P0 FIX: 032's trigger cannot read the floor it enforces
-- -------------------------------------------------------------
-- Found by running 032 against a real cluster as a real `authenticated` actor,
-- which nothing had done before: the P0 harness exercises the key tables and
-- never writes a `daily_records` row.
--
-- `enforce_e2ee_write_floor()` is declared without SECURITY DEFINER, so it runs
-- as the CALLER. Its first statement calls `e2ee_floor_for()`, whose EXECUTE is
-- revoked from `authenticated` (032:71, deliberately -- it takes an arbitrary
-- user id and must not be callable directly). The trigger therefore raises
--
--   ERROR 42501: permission denied for function e2ee_floor_for
--
-- on EVERY insert and update by a normal client. Not only encrypted writes:
-- the lookup happens before any branch, so applying 032 as committed makes
-- `daily_records` completely unwritable for every real user, plaintext included.
-- It was invisible because the write floor is inert until activated and no test
-- had ever written the table through the trigger as a non-superuser.
--
-- The fix is to make the trigger SECURITY DEFINER, which is the correct shape
-- for it regardless: it must read `crypto_write_floor` and `scope_keys` rows
-- that the calling user may not be able to see, and its own logic is what
-- decides the outcome -- it takes no caller-supplied identity, only NEW.
-- `search_path` is already pinned, and the function stays revoked from every
-- client role, so nothing can call it except as a trigger.
--
-- `ALTER FUNCTION` rather than a corrected `CREATE OR REPLACE`, and this is not
-- a style choice. Re-declaring the function here would fork its body: 032 would
-- hold one copy and 039 another, the live behaviour would come from whichever
-- ran last, and a future edit to 032's rules would silently do nothing. Altering
-- the property leaves 032 as the single definition of what the floor enforces
-- and changes only the security context it runs in. 032 itself is not edited,
-- because it is committed and the ledger rule is forward-only.
ALTER FUNCTION public.enforce_e2ee_write_floor() SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.enforce_e2ee_write_floor() FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------
-- 1. The envelope column
-- -------------------------------------------------------------
-- `bytea`, not text. A base64 column would add 33% to every row and invite
-- exactly the "does this look like base64?" inference that invariant 12 forbids.
--
-- The CHECK is a floor, not a format parse: 92-byte GLE1 header + 16-byte GCM
-- tag = 108 bytes is the smallest possible envelope (empty plaintext). Postgres
-- is not the right place to validate AEAD structure, but it IS the right place
-- to refuse a value that cannot be one.
ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS content_envelope BYTEA
    CHECK (content_envelope IS NULL OR octet_length(content_envelope) >= 108);

COMMENT ON COLUMN public.daily_records.content_envelope IS
  'GLE1 envelope (92-byte header + ciphertext + 16-byte tag) holding log_text, reaction, attachments, emotion_flow and record_time as one sealed document. NULL exactly when cipher_format = 0.';

-- -------------------------------------------------------------
-- 2. Envelope presence is an exact biconditional
-- -------------------------------------------------------------
-- Both directions matter and they fail differently:
--
--   cipher_format >= 1 with no envelope -> a row whose content was silently
--     dropped. 032's R4 already erased the plaintext, so without this check the
--     ONLY copy of the user's text is gone. This is the data-loss direction.
--   cipher_format  = 0 with an envelope -> a plaintext row carrying opaque
--     bytes nothing reads, i.e. an unaudited second content channel.
--
-- Enforced in the trigger rather than a table CHECK because the message has to
-- name which direction failed, and because a CHECK cannot see OLD on UPDATE.
CREATE OR REPLACE FUNCTION public.enforce_daily_record_envelope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_header_domain SMALLINT;
  v_header_epoch BIGINT;
  v_expected_domain SMALLINT;
BEGIN
  IF NEW.cipher_format = 0 THEN
    IF NEW.content_envelope IS NOT NULL THEN
      RAISE EXCEPTION 'E2EE_ENVELOPE_ON_PLAINTEXT: a cipher_format 0 row must not carry a content envelope'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.content_envelope IS NULL THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_REQUIRED: an encrypted row must carry its content envelope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------
  -- Header agreement
  -- ---------------------------------------------------------
  -- 032 checks the ROUTING COLUMNS against `scope_keys`. Those columns are
  -- supplied by the same client that supplied the envelope, so on their own they
  -- prove only self-consistency. Reading the domain and epoch back out of the
  -- envelope's own header closes the gap where a client writes ciphertext sealed
  -- under the personal key while declaring `key_domain = 'couple'` -- which
  -- would pass every check in 032 and hand the partner a row they can never
  -- open.
  --
  -- Offsets are GLE1's, and they are load-bearing: magic 0..3, domain at 7,
  -- key_epoch big-endian u64 at 12..19. `get_byte` is 0-indexed; `substr` on
  -- bytea is 1-indexed.
  --
  -- Length is checked HERE as well as by the column CHECK, because a BEFORE
  -- trigger runs before constraints are evaluated. Without this, a short value
  -- fails on `get_byte` with PostgreSQL's own `index 4 out of valid range`,
  -- which is a correct refusal reached by accident: it depends on the order the
  -- offsets happen to be read in, and it tells an operator nothing. Failing
  -- explicitly means the reason survives a future reordering of the reads.
  IF octet_length(NEW.content_envelope) < 108 THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_TRUNCATED: a GLE1 envelope is at least 108 bytes, saw %',
      octet_length(NEW.content_envelope)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF substr(NEW.content_envelope, 1, 4) <> '\x474c4531'::BYTEA THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_MAGIC: content envelope is not a GLE1 envelope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF get_byte(NEW.content_envelope, 4) <> 1 THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_FORMAT: unsupported GLE1 format version %',
      get_byte(NEW.content_envelope, 4)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_header_domain := get_byte(NEW.content_envelope, 7);

  -- Wire values from `src/crypto/domains.ts`: personal 1, health 2, couple 3.
  -- `health` is rejected outright here. A daily record is never health-domain
  -- content, and HRK must never stand in for PMK or CSK (architecture V2.1 §2);
  -- refusing the value at the write path means that substitution cannot be
  -- expressed in this table at all rather than merely being unlikely.
  v_expected_domain := CASE NEW.key_domain WHEN 'personal' THEN 1 WHEN 'couple' THEN 3 ELSE NULL END;
  IF v_expected_domain IS NULL THEN
    RAISE EXCEPTION 'E2EE_DOMAIN_UNSUPPORTED: daily_records accepts only the personal and couple domains, not %',
      COALESCE(NEW.key_domain, 'NULL')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_header_domain <> v_expected_domain THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_DOMAIN_MISMATCH: envelope header domain % contradicts key_domain %',
      v_header_domain, NEW.key_domain
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Big-endian u64 at offset 12. Read as NUMERIC and cast, because an epoch
  -- above 2^63 would overflow BIGINT arithmetic mid-expression; 031 constrains
  -- epochs to >= 1 and they increment one per rotation, so this is a
  -- belt-and-braces read rather than an expected case.
  v_header_epoch := (
      get_byte(NEW.content_envelope, 12)::NUMERIC * 72057594037927936
    + get_byte(NEW.content_envelope, 13)::NUMERIC * 281474976710656
    + get_byte(NEW.content_envelope, 14)::NUMERIC * 1099511627776
    + get_byte(NEW.content_envelope, 15)::NUMERIC * 4294967296
    + get_byte(NEW.content_envelope, 16)::NUMERIC * 16777216
    + get_byte(NEW.content_envelope, 17)::NUMERIC * 65536
    + get_byte(NEW.content_envelope, 18)::NUMERIC * 256
    + get_byte(NEW.content_envelope, 19)::NUMERIC
  )::BIGINT;

  IF v_header_epoch <> NEW.key_epoch THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_EPOCH_MISMATCH: envelope header epoch % contradicts key_epoch %',
      v_header_epoch, NEW.key_epoch
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------
  -- Shared content requires a live active membership
  -- ---------------------------------------------------------
  -- The author's own RLS policy (009) already requires
  -- `couple_id = get_my_active_couple_id()` on write, so for an authenticated
  -- client this is a second wall rather than the first. It is here for the
  -- writers RLS does not constrain: `service_role` and any SECURITY DEFINER
  -- path. A couple-domain row for a couple with no active membership is
  -- content nobody can ever read, and writing it is always a bug.
  --
  -- Because RLS reaches this first for a normal client, the harness proves this
  -- branch by exercising it as service_role -- an assertion that only ever ran
  -- behind another policy is the vacuous-security pattern 028 and 038 already
  -- shipped twice.
  IF NEW.key_domain = 'couple' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.couple_members cm
      WHERE cm.couple_id = NEW.couple_id
        AND cm.user_id = NEW.user_id
        AND cm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'E2EE_COUPLE_MEMBERSHIP_REQUIRED: couple-domain content requires an active membership'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---------------------------------------------------------
  -- The envelope is immutable for a given revision
  -- ---------------------------------------------------------
  -- 032's R6 already makes `content_revision` a strict +1 CAS for encrypted
  -- rows. Pinning the envelope to it closes the remaining edit: rewriting the
  -- ciphertext while keeping the revision would leave the GLE1 associated data
  -- (which binds the revision) describing bytes that are no longer there, so an
  -- honest reader would fail authentication on a row the server accepted.
  IF TG_OP = 'UPDATE'
     AND OLD.cipher_format >= 1
     AND NEW.content_revision = OLD.content_revision
     AND NEW.content_envelope <> OLD.content_envelope THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_IMMUTABLE: changing the envelope requires a new content_revision'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_daily_record_envelope() FROM PUBLIC, anon, authenticated;

-- Fires AFTER the 032 trigger. Postgres runs same-timing row triggers in
-- alphabetical order, and `trg_daily_records_envelope` sorts before
-- `trg_daily_records_write_floor`, so the name is deliberately chosen to sort
-- AFTER it: the floor's own refusals (no floor, downgrade, residue, stale
-- epoch) must be the reported cause when both apply, otherwise a plaintext
-- downgrade attempt would be reported as an envelope problem.
DROP TRIGGER IF EXISTS trg_daily_records_write_floor_z_envelope ON public.daily_records;
CREATE TRIGGER trg_daily_records_write_floor_z_envelope
  BEFORE INSERT OR UPDATE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_record_envelope();

-- -------------------------------------------------------------
-- 3. Column-level write grants
-- -------------------------------------------------------------
-- `authenticated` must be able to write the envelope and its routing columns.
-- 012 granted table-level INSERT/UPDATE on `daily_records`, which already
-- covers columns added later, so this is stated explicitly only so that an
-- audit of who may write ciphertext does not depend on reading 012.
GRANT INSERT (content_envelope, cipher_format, content_revision, key_domain, key_epoch),
      UPDATE (content_envelope, cipher_format, content_revision, key_domain, key_epoch)
  ON public.daily_records TO authenticated;

REVOKE ALL ON TABLE public.daily_records FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK (manual, and NOT safe once any encrypted row exists):
--
--   DROP TRIGGER IF EXISTS trg_daily_records_write_floor_z_envelope ON public.daily_records;
--   DROP FUNCTION IF EXISTS public.enforce_daily_record_envelope();
--   ALTER TABLE public.daily_records DROP COLUMN content_envelope;
--
-- Dropping the column DESTROYS the only copy of every encrypted record's
-- content -- 032's R4 guarantees the plaintext columns are empty for those
-- rows. Before running it, assert there is nothing to lose:
--
--   SELECT count(*) FROM public.daily_records WHERE cipher_format >= 1;
--   -- must be 0
--
-- If that count is non-zero the correct recovery is a client-side decrypt and
-- re-write, not this rollback. The write floor is irreversible by design
-- (031's enforce_write_floor_monotonic), so a scope that has started writing
-- ciphertext cannot be returned to plaintext operation by dropping a column.
