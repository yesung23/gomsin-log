-- 073_apple_iap_server_ledger.sql
--
-- Apple IAP server-authoritative ledger foundation.
--
-- Reviewed draft product identities are seeded for every StoreKit environment
-- with sale_enabled=false. An operator must still verify App Store Connect and
-- rights provenance before enabling any row.
-- Apple UInt64 identifiers are retained as canonical decimal TEXT: PostgreSQL
-- bigint is not wide enough for the full Apple identifier range.
--
-- Raw Apple JWS is never persisted. The Edge Functions verify JWS first and
-- pass only typed facts plus SHA-256 payload hashes to these RPCs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS iap_private;

-- The schema and its tables are not a PostgREST data surface. Definer RPCs
-- below are the only supported access path.
REVOKE ALL ON SCHEMA iap_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION iap_private.is_uint64_text(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_value !~ '^[1-9][0-9]{0,19}$' THEN
    RETURN FALSE;
  END IF;
  RETURN p_value::NUMERIC <= 18446744073709551615::NUMERIC;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

CREATE FUNCTION iap_private.is_sha256_hex(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT p_value ~ '^[0-9a-f]{64}$'
$$;

CREATE TABLE iap_private.apple_product_catalog (
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  product_key TEXT NOT NULL CHECK (product_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  product_type TEXT NOT NULL CHECK (product_type IN ('non_consumable', 'subscription', 'consumable')),
  bundle_id TEXT NOT NULL CHECK (length(trim(bundle_id)) BETWEEN 1 AND 200),
  entitlement_key TEXT,
  credit_amount BIGINT NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, product_id),
  UNIQUE (environment, product_key),
  CHECK (
    (product_type = 'consumable' AND entitlement_key IS NULL AND credit_amount > 0)
    OR
    (product_type IN ('non_consumable', 'subscription')
      AND entitlement_key IS NOT NULL
      AND entitlement_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
      AND credit_amount = 0)
  )
);

INSERT INTO iap_private.apple_product_catalog (
  environment, product_id, product_key, product_type, bundle_id,
  entitlement_key, credit_amount, sale_enabled
)
SELECT environment, product_id, product_key, product_type, 'app.gomsinlog',
  entitlement_key, credit_amount, FALSE
FROM (VALUES ('Xcode'), ('Sandbox'), ('Production')) AS environments(environment)
CROSS JOIN (VALUES
  ('app.gomsinlog.garden.accessory.starter.v1', 'garden.accessory.starter.v1', 'non_consumable', 'garden.accessory.starter.v1', 0::BIGINT),
  ('app.gomsinlog.garden.building.starter.v1', 'garden.building.starter.v1', 'non_consumable', 'garden.building.starter.v1', 0::BIGINT),
  ('app.gomsinlog.paper.season.spring.v1', 'paper.season.spring.v1', 'non_consumable', 'paper.season.spring.v1', 0::BIGINT),
  ('app.gomsinlog.book.export.credit.1', 'book.export.credit.1', 'consumable', NULL, 1::BIGINT),
  ('app.gomsinlog.plus.monthly', 'plus.monthly', 'subscription', 'plus', 0::BIGINT),
  ('app.gomsinlog.plus.annual', 'plus.annual', 'subscription', 'plus', 0::BIGINT)
) AS products(product_id, product_key, product_type, entitlement_key, credit_amount);

CREATE TABLE iap_private.apple_account_bindings (
  billing_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  app_account_token UUID,
  app_account_token_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(app_account_token_hash)),
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (app_account_token_hash),
  CHECK ((deleted_at IS NULL AND user_id IS NOT NULL AND app_account_token IS NOT NULL)
      OR (deleted_at IS NOT NULL AND user_id IS NULL AND app_account_token IS NULL))
);

CREATE TABLE iap_private.apple_transactions (
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(transaction_id)),
  original_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(original_transaction_id)),
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('non_consumable', 'subscription', 'consumable')),
  bundle_id TEXT NOT NULL,
  app_account_token_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(app_account_token_hash)),
  purchase_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revocation_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'refunded', 'revoked')),
  last_event_kind TEXT NOT NULL CHECK (last_event_kind IN ('purchase', 'refund', 'revoke', 'refund_reversed')),
  credit_granted BIGINT NOT NULL DEFAULT 0 CHECK (credit_granted >= 0),
  signed_at TIMESTAMPTZ NOT NULL,
  payload_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(payload_hash)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, transaction_id),
  CHECK (expires_at IS NULL OR expires_at >= purchase_at),
  CHECK (revocation_at IS NULL OR revocation_at >= purchase_at)
);

CREATE INDEX iap_transactions_original_lookup
  ON iap_private.apple_transactions (environment, original_transaction_id);
CREATE INDEX iap_transactions_entitlement_lookup
  ON iap_private.apple_transactions (environment, billing_account_id, product_id, signed_at DESC);

CREATE TABLE iap_private.apple_notifications (
  notification_uuid UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  notification_type TEXT NOT NULL CHECK (notification_type ~ '^[A-Za-z0-9._-]{1,64}$'),
  subtype TEXT CHECK (subtype IS NULL OR subtype ~ '^[A-Za-z0-9._-]{1,64}$'),
  transaction_id TEXT CHECK (transaction_id IS NULL OR iap_private.is_uint64_text(transaction_id)),
  original_transaction_id TEXT CHECK (original_transaction_id IS NULL OR iap_private.is_uint64_text(original_transaction_id)),
  signed_at TIMESTAMPTZ NOT NULL,
  payload_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(payload_hash)),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'stale', 'processed')),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'claimed' AND claim_token IS NOT NULL AND processed_at IS NULL)
      OR (status = 'stale' AND claim_token IS NULL AND processed_at IS NULL)
      OR (status = 'processed' AND claim_token IS NOT NULL AND processed_at IS NOT NULL))
);

CREATE INDEX iap_notifications_transaction_order
  ON iap_private.apple_notifications (environment, transaction_id, signed_at DESC)
  WHERE transaction_id IS NOT NULL;

CREATE TABLE iap_private.entitlements (
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  entitlement_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('non_consumable', 'subscription')),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  source_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(source_transaction_id)),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  last_signed_at TIMESTAMPTZ NOT NULL,
  last_payload_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(last_payload_hash)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (billing_account_id, environment, entitlement_key),
  CHECK (product_type = 'non_consumable' OR expires_at IS NOT NULL)
);

CREATE TABLE iap_private.export_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  transaction_id TEXT CHECK (transaction_id IS NULL OR iap_private.is_uint64_text(transaction_id)),
  reservation_id UUID,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN (
    'purchase_grant', 'refund_reclaim', 'refund_reversed_grant',
    'reserve', 'commit', 'release', 'account_deletion'
  )),
  amount BIGINT NOT NULL CHECK (amount >= 0 OR entry_kind IN ('refund_reclaim', 'reserve')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX iap_credit_transaction_event_once
  ON iap_private.export_credit_ledger (environment, transaction_id, entry_kind)
  WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX iap_credit_reservation_event_once
  ON iap_private.export_credit_ledger (reservation_id, entry_kind)
  WHERE reservation_id IS NOT NULL;

CREATE TABLE iap_private.export_credit_reservations (
  reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  idempotency_key UUID NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (billing_account_id, environment, idempotency_key)
);

CREATE INDEX iap_credit_reservations_open_lookup
  ON iap_private.export_credit_reservations (billing_account_id, environment, status)
  WHERE status = 'reserved';

-- No row policies are intentionally added. Even service_role has no direct
-- table grants; the owner-only definer RPCs are the sole data path.
ALTER TABLE iap_private.apple_product_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.apple_account_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.apple_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.apple_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.export_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.export_credit_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA iap_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION iap_private.require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
END;
$$;

CREATE FUNCTION iap_private.credit_balance(p_billing_account_id UUID, p_environment TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(amount), 0)::BIGINT
  FROM iap_private.export_credit_ledger
  WHERE billing_account_id = p_billing_account_id AND environment = p_environment
$$;

CREATE FUNCTION iap_private.open_reserved_credits(p_billing_account_id UUID, p_environment TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(amount), 0)::BIGINT
  FROM iap_private.export_credit_reservations
  WHERE billing_account_id = p_billing_account_id AND environment = p_environment AND status = 'reserved'
$$;

-- Authenticated client path: binds the StoreKit appAccountToken hash to this
-- account/environment and only returns a catalog row when sale is explicitly on.
CREATE FUNCTION public.iap_prepare_purchase(
  p_product_id TEXT,
  p_environment TEXT
)
RETURNS TABLE (
  account_token UUID,
  environment TEXT,
  product_id TEXT,
  product_type TEXT,
  sale_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_catalog iap_private.apple_product_catalog%ROWTYPE;
  v_hash TEXT;
  v_token UUID;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account is unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = v_uid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  IF p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'Invalid IAP purchase request';
  END IF;

  SELECT c.* INTO v_catalog
  FROM iap_private.apple_product_catalog AS c
  WHERE c.environment = p_environment
    AND c.product_id = p_product_id;
  IF NOT FOUND OR v_catalog.sale_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'IAP sale is disabled or product is unavailable';
  END IF;

  v_token := gen_random_uuid();
  v_hash := encode(digest(lower(v_token::TEXT), 'sha256'), 'hex');
  INSERT INTO iap_private.apple_account_bindings (
    user_id, app_account_token, app_account_token_hash
  ) VALUES (v_uid, v_token, v_hash)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT b.* INTO v_binding
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND OR v_binding.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'IAP account binding is unavailable';
  END IF;
  RETURN QUERY SELECT v_binding.app_account_token, p_environment, v_catalog.product_id,
    v_catalog.product_type, v_catalog.sale_enabled;
END;
$$;

-- Authenticated client state read. The result is one typed row per entitlement,
-- plus one null-entitlement row when the account has no non-consumable rights.
CREATE FUNCTION public.iap_get_state(p_environment TEXT)
RETURNS TABLE (
  entitlement_key TEXT,
  product_id TEXT,
  product_type TEXT,
  active BOOLEAN,
  expires_at TIMESTAMPTZ,
  export_credits BIGINT,
  reserved_export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_balance BIGINT;
  v_reserved BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS account WHERE account.id = v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account is unavailable';
  END IF;
  IF p_environment NOT IN ('Sandbox', 'Production', 'Xcode') THEN
    RAISE EXCEPTION 'Invalid IAP environment';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = v_uid
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT b.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, FALSE,
      NULL::TIMESTAMPTZ, 0::BIGINT, 0::BIGINT;
    RETURN;
  END IF;

  v_balance := GREATEST(iap_private.credit_balance(v_billing_account_id, p_environment), 0);
  v_reserved := iap_private.open_reserved_credits(v_billing_account_id, p_environment);

  RETURN QUERY
  SELECT e.entitlement_key, e.product_id, e.product_type,
    e.active AND (e.product_type <> 'subscription' OR (e.expires_at IS NOT NULL AND e.expires_at > now())),
    e.expires_at, v_balance, v_reserved
  FROM iap_private.entitlements AS e
  WHERE e.billing_account_id = v_billing_account_id AND e.environment = p_environment;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::TEXT, FALSE, NULL::TIMESTAMPTZ,
      v_balance, v_reserved;
  END IF;
END;
$$;

-- Service-role-only notification claim. Same UUID + same hash is idempotent;
-- same UUID + different hash is a hard conflict. Older notifications are kept
-- as stale evidence and are never allowed to claim processing ownership.
CREATE FUNCTION public.iap_claim_notification(
  p_notification_uuid UUID,
  p_environment TEXT,
  p_notification_type TEXT,
  p_subtype TEXT,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_signed_date_ms BIGINT,
  p_payload_hash TEXT
)
RETURNS TABLE (
  notification_uuid UUID,
  claim_token UUID,
  duplicate BOOLEAN,
  stale BOOLEAN,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing iap_private.apple_notifications%ROWTYPE;
  v_stale BOOLEAN := FALSE;
  v_claim UUID;
  v_signed_at TIMESTAMPTZ;
BEGIN
  PERFORM iap_private.require_service_role();
  IF current_setting('iap.atomic_notification', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Notification claim must use the atomic notification RPC';
  END IF;
  IF p_notification_uuid IS NULL
     OR p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR p_notification_type IS NULL
     OR p_signed_date_ms IS NULL OR p_signed_date_ms <= 0
     OR NOT iap_private.is_sha256_hex(p_payload_hash)
     OR (p_transaction_id IS NOT NULL AND NOT iap_private.is_uint64_text(p_transaction_id))
     OR (p_original_transaction_id IS NOT NULL AND NOT iap_private.is_uint64_text(p_original_transaction_id)) THEN
    RAISE EXCEPTION 'Invalid Apple notification claim';
  END IF;
  v_signed_at := to_timestamp(p_signed_date_ms / 1000.0);

  SELECT n.* INTO v_existing
  FROM iap_private.apple_notifications AS n
  WHERE n.notification_uuid = p_notification_uuid
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.environment IS DISTINCT FROM p_environment
       OR v_existing.signed_at IS DISTINCT FROM v_signed_at
       OR v_existing.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'Apple notification UUID payload conflict';
    END IF;
    RETURN QUERY SELECT p_notification_uuid, v_existing.claim_token, TRUE,
      v_existing.status = 'stale', v_existing.status;
    RETURN;
  END IF;

  IF p_transaction_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM iap_private.apple_notifications AS n
      WHERE n.environment = p_environment AND n.transaction_id = p_transaction_id
        AND n.signed_at = v_signed_at AND n.payload_hash IS DISTINCT FROM p_payload_hash
    ) THEN
      RAISE EXCEPTION 'Apple notification signedDate payload conflict';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM iap_private.apple_notifications AS n
      WHERE n.environment = p_environment AND n.transaction_id = p_transaction_id
        AND n.signed_at > v_signed_at
    ) INTO v_stale;
  END IF;

  IF v_stale THEN
    INSERT INTO iap_private.apple_notifications (
      notification_uuid, environment, notification_type, subtype,
      transaction_id, original_transaction_id, signed_at, payload_hash, status
    ) VALUES (
      p_notification_uuid, p_environment, p_notification_type, p_subtype,
      p_transaction_id, p_original_transaction_id, v_signed_at, p_payload_hash, 'stale'
    );
    RETURN QUERY SELECT p_notification_uuid, NULL::UUID, FALSE, TRUE, 'stale'::TEXT;
    RETURN;
  END IF;

  v_claim := gen_random_uuid();
  INSERT INTO iap_private.apple_notifications (
    notification_uuid, environment, notification_type, subtype,
    transaction_id, original_transaction_id, signed_at, payload_hash,
    status, claim_token, claimed_at
  ) VALUES (
    p_notification_uuid, p_environment, p_notification_type, p_subtype,
    p_transaction_id, p_original_transaction_id, v_signed_at, p_payload_hash,
    'claimed', v_claim, now()
  );
  RETURN QUERY SELECT p_notification_uuid, v_claim, FALSE, FALSE, 'claimed'::TEXT;
END;
$$;

-- Service-role-only verified transaction application. The caller supplies
-- facts extracted from a verified JWS, never the JWS itself. Existing rows are
-- monotonic by signed_at; equal timestamps require the same payload hash.
CREATE FUNCTION public.iap_apply_verified_transaction(
  p_user_id UUID,
  p_environment TEXT,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_product_id TEXT,
  p_bundle_id TEXT,
  p_app_account_token_hash TEXT,
  p_purchase_date_ms BIGINT,
  p_signed_date_ms BIGINT,
  p_expires_date_ms BIGINT,
  p_revocation_date_ms BIGINT,
  p_event_kind TEXT,
  p_payload_hash TEXT,
  p_notification_uuid UUID DEFAULT NULL,
  p_claim_token UUID DEFAULT NULL
)
RETURNS TABLE (
  accepted BOOLEAN,
  duplicate BOOLEAN,
  stale BOOLEAN,
  environment TEXT,
  transaction_id TEXT,
  entitlement_active BOOLEAN,
  export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_catalog iap_private.apple_product_catalog%ROWTYPE;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_existing iap_private.apple_transactions%ROWTYPE;
  v_entitlement_source iap_private.apple_transactions%ROWTYPE;
  v_signed_at TIMESTAMPTZ;
  v_purchase_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_revocation_at TIMESTAMPTZ;
  v_active BOOLEAN := FALSE;
  v_duplicate BOOLEAN := FALSE;
  v_stale BOOLEAN := FALSE;
  v_credit BIGINT := 0;
  v_reclaim BIGINT := 0;
  v_original_owner UUID;
  v_notification iap_private.apple_notifications%ROWTYPE;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_notification_uuid IS NOT NULL
     AND current_setting('iap.atomic_notification', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Notification transaction apply must use the atomic notification RPC';
  END IF;
  IF p_user_id IS NULL
     OR p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR p_transaction_id IS NULL
     OR p_original_transaction_id IS NULL
     OR NOT iap_private.is_uint64_text(p_transaction_id)
     OR NOT iap_private.is_uint64_text(p_original_transaction_id)
     OR p_product_id IS NULL OR p_bundle_id IS NULL
     OR NOT iap_private.is_sha256_hex(p_app_account_token_hash)
     OR p_purchase_date_ms IS NULL OR p_purchase_date_ms <= 0
     OR p_signed_date_ms IS NULL OR p_signed_date_ms <= 0
     OR p_expires_date_ms IS NOT NULL AND p_expires_date_ms <= 0
     OR p_revocation_date_ms IS NOT NULL AND p_revocation_date_ms <= 0
     OR p_event_kind NOT IN ('purchase', 'refund', 'revoke', 'refund_reversed')
     OR NOT iap_private.is_sha256_hex(p_payload_hash) THEN
    RAISE EXCEPTION 'Invalid verified Apple transaction';
  END IF;
  v_signed_at := to_timestamp(p_signed_date_ms / 1000.0);
  v_purchase_at := to_timestamp(p_purchase_date_ms / 1000.0);
  v_expires_at := CASE WHEN p_expires_date_ms IS NULL THEN NULL ELSE to_timestamp(p_expires_date_ms / 1000.0) END;
  v_revocation_at := CASE WHEN p_revocation_date_ms IS NULL THEN NULL ELSE to_timestamp(p_revocation_date_ms / 1000.0) END;

  SELECT c.* INTO v_catalog
  FROM iap_private.apple_product_catalog AS c
  WHERE c.environment = p_environment AND c.product_id = p_product_id AND c.bundle_id = p_bundle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple product is not in the reviewed catalog';
  END IF;
  IF v_catalog.product_type = 'subscription' AND p_event_kind = 'purchase' AND v_expires_at IS NULL THEN
    RAISE EXCEPTION 'Subscription transaction requires expiresDate';
  END IF;

  SELECT b.* INTO v_binding
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_binding.deleted_at IS NOT NULL
     OR v_binding.app_account_token_hash IS DISTINCT FROM p_app_account_token_hash THEN
    RAISE EXCEPTION 'Apple account binding mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_environment || ':' || p_original_transaction_id, 0)
  );

  SELECT tx.billing_account_id INTO v_original_owner
  FROM iap_private.apple_transactions AS tx
  WHERE tx.environment = p_environment AND tx.original_transaction_id = p_original_transaction_id
  ORDER BY tx.signed_at ASC LIMIT 1;
  IF v_original_owner IS NOT NULL AND v_original_owner IS DISTINCT FROM v_binding.billing_account_id THEN
    RAISE EXCEPTION 'Apple original transaction belongs to another account';
  END IF;

  IF p_notification_uuid IS NOT NULL THEN
    SELECT n.* INTO v_notification
    FROM iap_private.apple_notifications AS n
    WHERE n.notification_uuid = p_notification_uuid
    FOR UPDATE;
    IF NOT FOUND OR v_notification.environment IS DISTINCT FROM p_environment
       OR v_notification.claim_token IS DISTINCT FROM p_claim_token
       OR v_notification.status <> 'claimed' THEN
      RAISE EXCEPTION 'Notification claim is missing or invalid';
    END IF;
  END IF;

  SELECT tx.* INTO v_existing
  FROM iap_private.apple_transactions AS tx
  WHERE tx.environment = p_environment AND tx.transaction_id = p_transaction_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.billing_account_id IS DISTINCT FROM v_binding.billing_account_id
       OR v_existing.original_transaction_id IS DISTINCT FROM p_original_transaction_id
       OR v_existing.product_id IS DISTINCT FROM p_product_id
       OR v_existing.app_account_token_hash IS DISTINCT FROM p_app_account_token_hash THEN
      RAISE EXCEPTION 'Apple transaction identity conflict';
    END IF;
    IF v_signed_at < v_existing.signed_at THEN
      v_stale := TRUE;
    ELSIF v_signed_at = v_existing.signed_at THEN
      IF v_existing.payload_hash IS DISTINCT FROM p_payload_hash
         OR v_existing.last_event_kind IS DISTINCT FROM p_event_kind THEN
        RAISE EXCEPTION 'Apple transaction signedDate payload conflict';
      END IF;
      v_duplicate := TRUE;
    END IF;
  END IF;

  IF NOT v_stale AND NOT v_duplicate THEN
    IF NOT FOUND THEN
      IF p_event_kind = 'refund_reversed' THEN
        RAISE EXCEPTION 'Cannot reverse an unknown consumable transaction';
      END IF;
      v_credit := CASE WHEN p_event_kind = 'purchase' THEN v_catalog.credit_amount ELSE 0 END;
      INSERT INTO iap_private.apple_transactions (
        environment, transaction_id, original_transaction_id, billing_account_id,
        product_id, product_type, bundle_id, app_account_token_hash,
        purchase_at, expires_at, revocation_at, status, last_event_kind,
        credit_granted, signed_at, payload_hash
      ) VALUES (
        p_environment, p_transaction_id, p_original_transaction_id, v_binding.billing_account_id,
        p_product_id, v_catalog.product_type, p_bundle_id, p_app_account_token_hash,
        v_purchase_at, v_expires_at, v_revocation_at,
        CASE WHEN p_event_kind IN ('purchase', 'refund_reversed') THEN 'active' ELSE CASE WHEN p_event_kind = 'refund' THEN 'refunded' ELSE 'revoked' END END,
        p_event_kind, v_credit, v_signed_at, p_payload_hash
      );

      IF p_event_kind = 'purchase' AND v_catalog.product_type = 'consumable' THEN
        INSERT INTO iap_private.export_credit_ledger (
          billing_account_id, environment, transaction_id, entry_kind, amount
        ) VALUES (v_binding.billing_account_id, p_environment, p_transaction_id, 'purchase_grant', v_credit)
        ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      v_credit := v_existing.credit_granted;
      UPDATE iap_private.apple_transactions
      SET expires_at = COALESCE(v_expires_at, expires_at),
          revocation_at = CASE WHEN p_event_kind IN ('refund', 'revoke') THEN COALESCE(v_revocation_at, v_signed_at) ELSE NULL END,
          status = CASE WHEN p_event_kind IN ('purchase', 'refund_reversed') THEN 'active' WHEN p_event_kind = 'refund' THEN 'refunded' ELSE 'revoked' END,
          last_event_kind = p_event_kind,
          signed_at = v_signed_at,
          payload_hash = p_payload_hash,
          updated_at = now()
      WHERE iap_private.apple_transactions.environment = p_environment
        AND iap_private.apple_transactions.transaction_id = p_transaction_id;
    END IF;

    IF v_catalog.product_type = 'consumable' AND v_credit > 0 THEN
      IF p_event_kind IN ('refund', 'revoke') THEN
        v_reclaim := LEAST(
          v_credit,
          GREATEST(iap_private.credit_balance(v_binding.billing_account_id, p_environment), 0)
        );
        IF v_reclaim > 0 THEN
          INSERT INTO iap_private.export_credit_ledger (
            billing_account_id, environment, transaction_id, entry_kind, amount
          ) VALUES (v_binding.billing_account_id, p_environment, p_transaction_id, 'refund_reclaim', -v_reclaim)
          ON CONFLICT DO NOTHING;
        END IF;
      ELSIF p_event_kind = 'refund_reversed' THEN
        SELECT COALESCE(-l.amount, 0) INTO v_reclaim
        FROM iap_private.export_credit_ledger AS l
        WHERE l.environment = p_environment
          AND l.transaction_id = p_transaction_id
          AND l.entry_kind = 'refund_reclaim';
        IF v_reclaim > 0 THEN
          INSERT INTO iap_private.export_credit_ledger (
            billing_account_id, environment, transaction_id, entry_kind, amount
          ) VALUES (v_binding.billing_account_id, p_environment, p_transaction_id, 'refund_reversed_grant', v_reclaim)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_notification_uuid IS NOT NULL THEN
    IF v_stale THEN
      UPDATE iap_private.apple_notifications AS n
      SET status = 'stale', claim_token = NULL, claimed_at = NULL
      WHERE n.notification_uuid = p_notification_uuid;
    ELSE
      UPDATE iap_private.apple_notifications AS n
      SET status = 'processed', processed_at = now(), attempts = attempts + 1
      WHERE n.notification_uuid = p_notification_uuid;
    END IF;
  END IF;

  IF v_catalog.product_type IN ('non_consumable', 'subscription') AND NOT v_stale THEN
    SELECT tx.* INTO v_entitlement_source
    FROM iap_private.apple_transactions AS tx
    JOIN iap_private.apple_product_catalog AS cat
      ON cat.environment = tx.environment AND cat.product_id = tx.product_id
    WHERE tx.billing_account_id = v_binding.billing_account_id AND tx.environment = p_environment
      AND cat.entitlement_key = v_catalog.entitlement_key
      AND tx.last_event_kind IN ('purchase', 'refund_reversed')
      AND tx.revocation_at IS NULL
      AND (tx.product_type <> 'subscription' OR (tx.expires_at IS NOT NULL AND tx.expires_at > now()))
    ORDER BY tx.expires_at DESC NULLS FIRST, tx.signed_at DESC, tx.transaction_id DESC
    LIMIT 1;
    v_active := FOUND;

    INSERT INTO iap_private.entitlements (
      billing_account_id, environment, entitlement_key, product_id, product_type,
      active, source_transaction_id, starts_at, expires_at,
      last_signed_at, last_payload_hash
    ) VALUES (
      v_binding.billing_account_id, p_environment, v_catalog.entitlement_key,
      CASE WHEN v_active THEN v_entitlement_source.product_id ELSE p_product_id END,
      v_catalog.product_type, v_active,
      CASE WHEN v_active THEN v_entitlement_source.transaction_id ELSE p_transaction_id END,
      CASE WHEN v_active THEN v_entitlement_source.purchase_at ELSE v_purchase_at END,
      CASE WHEN v_active THEN v_entitlement_source.expires_at ELSE v_expires_at END,
      CASE WHEN v_active THEN v_entitlement_source.signed_at ELSE v_signed_at END,
      CASE WHEN v_active THEN v_entitlement_source.payload_hash ELSE p_payload_hash END
    )
    ON CONFLICT ON CONSTRAINT entitlements_pkey DO UPDATE
    SET active = EXCLUDED.active,
        product_id = EXCLUDED.product_id,
        product_type = EXCLUDED.product_type,
        source_transaction_id = EXCLUDED.source_transaction_id,
        starts_at = EXCLUDED.starts_at,
        expires_at = EXCLUDED.expires_at,
        last_signed_at = EXCLUDED.last_signed_at,
        last_payload_hash = EXCLUDED.last_payload_hash,
        updated_at = now();
  END IF;

  RETURN QUERY SELECT NOT v_stale, v_duplicate, v_stale, p_environment,
    p_transaction_id, v_active, GREATEST(iap_private.credit_balance(v_binding.billing_account_id, p_environment), 0);
END;
$$;

-- The Notifications V2 entry point. Claiming a notification and applying its
-- optional verified transaction are deliberately one transaction: any failure
-- rolls back both the claim and the transaction/entitlement/credit changes, so
-- Apple receives a retryable error instead of a partial success. The only
-- payloads accepted here are bounded verified claims and the two SHA-256
-- digests; raw JWS never crosses this database boundary.
CREATE FUNCTION public.iap_process_verified_notification(
  p_notification_uuid UUID,
  p_environment TEXT,
  p_notification_type TEXT,
  p_subtype TEXT,
  p_notification_transaction_id TEXT,
  p_notification_original_transaction_id TEXT,
  p_notification_signed_date_ms BIGINT,
  p_notification_payload_hash TEXT,
  p_transaction_id TEXT DEFAULT NULL,
  p_transaction_original_transaction_id TEXT DEFAULT NULL,
  p_product_id TEXT DEFAULT NULL,
  p_bundle_id TEXT DEFAULT NULL,
  p_app_account_token_hash TEXT DEFAULT NULL,
  p_purchase_date_ms BIGINT DEFAULT NULL,
  p_transaction_signed_date_ms BIGINT DEFAULT NULL,
  p_expires_date_ms BIGINT DEFAULT NULL,
  p_revocation_date_ms BIGINT DEFAULT NULL,
  p_event_kind TEXT DEFAULT NULL,
  p_transaction_payload_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  notification_uuid UUID,
  duplicate BOOLEAN,
  stale BOOLEAN,
  transaction_applied BOOLEAN,
  transaction_id TEXT,
  entitlement_active BOOLEAN,
  export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim RECORD;
  v_applied RECORD;
  v_has_transaction BOOLEAN;
  v_tx_billing_account_id UUID;
  v_tx_user_id UUID;
  v_tx_deleted_at TIMESTAMPTZ;
BEGIN
  PERFORM iap_private.require_service_role();
  PERFORM set_config('iap.atomic_notification', 'on', true);

  v_has_transaction := p_transaction_id IS NOT NULL
    OR p_transaction_original_transaction_id IS NOT NULL
    OR p_product_id IS NOT NULL
    OR p_bundle_id IS NOT NULL
    OR p_app_account_token_hash IS NOT NULL
    OR p_purchase_date_ms IS NOT NULL
    OR p_transaction_signed_date_ms IS NOT NULL
    OR p_expires_date_ms IS NOT NULL
    OR p_revocation_date_ms IS NOT NULL
    OR p_event_kind IS NOT NULL
    OR p_transaction_payload_hash IS NOT NULL;

  IF v_has_transaction AND (
    p_transaction_id IS NULL
    OR p_transaction_original_transaction_id IS NULL
    OR p_product_id IS NULL
    OR p_bundle_id IS NULL
    OR p_app_account_token_hash IS NULL
    OR p_purchase_date_ms IS NULL
    OR p_transaction_signed_date_ms IS NULL
    OR p_event_kind IS NULL
    OR p_transaction_payload_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Optional verified transaction claims are incomplete';
  END IF;
  IF v_has_transaction
     AND p_notification_transaction_id IS NOT NULL
     AND p_notification_transaction_id IS DISTINCT FROM p_transaction_id THEN
    RAISE EXCEPTION 'Notification and transaction identity mismatch';
  END IF;
  IF v_has_transaction
     AND p_notification_original_transaction_id IS NOT NULL
     AND p_notification_original_transaction_id IS DISTINCT FROM p_transaction_original_transaction_id THEN
    RAISE EXCEPTION 'Notification and original transaction identity mismatch';
  END IF;

  SELECT * INTO v_claim
  FROM public.iap_claim_notification(
    p_notification_uuid,
    p_environment,
    p_notification_type,
    p_subtype,
    p_notification_transaction_id,
    p_notification_original_transaction_id,
    p_notification_signed_date_ms,
    p_notification_payload_hash
  );

  IF v_claim.status = 'stale' THEN
    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, TRUE, FALSE,
      p_transaction_id, FALSE, NULL::BIGINT;
    RETURN;
  END IF;

  -- A previously processed UUID is already complete. Replaying it must not
  -- require a second transaction claim or produce another credit grant.
  IF v_claim.status = 'processed' THEN
    RETURN QUERY SELECT p_notification_uuid, TRUE, FALSE, FALSE,
      p_transaction_id, FALSE, NULL::BIGINT;
    RETURN;
  END IF;

  IF v_has_transaction THEN
    SELECT b.billing_account_id, b.user_id, b.deleted_at
    INTO v_tx_billing_account_id, v_tx_user_id, v_tx_deleted_at
    FROM iap_private.apple_account_bindings AS b
    WHERE b.app_account_token_hash = p_app_account_token_hash;
    IF NOT FOUND OR v_tx_user_id IS NULL OR v_tx_deleted_at IS NOT NULL THEN
      UPDATE iap_private.apple_notifications AS n
      SET status = 'processed', processed_at = now(), attempts = attempts + 1
      WHERE n.notification_uuid = p_notification_uuid;
      RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
        p_transaction_id, FALSE, NULL::BIGINT;
      RETURN;
    END IF;

    SELECT * INTO v_applied
    FROM public.iap_apply_verified_transaction(
      v_tx_user_id,
      p_environment,
      p_transaction_id,
      p_transaction_original_transaction_id,
      p_product_id,
      p_bundle_id,
      p_app_account_token_hash,
      p_purchase_date_ms,
      p_transaction_signed_date_ms,
      p_expires_date_ms,
      p_revocation_date_ms,
      p_event_kind,
      p_transaction_payload_hash,
      p_notification_uuid,
      v_claim.claim_token
    );

    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate,
      v_applied.stale, NOT v_applied.stale, p_transaction_id,
      v_applied.entitlement_active, v_applied.export_credits;
    RETURN;
  END IF;

  UPDATE iap_private.apple_notifications AS n
  SET status = 'processed', processed_at = now(), attempts = attempts + 1
  WHERE n.notification_uuid = p_notification_uuid;
  RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
    NULL::TEXT, FALSE, NULL::BIGINT;
END;
$$;

CREATE FUNCTION public.iap_export_credit_reserve(
  p_environment TEXT,
  p_amount BIGINT,
  p_idempotency_key UUID
)
RETURNS TABLE (
  reservation_id UUID,
  status TEXT,
  duplicate BOOLEAN,
  export_credits BIGINT,
  reserved_export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_reservation iap_private.export_credit_reservations%ROWTYPE;
  v_balance BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated'; END IF;
  IF p_environment NOT IN ('Sandbox', 'Production', 'Xcode') OR p_amount IS NULL OR p_amount <= 0 OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Invalid export credit reservation';
  END IF;
  SELECT b.* INTO v_binding FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_binding.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'IAP account binding is unavailable'; END IF;
  v_billing_account_id := v_binding.billing_account_id;

  SELECT r.* INTO v_reservation FROM iap_private.export_credit_reservations AS r
  WHERE r.billing_account_id = v_billing_account_id AND r.environment = p_environment AND r.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_reservation.reservation_id, v_reservation.status, TRUE,
      GREATEST(iap_private.credit_balance(v_billing_account_id, p_environment), 0),
      iap_private.open_reserved_credits(v_billing_account_id, p_environment);
    RETURN;
  END IF;

  v_balance := iap_private.credit_balance(v_billing_account_id, p_environment);
  IF v_balance < p_amount THEN RAISE EXCEPTION 'Insufficient export credits'; END IF;
  INSERT INTO iap_private.export_credit_reservations (
    billing_account_id, environment, idempotency_key, amount, status
  ) VALUES (v_billing_account_id, p_environment, p_idempotency_key, p_amount, 'reserved')
  RETURNING * INTO v_reservation;
  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (v_billing_account_id, p_environment, v_reservation.reservation_id, 'reserve', -p_amount);
  RETURN QUERY SELECT v_reservation.reservation_id, 'reserved'::TEXT, FALSE,
    GREATEST(iap_private.credit_balance(v_billing_account_id, p_environment), 0),
    iap_private.open_reserved_credits(v_billing_account_id, p_environment);
END;
$$;

CREATE FUNCTION public.iap_export_credit_commit(p_reservation_id UUID)
RETURNS TABLE (
  reservation_id UUID,
  status TEXT,
  duplicate BOOLEAN,
  export_credits BIGINT,
  reserved_export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_reservation iap_private.export_credit_reservations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated'; END IF;
  SELECT b.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = v_uid AND b.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IAP account binding is unavailable'; END IF;
  SELECT r.* INTO v_reservation FROM iap_private.export_credit_reservations AS r
  WHERE r.reservation_id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.billing_account_id IS DISTINCT FROM v_billing_account_id THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Reservation is not owned by this account'; END IF;
  IF v_reservation.status = 'released' THEN RAISE EXCEPTION 'Released export reservation cannot be committed'; END IF;
  IF v_reservation.status = 'committed' THEN
    RETURN QUERY SELECT v_reservation.reservation_id, 'committed'::TEXT, TRUE,
      GREATEST(iap_private.credit_balance(v_billing_account_id, v_reservation.environment), 0),
      iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
    RETURN;
  END IF;
  UPDATE iap_private.export_credit_reservations AS r SET status = 'committed', updated_at = now()
  WHERE r.reservation_id = v_reservation.reservation_id;
  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (v_billing_account_id, v_reservation.environment, v_reservation.reservation_id, 'commit', 0)
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT v_reservation.reservation_id, 'committed'::TEXT, FALSE,
    GREATEST(iap_private.credit_balance(v_billing_account_id, v_reservation.environment), 0),
    iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
END;
$$;

CREATE FUNCTION public.iap_export_credit_release(p_reservation_id UUID)
RETURNS TABLE (
  reservation_id UUID,
  status TEXT,
  duplicate BOOLEAN,
  export_credits BIGINT,
  reserved_export_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_reservation iap_private.export_credit_reservations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated'; END IF;
  SELECT b.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = v_uid AND b.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IAP account binding is unavailable'; END IF;
  SELECT r.* INTO v_reservation FROM iap_private.export_credit_reservations AS r
  WHERE r.reservation_id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.billing_account_id IS DISTINCT FROM v_billing_account_id THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Reservation is not owned by this account'; END IF;
  IF v_reservation.status = 'committed' THEN RAISE EXCEPTION 'Committed export reservation cannot be released'; END IF;
  IF v_reservation.status = 'released' THEN
    RETURN QUERY SELECT v_reservation.reservation_id, 'released'::TEXT, TRUE,
      GREATEST(iap_private.credit_balance(v_billing_account_id, v_reservation.environment), 0),
      iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
    RETURN;
  END IF;
  UPDATE iap_private.export_credit_reservations AS r SET status = 'released', updated_at = now()
  WHERE r.reservation_id = v_reservation.reservation_id;
  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (v_billing_account_id, v_reservation.environment, v_reservation.reservation_id, 'release', v_reservation.amount)
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT v_reservation.reservation_id, 'released'::TEXT, FALSE,
    GREATEST(iap_private.credit_balance(v_billing_account_id, v_reservation.environment), 0),
    iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
END;
$$;

-- Service-role-only, idempotent account-deletion preparation. It revokes
-- current access and releases reservations without deleting immutable
-- transaction/notification/credit evidence. The Auth user reference, raw
-- appAccountToken, and active entitlement access are tombstoned; no retained
-- IAP row stores the raw auth user id.
CREATE FUNCTION public.iap_prepare_account_deletion(p_user_id UUID)
RETURNS TABLE (
  prepared BOOLEAN,
  entitlements_revoked BIGINT,
  reservations_released BIGINT,
  transactions_retained BIGINT,
  notifications_retained BIGINT,
  credit_entries_retained BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_billing_account_id UUID;
  v_entitlements BIGINT := 0;
  v_reservations BIGINT := 0;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Invalid account deletion user'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests AS deletion
    WHERE deletion.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Account deletion marker is missing';
  END IF;

  SELECT b.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS b
  WHERE b.user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE iap_private.apple_account_bindings AS b
    SET user_id = NULL, app_account_token = NULL, deleted_at = COALESCE(b.deleted_at, now())
    WHERE b.billing_account_id = v_billing_account_id AND b.user_id = p_user_id;

    UPDATE iap_private.entitlements AS e SET active = FALSE, updated_at = now()
    WHERE e.billing_account_id = v_billing_account_id AND e.active IS TRUE;
    GET DIAGNOSTICS v_entitlements = ROW_COUNT;

    UPDATE iap_private.export_credit_reservations AS r SET status = 'released', updated_at = now()
    WHERE r.billing_account_id = v_billing_account_id AND r.status = 'reserved';
    GET DIAGNOSTICS v_reservations = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT TRUE,
    v_entitlements, v_reservations,
    (SELECT count(*) FROM iap_private.apple_transactions AS tx WHERE tx.billing_account_id = v_billing_account_id),
    (SELECT count(*) FROM iap_private.apple_notifications AS n
      WHERE EXISTS (SELECT 1 FROM iap_private.apple_transactions AS t
        WHERE t.billing_account_id = v_billing_account_id AND t.environment = n.environment
          AND t.transaction_id = n.transaction_id)),
    (SELECT count(*) FROM iap_private.export_credit_ledger AS l WHERE l.billing_account_id = v_billing_account_id);
END;
$$;

-- Reconciliation may only enumerate live accounts. Tombstoned bindings keep
-- their billing_account_id and historical Apple rows for audit/refund evidence,
-- but have no user_id to which a new entitlement or credit could be assigned;
-- they are therefore intentionally excluded and handled as a separate manual /
-- retention policy, never as an automatic re-grant target. Xcode is local-only
-- and is excluded from the Apple Server API target set.
CREATE FUNCTION public.iap_list_reconciliation_targets()
RETURNS TABLE (
  user_id UUID,
  environment TEXT,
  original_transaction_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM iap_private.require_service_role();
  RETURN QUERY
  SELECT DISTINCT b.user_id, tx.environment, tx.original_transaction_id
  FROM iap_private.apple_account_bindings AS b
  JOIN iap_private.apple_transactions AS tx
    ON tx.billing_account_id = b.billing_account_id
  WHERE b.user_id IS NOT NULL
    AND tx.environment IN ('Sandbox', 'Production')
  ORDER BY b.user_id, tx.environment, tx.original_transaction_id;
END;
$$;

-- Public schema RPC grants are deliberately narrow. Revoke the default
-- PUBLIC execute privilege before granting only the intended role.
REVOKE ALL ON FUNCTION public.iap_prepare_purchase(TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_prepare_purchase(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.iap_get_state(TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_get_state(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.iap_claim_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_claim_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.iap_apply_verified_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_apply_verified_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.iap_process_verified_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_process_verified_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.iap_export_credit_reserve(TEXT, BIGINT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_reserve(TEXT, BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.iap_export_credit_commit(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_commit(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.iap_export_credit_release(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_release(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.iap_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_prepare_account_deletion(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.iap_list_reconciliation_targets() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_list_reconciliation_targets() TO service_role;

REVOKE ALL ON FUNCTION iap_private.is_uint64_text(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.is_sha256_hex(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.require_service_role() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.credit_balance(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.open_reserved_credits(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
