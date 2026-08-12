-- TEST ONLY — behaviour and actor-matrix tests for migrations 031/032.
-- Run against a throwaway local cluster. Never against production.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION test_ok(name TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN RAISE WARNING 'PASS %', name; END $$;

CREATE OR REPLACE FUNCTION test_fail(name TEXT, detail TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FAIL % :: %', name, detail; END $$;

-- ---------------------------------------------------------------
-- Fixtures: A and B are an active couple; C is unrelated; D is a
-- former partner of A.
-- ---------------------------------------------------------------
TRUNCATE auth.users CASCADE;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test'),
  ('cccccccc-0000-4000-8000-000000000003', 'c@test'),
  ('dddddddd-0000-4000-8000-000000000004', 'd@test');

INSERT INTO public.couples (id) VALUES ('c0000000-0000-4000-8000-000000000001');
INSERT INTO public.couple_members (couple_id, user_id, status) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'active'),
  ('c0000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'active'),
  ('c0000000-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004', 'disconnected');

INSERT INTO public.crypto_deployment (server_origin_id) VALUES (decode(repeat('11', 32), 'hex'));

-- Recovery identities
INSERT INTO public.recovery_identities
  (id, user_id, recovery_salt, rec_sig_spki, rec_kem_spki, enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
VALUES
  ('0a000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   decode(repeat('aa', 32), 'hex'), decode(repeat('01', 91), 'hex'), decode(repeat('02', 91), 'hex'),
   decode('00', 'hex'), decode('00', 'hex'), decode(repeat('a1', 32), 'hex'), decode(repeat('a2', 64), 'hex')),
  ('0b000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002',
   decode(repeat('bb', 32), 'hex'), decode(repeat('03', 91), 'hex'), decode(repeat('04', 91), 'hex'),
   decode('00', 'hex'), decode('00', 'hex'), decode(repeat('b1', 32), 'hex'), decode(repeat('b2', 64), 'hex'));

-- Devices
INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status) VALUES
  ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   decode(repeat('11', 91), 'hex'), decode(repeat('12', 91), 'hex'), 'ios', 'secure_enclave', 'ACTIVE'),
  ('d0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002',
   decode(repeat('21', 91), 'hex'), decode(repeat('22', 91), 'hex'), 'android', 'tee', 'ACTIVE'),
  ('d0000000-0000-4000-8000-00000000000c', 'cccccccc-0000-4000-8000-000000000003',
   decode(repeat('31', 91), 'hex'), decode(repeat('32', 91), 'hex'), 'web', 'web_nonextractable', 'ACTIVE');

-- Scope keys: A personal, A health, couple
INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state) VALUES
  ('50000000-0000-4000-8000-00000000000a', 'personal', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 1, 'ACTIVE'),
  ('50000000-0000-4000-8000-0000000000ff', 'health', 'aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 1, 'ACTIVE');

INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state) VALUES
  ('50000000-0000-4000-8000-00000000000c', 'couple', 'c0000000-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 1, 'ACTIVE');

-- ---------------------------------------------------------------
-- 1. Health / personal envelope recipient restriction
-- ---------------------------------------------------------------
DO $$
BEGIN
  -- Owner's own device: allowed.
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-0000000000ff', 'device', 'd0000000-0000-4000-8000-00000000000a',
          decode(repeat('ee', 360), 'hex'));
  PERFORM test_ok('health envelope to own device accepted');
EXCEPTION WHEN OTHERS THEN
  PERFORM test_fail('health envelope to own device', SQLERRM);
END $$;

DO $$
BEGIN
  -- Partner's device: must be refused by the trigger, regardless of RLS.
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-0000000000ff', 'device', 'd0000000-0000-4000-8000-00000000000b',
          decode(repeat('ee', 360), 'hex'));
  PERFORM test_fail('health envelope to partner device', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('health envelope to partner device REJECTED');
  WHEN OTHERS THEN PERFORM test_fail('health envelope to partner device', SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000a', 'device', 'd0000000-0000-4000-8000-00000000000b',
          decode(repeat('ee', 360), 'hex'));
  PERFORM test_fail('personal envelope to partner device', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('personal envelope to partner device REJECTED');
  WHEN OTHERS THEN PERFORM test_fail('personal envelope to partner device', SQLERRM);
END $$;

DO $$
BEGIN
  -- Couple domain to the partner: this one is legitimate.
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c', 'device', 'd0000000-0000-4000-8000-00000000000b',
          decode(repeat('ce', 360), 'hex'));
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c', 'device', 'd0000000-0000-4000-8000-00000000000a',
          decode(repeat('ca', 360), 'hex'));
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_recovery_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c', 'recovery_identity', '0b000000-0000-4000-8000-00000000000b',
          decode(repeat('cb', 360), 'hex'));
  PERFORM test_ok('couple envelopes to both partners accepted');
EXCEPTION WHEN OTHERS THEN
  PERFORM test_fail('couple envelope', SQLERRM);
END $$;

-- ---------------------------------------------------------------
-- 2. Actor matrix on key_envelopes
-- ---------------------------------------------------------------
DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;

  -- A's recipient-owned rows are: health->A device, couple->A device. The two
  -- personal/health envelopes aimed at B were refused by the trigger, so they
  -- do not exist to be counted.
  PERFORM set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  SELECT count(*) INTO v_count FROM public.key_envelopes;
  IF v_count <> 2 THEN PERFORM test_fail('owner sees own envelopes', 'saw ' || v_count); END IF;
  PERFORM test_ok('owner reads own envelopes (2)');

  PERFORM set_config('test.uid', 'bbbbbbbb-0000-4000-8000-000000000002', true);
  SELECT count(*) INTO v_count FROM public.key_envelopes;
  -- B sees only the couple envelopes addressed to B: never A's health or personal.
  IF v_count <> 2 THEN PERFORM test_fail('partner sees only own envelopes', 'saw ' || v_count); END IF;
  PERFORM test_ok('partner reads ONLY own recipient envelopes (2)');

  SELECT count(*) INTO v_count FROM public.key_envelopes ke
    JOIN public.scope_keys sk ON sk.id = ke.scope_key_id WHERE sk.domain IN ('personal','health');
  IF v_count <> 0 THEN PERFORM test_fail('partner cannot see personal/health envelopes', 'saw ' || v_count); END IF;
  PERFORM test_ok('partner sees ZERO personal/health envelopes');

  PERFORM set_config('test.uid', 'cccccccc-0000-4000-8000-000000000003', true);
  SELECT count(*) INTO v_count FROM public.key_envelopes;
  IF v_count <> 0 THEN PERFORM test_fail('unrelated user denied', 'saw ' || v_count); END IF;
  PERFORM test_ok('unrelated authenticated user sees nothing');

  PERFORM set_config('test.uid', 'dddddddd-0000-4000-8000-000000000004', true);
  SELECT count(*) INTO v_count FROM public.key_envelopes;
  IF v_count <> 0 THEN PERFORM test_fail('former partner denied', 'saw ' || v_count); END IF;
  PERFORM test_ok('former partner sees nothing');

  RESET ROLE;
END $$;

DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('test.uid', '', true);
  BEGIN
    SELECT count(*) INTO v_count FROM public.key_envelopes;
    PERFORM test_fail('anon denied on key_envelopes', 'SELECT succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('anon has no grant on key_envelopes');
  END;
  RESET ROLE;
END $$;

DO $$
DECLARE v_count INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_count FROM public.recovery_identities;
    PERFORM test_fail('anon denied on recovery_identities', 'SELECT succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('anon has no grant on recovery_identities');
  END;
  RESET ROLE;
END $$;

-- ---------------------------------------------------------------
-- 3. Certificate immutability
-- ---------------------------------------------------------------
INSERT INTO public.device_certificates
  (user_id, subject_device_id, recovery_identity_id, recovery_version, certificate, certificate_fp,
   subject_sig_spki, subject_kem_spki, reference_count)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
   '0a000000-0000-4000-8000-00000000000a', 1, decode(repeat('cc', 445), 'hex'), decode(repeat('cf', 32), 'hex'),
   decode(repeat('11', 91), 'hex'), decode(repeat('12', 91), 'hex'), 0);

DO $$
BEGIN
  UPDATE public.device_certificates SET certificate = decode(repeat('dd', 445), 'hex');
  PERFORM test_fail('certificate immutability', 'UPDATE succeeded');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('certificate bytes are immutable');
  WHEN OTHERS THEN PERFORM test_fail('certificate immutability', SQLERRM);
END $$;

-- ---------------------------------------------------------------
-- 4. Epoch uniqueness and concurrent activation
-- ---------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
  VALUES ('couple', 'c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 2, 'ACTIVE');
  PERFORM test_fail('single active epoch', 'second ACTIVE epoch was accepted');
EXCEPTION
  WHEN unique_violation THEN PERFORM test_ok('only one ACTIVE epoch per domain/scope');
  WHEN OTHERS THEN PERFORM test_fail('single active epoch', SQLERRM);
END $$;

DO $$
BEGIN
  -- PREPARING and RETIRED epochs coexist freely; only ACTIVE is exclusive.
  INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
  VALUES ('couple', 'c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 2, 'PREPARING');
  INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
  VALUES ('couple', 'c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 3, 'RETIRED');
  PERFORM test_ok('PREPARING and RETIRED epochs coexist with ACTIVE');
EXCEPTION WHEN OTHERS THEN
  PERFORM test_fail('epoch coexistence', SQLERRM);
END $$;

-- ---------------------------------------------------------------
-- 5. Write floor
-- ---------------------------------------------------------------
INSERT INTO public.daily_records (id, user_id, couple_id, log_text)
VALUES ('11110000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001', 'legacy plaintext');

DO $$
DECLARE v_rev BIGINT;
BEGIN
  -- Before activation the existing client is untouched.
  UPDATE public.daily_records SET log_text = 'edited by legacy client'
   WHERE id = '11110000-0000-4000-8000-000000000001';
  SELECT content_revision INTO v_rev FROM public.daily_records
   WHERE id = '11110000-0000-4000-8000-000000000001';
  IF v_rev <> 2 THEN PERFORM test_fail('legacy update pre-floor', 'revision ' || v_rev); END IF;
  PERFORM test_ok('legacy plaintext write works before activation, revision auto-incremented');
EXCEPTION WHEN OTHERS THEN
  PERFORM test_fail('legacy update pre-floor', SQLERRM);
END $$;

DO $$
BEGIN
  -- Ciphertext before the floor exists is refused, which forces activation to
  -- come first.
  INSERT INTO public.daily_records (user_id, couple_id, log_text, cipher_format, key_domain, key_epoch, content_revision)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
          '', 1, 'couple', 1, 1);
  PERFORM test_fail('ordering rule', 'ciphertext accepted before floor activation');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('ciphertext REJECTED before the floor is active (R0)');
  WHEN OTHERS THEN PERFORM test_fail('ordering rule', SQLERRM);
END $$;

-- Activate the floor for the couple scope.
INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
VALUES ('couple', 'c0000000-0000-4000-8000-000000000001', 1, now());

DO $$
BEGIN
  -- R1: an old client omits cipher_format entirely, so it defaults to 0.
  INSERT INTO public.daily_records (user_id, couple_id, log_text)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'new plaintext');
  PERFORM test_fail('R1 old client INSERT plaintext', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('R1 old client CANNOT insert new plaintext');
  WHEN OTHERS THEN PERFORM test_fail('R1', SQLERRM);
END $$;

DO $$
BEGIN
  -- R2: an old client updates a legacy row without mentioning cipher_format.
  UPDATE public.daily_records SET log_text = 'legacy edit after activation'
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R2 old client UPDATE legacy plaintext', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('R2 old client CANNOT modify a legacy row and leave it plaintext');
  WHEN OTHERS THEN PERFORM test_fail('R2', SQLERRM);
END $$;

DO $$
DECLARE v_rev BIGINT;
BEGIN
  -- The legitimate path: the same UPDATE transitions the row to ciphertext.
  SELECT content_revision INTO v_rev FROM public.daily_records WHERE id = '11110000-0000-4000-8000-000000000001';
  UPDATE public.daily_records
     SET log_text = '', cipher_format = 1, key_domain = 'couple', key_epoch = 1, content_revision = v_rev + 1
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_ok('legacy row CAN transition to ciphertext atomically in one UPDATE');
EXCEPTION WHEN OTHERS THEN
  PERFORM test_fail('atomic transition', SQLERRM);
END $$;

DO $$
BEGIN
  -- R3: downgrade, unconditional.
  UPDATE public.daily_records
     SET cipher_format = 0, log_text = 'back to plaintext', content_revision = content_revision + 1
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R3 downgrade', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('R3 ciphertext CANNOT be downgraded to plaintext');
  WHEN OTHERS THEN PERFORM test_fail('R3', SQLERRM);
END $$;

DO $$
BEGIN
  -- R4: an encrypted row must not also carry readable plaintext.
  UPDATE public.daily_records
     SET log_text = 'residue', content_revision = content_revision + 1
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R4 plaintext residue', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('R4 an encrypted row cannot carry plaintext');
  WHEN OTHERS THEN PERFORM test_fail('R4', SQLERRM);
END $$;

DO $$
BEGIN
  -- R5: stale epoch.
  UPDATE public.daily_records
     SET key_epoch = 99, content_revision = content_revision + 1
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R5 stale epoch', 'was ACCEPTED');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('R5 a stale/unknown epoch is rejected');
  WHEN OTHERS THEN PERFORM test_fail('R5', SQLERRM);
END $$;

DO $$
BEGIN
  -- R6: revision CAS on an encrypted row.
  UPDATE public.daily_records
     SET content_revision = content_revision
   WHERE id = '11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R6 revision CAS', 'stale revision was ACCEPTED');
EXCEPTION
  WHEN serialization_failure THEN PERFORM test_ok('R6 revision CAS rejects a non-incrementing write');
  WHEN OTHERS THEN PERFORM test_fail('R6', SQLERRM);
END $$;

DO $$
BEGIN
  DELETE FROM public.crypto_write_floor WHERE scope_kind = 'couple';
  PERFORM test_fail('floor irreversibility', 'DELETE succeeded');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('the write floor cannot be removed');
  WHEN OTHERS THEN PERFORM test_fail('floor irreversibility', SQLERRM);
END $$;

DO $$
BEGIN
  UPDATE public.crypto_write_floor SET min_cipher_format = 0 WHERE scope_kind = 'couple';
  PERFORM test_fail('floor lowering', 'UPDATE succeeded');
EXCEPTION
  WHEN insufficient_privilege THEN PERFORM test_ok('the write floor cannot be lowered');
  WHEN OTHERS THEN PERFORM test_fail('floor lowering', SQLERRM);
END $$;

-- ---------------------------------------------------------------
-- 6. Membership revision
-- ---------------------------------------------------------------
DO $$
DECLARE v_before BIGINT; v_after BIGINT;
BEGIN
  SELECT membership_revision INTO v_before FROM public.couples WHERE id = 'c0000000-0000-4000-8000-000000000001';
  UPDATE public.couple_members SET status = 'active'
   WHERE couple_id = 'c0000000-0000-4000-8000-000000000001' AND user_id = 'dddddddd-0000-4000-8000-000000000004';
  SELECT membership_revision INTO v_after FROM public.couples WHERE id = 'c0000000-0000-4000-8000-000000000001';
  IF v_after <= v_before THEN PERFORM test_fail('membership revision', 'did not increment'); END IF;
  PERFORM test_ok('membership_revision increments on a membership change');
  UPDATE public.couple_members SET status = 'disconnected'
   WHERE couple_id = 'c0000000-0000-4000-8000-000000000001' AND user_id = 'dddddddd-0000-4000-8000-000000000004';
END $$;

-- ---------------------------------------------------------------
-- 7. Account deletion semantics
-- ---------------------------------------------------------------
DO $$
DECLARE v_result JSONB; v_b_envelopes INTEGER; v_couple_keys INTEGER;
BEGIN
  v_result := public.e2ee_prepare_account_deletion('aaaaaaaa-0000-4000-8000-000000000001');

  IF (v_result->>'partner_remains')::BOOLEAN IS NOT TRUE THEN
    PERFORM test_fail('deletion detects surviving partner', v_result::TEXT);
  END IF;

  -- B's envelopes for the couple key must survive untouched.
  SELECT count(*) INTO v_b_envelopes
  FROM public.key_envelopes ke
  WHERE (ke.recipient_device_id = 'd0000000-0000-4000-8000-00000000000b')
     OR (ke.recipient_recovery_id = '0b000000-0000-4000-8000-00000000000b');
  IF v_b_envelopes <> 2 THEN
    PERFORM test_fail('surviving partner key path', 'B has ' || v_b_envelopes || ' envelopes, expected 2');
  END IF;
  PERFORM test_ok('deleting A preserves B''s couple envelopes (2)');

  -- The couple scope key itself is retained because B still needs it.
  SELECT count(*) INTO v_couple_keys FROM public.scope_keys
   WHERE domain = 'couple' AND scope_id = 'c0000000-0000-4000-8000-000000000001';
  IF v_couple_keys = 0 THEN PERFORM test_fail('couple scope keys retained', 'all were deleted'); END IF;
  PERFORM test_ok('couple scope keys are retained while a partner remains');

  -- A's own personal/health keys and devices are gone.
  IF EXISTS (SELECT 1 FROM public.scope_keys WHERE owner_user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
              AND domain IN ('personal','health')) THEN
    PERFORM test_fail('personal/health keys deleted', 'still present');
  END IF;
  IF EXISTS (SELECT 1 FROM public.devices WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') THEN
    PERFORM test_fail('A devices deleted', 'still present');
  END IF;
  IF EXISTS (SELECT 1 FROM public.recovery_identities WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') THEN
    PERFORM test_fail('A recovery identity deleted', 'still present');
  END IF;
  PERFORM test_ok('A''s own devices, recovery identity and personal/health keys are deleted');
END $$;

-- ---------------------------------------------------------------
-- 8. Deletion pre-flight abort
-- ---------------------------------------------------------------
DO $$
DECLARE v_couple UUID := 'c0000000-0000-4000-8000-000000000009';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('eeeeeeee-0000-4000-8000-000000000005', 'e@test'),
    ('ffffffff-0000-4000-8000-000000000006', 'f@test');
  INSERT INTO public.couples (id) VALUES (v_couple);
  INSERT INTO public.couple_members (couple_id, user_id, status) VALUES
    (v_couple, 'eeeeeeee-0000-4000-8000-000000000005', 'active'),
    (v_couple, 'ffffffff-0000-4000-8000-000000000006', 'active');
  INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status) VALUES
    ('d0000000-0000-4000-8000-00000000000e', 'eeeeeeee-0000-4000-8000-000000000005',
     decode(repeat('41', 91), 'hex'), decode(repeat('42', 91), 'hex'), 'ios', 'secure_enclave', 'ACTIVE');
  -- A couple epoch whose ONLY envelope belongs to the user being deleted: F has
  -- no key path at all, so deleting E would strand F.
  INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state) VALUES
    ('50000000-0000-4000-8000-00000000000e', 'couple', v_couple, 'eeeeeeee-0000-4000-8000-000000000005', 1, 'ACTIVE');
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope) VALUES
    ('50000000-0000-4000-8000-00000000000e', 'device', 'd0000000-0000-4000-8000-00000000000e',
     decode(repeat('e1', 360), 'hex'));

  BEGIN
    PERFORM public.e2ee_prepare_account_deletion('eeeeeeee-0000-4000-8000-000000000005');
    PERFORM test_fail('pre-flight abort', 'deletion proceeded and would have orphaned the partner');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%E2EE_DELETION_WOULD_ORPHAN_PARTNER%' THEN
      PERFORM test_ok('deletion ABORTS rather than crypto-shred a surviving partner');
    ELSE
      PERFORM test_fail('pre-flight abort', SQLERRM);
    END IF;
  END;

  -- And nothing was destroyed by the aborted attempt.
  IF NOT EXISTS (SELECT 1 FROM public.devices WHERE user_id = 'eeeeeeee-0000-4000-8000-000000000005') THEN
    PERFORM test_fail('abort is atomic', 'devices were deleted despite the abort');
  END IF;
  PERFORM test_ok('the aborted deletion left every row intact');
END $$;

-- ---------------------------------------------------------------
-- 9. Function hardening
-- ---------------------------------------------------------------
DO $$
DECLARE v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname IN ('e2ee_prepare_account_deletion', 'activate_e2ee_write_floor',
                      'get_partner_recovery_anchor', 'e2ee_floor_for')
    AND NOT (COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path=public, pg_temp%');
  IF v_bad > 0 THEN PERFORM test_fail('search_path pinning', v_bad || ' definer functions unpinned'); END IF;
  PERFORM test_ok('every new SECURITY DEFINER function pins search_path to public, pg_temp');
END $$;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(c.relname || ':' || a.privilege_type, ', ') INTO v_bad
  FROM information_schema.role_table_grants a
  JOIN pg_class c ON c.relname = a.table_name
  WHERE a.table_schema = 'public'
    AND a.grantee = 'authenticated'
    AND a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')
    AND c.relname IN ('devices','device_certificates','device_enrollments','scope_keys','key_envelopes',
                      'recovery_identities','recovery_challenges','revocation_statements','crypto_pairings',
                      'crypto_write_floor','migration_ledger','crypto_deployment');
  IF v_bad IS NOT NULL THEN PERFORM test_fail('least privilege', v_bad); END IF;
  PERFORM test_ok('no TRUNCATE/TRIGGER/REFERENCES granted to authenticated on any key table');
END $$;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(a.table_name, ', ') INTO v_bad
  FROM information_schema.role_table_grants a
  WHERE a.table_schema = 'public' AND a.grantee = 'anon'
    AND a.table_name IN ('devices','device_certificates','device_enrollments','scope_keys','key_envelopes',
                         'recovery_identities','recovery_challenges','revocation_statements','crypto_pairings',
                         'crypto_write_floor','migration_ledger','crypto_deployment');
  IF v_bad IS NOT NULL THEN PERFORM test_fail('anon grants', v_bad); END IF;
  PERFORM test_ok('anon holds no grant on any key table');
END $$;

DO $$
DECLARE v_missing TEXT;
BEGIN
  SELECT string_agg(t.tablename, ', ') INTO v_missing
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public' AND NOT c.relrowsecurity
    AND t.tablename IN ('devices','device_certificates','device_enrollments','scope_keys','key_envelopes',
                        'recovery_identities','recovery_challenges','revocation_statements','crypto_pairings',
                        'crypto_write_floor','migration_ledger','crypto_deployment');
  IF v_missing IS NOT NULL THEN PERFORM test_fail('RLS enabled', v_missing); END IF;
  PERFORM test_ok('RLS is enabled on every key table');
END $$;

SELECT 'ALL DATABASE TESTS PASSED' AS result;
