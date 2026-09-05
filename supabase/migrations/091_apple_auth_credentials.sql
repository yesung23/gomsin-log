-- Server-only Apple authorization-code custody and deletion revocation.
-- Verified identity binding is separate from custody of every obtained token.
BEGIN;

ALTER TABLE public.account_deletion_requests
  ADD COLUMN deletion_lifecycle_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT account_deletion_requests_deletion_lifecycle_id_key UNIQUE (deletion_lifecycle_id);

COMMENT ON COLUMN public.account_deletion_requests.deletion_lifecycle_id IS
  'Stable row-lifecycle fence. Attempt rotation preserves it; cancellation and reinsertion create a new value.';

CREATE SCHEMA IF NOT EXISTS apple_auth_private;
REVOKE ALL ON SCHEMA apple_auth_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE apple_auth_private.account_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_subject TEXT UNIQUE CHECK (verified_subject IS NULL OR length(verified_subject) BETWEEN 1 AND 255),
  next_generation BIGINT NOT NULL DEFAULT 1 CHECK (next_generation > 0),
  exchange_uncertain BOOLEAN NOT NULL DEFAULT false,
  uncertainty_attempt_id UUID,
  uncertainty_reason TEXT CHECK (uncertainty_reason IS NULL OR uncertainty_reason ~ '^[A-Z0-9_]{1,64}$'),
  uncertainty_recorded_at TIMESTAMPTZ,
  deletion_lifecycle_id UUID,
  deletion_outcome TEXT CHECK (deletion_outcome IS NULL OR deletion_outcome IN ('revoked','not_required','manual_required')),
  deletion_reason TEXT CHECK (deletion_reason IS NULL OR deletion_reason ~ '^[A-Z0-9_]{1,64}$'),
  deletion_provenance TEXT CHECK (deletion_provenance IS NULL OR deletion_provenance IN ('provider_http_200','runtime_admin_identity','operator_token_evidence','operator_account_evidence')),
  deletion_origin_attempt_id UUID,
  deletion_replay_attempt_id UUID,
  deletion_resolved_at TIMESTAMPTZ,
  deletion_evidence_reference TEXT CHECK (deletion_evidence_reference IS NULL OR deletion_evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  deletion_evidence_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((exchange_uncertain AND uncertainty_attempt_id IS NOT NULL AND uncertainty_reason IS NOT NULL AND uncertainty_recorded_at IS NOT NULL)
    OR (NOT exchange_uncertain AND uncertainty_attempt_id IS NULL AND uncertainty_reason IS NULL AND uncertainty_recorded_at IS NULL)),
  CHECK ((deletion_lifecycle_id IS NULL AND deletion_outcome IS NULL AND deletion_reason IS NULL AND deletion_provenance IS NULL AND deletion_origin_attempt_id IS NULL AND deletion_replay_attempt_id IS NULL AND deletion_resolved_at IS NULL)
    OR (deletion_lifecycle_id IS NOT NULL AND deletion_outcome IS NOT NULL AND deletion_reason IS NOT NULL AND deletion_provenance IS NOT NULL AND deletion_origin_attempt_id IS NOT NULL AND deletion_replay_attempt_id IS NOT NULL AND deletion_resolved_at IS NOT NULL)),
  CHECK ((deletion_evidence_reference IS NULL AND deletion_evidence_at IS NULL AND deletion_provenance IS DISTINCT FROM 'operator_account_evidence')
    OR (deletion_evidence_reference IS NOT NULL AND deletion_evidence_at IS NOT NULL AND deletion_provenance='operator_account_evidence'
      AND deletion_reason IN ('PRE091_NO_TOKEN','PRE091_NO_APPLE_PROVIDER')))
);

CREATE TABLE apple_auth_private.registration_attempts (
  attempt_id UUID PRIMARY KEY,
  request_uid UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_digest TEXT NOT NULL UNIQUE CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  claim_token UUID NOT NULL,
  token_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved','captured','promotion_prepared','promoted','rejected','exchange_uncertain')),
  exchange_captured BOOLEAN NOT NULL DEFAULT false,
  has_usable_credential BOOLEAN NOT NULL,
  generation BIGINT CHECK (generation IS NULL OR generation > 0),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,64}$'),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status='reserved' AND NOT exchange_captured AND lease_expires_at IS NOT NULL AND generation IS NULL AND failure_code IS NULL)
    OR (status='captured' AND exchange_captured AND lease_expires_at IS NULL AND generation IS NULL)
    OR (status='promotion_prepared' AND exchange_captured AND lease_expires_at IS NULL AND generation IS NOT NULL)
    OR (status='promoted' AND exchange_captured AND lease_expires_at IS NULL AND generation IS NOT NULL AND failure_code IS NULL)
    OR (status IN ('rejected','exchange_uncertain') AND lease_expires_at IS NULL AND generation IS NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX apple_auth_registration_user_window ON apple_auth_private.registration_attempts(request_uid,created_at DESC);

CREATE TABLE apple_auth_private.credential_tokens (
  token_id UUID PRIMARY KEY,
  registration_attempt_id UUID NOT NULL UNIQUE REFERENCES apple_auth_private.registration_attempts(attempt_id),
  request_uid UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_subject TEXT CHECK (verified_subject IS NULL OR length(verified_subject) BETWEEN 1 AND 255),
  generation BIGINT CHECK (generation IS NULL OR generation > 0),
  audience TEXT NOT NULL DEFAULT 'app.gomsinlog' CHECK (audience='app.gomsinlog'),
  aad_kind TEXT NOT NULL CHECK (aad_kind IN ('quarantine','verified')),
  state TEXT NOT NULL CHECK (state IN ('quarantine','active','revoke_in_flight','revoke_retryable','manual_required','revoked')),
  ciphertext_b64 TEXT,
  nonce_b64 TEXT,
  key_id TEXT CHECK (key_id IS NULL OR key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  crypto_version SMALLINT,
  revoke_attempt_id UUID,
  revoke_lifecycle_id UUID,
  revoke_lease_token UUID,
  revoke_lease_expires_at TIMESTAMPTZ,
  revoke_completion_lease_hash TEXT,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  operator_evidence_reference TEXT CHECK (operator_evidence_reference IS NULL OR operator_evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  operator_evidence_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  CHECK ((aad_kind='quarantine' AND verified_subject IS NULL AND generation IS NULL AND state<>'active')
    OR (aad_kind='verified' AND verified_subject IS NOT NULL AND generation IS NOT NULL AND state<>'quarantine')),
  CHECK ((state='revoked' AND ciphertext_b64 IS NULL AND nonce_b64 IS NULL AND key_id IS NULL AND crypto_version IS NULL AND revoked_at IS NOT NULL)
    OR (state<>'revoked' AND ciphertext_b64 IS NOT NULL AND nonce_b64 IS NOT NULL AND key_id IS NOT NULL AND crypto_version=1 AND revoked_at IS NULL)),
  CONSTRAINT apple_auth_credential_revoke_lease_consistency CHECK ((state='revoke_in_flight' AND revoke_attempt_id IS NOT NULL AND revoke_lifecycle_id IS NOT NULL AND revoke_lease_token IS NOT NULL AND revoke_lease_expires_at IS NOT NULL)
    OR (state<>'revoke_in_flight' AND revoke_lease_token IS NULL AND revoke_lease_expires_at IS NULL)),
  CONSTRAINT apple_auth_credential_completion_proof_consistency CHECK (
    (state='revoked' AND revoke_attempt_id IS NOT NULL AND revoke_lifecycle_id IS NOT NULL
      AND revoke_completion_lease_hash IS NOT NULL AND revoke_completion_lease_hash ~ '^[0-9a-f]{64}$')
    OR ((state<>'revoked' OR revoke_lifecycle_id IS NULL) AND revoke_completion_lease_hash IS NULL)),
  CHECK ((operator_evidence_reference IS NULL AND operator_evidence_at IS NULL)
    OR (operator_evidence_reference IS NOT NULL AND operator_evidence_at IS NOT NULL AND state='manual_required'
      AND revoke_attempt_id IS NOT NULL AND revoke_lifecycle_id IS NOT NULL AND last_error_code='KEY_IRRECOVERABLY_LOST')),
  UNIQUE(request_uid,generation)
);
CREATE INDEX apple_auth_token_revocation_queue ON apple_auth_private.credential_tokens(request_uid,state,created_at,token_id);
COMMENT ON COLUMN apple_auth_private.credential_tokens.revoke_completion_lease_hash IS
  'SHA-256 of the completing provider lease; retained only to authenticate exact terminal replay.';

ALTER TABLE apple_auth_private.account_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE apple_auth_private.registration_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE apple_auth_private.credential_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA apple_auth_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA apple_auth_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION apple_auth_private.require_service_role() RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Service role required'; END IF;
END; $$;
REVOKE ALL ON FUNCTION apple_auth_private.require_service_role() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION apple_auth_private.classify_deletion_settlement(p_user_id UUID,p_deletion_lifecycle_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_state apple_auth_private.account_state%ROWTYPE; v_token_count BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_deletion_lifecycle_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.account_deletion_requests d WHERE d.user_id=p_user_id AND d.deletion_lifecycle_id=p_deletion_lifecycle_id)
    THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id;

  IF EXISTS(SELECT 1 FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id
      AND ((a.status='reserved' AND a.lease_expires_at IS NULL) OR (a.status<>'reserved' AND a.lease_expires_at IS NOT NULL)))
    OR EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND (
      (t.state='revoke_in_flight' AND (t.revoke_attempt_id IS NULL OR t.revoke_lifecycle_id IS NULL OR t.revoke_lease_token IS NULL OR t.revoke_lease_expires_at IS NULL))
      OR (t.state<>'revoke_in_flight' AND (t.revoke_lease_token IS NOT NULL OR t.revoke_lease_expires_at IS NOT NULL))
      OR (t.state='revoked' AND (t.ciphertext_b64 IS NOT NULL OR t.nonce_b64 IS NOT NULL OR t.key_id IS NOT NULL OR t.crypto_version IS NOT NULL OR t.revoked_at IS NULL))
      OR (t.state<>'revoked' AND (t.ciphertext_b64 IS NULL OR t.nonce_b64 IS NULL OR t.key_id IS NULL OR t.crypto_version IS DISTINCT FROM 1 OR t.revoked_at IS NOT NULL))
      OR ((t.operator_evidence_reference IS NULL) IS DISTINCT FROM (t.operator_evidence_at IS NULL))
      OR (t.operator_evidence_reference IS NOT NULL AND (t.state<>'manual_required' OR t.last_error_code IS DISTINCT FROM 'KEY_IRRECOVERABLY_LOST' OR t.revoke_attempt_id IS NULL OR t.revoke_lifecycle_id IS NULL))
    )) THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;

  IF EXISTS(SELECT 1 FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.state='revoke_in_flight'
      AND t.revoke_lifecycle_id=p_deletion_lifecycle_id AND t.revoke_lease_expires_at>clock_timestamp())
    THEN RETURN jsonb_build_object('state','busy'); END IF;

  IF EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.ciphertext_b64 IS NOT NULL
    AND (t.state IN('quarantine','active','revoke_retryable') OR (t.state='revoke_in_flight'
      AND (t.revoke_lifecycle_id IS DISTINCT FROM p_deletion_lifecycle_id OR t.revoke_lease_expires_at<=clock_timestamp()))))
    THEN RETURN jsonb_build_object('state','retry_required'); END IF;

  IF EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.state='manual_required') OR COALESCE(v_state.exchange_uncertain,false) THEN
    RETURN jsonb_build_object('state','manual_required',
      'reason',CASE WHEN COALESCE(v_state.exchange_uncertain,false) THEN 'EXCHANGE_UNCERTAIN'
        WHEN EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.operator_evidence_reference IS NOT NULL) THEN 'KEY_IRRECOVERABLY_LOST'
        ELSE 'TOKEN_MANUAL_REQUIRED' END,
      'provenance',CASE WHEN COALESCE(v_state.exchange_uncertain,false) THEN 'runtime_admin_identity'
        WHEN EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.operator_evidence_reference IS NOT NULL) THEN 'operator_token_evidence'
        ELSE 'runtime_admin_identity' END);
  END IF;

  SELECT count(*) INTO v_token_count FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id
    AND t.state='revoked' AND t.revoke_lifecycle_id=p_deletion_lifecycle_id AND t.revoke_completion_lease_hash IS NOT NULL;
  IF v_token_count>0 THEN
    RETURN jsonb_build_object('state','revoked','reason','ALL_KNOWN_TOKENS_REVOKED','provenance','provider_http_200');
  END IF;

  IF v_state.deletion_outcome IS NOT NULL AND v_state.deletion_lifecycle_id=p_deletion_lifecycle_id THEN
    IF v_state.deletion_outcome='revoked' THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;
    IF v_state.deletion_provenance='runtime_admin_identity'
      AND ((v_state.deletion_outcome='not_required' AND v_state.deletion_reason='VERIFIED_NO_APPLE_PROVIDER')
        OR (v_state.deletion_outcome='manual_required' AND v_state.deletion_reason IN('APPLE_PROVIDER_WITHOUT_TOKEN','PROVIDER_IDENTITY_UNVERIFIED')))
      THEN RETURN jsonb_build_object('state',v_state.deletion_outcome,'reason',v_state.deletion_reason,'provenance',v_state.deletion_provenance,'origin_attempt_id',v_state.deletion_origin_attempt_id); END IF;
    IF v_state.deletion_provenance='operator_account_evidence' AND v_state.deletion_evidence_reference IS NOT NULL AND v_state.deletion_evidence_at IS NOT NULL
      AND ((v_state.deletion_outcome='not_required' AND v_state.deletion_reason='PRE091_NO_APPLE_PROVIDER')
        OR (v_state.deletion_outcome='manual_required' AND v_state.deletion_reason='PRE091_NO_TOKEN'))
      THEN RETURN jsonb_build_object('state',v_state.deletion_outcome,'reason',v_state.deletion_reason,'provenance',v_state.deletion_provenance,'origin_attempt_id',v_state.deletion_origin_attempt_id); END IF;
    RETURN jsonb_build_object('state','operator_review_required');
  END IF;
  RETURN jsonb_build_object('state','none');
END; $$;
REVOKE ALL ON FUNCTION apple_auth_private.classify_deletion_settlement(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.apple_auth_begin_registration(p_user_id UUID,p_verified_subject TEXT,p_attempt_id UUID,p_code_digest TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt apple_auth_private.registration_attempts%ROWTYPE; v_state apple_auth_private.account_state%ROWTYPE;
  v_claim UUID; v_token UUID; v_generation BIGINT; v_unresolved INTEGER; v_expired UUID;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_code_digest IS NULL OR p_code_digest !~ '^[0-9a-f]{64}$'
    OR p_verified_subject IS NULL OR length(p_verified_subject) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'Invalid Apple registration payload' USING ERRCODE='22004'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::TEXT,15013));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_code_digest,15091));
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests d WHERE d.user_id=p_user_id) THEN RETURN jsonb_build_object('state','deletion_pending'); END IF;
  INSERT INTO apple_auth_private.account_state(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;

  SELECT a.attempt_id INTO v_expired FROM apple_auth_private.registration_attempts a
    WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at<=clock_timestamp()
    ORDER BY a.updated_at,a.attempt_id LIMIT 1;
  UPDATE apple_auth_private.registration_attempts a SET status='exchange_uncertain',lease_expires_at=NULL,
    failure_code='EXCHANGE_LEASE_EXPIRED',updated_at=clock_timestamp()
    WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at<=clock_timestamp();
  IF v_expired IS NOT NULL THEN UPDATE apple_auth_private.account_state s SET exchange_uncertain=true,
    uncertainty_attempt_id=CASE WHEN s.exchange_uncertain THEN s.uncertainty_attempt_id ELSE v_expired END,
    uncertainty_reason=CASE WHEN s.exchange_uncertain THEN s.uncertainty_reason ELSE 'EXCHANGE_LEASE_EXPIRED' END,
    uncertainty_recorded_at=COALESCE(s.uncertainty_recorded_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE s.user_id=p_user_id; END IF;
  DELETE FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id
    AND a.status IN('rejected','exchange_uncertain','promoted') AND a.updated_at<clock_timestamp()-INTERVAL '10 minutes'
    AND NOT EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.registration_attempt_id=a.attempt_id);

  SELECT a.* INTO v_attempt FROM apple_auth_private.registration_attempts a WHERE a.attempt_id=p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_uid IS DISTINCT FROM p_user_id OR v_attempt.code_digest IS DISTINCT FROM p_code_digest THEN RETURN jsonb_build_object('state','replay'); END IF;
    IF v_attempt.status='promoted' THEN RETURN jsonb_build_object('state','completed','generation',v_attempt.generation,
      'unresolved_exchange',(SELECT s.exchange_uncertain FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id)); END IF;
    IF v_attempt.status='reserved' AND v_attempt.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('state','busy'); END IF;
    IF v_attempt.status IN('captured','promotion_prepared') THEN RETURN jsonb_build_object('state','captured'); END IF;
    RETURN jsonb_build_object('state','replay');
  END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.registration_attempts a WHERE a.code_digest=p_code_digest) THEN RETURN jsonb_build_object('state','replay'); END IF;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
  IF v_state.verified_subject IS NOT NULL AND v_state.verified_subject IS DISTINCT FROM p_verified_subject THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
  SELECT t.generation INTO v_generation FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id
    AND t.verified_subject=p_verified_subject AND t.aad_kind='verified' AND t.state='active' ORDER BY t.generation DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('state','covered','generation',v_generation,'unresolved_exchange',v_state.exchange_uncertain); END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('state','busy'); END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.created_at>clock_timestamp()-INTERVAL '2 seconds')
    OR (SELECT count(*) FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.created_at>clock_timestamp()-INTERVAL '5 minutes')>=5
    THEN RETURN jsonb_build_object('state','rate_limited'); END IF;
  SELECT (SELECT count(*) FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.aad_kind='quarantine' AND t.state<>'revoked' AND t.ciphertext_b64 IS NOT NULL)
    +(SELECT count(*) FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at>clock_timestamp()) INTO v_unresolved;
  IF v_unresolved>=8 THEN RETURN jsonb_build_object('state','capacity_limited'); END IF;
  v_claim:=gen_random_uuid(); v_token:=gen_random_uuid();
  INSERT INTO apple_auth_private.registration_attempts(attempt_id,request_uid,code_digest,claim_token,token_id,status,exchange_captured,has_usable_credential,lease_expires_at)
    VALUES(p_attempt_id,p_user_id,p_code_digest,v_claim,v_token,'reserved',false,false,clock_timestamp()+INTERVAL '30 seconds');
  RETURN jsonb_build_object('state','ready','claim_token',v_claim,'token_id',v_token);
END; $$;

CREATE FUNCTION public.apple_auth_capture_registration(p_user_id UUID,p_attempt_id UUID,p_claim_token UUID,p_token_id UUID,p_ciphertext_b64 TEXT,p_nonce_b64 TEXT,p_key_id TEXT,p_crypto_version SMALLINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt apple_auth_private.registration_attempts%ROWTYPE;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_claim_token IS NULL OR p_token_id IS NULL OR p_ciphertext_b64 IS NULL OR length(p_ciphertext_b64) NOT BETWEEN 24 AND 8192
    OR p_ciphertext_b64 !~ '^[A-Za-z0-9+/]+={0,2}$' OR p_nonce_b64 IS NULL OR p_nonce_b64 !~ '^[A-Za-z0-9+/]{16}$'
    OR p_key_id IS NULL OR p_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' OR p_crypto_version IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'Invalid Apple quarantine payload' USING ERRCODE='22004'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::TEXT,15013));
  SELECT a.* INTO v_attempt FROM apple_auth_private.registration_attempts a WHERE a.attempt_id=p_attempt_id AND a.request_uid=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.claim_token IS DISTINCT FROM p_claim_token OR v_attempt.token_id IS DISTINCT FROM p_token_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF v_attempt.status IN('captured','promotion_prepared','promoted') THEN
    IF EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.token_id=p_token_id AND t.request_uid=p_user_id AND t.registration_attempt_id=p_attempt_id)
      THEN RETURN jsonb_build_object('state','captured'); END IF; RETURN jsonb_build_object('state','stale');
  END IF;
  IF v_attempt.status<>'reserved' OR v_attempt.lease_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('state','stale'); END IF;
  INSERT INTO apple_auth_private.credential_tokens(token_id,registration_attempt_id,request_uid,verified_subject,generation,aad_kind,state,ciphertext_b64,nonce_b64,key_id,crypto_version)
    VALUES(p_token_id,p_attempt_id,p_user_id,NULL,NULL,'quarantine','quarantine',p_ciphertext_b64,p_nonce_b64,p_key_id,p_crypto_version);
  UPDATE apple_auth_private.registration_attempts SET status='captured',exchange_captured=true,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
  RETURN jsonb_build_object('state','captured');
END; $$;

CREATE FUNCTION public.apple_auth_prepare_registration_promotion(p_user_id UUID,p_attempt_id UUID,p_claim_token UUID,p_token_id UUID,p_verified_subject TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt apple_auth_private.registration_attempts%ROWTYPE; v_state apple_auth_private.account_state%ROWTYPE;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_claim_token IS NULL OR p_token_id IS NULL OR p_verified_subject IS NULL OR length(p_verified_subject) NOT BETWEEN 1 AND 255
    THEN RAISE EXCEPTION 'Invalid Apple promotion payload' USING ERRCODE='22004'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::TEXT,15013));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_subject,15092));
  SELECT a.* INTO v_attempt FROM apple_auth_private.registration_attempts a WHERE a.attempt_id=p_attempt_id AND a.request_uid=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.claim_token IS DISTINCT FROM p_claim_token OR v_attempt.token_id IS DISTINCT FROM p_token_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF v_attempt.status IN('promotion_prepared','promoted') THEN RETURN jsonb_build_object('state',CASE WHEN v_attempt.status='promoted' THEN 'completed' ELSE 'prepared' END,'generation',v_attempt.generation); END IF;
  IF v_attempt.status<>'captured' THEN RETURN jsonb_build_object('state','stale'); END IF;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
  IF v_state.verified_subject IS NOT NULL AND v_state.verified_subject IS DISTINCT FROM p_verified_subject THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.account_state s WHERE s.verified_subject=p_verified_subject AND s.user_id IS DISTINCT FROM p_user_id) THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
  IF EXISTS(SELECT 1 FROM public.account_deletion_requests d WHERE d.user_id=p_user_id) THEN RETURN jsonb_build_object('state','deletion_pending'); END IF;
  UPDATE apple_auth_private.registration_attempts SET status='promotion_prepared',generation=v_state.next_generation,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
  UPDATE apple_auth_private.account_state SET next_generation=next_generation+1,updated_at=clock_timestamp() WHERE user_id=p_user_id;
  RETURN jsonb_build_object('state','prepared','generation',v_state.next_generation);
END; $$;

CREATE FUNCTION public.apple_auth_promote_registration(p_user_id UUID,p_attempt_id UUID,p_claim_token UUID,p_token_id UUID,p_verified_subject TEXT,p_generation BIGINT,p_ciphertext_b64 TEXT,p_nonce_b64 TEXT,p_key_id TEXT,p_crypto_version SMALLINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt apple_auth_private.registration_attempts%ROWTYPE; v_state apple_auth_private.account_state%ROWTYPE; v_deleting BOOLEAN;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_claim_token IS NULL OR p_token_id IS NULL OR p_verified_subject IS NULL OR length(p_verified_subject) NOT BETWEEN 1 AND 255 OR p_generation IS NULL OR p_generation<=0
    OR p_ciphertext_b64 IS NULL OR length(p_ciphertext_b64) NOT BETWEEN 24 AND 8192 OR p_ciphertext_b64 !~ '^[A-Za-z0-9+/]+={0,2}$'
    OR p_nonce_b64 IS NULL OR p_nonce_b64 !~ '^[A-Za-z0-9+/]{16}$' OR p_key_id IS NULL OR p_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' OR p_crypto_version IS DISTINCT FROM 1
    THEN RAISE EXCEPTION 'Invalid Apple verified credential payload' USING ERRCODE='22004'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::TEXT,15013));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_subject,15092));
  SELECT a.* INTO v_attempt FROM apple_auth_private.registration_attempts a WHERE a.attempt_id=p_attempt_id AND a.request_uid=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.claim_token IS DISTINCT FROM p_claim_token OR v_attempt.token_id IS DISTINCT FROM p_token_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF v_attempt.status='promoted' THEN RETURN jsonb_build_object('state','completed','generation',v_attempt.generation); END IF;
  IF v_attempt.status<>'promotion_prepared' OR v_attempt.generation IS DISTINCT FROM p_generation THEN RETURN jsonb_build_object('state','stale'); END IF;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
  IF v_state.verified_subject IS NOT NULL AND v_state.verified_subject IS DISTINCT FROM p_verified_subject THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.account_state s WHERE s.verified_subject=p_verified_subject AND s.user_id IS DISTINCT FROM p_user_id) THEN RETURN jsonb_build_object('state','identity_conflict'); END IF;
  SELECT EXISTS(SELECT 1 FROM public.account_deletion_requests d WHERE d.user_id=p_user_id) INTO v_deleting;
  IF v_deleting THEN
    UPDATE apple_auth_private.credential_tokens SET verified_subject=p_verified_subject,generation=p_generation,aad_kind='verified',state='revoke_retryable',
      ciphertext_b64=p_ciphertext_b64,nonce_b64=p_nonce_b64,key_id=p_key_id,crypto_version=p_crypto_version,last_error_code=NULL,updated_at=clock_timestamp()
      WHERE token_id=p_token_id AND registration_attempt_id=p_attempt_id AND request_uid=p_user_id AND aad_kind='quarantine' AND state='quarantine';
    IF FOUND THEN
      UPDATE apple_auth_private.account_state SET verified_subject=COALESCE(verified_subject,p_verified_subject),updated_at=clock_timestamp() WHERE user_id=p_user_id;
      UPDATE apple_auth_private.registration_attempts SET status='promoted',failure_code=NULL,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
    END IF;
    RETURN jsonb_build_object('state','deletion_pending');
  END IF;
  UPDATE apple_auth_private.account_state SET verified_subject=COALESCE(verified_subject,p_verified_subject),
    deletion_lifecycle_id=NULL,deletion_outcome=NULL,deletion_reason=NULL,deletion_provenance=NULL,deletion_origin_attempt_id=NULL,
    deletion_replay_attempt_id=NULL,deletion_resolved_at=NULL,deletion_evidence_reference=NULL,deletion_evidence_at=NULL,
    updated_at=clock_timestamp() WHERE user_id=p_user_id;
  UPDATE apple_auth_private.credential_tokens SET verified_subject=p_verified_subject,generation=p_generation,aad_kind='verified',
    state='active',ciphertext_b64=p_ciphertext_b64,nonce_b64=p_nonce_b64,key_id=p_key_id,crypto_version=p_crypto_version,last_error_code=NULL,updated_at=clock_timestamp()
    WHERE token_id=p_token_id AND registration_attempt_id=p_attempt_id AND request_uid=p_user_id AND aad_kind='quarantine';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','stale'); END IF;
  UPDATE apple_auth_private.registration_attempts SET status='promoted',failure_code=NULL,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
  RETURN jsonb_build_object('state','registered','generation',p_generation,'unresolved_exchange',v_state.exchange_uncertain);
END; $$;

CREATE FUNCTION public.apple_auth_fail_registration(p_user_id UUID,p_attempt_id UUID,p_claim_token UUID,p_outcome TEXT,p_failure_code TEXT,p_token_outcome TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_attempt apple_auth_private.registration_attempts%ROWTYPE;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_claim_token IS NULL OR p_outcome NOT IN('rejected','uncertain')
    OR p_failure_code IS NULL OR p_failure_code !~ '^[A-Z0-9_]{1,64}$' OR (p_token_outcome IS NOT NULL AND p_token_outcome NOT IN('revoked','retryable'))
    THEN RAISE EXCEPTION 'Invalid Apple registration failure' USING ERRCODE='22004'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::TEXT,15013));
  SELECT a.* INTO v_attempt FROM apple_auth_private.registration_attempts a WHERE a.attempt_id=p_attempt_id AND a.request_uid=p_user_id AND a.claim_token=p_claim_token FOR UPDATE;
  IF NOT FOUND OR v_attempt.status='promoted' THEN RETURN false; END IF;
  UPDATE apple_auth_private.registration_attempts SET status=CASE WHEN p_outcome='uncertain' THEN 'exchange_uncertain' ELSE 'rejected' END,
    failure_code=p_failure_code,lease_expires_at=NULL,generation=NULL,updated_at=clock_timestamp() WHERE attempt_id=p_attempt_id;
  IF p_outcome='uncertain' THEN INSERT INTO apple_auth_private.account_state(user_id,exchange_uncertain,uncertainty_attempt_id,uncertainty_reason,uncertainty_recorded_at)
    VALUES(p_user_id,true,p_attempt_id,p_failure_code,clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET exchange_uncertain=true,
      uncertainty_attempt_id=CASE WHEN apple_auth_private.account_state.exchange_uncertain THEN apple_auth_private.account_state.uncertainty_attempt_id ELSE EXCLUDED.uncertainty_attempt_id END,
      uncertainty_reason=CASE WHEN apple_auth_private.account_state.exchange_uncertain THEN apple_auth_private.account_state.uncertainty_reason ELSE EXCLUDED.uncertainty_reason END,
      uncertainty_recorded_at=COALESCE(apple_auth_private.account_state.uncertainty_recorded_at,EXCLUDED.uncertainty_recorded_at),updated_at=clock_timestamp(); END IF;
  IF p_token_outcome='revoked' THEN UPDATE apple_auth_private.credential_tokens SET state='revoked',ciphertext_b64=NULL,nonce_b64=NULL,key_id=NULL,crypto_version=NULL,
    revoke_attempt_id=NULL,revoke_lifecycle_id=NULL,revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash=NULL,last_error_code=NULL,revoked_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE token_id=v_attempt.token_id AND request_uid=p_user_id;
  ELSIF p_token_outcome='retryable' THEN UPDATE apple_auth_private.credential_tokens SET state='revoke_retryable',revoke_attempt_id=NULL,revoke_lifecycle_id=NULL,
    revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash=NULL,last_error_code=p_failure_code,updated_at=clock_timestamp()
    WHERE token_id=v_attempt.token_id AND request_uid=p_user_id; END IF;
  RETURN true;
END; $$;

CREATE FUNCTION public.apple_auth_claim_deletion_revocation(p_user_id UUID,p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_phase TEXT; v_state apple_auth_private.account_state%ROWTYPE; v_token apple_auth_private.credential_tokens%ROWTYPE;
  v_lifecycle UUID; v_lease UUID; v_expired UUID; v_settlement JSONB;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL THEN RAISE EXCEPTION 'Invalid Apple revocation payload' USING ERRCODE='22004'; END IF;
  v_phase:=public.lock_account_deletion_attempt_v2(p_user_id,p_attempt_id);
  SELECT d.deletion_lifecycle_id INTO v_lifecycle FROM public.account_deletion_requests d
    WHERE d.user_id=p_user_id AND d.attempt_id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;
  INSERT INTO apple_auth_private.account_state(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
  IF v_phase='media_cleanup' THEN
    SELECT a.attempt_id INTO v_expired FROM apple_auth_private.registration_attempts a WHERE a.request_uid=p_user_id AND a.status='reserved' AND a.lease_expires_at<=clock_timestamp() ORDER BY a.updated_at LIMIT 1;
    UPDATE apple_auth_private.registration_attempts SET status='exchange_uncertain',lease_expires_at=NULL,failure_code='EXCHANGE_LEASE_EXPIRED',updated_at=clock_timestamp()
      WHERE request_uid=p_user_id AND status='reserved' AND lease_expires_at<=clock_timestamp();
    IF v_expired IS NOT NULL THEN UPDATE apple_auth_private.account_state SET exchange_uncertain=true,
      uncertainty_attempt_id=CASE WHEN exchange_uncertain THEN uncertainty_attempt_id ELSE v_expired END,
      uncertainty_reason=CASE WHEN exchange_uncertain THEN uncertainty_reason ELSE 'EXCHANGE_LEASE_EXPIRED' END,
      uncertainty_recorded_at=COALESCE(uncertainty_recorded_at,clock_timestamp()),updated_at=clock_timestamp() WHERE user_id=p_user_id; END IF;
  END IF;

  v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle)
    ||jsonb_build_object('deletion_lifecycle_id',v_lifecycle);
  IF v_phase IS DISTINCT FROM 'media_cleanup' THEN
    SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
    IF v_settlement->>'state' IN('revoked','not_required','manual_required')
      AND v_state.deletion_lifecycle_id=v_lifecycle AND v_state.deletion_outcome=v_settlement->>'state' AND v_state.deletion_reason=v_settlement->>'reason'
      AND v_state.deletion_provenance=v_settlement->>'provenance' AND v_state.deletion_origin_attempt_id IS NOT NULL THEN
      UPDATE apple_auth_private.account_state SET deletion_replay_attempt_id=p_attempt_id,updated_at=clock_timestamp() WHERE user_id=p_user_id;
      RETURN v_settlement||jsonb_build_object('origin_attempt_id',v_state.deletion_origin_attempt_id);
    END IF;
    RETURN jsonb_build_object('state','operator_review_required','deletion_lifecycle_id',v_lifecycle);
  END IF;
  IF v_settlement->>'state' IN('busy','operator_review_required','none') THEN RETURN v_settlement; END IF;
  IF v_settlement->>'state' IN('revoked','not_required','manual_required') THEN
    SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
    IF v_state.deletion_lifecycle_id=v_lifecycle AND v_state.deletion_outcome=v_settlement->>'state'
      AND v_state.deletion_reason=v_settlement->>'reason' AND v_state.deletion_provenance=v_settlement->>'provenance'
      AND v_state.deletion_origin_attempt_id IS NOT NULL THEN
      RETURN v_settlement||jsonb_build_object('origin_attempt_id',v_state.deletion_origin_attempt_id);
    END IF;
    UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=v_lifecycle,deletion_outcome=v_settlement->>'state',
      deletion_reason=v_settlement->>'reason',deletion_provenance=v_settlement->>'provenance',deletion_origin_attempt_id=p_attempt_id,
      deletion_replay_attempt_id=p_attempt_id,deletion_resolved_at=clock_timestamp(),deletion_evidence_reference=NULL,
      deletion_evidence_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id;
    RETURN v_settlement;
  END IF;
  IF v_settlement->>'state'<>'retry_required' THEN RETURN jsonb_build_object('state','operator_review_required','deletion_lifecycle_id',v_lifecycle); END IF;
  SELECT t.* INTO v_token FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.ciphertext_b64 IS NOT NULL
    AND (t.state IN('quarantine','active','revoke_retryable') OR (t.state='revoke_in_flight'
      AND (t.revoke_lifecycle_id IS DISTINCT FROM v_lifecycle OR t.revoke_lease_expires_at<=clock_timestamp())))
    ORDER BY t.created_at,t.token_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN v_lease:=gen_random_uuid(); UPDATE apple_auth_private.credential_tokens SET state='revoke_in_flight',revoke_attempt_id=p_attempt_id,
    revoke_lifecycle_id=v_lifecycle,revoke_lease_token=v_lease,revoke_lease_expires_at=clock_timestamp()+INTERVAL '30 seconds',
    revoke_completion_lease_hash=NULL,last_error_code=NULL,updated_at=clock_timestamp() WHERE token_id=v_token.token_id;
    RETURN jsonb_build_object('state','claimed','deletion_lifecycle_id',v_lifecycle,'token_id',v_token.token_id,'lease_token',v_lease,'aad_kind',v_token.aad_kind,
      'verified_subject',v_token.verified_subject,'generation',v_token.generation,'audience',v_token.audience,'registration_attempt_id',v_token.registration_attempt_id,
      'ciphertext_b64',v_token.ciphertext_b64,'nonce_b64',v_token.nonce_b64,'key_id',v_token.key_id,'crypto_version',v_token.crypto_version); END IF;
  RETURN jsonb_build_object('state','operator_review_required','deletion_lifecycle_id',v_lifecycle);
END; $$;

CREATE FUNCTION public.apple_auth_complete_deletion_revocation(p_user_id UUID,p_attempt_id UUID,p_deletion_lifecycle_id UUID,p_token_id UUID,p_lease_token UUID,p_outcome TEXT,p_error_code TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_phase TEXT; v_lifecycle UUID; v_token apple_auth_private.credential_tokens%ROWTYPE;
  v_state apple_auth_private.account_state%ROWTYPE; v_settlement JSONB; v_completion_lease_hash TEXT;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_deletion_lifecycle_id IS NULL OR p_token_id IS NULL OR p_lease_token IS NULL OR p_outcome NOT IN('revoked','retryable','configuration','manual_required')
    OR (p_outcome='revoked' AND p_error_code IS NOT NULL) OR (p_outcome<>'revoked' AND (p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$'))
    THEN RAISE EXCEPTION 'Invalid Apple revocation completion' USING ERRCODE='22004'; END IF;
  v_completion_lease_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_lease_token::TEXT),'UTF8')),'hex');
  v_phase:=public.lock_account_deletion_attempt_v2(p_user_id,p_attempt_id);
  SELECT d.deletion_lifecycle_id INTO v_lifecycle FROM public.account_deletion_requests d
    WHERE d.user_id=p_user_id AND d.attempt_id=p_attempt_id;
  IF NOT FOUND THEN
    IF v_phase IS DISTINCT FROM 'media_cleanup' THEN RAISE EXCEPTION 'illegal_account_deletion_phase' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('state','stale');
  END IF;
  IF v_lifecycle IS DISTINCT FROM p_deletion_lifecycle_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  SELECT t.* INTO v_token FROM apple_auth_private.credential_tokens t WHERE t.token_id=p_token_id AND t.request_uid=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    IF v_phase IS DISTINCT FROM 'media_cleanup' THEN RAISE EXCEPTION 'illegal_account_deletion_phase' USING ERRCODE='55000'; END IF;
    RETURN jsonb_build_object('state','stale');
  END IF;
  IF v_token.revoke_lifecycle_id IS DISTINCT FROM p_deletion_lifecycle_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF v_phase IS DISTINCT FROM 'media_cleanup' THEN RAISE EXCEPTION 'illegal_account_deletion_phase' USING ERRCODE='55000'; END IF;
  IF v_token.state='revoked' AND p_outcome='revoked' AND v_token.revoke_attempt_id=p_attempt_id
    AND v_token.revoke_lifecycle_id=p_deletion_lifecycle_id AND v_token.revoke_completion_lease_hash=v_completion_lease_hash THEN
    v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle);
    SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
    IF v_settlement->>'state' IN('revoked','manual_required') AND v_state.deletion_lifecycle_id=v_lifecycle
      AND v_state.deletion_outcome=v_settlement->>'state' AND v_state.deletion_reason=v_settlement->>'reason'
      AND v_state.deletion_provenance=v_settlement->>'provenance' AND v_state.deletion_origin_attempt_id=p_attempt_id
      THEN RETURN v_settlement||jsonb_build_object('duplicate',true,'all_settled',true,'terminal_state',v_settlement->>'state','terminal_reason',v_settlement->>'reason','terminal_provenance',v_settlement->>'provenance'); END IF;
    RETURN jsonb_build_object('state','stale');
  END IF;
  IF v_token.state<>'revoke_in_flight' OR v_token.revoke_attempt_id IS DISTINCT FROM p_attempt_id
    OR v_token.revoke_lifecycle_id IS DISTINCT FROM p_deletion_lifecycle_id OR v_token.revoke_lease_token IS DISTINCT FROM p_lease_token
    THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF p_outcome='revoked' THEN UPDATE apple_auth_private.credential_tokens SET state='revoked',ciphertext_b64=NULL,nonce_b64=NULL,key_id=NULL,crypto_version=NULL,revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash=v_completion_lease_hash,last_error_code=NULL,revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE token_id=p_token_id;
  ELSE UPDATE apple_auth_private.credential_tokens SET state=CASE WHEN p_outcome='manual_required' THEN 'manual_required' ELSE 'revoke_retryable' END,
    revoke_lease_token=NULL,revoke_lease_expires_at=NULL,revoke_completion_lease_hash=NULL,last_error_code=p_error_code,updated_at=clock_timestamp() WHERE token_id=p_token_id;
  END IF;
  v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle);
  IF p_outcome IN('retryable','configuration') THEN RETURN jsonb_build_object('state',p_outcome,'all_settled',false,'settlement_state',v_settlement->>'state'); END IF;
  IF v_settlement->>'state' IN('revoked','manual_required') THEN
    UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=v_lifecycle,deletion_outcome=v_settlement->>'state',deletion_reason=v_settlement->>'reason',deletion_provenance=v_settlement->>'provenance',
      deletion_origin_attempt_id=p_attempt_id,deletion_replay_attempt_id=p_attempt_id,deletion_resolved_at=clock_timestamp(),
      deletion_evidence_reference=NULL,deletion_evidence_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id;
    RETURN v_settlement||jsonb_build_object('duplicate',false,'all_settled',true,'terminal_state',v_settlement->>'state','terminal_reason',v_settlement->>'reason','terminal_provenance',v_settlement->>'provenance');
  END IF;
  IF v_settlement->>'state'='operator_review_required' THEN RETURN v_settlement||jsonb_build_object('all_settled',false); END IF;
  RETURN jsonb_build_object('state',CASE WHEN p_outcome='manual_required' THEN 'manual_required' ELSE 'revoked' END,'duplicate',false,'all_settled',false);
END; $$;

CREATE FUNCTION public.apple_auth_finalize_deletion_no_token(p_user_id UUID,p_attempt_id UUID,p_deletion_lifecycle_id UUID,p_outcome TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_phase TEXT; v_lifecycle UUID; v_state apple_auth_private.account_state%ROWTYPE; v_settlement JSONB;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_deletion_lifecycle_id IS NULL OR p_outcome NOT IN('not_required','manual_required') OR p_reason NOT IN('VERIFIED_NO_APPLE_PROVIDER','APPLE_PROVIDER_WITHOUT_TOKEN','PROVIDER_IDENTITY_UNVERIFIED')
    OR (p_outcome='not_required' AND p_reason<>'VERIFIED_NO_APPLE_PROVIDER') OR (p_outcome='manual_required' AND p_reason='VERIFIED_NO_APPLE_PROVIDER')
    THEN RAISE EXCEPTION 'Invalid Apple no-token resolution' USING ERRCODE='22004'; END IF;
  v_phase:=public.lock_account_deletion_attempt_v2(p_user_id,p_attempt_id);
  SELECT d.deletion_lifecycle_id INTO v_lifecycle FROM public.account_deletion_requests d
    WHERE d.user_id=p_user_id AND d.attempt_id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;
  IF v_lifecycle IS DISTINCT FROM p_deletion_lifecycle_id THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF v_phase IS DISTINCT FROM 'media_cleanup' THEN RETURN jsonb_build_object('state','operator_review_required'); END IF;
  INSERT INTO apple_auth_private.account_state(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
  v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle);
  IF v_settlement->>'state' IN('not_required','manual_required') THEN RETURN v_settlement; END IF;
  IF v_settlement->>'state'<>'none' THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF EXISTS(SELECT 1 FROM apple_auth_private.credential_tokens t WHERE t.request_uid=p_user_id AND t.state<>'revoked') OR v_state.exchange_uncertain THEN RETURN jsonb_build_object('state','stale'); END IF;
  IF p_outcome='not_required' AND v_state.verified_subject IS NOT NULL THEN RETURN jsonb_build_object('state','stale'); END IF;
  UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=v_lifecycle,deletion_outcome=p_outcome,deletion_reason=p_reason,deletion_provenance='runtime_admin_identity',
    deletion_origin_attempt_id=p_attempt_id,deletion_replay_attempt_id=p_attempt_id,deletion_resolved_at=clock_timestamp(),
    deletion_evidence_reference=NULL,deletion_evidence_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id;
  RETURN jsonb_build_object('state',p_outcome,'reason',p_reason,'provenance','runtime_admin_identity');
END; $$;

CREATE FUNCTION public.apple_auth_operator_resolve_deletion(p_user_id UUID,p_attempt_id UUID,p_token_id UUID,p_key_id TEXT,p_reason TEXT,p_evidence_reference TEXT,p_evidence_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_phase TEXT; v_lifecycle UUID; v_outcome TEXT; v_token apple_auth_private.credential_tokens%ROWTYPE;
  v_state apple_auth_private.account_state%ROWTYPE; v_settlement JSONB; v_exact_replay BOOLEAN:=false;
BEGIN
  PERFORM apple_auth_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_reason NOT IN('KEY_IRRECOVERABLY_LOST','PRE091_NO_TOKEN','PRE091_NO_APPLE_PROVIDER')
    OR p_evidence_reference IS NULL OR p_evidence_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$' OR p_evidence_at IS NULL OR p_evidence_at>clock_timestamp()+INTERVAL '5 minutes'
    THEN RAISE EXCEPTION 'Invalid Apple operator resolution' USING ERRCODE='22004'; END IF;
  v_phase:=public.lock_account_deletion_attempt_v2(p_user_id,p_attempt_id);
  SELECT d.deletion_lifecycle_id INTO v_lifecycle FROM public.account_deletion_requests d
    WHERE d.user_id=p_user_id AND d.attempt_id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','stale'); END IF;
  INSERT INTO apple_auth_private.account_state(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
  IF p_reason='KEY_IRRECOVERABLY_LOST' THEN
    IF p_token_id IS NULL OR p_key_id IS NULL THEN RETURN jsonb_build_object('state','stale'); END IF;
    SELECT t.* INTO v_token FROM apple_auth_private.credential_tokens t WHERE t.token_id=p_token_id AND t.request_uid=p_user_id FOR UPDATE;
    IF NOT FOUND OR v_token.key_id IS DISTINCT FROM p_key_id OR v_token.state='revoked' THEN RETURN jsonb_build_object('state','stale'); END IF;
    IF v_token.operator_evidence_reference IS NOT NULL OR v_token.operator_evidence_at IS NOT NULL OR (v_token.state='manual_required' AND v_token.last_error_code='KEY_IRRECOVERABLY_LOST') THEN
      IF v_token.state<>'manual_required' OR v_token.revoke_attempt_id IS DISTINCT FROM p_attempt_id
        OR v_token.revoke_lifecycle_id IS DISTINCT FROM v_lifecycle OR v_token.last_error_code IS DISTINCT FROM p_reason
        OR v_token.operator_evidence_reference IS DISTINCT FROM p_evidence_reference OR v_token.operator_evidence_at IS DISTINCT FROM p_evidence_at
        THEN RETURN jsonb_build_object('state','stale'); END IF;
      v_exact_replay:=true;
    ELSE
      IF v_token.revoke_attempt_id IS DISTINCT FROM p_attempt_id OR v_token.revoke_lifecycle_id IS DISTINCT FROM v_lifecycle
        OR v_token.state NOT IN('revoke_in_flight','revoke_retryable') THEN RETURN jsonb_build_object('state','stale'); END IF;
      UPDATE apple_auth_private.credential_tokens SET state='manual_required',revoke_lease_token=NULL,revoke_lease_expires_at=NULL,
        last_error_code=p_reason,operator_evidence_reference=p_evidence_reference,operator_evidence_at=p_evidence_at,updated_at=clock_timestamp() WHERE token_id=p_token_id;
    END IF;
    v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle);
    IF v_settlement->>'state'='manual_required' THEN
      IF v_exact_replay THEN
        SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
        IF v_state.deletion_lifecycle_id IS DISTINCT FROM v_lifecycle OR v_state.deletion_outcome IS DISTINCT FROM 'manual_required'
          OR v_state.deletion_reason IS DISTINCT FROM v_settlement->>'reason' OR v_state.deletion_provenance IS DISTINCT FROM v_settlement->>'provenance'
          OR v_state.deletion_origin_attempt_id IS NULL THEN RETURN jsonb_build_object('state','stale'); END IF;
      ELSE UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=v_lifecycle,deletion_outcome='manual_required',deletion_reason=v_settlement->>'reason',deletion_provenance=v_settlement->>'provenance',
          deletion_origin_attempt_id=p_attempt_id,deletion_replay_attempt_id=p_attempt_id,deletion_resolved_at=clock_timestamp(),
          deletion_evidence_reference=NULL,deletion_evidence_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id; END IF;
      RETURN v_settlement||jsonb_build_object('phase',v_phase);
    END IF;
    IF v_settlement->>'state'='retry_required' OR v_settlement->>'state'='busy' THEN RETURN jsonb_build_object('state','retry_required','reason','TOKENS_OUTSTANDING','phase',v_phase); END IF;
    RETURN jsonb_build_object('state','stale');
  ELSE
    IF p_token_id IS NOT NULL OR p_key_id IS NOT NULL THEN RETURN jsonb_build_object('state','stale'); END IF;
    SELECT s.* INTO v_state FROM apple_auth_private.account_state s WHERE s.user_id=p_user_id FOR UPDATE;
    IF v_state.deletion_outcome IS NOT NULL THEN
      IF v_state.deletion_lifecycle_id=v_lifecycle AND v_state.deletion_origin_attempt_id=p_attempt_id
        AND v_state.deletion_reason=p_reason AND v_state.deletion_provenance='operator_account_evidence'
        AND v_state.deletion_evidence_reference=p_evidence_reference AND v_state.deletion_evidence_at=p_evidence_at
        THEN RETURN jsonb_build_object('state',v_state.deletion_outcome,'reason',v_state.deletion_reason,'provenance',v_state.deletion_provenance,'phase',v_phase); END IF;
      RETURN jsonb_build_object('state','stale');
    END IF;
    v_settlement:=apple_auth_private.classify_deletion_settlement(p_user_id,v_lifecycle);
    IF v_settlement->>'state'<>'none' OR v_state.verified_subject IS NOT NULL OR v_state.exchange_uncertain THEN RETURN jsonb_build_object('state','stale'); END IF;
    v_outcome:=CASE WHEN p_reason='PRE091_NO_APPLE_PROVIDER' THEN 'not_required' ELSE 'manual_required' END;
    UPDATE apple_auth_private.account_state SET deletion_lifecycle_id=v_lifecycle,deletion_outcome=v_outcome,deletion_reason=p_reason,deletion_provenance='operator_account_evidence',deletion_origin_attempt_id=p_attempt_id,
      deletion_replay_attempt_id=p_attempt_id,deletion_resolved_at=clock_timestamp(),deletion_evidence_reference=p_evidence_reference,
      deletion_evidence_at=p_evidence_at,updated_at=clock_timestamp() WHERE user_id=p_user_id;
    RETURN jsonb_build_object('state',v_outcome,'reason',p_reason,'provenance','operator_account_evidence','phase',v_phase);
  END IF;
END; $$;

COMMENT ON TABLE apple_auth_private.account_state IS 'Verified UID/Apple-sub authority, sticky uncertainty and durable deletion outcome.';
COMMENT ON TABLE apple_auth_private.registration_attempts IS 'Digest-only reservations with exchange-captured provenance.';
COMMENT ON TABLE apple_auth_private.credential_tokens IS 'Every encrypted Apple refresh token including quarantine custody.';

REVOKE ALL ON FUNCTION public.apple_auth_begin_registration(UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_capture_registration(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,SMALLINT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_prepare_registration_promotion(UUID,UUID,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_promote_registration(UUID,UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,SMALLINT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_fail_registration(UUID,UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_claim_deletion_revocation(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_complete_deletion_revocation(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_finalize_deletion_no_token(UUID,UUID,UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apple_auth_operator_resolve_deletion(UUID,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_begin_registration(UUID,TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_capture_registration(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,SMALLINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_prepare_registration_promotion(UUID,UUID,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_promote_registration(UUID,UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,SMALLINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_fail_registration(UUID,UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_claim_deletion_revocation(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_complete_deletion_revocation(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_finalize_deletion_no_token(UUID,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apple_auth_operator_resolve_deletion(UUID,UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
