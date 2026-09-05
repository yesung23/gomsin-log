-- 079_apple_iap_refund_consumption.sql
--
-- Additive Apple refund-consumption evidence foundation.
--
-- This migration does not enable a product, deploy an Edge Function, or grant
-- permission to send information to Apple. It makes post-079 purchases exactly
-- attributable while quarantining the pooled 077 ledger as manual-review-only.
-- Raw JWS and user content are intentionally absent from every new table.

BEGIN;

ALTER TABLE iap_private.apple_product_catalog
  ADD COLUMN sample_content_provided BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE iap_private.apple_product_catalog
SET sale_enabled = FALSE, updated_at = clock_timestamp()
WHERE sale_enabled;

ALTER TABLE iap_private.apple_product_catalog
  ADD CONSTRAINT apple_product_catalog_sale_hold
  CHECK (sale_enabled = FALSE) NOT VALID;
ALTER TABLE iap_private.apple_product_catalog
  VALIDATE CONSTRAINT apple_product_catalog_sale_hold;

ALTER TABLE iap_private.apple_transactions
  ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10),
  ADD COLUMN revocation_type TEXT CHECK (
    revocation_type IS NULL OR revocation_type IN ('REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE')
  ),
  ADD COLUMN revocation_percentage INTEGER CHECK (
    revocation_percentage IS NULL OR revocation_percentage BETWEEN 0 AND 100000
  ),
  ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'legacy_manual_review' CHECK (
    resolution_status IN ('automatic', 'manual_review', 'legacy_manual_review')
  );

CREATE UNIQUE INDEX iap_transactions_account_identity
  ON iap_private.apple_transactions (billing_account_id, environment, transaction_id);

CREATE FUNCTION iap_private.sha256_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE TABLE iap_private.apple_transaction_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(transaction_id)),
  original_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(original_transaction_id)),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('purchase', 'refund', 'revoke', 'refund_reversed')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  revocation_type TEXT CHECK (
    revocation_type IS NULL OR revocation_type IN ('REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE')
  ),
  revocation_percentage INTEGER CHECK (
    revocation_percentage IS NULL OR revocation_percentage BETWEEN 0 AND 100000
  ),
  signed_at TIMESTAMPTZ NOT NULL,
  payload_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(payload_hash)),
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('automatic', 'manual_review', 'stale')),
  notification_uuid UUID REFERENCES iap_private.apple_notifications(notification_uuid),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (environment, transaction_id, signed_at),
  FOREIGN KEY (billing_account_id, environment, transaction_id)
    REFERENCES iap_private.apple_transactions(billing_account_id, environment, transaction_id)
);

CREATE INDEX iap_transaction_events_latest
  ON iap_private.apple_transaction_events (environment, transaction_id, signed_at DESC);

CREATE TABLE iap_private.apple_transaction_review_facts (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_uuid UUID NOT NULL UNIQUE
    REFERENCES iap_private.apple_notifications(notification_uuid),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(transaction_id)),
  original_transaction_id TEXT NOT NULL
    CHECK (iap_private.is_uint64_text(original_transaction_id)),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  product_type TEXT NOT NULL CHECK (product_type IN (
    'Non-Consumable', 'Consumable', 'Auto-Renewable Subscription'
  )),
  bundle_id TEXT NOT NULL CHECK (bundle_id ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$'),
  event_kind TEXT NOT NULL CHECK (event_kind IN ('refund', 'revoke', 'refund_reversed')),
  transaction_signed_at TIMESTAMPTZ NOT NULL,
  transaction_payload_hash TEXT NOT NULL CHECK (
    iap_private.is_sha256_hex(transaction_payload_hash)
  ),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'IDENTITY_UNRESOLVED', 'IDENTITY_AMBIGUOUS', 'ACCOUNT_DELETED'
  )),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'acknowledged')
  ),
  resolution_code TEXT CHECK (resolution_code IS NULL OR resolution_code IN (
    'NO_AUTOMATIC_ACTION', 'APPLE_RECONCILIATION_REQUIRED'
  )),
  reviewed_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((review_status = 'pending') =
    (resolution_code IS NULL AND reviewed_at IS NULL))
);

CREATE TABLE iap_private.export_credit_lots (
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  source_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(source_transaction_id)),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  gross_milliunits BIGINT NOT NULL CHECK (gross_milliunits >= 0),
  refund_target_milliunits BIGINT NOT NULL DEFAULT 0 CHECK (refund_target_milliunits >= 0),
  reclaimed_milliunits BIGINT NOT NULL DEFAULT 0 CHECK (reclaimed_milliunits >= 0),
  attribution_status TEXT NOT NULL CHECK (attribution_status IN ('exact', 'legacy_manual_review', 'manual_review')),
  purchased_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, source_transaction_id),
  UNIQUE (billing_account_id, environment, source_transaction_id),
  FOREIGN KEY (billing_account_id, environment, source_transaction_id)
    REFERENCES iap_private.apple_transactions(billing_account_id, environment, transaction_id),
  CHECK (refund_target_milliunits <= gross_milliunits),
  CHECK (reclaimed_milliunits <= gross_milliunits),
  CHECK (attribution_status <> 'exact' OR gross_milliunits > 0)
);

CREATE INDEX iap_export_credit_lots_fifo
  ON iap_private.export_credit_lots (
    billing_account_id, environment, attribution_status, purchased_at, source_transaction_id
  );

ALTER TABLE iap_private.export_credit_reservations
  ADD CONSTRAINT iap_export_reservations_account_identity
  UNIQUE (reservation_id, billing_account_id, environment);

CREATE TABLE iap_private.export_credit_allocations (
  allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL,
  billing_account_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  source_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(source_transaction_id)),
  milliunits BIGINT NOT NULL CHECK (milliunits > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (reservation_id, source_transaction_id),
  FOREIGN KEY (reservation_id, billing_account_id, environment)
    REFERENCES iap_private.export_credit_reservations(reservation_id, billing_account_id, environment),
  FOREIGN KEY (billing_account_id, environment, source_transaction_id)
    REFERENCES iap_private.export_credit_lots(billing_account_id, environment, source_transaction_id)
);

CREATE INDEX iap_export_credit_allocations_lot_state
  ON iap_private.export_credit_allocations (
    billing_account_id, environment, source_transaction_id, status
  );

CREATE TABLE iap_private.export_credit_lot_adjustments (
  adjustment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES iap_private.apple_transaction_events(event_id),
  billing_account_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  source_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(source_transaction_id)),
  reclaimed_before_milliunits BIGINT NOT NULL CHECK (reclaimed_before_milliunits >= 0),
  reclaimed_after_milliunits BIGINT NOT NULL CHECK (reclaimed_after_milliunits >= 0),
  delta_milliunits BIGINT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (billing_account_id, environment, source_transaction_id)
    REFERENCES iap_private.export_credit_lots(billing_account_id, environment, source_transaction_id),
  CHECK (delta_milliunits = reclaimed_after_milliunits - reclaimed_before_milliunits)
);

CREATE TABLE iap_private.refund_data_consent_notices (
  notice_version TEXT PRIMARY KEY CHECK (notice_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  notice_sha256 TEXT NOT NULL CHECK (iap_private.is_sha256_hex(notice_sha256)),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (notice_version, notice_sha256)
);

CREATE UNIQUE INDEX iap_one_active_refund_consent_notice
  ON iap_private.refund_data_consent_notices ((active)) WHERE active;

CREATE TABLE iap_private.refund_data_consent_events (
  consent_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id UUID NOT NULL REFERENCES iap_private.apple_account_bindings(billing_account_id),
  decision TEXT NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  notice_version TEXT NOT NULL,
  notice_sha256 TEXT NOT NULL CHECK (iap_private.is_sha256_hex(notice_sha256)),
  idempotency_key UUID NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (billing_account_id, idempotency_key),
  FOREIGN KEY (notice_version, notice_sha256)
    REFERENCES iap_private.refund_data_consent_notices(notice_version, notice_sha256)
);

CREATE INDEX iap_refund_consent_latest
  ON iap_private.refund_data_consent_events (
    billing_account_id, decided_at DESC, consent_event_id DESC
  );

CREATE TABLE iap_private.fulfillment_usage_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  source_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(source_transaction_id)),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'delivery_confirmed', 'export_reserved',
    'export_committed', 'export_released', 'refund_reclaimed', 'refund_reversed'
  )),
  units_milliunits BIGINT NOT NULL CHECK (units_milliunits >= 0),
  delivery_status TEXT CHECK (delivery_status IS NULL OR delivery_status IN (
    'DELIVERED', 'UNDELIVERED_QUALITY_ISSUE', 'UNDELIVERED_WRONG_ITEM',
    'UNDELIVERED_SERVER_OUTAGE', 'UNDELIVERED_OTHER'
  )),
  sample_content_provided BOOLEAN NOT NULL DEFAULT FALSE,
  entity_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(entity_hash)),
  idempotency_hash TEXT NOT NULL CHECK (iap_private.is_sha256_hex(idempotency_hash)),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (billing_account_id, idempotency_hash),
  FOREIGN KEY (billing_account_id, environment, source_transaction_id)
    REFERENCES iap_private.apple_transactions(billing_account_id, environment, transaction_id)
);

CREATE INDEX iap_fulfillment_evidence_transaction
  ON iap_private.fulfillment_usage_evidence (
    billing_account_id, environment, source_transaction_id, recorded_at DESC
  );

CREATE TABLE iap_private.apple_consumption_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_uuid UUID NOT NULL UNIQUE REFERENCES iap_private.apple_notifications(notification_uuid),
  billing_account_id UUID REFERENCES iap_private.apple_account_bindings(billing_account_id),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production', 'Xcode')),
  transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(transaction_id)),
  original_transaction_id TEXT NOT NULL CHECK (iap_private.is_uint64_text(original_transaction_id)),
  product_id TEXT NOT NULL CHECK (product_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'),
  product_type TEXT NOT NULL CHECK (product_type IN ('consumable', 'non_consumable', 'subscription')),
  bundle_id TEXT NOT NULL CHECK (bundle_id ~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$'),
  consumption_request_reason TEXT NOT NULL CHECK (consumption_request_reason IN (
    'UNINTENDED_PURCHASE', 'FULFILLMENT_ISSUE', 'UNSATISFIED_WITH_PURCHASE', 'LEGAL', 'OTHER'
  )),
  consent_event_id UUID REFERENCES iap_private.refund_data_consent_events(consent_event_id),
  notice_version TEXT,
  notice_sha256 TEXT CHECK (notice_sha256 IS NULL OR iap_private.is_sha256_hex(notice_sha256)),
  delivery_status TEXT CHECK (delivery_status IS NULL OR delivery_status IN (
    'DELIVERED', 'UNDELIVERED_QUALITY_ISSUE', 'UNDELIVERED_WRONG_ITEM',
    'UNDELIVERED_SERVER_OUTAGE', 'UNDELIVERED_OTHER'
  )),
  sample_content_provided BOOLEAN,
  consumption_percentage INTEGER CHECK (
    consumption_percentage IS NULL OR consumption_percentage BETWEEN 0 AND 100000
  ),
  request_body_hash TEXT CHECK (request_body_hash IS NULL OR iap_private.is_sha256_hex(request_body_hash)),
  status TEXT NOT NULL CHECK (status IN (
    'pending_evidence', 'queued', 'in_flight', 'send_started',
    'retryable_failed', 'accepted', 'terminal_failed', 'send_result_unknown',
    'skipped_no_consent', 'skipped_withdrawn', 'manual_review', 'cancelled', 'expired'
  )),
  received_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  warning_at TIMESTAMPTZ,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  send_authorization_token UUID,
  send_authorization_expires_at TIMESTAMPTZ,
  send_authorized_at TIMESTAMPTZ,
  completion_attempt_no INTEGER CHECK (
    completion_attempt_no IS NULL OR completion_attempt_no > 0
  ),
  completion_lease_hash TEXT CHECK (
    completion_lease_hash IS NULL OR iap_private.is_sha256_hex(completion_lease_hash)
  ),
  completion_send_authorization_hash TEXT CHECK (
    completion_send_authorization_hash IS NULL
      OR iap_private.is_sha256_hex(completion_send_authorization_hash)
  ),
  completion_body_hash TEXT CHECK (
    completion_body_hash IS NULL OR iap_private.is_sha256_hex(completion_body_hash)
  ),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (deadline_at = received_at + CASE
    WHEN environment = 'Sandbox' THEN INTERVAL '5 minutes'
    ELSE INTERVAL '12 hours'
  END),
  CHECK ((status IN ('in_flight', 'send_started'))
    = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((send_authorization_token IS NULL) = (send_authorization_expires_at IS NULL)),
  CHECK ((completion_send_authorization_hash IS NULL) = (completion_body_hash IS NULL)),
  CHECK (status <> 'send_result_unknown' OR (
    completion_attempt_no IS NOT NULL
    AND completion_lease_hash IS NOT NULL
    AND completion_send_authorization_hash IS NOT NULL
    AND completion_body_hash IS NOT NULL
  )),
  CHECK (status <> 'send_started'
    OR (send_authorization_token IS NOT NULL AND send_authorized_at IS NOT NULL)),
  CHECK ((consent_event_id IS NULL) = (notice_version IS NULL AND notice_sha256 IS NULL)),
  CHECK (status NOT IN (
      'queued', 'in_flight', 'send_started', 'retryable_failed', 'accepted',
      'terminal_failed', 'send_result_unknown'
    )
    OR (billing_account_id IS NOT NULL AND consent_event_id IS NOT NULL
      AND delivery_status IS NOT NULL AND sample_content_provided IS NOT NULL
      AND request_body_hash IS NOT NULL)),
  CHECK (product_type <> 'subscription' OR consumption_percentage IS NULL),
  CHECK (delivery_status IS NULL OR delivery_status = 'DELIVERED' OR consumption_percentage = 0)
);

CREATE INDEX iap_consumption_requests_drain
  ON iap_private.apple_consumption_requests (deadline_at, next_attempt_at, received_at)
  WHERE status IN (
    'pending_evidence', 'queued', 'retryable_failed', 'in_flight', 'send_started'
  );

CREATE FUNCTION public.iap_list_operational_alerts()
RETURNS TABLE (
  alert_id UUID,
  source TEXT,
  environment TEXT,
  status TEXT,
  deadline_bucket TEXT,
  attempt_no INTEGER,
  error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM iap_private.require_service_role();
  RETURN QUERY
  SELECT operation.alert_id, operation.source, operation.environment,
    operation.status, operation.deadline_bucket, operation.attempt_no,
    operation.error_code
  FROM (
    SELECT request.request_id AS alert_id,
      'consumption'::TEXT AS source,
      request.environment,
      request.status,
      CASE
        WHEN request.deadline_at <= clock_timestamp() THEN 'overdue'
        WHEN request.deadline_at <= clock_timestamp() + INTERVAL '1 hour' THEN 'lt_1h'
        WHEN request.deadline_at <= clock_timestamp() + INTERVAL '6 hours' THEN 'lt_6h'
        ELSE 'gte_6h'
      END::TEXT AS deadline_bucket,
      request.attempts AS attempt_no,
      COALESCE(request.last_error_code, 'REVIEW_REQUIRED') AS error_code,
      COALESCE(request.warning_at, request.updated_at) AS sort_at
    FROM iap_private.apple_consumption_requests AS request
    WHERE request.status IN (
      'manual_review', 'send_result_unknown', 'terminal_failed', 'expired'
    )
    UNION ALL
    SELECT review.review_id,
      'transaction_review'::TEXT,
      review.environment,
      'manual_review'::TEXT,
      'not_applicable'::TEXT,
      0,
      review.reason_code,
      review.recorded_at
    FROM iap_private.apple_transaction_review_facts AS review
    WHERE review.review_status = 'pending'
  ) AS operation
  ORDER BY operation.sort_at, operation.alert_id
  LIMIT 100;
END;
$$;

CREATE FUNCTION public.iap_acknowledge_transaction_review(
  p_review_id UUID,
  p_resolution_code TEXT
)
RETURNS TABLE (
  review_id UUID,
  status TEXT,
  resolution_code TEXT,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review iap_private.apple_transaction_review_facts%ROWTYPE;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_review_id IS NULL OR p_resolution_code NOT IN (
    'NO_AUTOMATIC_ACTION', 'APPLE_RECONCILIATION_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'Invalid transaction review acknowledgement';
  END IF;

  SELECT review.* INTO v_review
  FROM iap_private.apple_transaction_review_facts AS review
  WHERE review.review_id = p_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction review does not exist';
  END IF;
  IF v_review.review_status = 'acknowledged' THEN
    IF v_review.resolution_code IS DISTINCT FROM p_resolution_code THEN
      RAISE EXCEPTION 'Transaction review acknowledgement conflicts';
    END IF;
    RETURN QUERY SELECT p_review_id, 'acknowledged'::TEXT,
      p_resolution_code, TRUE;
    RETURN;
  END IF;

  UPDATE iap_private.apple_transaction_review_facts AS review
  SET review_status = 'acknowledged',
      resolution_code = p_resolution_code,
      reviewed_at = clock_timestamp()
  WHERE review.review_id = p_review_id;
  RETURN QUERY SELECT p_review_id, 'acknowledged'::TEXT,
    p_resolution_code, FALSE;
END;
$$;

-- Existing pooled rows cannot be attributed to a source purchase after the
-- fact. Preserve them for audit/manual resolution, but never spend them.
INSERT INTO iap_private.export_credit_lots (
  billing_account_id, environment, source_transaction_id, product_id,
  gross_milliunits, refund_target_milliunits, reclaimed_milliunits,
  attribution_status, purchased_at
)
SELECT tx.billing_account_id, tx.environment, tx.transaction_id, tx.product_id,
  CASE
    WHEN tx.credit_granted BETWEEN 1 AND 92233720368547
      THEN tx.credit_granted * 100000
    ELSE 0
  END,
  0, 0, 'legacy_manual_review', tx.purchase_at
FROM iap_private.apple_transactions AS tx
WHERE tx.product_type = 'consumable'
ON CONFLICT DO NOTHING;

-- Mixed-version safety: the V1 service RPC remains executable until 081, but
-- it has no quantity/exact-lot contract. Preserve a bounded transaction fact
-- for manual reconciliation while preventing a new pooled credit grant.
CREATE FUNCTION iap_private.quarantine_v1_consumable_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_type = 'consumable' AND NEW.contract_version = 1 THEN
    NEW.credit_granted := 0;
    NEW.resolution_status := 'legacy_manual_review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iap_quarantine_v1_consumable_transaction
BEFORE INSERT OR UPDATE ON iap_private.apple_transactions
FOR EACH ROW EXECUTE FUNCTION iap_private.quarantine_v1_consumable_transaction();

ALTER TABLE iap_private.apple_transactions
  ADD CONSTRAINT apple_transactions_v1_consumable_quarantine
  CHECK (
    contract_version <> 1 OR product_type <> 'consumable' OR credit_granted = 0
  ) NOT VALID;

CREATE FUNCTION iap_private.suppress_v1_consumable_pooled_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.entry_kind = 'purchase_grant'
     AND NEW.transaction_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM iap_private.apple_transactions AS transaction
       WHERE transaction.billing_account_id = NEW.billing_account_id
         AND transaction.environment = NEW.environment
         AND transaction.transaction_id = NEW.transaction_id
         AND transaction.product_type = 'consumable'
         AND transaction.contract_version = 1
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iap_suppress_v1_consumable_pooled_grant
BEFORE INSERT ON iap_private.export_credit_ledger
FOR EACH ROW EXECUTE FUNCTION iap_private.suppress_v1_consumable_pooled_grant();

REVOKE ALL ON FUNCTION iap_private.quarantine_v1_consumable_transaction()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.suppress_v1_consumable_pooled_grant()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE iap_private.apple_transaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.apple_transaction_review_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.export_credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.export_credit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.export_credit_lot_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.refund_data_consent_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.refund_data_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.fulfillment_usage_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE iap_private.apple_consumption_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA iap_private FROM PUBLIC, anon, authenticated, service_role;

-- A CONSUMPTION_REQUEST creates its own 12-hour response obligation. It is not
-- a transaction-state projection, so a later purchase/refund/renewal notice for
-- the same transaction cannot make it stale. UUID + payload hash remains the
-- idempotency and collision boundary for these requests.
CREATE OR REPLACE FUNCTION public.iap_claim_notification(
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

  SELECT notification.* INTO v_existing
  FROM iap_private.apple_notifications AS notification
  WHERE notification.notification_uuid = p_notification_uuid
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.environment IS DISTINCT FROM p_environment
       OR v_existing.notification_type IS DISTINCT FROM p_notification_type
       OR v_existing.subtype IS DISTINCT FROM p_subtype
       OR v_existing.transaction_id IS DISTINCT FROM p_transaction_id
       OR v_existing.original_transaction_id IS DISTINCT FROM p_original_transaction_id
       OR v_existing.signed_at IS DISTINCT FROM v_signed_at
       OR v_existing.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'Apple notification UUID payload conflict';
    END IF;
    RETURN QUERY SELECT p_notification_uuid, v_existing.claim_token, TRUE,
      v_existing.status = 'stale', v_existing.status;
    RETURN;
  END IF;

  IF p_transaction_id IS NOT NULL AND p_notification_type <> 'CONSUMPTION_REQUEST' THEN
    IF EXISTS (
      SELECT 1 FROM iap_private.apple_notifications AS notification
      WHERE notification.environment = p_environment
        AND notification.transaction_id = p_transaction_id
        AND notification.notification_type <> 'CONSUMPTION_REQUEST'
        AND notification.signed_at = v_signed_at
        AND notification.payload_hash IS DISTINCT FROM p_payload_hash
    ) THEN
      RAISE EXCEPTION 'Apple notification signedDate payload conflict';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM iap_private.apple_notifications AS notification
      WHERE notification.environment = p_environment
        AND notification.transaction_id = p_transaction_id
        AND notification.notification_type <> 'CONSUMPTION_REQUEST'
        AND notification.signed_at > v_signed_at
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
    'claimed', v_claim, clock_timestamp()
  );
  RETURN QUERY SELECT p_notification_uuid, v_claim, FALSE, FALSE, 'claimed'::TEXT;
END;
$$;

CREATE FUNCTION iap_private.current_refund_data_consent(p_billing_account_id UUID)
RETURNS TABLE (
  consent_event_id UUID,
  decision TEXT,
  notice_version TEXT,
  notice_sha256 TEXT,
  decided_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT event.consent_event_id, event.decision, event.notice_version,
    event.notice_sha256, event.decided_at
  FROM iap_private.refund_data_consent_events AS event
  WHERE event.billing_account_id = p_billing_account_id
  ORDER BY event.decided_at DESC, event.consent_event_id DESC
  LIMIT 1
$$;

CREATE FUNCTION iap_private.credit_balance_milliunits(
  p_billing_account_id UUID,
  p_environment TEXT
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(
    lot.gross_milliunits
    - lot.reclaimed_milliunits
    - COALESCE((
      SELECT sum(allocation.milliunits)
      FROM iap_private.export_credit_allocations AS allocation
      WHERE allocation.billing_account_id = lot.billing_account_id
        AND allocation.environment = lot.environment
        AND allocation.source_transaction_id = lot.source_transaction_id
        AND allocation.status IN ('reserved', 'committed')
    ), 0)
  ), 0)::BIGINT
  FROM iap_private.export_credit_lots AS lot
  WHERE lot.billing_account_id = p_billing_account_id
    AND lot.environment = p_environment
    AND lot.attribution_status = 'exact'
$$;

CREATE OR REPLACE FUNCTION iap_private.credit_balance(
  p_billing_account_id UUID,
  p_environment TEXT
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    iap_private.credit_balance_milliunits(p_billing_account_id, p_environment),
    0
  ) / 100000
$$;

CREATE OR REPLACE FUNCTION iap_private.open_reserved_credits(
  p_billing_account_id UUID,
  p_environment TEXT
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(allocation.milliunits), 0)::BIGINT / 100000
  FROM iap_private.export_credit_allocations AS allocation
  WHERE allocation.billing_account_id = p_billing_account_id
    AND allocation.environment = p_environment
    AND allocation.status = 'reserved'
$$;

CREATE FUNCTION public.iap_get_refund_data_consent_state(
  p_notice_version TEXT,
  p_notice_sha256 TEXT
)
RETURNS TABLE (
  notice_matches BOOLEAN,
  decision TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_current iap_private.refund_data_consent_events%ROWTYPE;
  v_notice_matches BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF p_notice_version IS NULL
     OR p_notice_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR NOT iap_private.is_sha256_hex(p_notice_sha256) THEN
    RAISE EXCEPTION 'Invalid refund-data consent notice';
  END IF;
  IF iap_private.is_account_deletion_pending(v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM iap_private.refund_data_consent_notices AS notice
    WHERE notice.notice_version = p_notice_version
      AND notice.notice_sha256 = p_notice_sha256
      AND notice.active
  ) INTO v_notice_matches;
  IF NOT v_notice_matches THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT;
    RETURN;
  END IF;

  SELECT binding.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_uid AND binding.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
    RETURN;
  END IF;

  SELECT event.* INTO v_current
  FROM iap_private.refund_data_consent_events AS event
  WHERE event.billing_account_id = v_billing_account_id
  ORDER BY event.decided_at DESC, event.consent_event_id DESC
  LIMIT 1;
  RETURN QUERY SELECT TRUE,
    CASE WHEN FOUND
          AND v_current.notice_version = p_notice_version
          AND v_current.notice_sha256 = p_notice_sha256
      THEN v_current.decision ELSE NULL::TEXT END;
END;
$$;

CREATE FUNCTION public.iap_set_refund_data_consent(
  p_decision TEXT,
  p_notice_version TEXT,
  p_notice_sha256 TEXT,
  p_idempotency_key UUID
)
RETURNS TABLE (
  consent_event_id UUID,
  decision TEXT,
  notice_version TEXT,
  notice_sha256 TEXT,
  decided_at TIMESTAMPTZ,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_billing_account_id UUID;
  v_existing iap_private.refund_data_consent_events%ROWTYPE;
  v_current iap_private.refund_data_consent_events%ROWTYPE;
  v_inserted iap_private.refund_data_consent_events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF p_decision NOT IN ('granted', 'withdrawn')
     OR p_notice_version IS NULL
     OR p_notice_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR NOT iap_private.is_sha256_hex(p_notice_sha256)
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Invalid refund-data consent decision';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT binding.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_uid AND binding.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IAP account binding is unavailable';
  END IF;

  SELECT event.* INTO v_existing
  FROM iap_private.refund_data_consent_events AS event
  WHERE event.billing_account_id = v_billing_account_id
    AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.decision IS DISTINCT FROM p_decision
       OR v_existing.notice_version IS DISTINCT FROM p_notice_version
       OR v_existing.notice_sha256 IS DISTINCT FROM p_notice_sha256 THEN
      RAISE EXCEPTION 'Refund-data consent idempotency collision';
    END IF;
    RETURN QUERY SELECT v_existing.consent_event_id, v_existing.decision,
      v_existing.notice_version, v_existing.notice_sha256,
      v_existing.decided_at, TRUE;
    RETURN;
  END IF;

  IF p_decision = 'granted' THEN
    PERFORM 1
    FROM iap_private.refund_data_consent_notices AS notice
    WHERE notice.notice_version = p_notice_version
      AND notice.notice_sha256 = p_notice_sha256
      AND notice.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Refund-data consent notice is not active';
    END IF;
  ELSE
    SELECT event.* INTO v_current
    FROM iap_private.refund_data_consent_events AS event
    WHERE event.billing_account_id = v_billing_account_id
    ORDER BY event.decided_at DESC, event.consent_event_id DESC
    LIMIT 1;
    IF NOT FOUND OR v_current.decision <> 'granted'
       OR v_current.notice_version IS DISTINCT FROM p_notice_version
       OR v_current.notice_sha256 IS DISTINCT FROM p_notice_sha256 THEN
      RAISE EXCEPTION 'No matching refund-data consent grant to withdraw';
    END IF;
  END IF;

  INSERT INTO iap_private.refund_data_consent_events (
    billing_account_id, decision, notice_version, notice_sha256, idempotency_key
  ) VALUES (
    v_billing_account_id, p_decision, p_notice_version, p_notice_sha256, p_idempotency_key
  )
  RETURNING * INTO v_inserted;

  -- The canonical account lock makes this withdrawal win atomically over any
  -- claim that has not yet crossed the service-only send-start authorization.
  -- A send_started row is already an external-call snapshot and is completed
  -- with its exact immutable body; a future retry still rechecks consent.
  IF p_decision = 'withdrawn' THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'skipped_withdrawn', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'CONSENT_WITHDRAWN',
        updated_at = clock_timestamp()
    WHERE request.billing_account_id = v_billing_account_id
      AND request.status IN (
        'pending_evidence', 'queued', 'retryable_failed', 'in_flight'
      );
  END IF;

  RETURN QUERY SELECT v_inserted.consent_event_id, v_inserted.decision,
    v_inserted.notice_version, v_inserted.notice_sha256,
    v_inserted.decided_at, FALSE;
END;
$$;

CREATE FUNCTION public.iap_record_fulfillment_usage_evidence(
  p_environment TEXT,
  p_transaction_id TEXT,
  p_event_kind TEXT,
  p_units_milliunits BIGINT,
  p_delivery_status TEXT,
  p_sample_content_provided BOOLEAN,
  p_entity_hash TEXT,
  p_idempotency_hash TEXT
)
RETURNS TABLE (evidence_id UUID, duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction iap_private.apple_transactions%ROWTYPE;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_existing iap_private.fulfillment_usage_evidence%ROWTYPE;
  v_inserted iap_private.fulfillment_usage_evidence%ROWTYPE;
  v_user_id UUID;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR NOT iap_private.is_uint64_text(p_transaction_id)
     -- This public service RPC records only a real fulfillment result. Export,
     -- release, and refund events are emitted transactionally by their owning
     -- server-side state transitions and cannot be fabricated through a
     -- generic evidence endpoint.
     OR p_event_kind <> 'delivery_confirmed'
     OR p_units_milliunits IS NULL OR p_units_milliunits < 0
     OR p_delivery_status IS NULL OR p_delivery_status NOT IN (
       'DELIVERED', 'UNDELIVERED_QUALITY_ISSUE', 'UNDELIVERED_WRONG_ITEM',
       'UNDELIVERED_SERVER_OUTAGE', 'UNDELIVERED_OTHER'
     )
     OR p_sample_content_provided IS NULL
     OR NOT iap_private.is_sha256_hex(p_entity_hash)
     OR NOT iap_private.is_sha256_hex(p_idempotency_hash) THEN
    RAISE EXCEPTION 'Invalid fulfillment evidence';
  END IF;
  IF p_delivery_status IS NOT NULL
     AND p_delivery_status <> 'DELIVERED'
     AND p_units_milliunits <> 0 THEN
    RAISE EXCEPTION 'Undelivered evidence cannot report consumed units';
  END IF;

  SELECT binding.user_id INTO v_user_id
  FROM iap_private.apple_transactions AS tx
  JOIN iap_private.apple_account_bindings AS binding
    ON binding.billing_account_id = tx.billing_account_id
  WHERE tx.environment = p_environment
    AND tx.transaction_id = p_transaction_id
    AND binding.deleted_at IS NULL;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Verified Apple transaction is unavailable';
  END IF;

  -- Delivery/usage facts and the first Apple send snapshot share the canonical
  -- account lock. Evidence that commits first is included; evidence that loses
  -- the lock is necessarily later than the immutable send boundary.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT binding.* INTO v_binding
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_user_id AND binding.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified Apple transaction is unavailable';
  END IF;
  SELECT tx.* INTO v_transaction
  FROM iap_private.apple_transactions AS tx
  WHERE tx.billing_account_id = v_binding.billing_account_id
    AND tx.environment = p_environment
    AND tx.transaction_id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified Apple transaction is unavailable';
  END IF;

  INSERT INTO iap_private.fulfillment_usage_evidence (
    billing_account_id, environment, source_transaction_id, product_id,
    event_kind, units_milliunits, delivery_status, sample_content_provided,
    entity_hash, idempotency_hash
  ) VALUES (
    v_transaction.billing_account_id, p_environment, p_transaction_id,
    v_transaction.product_id, p_event_kind, p_units_milliunits,
    p_delivery_status, p_sample_content_provided, p_entity_hash, p_idempotency_hash
  )
  ON CONFLICT (billing_account_id, idempotency_hash) DO NOTHING
  RETURNING * INTO v_inserted;
  IF FOUND THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE request.billing_account_id = v_transaction.billing_account_id
      AND request.environment = p_environment
      AND request.transaction_id = p_transaction_id
      AND request.status = 'pending_evidence';
    RETURN QUERY SELECT v_inserted.evidence_id, FALSE;
    RETURN;
  END IF;

  -- ON CONFLICT waits for a concurrent winner. Re-read that committed row and
  -- prove the idempotency key describes the same immutable fulfillment fact.
  SELECT evidence.* INTO v_existing
  FROM iap_private.fulfillment_usage_evidence AS evidence
  WHERE evidence.billing_account_id = v_transaction.billing_account_id
    AND evidence.idempotency_hash = p_idempotency_hash;
  IF NOT FOUND
     OR v_existing.environment IS DISTINCT FROM p_environment
     OR v_existing.source_transaction_id IS DISTINCT FROM p_transaction_id
     OR v_existing.product_id IS DISTINCT FROM v_transaction.product_id
     OR v_existing.event_kind IS DISTINCT FROM p_event_kind
     OR v_existing.units_milliunits IS DISTINCT FROM p_units_milliunits
     OR v_existing.delivery_status IS DISTINCT FROM p_delivery_status
     OR v_existing.sample_content_provided IS DISTINCT FROM p_sample_content_provided
     OR v_existing.entity_hash IS DISTINCT FROM p_entity_hash THEN
    RAISE EXCEPTION 'Fulfillment evidence idempotency collision';
  END IF;
  UPDATE iap_private.apple_consumption_requests AS request
  SET next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE request.billing_account_id = v_transaction.billing_account_id
    AND request.environment = p_environment
    AND request.transaction_id = p_transaction_id
    AND request.status = 'pending_evidence';
  RETURN QUERY SELECT v_existing.evidence_id, TRUE;
END;
$$;

CREATE FUNCTION iap_private.iap_refresh_consumption_request(p_request_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request iap_private.apple_consumption_requests%ROWTYPE;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_transaction iap_private.apple_transactions%ROWTYPE;
  v_catalog iap_private.apple_product_catalog%ROWTYPE;
  v_consent iap_private.refund_data_consent_events%ROWTYPE;
  v_delivery iap_private.fulfillment_usage_evidence%ROWTYPE;
  v_user_id UUID;
  v_gross BIGINT;
  v_committed BIGINT;
  v_percentage INTEGER;
  v_expected_hash TEXT;
  v_wait_code TEXT;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid consumption request'; END IF;

  SELECT request.* INTO v_request
  FROM iap_private.apple_consumption_requests AS request
  WHERE request.request_id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.status NOT IN ('pending_evidence', 'queued', 'retryable_failed') THEN
    RETURN v_request.status;
  END IF;
  IF v_request.billing_account_id IS NULL THEN
    RETURN v_request.status;
  END IF;

  SELECT binding.user_id INTO v_user_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.billing_account_id = v_request.billing_account_id;
  IF v_user_id IS NULL THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'cancelled', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'ACCOUNT_DELETED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id
      AND request.status IN ('pending_evidence', 'queued', 'retryable_failed');
    RETURN 'cancelled';
  END IF;

  -- Every account-sensitive decision uses the same lock as consent, purchase,
  -- and deletion. Whichever transaction acquires it first defines the order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 15013)
  );
  SELECT binding.* INTO v_binding
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.billing_account_id = v_request.billing_account_id
    AND binding.user_id = v_user_id
  FOR UPDATE;
  SELECT request.* INTO v_request
  FROM iap_private.apple_consumption_requests AS request
  WHERE request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.status NOT IN ('pending_evidence', 'queued', 'retryable_failed') THEN
    RETURN v_request.status;
  END IF;
  IF v_request.deadline_at <= clock_timestamp() THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'expired', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'APPLE_DEADLINE_EXPIRED',
        warning_at = COALESCE(request.warning_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN 'expired';
  END IF;
  IF v_binding.billing_account_id IS NULL OR v_binding.deleted_at IS NOT NULL
     OR iap_private.is_account_deletion_pending(v_user_id) THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'cancelled', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'ACCOUNT_DELETED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN 'cancelled';
  END IF;

  SELECT consent.* INTO v_consent
  FROM iap_private.refund_data_consent_events AS consent
  WHERE consent.billing_account_id = v_request.billing_account_id
  ORDER BY consent.decided_at DESC, consent.consent_event_id DESC
  LIMIT 1;
  IF NOT FOUND OR v_consent.decision <> 'granted'
     OR v_consent.consent_event_id IS DISTINCT FROM v_request.consent_event_id
     OR v_consent.notice_version IS DISTINCT FROM v_request.notice_version
     OR v_consent.notice_sha256 IS DISTINCT FROM v_request.notice_sha256 THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = CASE WHEN request.consent_event_id IS NULL
          THEN 'skipped_no_consent' ELSE 'skipped_withdrawn' END,
        next_attempt_at = NULL, lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = CASE WHEN request.consent_event_id IS NULL
          THEN 'CONSENT_NOT_GRANTED' ELSE 'CONSENT_WITHDRAWN' END,
        updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN CASE WHEN v_request.consent_event_id IS NULL
      THEN 'skipped_no_consent' ELSE 'skipped_withdrawn' END;
  END IF;

  PERFORM 1
  FROM iap_private.refund_data_consent_notices AS notice
  WHERE notice.notice_version = v_request.notice_version
    AND notice.notice_sha256 = v_request.notice_sha256
    AND notice.active
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'skipped_withdrawn', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'CONSENT_NOTICE_REPLACED',
        updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN 'skipped_withdrawn';
  END IF;

  IF v_request.status IN ('queued', 'retryable_failed') THEN
    v_expected_hash := iap_private.sha256_text(
      'consumption-v1|' || v_request.environment || '|' || v_request.transaction_id
      || '|true|' || v_request.delivery_status || '|'
      || CASE WHEN v_request.sample_content_provided THEN 'true' ELSE 'false' END
      || '|' || COALESCE(v_request.consumption_percentage::TEXT, 'omitted')
    );
    IF v_request.request_body_hash IS DISTINCT FROM v_expected_hash THEN
      UPDATE iap_private.apple_consumption_requests AS request
      SET status = 'manual_review', next_attempt_at = NULL,
          lease_token = NULL, lease_expires_at = NULL,
          send_authorization_token = NULL,
          send_authorization_expires_at = NULL,
          last_error_code = 'IMMUTABLE_BODY_MISMATCH',
          updated_at = clock_timestamp()
      WHERE request.request_id = p_request_id;
      RETURN 'manual_review';
    END IF;
    RETURN v_request.status;
  END IF;

  IF v_request.environment = 'Xcode' THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'manual_review', next_attempt_at = NULL,
        last_error_code = 'XCODE_REMOTE_UNSUPPORTED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN 'manual_review';
  END IF;

  SELECT transaction.* INTO v_transaction
  FROM iap_private.apple_transactions AS transaction
  WHERE transaction.billing_account_id = v_request.billing_account_id
    AND transaction.environment = v_request.environment
    AND transaction.transaction_id = v_request.transaction_id
    AND transaction.original_transaction_id = v_request.original_transaction_id
    AND transaction.product_id = v_request.product_id
    AND transaction.product_type = v_request.product_type
    AND transaction.bundle_id = v_request.bundle_id
    AND transaction.contract_version = 2
    AND transaction.resolution_status = 'automatic';
  IF NOT FOUND THEN
    v_wait_code := 'WAITING_TRANSACTION';
  ELSE
    SELECT catalog.* INTO v_catalog
    FROM iap_private.apple_product_catalog AS catalog
    WHERE catalog.environment = v_request.environment
      AND catalog.product_id = v_request.product_id
      AND catalog.bundle_id = v_request.bundle_id
      AND catalog.product_type = v_request.product_type;
    IF NOT FOUND THEN
      UPDATE iap_private.apple_consumption_requests AS request
      SET status = 'manual_review', next_attempt_at = NULL,
          last_error_code = 'CATALOG_IDENTITY_MISMATCH', updated_at = clock_timestamp()
      WHERE request.request_id = p_request_id;
      RETURN 'manual_review';
    END IF;

    SELECT evidence.* INTO v_delivery
    FROM iap_private.fulfillment_usage_evidence AS evidence
    WHERE evidence.billing_account_id = v_request.billing_account_id
      AND evidence.environment = v_request.environment
      AND evidence.source_transaction_id = v_request.transaction_id
      AND evidence.event_kind IN ('delivery_confirmed', 'export_committed')
      AND evidence.delivery_status IS NOT NULL
    ORDER BY evidence.recorded_at DESC, evidence.evidence_id DESC
    LIMIT 1;
    IF NOT FOUND THEN v_wait_code := 'WAITING_FULFILLMENT'; END IF;
  END IF;

  IF v_wait_code IS NOT NULL THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET next_attempt_at = LEAST(clock_timestamp() + INTERVAL '1 minute', request.deadline_at),
        last_error_code = v_wait_code, updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN 'pending_evidence';
  END IF;

  v_percentage := NULL;
  IF v_request.product_type = 'consumable' THEN
    SELECT lot.gross_milliunits,
      COALESCE(sum(allocation.milliunits)
        FILTER (WHERE allocation.status = 'committed'), 0)::BIGINT
    INTO v_gross, v_committed
    FROM iap_private.export_credit_lots AS lot
    LEFT JOIN iap_private.export_credit_allocations AS allocation
      ON allocation.billing_account_id = lot.billing_account_id
      AND allocation.environment = lot.environment
      AND allocation.source_transaction_id = lot.source_transaction_id
    WHERE lot.billing_account_id = v_request.billing_account_id
      AND lot.environment = v_request.environment
      AND lot.source_transaction_id = v_request.transaction_id
      AND lot.attribution_status = 'exact'
    GROUP BY lot.gross_milliunits;
    IF NOT FOUND OR v_gross <= 0 THEN
      UPDATE iap_private.apple_consumption_requests AS request
      SET next_attempt_at = LEAST(clock_timestamp() + INTERVAL '1 minute', request.deadline_at),
          last_error_code = 'WAITING_EXACT_LOT', updated_at = clock_timestamp()
      WHERE request.request_id = p_request_id;
      RETURN 'pending_evidence';
    END IF;
    v_percentage := LEAST(
      100000,
      floor((v_committed::NUMERIC * 100000::NUMERIC) / v_gross::NUMERIC)::INTEGER
    );
    IF v_delivery.delivery_status <> 'DELIVERED' THEN v_percentage := 0; END IF;
  END IF;

  v_expected_hash := iap_private.sha256_text(
    'consumption-v1|' || v_request.environment || '|' || v_request.transaction_id
    || '|true|' || v_delivery.delivery_status || '|'
    || CASE WHEN v_delivery.sample_content_provided THEN 'true' ELSE 'false' END
    || '|' || COALESCE(v_percentage::TEXT, 'omitted')
  );
  UPDATE iap_private.apple_consumption_requests AS request
  SET status = 'queued', delivery_status = v_delivery.delivery_status,
      sample_content_provided = v_delivery.sample_content_provided,
      consumption_percentage = v_percentage,
      request_body_hash = v_expected_hash,
      next_attempt_at = clock_timestamp(), last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE request.request_id = p_request_id;
  RETURN 'queued';
END;
$$;

CREATE FUNCTION iap_private.release_exact_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'reserved' AND NEW.status = 'released' THEN
    WITH released AS (
      UPDATE iap_private.export_credit_allocations AS allocation
      SET status = 'released', updated_at = clock_timestamp()
      WHERE allocation.reservation_id = NEW.reservation_id
        AND allocation.status = 'reserved'
      RETURNING allocation.billing_account_id, allocation.environment,
        allocation.source_transaction_id, allocation.milliunits
    )
    INSERT INTO iap_private.fulfillment_usage_evidence (
      billing_account_id, environment, source_transaction_id, product_id,
      event_kind, units_milliunits, delivery_status, sample_content_provided,
      entity_hash, idempotency_hash
    )
    SELECT released.billing_account_id, released.environment,
      released.source_transaction_id, lot.product_id,
      'export_released', released.milliunits, NULL, FALSE,
      iap_private.sha256_text(NEW.reservation_id::TEXT),
      iap_private.sha256_text(
        'export-release|' || NEW.reservation_id::TEXT || '|' || released.environment
        || '|' || released.source_transaction_id
      )
    FROM released
    JOIN iap_private.export_credit_lots AS lot
      ON lot.billing_account_id = released.billing_account_id
      AND lot.environment = released.environment
      AND lot.source_transaction_id = released.source_transaction_id
    ON CONFLICT (billing_account_id, idempotency_hash) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iap_release_exact_allocations
AFTER UPDATE OF status ON iap_private.export_credit_reservations
FOR EACH ROW EXECUTE FUNCTION iap_private.release_exact_allocations();

CREATE OR REPLACE FUNCTION public.iap_export_credit_reserve(
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
  v_reservation iap_private.export_credit_reservations%ROWTYPE;
  v_lot RECORD;
  v_needed BIGINT;
  v_remaining BIGINT;
  v_available BIGINT;
  v_allocate BIGINT;
  v_allocated BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR p_amount IS NULL OR p_amount <= 0
     OR p_amount > 92233720368547
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Invalid export credit reservation';
  END IF;
  v_needed := p_amount * 100000;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT binding.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_uid AND binding.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IAP account binding is unavailable';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM iap_private.export_credit_reservations AS reservation
  WHERE reservation.billing_account_id = v_billing_account_id
    AND reservation.environment = p_environment
    AND reservation.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(sum(allocation.milliunits), 0)::BIGINT INTO v_allocated
    FROM iap_private.export_credit_allocations AS allocation
    WHERE allocation.reservation_id = v_reservation.reservation_id;
    IF v_allocated <> v_reservation.amount * 100000 THEN
      RAISE EXCEPTION 'Legacy export reservation requires manual review';
    END IF;
    RETURN QUERY SELECT v_reservation.reservation_id, v_reservation.status, TRUE,
      iap_private.credit_balance(v_billing_account_id, p_environment),
      iap_private.open_reserved_credits(v_billing_account_id, p_environment);
    RETURN;
  END IF;

  IF iap_private.credit_balance_milliunits(v_billing_account_id, p_environment) < v_needed THEN
    RAISE EXCEPTION 'Insufficient export credits';
  END IF;
  INSERT INTO iap_private.export_credit_reservations (
    billing_account_id, environment, idempotency_key, amount, status
  ) VALUES (
    v_billing_account_id, p_environment, p_idempotency_key, p_amount, 'reserved'
  ) RETURNING * INTO v_reservation;

  v_remaining := v_needed;
  FOR v_lot IN
    SELECT lot.*,
      lot.gross_milliunits - lot.reclaimed_milliunits - COALESCE((
        SELECT sum(allocation.milliunits)
        FROM iap_private.export_credit_allocations AS allocation
        WHERE allocation.billing_account_id = lot.billing_account_id
          AND allocation.environment = lot.environment
          AND allocation.source_transaction_id = lot.source_transaction_id
          AND allocation.status IN ('reserved', 'committed')
      ), 0) AS available_milliunits
    FROM iap_private.export_credit_lots AS lot
    WHERE lot.billing_account_id = v_billing_account_id
      AND lot.environment = p_environment
      AND lot.attribution_status = 'exact'
    ORDER BY lot.purchased_at, lot.source_transaction_id
    FOR UPDATE
  LOOP
    v_available := GREATEST(v_lot.available_milliunits, 0);
    IF v_available > 0 AND v_remaining > 0 THEN
      v_allocate := LEAST(v_available, v_remaining);
      INSERT INTO iap_private.export_credit_allocations (
        reservation_id, billing_account_id, environment,
        source_transaction_id, milliunits, status
      ) VALUES (
        v_reservation.reservation_id, v_billing_account_id, p_environment,
        v_lot.source_transaction_id, v_allocate, 'reserved'
      );
      INSERT INTO iap_private.fulfillment_usage_evidence (
        billing_account_id, environment, source_transaction_id, product_id,
        event_kind, units_milliunits, delivery_status, sample_content_provided,
        entity_hash, idempotency_hash
      ) VALUES (
        v_billing_account_id, p_environment, v_lot.source_transaction_id,
        v_lot.product_id, 'export_reserved', v_allocate, NULL, FALSE,
        iap_private.sha256_text(v_reservation.reservation_id::TEXT),
        iap_private.sha256_text(
          'export-reserve|' || v_reservation.reservation_id::TEXT || '|'
          || p_environment || '|' || v_lot.source_transaction_id
        )
      );
      v_remaining := v_remaining - v_allocate;
    END IF;
    EXIT WHEN v_remaining = 0;
  END LOOP;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Exact export-credit allocation failed closed';
  END IF;

  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (
    v_billing_account_id, p_environment, v_reservation.reservation_id,
    'reserve', -p_amount
  );
  RETURN QUERY SELECT v_reservation.reservation_id, 'reserved'::TEXT, FALSE,
    iap_private.credit_balance(v_billing_account_id, p_environment),
    iap_private.open_reserved_credits(v_billing_account_id, p_environment);
END;
$$;

CREATE OR REPLACE FUNCTION public.iap_export_credit_commit(p_reservation_id UUID)
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
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501',
    MESSAGE = 'Client export commit is retired; server fulfillment confirmation is required';
END;
$$;

-- A successful PDF/item fulfillment service supplies only an artifact hash and
-- an operation idempotency hash. The function atomically commits the exact lots
-- and records DELIVERED only after that trusted server callback.
CREATE FUNCTION public.iap_export_credit_commit_after_fulfillment(
  p_reservation_id UUID,
  p_fulfillment_entity_hash TEXT,
  p_fulfillment_idempotency_hash TEXT,
  p_sample_content_provided BOOLEAN
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
  v_user_id UUID;
  v_reservation iap_private.export_credit_reservations%ROWTYPE;
  v_allocated BIGINT;
  v_allocation_count BIGINT;
  v_evidence_count BIGINT;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_reservation_id IS NULL
     OR NOT iap_private.is_sha256_hex(p_fulfillment_entity_hash)
     OR NOT iap_private.is_sha256_hex(p_fulfillment_idempotency_hash)
     OR p_sample_content_provided IS NULL THEN
    RAISE EXCEPTION 'Invalid server fulfillment confirmation';
  END IF;

  SELECT binding.user_id INTO v_user_id
  FROM iap_private.export_credit_reservations AS reservation
  JOIN iap_private.apple_account_bindings AS binding
    ON binding.billing_account_id = reservation.billing_account_id
  WHERE reservation.reservation_id = p_reservation_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IAP account binding is unavailable';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  PERFORM 1 FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_user_id AND binding.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'IAP account binding is unavailable';
  END IF;

  SELECT reservation.* INTO v_reservation
  FROM iap_private.export_credit_reservations AS reservation
  WHERE reservation.reservation_id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Export reservation is unavailable'; END IF;
  IF v_reservation.status = 'released' THEN
    RAISE EXCEPTION 'Released export reservation cannot be committed';
  END IF;

  IF v_reservation.status = 'committed' THEN
    SELECT count(*)::BIGINT, COALESCE(sum(allocation.milliunits), 0)::BIGINT
    INTO v_allocation_count, v_allocated
    FROM iap_private.export_credit_allocations AS allocation
    WHERE allocation.reservation_id = v_reservation.reservation_id
      AND allocation.status = 'committed';
    IF v_allocation_count = 0
       OR v_allocated <> v_reservation.amount * 100000 THEN
      RAISE EXCEPTION 'Committed reservation lacks exact fulfillment evidence';
    END IF;

    SELECT count(*)::BIGINT INTO v_evidence_count
    FROM iap_private.export_credit_allocations AS allocation
    JOIN iap_private.fulfillment_usage_evidence AS evidence
      ON evidence.billing_account_id = allocation.billing_account_id
      AND evidence.environment = allocation.environment
      AND evidence.source_transaction_id = allocation.source_transaction_id
      AND evidence.event_kind = 'export_committed'
      AND evidence.idempotency_hash = iap_private.sha256_text(
        'export-commit-v2|' || p_fulfillment_idempotency_hash || '|'
        || allocation.environment || '|' || allocation.source_transaction_id
      )
    WHERE allocation.reservation_id = v_reservation.reservation_id
      AND allocation.status = 'committed'
      AND evidence.entity_hash = p_fulfillment_entity_hash
      AND evidence.delivery_status = 'DELIVERED'
      AND evidence.sample_content_provided = p_sample_content_provided;
    IF v_evidence_count <> v_allocation_count THEN
      RAISE EXCEPTION 'Server fulfillment idempotency collision';
    END IF;
    RETURN QUERY SELECT v_reservation.reservation_id, 'committed'::TEXT, TRUE,
      iap_private.credit_balance(v_reservation.billing_account_id, v_reservation.environment),
      iap_private.open_reserved_credits(v_reservation.billing_account_id, v_reservation.environment);
    RETURN;
  END IF;

  SELECT COALESCE(sum(allocation.milliunits), 0)::BIGINT INTO v_allocated
  FROM iap_private.export_credit_allocations AS allocation
  WHERE allocation.reservation_id = v_reservation.reservation_id
    AND allocation.status = 'reserved';
  IF v_allocated <> v_reservation.amount * 100000 THEN
    RAISE EXCEPTION 'Reservation allocation is incomplete';
  END IF;

  WITH committed AS (
    UPDATE iap_private.export_credit_allocations AS allocation
    SET status = 'committed', updated_at = clock_timestamp()
    WHERE allocation.reservation_id = v_reservation.reservation_id
      AND allocation.status = 'reserved'
    RETURNING allocation.billing_account_id, allocation.environment,
      allocation.source_transaction_id, allocation.milliunits
  )
  INSERT INTO iap_private.fulfillment_usage_evidence (
    billing_account_id, environment, source_transaction_id, product_id,
    event_kind, units_milliunits, delivery_status, sample_content_provided,
    entity_hash, idempotency_hash
  )
  SELECT committed.billing_account_id, committed.environment,
    committed.source_transaction_id, lot.product_id,
    'export_committed', committed.milliunits, 'DELIVERED',
    p_sample_content_provided, p_fulfillment_entity_hash,
    iap_private.sha256_text(
      'export-commit-v2|' || p_fulfillment_idempotency_hash || '|'
      || committed.environment || '|' || committed.source_transaction_id
    )
  FROM committed
  JOIN iap_private.export_credit_lots AS lot
    ON lot.billing_account_id = committed.billing_account_id
    AND lot.environment = committed.environment
    AND lot.source_transaction_id = committed.source_transaction_id;

  UPDATE iap_private.apple_consumption_requests AS request
  SET next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE request.billing_account_id = v_reservation.billing_account_id
    AND request.environment = v_reservation.environment
    AND request.status = 'pending_evidence'
    AND EXISTS (
      SELECT 1 FROM iap_private.export_credit_allocations AS allocation
      WHERE allocation.reservation_id = v_reservation.reservation_id
        AND allocation.source_transaction_id = request.transaction_id
    );

  UPDATE iap_private.export_credit_reservations AS reservation
  SET status = 'committed', updated_at = clock_timestamp()
  WHERE reservation.reservation_id = v_reservation.reservation_id;
  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (
    v_reservation.billing_account_id, v_reservation.environment,
    v_reservation.reservation_id, 'commit', 0
  ) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT v_reservation.reservation_id, 'committed'::TEXT, FALSE,
    iap_private.credit_balance(v_reservation.billing_account_id, v_reservation.environment),
    iap_private.open_reserved_credits(v_reservation.billing_account_id, v_reservation.environment);
END;
$$;

CREATE OR REPLACE FUNCTION public.iap_export_credit_release(p_reservation_id UUID)
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Not authenticated';
  END IF;
  IF p_reservation_id IS NULL THEN RAISE EXCEPTION 'Invalid export credit reservation'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_uid::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT binding.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = v_uid AND binding.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IAP account binding is unavailable'; END IF;
  SELECT reservation.* INTO v_reservation
  FROM iap_private.export_credit_reservations AS reservation
  WHERE reservation.reservation_id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND OR v_reservation.billing_account_id IS DISTINCT FROM v_billing_account_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Reservation is not owned by this account';
  END IF;
  IF v_reservation.status = 'committed' THEN
    RAISE EXCEPTION 'Committed export reservation cannot be released';
  END IF;
  IF v_reservation.status = 'released' THEN
    RETURN QUERY SELECT v_reservation.reservation_id, 'released'::TEXT, TRUE,
      iap_private.credit_balance(v_billing_account_id, v_reservation.environment),
      iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
    RETURN;
  END IF;
  UPDATE iap_private.export_credit_reservations AS reservation
  SET status = 'released', updated_at = clock_timestamp()
  WHERE reservation.reservation_id = v_reservation.reservation_id;
  INSERT INTO iap_private.export_credit_ledger (
    billing_account_id, environment, reservation_id, entry_kind, amount
  ) VALUES (
    v_billing_account_id, v_reservation.environment,
    v_reservation.reservation_id, 'release', v_reservation.amount
  ) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT v_reservation.reservation_id, 'released'::TEXT, FALSE,
    iap_private.credit_balance(v_billing_account_id, v_reservation.environment),
    iap_private.open_reserved_credits(v_billing_account_id, v_reservation.environment);
END;
$$;

CREATE OR REPLACE FUNCTION public.iap_prepare_account_deletion_v2(
  p_user_id UUID,
  p_attempt_id UUID
)
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
  v_phase TEXT;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_user_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'Invalid account deletion payload' USING ERRCODE = '22004';
  END IF;

  -- This acquires the canonical namespace-15013 account lock and proves the
  -- exact deletion attempt. A pre-authorization claim loses to this update;
  -- send_started is the already-linearized external call boundary.
  v_phase := public.lock_account_deletion_attempt_v2(p_user_id, p_attempt_id);
  IF v_phase IS DISTINCT FROM 'solo_cleanup_complete' THEN
    RAISE EXCEPTION 'illegal_account_deletion_phase' USING ERRCODE = '55000';
  END IF;

  SELECT binding.billing_account_id INTO v_billing_account_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'cancelled', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'ACCOUNT_DELETED', updated_at = clock_timestamp()
    WHERE request.billing_account_id = v_billing_account_id
      AND request.status IN (
        'pending_evidence', 'queued', 'retryable_failed', 'in_flight'
      );

    UPDATE iap_private.apple_account_bindings AS binding
    SET user_id = NULL, app_account_token = NULL,
        deleted_at = COALESCE(binding.deleted_at, clock_timestamp())
    WHERE binding.billing_account_id = v_billing_account_id
      AND binding.user_id = p_user_id;

    UPDATE iap_private.entitlements AS entitlement
    SET active = FALSE, updated_at = clock_timestamp()
    WHERE entitlement.billing_account_id = v_billing_account_id
      AND entitlement.active;
    GET DIAGNOSTICS v_entitlements = ROW_COUNT;

    WITH released AS (
      UPDATE iap_private.export_credit_reservations AS reservation
      SET status = 'released', updated_at = clock_timestamp()
      WHERE reservation.billing_account_id = v_billing_account_id
        AND reservation.status = 'reserved'
      RETURNING reservation.reservation_id, reservation.environment,
        reservation.amount
    )
    INSERT INTO iap_private.export_credit_ledger (
      billing_account_id, environment, reservation_id, entry_kind, amount
    )
    SELECT v_billing_account_id, released.environment,
      released.reservation_id, 'account_deletion', released.amount
    FROM released;
    GET DIAGNOSTICS v_reservations = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT TRUE, v_entitlements, v_reservations,
    (SELECT count(*) FROM iap_private.apple_transactions AS transaction
      WHERE transaction.billing_account_id = v_billing_account_id),
    (SELECT count(*) FROM iap_private.apple_notifications AS notification
      WHERE EXISTS (
        SELECT 1 FROM iap_private.apple_transactions AS transaction
        WHERE transaction.billing_account_id = v_billing_account_id
          AND transaction.environment = notification.environment
          AND transaction.transaction_id = notification.transaction_id
      )),
    (SELECT count(*) FROM iap_private.export_credit_ledger AS ledger
      WHERE ledger.billing_account_id = v_billing_account_id);
END;
$$;

CREATE FUNCTION public.iap_apply_verified_transaction_v2(
  p_user_id UUID,
  p_environment TEXT,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_product_id TEXT,
  p_product_type TEXT,
  p_bundle_id TEXT,
  p_app_account_token_hash TEXT,
  p_purchase_date_ms BIGINT,
  p_signed_date_ms BIGINT,
  p_expires_date_ms BIGINT,
  p_revocation_date_ms BIGINT,
  p_event_kind TEXT,
  p_payload_hash TEXT,
  p_quantity INTEGER,
  p_revocation_type TEXT,
  p_revocation_percentage INTEGER,
  p_notification_uuid UUID DEFAULT NULL
)
RETURNS TABLE (
  accepted BOOLEAN,
  duplicate BOOLEAN,
  stale BOOLEAN,
  environment TEXT,
  transaction_id TEXT,
  entitlement_active BOOLEAN,
  export_credits BIGINT,
  resolution_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_catalog iap_private.apple_product_catalog%ROWTYPE;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_existing iap_private.apple_transactions%ROWTYPE;
  v_existing_event iap_private.apple_transaction_events%ROWTYPE;
  v_lot iap_private.export_credit_lots%ROWTYPE;
  v_old_result RECORD;
  v_previous_adjustment RECORD;
  v_original_owner UUID;
  v_product_type TEXT;
  v_effective_event_kind TEXT := p_event_kind;
  v_signed_at TIMESTAMPTZ;
  v_purchase_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_revocation_at TIMESTAMPTZ;
  v_had_existing BOOLEAN := FALSE;
  v_is_stale BOOLEAN := FALSE;
  v_event_id UUID;
  v_resolution TEXT := 'automatic';
  v_credit_units BIGINT;
  v_gross_milliunits BIGINT;
  v_percentage INTEGER;
  v_desired_target BIGINT;
  v_committed BIGINT := 0;
  v_before BIGINT := 0;
  v_after BIGINT := 0;
  v_active BOOLEAN := FALSE;
  v_reservation_id UUID;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_user_id IS NULL
     OR p_environment NOT IN ('Sandbox', 'Production', 'Xcode')
     OR NOT iap_private.is_uint64_text(p_transaction_id)
     OR NOT iap_private.is_uint64_text(p_original_transaction_id)
     OR p_product_id IS NULL OR p_product_type IS NULL OR p_bundle_id IS NULL
     OR NOT iap_private.is_sha256_hex(p_app_account_token_hash)
     OR p_purchase_date_ms IS NULL OR p_purchase_date_ms <= 0
     OR p_signed_date_ms IS NULL OR p_signed_date_ms <= 0
     OR p_expires_date_ms IS NOT NULL AND p_expires_date_ms <= 0
     OR p_revocation_date_ms IS NOT NULL AND p_revocation_date_ms <= 0
     OR p_event_kind NOT IN ('purchase', 'refund', 'revoke', 'refund_reversed')
     OR NOT iap_private.is_sha256_hex(p_payload_hash)
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10
     OR p_revocation_type IS NOT NULL AND p_revocation_type NOT IN (
       'REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE'
     )
     OR p_revocation_percentage IS NOT NULL
       AND p_revocation_percentage NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Invalid verified Apple transaction V2';
  END IF;
  IF p_event_kind IN ('purchase', 'refund_reversed')
     AND (p_revocation_date_ms IS NOT NULL OR p_revocation_type IS NOT NULL
       OR p_revocation_percentage IS NOT NULL) THEN
    RAISE EXCEPTION 'Non-revoked Apple event contains revocation fields';
  END IF;
  IF p_event_kind IN ('refund', 'revoke') AND p_revocation_date_ms IS NULL THEN
    RAISE EXCEPTION 'Revoked Apple event requires revocationDate';
  END IF;
  IF p_revocation_type = 'REFUND_PRORATED'
     AND (p_revocation_percentage IS NULL OR p_revocation_percentage NOT BETWEEN 1 AND 99999) THEN
    RAISE EXCEPTION 'Prorated refund percentage is invalid';
  END IF;
  IF p_revocation_type IN ('REFUND_FULL', 'FAMILY_REVOKE')
     AND p_revocation_percentage IS NOT NULL
     AND p_revocation_percentage <> 100000 THEN
    RAISE EXCEPTION 'Full revocation percentage is invalid';
  END IF;

  v_product_type := CASE p_product_type
    WHEN 'Non-Consumable' THEN 'non_consumable'
    WHEN 'Consumable' THEN 'consumable'
    WHEN 'Auto-Renewable Subscription' THEN 'subscription'
    ELSE NULL
  END;
  IF v_product_type IS NULL THEN
    RAISE EXCEPTION 'Unsupported verified Apple product type';
  END IF;
  v_signed_at := to_timestamp(p_signed_date_ms / 1000.0);
  v_purchase_at := to_timestamp(p_purchase_date_ms / 1000.0);
  v_expires_at := CASE WHEN p_expires_date_ms IS NULL
    THEN NULL ELSE to_timestamp(p_expires_date_ms / 1000.0) END;
  v_revocation_at := CASE WHEN p_revocation_date_ms IS NULL
    THEN NULL ELSE to_timestamp(p_revocation_date_ms / 1000.0) END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::TEXT, 15013)
  );
  IF iap_private.is_account_deletion_pending(p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Account deletion is pending';
  END IF;
  SELECT catalog.* INTO v_catalog
  FROM iap_private.apple_product_catalog AS catalog
  WHERE catalog.environment = p_environment
    AND catalog.product_id = p_product_id
    AND catalog.bundle_id = p_bundle_id;
  IF NOT FOUND OR v_catalog.product_type IS DISTINCT FROM v_product_type THEN
    RAISE EXCEPTION 'Apple product is not in the reviewed catalog or its type differs';
  END IF;
  IF v_product_type = 'subscription' AND p_event_kind = 'purchase' AND v_expires_at IS NULL THEN
    RAISE EXCEPTION 'Subscription transaction requires expiresDate';
  END IF;
  SELECT binding.* INTO v_binding
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_binding.deleted_at IS NOT NULL
     OR v_binding.app_account_token_hash IS DISTINCT FROM p_app_account_token_hash THEN
    RAISE EXCEPTION 'Apple account binding mismatch';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_environment || ':' || p_original_transaction_id, 0)
  );
  SELECT tx.billing_account_id INTO v_original_owner
  FROM iap_private.apple_transactions AS tx
  WHERE tx.environment = p_environment
    AND tx.original_transaction_id = p_original_transaction_id
  ORDER BY tx.signed_at, tx.transaction_id
  LIMIT 1;
  IF v_original_owner IS NOT NULL
     AND v_original_owner IS DISTINCT FROM v_binding.billing_account_id THEN
    RAISE EXCEPTION 'Apple original transaction belongs to another account';
  END IF;

  SELECT tx.* INTO v_existing
  FROM iap_private.apple_transactions AS tx
  WHERE tx.environment = p_environment AND tx.transaction_id = p_transaction_id
  FOR UPDATE;
  v_had_existing := FOUND;
  IF v_had_existing THEN
    IF v_existing.billing_account_id IS DISTINCT FROM v_binding.billing_account_id
       OR v_existing.original_transaction_id IS DISTINCT FROM p_original_transaction_id
       OR v_existing.product_id IS DISTINCT FROM p_product_id
       OR v_existing.product_type IS DISTINCT FROM v_product_type
       OR v_existing.bundle_id IS DISTINCT FROM p_bundle_id
       OR v_existing.app_account_token_hash IS DISTINCT FROM p_app_account_token_hash
       OR v_existing.purchase_at IS DISTINCT FROM v_purchase_at
       OR v_existing.quantity IS DISTINCT FROM p_quantity THEN
      RAISE EXCEPTION 'Apple transaction identity conflict';
    END IF;
    IF p_event_kind = 'purchase' AND p_revocation_date_ms IS NULL
       AND v_existing.status = 'refunded'
       AND v_existing.last_event_kind = 'refund'
       AND v_signed_at > v_existing.signed_at THEN
      v_effective_event_kind := 'refund_reversed';
    ELSIF p_event_kind = 'purchase' AND p_revocation_date_ms IS NULL
       AND v_existing.last_event_kind = 'refund_reversed'
       AND v_signed_at = v_existing.signed_at
       AND v_existing.payload_hash = p_payload_hash THEN
      v_effective_event_kind := 'refund_reversed';
    END IF;
  END IF;

  SELECT event.* INTO v_existing_event
  FROM iap_private.apple_transaction_events AS event
  WHERE event.environment = p_environment
    AND event.transaction_id = p_transaction_id
    AND event.signed_at = v_signed_at;
  IF FOUND THEN
    IF v_existing_event.payload_hash IS DISTINCT FROM p_payload_hash
       OR v_existing_event.event_kind IS DISTINCT FROM v_effective_event_kind
       OR v_existing_event.quantity IS DISTINCT FROM p_quantity
       OR v_existing_event.revocation_type IS DISTINCT FROM p_revocation_type
       OR v_existing_event.revocation_percentage IS DISTINCT FROM p_revocation_percentage THEN
      RAISE EXCEPTION 'Apple transaction signedDate payload collision';
    END IF;
    RETURN QUERY SELECT TRUE, TRUE, v_existing_event.resolution_status = 'stale',
      p_environment, p_transaction_id, FALSE,
      iap_private.credit_balance(v_binding.billing_account_id, p_environment),
      CASE WHEN v_existing_event.resolution_status = 'manual_review'
        THEN 'manual_review' ELSE v_existing.resolution_status END;
    RETURN;
  END IF;

  -- Reuse the established 077 entitlement projection. Its pooled consumable
  -- branch is never reached here, and its public execute grant is revoked below.
  IF v_product_type <> 'consumable' THEN
    SELECT * INTO v_old_result
    FROM public.iap_apply_verified_transaction(
      p_user_id, p_environment, p_transaction_id, p_original_transaction_id,
      p_product_id, p_product_type, p_bundle_id, p_app_account_token_hash,
      p_purchase_date_ms, p_signed_date_ms, p_expires_date_ms,
      p_revocation_date_ms, p_event_kind, p_payload_hash, NULL, NULL
    );
    UPDATE iap_private.apple_transactions AS tx
    SET quantity = p_quantity,
        revocation_type = CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
          THEN p_revocation_type ELSE NULL END,
        revocation_percentage = CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
          THEN p_revocation_percentage ELSE NULL END,
        contract_version = 2,
        resolution_status = 'automatic'
    WHERE tx.environment = p_environment AND tx.transaction_id = p_transaction_id
      AND NOT v_old_result.stale;
    INSERT INTO iap_private.apple_transaction_events (
      billing_account_id, environment, transaction_id, original_transaction_id,
      product_id, event_kind, quantity, revocation_type,
      revocation_percentage, signed_at, payload_hash, resolution_status,
      notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id,
      CASE WHEN v_old_result.stale THEN p_event_kind
        ELSE (SELECT tx.last_event_kind FROM iap_private.apple_transactions AS tx
          WHERE tx.environment = p_environment AND tx.transaction_id = p_transaction_id) END,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash,
      CASE WHEN v_old_result.stale THEN 'stale' ELSE 'automatic' END,
      p_notification_uuid
    );
    RETURN QUERY SELECT v_old_result.accepted, v_old_result.duplicate,
      v_old_result.stale, p_environment, p_transaction_id,
      v_old_result.entitlement_active, v_old_result.export_credits,
      CASE WHEN v_old_result.stale THEN 'automatic' ELSE 'automatic' END;
    RETURN;
  END IF;

  IF v_catalog.credit_amount <= 0
     OR v_catalog.credit_amount > 9223372036854
     OR v_catalog.credit_amount * p_quantity > 92233720368547 THEN
    RAISE EXCEPTION 'Consumable catalog credit amount exceeds exact-ledger bounds';
  END IF;
  v_credit_units := v_catalog.credit_amount * p_quantity;
  v_gross_milliunits := v_credit_units * 100000;

  IF v_had_existing AND (
    v_existing.contract_version <> 2
    OR NOT EXISTS (
      SELECT 1 FROM iap_private.export_credit_lots AS lot
      WHERE lot.environment = p_environment
        AND lot.source_transaction_id = p_transaction_id
        AND lot.attribution_status = 'exact'
    )
  ) THEN
    INSERT INTO iap_private.apple_transaction_events (
      billing_account_id, environment, transaction_id, original_transaction_id,
      product_id, event_kind, quantity, revocation_type,
      revocation_percentage, signed_at, payload_hash, resolution_status,
      notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id, v_effective_event_kind,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash, 'manual_review', p_notification_uuid
    );
    RETURN QUERY SELECT TRUE, FALSE, FALSE, p_environment, p_transaction_id,
      FALSE, iap_private.credit_balance(v_binding.billing_account_id, p_environment),
      'manual_review'::TEXT;
    RETURN;
  END IF;

  IF v_had_existing AND v_signed_at < v_existing.signed_at THEN
    INSERT INTO iap_private.apple_transaction_events (
      billing_account_id, environment, transaction_id, original_transaction_id,
      product_id, event_kind, quantity, revocation_type,
      revocation_percentage, signed_at, payload_hash, resolution_status,
      notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id, v_effective_event_kind,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash, 'stale', p_notification_uuid
    );
    RETURN QUERY SELECT FALSE, FALSE, TRUE, p_environment, p_transaction_id,
      FALSE, iap_private.credit_balance(v_binding.billing_account_id, p_environment),
      v_existing.resolution_status;
    RETURN;
  END IF;
  IF v_had_existing AND v_signed_at = v_existing.signed_at THEN
    IF v_existing.payload_hash IS DISTINCT FROM p_payload_hash
       OR v_existing.last_event_kind IS DISTINCT FROM v_effective_event_kind THEN
      RAISE EXCEPTION 'Apple transaction signedDate payload conflict';
    END IF;
    RETURN QUERY SELECT TRUE, TRUE, FALSE, p_environment, p_transaction_id,
      FALSE, iap_private.credit_balance(v_binding.billing_account_id, p_environment),
      v_existing.resolution_status;
    RETURN;
  END IF;

  IF NOT v_had_existing THEN
    v_resolution := CASE WHEN v_effective_event_kind = 'purchase'
      THEN 'automatic' ELSE 'manual_review' END;
    INSERT INTO iap_private.apple_transactions (
      environment, transaction_id, original_transaction_id, billing_account_id,
      product_id, product_type, bundle_id, app_account_token_hash,
      purchase_at, expires_at, revocation_at, status, last_event_kind,
      credit_granted, signed_at, payload_hash, quantity, revocation_type,
      revocation_percentage, contract_version, resolution_status
    ) VALUES (
      p_environment, p_transaction_id, p_original_transaction_id,
      v_binding.billing_account_id, p_product_id, 'consumable', p_bundle_id,
      p_app_account_token_hash, v_purchase_at, NULL,
      CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
        THEN COALESCE(v_revocation_at, v_signed_at) ELSE NULL END,
      CASE WHEN v_effective_event_kind = 'refund' THEN 'refunded'
        WHEN v_effective_event_kind = 'revoke' THEN 'revoked' ELSE 'active' END,
      v_effective_event_kind, v_credit_units, v_signed_at, p_payload_hash,
      p_quantity, p_revocation_type, p_revocation_percentage, 2, v_resolution
    );
    INSERT INTO iap_private.export_credit_lots (
      billing_account_id, environment, source_transaction_id, product_id,
      gross_milliunits, attribution_status, purchased_at
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_product_id, v_gross_milliunits,
      CASE WHEN v_resolution = 'automatic' THEN 'exact' ELSE 'manual_review' END,
      v_purchase_at
    ) RETURNING * INTO v_lot;
    INSERT INTO iap_private.apple_transaction_events (
      billing_account_id, environment, transaction_id, original_transaction_id,
      product_id, event_kind, quantity, revocation_type,
      revocation_percentage, signed_at, payload_hash, resolution_status,
      notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id, v_effective_event_kind,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash, v_resolution, p_notification_uuid
    ) RETURNING event_id INTO v_event_id;
    RETURN QUERY SELECT TRUE, FALSE, FALSE, p_environment, p_transaction_id,
      FALSE, iap_private.credit_balance(v_binding.billing_account_id, p_environment),
      v_resolution;
    RETURN;
  END IF;

  SELECT lot.* INTO v_lot
  FROM iap_private.export_credit_lots AS lot
  WHERE lot.billing_account_id = v_binding.billing_account_id
    AND lot.environment = p_environment
    AND lot.source_transaction_id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_lot.attribution_status <> 'exact'
     OR v_lot.gross_milliunits IS DISTINCT FROM v_gross_milliunits THEN
    RAISE EXCEPTION 'Exact consumable lot identity mismatch';
  END IF;

  v_before := v_lot.reclaimed_milliunits;
  v_after := v_before;
  IF v_effective_event_kind IN ('refund', 'revoke') THEN
    IF p_revocation_type IS NULL THEN
      v_resolution := 'manual_review';
    ELSE
      v_percentage := COALESCE(p_revocation_percentage, 100000);
      v_desired_target := CEIL(
        (v_lot.gross_milliunits::NUMERIC * v_percentage::NUMERIC) / 100000::NUMERIC
      )::BIGINT;

      FOR v_reservation_id IN
        SELECT DISTINCT allocation.reservation_id
        FROM iap_private.export_credit_allocations AS allocation
        JOIN iap_private.export_credit_reservations AS reservation
          ON reservation.reservation_id = allocation.reservation_id
        WHERE allocation.billing_account_id = v_binding.billing_account_id
          AND allocation.environment = p_environment
          AND allocation.source_transaction_id = p_transaction_id
          AND allocation.status = 'reserved'
          AND reservation.status = 'reserved'
        ORDER BY allocation.reservation_id
      LOOP
        UPDATE iap_private.export_credit_reservations AS reservation
        SET status = 'released', updated_at = clock_timestamp()
        WHERE reservation.reservation_id = v_reservation_id
          AND reservation.status = 'reserved';
      END LOOP;

      SELECT COALESCE(sum(allocation.milliunits), 0)::BIGINT INTO v_committed
      FROM iap_private.export_credit_allocations AS allocation
      WHERE allocation.billing_account_id = v_binding.billing_account_id
        AND allocation.environment = p_environment
        AND allocation.source_transaction_id = p_transaction_id
        AND allocation.status = 'committed';
      v_after := GREATEST(
        v_before,
        LEAST(v_desired_target, v_lot.gross_milliunits - v_committed)
      );
      UPDATE iap_private.export_credit_lots AS lot
      SET refund_target_milliunits = GREATEST(lot.refund_target_milliunits, v_desired_target),
          reclaimed_milliunits = v_after,
          updated_at = clock_timestamp()
      WHERE lot.environment = p_environment
        AND lot.source_transaction_id = p_transaction_id;
    END IF;
  ELSIF v_effective_event_kind = 'refund_reversed' THEN
    IF v_existing.last_event_kind <> 'refund' THEN
      v_resolution := 'manual_review';
    ELSE
      SELECT adjustment.reclaimed_before_milliunits,
        adjustment.reclaimed_after_milliunits
      INTO v_previous_adjustment
      FROM iap_private.apple_transaction_events AS event
      JOIN iap_private.export_credit_lot_adjustments AS adjustment
        ON adjustment.event_id = event.event_id
      WHERE event.environment = p_environment
        AND event.transaction_id = p_transaction_id
        AND event.signed_at = v_existing.signed_at
        AND event.event_kind = 'refund';
      IF NOT FOUND THEN
        v_resolution := 'manual_review';
      ELSE
        v_after := v_previous_adjustment.reclaimed_before_milliunits;
        IF v_after > v_before THEN
          RAISE EXCEPTION 'Refund reversal exceeds prior reclaimed units';
        END IF;
        UPDATE iap_private.export_credit_lots AS lot
        SET refund_target_milliunits = LEAST(lot.refund_target_milliunits, v_after),
            reclaimed_milliunits = v_after,
            updated_at = clock_timestamp()
        WHERE lot.environment = p_environment
          AND lot.source_transaction_id = p_transaction_id;
      END IF;
    END IF;
  END IF;

  UPDATE iap_private.apple_transactions AS tx
  SET revocation_at = CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
        THEN COALESCE(v_revocation_at, v_signed_at) ELSE NULL END,
      status = CASE WHEN v_effective_event_kind = 'refund' THEN 'refunded'
        WHEN v_effective_event_kind = 'revoke' THEN 'revoked' ELSE 'active' END,
      last_event_kind = v_effective_event_kind,
      signed_at = v_signed_at,
      payload_hash = p_payload_hash,
      revocation_type = CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
        THEN p_revocation_type ELSE NULL END,
      revocation_percentage = CASE WHEN v_effective_event_kind IN ('refund', 'revoke')
        THEN p_revocation_percentage ELSE NULL END,
      resolution_status = v_resolution,
      updated_at = clock_timestamp()
  WHERE tx.environment = p_environment AND tx.transaction_id = p_transaction_id;

  INSERT INTO iap_private.apple_transaction_events (
    billing_account_id, environment, transaction_id, original_transaction_id,
    product_id, event_kind, quantity, revocation_type,
    revocation_percentage, signed_at, payload_hash, resolution_status,
    notification_uuid
  ) VALUES (
    v_binding.billing_account_id, p_environment, p_transaction_id,
    p_original_transaction_id, p_product_id, v_effective_event_kind,
    p_quantity, p_revocation_type, p_revocation_percentage,
    v_signed_at, p_payload_hash, v_resolution, p_notification_uuid
  ) RETURNING event_id INTO v_event_id;

  IF v_resolution = 'automatic'
     AND v_effective_event_kind IN ('refund', 'revoke', 'refund_reversed') THEN
    INSERT INTO iap_private.export_credit_lot_adjustments (
      event_id, billing_account_id, environment, source_transaction_id,
      reclaimed_before_milliunits, reclaimed_after_milliunits, delta_milliunits
    ) VALUES (
      v_event_id, v_binding.billing_account_id, p_environment, p_transaction_id,
      v_before, v_after, v_after - v_before
    );
    INSERT INTO iap_private.fulfillment_usage_evidence (
      billing_account_id, environment, source_transaction_id, product_id,
      event_kind, units_milliunits, delivery_status, sample_content_provided,
      entity_hash, idempotency_hash
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id, p_product_id,
      CASE WHEN v_effective_event_kind = 'refund_reversed'
        THEN 'refund_reversed' ELSE 'refund_reclaimed' END,
      abs(v_after - v_before), NULL, v_catalog.sample_content_provided,
      iap_private.sha256_text(p_environment || '|' || p_transaction_id),
      iap_private.sha256_text(
        'lot-adjustment|' || p_environment || '|' || p_transaction_id || '|'
        || p_signed_date_ms::TEXT
      )
    );
  END IF;

  RETURN QUERY SELECT TRUE, FALSE, FALSE, p_environment, p_transaction_id,
    v_active, iap_private.credit_balance(v_binding.billing_account_id, p_environment),
    v_resolution;
END;
$$;

CREATE FUNCTION public.iap_process_verified_notification_v2(
  p_notification_uuid UUID,
  p_environment TEXT,
  p_notification_type TEXT,
  p_subtype TEXT,
  p_notification_transaction_id TEXT,
  p_notification_original_transaction_id TEXT,
  p_notification_signed_date_ms BIGINT,
  p_notification_payload_hash TEXT,
  p_received_at_ms BIGINT,
  p_consumption_request_reason TEXT DEFAULT NULL,
  p_transaction_id TEXT DEFAULT NULL,
  p_transaction_original_transaction_id TEXT DEFAULT NULL,
  p_product_id TEXT DEFAULT NULL,
  p_product_type TEXT DEFAULT NULL,
  p_bundle_id TEXT DEFAULT NULL,
  p_app_account_token_hash TEXT DEFAULT NULL,
  p_purchase_date_ms BIGINT DEFAULT NULL,
  p_transaction_signed_date_ms BIGINT DEFAULT NULL,
  p_expires_date_ms BIGINT DEFAULT NULL,
  p_revocation_date_ms BIGINT DEFAULT NULL,
  p_event_kind TEXT DEFAULT NULL,
  p_transaction_payload_hash TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT NULL,
  p_revocation_type TEXT DEFAULT NULL,
  p_revocation_percentage INTEGER DEFAULT NULL
)
RETURNS TABLE (
  notification_uuid UUID,
  duplicate BOOLEAN,
  stale BOOLEAN,
  transaction_applied BOOLEAN,
  transaction_id TEXT,
  entitlement_active BOOLEAN,
  export_credits BIGINT,
  consumption_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim RECORD;
  v_applied RECORD;
  v_has_transaction BOOLEAN;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_transaction iap_private.apple_transactions%ROWTYPE;
  v_catalog iap_private.apple_product_catalog%ROWTYPE;
  v_consent iap_private.refund_data_consent_events%ROWTYPE;
  v_delivery iap_private.fulfillment_usage_evidence%ROWTYPE;
  v_product_type TEXT;
  v_status TEXT;
  v_received_at TIMESTAMPTZ;
  v_percentage INTEGER;
  v_committed BIGINT;
  v_gross BIGINT;
  v_body_hash TEXT;
  v_candidate_count BIGINT;
  v_candidate_billing_account_id UUID;
  v_resolved_user_id UUID;
  v_review_reason TEXT;
BEGIN
  PERFORM iap_private.require_service_role();
  PERFORM set_config('iap.atomic_notification', 'on', true);

  IF p_received_at_ms IS NULL
     OR p_received_at_ms NOT BETWEEN 946684800000 AND 32503680000000
     OR p_received_at_ms > floor(
       extract(epoch FROM clock_timestamp() + INTERVAL '5 minutes') * 1000
     )::BIGINT THEN
    RAISE EXCEPTION 'Notification ingress time is invalid';
  END IF;
  v_received_at := to_timestamp(p_received_at_ms / 1000.0);

  IF p_notification_type = 'CONSUMPTION_REQUEST' THEN
    IF p_consumption_request_reason NOT IN (
      'UNINTENDED_PURCHASE', 'FULFILLMENT_ISSUE',
      'UNSATISFIED_WITH_PURCHASE', 'LEGAL', 'OTHER'
    ) THEN
      RAISE EXCEPTION 'Consumption request reason is invalid';
    END IF;
  ELSIF p_consumption_request_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Consumption reason is only valid for CONSUMPTION_REQUEST';
  END IF;

  v_has_transaction := p_transaction_id IS NOT NULL
    OR p_transaction_original_transaction_id IS NOT NULL
    OR p_product_id IS NOT NULL
    OR p_product_type IS NOT NULL
    OR p_bundle_id IS NOT NULL
    OR p_app_account_token_hash IS NOT NULL
    OR p_purchase_date_ms IS NOT NULL
    OR p_transaction_signed_date_ms IS NOT NULL
    OR p_expires_date_ms IS NOT NULL
    OR p_revocation_date_ms IS NOT NULL
    OR p_event_kind IS NOT NULL
    OR p_transaction_payload_hash IS NOT NULL
    OR p_quantity IS NOT NULL
    OR p_revocation_type IS NOT NULL
    OR p_revocation_percentage IS NOT NULL;

  IF v_has_transaction AND (
    p_transaction_id IS NULL
    OR p_transaction_original_transaction_id IS NULL
    OR p_product_id IS NULL
    OR p_product_type IS NULL
    OR p_bundle_id IS NULL
    OR p_purchase_date_ms IS NULL
    OR p_transaction_signed_date_ms IS NULL
    OR p_transaction_payload_hash IS NULL
    OR p_quantity IS NULL
  ) THEN
    RAISE EXCEPTION 'Optional verified transaction claims are incomplete';
  END IF;
  IF p_notification_type IN (
       'REFUND', 'REVOKE', 'REFUND_REVERSED', 'CONSUMPTION_REQUEST'
     ) AND NOT v_has_transaction THEN
    RAISE EXCEPTION 'Notification requires a verified nested transaction';
  END IF;
  IF p_notification_type <> 'CONSUMPTION_REQUEST'
     AND v_has_transaction
     AND (p_event_kind IS NULL
       OR (p_app_account_token_hash IS NULL
         AND p_event_kind NOT IN ('refund', 'revoke', 'refund_reversed'))) THEN
    RAISE EXCEPTION 'Assignable verified transaction claims are incomplete';
  END IF;
  IF p_notification_type = 'CONSUMPTION_REQUEST'
     AND (NOT v_has_transaction OR p_notification_transaction_id IS NULL) THEN
    RAISE EXCEPTION 'Consumption request requires a verified transaction reference';
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
  IF v_has_transaction AND (
    NOT iap_private.is_uint64_text(p_transaction_id)
    OR NOT iap_private.is_uint64_text(p_transaction_original_transaction_id)
    OR p_product_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    OR p_product_type NOT IN (
      'Non-Consumable', 'Consumable', 'Auto-Renewable Subscription'
    )
    OR p_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$'
    OR p_app_account_token_hash IS NOT NULL
      AND NOT iap_private.is_sha256_hex(p_app_account_token_hash)
    OR p_purchase_date_ms <= 0
    OR p_transaction_signed_date_ms <= 0
    OR p_expires_date_ms IS NOT NULL AND p_expires_date_ms <= 0
    OR p_revocation_date_ms IS NOT NULL AND p_revocation_date_ms <= 0
    OR NOT iap_private.is_sha256_hex(p_transaction_payload_hash)
    OR p_quantity NOT BETWEEN 1 AND 10
    OR p_revocation_type IS NOT NULL AND p_revocation_type NOT IN (
      'REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE'
    )
    OR p_revocation_percentage IS NOT NULL
      AND p_revocation_percentage NOT BETWEEN 0 AND 100000
  ) THEN
    RAISE EXCEPTION 'Verified transaction reference is invalid';
  END IF;
  IF p_notification_type = 'REFUND' AND p_event_kind IS DISTINCT FROM 'refund'
     OR p_notification_type = 'REVOKE' AND p_event_kind IS DISTINCT FROM 'revoke'
     OR p_notification_type = 'REFUND_REVERSED'
       AND p_event_kind IS DISTINCT FROM 'refund_reversed'
     OR p_notification_type = 'CONSUMPTION_REQUEST' AND p_event_kind IS NOT NULL THEN
    RAISE EXCEPTION 'Notification and transaction event mismatch';
  END IF;

  SELECT * INTO v_claim
  FROM public.iap_claim_notification(
    p_notification_uuid, p_environment, p_notification_type, p_subtype,
    p_notification_transaction_id, p_notification_original_transaction_id,
    p_notification_signed_date_ms, p_notification_payload_hash
  );
  IF v_claim.status = 'stale' THEN
    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, TRUE, FALSE,
      p_transaction_id, FALSE, NULL::BIGINT, NULL::TEXT;
    RETURN;
  END IF;
  IF v_claim.status = 'processed' THEN
    SELECT request.status INTO v_status
    FROM iap_private.apple_consumption_requests AS request
    WHERE request.notification_uuid = p_notification_uuid;
    RETURN QUERY SELECT p_notification_uuid, TRUE, FALSE, FALSE,
      p_transaction_id, FALSE, NULL::BIGINT, v_status;
    RETURN;
  END IF;

  v_product_type := CASE p_product_type
    WHEN 'Non-Consumable' THEN 'non_consumable'
    WHEN 'Consumable' THEN 'consumable'
    WHEN 'Auto-Renewable Subscription' THEN 'subscription'
    ELSE NULL
  END;

  IF p_notification_type = 'CONSUMPTION_REQUEST' THEN
    v_status := 'manual_review';
    IF v_product_type IS NOT NULL AND p_app_account_token_hash IS NOT NULL
       AND iap_private.is_sha256_hex(p_app_account_token_hash) THEN
      SELECT binding.* INTO v_binding
      FROM iap_private.apple_account_bindings AS binding
      WHERE binding.app_account_token_hash = p_app_account_token_hash;
      IF FOUND AND v_binding.user_id IS NOT NULL AND v_binding.deleted_at IS NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(v_binding.user_id::TEXT, 15013)
        );
        SELECT binding.* INTO v_binding
        FROM iap_private.apple_account_bindings AS binding
        WHERE binding.app_account_token_hash = p_app_account_token_hash
          AND binding.user_id IS NOT NULL
        FOR UPDATE;
        IF FOUND AND v_binding.deleted_at IS NULL
           AND NOT iap_private.is_account_deletion_pending(v_binding.user_id) THEN
          SELECT catalog.* INTO v_catalog
          FROM iap_private.apple_product_catalog AS catalog
          WHERE catalog.environment = p_environment
            AND catalog.product_id = p_product_id
            AND catalog.bundle_id = p_bundle_id
            AND catalog.product_type = v_product_type;
          IF FOUND THEN
            SELECT consent.* INTO v_consent
            FROM iap_private.refund_data_consent_events AS consent
            WHERE consent.billing_account_id = v_binding.billing_account_id
            ORDER BY consent.decided_at DESC, consent.consent_event_id DESC
            LIMIT 1;
            IF NOT FOUND OR v_consent.decision <> 'granted' THEN
              v_status := 'skipped_no_consent';
            ELSE
              PERFORM 1
              FROM iap_private.refund_data_consent_notices AS notice
              WHERE notice.notice_version = v_consent.notice_version
                AND notice.notice_sha256 = v_consent.notice_sha256
                AND notice.active
              FOR SHARE;
              IF NOT FOUND THEN
                v_status := 'skipped_no_consent';
              ELSIF p_environment = 'Xcode' THEN
                v_status := 'manual_review';
              ELSE
                v_status := 'pending_evidence';
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO iap_private.apple_consumption_requests (
      notification_uuid, billing_account_id, environment, transaction_id,
      original_transaction_id, product_id, product_type, bundle_id,
      consumption_request_reason,
      consent_event_id, notice_version, notice_sha256,
      delivery_status, sample_content_provided, consumption_percentage,
      request_body_hash, status, received_at, deadline_at, next_attempt_at
    ) VALUES (
      p_notification_uuid,
      v_binding.billing_account_id,
      p_environment, p_transaction_id, p_transaction_original_transaction_id,
      p_product_id, COALESCE(v_product_type, 'consumable'), p_bundle_id,
      p_consumption_request_reason,
      CASE WHEN v_status = 'pending_evidence' THEN v_consent.consent_event_id ELSE NULL END,
      CASE WHEN v_status = 'pending_evidence' THEN v_consent.notice_version ELSE NULL END,
      CASE WHEN v_status = 'pending_evidence' THEN v_consent.notice_sha256 ELSE NULL END,
      NULL, NULL, NULL, NULL, v_status, v_received_at,
      v_received_at + CASE
        WHEN p_environment = 'Sandbox' THEN INTERVAL '5 minutes'
        ELSE INTERVAL '12 hours'
      END,
      CASE WHEN v_status = 'pending_evidence' THEN v_received_at ELSE NULL END
    );
    IF v_status = 'pending_evidence' THEN
      v_status := iap_private.iap_refresh_consumption_request(
        (SELECT request.request_id
         FROM iap_private.apple_consumption_requests AS request
         WHERE request.notification_uuid = p_notification_uuid)
      );
    END IF;
    UPDATE iap_private.apple_notifications AS notification
    SET status = 'processed', processed_at = clock_timestamp(),
        attempts = notification.attempts + 1
    WHERE notification.notification_uuid = p_notification_uuid;
    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
      p_transaction_id, FALSE,
      CASE WHEN v_binding.billing_account_id IS NULL THEN NULL::BIGINT
        ELSE iap_private.credit_balance(v_binding.billing_account_id, p_environment) END,
      v_status;
    RETURN;
  END IF;

  IF v_has_transaction AND p_app_account_token_hash IS NULL THEN
    SELECT count(*),
      (array_agg(candidate.billing_account_id ORDER BY candidate.billing_account_id))[1]
    INTO v_candidate_count, v_candidate_billing_account_id
    FROM (
      SELECT DISTINCT tx.billing_account_id
      FROM iap_private.apple_transactions AS tx
      WHERE tx.environment = p_environment
        AND (tx.transaction_id = p_transaction_id
          OR tx.original_transaction_id = p_transaction_original_transaction_id)
        AND tx.product_id = p_product_id
        AND tx.product_type = v_product_type
        AND tx.bundle_id = p_bundle_id
    ) AS candidate;

    IF v_candidate_count = 1 THEN
      SELECT binding.user_id INTO v_resolved_user_id
      FROM iap_private.apple_account_bindings AS binding
      WHERE binding.billing_account_id = v_candidate_billing_account_id;
      IF v_resolved_user_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(v_resolved_user_id::TEXT, 15013)
        );
        SELECT binding.* INTO v_binding
        FROM iap_private.apple_account_bindings AS binding
        WHERE binding.billing_account_id = v_candidate_billing_account_id
          AND binding.user_id = v_resolved_user_id
        FOR UPDATE;
        IF FOUND AND v_binding.deleted_at IS NULL
           AND NOT iap_private.is_account_deletion_pending(v_resolved_user_id) THEN
          SELECT * INTO v_applied
          FROM public.iap_apply_verified_transaction_v2(
            v_resolved_user_id, p_environment, p_transaction_id,
            p_transaction_original_transaction_id, p_product_id, p_product_type,
            p_bundle_id, v_binding.app_account_token_hash, p_purchase_date_ms,
            p_transaction_signed_date_ms, p_expires_date_ms, p_revocation_date_ms,
            p_event_kind, p_transaction_payload_hash, p_quantity,
            p_revocation_type, p_revocation_percentage, p_notification_uuid
          );
          IF v_applied.stale THEN
            UPDATE iap_private.apple_notifications AS notification
            SET status = 'stale', claim_token = NULL, claimed_at = NULL
            WHERE notification.notification_uuid = p_notification_uuid;
          ELSE
            UPDATE iap_private.apple_notifications AS notification
            SET status = 'processed', processed_at = clock_timestamp(),
                attempts = notification.attempts + 1
            WHERE notification.notification_uuid = p_notification_uuid;
          END IF;
          RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate,
            v_applied.stale, NOT v_applied.stale, p_transaction_id,
            v_applied.entitlement_active, v_applied.export_credits, NULL::TEXT;
          RETURN;
        END IF;
      END IF;
      v_review_reason := 'ACCOUNT_DELETED';
    ELSIF v_candidate_count > 1 THEN
      v_review_reason := 'IDENTITY_AMBIGUOUS';
    ELSE
      v_review_reason := 'IDENTITY_UNRESOLVED';
    END IF;

    INSERT INTO iap_private.apple_transaction_review_facts (
      notification_uuid, environment, transaction_id,
      original_transaction_id, product_id, product_type, bundle_id,
      event_kind, transaction_signed_at, transaction_payload_hash, reason_code
    ) VALUES (
      p_notification_uuid, p_environment, p_transaction_id,
      p_transaction_original_transaction_id, p_product_id, p_product_type,
      p_bundle_id, p_event_kind,
      to_timestamp(p_transaction_signed_date_ms / 1000.0),
      p_transaction_payload_hash, v_review_reason
    );
    UPDATE iap_private.apple_notifications AS notification
    SET status = 'processed', processed_at = clock_timestamp(),
        attempts = notification.attempts + 1
    WHERE notification.notification_uuid = p_notification_uuid;
    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
      p_transaction_id, FALSE, NULL::BIGINT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_has_transaction THEN
    SELECT binding.* INTO v_binding
    FROM iap_private.apple_account_bindings AS binding
    WHERE binding.app_account_token_hash = p_app_account_token_hash;
    IF FOUND
       AND (v_binding.user_id IS NULL OR v_binding.deleted_at IS NOT NULL)
       AND p_event_kind IN ('refund', 'revoke', 'refund_reversed') THEN
      INSERT INTO iap_private.apple_transaction_review_facts (
        notification_uuid, environment, transaction_id,
        original_transaction_id, product_id, product_type, bundle_id,
        event_kind, transaction_signed_at, transaction_payload_hash, reason_code
      ) VALUES (
        p_notification_uuid, p_environment, p_transaction_id,
        p_transaction_original_transaction_id, p_product_id, p_product_type,
        p_bundle_id, p_event_kind,
        to_timestamp(p_transaction_signed_date_ms / 1000.0),
        p_transaction_payload_hash, 'ACCOUNT_DELETED'
      );
    END IF;
    IF NOT FOUND OR v_binding.user_id IS NULL OR v_binding.deleted_at IS NOT NULL THEN
      UPDATE iap_private.apple_notifications AS notification
      SET status = 'processed', processed_at = clock_timestamp(),
          attempts = notification.attempts + 1
      WHERE notification.notification_uuid = p_notification_uuid;
      RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
        p_transaction_id, FALSE, NULL::BIGINT, NULL::TEXT;
      RETURN;
    END IF;
    SELECT * INTO v_applied
    FROM public.iap_apply_verified_transaction_v2(
      v_binding.user_id, p_environment, p_transaction_id,
      p_transaction_original_transaction_id, p_product_id, p_product_type,
      p_bundle_id, p_app_account_token_hash, p_purchase_date_ms,
      p_transaction_signed_date_ms, p_expires_date_ms, p_revocation_date_ms,
      p_event_kind, p_transaction_payload_hash, p_quantity,
      p_revocation_type, p_revocation_percentage, p_notification_uuid
    );
    IF v_applied.stale THEN
      UPDATE iap_private.apple_notifications AS notification
      SET status = 'stale', claim_token = NULL, claimed_at = NULL
      WHERE notification.notification_uuid = p_notification_uuid;
    ELSE
      UPDATE iap_private.apple_notifications AS notification
      SET status = 'processed', processed_at = clock_timestamp(),
          attempts = notification.attempts + 1
      WHERE notification.notification_uuid = p_notification_uuid;
    END IF;
    RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate,
      v_applied.stale, NOT v_applied.stale, p_transaction_id,
      v_applied.entitlement_active, v_applied.export_credits, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE iap_private.apple_notifications AS notification
  SET status = 'processed', processed_at = clock_timestamp(),
      attempts = notification.attempts + 1
  WHERE notification.notification_uuid = p_notification_uuid;
  RETURN QUERY SELECT p_notification_uuid, v_claim.duplicate, FALSE, FALSE,
    NULL::TEXT, FALSE, NULL::BIGINT, NULL::TEXT;
END;
$$;

CREATE FUNCTION public.iap_claim_consumption_request()
RETURNS TABLE (
  request_id UUID,
  lease_token UUID,
  attempt_no INTEGER,
  received_at_ms BIGINT,
  deadline_at_ms BIGINT,
  lease_expires_at_ms BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id UUID;
  v_request iap_private.apple_consumption_requests%ROWTYPE;
  v_lease UUID;
  v_status TEXT;
BEGIN
  PERFORM iap_private.require_service_role();

  -- Once send authorization has crossed the external-I/O boundary, an expired
  -- lease cannot prove whether Apple received the request. Quarantine it and
  -- never turn it into an automatic retry.
  UPDATE iap_private.apple_consumption_requests AS request
  SET status = 'send_result_unknown', next_attempt_at = NULL,
      completion_attempt_no = request.attempts,
      completion_lease_hash = iap_private.sha256_text(request.lease_token::TEXT),
      completion_send_authorization_hash =
        iap_private.sha256_text(request.send_authorization_token::TEXT),
      completion_body_hash = request.request_body_hash,
      lease_token = NULL, lease_expires_at = NULL,
      send_authorization_token = NULL,
      send_authorization_expires_at = NULL,
      last_error_code = 'SEND_RESULT_UNKNOWN',
      warning_at = COALESCE(request.warning_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE request.status = 'send_started'
    AND (request.lease_expires_at <= clock_timestamp()
      OR request.deadline_at <= clock_timestamp());

  UPDATE iap_private.apple_consumption_requests AS request
  SET status = 'expired', next_attempt_at = NULL,
      lease_token = NULL, lease_expires_at = NULL,
      send_authorization_token = NULL,
      send_authorization_expires_at = NULL,
      last_error_code = 'APPLE_DEADLINE_EXPIRED',
      warning_at = COALESCE(request.warning_at, clock_timestamp()),
      updated_at = clock_timestamp()
  WHERE request.status IN ('pending_evidence', 'queued', 'retryable_failed', 'in_flight')
    AND request.deadline_at <= clock_timestamp();

  UPDATE iap_private.apple_consumption_requests AS request
  SET status = 'retryable_failed', next_attempt_at = clock_timestamp(),
      lease_token = NULL, lease_expires_at = NULL,
      send_authorization_token = NULL,
      send_authorization_expires_at = NULL,
      last_error_code = 'WORKER_LEASE_EXPIRED',
      updated_at = clock_timestamp()
  WHERE request.status = 'in_flight'
    AND request.lease_expires_at <= clock_timestamp()
    AND request.deadline_at > clock_timestamp();

  LOOP
    SELECT request.request_id INTO v_request_id
    FROM iap_private.apple_consumption_requests AS request
    WHERE request.status IN ('pending_evidence', 'queued', 'retryable_failed')
      AND request.next_attempt_at <= clock_timestamp()
      AND request.deadline_at > clock_timestamp()
    ORDER BY request.deadline_at, request.received_at, request.request_id
    LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    v_status := iap_private.iap_refresh_consumption_request(v_request_id);
    IF v_status NOT IN ('queued', 'retryable_failed') THEN
      CONTINUE;
    END IF;

    v_lease := gen_random_uuid();
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'in_flight', attempts = request.attempts + 1,
        lease_token = v_lease,
        lease_expires_at = LEAST(
          clock_timestamp() + INTERVAL '5 minutes', request.deadline_at
        ),
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        completion_attempt_no = NULL,
        completion_lease_hash = NULL,
        completion_send_authorization_hash = NULL,
        completion_body_hash = NULL,
        warning_at = CASE
          WHEN request.received_at + INTERVAL '10 hours' <= clock_timestamp()
            THEN COALESCE(request.warning_at, clock_timestamp())
          ELSE request.warning_at
        END,
        updated_at = clock_timestamp()
    WHERE request.request_id = v_request_id
      AND request.status IN ('queued', 'retryable_failed')
    RETURNING request.* INTO v_request;
    IF NOT FOUND THEN CONTINUE; END IF;

    RETURN QUERY SELECT v_request.request_id, v_lease, v_request.attempts,
      floor(extract(epoch FROM v_request.received_at) * 1000)::BIGINT,
      floor(extract(epoch FROM v_request.deadline_at) * 1000)::BIGINT,
      floor(extract(epoch FROM v_request.lease_expires_at) * 1000)::BIGINT;
    RETURN;
  END LOOP;
END;
$$;

CREATE FUNCTION public.iap_authorize_consumption_send(
  p_request_id UUID,
  p_lease_token UUID
)
RETURNS TABLE (
  send_authorization_token UUID,
  send_authorization_expires_at_ms BIGINT,
  attempt_no INTEGER,
  duplicate BOOLEAN,
  environment TEXT,
  transaction_id TEXT,
  product_type TEXT,
  delivery_status TEXT,
  sample_content_provided BOOLEAN,
  consumption_percentage INTEGER,
  request_body_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request iap_private.apple_consumption_requests%ROWTYPE;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_consent iap_private.refund_data_consent_events%ROWTYPE;
  v_user_id UUID;
  v_token UUID;
  v_expires_at TIMESTAMPTZ;
  v_expected_hash TEXT;
  v_original_lease_expires_at TIMESTAMPTZ;
  v_refresh_status TEXT;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_request_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'Invalid consumption send authorization';
  END IF;

  SELECT request.* INTO v_request
  FROM iap_private.apple_consumption_requests AS request
  WHERE request.request_id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT binding.user_id INTO v_user_id
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.billing_account_id = v_request.billing_account_id;
  IF v_user_id IS NULL THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'cancelled', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'ACCOUNT_DELETED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id
      AND request.status = 'in_flight';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 15013)
  );
  SELECT binding.* INTO v_binding
  FROM iap_private.apple_account_bindings AS binding
  WHERE binding.billing_account_id = v_request.billing_account_id
    AND binding.user_id = v_user_id
  FOR UPDATE;
  SELECT request.* INTO v_request
  FROM iap_private.apple_consumption_requests AS request
  WHERE request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_request.status = 'send_started'
     AND v_request.lease_token = p_lease_token
     AND v_request.send_authorization_token IS NOT NULL
     AND v_request.send_authorization_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT v_request.send_authorization_token,
      floor(extract(epoch FROM v_request.send_authorization_expires_at) * 1000)::BIGINT,
      v_request.attempts, TRUE, v_request.environment, v_request.transaction_id,
      v_request.product_type, v_request.delivery_status,
      v_request.sample_content_provided, v_request.consumption_percentage,
      v_request.request_body_hash;
    RETURN;
  END IF;
  IF v_request.status <> 'in_flight'
     OR v_request.lease_token IS DISTINCT FROM p_lease_token
     OR v_request.lease_expires_at <= clock_timestamp()
     OR v_request.deadline_at <= clock_timestamp() THEN
    RETURN;
  END IF;
  IF v_binding.billing_account_id IS NULL OR v_binding.deleted_at IS NOT NULL
     OR iap_private.is_account_deletion_pending(v_user_id) THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'cancelled', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'ACCOUNT_DELETED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN;
  END IF;

  SELECT consent.* INTO v_consent
  FROM iap_private.refund_data_consent_events AS consent
  WHERE consent.billing_account_id = v_request.billing_account_id
  ORDER BY consent.decided_at DESC, consent.consent_event_id DESC
  LIMIT 1;
  IF NOT FOUND OR v_consent.decision <> 'granted'
     OR v_consent.consent_event_id IS DISTINCT FROM v_request.consent_event_id
     OR v_consent.notice_version IS DISTINCT FROM v_request.notice_version
     OR v_consent.notice_sha256 IS DISTINCT FROM v_request.notice_sha256 THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'skipped_withdrawn', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'CONSENT_WITHDRAWN', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN;
  END IF;
  PERFORM 1
  FROM iap_private.refund_data_consent_notices AS notice
  WHERE notice.notice_version = v_request.notice_version
    AND notice.notice_sha256 = v_request.notice_sha256
    AND notice.active
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'skipped_withdrawn', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'CONSENT_NOTICE_REPLACED', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN;
  END IF;

  -- A claim is only a lease, never the source of the Apple request body. On
  -- the first send, refresh every server-owned fulfillment/usage fact while
  -- holding the same account lock used by those writers, then freeze exactly
  -- that body at send_started. A known HTTP retry keeps the first body.
  IF v_request.send_authorized_at IS NULL THEN
    v_original_lease_expires_at := v_request.lease_expires_at;
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'pending_evidence', next_attempt_at = clock_timestamp(),
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id
      AND request.status = 'in_flight'
      AND request.lease_token = p_lease_token
      AND request.send_authorized_at IS NULL;
    IF NOT FOUND THEN RETURN; END IF;

    v_refresh_status := iap_private.iap_refresh_consumption_request(p_request_id);
    IF v_refresh_status <> 'queued' THEN RETURN; END IF;
    IF v_original_lease_expires_at <= clock_timestamp() THEN
      UPDATE iap_private.apple_consumption_requests AS request
      SET status = 'retryable_failed', next_attempt_at = clock_timestamp(),
          last_error_code = 'WORKER_LEASE_EXPIRED', updated_at = clock_timestamp()
      WHERE request.request_id = p_request_id AND request.status = 'queued';
      RETURN;
    END IF;
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'in_flight', next_attempt_at = NULL,
        lease_token = p_lease_token,
        lease_expires_at = v_original_lease_expires_at,
        updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id
      AND request.status = 'queued'
      AND request.send_authorized_at IS NULL
    RETURNING request.* INTO v_request;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  v_expected_hash := iap_private.sha256_text(
    'consumption-v1|' || v_request.environment || '|' || v_request.transaction_id
    || '|true|' || v_request.delivery_status || '|'
    || CASE WHEN v_request.sample_content_provided THEN 'true' ELSE 'false' END
    || '|' || COALESCE(v_request.consumption_percentage::TEXT, 'omitted')
  );
  IF v_request.request_body_hash IS DISTINCT FROM v_expected_hash THEN
    UPDATE iap_private.apple_consumption_requests AS request
    SET status = 'manual_review', next_attempt_at = NULL,
        lease_token = NULL, lease_expires_at = NULL,
        send_authorization_token = NULL,
        send_authorization_expires_at = NULL,
        last_error_code = 'IMMUTABLE_BODY_MISMATCH', updated_at = clock_timestamp()
    WHERE request.request_id = p_request_id;
    RETURN;
  END IF;

  v_expires_at := LEAST(
    clock_timestamp() + INTERVAL '30 seconds',
    v_request.lease_expires_at,
    v_request.deadline_at
  );
  IF v_expires_at <= clock_timestamp() THEN RETURN; END IF;
  v_token := gen_random_uuid();
  UPDATE iap_private.apple_consumption_requests AS request
  SET status = 'send_started', send_authorization_token = v_token,
      send_authorization_expires_at = v_expires_at,
      send_authorized_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE request.request_id = p_request_id;
  RETURN QUERY SELECT v_token,
    floor(extract(epoch FROM v_expires_at) * 1000)::BIGINT,
    v_request.attempts, FALSE,
    v_request.environment, v_request.transaction_id, v_request.product_type,
    v_request.delivery_status, v_request.sample_content_provided,
    v_request.consumption_percentage, v_request.request_body_hash;
END;
$$;

CREATE FUNCTION public.iap_complete_consumption_request(
  p_request_id UUID,
  p_lease_token UUID,
  p_send_authorization_token UUID,
  p_attempt_no INTEGER,
  p_request_body_hash TEXT,
  p_outcome TEXT,
  p_error_code TEXT,
  p_retry_after_seconds INTEGER
)
RETURNS TABLE (status TEXT, duplicate BOOLEAN, next_attempt_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request iap_private.apple_consumption_requests%ROWTYPE;
  v_status TEXT;
  v_next TIMESTAMPTZ;
  v_delay_seconds INTEGER;
  v_lease_hash TEXT;
  v_send_hash TEXT;
  v_late_completion BOOLEAN := FALSE;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_request_id IS NULL OR p_lease_token IS NULL
     OR p_attempt_no IS NULL OR p_attempt_no <= 0
     OR p_outcome NOT IN (
       'accepted', 'retryable_failed', 'terminal_failed',
       'send_result_unknown', 'expired'
     )
     OR p_request_body_hash IS NOT NULL
       AND NOT iap_private.is_sha256_hex(p_request_body_hash)
     OR (p_send_authorization_token IS NULL) <> (p_request_body_hash IS NULL)
     OR p_outcome IN ('accepted', 'terminal_failed', 'send_result_unknown')
       AND p_send_authorization_token IS NULL
     OR p_outcome = 'expired' AND p_send_authorization_token IS NOT NULL
     OR p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z0-9_]{1,64}$'
     OR p_outcome = 'accepted' AND p_error_code IS NOT NULL
     OR p_outcome <> 'accepted' AND p_error_code IS NULL
     OR p_outcome <> 'retryable_failed' AND p_retry_after_seconds IS NOT NULL
     OR p_retry_after_seconds IS NOT NULL
       AND p_retry_after_seconds NOT BETWEEN 1 AND 43200 THEN
    RAISE EXCEPTION 'Invalid consumption completion';
  END IF;
  v_lease_hash := iap_private.sha256_text(p_lease_token::TEXT);
  v_send_hash := CASE WHEN p_send_authorization_token IS NULL THEN NULL
    ELSE iap_private.sha256_text(p_send_authorization_token::TEXT) END;

  SELECT request.* INTO v_request
  FROM iap_private.apple_consumption_requests AS request
  WHERE request.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consumption request lease is invalid';
  END IF;
  IF v_request.status = 'send_result_unknown' THEN
    IF v_request.completion_attempt_no IS DISTINCT FROM p_attempt_no
       OR v_request.completion_lease_hash IS DISTINCT FROM v_lease_hash
       OR v_request.completion_send_authorization_hash IS DISTINCT FROM v_send_hash
       OR v_request.completion_body_hash IS DISTINCT FROM p_request_body_hash THEN
      RAISE EXCEPTION 'Consumption request completion conflicts with stored attempt';
    END IF;
    IF p_outcome = 'send_result_unknown' THEN
      RETURN QUERY SELECT v_request.status, TRUE, v_request.next_attempt_at;
      RETURN;
    END IF;
    IF p_outcome NOT IN ('accepted', 'retryable_failed', 'terminal_failed') THEN
      RAISE EXCEPTION 'Quarantined consumption result is not definitive';
    END IF;
    v_late_completion := TRUE;
  ELSIF v_request.status NOT IN ('in_flight', 'send_started') THEN
    IF (v_request.status = p_outcome
        OR (v_request.status = 'expired' AND p_outcome = 'retryable_failed'))
       AND v_request.completion_attempt_no = p_attempt_no
       AND v_request.completion_lease_hash = v_lease_hash
       AND v_request.completion_send_authorization_hash IS NOT DISTINCT FROM v_send_hash
       AND v_request.completion_body_hash IS NOT DISTINCT FROM p_request_body_hash THEN
      RETURN QUERY SELECT v_request.status, TRUE, v_request.next_attempt_at;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Consumption request completion conflicts with stored state';
  END IF;
  IF NOT v_late_completion
     AND (v_request.lease_token IS DISTINCT FROM p_lease_token
       OR v_request.attempts IS DISTINCT FROM p_attempt_no) THEN
    RAISE EXCEPTION 'Consumption request lease is invalid';
  END IF;
  IF NOT v_late_completion AND v_request.status = 'send_started' THEN
    IF p_send_authorization_token IS NULL
       OR v_request.send_authorization_token IS DISTINCT FROM p_send_authorization_token
       OR v_request.request_body_hash IS DISTINCT FROM p_request_body_hash THEN
      RAISE EXCEPTION 'Consumption send authorization is invalid';
    END IF;
  ELSIF NOT v_late_completion
     AND (p_outcome NOT IN ('retryable_failed', 'expired')
       OR p_send_authorization_token IS NOT NULL) THEN
    RAISE EXCEPTION 'Consumption request was not authorized to send';
  END IF;

  v_status := p_outcome;
  v_next := NULL;
  IF p_outcome = 'retryable_failed' THEN
    IF v_request.deadline_at <= clock_timestamp() THEN
      v_status := 'expired';
    ELSE
      v_delay_seconds := LEAST(
        3600,
        (30 * power(2, LEAST(GREATEST(v_request.attempts - 1, 0), 7)))::INTEGER
      );
      IF p_retry_after_seconds IS NOT NULL THEN
        v_delay_seconds := GREATEST(v_delay_seconds, p_retry_after_seconds);
      END IF;
      v_next := LEAST(
        clock_timestamp() + make_interval(secs => v_delay_seconds),
        v_request.deadline_at
      );
    END IF;
  END IF;

  UPDATE iap_private.apple_consumption_requests AS request
  SET status = v_status,
      next_attempt_at = v_next,
      last_error_code = CASE WHEN v_status = 'expired'
        THEN 'APPLE_DEADLINE_EXPIRED' ELSE p_error_code END,
      completion_attempt_no = p_attempt_no,
      completion_lease_hash = v_lease_hash,
      completion_send_authorization_hash = v_send_hash,
      completion_body_hash = p_request_body_hash,
      lease_token = NULL,
      lease_expires_at = NULL,
      send_authorization_token = NULL,
      send_authorization_expires_at = NULL,
      sent_at = CASE WHEN v_status = 'accepted'
        THEN clock_timestamp() ELSE request.sent_at END,
      warning_at = CASE
        WHEN request.received_at + INTERVAL '10 hours' <= clock_timestamp()
          THEN COALESCE(request.warning_at, clock_timestamp())
        ELSE request.warning_at
      END,
      updated_at = clock_timestamp()
  WHERE request.request_id = p_request_id
  RETURNING request.status, request.next_attempt_at INTO v_status, v_next;

  RETURN QUERY SELECT v_status, FALSE, v_next;
END;
$$;

-- V1 service-role grants deliberately remain in place during the expand phase.
-- Migration 081 retires only those two external entry points after the V2 Edge
-- functions have been deployed and canaried.

REVOKE ALL ON FUNCTION public.iap_get_refund_data_consent_state(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_get_refund_data_consent_state(TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.iap_set_refund_data_consent(TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_set_refund_data_consent(TEXT, TEXT, TEXT, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.iap_record_fulfillment_usage_evidence(
  TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_record_fulfillment_usage_evidence(
  TEXT, TEXT, TEXT, BIGINT, TEXT, BOOLEAN, TEXT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_apply_verified_transaction_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER,
  TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_apply_verified_transaction_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER,
  TEXT, INTEGER, UUID
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_process_verified_notification_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, INTEGER, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_process_verified_notification_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, BIGINT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, INTEGER, TEXT, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_claim_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_claim_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_claim_consumption_request()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_claim_consumption_request() TO service_role;
REVOKE ALL ON FUNCTION public.iap_authorize_consumption_send(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_authorize_consumption_send(UUID, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.iap_complete_consumption_request(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_complete_consumption_request(
  UUID, UUID, UUID, INTEGER, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_list_operational_alerts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_list_operational_alerts() TO service_role;
REVOKE ALL ON FUNCTION public.iap_acknowledge_transaction_review(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_acknowledge_transaction_review(UUID, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.iap_prepare_account_deletion_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_prepare_account_deletion_v2(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.iap_export_credit_reserve(TEXT, BIGINT, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_reserve(TEXT, BIGINT, UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.iap_export_credit_commit(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.iap_export_credit_commit_after_fulfillment(
  UUID, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_commit_after_fulfillment(
  UUID, TEXT, TEXT, BOOLEAN
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_export_credit_release(UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.iap_export_credit_release(UUID) TO authenticated;

REVOKE ALL ON FUNCTION iap_private.sha256_text(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.current_refund_data_consent(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.iap_refresh_consumption_request(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.credit_balance_milliunits(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.release_exact_allocations()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.credit_balance(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.open_reserved_credits(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
