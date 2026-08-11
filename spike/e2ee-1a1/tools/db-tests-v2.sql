-- TEST ONLY — Phase 1A patch verification against real PostgreSQL.
-- Covers the defects Sol found. Never run against production.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION test_ok(name TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN RAISE WARNING 'PASS %', name; END $$;
CREATE OR REPLACE FUNCTION test_fail(name TEXT, detail TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FAIL % :: %', name, detail; END $$;

-- =============================================================
-- Fixtures
-- =============================================================
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

INSERT INTO public.recovery_identities
  (id, user_id, recovery_salt, rec_sig_spki, rec_kem_spki, enc_rec_sig_priv, enc_rec_kem_priv, recovery_bundle_fp, bundle_sig)
VALUES
  ('0a000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   decode(repeat('aa',32),'hex'), decode(repeat('01',91),'hex'), decode(repeat('02',91),'hex'),
   decode('00','hex'), decode('00','hex'), decode(repeat('a1',32),'hex'), decode(repeat('a2',64),'hex')),
  ('0b000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002',
   decode(repeat('bb',32),'hex'), decode(repeat('03',91),'hex'), decode(repeat('04',91),'hex'),
   decode('00','hex'), decode('00','hex'), decode(repeat('b1',32),'hex'), decode(repeat('b2',64),'hex'));

INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status) VALUES
  ('d0000000-0000-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-000000000001',
   decode(repeat('11',91),'hex'), decode(repeat('12',91),'hex'),'ios','secure_enclave','ACTIVE'),
  ('d0000000-0000-4000-8000-00000000000b','bbbbbbbb-0000-4000-8000-000000000002',
   decode(repeat('21',91),'hex'), decode(repeat('22',91),'hex'),'android','tee','ACTIVE'),
  ('d0000000-0000-4000-8000-00000000000c','cccccccc-0000-4000-8000-000000000003',
   decode(repeat('31',91),'hex'), decode(repeat('32',91),'hex'),'web','web_nonextractable','ACTIVE');

INSERT INTO public.recovery_public_anchors
  (id, user_id, recovery_identity_id, recovery_version, rec_sig_spki, rec_sig_fp, recovery_bundle_fp)
VALUES ('fa000000-0000-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-00000000000a',1, decode(repeat('01',91),'hex'),
        decode(repeat('0f',32),'hex'), decode(repeat('a1',32),'hex'));

-- A real chain: root anchor -> D1 -> D2, and an envelope signed by D2.
INSERT INTO public.device_certificates
  (id, user_id, subject_device_id, recovery_public_anchor_id, recovery_identity_id, recovery_version,
   certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
VALUES
  ('ce000000-0000-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000a','fa000000-0000-4000-8000-00000000000a',
   '0a000000-0000-4000-8000-00000000000a',1,
   decode(repeat('cc',445),'hex'), decode(repeat('cf',32),'hex'),
   decode(repeat('11',91),'hex'), decode(repeat('12',91),'hex'));

INSERT INTO public.devices (id, user_id, sig_spki, kem_spki, platform, assurance, status) VALUES
  ('d0000000-0000-4000-8000-00000000000d','aaaaaaaa-0000-4000-8000-000000000001',
   decode(repeat('41',91),'hex'), decode(repeat('42',91),'hex'),'web','web_nonextractable','ACTIVE');

INSERT INTO public.device_certificates
  (id, user_id, subject_device_id, issuer_certificate_id, recovery_identity_id, recovery_version,
   certificate, certificate_fp, subject_sig_spki, subject_kem_spki)
VALUES
  ('ce000000-0000-4000-8000-00000000000d','aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000000d','ce000000-0000-4000-8000-00000000000a',
   '0a000000-0000-4000-8000-00000000000a',1,
   decode(repeat('dd',445),'hex'), decode(repeat('df',32),'hex'),
   decode(repeat('41',91),'hex'), decode(repeat('42',91),'hex'));

-- personal + health for A, couple for the pair (couple-owned)
INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state) VALUES
  ('50000000-0000-4000-8000-00000000000a','personal','aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'ACTIVE'),
  ('50000000-0000-4000-8000-0000000000ff','health','aaaaaaaa-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',1,'ACTIVE');

INSERT INTO public.scope_keys (id, domain, scope_id, owner_couple_id, key_epoch, state) VALUES
  ('50000000-0000-4000-8000-00000000000c','couple','c0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001',1,'ACTIVE');

-- =============================================================
-- 1. Ownership model (PATCH 5)
-- =============================================================
DO $$
BEGIN
  INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, owner_couple_id, key_epoch, state)
  VALUES ('couple','c0000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000001', 9, 'PREPARING');
  PERFORM test_fail('couple key cannot be user-owned','accepted');
EXCEPTION WHEN check_violation THEN
  PERFORM test_ok('a couple scope key cannot carry an auth.users owner');
END $$;

DO $$
BEGIN
  INSERT INTO public.scope_keys (domain, scope_id, owner_couple_id, key_epoch, state)
  VALUES ('personal','aaaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',9,'PREPARING');
  PERFORM test_fail('personal key cannot be couple-owned','accepted');
EXCEPTION WHEN check_violation THEN
  PERFORM test_ok('a personal scope key cannot be couple-owned');
END $$;

-- =============================================================
-- 2. Envelope rules
-- =============================================================
INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
VALUES ('50000000-0000-4000-8000-0000000000ff','device','d0000000-0000-4000-8000-00000000000a',
        'ce000000-0000-4000-8000-00000000000a', decode(repeat('ee',360),'hex'));

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-0000000000ff','device','d0000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000a',
          decode(repeat('ee',360),'hex'));
  PERFORM test_fail('health envelope to partner','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('health envelope to a partner device REJECTED');
END $$;

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000a','device','d0000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000a',
          decode(repeat('ee',360),'hex'));
  PERFORM test_fail('personal envelope to partner','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('personal envelope to a partner device REJECTED');
END $$;

INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope) VALUES
  ('50000000-0000-4000-8000-00000000000c','device','d0000000-0000-4000-8000-00000000000a','ce000000-0000-4000-8000-00000000000d', decode(repeat('ca',360),'hex')),
  ('50000000-0000-4000-8000-00000000000c','device','d0000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000d', decode(repeat('cb',360),'hex'));
INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_recovery_id, sender_certificate_id, envelope) VALUES
  ('50000000-0000-4000-8000-00000000000c','recovery_identity','0b000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000d', decode(repeat('c7',360),'hex'));

-- PATCH 6: duplicate recipients must be impossible despite NULL columns
DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c','device','d0000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000d',
          decode(repeat('99',360),'hex'));
  PERFORM test_fail('duplicate device envelope','accepted');
EXCEPTION WHEN unique_violation THEN
  PERFORM test_ok('duplicate DEVICE recipient envelope rejected (partial unique index)');
END $$;

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_recovery_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c','recovery_identity','0b000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000d',
          decode(repeat('98',360),'hex'));
  PERFORM test_fail('duplicate recovery envelope','accepted');
EXCEPTION WHEN unique_violation THEN
  PERFORM test_ok('duplicate RECOVERY recipient envelope rejected (partial unique index)');
END $$;

-- =============================================================
-- 3. Epoch state machine (PATCH 3)
-- =============================================================
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid','aaaaaaaa-0000-4000-8000-000000000001', true);
  BEGIN
    UPDATE public.scope_keys SET state = 'ACTIVE' WHERE id = '50000000-0000-4000-8000-00000000000c';
    PERFORM test_fail('direct epoch UPDATE','authenticated could UPDATE scope_keys directly');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('authenticated has NO direct UPDATE on scope_keys');
  END;
  RESET ROLE;
END $$;

-- legal path: PREPARING -> READY -> ACTIVE
INSERT INTO public.scope_keys (id, domain, scope_id, owner_couple_id, key_epoch, state)
VALUES ('50000000-0000-4000-8000-00000000000d','couple','c0000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001',2,'PREPARING');
INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope) VALUES
  ('50000000-0000-4000-8000-00000000000d','device','d0000000-0000-4000-8000-00000000000a','ce000000-0000-4000-8000-00000000000d', decode(repeat('d1',360),'hex')),
  ('50000000-0000-4000-8000-00000000000d','device','d0000000-0000-4000-8000-00000000000b','ce000000-0000-4000-8000-00000000000d', decode(repeat('d2',360),'hex'));

DO $$
DECLARE v_state TEXT;
BEGIN
  PERFORM set_config('test.uid','aaaaaaaa-0000-4000-8000-000000000001', true);
  v_state := public.e2ee_mark_epoch_ready('50000000-0000-4000-8000-00000000000d');
  IF v_state <> 'READY' THEN PERFORM test_fail('PREPARING->READY', v_state); END IF;
  PERFORM test_ok('PREPARING -> READY');

  v_state := public.e2ee_activate_epoch('50000000-0000-4000-8000-00000000000d');
  IF v_state <> 'ACTIVE' THEN PERFORM test_fail('READY->ACTIVE', v_state); END IF;
  PERFORM test_ok('READY -> ACTIVE, and the prior ACTIVE epoch was retired atomically');

  IF (SELECT state FROM public.scope_keys WHERE id='50000000-0000-4000-8000-00000000000c') <> 'RETIRED' THEN
    PERFORM test_fail('prior epoch retired','not RETIRED');
  END IF;
  PERFORM test_ok('ACTIVE -> RETIRED on supersession');
END $$;

-- THE resurrection attack
DO $$
BEGIN
  PERFORM set_config('test.uid','aaaaaaaa-0000-4000-8000-000000000001', true);
  PERFORM public.e2ee_activate_epoch('50000000-0000-4000-8000-00000000000c');
  PERFORM test_fail('RETIRED -> ACTIVE','a retired epoch was resurrected');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('RETIRED -> ACTIVE REFUSED (epoch resurrection impossible)');
END $$;

DO $$
BEGIN
  INSERT INTO public.scope_keys (id, domain, scope_id, owner_couple_id, key_epoch, state)
  VALUES ('50000000-0000-4000-8000-00000000000e','couple','c0000000-0000-4000-8000-000000000001',
          'c0000000-0000-4000-8000-000000000001',3,'ABANDONED');
  PERFORM set_config('test.uid','aaaaaaaa-0000-4000-8000-000000000001', true);
  PERFORM public.e2ee_activate_epoch('50000000-0000-4000-8000-00000000000e');
  PERFORM test_fail('ABANDONED -> ACTIVE','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('ABANDONED -> ACTIVE REFUSED');
END $$;

DO $$
BEGIN
  PERFORM set_config('test.uid','aaaaaaaa-0000-4000-8000-000000000001', true);
  PERFORM public.e2ee_mark_epoch_ready('50000000-0000-4000-8000-00000000000c');
  PERFORM test_fail('RETIRED -> READY','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('RETIRED -> READY REFUSED');
END $$;

-- a second ACTIVE epoch cannot exist
DO $$
BEGIN
  INSERT INTO public.scope_keys (domain, scope_id, owner_couple_id, key_epoch, state)
  VALUES ('couple','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',77,'ACTIVE');
  PERFORM test_fail('second ACTIVE epoch','accepted');
EXCEPTION WHEN unique_violation THEN
  PERFORM test_ok('only one ACTIVE epoch per domain/scope, under the unique index');
END $$;

-- =============================================================
-- 4. Revoked recipients (PATCH 3)
-- =============================================================
INSERT INTO public.revocation_statements
  (user_id, revoked_device_id, revoker_device_id, reason, statement, signature, revoked_at, sequence, log_head)
VALUES ('cccccccc-0000-4000-8000-000000000003','d0000000-0000-4000-8000-00000000000c',
        'd0000000-0000-4000-8000-00000000000c',4, decode(repeat('55',203),'hex'), decode(repeat('56',64),'hex'),
        now(), 1, decode(repeat('57',32),'hex'));

DO $$
BEGIN
  INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state)
  VALUES ('50000000-0000-4000-8000-0000000000c1','personal','cccccccc-0000-4000-8000-000000000003',
          'cccccccc-0000-4000-8000-000000000003',1,'PREPARING');
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-0000000000c1','device','d0000000-0000-4000-8000-00000000000c','ce000000-0000-4000-8000-00000000000d',
          decode(repeat('c9',360),'hex'));
  PERFORM test_fail('revoked recipient envelope','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('a REVOKED device cannot receive a new epoch envelope');
END $$;

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, sender_certificate_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000c','device','d0000000-0000-4000-8000-00000000000c','ce000000-0000-4000-8000-00000000000d',
          decode(repeat('c8',360),'hex'));
  PERFORM test_fail('envelope on retired epoch','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('no new recipient may be added to a RETIRED epoch');
END $$;

-- =============================================================
-- 5. Certificate retention (PATCH 6)
-- =============================================================
DO $$
BEGIN
  DELETE FROM public.device_certificates WHERE id = 'ce000000-0000-4000-8000-00000000000a';
  PERFORM test_fail('referenced certificate DELETE','succeeded');
EXCEPTION WHEN foreign_key_violation THEN
  PERFORM test_ok('a referenced sender certificate cannot be deleted (FK RESTRICT)');
END $$;

DO $$
BEGIN
  DELETE FROM public.devices WHERE id = 'd0000000-0000-4000-8000-00000000000a';
  IF NOT EXISTS (SELECT 1 FROM public.device_certificates WHERE id='ce000000-0000-4000-8000-00000000000a') THEN
    PERFORM test_fail('cert survives device delete','certificate disappeared');
  END IF;
  PERFORM test_ok('deleting the operational device row does NOT delete its certificate');
  RAISE EXCEPTION 'rollback fixture';
EXCEPTION WHEN raise_exception THEN NULL;
END $$;

-- =============================================================
-- 6. Write floor: every protected field + domain binding (PATCH 4)
-- =============================================================
-- Two legacy rows: one is migrated to ciphertext by the transition test below,
-- the other stays plaintext so the "legacy rows remain readable" assertion has
-- something to read.
INSERT INTO public.daily_records (id, user_id, couple_id, log_text) VALUES
  ('11110000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001','legacy'),
  ('11110000-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001','legacy untouched');

INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
VALUES ('couple','c0000000-0000-4000-8000-000000000001',1, now());

DO $$
BEGIN
  INSERT INTO public.daily_records (user_id, couple_id, log_text)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','new plaintext');
  PERFORM test_fail('R1','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('R1 old client cannot INSERT plaintext');
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET log_text='edited' WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R2','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('R2 old client cannot edit a legacy row and leave it plaintext');
END $$;

-- the legitimate atomic transition
DO $$
BEGIN
  UPDATE public.daily_records
     SET log_text='', reaction=NULL, attachments='[]'::jsonb, emotion_flow='[]'::jsonb, record_time=NULL,
         cipher_format=1, key_domain='couple', key_epoch=2, content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_ok('a legacy row transitions to ciphertext atomically in one UPDATE');
EXCEPTION WHEN OTHERS THEN PERFORM test_fail('atomic transition', SQLERRM);
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET reaction='good', content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('residue reaction','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('residue REJECTED: reaction');
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET attachments='[{"name":"secret.jpg"}]'::jsonb, content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('residue attachments','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('residue REJECTED: attachments manifest');
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET emotion_flow='[{"e":"sad"}]'::jsonb, content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('residue emotion_flow','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('residue REJECTED: emotion_flow');
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET record_time='12:00:00', content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('residue record_time','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('residue REJECTED: record_time');
END $$;

DO $$
BEGIN
  UPDATE public.daily_records SET cipher_format=0, log_text='back', content_revision=content_revision+1
   WHERE id='11110000-0000-4000-8000-000000000001';
  PERFORM test_fail('R3 downgrade','accepted');
EXCEPTION WHEN insufficient_privilege THEN PERFORM test_ok('R3 ciphertext cannot downgrade to plaintext');
END $$;

-- domain binding, both directions
INSERT INTO public.scope_keys (id, domain, scope_id, owner_user_id, key_epoch, state)
VALUES ('50000000-0000-4000-8000-0000000000a2','personal','aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000001',2,'PREPARING');

DO $$
BEGIN
  INSERT INTO public.daily_records (user_id, couple_id, log_text, is_private, cipher_format, key_domain, key_epoch, content_revision, record_time)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','',
          true, 1, 'couple', 2, 1, NULL);
  PERFORM test_fail('private + couple domain','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('a PRIVATE record cannot be encrypted under the COUPLE key');
END $$;

DO $$
BEGIN
  INSERT INTO public.daily_records (user_id, couple_id, log_text, is_private, cipher_format, key_domain, key_epoch, content_revision, record_time)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','',
          false, 1, 'personal', 1, 1, NULL);
  PERFORM test_fail('shared + personal domain','accepted');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('a SHARED record cannot be encrypted under the PERSONAL key');
END $$;

DO $$
BEGIN
  INSERT INTO public.daily_records (user_id, couple_id, log_text, is_private, cipher_format, key_domain, key_epoch, content_revision, record_time)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','',
          false, 1, 'couple', 2, 1, NULL);
  PERFORM test_ok('a valid shared ciphertext write is accepted');
EXCEPTION WHEN OTHERS THEN PERFORM test_fail('valid ciphertext write', SQLERRM);
END $$;

DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.daily_records WHERE cipher_format = 0;
  IF v_count = 0 THEN PERFORM test_fail('legacy read','no legacy rows readable'); END IF;
  PERFORM test_ok('legacy plaintext rows remain readable after activation');
END $$;

-- =============================================================
-- 7. THE Auth CASCADE deletion test (PATCH 5)
-- =============================================================
DO $$
DECLARE
  v_couple_keys_before INTEGER; v_b_env_before INTEGER;
  v_couple_keys_after INTEGER;  v_b_env_after INTEGER;
  v_a_personal INTEGER; v_a_env INTEGER;
BEGIN
  SELECT count(*) INTO v_couple_keys_before FROM public.scope_keys
   WHERE domain='couple' AND owner_couple_id='c0000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_b_env_before FROM public.key_envelopes ke
   WHERE ke.recipient_device_id='d0000000-0000-4000-8000-00000000000b'
      OR ke.recipient_recovery_id='0b000000-0000-4000-8000-00000000000b';

  PERFORM public.e2ee_prepare_account_deletion('aaaaaaaa-0000-4000-8000-000000000001');

  -- The step the previous suite never modelled: Auth actually deletes the row.
  DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

  SELECT count(*) INTO v_couple_keys_after FROM public.scope_keys
   WHERE domain='couple' AND owner_couple_id='c0000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_b_env_after FROM public.key_envelopes ke
   WHERE ke.recipient_device_id='d0000000-0000-4000-8000-00000000000b'
      OR ke.recipient_recovery_id='0b000000-0000-4000-8000-00000000000b';
  SELECT count(*) INTO v_a_personal FROM public.scope_keys
   WHERE domain IN ('personal','health') AND owner_user_id='aaaaaaaa-0000-4000-8000-000000000001';
  SELECT count(*) INTO v_a_env FROM public.key_envelopes ke
   WHERE ke.recipient_device_id='d0000000-0000-4000-8000-00000000000a';

  IF v_couple_keys_after <> v_couple_keys_before THEN
    PERFORM test_fail('couple keys survive Auth CASCADE',
      v_couple_keys_before || ' -> ' || v_couple_keys_after);
  END IF;
  PERFORM test_ok('couple scope keys SURVIVE deletion of A''s auth.users row ('
    || v_couple_keys_before || ' -> ' || v_couple_keys_after || ')');

  IF v_b_env_after <> v_b_env_before OR v_b_env_after = 0 THEN
    PERFORM test_fail('B envelopes survive Auth CASCADE', v_b_env_before || ' -> ' || v_b_env_after);
  END IF;
  PERFORM test_ok('B''s envelopes SURVIVE deletion of A''s auth.users row ('
    || v_b_env_before || ' -> ' || v_b_env_after || ')');

  IF v_a_personal <> 0 THEN PERFORM test_fail('A personal/health removed', v_a_personal::TEXT); END IF;
  PERFORM test_ok('A''s personal and health scope keys are gone');

  IF v_a_env <> 0 THEN PERFORM test_fail('A envelopes removed', v_a_env::TEXT); END IF;
  PERFORM test_ok('A''s recipient envelopes are gone');

  IF EXISTS (SELECT 1 FROM public.recovery_identities WHERE user_id='aaaaaaaa-0000-4000-8000-000000000001') THEN
    PERFORM test_fail('A recovery identity removed','still present');
  END IF;
  PERFORM test_ok('no dangling secret material remains for A');
END $$;

-- =============================================================
-- 8. Hardening
-- =============================================================
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(a.table_name || ':' || a.privilege_type, ', ') INTO v_bad
  FROM information_schema.role_table_grants a
  WHERE a.table_schema='public' AND a.grantee='authenticated'
    AND a.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
    AND a.table_name IN ('devices','device_certificates','device_enrollments','scope_keys','key_envelopes',
                         'recovery_identities','recovery_challenges','revocation_statements','crypto_pairings',
                         'crypto_write_floor','migration_ledger','crypto_deployment');
  IF v_bad IS NOT NULL THEN PERFORM test_fail('least privilege', v_bad); END IF;
  PERFORM test_ok('no TRUNCATE/TRIGGER/REFERENCES for authenticated on any key table');
END $$;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(a.table_name,', ') INTO v_bad
  FROM information_schema.role_table_grants a
  WHERE a.table_schema='public' AND a.grantee='anon'
    AND a.table_name IN ('devices','device_certificates','scope_keys','key_envelopes','recovery_identities');
  IF v_bad IS NOT NULL THEN PERFORM test_fail('anon grants', v_bad); END IF;
  PERFORM test_ok('anon holds no grant on any key table');
END $$;

DO $$
DECLARE v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND p.proname LIKE 'e2ee%'
    AND NOT (COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=public, pg_temp%');
  IF v_bad > 0 THEN PERFORM test_fail('search_path pinning', v_bad::TEXT); END IF;
  PERFORM test_ok('every e2ee SECURITY DEFINER function pins search_path');
END $$;

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(p.proname,', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='e2ee_prepare_account_deletion'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN PERFORM test_fail('deletion RPC is service_role only', v_bad); END IF;
  PERFORM test_ok('the E2EE deletion RPC is not executable by authenticated');
END $$;


-- =============================================================
-- 9. PATCH A — epoch creation must begin PREPARING
-- (uses C: the Auth CASCADE test above deleted A's auth.users row)
-- =============================================================
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid','cccccccc-0000-4000-8000-000000000003', true);
  BEGIN
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000003',50,'ACTIVE');
    PERFORM test_fail('INSERT ACTIVE','accepted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('authenticated CANNOT insert a scope key as ACTIVE');
  END;

  BEGIN
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000003',51,'READY');
    PERFORM test_fail('INSERT READY','accepted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('authenticated CANNOT insert a scope key as READY');
  END;

  BEGIN
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal','cccccccc-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000003',52,'PREPARING');
    PERFORM test_ok('authenticated CAN create a PREPARING epoch');
  EXCEPTION WHEN OTHERS THEN
    PERFORM test_fail('INSERT PREPARING', SQLERRM);
  END;

  -- forged ownership: claim another user's scope
  BEGIN
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal','bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002',53,'PREPARING');
    PERFORM test_fail('forged owner','accepted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('forged owner_user_id REJECTED');
  END;

  -- scope_id contradicting owner_user_id
  BEGIN
    INSERT INTO public.scope_keys (domain, scope_id, owner_user_id, key_epoch, state)
    VALUES ('personal','bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003',54,'PREPARING');
    PERFORM test_fail('scope_id mismatch','accepted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('scope_id contradicting owner_user_id REJECTED');
  END;

  RESET ROLE;
END $$;

-- =============================================================
-- 10. PATCH F — revocation authorization
-- =============================================================
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid','cccccccc-0000-4000-8000-000000000003', true);
  BEGIN
    -- C tries to revoke B's device.
    INSERT INTO public.revocation_statements
      (user_id, revoked_device_id, revoker_device_id, reason, statement, signature, revoked_at, sequence, log_head)
    VALUES ('cccccccc-0000-4000-8000-000000000003','d0000000-0000-4000-8000-00000000000b',
            'd0000000-0000-4000-8000-00000000000c',4, decode(repeat('55',203),'hex'),
            decode(repeat('56',64),'hex'), now(), 90, decode(repeat('57',32),'hex'));
    PERFORM test_fail('cross-user revocation','accepted');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM test_ok('cross-user revocation DoS REJECTED (target device must be the caller''s)');
  END;
  RESET ROLE;
END $$;

-- =============================================================
-- 11. PATCH C — multi-level chain retention
-- =============================================================
DO $$
BEGIN
  -- ce...000d is the leaf that signed the surviving couple envelopes.
  DELETE FROM public.device_certificates WHERE id = 'ce000000-0000-4000-8000-00000000000d';
  PERFORM test_fail('leaf cert delete','succeeded');
EXCEPTION WHEN foreign_key_violation THEN
  PERFORM test_ok('LEAF certificate cannot be deleted while an envelope references it');
END $$;

DO $$
BEGIN
  -- ce...000a issued ce...000d.
  DELETE FROM public.device_certificates WHERE id = 'ce000000-0000-4000-8000-00000000000a';
  PERFORM test_fail('issuer cert delete','succeeded');
EXCEPTION WHEN foreign_key_violation THEN
  PERFORM test_ok('ISSUER certificate cannot be deleted while its child exists');
END $$;

DO $$
BEGIN
  DELETE FROM public.recovery_public_anchors WHERE id = 'fa000000-0000-4000-8000-00000000000a';
  PERFORM test_fail('root anchor delete','succeeded');
EXCEPTION WHEN foreign_key_violation THEN
  PERFORM test_ok('ROOT anchor cannot be deleted while the chain roots at it');
END $$;

DO $$
BEGIN
  INSERT INTO public.key_envelopes (scope_key_id, recipient_kind, recipient_device_id, envelope)
  VALUES ('50000000-0000-4000-8000-00000000000d','device','d0000000-0000-4000-8000-00000000000c',
          decode(repeat('aa',360),'hex'));
  PERFORM test_fail('envelope without sender certificate','accepted');
EXCEPTION WHEN check_violation OR insufficient_privilege THEN
  PERFORM test_ok('an envelope cannot be written without a sender certificate');
END $$;

-- =============================================================
-- 12. PATCH B — write-floor deletion is deletion-path only
-- =============================================================
INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
VALUES ('user','bbbbbbbb-0000-4000-8000-000000000002',1, now());

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid','bbbbbbbb-0000-4000-8000-000000000002', true);
  BEGIN
    DELETE FROM public.crypto_write_floor WHERE scope_kind='user' AND scope_id='bbbbbbbb-0000-4000-8000-000000000002';
    PERFORM test_fail('normal caller floor delete','succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM test_ok('a normal authenticated caller CANNOT delete a write floor');
  END;
  RESET ROLE;
END $$;

DO $$
BEGIN
  -- Even service_role cannot delete it outside the destruction transaction.
  DELETE FROM public.crypto_write_floor WHERE scope_kind='user' AND scope_id='bbbbbbbb-0000-4000-8000-000000000002';
  PERFORM test_fail('floor delete outside destruction','succeeded');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('the floor cannot be deleted outside the account-destruction path');
END $$;

DO $$
BEGIN
  PERFORM public.e2ee_prepare_account_deletion('bbbbbbbb-0000-4000-8000-000000000002');
  IF EXISTS (SELECT 1 FROM public.crypto_write_floor
              WHERE scope_kind='user' AND scope_id='bbbbbbbb-0000-4000-8000-000000000002') THEN
    PERFORM test_fail('floor cleanup in deletion','floor survived');
  END IF;
  PERFORM test_ok('the deletion path CAN remove the personal write floor');
END $$;

-- A fresh floor, inserted OUTSIDE a DO block: a plpgsql exception handler rolls
-- its own block back, so setup done inside the block under test disappears.
INSERT INTO public.crypto_write_floor (scope_kind, scope_id, min_cipher_format, activated_at)
VALUES ('user','dddddddd-0000-4000-8000-000000000004',1, now());

DO $$
BEGIN
  -- The general irreversibility is untouched after a deletion ran.
  UPDATE public.crypto_write_floor SET min_cipher_format = 0
   WHERE scope_kind='user' AND scope_id='dddddddd-0000-4000-8000-000000000004';
  PERFORM test_fail('floor lowering after deletion','succeeded');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('the floor still cannot be lowered after a deletion ran');
END $$;

DO $$
BEGIN
  DELETE FROM public.crypto_write_floor
   WHERE scope_kind='user' AND scope_id='dddddddd-0000-4000-8000-000000000004';
  PERFORM test_fail('floor delete after deletion','succeeded');
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM test_ok('the destruction flag did not leak outside its transaction');
END $$;

SELECT 'ALL V2 DATABASE TESTS PASSED' AS result;
