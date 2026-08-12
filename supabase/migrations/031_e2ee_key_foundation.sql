-- =============================================================
-- 031_e2ee_key_foundation.sql
-- E2EE Phase 1A: key infrastructure only. No content is encrypted.
-- =============================================================
--
-- Additive. No existing table is altered destructively, no existing row is
-- rewritten, and no content column is added. Phase 1B is where record text
-- starts using any of this.
--
-- The load-bearing idea, and the reason several columns look redundant:
--
--   `devices.status` is OPERATIONAL METADATA ONLY.
--
-- It drives UI copy and nothing else. Cryptographic trust comes from a signed
-- certificate chain terminating at the account's recovery signing key, which
-- clients verify themselves. A malicious service_role can set any status it
-- likes and gain nothing, because no honest client consults it when deciding
-- who may receive a scope key. The policies below are defence in depth, not the
-- confidentiality boundary.
--
-- Rollback: 033_rollback_e2ee_key_foundation.sql.disabled. Safe, because no content row
-- references anything here.

BEGIN;

-- -------------------------------------------------------------
-- 0. Deployment identity
-- -------------------------------------------------------------
-- Bound into every transcript and certificate so a signature captured from one
-- Supabase project cannot be replayed against another.
CREATE TABLE IF NOT EXISTS public.crypto_deployment (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  server_origin_id BYTEA NOT NULL CHECK (octet_length(server_origin_id) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crypto_deployment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read deployment identity" ON public.crypto_deployment;
CREATE POLICY "Authenticated can read deployment identity"
  ON public.crypto_deployment FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.crypto_deployment FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.crypto_deployment TO authenticated;

-- -------------------------------------------------------------
-- 1. Recovery identity  (USER OWNED)
-- -------------------------------------------------------------
-- The trust root. `rec_sig` signs the first device certificate and every
-- recovery-rooted one; `rec_kem` receives recovery envelopes.
--
-- The private halves are stored ONLY as AES-GCM ciphertext under a key derived
-- from the user's 256-bit recovery secret, which never reaches the server. A
-- full database dump therefore yields public keys and opaque blobs.
CREATE TABLE IF NOT EXISTS public.recovery_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recovery_version SMALLINT NOT NULL DEFAULT 1 CHECK (recovery_version BETWEEN 1 AND 255),
  recovery_salt BYTEA NOT NULL CHECK (octet_length(recovery_salt) = 32),
  rec_sig_spki BYTEA NOT NULL CHECK (octet_length(rec_sig_spki) = 91),
  rec_kem_spki BYTEA NOT NULL CHECK (octet_length(rec_kem_spki) = 91),
  enc_rec_sig_priv BYTEA NOT NULL,
  enc_rec_kem_priv BYTEA NOT NULL,
  recovery_bundle_fp BYTEA NOT NULL CHECK (octet_length(recovery_bundle_fp) = 32),
  bundle_sig BYTEA NOT NULL CHECK (octet_length(bundle_sig) = 64),
  creating_device_id UUID,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recovery_version)
);

-- Exactly one live recovery identity per user; older generations are retained
-- with `superseded_at` set so historical certificates remain checkable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_identity_live
  ON public.recovery_identities (user_id) WHERE superseded_at IS NULL;

ALTER TABLE public.recovery_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own recovery identity" ON public.recovery_identities;
CREATE POLICY "Owner reads own recovery identity"
  ON public.recovery_identities FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner creates own recovery identity" ON public.recovery_identities;
CREATE POLICY "Owner creates own recovery identity"
  ON public.recovery_identities FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE and no DELETE policy: a recovery identity is superseded through the
-- service-role rotation path, never edited in place by a client.

REVOKE ALL ON TABLE public.recovery_identities FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.recovery_identities TO authenticated;

-- Partners need the public half of each other's recovery anchor to pin it
-- during pairing. Exposed through a narrow RPC rather than a table policy so
-- the encrypted private blobs can never be selected.
CREATE OR REPLACE FUNCTION public.get_partner_recovery_anchor()
RETURNS TABLE (
  recovery_identity_id UUID,
  recovery_version SMALLINT,
  rec_sig_spki BYTEA,
  rec_kem_spki BYTEA,
  recovery_bundle_fp BYTEA
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_couple_id UUID;
  v_partner_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT cm.couple_id INTO v_couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = v_uid AND cm.status = 'active'
  LIMIT 1;

  IF v_couple_id IS NULL THEN
    RETURN;
  END IF;

  SELECT cm.user_id INTO v_partner_id
  FROM public.couple_members cm
  WHERE cm.couple_id = v_couple_id AND cm.status = 'active' AND cm.user_id <> v_uid
  LIMIT 1;

  IF v_partner_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ri.id, ri.recovery_version, ri.rec_sig_spki, ri.rec_kem_spki, ri.recovery_bundle_fp
  FROM public.recovery_identities ri
  WHERE ri.user_id = v_partner_id AND ri.superseded_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_recovery_anchor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_recovery_anchor() TO authenticated;

-- -------------------------------------------------------------
-- 1b. Recovery public anchor  (HISTORICAL VERIFICATION)
-- -------------------------------------------------------------
-- The non-secret half of a recovery identity, kept separately so it can outlive
-- the identity row itself. Verifying a historical envelope needs the root
-- public key; it never needs the encrypted private blobs, the salt or the
-- secret, none of which are here.
CREATE TABLE IF NOT EXISTS public.recovery_public_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  recovery_identity_id UUID NOT NULL,
  recovery_version SMALLINT NOT NULL,
  rec_sig_spki BYTEA NOT NULL CHECK (octet_length(rec_sig_spki) = 91),
  rec_sig_fp BYTEA NOT NULL CHECK (octet_length(rec_sig_fp) = 32),
  recovery_bundle_fp BYTEA NOT NULL CHECK (octet_length(recovery_bundle_fp) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recovery_identity_id, recovery_version)
);

ALTER TABLE public.recovery_public_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own anchor" ON public.recovery_public_anchors;
CREATE POLICY "Owner reads own anchor"
  ON public.recovery_public_anchors FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner inserts own anchor" ON public.recovery_public_anchors;
CREATE POLICY "Owner inserts own anchor"
  ON public.recovery_public_anchors FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Active partner reads anchor" ON public.recovery_public_anchors;
CREATE POLICY "Active partner reads anchor"
  ON public.recovery_public_anchors FOR SELECT TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.couple_members mine
      JOIN public.couple_members theirs ON theirs.couple_id = mine.couple_id
      WHERE mine.user_id = auth.uid() AND mine.status = 'active'
        AND theirs.user_id = public.recovery_public_anchors.user_id AND theirs.status = 'active'
    )
  );

REVOKE ALL ON TABLE public.recovery_public_anchors FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.recovery_public_anchors TO authenticated;

-- -------------------------------------------------------------
-- 2. Devices  (DEVICE OWNED — operational state only)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sig_spki BYTEA NOT NULL CHECK (octet_length(sig_spki) = 91),
  kem_spki BYTEA NOT NULL CHECK (octet_length(kem_spki) = 91),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  -- Reported by the platform, never inferred. `web_nonextractable` prevents key
  -- export but not key use by same-origin script, so it is the weakest class.
  assurance TEXT NOT NULL CHECK (assurance IN (
    'secure_enclave', 'strongbox', 'tee', 'software_keystore', 'web_nonextractable'
  )),
  -- Operational only. NEVER a cryptographic trust input.
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'RECOVERY_AUTHENTICATED', 'PROVISIONING', 'ACTIVE',
    'PROVISIONING_FAILED', 'REVOKED'
  )),
  -- User-chosen free text, encrypted under the personal key so the server never
  -- learns "회사 노트북".
  label_ct BYTEA,
  key_schema_version SMALLINT NOT NULL DEFAULT 1,
  enrollment_method TEXT CHECK (enrollment_method IN ('bootstrap', 'device_approval', 'recovery', 'partner_assist')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, sig_spki)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON public.devices (user_id);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own devices" ON public.devices;
CREATE POLICY "Owner manages own devices"
  ON public.devices FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- A partner may see the public keys of the other's devices in order to verify
-- certificate chains during pairing. This exposes no secret: the certificate
-- chain, not this row, is what decides trust.
DROP POLICY IF EXISTS "Active partner reads device public keys" ON public.devices;
CREATE POLICY "Active partner reads device public keys"
  ON public.devices FOR SELECT TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.couple_members mine
      JOIN public.couple_members theirs ON theirs.couple_id = mine.couple_id
      WHERE mine.user_id = auth.uid() AND mine.status = 'active'
        AND theirs.user_id = public.devices.user_id AND theirs.status = 'active'
    )
  );

REVOKE ALL ON TABLE public.devices FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.devices TO authenticated;

-- -------------------------------------------------------------
-- 3. Device certificates  (HISTORICAL VERIFICATION — immutable)
-- -------------------------------------------------------------
-- Separated from `devices` on purpose. Operational device rows are deleted with
-- the account; certificates are non-secret verification material and are kept
-- only while a surviving envelope still needs them, under MINIMUM NECESSARY
-- RETENTION. Contents are public keys, fingerprints, opaque ids and timestamps.
CREATE TABLE IF NOT EXISTS public.device_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subject_device_id UUID NOT NULL,
  issuer_device_id UUID,
  -- The verification path, modelled as real references rather than implied.
  -- A certificate issued by another device points at that device's
  -- certificate; a root-issued certificate points at the recovery anchor.
  -- Exactly one of the two is set, and both are ON DELETE RESTRICT, so the
  -- whole chain from a retained envelope up to the root is undeletable while
  -- anything still depends on it.
  issuer_certificate_id UUID REFERENCES public.device_certificates(id) ON DELETE RESTRICT,
  recovery_public_anchor_id UUID REFERENCES public.recovery_public_anchors(id) ON DELETE RESTRICT,
  CONSTRAINT device_certificates_chain CHECK (
    (issuer_certificate_id IS NOT NULL AND recovery_public_anchor_id IS NULL)
    OR (issuer_certificate_id IS NULL AND recovery_public_anchor_id IS NOT NULL)
  ),
  recovery_identity_id UUID NOT NULL,
  recovery_version SMALLINT NOT NULL,
  certificate BYTEA NOT NULL CHECK (octet_length(certificate) = 445),
  certificate_fp BYTEA NOT NULL CHECK (octet_length(certificate_fp) = 32),
  subject_sig_spki BYTEA NOT NULL CHECK (octet_length(subject_sig_spki) = 91),
  subject_kem_spki BYTEA NOT NULL CHECK (octet_length(subject_kem_spki) = 91),
  -- Deliberately NO cached reference_count. Retention is decided by the real
  -- foreign key from key_envelopes.sender_certificate_id, which is ON DELETE
  -- RESTRICT; a counter maintained in application code drifts, and a drifted
  -- counter here means either a deleted certificate that was still needed or a
  -- certificate retained forever. Use COUNT(*) when a number is wanted.
  retained_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_device_id, certificate_fp)
);

CREATE INDEX IF NOT EXISTS idx_device_certificates_user ON public.device_certificates (user_id);
CREATE INDEX IF NOT EXISTS idx_device_certificates_subject ON public.device_certificates (subject_device_id);

ALTER TABLE public.device_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own certificates" ON public.device_certificates;
CREATE POLICY "Owner reads own certificates"
  ON public.device_certificates FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner inserts own certificates" ON public.device_certificates;
CREATE POLICY "Owner inserts own certificates"
  ON public.device_certificates FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Active partner reads certificates" ON public.device_certificates;
CREATE POLICY "Active partner reads certificates"
  ON public.device_certificates FOR SELECT TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.couple_members mine
      JOIN public.couple_members theirs ON theirs.couple_id = mine.couple_id
      WHERE mine.user_id = auth.uid() AND mine.status = 'active'
        AND theirs.user_id = public.device_certificates.user_id AND theirs.status = 'active'
    )
  );

-- No UPDATE or DELETE for authenticated: certificates are append-only from a
-- client's perspective. A certificate that could be edited is not a certificate.
REVOKE ALL ON TABLE public.device_certificates FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.device_certificates TO authenticated;

-- Immutability, enforced rather than merely un-granted.
CREATE OR REPLACE FUNCTION public.reject_certificate_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'device_certificates is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_device_certificates_immutable ON public.device_certificates;
CREATE TRIGGER trg_device_certificates_immutable
  BEFORE UPDATE OF certificate, certificate_fp, subject_sig_spki, subject_kem_spki,
                   user_id, subject_device_id, recovery_identity_id
  ON public.device_certificates
  FOR EACH ROW EXECUTE FUNCTION public.reject_certificate_mutation();

-- -------------------------------------------------------------
-- 4. Device enrollment nonces
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  new_device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  approver_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  enroll_nonce BYTEA NOT NULL CHECK (octet_length(enroll_nonce) = 32),
  granted_domains SMALLINT NOT NULL CHECK (granted_domains BETWEEN 0 AND 7),
  transcript_hash BYTEA CHECK (transcript_hash IS NULL OR octet_length(transcript_hash) = 32),
  approval_signature BYTEA CHECK (approval_signature IS NULL OR octet_length(approval_signature) = 64),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single use, enforced by the database rather than by a check-then-act race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_nonce ON public.device_enrollments (enroll_nonce);

ALTER TABLE public.device_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own enrollments" ON public.device_enrollments;
CREATE POLICY "Owner manages own enrollments"
  ON public.device_enrollments FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.device_enrollments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.device_enrollments TO authenticated;

-- -------------------------------------------------------------
-- 5. Scope keys and epochs
-- -------------------------------------------------------------
-- personal / health  -> USER OWNED   (scope_id = user_id)
-- couple             -> COUPLE OWNED (scope_id = couple_id)
--
-- No key bytes here. This table records only which epoch exists and what state
-- it is in.
CREATE TABLE IF NOT EXISTS public.scope_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('personal', 'health', 'couple')),
  scope_id UUID NOT NULL,
  -- Ownership is split structurally, and this is the fix for a reproduced
  -- data-loss defect: when couple keys hung off `auth.users(id) ON DELETE
  -- CASCADE`, deleting A's Auth row cascaded away the couple epochs and with
  -- them every envelope B held. A couple key now has no foreign key to
  -- auth.users at all, so no individual account deletion can reach it.
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_couple_id UUID REFERENCES public.couples(id) ON DELETE CASCADE,
  CONSTRAINT scope_keys_ownership CHECK (
    (domain IN ('personal', 'health') AND owner_user_id IS NOT NULL AND owner_couple_id IS NULL)
    OR (domain = 'couple' AND owner_couple_id IS NOT NULL AND owner_user_id IS NULL)
  ),
  key_epoch BIGINT NOT NULL CHECK (key_epoch >= 1),
  state TEXT NOT NULL DEFAULT 'PREPARING' CHECK (state IN (
    'PREPARING', 'READY', 'ACTIVE', 'RETIRED', 'ABANDONED'
  )),
  created_by_device_id UUID,
  rotation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  UNIQUE (domain, scope_id, key_epoch)
);

-- Exactly one ACTIVE epoch per (domain, scope). Two concurrent activations
-- cannot both commit: one wins, the other hits this index and is abandoned.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_keys_single_active
  ON public.scope_keys (domain, scope_id) WHERE state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_scope_keys_owner ON public.scope_keys (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_scope_keys_couple ON public.scope_keys (owner_couple_id);

ALTER TABLE public.scope_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own scope keys" ON public.scope_keys;
DROP POLICY IF EXISTS "Owner reads own scope keys" ON public.scope_keys;
CREATE POLICY "Owner reads own scope keys"
  ON public.scope_keys FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Owner creates own scope keys" ON public.scope_keys;
CREATE POLICY "Owner creates own scope keys"
  ON public.scope_keys FOR INSERT TO authenticated
  WITH CHECK (
    (owner_user_id = auth.uid() AND domain IN ('personal', 'health'))
    OR (domain = 'couple' AND owner_couple_id = public.get_my_active_couple_id())
  );

-- Couple epochs are readable by the active partner: both members need to know
-- which epoch is current in order to write shared content.
DROP POLICY IF EXISTS "Active partner reads couple scope keys" ON public.scope_keys;
CREATE POLICY "Active partner reads couple scope keys"
  ON public.scope_keys FOR SELECT TO authenticated
  USING (domain = 'couple' AND owner_couple_id = public.get_my_active_couple_id());

-- NO UPDATE GRANT. Epoch state is security-critical: with direct UPDATE an
-- owner could set a RETIRED epoch back to ACTIVE and resurrect a key a
-- compromised device still holds. Every transition goes through the narrow
-- RPCs below, which lock the row and reject illegal edges.
REVOKE ALL ON TABLE public.scope_keys FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.scope_keys TO authenticated;

-- A new epoch may only be born PREPARING.
--
-- Without this, INSERT alone bypasses the whole state machine: a client could
-- create a row already ACTIVE and never touch the transition RPCs at all. The
-- trigger also pins ownership to the caller, so `owner_user_id`, `scope_id` and
-- `owner_couple_id` cannot be made to disagree with each other or with who is
-- actually asking.
CREATE OR REPLACE FUNCTION public.enforce_scope_key_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  -- service_role provisions fixtures and runs deletion; it is not a client.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.state <> 'PREPARING' THEN
    RAISE EXCEPTION 'E2EE_EPOCH_MUST_START_PREPARING: a new epoch may not be created as %', NEW.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.domain IN ('personal', 'health') THEN
    IF NEW.owner_user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'E2EE_SCOPE_OWNER_MISMATCH: personal/health epochs belong to the caller'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- scope_id must be the same user; a mismatch would route content to a
    -- scope the owner column does not describe.
    IF NEW.scope_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'E2EE_SCOPE_ID_MISMATCH: personal/health scope_id must be the owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW.owner_couple_id IS DISTINCT FROM public.get_my_active_couple_id() THEN
      RAISE EXCEPTION 'E2EE_SCOPE_OWNER_MISMATCH: couple epochs belong to the caller''s active couple'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.scope_id IS DISTINCT FROM NEW.owner_couple_id THEN
      RAISE EXCEPTION 'E2EE_SCOPE_ID_MISMATCH: couple scope_id must equal owner_couple_id'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_scope_key_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_scope_keys_insert ON public.scope_keys;
CREATE TRIGGER trg_scope_keys_insert
  BEFORE INSERT ON public.scope_keys
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scope_key_insert();


-- -------------------------------------------------------------
-- 5b. Epoch state machine  (the ONLY way scope_keys.state changes)
-- -------------------------------------------------------------
-- `authenticated` has no UPDATE grant on scope_keys, so these RPCs are the
-- whole surface. Each locks the row, checks the current state, and permits only
-- a legal edge:
--
--   PREPARING -> READY | ABANDONED
--   READY     -> ACTIVE | ABANDONED
--   ACTIVE    -> RETIRED
--   RETIRED   -> (nothing)      RETIRED -> ACTIVE is the resurrection attack
--   ABANDONED -> (nothing)
CREATE OR REPLACE FUNCTION public.e2ee_can_manage_scope_key(p_scope_key public.scope_keys)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_scope_key.domain IN ('personal', 'health') THEN p_scope_key.owner_user_id = auth.uid()
    ELSE p_scope_key.owner_couple_id = public.get_my_active_couple_id()
  END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_can_manage_scope_key(public.scope_keys) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.e2ee_mark_epoch_ready(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_key public.scope_keys;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;
  IF NOT public.e2ee_can_manage_scope_key(v_key) THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_key.state <> 'PREPARING' THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> READY', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.key_envelopes WHERE scope_key_id = p_scope_key_id) THEN
    RAISE EXCEPTION 'E2EE_EPOCH_NO_RECIPIENTS' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.scope_keys SET state = 'READY' WHERE id = p_scope_key_id;
  RETURN 'READY';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_mark_epoch_ready(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_mark_epoch_ready(UUID) TO authenticated;

-- Activation is atomic: verify READY, verify every required recipient has a
-- live envelope and none is revoked, retire the outgoing ACTIVE epoch, and
-- activate — or fail entirely. The partial unique index on (domain, scope_id)
-- WHERE state = 'ACTIVE' is what makes two concurrent activations impossible.
CREATE OR REPLACE FUNCTION public.e2ee_activate_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.scope_keys;
  v_revoked INTEGER;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;
  IF NOT public.e2ee_can_manage_scope_key(v_key) THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The resurrection guard. RETIRED and ABANDONED are terminal.
  IF v_key.state <> 'READY' THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> ACTIVE', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_revoked
  FROM public.key_envelopes ke
  JOIN public.revocation_statements rs ON rs.revoked_device_id = ke.recipient_device_id
  WHERE ke.scope_key_id = p_scope_key_id;
  IF v_revoked > 0 THEN
    RAISE EXCEPTION 'E2EE_EPOCH_HAS_REVOKED_RECIPIENT' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock and retire the outgoing epoch in the same transaction.
  PERFORM 1 FROM public.scope_keys
   WHERE domain = v_key.domain AND scope_id = v_key.scope_id AND state = 'ACTIVE'
   FOR UPDATE;

  UPDATE public.scope_keys
     SET state = 'RETIRED', superseded_at = now()
   WHERE domain = v_key.domain AND scope_id = v_key.scope_id AND state = 'ACTIVE';

  UPDATE public.scope_keys
     SET state = 'ACTIVE', activated_at = now()
   WHERE id = p_scope_key_id;

  RETURN 'ACTIVE';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_activate_epoch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_activate_epoch(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.e2ee_abandon_epoch(p_scope_key_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_key public.scope_keys;
BEGIN
  SELECT * INTO v_key FROM public.scope_keys WHERE id = p_scope_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'E2EE_UNKNOWN_EPOCH'; END IF;
  IF NOT public.e2ee_can_manage_scope_key(v_key) THEN
    RAISE EXCEPTION 'E2EE_EPOCH_FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_key.state NOT IN ('PREPARING', 'READY') THEN
    RAISE EXCEPTION 'E2EE_ILLEGAL_EPOCH_TRANSITION: % -> ABANDONED', v_key.state
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.scope_keys SET state = 'ABANDONED' WHERE id = p_scope_key_id;
  RETURN 'ABANDONED';
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_abandon_epoch(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2ee_abandon_epoch(UUID) TO authenticated;

-- -------------------------------------------------------------
-- 6. Key envelopes  (RECIPIENT OWNED)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.key_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key_id UUID NOT NULL REFERENCES public.scope_keys(id) ON DELETE CASCADE,
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('device', 'recovery_identity')),
  recipient_device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  recipient_recovery_id UUID REFERENCES public.recovery_identities(id) ON DELETE CASCADE,
  sender_device_id UUID,
  -- Immutable reference to the certificate needed to verify this envelope's
  -- signature. RESTRICT is the retention mechanism: a certificate cannot be
  -- deleted while an envelope still depends on it, so historical verification
  -- survives the deletion of the sending device and of the sender's account.
  -- Nothing relies on an application-maintained counter that can drift.
  sender_certificate_id UUID REFERENCES public.device_certificates(id) ON DELETE RESTRICT,
  envelope BYTEA NOT NULL CHECK (octet_length(envelope) = 360),
  -- Every GLK2 envelope in this design is signed by a device, so the sender
  -- certificate is mandatory. NULL here would mean "verifiable by nothing",
  -- which is not a state the protocol has.
  CONSTRAINT key_envelopes_sender_certificate_required CHECK (sender_certificate_id IS NOT NULL),
  -- Set once the recipient has re-wrapped this key under its own signature, at
  -- which point the sender's certificate is no longer needed to verify it.
  self_notarized BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (recipient_kind = 'device' AND recipient_device_id IS NOT NULL AND recipient_recovery_id IS NULL)
    OR (recipient_kind = 'recovery_identity' AND recipient_recovery_id IS NOT NULL AND recipient_device_id IS NULL)
  )
);

-- Partial unique indexes, not a plain UNIQUE over the three columns.
-- Postgres treats NULLs as distinct in a unique constraint, so
-- UNIQUE(scope_key_id, recipient_device_id, recipient_recovery_id) permitted
-- unlimited duplicates for any recipient, because one of the two recipient
-- columns is always NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_envelope_one_per_device
  ON public.key_envelopes (scope_key_id, recipient_device_id)
  WHERE recipient_device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_envelope_one_per_recovery
  ON public.key_envelopes (scope_key_id, recipient_recovery_id)
  WHERE recipient_recovery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_key_envelopes_scope ON public.key_envelopes (scope_key_id);
CREATE INDEX IF NOT EXISTS idx_key_envelopes_device ON public.key_envelopes (recipient_device_id);

ALTER TABLE public.key_envelopes ENABLE ROW LEVEL SECURITY;

-- A row is visible only to the account that owns the recipient. A partner can
-- never select the other's envelopes, whatever the domain: an envelope is
-- useless without the matching private key, but there is no reason to hand out
-- ciphertext that is not yours.
DROP POLICY IF EXISTS "Recipient reads own envelopes" ON public.key_envelopes;
CREATE POLICY "Recipient reads own envelopes"
  ON public.key_envelopes FOR SELECT TO authenticated
  USING (
    (recipient_device_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.devices d WHERE d.id = recipient_device_id AND d.user_id = auth.uid()
    ))
    OR (recipient_recovery_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.recovery_identities r WHERE r.id = recipient_recovery_id AND r.user_id = auth.uid()
    ))
  );

-- Writing an envelope requires holding the scope key, which the writer proves by
-- being its owner or the active partner for a couple key.
DROP POLICY IF EXISTS "Key holder writes envelopes" ON public.key_envelopes;
CREATE POLICY "Key holder writes envelopes"
  ON public.key_envelopes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scope_keys sk
      WHERE sk.id = scope_key_id
        AND (
          sk.owner_user_id = auth.uid()
          OR (sk.domain = 'couple' AND sk.scope_id = public.get_my_active_couple_id())
        )
    )
  );

DROP POLICY IF EXISTS "Recipient marks own envelope notarized" ON public.key_envelopes;
CREATE POLICY "Recipient marks own envelope notarized"
  ON public.key_envelopes FOR UPDATE TO authenticated
  USING (
    recipient_device_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.devices d WHERE d.id = recipient_device_id AND d.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.key_envelopes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.key_envelopes TO authenticated;

-- Health isolation, enforced server-side as defence in depth.
--
-- A personal or health envelope may only be addressed to a recipient belonging
-- to the SAME user as the scope key's owner. A compromised client cannot
-- persist a health envelope for the partner; a compromised server can, but it
-- holds no health key, so the row would be meaningless ciphertext.
CREATE OR REPLACE FUNCTION public.enforce_envelope_recipient()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_domain TEXT;
  v_owner UUID;
  v_recipient_user UUID;
BEGIN
  SELECT sk.domain, sk.owner_user_id INTO v_domain, v_owner
  FROM public.scope_keys sk WHERE sk.id = NEW.scope_key_id;

  IF v_domain IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_SCOPE_KEY';
  END IF;

  IF NEW.recipient_device_id IS NOT NULL THEN
    SELECT d.user_id INTO v_recipient_user FROM public.devices d WHERE d.id = NEW.recipient_device_id;
  ELSE
    SELECT r.user_id INTO v_recipient_user FROM public.recovery_identities r WHERE r.id = NEW.recipient_recovery_id;
  END IF;

  IF v_recipient_user IS NULL THEN
    RAISE EXCEPTION 'E2EE_UNKNOWN_RECIPIENT';
  END IF;

  IF v_domain IN ('personal', 'health') AND v_recipient_user <> v_owner THEN
    RAISE EXCEPTION 'E2EE_DOMAIN_RECIPIENT_FORBIDDEN: % envelopes may only target the owner', v_domain
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A revoked device may not receive a new envelope. The cryptographic decision
  -- is the client's — it filters candidates by certificate chain and its own
  -- monotone revocation set — but a signed revocation the server has already
  -- accepted is evidence the server can act on, so it does.
  --
  -- The advisory lock serializes this check against revocation insertion. Both
  -- take the same lock keyed on the device, so the interleaving
  --   T1 checks unrevoked -> T2 revokes -> T1 inserts
  -- cannot occur: whichever transaction takes the lock first completes before
  -- the other reads. Semantics are documented in the report.
  IF NEW.recipient_device_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.recipient_device_id::TEXT, 0));
  END IF;

  IF NEW.recipient_device_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.revocation_statements rs
    WHERE rs.revoked_device_id = NEW.recipient_device_id
  ) THEN
    RAISE EXCEPTION 'E2EE_RECIPIENT_REVOKED: device % has a signed revocation', NEW.recipient_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- An envelope may only be written for an epoch that is still being built or
  -- is current. Adding recipients to a RETIRED epoch would hand out a key the
  -- rotation was meant to retire.
  IF EXISTS (
    SELECT 1 FROM public.scope_keys sk
    WHERE sk.id = NEW.scope_key_id AND sk.state IN ('RETIRED', 'ABANDONED')
  ) THEN
    RAISE EXCEPTION 'E2EE_EPOCH_NOT_WRITABLE: cannot add a recipient to a retired or abandoned epoch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_key_envelopes_recipient ON public.key_envelopes;
CREATE TRIGGER trg_key_envelopes_recipient
  BEFORE INSERT OR UPDATE ON public.key_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_envelope_recipient();

-- -------------------------------------------------------------
-- 7. Recovery challenges
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recovery_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_nonce BYTEA NOT NULL CHECK (octet_length(challenge_nonce) = 32),
  recovery_version SMALLINT NOT NULL,
  new_device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_challenge_nonce
  ON public.recovery_challenges (challenge_nonce);
CREATE INDEX IF NOT EXISTS idx_recovery_challenge_user ON public.recovery_challenges (user_id);

ALTER TABLE public.recovery_challenges ENABLE ROW LEVEL SECURITY;

-- Issued and consumed by the Edge Function under service_role. A client reads
-- its own challenge but cannot mint one, which is what keeps the nonce
-- server-controlled.
DROP POLICY IF EXISTS "Owner reads own challenges" ON public.recovery_challenges;
CREATE POLICY "Owner reads own challenges"
  ON public.recovery_challenges FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.recovery_challenges FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.recovery_challenges TO authenticated;

-- -------------------------------------------------------------
-- 8. Revocation
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revocation_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  revoked_device_id UUID NOT NULL,
  revoker_device_id UUID,
  reason SMALLINT NOT NULL CHECK (reason BETWEEN 1 AND 5),
  statement BYTEA NOT NULL CHECK (octet_length(statement) = 203),
  signature BYTEA NOT NULL CHECK (octet_length(signature) = 64),
  revoked_at TIMESTAMPTZ NOT NULL,
  sequence BIGINT NOT NULL,
  log_head BYTEA NOT NULL CHECK (octet_length(log_head) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_revocation_user ON public.revocation_statements (user_id, sequence);

ALTER TABLE public.revocation_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own revocations" ON public.revocation_statements;
CREATE POLICY "Owner manages own revocations"
  ON public.revocation_statements FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- The revoked device must actually belong to the caller. Trusting the
-- submitted `user_id` alone would let anyone revoke anyone's device, which is a
-- denial-of-service against another account's key lifecycle.
DROP POLICY IF EXISTS "Owner appends own revocations" ON public.revocation_statements;
CREATE POLICY "Owner appends own revocations"
  ON public.revocation_statements FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = revoked_device_id AND d.user_id = auth.uid()
    )
  );

-- The partner must be able to observe revocations to keep their pinned head
-- current; the statements are signed, so this exposes nothing forgeable.
DROP POLICY IF EXISTS "Active partner reads revocations" ON public.revocation_statements;
CREATE POLICY "Active partner reads revocations"
  ON public.revocation_statements FOR SELECT TO authenticated
  USING (
    user_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.couple_members mine
      JOIN public.couple_members theirs ON theirs.couple_id = mine.couple_id
      WHERE mine.user_id = auth.uid() AND mine.status = 'active'
        AND theirs.user_id = public.revocation_statements.user_id AND theirs.status = 'active'
    )
  );

REVOKE ALL ON TABLE public.revocation_statements FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.revocation_statements TO authenticated;

-- Append-only, and the chain must extend: a statement may not be rewritten and
-- the sequence may not be reused, so history cannot be quietly edited.
-- Same lock, same order, so revocation and envelope insertion cannot interleave.
CREATE OR REPLACE FUNCTION public.serialize_revocation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.revoked_device_id::TEXT, 0));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.serialize_revocation_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_revocation_serialize ON public.revocation_statements;
CREATE TRIGGER trg_revocation_serialize
  BEFORE INSERT ON public.revocation_statements
  FOR EACH ROW EXECUTE FUNCTION public.serialize_revocation_insert();

CREATE OR REPLACE FUNCTION public.reject_revocation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'revocation_statements is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_revocation_immutable ON public.revocation_statements;
CREATE TRIGGER trg_revocation_immutable
  BEFORE UPDATE OR DELETE ON public.revocation_statements
  FOR EACH ROW EXECUTE FUNCTION public.reject_revocation_mutation();

-- -------------------------------------------------------------
-- 9. Couple pairing state machine
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crypto_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'CRYPTO_PENDING' CHECK (state IN (
    'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE', 'CONFIRMED_BOTH',
    'EPOCH_PREPARING', 'CRYPTO_ACTIVE', 'TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED'
  )),
  pairing_nonce BYTEA CHECK (pairing_nonce IS NULL OR octet_length(pairing_nonce) = 32),
  transcript BYTEA,
  transcript_hash BYTEA CHECK (transcript_hash IS NULL OR octet_length(transcript_hash) = 32),
  proposed_by_user_id UUID,
  confirmed_low_signature BYTEA CHECK (confirmed_low_signature IS NULL OR octet_length(confirmed_low_signature) = 64),
  confirmed_low_device_id UUID,
  confirmed_high_signature BYTEA CHECK (confirmed_high_signature IS NULL OR octet_length(confirmed_high_signature) = 64),
  confirmed_high_device_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_pairing_live
  ON public.crypto_pairings (couple_id)
  WHERE state NOT IN ('TRANSCRIPT_EXPIRED', 'TRANSCRIPT_REJECTED', 'UNLINKED');

CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_pairing_nonce
  ON public.crypto_pairings (pairing_nonce) WHERE pairing_nonce IS NOT NULL;

ALTER TABLE public.crypto_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members manage pairing" ON public.crypto_pairings;
CREATE POLICY "Active members manage pairing"
  ON public.crypto_pairings FOR ALL TO authenticated
  USING (couple_id = public.get_my_active_couple_id())
  WITH CHECK (couple_id = public.get_my_active_couple_id());

REVOKE ALL ON TABLE public.crypto_pairings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crypto_pairings TO authenticated;

-- Monotonic membership counter, bound into migration acknowledgements so an
-- unlink between acknowledgement and plaintext deletion invalidates the ack.
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS membership_revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_membership_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.couples
     SET membership_revision = membership_revision + 1
   WHERE id = COALESCE(NEW.couple_id, OLD.couple_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_revision ON public.couple_members;
CREATE TRIGGER trg_membership_revision
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.couple_members
  FOR EACH ROW EXECUTE FUNCTION public.bump_membership_revision();

-- -------------------------------------------------------------
-- 10. E2EE write floor
-- -------------------------------------------------------------
-- Irreversible per scope. Created here as infrastructure; NOT activated for any
-- existing user by this migration.
CREATE TABLE IF NOT EXISTS public.crypto_write_floor (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'couple')),
  scope_id UUID NOT NULL,
  min_cipher_format SMALLINT NOT NULL DEFAULT 0 CHECK (min_cipher_format BETWEEN 0 AND 127),
  activated_at TIMESTAMPTZ,
  activated_by_device_id UUID,
  PRIMARY KEY (scope_kind, scope_id)
);

ALTER TABLE public.crypto_write_floor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read applicable write floor" ON public.crypto_write_floor;
CREATE POLICY "Members read applicable write floor"
  ON public.crypto_write_floor FOR SELECT TO authenticated
  USING (
    (scope_kind = 'user' AND scope_id = auth.uid())
    OR (scope_kind = 'couple' AND scope_id = public.get_my_active_couple_id())
  );

REVOKE ALL ON TABLE public.crypto_write_floor FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.crypto_write_floor TO authenticated;

-- The floor only ever rises. There is no client path that lowers or removes it,
-- and this trigger means even service_role cannot do so by accident.
CREATE OR REPLACE FUNCTION public.enforce_write_floor_monotonic()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- One narrow exception, and only one: the account-destruction RPC sets this
    -- flag inside its own transaction. The floor exists to stop a plaintext
    -- downgrade while a scope is still usable; once the owning personal scope
    -- is being permanently destroyed there is nothing left to downgrade, and an
    -- orphan floor row would just block deletion forever.
    --
    -- This flag is NOT a privilege, and nothing here should be read as one. Any
    -- session can set any custom GUC — `SELECT set_config('gomsinlog.…', 'on',
    -- false)` from an ordinary authenticated session works — so a check like the
    -- one below proves nothing on its own. An earlier revision of this comment
    -- claimed a client "can never set the flag", which was false, and the same
    -- reasoning applied to devices.status became a real escalation (see 036).
    --
    -- What actually protects this table is the grant: `authenticated` holds
    -- SELECT and nothing else, so a client cannot issue the DELETE that would
    -- reach this trigger at all. The flag only distinguishes the destruction
    -- path from other already-privileged writers. If a future migration grants
    -- authenticated DELETE or UPDATE here, this line becomes an exploitable
    -- plaintext downgrade — the p0 harness asserts the grant for that reason.
    IF current_setting('gomsinlog.e2ee_account_destruction', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'E2EE_FLOOR_IRREVERSIBLE: the write floor cannot be removed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.min_cipher_format < OLD.min_cipher_format THEN
    RAISE EXCEPTION 'E2EE_FLOOR_IRREVERSIBLE: the write floor cannot be lowered'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_write_floor_monotonic ON public.crypto_write_floor;
CREATE TRIGGER trg_write_floor_monotonic
  BEFORE UPDATE OR DELETE ON public.crypto_write_floor
  FOR EACH ROW EXECUTE FUNCTION public.enforce_write_floor_monotonic();

-- Activation. Requires a live ACTIVE epoch for the scope, so the floor can
-- never be raised before there is a key to encrypt with.
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
  v_has_epoch BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_scope_kind = 'user' THEN
    IF p_scope_id <> v_uid THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.scope_keys
      WHERE state = 'ACTIVE' AND owner_user_id = v_uid AND domain IN ('personal', 'health')
    ) INTO v_has_epoch;
  ELSIF p_scope_kind = 'couple' THEN
    IF p_scope_id IS DISTINCT FROM public.get_my_active_couple_id() THEN
      RAISE EXCEPTION 'E2EE_FLOOR_SCOPE_FORBIDDEN';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.scope_keys
      WHERE state = 'ACTIVE' AND domain = 'couple' AND scope_id = p_scope_id
    ) INTO v_has_epoch;
  ELSE
    RAISE EXCEPTION 'E2EE_FLOOR_BAD_SCOPE_KIND';
  END IF;

  IF NOT v_has_epoch THEN
    RAISE EXCEPTION 'E2EE_FLOOR_NO_ACTIVE_EPOCH';
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

-- -------------------------------------------------------------
-- 11. Migration ledger
-- -------------------------------------------------------------
-- No plaintext-derived value appears here, ever. An unkeyed digest of a
-- low-cardinality health field is a dictionary oracle for anyone holding the
-- database, and it is unnecessary: the database validates that
-- `content_revision` increments on every update, so revision equality between
-- acknowledgement and deletion already proves the row is unchanged.
CREATE TABLE IF NOT EXISTS public.migration_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  object_type SMALLINT NOT NULL,
  object_id UUID NOT NULL,
  source_revision BIGINT NOT NULL CHECK (source_revision >= 1),
  ciphertext_hash BYTEA NOT NULL CHECK (octet_length(ciphertext_hash) = 32),
  key_domain TEXT NOT NULL CHECK (key_domain IN ('personal', 'health', 'couple')),
  key_epoch BIGINT NOT NULL,
  couple_id UUID,
  membership_revision BIGINT,
  migrating_device_id UUID NOT NULL,
  ack_signature BYTEA NOT NULL CHECK (octet_length(ack_signature) = 64),
  partner_ack_signature BYTEA CHECK (partner_ack_signature IS NULL OR octet_length(partner_ack_signature) = 64),
  partner_ack_device_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, source_revision)
);

ALTER TABLE public.migration_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own migration ledger" ON public.migration_ledger;
CREATE POLICY "Owner manages own migration ledger"
  ON public.migration_ledger FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.migration_ledger FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.migration_ledger TO authenticated;

-- -------------------------------------------------------------
-- 12. Account deletion for the key tables
-- -------------------------------------------------------------
-- Additive and separate from prepare_account_deletion() so the Phase 0 deletion
-- contract is not re-typed and cannot regress. The Edge Function calls this
-- BEFORE the existing RPC.
--
-- Ownership classes, and what each means when user A is deleted:
--
--   DEVICE OWNED      devices, device_enrollments        -> delete A's
--   USER OWNED        recovery_identities, personal/health scope_keys,
--                     migration_ledger, user write floor -> delete A's
--   RECIPIENT OWNED   key_envelopes                      -> delete ONLY rows
--                     whose recipient is A's device or A's recovery identity.
--                     B's envelopes for the couple key are never touched.
--   COUPLE OWNED      couple scope_keys, crypto_pairings,
--                     couple write floor                 -> retained while B
--                     remains; removed only when no member is left.
--   HISTORICAL        device_certificates, revocation_statements -> retained
--                     while reference_count > 0, per MINIMUM NECESSARY
--                     RETENTION; otherwise deleted.
CREATE OR REPLACE FUNCTION public.e2ee_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple_id UUID;
  v_partner_id UUID;
  v_partner_remains BOOLEAN := false;
  v_epoch RECORD;
  v_surviving INTEGER;
  v_deleted_envelopes INTEGER := 0;
  v_deleted_devices INTEGER := 0;
  v_retained_certs INTEGER := 0;
  v_deleted_certs INTEGER := 0;
  v_loop_deleted INTEGER := 0;
  v_deleted_scope_keys INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;

  -- Transaction-local, and only for this function's own statements. It is not
  -- reachable by a client: `authenticated` has no EXECUTE on this function.
  PERFORM set_config('gomsinlog.e2ee_account_destruction', 'on', true);

  SELECT cm.couple_id INTO v_couple_id
  FROM public.couple_members cm
  WHERE cm.user_id = p_user_id AND cm.status = 'active'
  LIMIT 1;

  IF v_couple_id IS NOT NULL THEN
    SELECT cm.user_id INTO v_partner_id
    FROM public.couple_members cm
    WHERE cm.couple_id = v_couple_id AND cm.status = 'active' AND cm.user_id <> p_user_id
    LIMIT 1;
    v_partner_remains := v_partner_id IS NOT NULL;
  END IF;

  -- PRE-FLIGHT. Abort rather than crypto-shred a surviving partner.
  --
  -- If B remains, every couple epoch they can still decrypt must retain at
  -- least one envelope addressed to one of B's devices or to B's recovery
  -- identity. Aborting a deletion is recoverable; destroying a bystander's only
  -- key path is not.
  IF v_partner_remains THEN
    FOR v_epoch IN
      SELECT sk.id, sk.key_epoch
      FROM public.scope_keys sk
      WHERE sk.domain = 'couple' AND sk.owner_couple_id = v_couple_id
        AND sk.state IN ('ACTIVE', 'RETIRED')
        -- Only epochs that are actually decryptable by somebody. An epoch with
        -- no envelopes at all is dead weight: nobody can open it, so deleting A
        -- takes nothing from B and aborting would help no one.
        AND EXISTS (SELECT 1 FROM public.key_envelopes ke WHERE ke.scope_key_id = sk.id)
    LOOP
      SELECT count(*) INTO v_surviving
      FROM public.key_envelopes ke
      WHERE ke.scope_key_id = v_epoch.id
        AND (
          (ke.recipient_device_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.devices d WHERE d.id = ke.recipient_device_id AND d.user_id = v_partner_id
          ))
          OR (ke.recipient_recovery_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.recovery_identities r
            WHERE r.id = ke.recipient_recovery_id AND r.user_id = v_partner_id
          ))
        );

      IF v_surviving = 0 THEN
        RAISE EXCEPTION
          'E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch % has no surviving envelope for the remaining partner',
          v_epoch.key_epoch
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
  END IF;

  -- RECIPIENT OWNED: only A's own envelopes.
  DELETE FROM public.key_envelopes ke
  WHERE (ke.recipient_device_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.devices d WHERE d.id = ke.recipient_device_id AND d.user_id = p_user_id))
     OR (ke.recipient_recovery_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.recovery_identities r WHERE r.id = ke.recipient_recovery_id AND r.user_id = p_user_id));
  GET DIAGNOSTICS v_deleted_envelopes = ROW_COUNT;

  -- USER OWNED scope keys only. Couple epochs are couple-owned and are never
  -- reachable from a user predicate, which is the structural half of the fix;
  -- this is the explicit half.
  DELETE FROM public.scope_keys sk
  WHERE sk.domain IN ('personal', 'health') AND sk.owner_user_id = p_user_id;
  GET DIAGNOSTICS v_deleted_scope_keys = ROW_COUNT;

  -- HISTORICAL: keep only what a surviving envelope still needs. Retention is
  -- decided by the actual foreign key, not by a cached counter that can drift —
  -- the FK is ON DELETE RESTRICT, so a referenced certificate cannot be removed
  -- even by this function.
  -- Delete in dependency order, leaves first, until nothing more can go.
  --
  -- A certificate may be held by an envelope (`sender_certificate_id`) or by a
  -- child certificate (`issuer_certificate_id`). Both are ON DELETE RESTRICT,
  -- so a single unordered DELETE fails the moment it reaches a certificate that
  -- issued another. Looping removes whatever is currently unreferenced and
  -- stops when the remaining set is genuinely still needed — which is exactly
  -- MINIMUM NECESSARY RETENTION expressed as a fixpoint.
  v_deleted_certs := 0;
  LOOP
    DELETE FROM public.device_certificates dc
    WHERE dc.user_id = p_user_id
      AND NOT EXISTS (SELECT 1 FROM public.key_envelopes ke WHERE ke.sender_certificate_id = dc.id)
      AND NOT EXISTS (SELECT 1 FROM public.device_certificates child WHERE child.issuer_certificate_id = dc.id);
    GET DIAGNOSTICS v_loop_deleted = ROW_COUNT;
    v_deleted_certs := v_deleted_certs + v_loop_deleted;
    EXIT WHEN v_loop_deleted = 0;
  END LOOP;

  -- Anchors follow the same rule: removable only once no retained certificate
  -- roots at them.
  DELETE FROM public.recovery_public_anchors rpa
  WHERE rpa.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.device_certificates dc WHERE dc.recovery_public_anchor_id = rpa.id
    );

  SELECT count(*) INTO v_retained_certs
  FROM public.device_certificates dc WHERE dc.user_id = p_user_id;

  UPDATE public.device_certificates
     SET retained_reason = 'historical_verification'
   WHERE user_id = p_user_id;

  DELETE FROM public.migration_ledger WHERE user_id = p_user_id;
  DELETE FROM public.recovery_challenges WHERE user_id = p_user_id;
  DELETE FROM public.device_enrollments WHERE user_id = p_user_id;
  DELETE FROM public.recovery_identities WHERE user_id = p_user_id;
  -- Permitted only because the destruction flag is set above, and only for the
  -- personal scope whose keys have just been destroyed.
  DELETE FROM public.crypto_write_floor WHERE scope_kind = 'user' AND scope_id = p_user_id;

  DELETE FROM public.devices WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_deleted_devices = ROW_COUNT;

  IF NOT v_partner_remains AND v_couple_id IS NOT NULL THEN
    DELETE FROM public.crypto_pairings WHERE couple_id = v_couple_id;
    DELETE FROM public.crypto_write_floor WHERE scope_kind = 'couple' AND scope_id = v_couple_id;
    DELETE FROM public.scope_keys WHERE domain = 'couple' AND owner_couple_id = v_couple_id;
  END IF;

  PERFORM set_config('gomsinlog.e2ee_account_destruction', 'off', true);

  RETURN jsonb_build_object(
    'partner_remains', v_partner_remains,
    'deleted_envelopes', v_deleted_envelopes,
    'deleted_devices', v_deleted_devices,
    'deleted_scope_keys', v_deleted_scope_keys,
    'deleted_certificates', v_deleted_certs,
    'retained_certificates', v_retained_certs
  );
END;
$$;

COMMENT ON FUNCTION public.e2ee_prepare_account_deletion(UUID) IS
  'E2EE key-table deletion with recipient-scoped semantics. Aborts rather than orphan a surviving partner. Call before prepare_account_deletion().';

REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion(UUID) TO service_role;


-- -------------------------------------------------------------
-- 12b. Atomic Edge Function commits
-- -------------------------------------------------------------
-- Both of these exist because the two-step shape they replace was unsafe: burn
-- the nonce, then separately try to move the device, and ignore the result. A
-- failure between the two burns a valid single-use credential and leaves the
-- device stranded with no way to retry.
CREATE OR REPLACE FUNCTION public.e2ee_commit_device_approval(
  p_enrollment_id UUID,
  p_new_device_id UUID,
  p_certificate BYTEA,
  p_certificate_fp BYTEA,
  p_transcript_hash BYTEA,
  p_approval_signature BYTEA,
  p_user_id UUID,
  p_recovery_identity_id UUID,
  p_recovery_version SMALLINT,
  p_subject_sig_spki BYTEA,
  p_subject_kem_spki BYTEA
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_certificate_id UUID;
  v_rows INTEGER;
BEGIN
  -- Consume the nonce first, conditionally. A replay finds consumed_at already
  -- set and updates zero rows, so exactly one caller proceeds.
  UPDATE public.device_enrollments
     SET consumed_at = now(),
         approved_at = now(),
         transcript_hash = p_transcript_hash,
         approval_signature = p_approval_signature
   WHERE id = p_enrollment_id
     AND consumed_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_NONCE_ALREADY_USED' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.device_certificates
    (user_id, subject_device_id, recovery_identity_id, recovery_version,
     certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
  VALUES
    (p_user_id, p_new_device_id, p_recovery_identity_id, p_recovery_version,
     p_certificate, p_certificate_fp, p_subject_sig_spki, p_subject_kem_spki)
  RETURNING id INTO v_certificate_id;

  -- Operational status moves only AFTER the certificate is durable. Status is
  -- not evidence, but it must never claim more than the certificate supports.
  UPDATE public.devices
     SET status = 'ACTIVE', enrollment_method = 'device_approval'
   WHERE id = p_new_device_id AND status = 'PENDING';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PENDING' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN v_certificate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_commit_device_approval(UUID,UUID,BYTEA,BYTEA,BYTEA,BYTEA,UUID,UUID,SMALLINT,BYTEA,BYTEA)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_device_approval(UUID,UUID,BYTEA,BYTEA,BYTEA,BYTEA,UUID,UUID,SMALLINT,BYTEA,BYTEA)
  TO service_role;

CREATE OR REPLACE FUNCTION public.e2ee_commit_recovery_authentication(
  p_challenge_id UUID,
  p_device_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_rows INTEGER;
BEGIN
  -- Conditional consumption. Under concurrency exactly one caller updates a
  -- row; every other sees zero and fails, so a challenge can never authenticate
  -- two devices.
  UPDATE public.recovery_challenges
     SET consumed_at = now()
   WHERE id = p_challenge_id
     AND consumed_at IS NULL
     AND expires_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'E2EE_CHALLENGE_ALREADY_USED' USING ERRCODE = 'unique_violation';
  END IF;

  -- Authenticated is NOT provisioned: the device is still not an eligible
  -- envelope recipient and still has no certificate.
  UPDATE public.devices
     SET status = 'RECOVERY_AUTHENTICATED', enrollment_method = 'recovery'
   WHERE id = p_device_id AND status = 'PENDING';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Same transaction, so the challenge is NOT burned by this failure.
    RAISE EXCEPTION 'E2EE_DEVICE_NOT_PENDING' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.e2ee_commit_recovery_authentication(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_commit_recovery_authentication(UUID, UUID) TO service_role;

-- Trigger-only functions must not be directly callable.
REVOKE ALL ON FUNCTION public.reject_certificate_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_revocation_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_envelope_recipient() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_write_floor_monotonic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_membership_revision() FROM PUBLIC, anon, authenticated;

COMMIT;
