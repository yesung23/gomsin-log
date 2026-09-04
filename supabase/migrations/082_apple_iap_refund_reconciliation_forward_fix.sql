-- 082_apple_iap_refund_reconciliation_forward_fix.sql
--
-- Forward-only hardening for the 079 Apple IAP refund/consumption ledger.
-- 079 remains immutable. This migration preserves existing evidence, adds
-- durable Apple history cursors and auditable review facts, and keeps every
-- sale gate closed. It does not deploy Edge Functions or activate a product.
--
-- Existing Apple consumption-request reasons are retained as historical
-- evidence. New requests do not persist that reason and it is never included
-- in the outbound Apple consumption payload built by the Edge worker.

BEGIN;

LOCK TABLE iap_private.apple_transaction_events,
  iap_private.apple_transaction_review_facts,
  iap_private.apple_consumption_requests,
  iap_private.apple_transactions,
  iap_private.apple_account_bindings
IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF to_regclass('iap_private.apple_transaction_events') IS NULL
     OR to_regclass('iap_private.apple_transaction_review_facts') IS NULL
     OR to_regclass('iap_private.apple_consumption_requests') IS NULL THEN
    RAISE EXCEPTION 'IAP migration 082 requires the original migration 079 schema';
  END IF;
  IF to_regclass('iap_private.apple_reconciliation_checkpoints') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'iap_private.apple_transaction_events'::regclass
         AND attribute.attname = 'review_reason_code'
         AND NOT attribute.attisdropped
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'iap_private.apple_transaction_review_facts'::regclass
         AND attribute.attname IN (
           'event_id', 'reconciliation_checkpoint_id',
           'reviewed_by_actor_id', 'review_operation_id',
           'observed_app_account_token_hash', 'purchase_date_ms',
           'expires_date_ms', 'revocation_date_ms', 'quantity',
           'revocation_type', 'revocation_percentage'
         )
         AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'IAP migration 082 found an unexpected or rewritten 079 schema';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'iap_private.apple_consumption_requests'::regclass
      AND attribute.attname = 'consumption_request_reason'
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'IAP migration 082 predecessor evidence contract is missing';
  END IF;
  IF to_regprocedure(
       'public.iap_acknowledge_transaction_review(uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'IAP migration 082 predecessor review RPC is missing';
  END IF;
  IF has_function_privilege(
       'service_role',
       'public.iap_apply_verified_transaction(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.iap_process_verified_notification(uuid,text,text,text,text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'IAP migration 082 requires migration 081 V1 retirement first';
  END IF;
END;
$preflight$;

ALTER TABLE iap_private.apple_transaction_events
  ADD COLUMN review_reason_code TEXT;

UPDATE iap_private.apple_transaction_events
SET review_reason_code = 'LEGACY_REVIEW_UNSPECIFIED'
WHERE resolution_status = 'manual_review'
  AND event_kind IN ('refund', 'revoke', 'refund_reversed')
  AND review_reason_code IS NULL;

ALTER TABLE iap_private.apple_transaction_events
  ADD CONSTRAINT apple_transaction_events_review_reason_code_check
  CHECK (review_reason_code IS NULL OR review_reason_code IN (
    'LEGACY_REVIEW_UNSPECIFIED', 'EXACT_LOT_UNAVAILABLE',
    'REFUND_BEFORE_PURCHASE', 'REVOCATION_METADATA_INCOMPLETE',
    'REVERSAL_WITHOUT_REFUND', 'REVERSAL_ADJUSTMENT_MISSING'
  )) NOT VALID,
  ADD CONSTRAINT apple_transaction_events_review_reason_binding_check
  CHECK (review_reason_code IS NULL OR (
    resolution_status = 'manual_review'
    AND event_kind IN ('refund', 'revoke', 'refund_reversed')
  )) NOT VALID,
  ADD CONSTRAINT apple_transaction_events_manual_review_reason_check
  CHECK (resolution_status <> 'manual_review'
    OR event_kind = 'purchase'
    OR review_reason_code IS NOT NULL) NOT VALID;

ALTER TABLE iap_private.apple_transaction_events
  VALIDATE CONSTRAINT apple_transaction_events_review_reason_code_check;
ALTER TABLE iap_private.apple_transaction_events
  VALIDATE CONSTRAINT apple_transaction_events_review_reason_binding_check;
ALTER TABLE iap_private.apple_transaction_events
  VALIDATE CONSTRAINT apple_transaction_events_manual_review_reason_check;

ALTER TABLE iap_private.apple_transaction_review_facts
  ADD COLUMN event_id UUID,
  ADD COLUMN reconciliation_checkpoint_id UUID,
  ADD COLUMN reviewed_by_actor_id UUID,
  ADD COLUMN review_operation_id UUID,
  ADD COLUMN observed_app_account_token_hash TEXT,
  ADD COLUMN purchase_date_ms BIGINT,
  ADD COLUMN expires_date_ms BIGINT,
  ADD COLUMN revocation_date_ms BIGINT,
  ADD COLUMN quantity INTEGER,
  ADD COLUMN revocation_type TEXT,
  ADD COLUMN revocation_percentage INTEGER;

ALTER TABLE iap_private.apple_transaction_review_facts
  ADD CONSTRAINT apple_transaction_review_facts_event_kind_v2_check
  CHECK (event_kind IN (
    'purchase', 'refund', 'revoke', 'refund_reversed'
  )) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_reason_code_v2_check
  CHECK (reason_code IN (
    'IDENTITY_UNRESOLVED', 'IDENTITY_AMBIGUOUS', 'ACCOUNT_DELETED',
    'TOKEN_BINDING_UNKNOWN', 'TOKEN_BINDING_MISSING',
    'TOKEN_BINDING_MISMATCH', 'LEGACY_REVIEW_UNSPECIFIED',
    'EXACT_LOT_UNAVAILABLE', 'REFUND_BEFORE_PURCHASE',
    'REVOCATION_METADATA_INCOMPLETE', 'REVERSAL_WITHOUT_REFUND',
    'REVERSAL_ADJUSTMENT_MISSING'
  )) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_source_check
  CHECK (
    notification_uuid IS NOT NULL OR event_id IS NOT NULL
      OR reconciliation_checkpoint_id IS NOT NULL
  ) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_state_v2_check
  CHECK ((review_status = 'pending') =
    (resolution_code IS NULL
      AND reviewed_by_actor_id IS NULL
      AND review_operation_id IS NULL
      AND reviewed_at IS NULL)) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_token_hash_check
  CHECK (observed_app_account_token_hash IS NULL
    OR iap_private.is_sha256_hex(observed_app_account_token_hash)) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_replay_metadata_check
  CHECK (
    (reconciliation_checkpoint_id IS NULL AND purchase_date_ms IS NULL
      AND expires_date_ms IS NULL AND revocation_date_ms IS NULL
      AND quantity IS NULL AND revocation_type IS NULL
      AND revocation_percentage IS NULL)
    OR
    (reconciliation_checkpoint_id IS NOT NULL
      AND purchase_date_ms IS NOT NULL AND purchase_date_ms > 0
      AND quantity BETWEEN 1 AND 10
      AND (expires_date_ms IS NULL OR expires_date_ms > 0)
      AND (revocation_date_ms IS NULL OR revocation_date_ms > 0)
      AND (revocation_type IS NULL OR revocation_type IN (
        'REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE'
      ))
      AND (revocation_percentage IS NULL
        OR revocation_percentage BETWEEN 0 AND 100000))
  ) NOT VALID,
  ADD CONSTRAINT apple_transaction_review_facts_event_id_fkey
  FOREIGN KEY (event_id)
  REFERENCES iap_private.apple_transaction_events(event_id);

CREATE UNIQUE INDEX iap_transaction_review_event_identity
  ON iap_private.apple_transaction_review_facts (event_id)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX iap_transaction_review_operation_identity
  ON iap_private.apple_transaction_review_facts (review_operation_id)
  WHERE review_operation_id IS NOT NULL;

ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_event_kind_v2_check;
ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_reason_code_v2_check;
ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_source_check;
ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_state_v2_check;
ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_token_hash_check;
ALTER TABLE iap_private.apple_transaction_review_facts
  VALIDATE CONSTRAINT apple_transaction_review_facts_replay_metadata_check;

ALTER TABLE iap_private.apple_transaction_review_facts
  DROP CONSTRAINT apple_transaction_review_facts_event_kind_check,
  DROP CONSTRAINT apple_transaction_review_facts_reason_code_check,
  DROP CONSTRAINT apple_transaction_review_facts_check,
  ALTER COLUMN notification_uuid DROP NOT NULL;


CREATE FUNCTION iap_private.create_transaction_review_fact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.review_reason_code IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO iap_private.apple_transaction_review_facts (
    notification_uuid, event_id, environment, transaction_id,
    original_transaction_id, product_id, product_type, bundle_id,
    event_kind, transaction_signed_at, transaction_payload_hash, reason_code
  )
  SELECT NEW.notification_uuid, NEW.event_id, NEW.environment, NEW.transaction_id,
    NEW.original_transaction_id, NEW.product_id,
    CASE transaction.product_type
      WHEN 'non_consumable' THEN 'Non-Consumable'
      WHEN 'consumable' THEN 'Consumable'
      WHEN 'subscription' THEN 'Auto-Renewable Subscription'
    END,
    transaction.bundle_id, NEW.event_kind, NEW.signed_at, NEW.payload_hash,
    NEW.review_reason_code
  FROM iap_private.apple_transactions AS transaction
  WHERE transaction.billing_account_id = NEW.billing_account_id
    AND transaction.environment = NEW.environment
    AND transaction.transaction_id = NEW.transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified Apple event review fact lacks transaction identity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iap_create_transaction_review_fact
AFTER INSERT ON iap_private.apple_transaction_events
FOR EACH ROW EXECUTE FUNCTION iap_private.create_transaction_review_fact();

CREATE UNIQUE INDEX iap_transactions_reconciliation_anchor_identity
  ON iap_private.apple_transactions (
    environment, transaction_id, original_transaction_id
  );

CREATE TABLE iap_private.apple_reconciliation_checkpoints (
  checkpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox', 'Production')),
  anchor_transaction_id TEXT NOT NULL
    CHECK (iap_private.is_uint64_text(anchor_transaction_id)),
  anchor_original_transaction_id TEXT NOT NULL
    CHECK (iap_private.is_uint64_text(anchor_original_transaction_id)),
  next_revision TEXT CHECK (
    next_revision IS NULL OR char_length(next_revision) BETWEEN 1 AND 4096
  ),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_claimed_at TIMESTAMPTZ,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_succeeded_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  last_completion_lease_token UUID,
  last_completion_succeeded BOOLEAN,
  last_completion_revision TEXT CHECK (
    last_completion_revision IS NULL
      OR char_length(last_completion_revision) BETWEEN 1 AND 4096
  ),
  last_completion_has_more BOOLEAN,
  last_completion_page_hash TEXT CHECK (
    last_completion_page_hash IS NULL
      OR iap_private.is_sha256_hex(last_completion_page_hash)
  ),
  last_completion_applied_count INTEGER CHECK (
    last_completion_applied_count IS NULL OR last_completion_applied_count >= 0
  ),
  last_completion_reviewed_count INTEGER CHECK (
    last_completion_reviewed_count IS NULL OR last_completion_reviewed_count >= 0
  ),
  last_completion_error_code TEXT CHECK (
    last_completion_error_code IS NULL
      OR last_completion_error_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT iap_reconciliation_checkpoint_identity
    UNIQUE (environment, anchor_original_transaction_id),
  FOREIGN KEY (
    environment, anchor_transaction_id, anchor_original_transaction_id
  )
    REFERENCES iap_private.apple_transactions(
      environment, transaction_id, original_transaction_id
    ),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (
    (last_completion_lease_token IS NULL
      AND last_completion_succeeded IS NULL
      AND last_completion_revision IS NULL
      AND last_completion_has_more IS NULL
      AND last_completion_page_hash IS NULL
      AND last_completion_applied_count IS NULL
      AND last_completion_reviewed_count IS NULL
      AND last_completion_error_code IS NULL)
    OR
    (last_completion_lease_token IS NOT NULL
      AND last_completion_succeeded IS NOT NULL
      AND (
        (last_completion_succeeded
          AND last_completion_revision IS NOT NULL
          AND last_completion_has_more IS NOT NULL
          AND last_completion_page_hash IS NOT NULL
          AND last_completion_applied_count IS NOT NULL
          AND last_completion_reviewed_count IS NOT NULL
          AND last_completion_applied_count + last_completion_reviewed_count
            BETWEEN 0 AND 20
          AND last_completion_error_code IS NULL)
        OR
        (NOT last_completion_succeeded
          AND last_completion_revision IS NULL
          AND last_completion_has_more IS NULL
          AND last_completion_page_hash IS NULL
          AND last_completion_applied_count IS NULL
          AND last_completion_reviewed_count IS NULL
          AND last_completion_error_code IS NOT NULL)
      ))
  )
);

CREATE INDEX iap_reconciliation_checkpoint_claim
  ON iap_private.apple_reconciliation_checkpoints (
    next_attempt_at, last_claimed_at, environment, checkpoint_id
  );

-- Apple transaction history is scoped to the App Store customer represented
-- by the anchor transaction, not to a GomsinLog billing account. Apple exposes
-- no stable customer identifier in the verified transaction payload. One
-- checkpoint per known original transaction chain is therefore the safe upper
-- bound: redundant customer scans remain idempotent, while separate Apple
-- customers used by one app account cannot silently share a cursor.
INSERT INTO iap_private.apple_reconciliation_checkpoints (
  environment, anchor_transaction_id, anchor_original_transaction_id
)
SELECT DISTINCT ON (transaction.environment, transaction.original_transaction_id)
  transaction.environment, transaction.transaction_id,
  transaction.original_transaction_id
FROM iap_private.apple_transactions AS transaction
WHERE transaction.environment IN ('Sandbox', 'Production')
ORDER BY transaction.environment, transaction.original_transaction_id,
  transaction.purchase_at, transaction.transaction_id
ON CONFLICT ON CONSTRAINT iap_reconciliation_checkpoint_identity DO NOTHING;

CREATE FUNCTION iap_private.enqueue_apple_reconciliation_checkpoint()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.environment NOT IN ('Sandbox', 'Production') THEN
    RETURN NEW;
  END IF;
  INSERT INTO iap_private.apple_reconciliation_checkpoints (
    environment, anchor_transaction_id, anchor_original_transaction_id
  ) VALUES (
    NEW.environment, NEW.transaction_id, NEW.original_transaction_id
  )
  ON CONFLICT ON CONSTRAINT iap_reconciliation_checkpoint_identity DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iap_enqueue_apple_reconciliation_checkpoint
AFTER INSERT ON iap_private.apple_transactions
FOR EACH ROW EXECUTE FUNCTION iap_private.enqueue_apple_reconciliation_checkpoint();

ALTER TABLE iap_private.apple_transaction_review_facts
  ADD CONSTRAINT apple_transaction_review_reconciliation_checkpoint_fkey
  FOREIGN KEY (reconciliation_checkpoint_id)
  REFERENCES iap_private.apple_reconciliation_checkpoints(checkpoint_id);

CREATE UNIQUE INDEX iap_reconciliation_review_fact_identity
  ON iap_private.apple_transaction_review_facts (
    reconciliation_checkpoint_id, environment, transaction_id,
    transaction_signed_at
  ) WHERE reconciliation_checkpoint_id IS NOT NULL;

CREATE FUNCTION public.iap_claim_reconciliation_targets(p_limit INTEGER DEFAULT 1)
RETURNS TABLE (
  checkpoint_id UUID,
  environment TEXT,
  anchor_transaction_id TEXT,
  next_revision TEXT,
  lease_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_limit IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Invalid reconciliation claim limit';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT checkpoint.checkpoint_id
    FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
    WHERE checkpoint.next_attempt_at <= clock_timestamp()
      AND (checkpoint.lease_token IS NULL
        OR checkpoint.lease_expires_at <= clock_timestamp())
    ORDER BY checkpoint.next_attempt_at,
      checkpoint.last_claimed_at NULLS FIRST, checkpoint.environment,
      checkpoint.checkpoint_id
    FOR UPDATE OF checkpoint SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE iap_private.apple_reconciliation_checkpoints AS checkpoint
    SET lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + INTERVAL '5 minutes',
        last_claimed_at = clock_timestamp(),
        attempt_count = checkpoint.attempt_count + 1,
        last_error_code = NULL,
        updated_at = clock_timestamp()
    FROM candidates AS candidate
    WHERE checkpoint.checkpoint_id = candidate.checkpoint_id
    RETURNING checkpoint.checkpoint_id, checkpoint.environment,
      checkpoint.anchor_transaction_id, checkpoint.next_revision,
      checkpoint.lease_token
  )
  SELECT claimed.checkpoint_id, claimed.environment,
    claimed.anchor_transaction_id, claimed.next_revision, claimed.lease_token
  FROM claimed;
END;
$$;

CREATE FUNCTION public.iap_fail_reconciliation_target(
  p_checkpoint_id UUID,
  p_lease_token UUID,
  p_error_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_checkpoint iap_private.apple_reconciliation_checkpoints%ROWTYPE;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_checkpoint_id IS NULL OR p_lease_token IS NULL
     OR p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'Invalid reconciliation failure';
  END IF;

  SELECT checkpoint.* INTO v_checkpoint
  FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.checkpoint_id = p_checkpoint_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation checkpoint is unavailable';
  END IF;
  IF v_checkpoint.lease_token IS DISTINCT FROM p_lease_token THEN
    IF v_checkpoint.last_completion_lease_token IS NOT DISTINCT FROM p_lease_token
       AND v_checkpoint.last_completion_succeeded IS FALSE
       AND v_checkpoint.last_completion_revision IS NULL
       AND v_checkpoint.last_completion_has_more IS NULL
       AND v_checkpoint.last_completion_error_code IS NOT DISTINCT FROM p_error_code THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Reconciliation lease is invalid';
  END IF;

  UPDATE iap_private.apple_reconciliation_checkpoints AS checkpoint
  SET lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = clock_timestamp() + INTERVAL '5 minutes',
      last_failed_at = clock_timestamp(),
      last_error_code = p_error_code,
      last_completion_lease_token = p_lease_token,
      last_completion_succeeded = FALSE,
      last_completion_revision = NULL,
      last_completion_has_more = NULL,
      last_completion_page_hash = NULL,
      last_completion_applied_count = NULL,
      last_completion_reviewed_count = NULL,
      last_completion_error_code = p_error_code,
      updated_at = clock_timestamp()
  WHERE checkpoint.checkpoint_id = p_checkpoint_id
    AND checkpoint.lease_token = p_lease_token;
END;
$$;

CREATE FUNCTION public.iap_record_reconciliation_review(
  p_checkpoint_id UUID,
  p_lease_token UUID,
  p_environment TEXT,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_product_id TEXT,
  p_product_type TEXT,
  p_bundle_id TEXT,
  p_event_kind TEXT,
  p_transaction_signed_date_ms BIGINT,
  p_transaction_payload_hash TEXT,
  p_observed_app_account_token_hash TEXT,
  p_purchase_date_ms BIGINT,
  p_expires_date_ms BIGINT,
  p_revocation_date_ms BIGINT,
  p_quantity INTEGER,
  p_revocation_type TEXT,
  p_revocation_percentage INTEGER,
  p_reason_code TEXT
)
RETURNS TABLE (review_id UUID, duplicate BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_checkpoint iap_private.apple_reconciliation_checkpoints%ROWTYPE;
  v_existing iap_private.apple_transaction_review_facts%ROWTYPE;
  v_inserted iap_private.apple_transaction_review_facts%ROWTYPE;
  v_signed_at TIMESTAMPTZ;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_checkpoint_id IS NULL OR p_lease_token IS NULL
     OR p_environment NOT IN ('Sandbox', 'Production')
     OR NOT iap_private.is_uint64_text(p_transaction_id)
     OR NOT iap_private.is_uint64_text(p_original_transaction_id)
     OR p_product_id IS NULL
       OR p_product_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
     OR p_product_type NOT IN (
       'Non-Consumable', 'Consumable', 'Auto-Renewable Subscription'
     )
     OR p_bundle_id IS NULL
       OR p_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$'
     OR p_event_kind NOT IN ('purchase', 'refund', 'revoke', 'refund_reversed')
     OR p_transaction_signed_date_ms IS NULL
       OR p_transaction_signed_date_ms <= 0
     OR NOT iap_private.is_sha256_hex(p_transaction_payload_hash)
     OR (p_observed_app_account_token_hash IS NOT NULL
       AND NOT iap_private.is_sha256_hex(p_observed_app_account_token_hash))
     OR p_purchase_date_ms IS NULL OR p_purchase_date_ms <= 0
     OR p_expires_date_ms IS NOT NULL AND p_expires_date_ms <= 0
     OR p_revocation_date_ms IS NOT NULL AND p_revocation_date_ms <= 0
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10
     OR p_revocation_type IS NOT NULL AND p_revocation_type NOT IN (
       'REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE'
     )
     OR p_revocation_percentage IS NOT NULL
       AND p_revocation_percentage NOT BETWEEN 0 AND 100000
     OR p_reason_code NOT IN (
       'TOKEN_BINDING_MISSING', 'TOKEN_BINDING_UNKNOWN',
       'ACCOUNT_DELETED', 'IDENTITY_AMBIGUOUS'
     )
     OR (p_reason_code = 'TOKEN_BINDING_MISSING'
       AND p_observed_app_account_token_hash IS NOT NULL)
     OR (p_reason_code <> 'TOKEN_BINDING_MISSING'
       AND p_observed_app_account_token_hash IS NULL)
     OR (p_event_kind = 'purchase' AND (
       p_revocation_date_ms IS NOT NULL OR p_revocation_type IS NOT NULL
       OR p_revocation_percentage IS NOT NULL
     ))
     OR (p_event_kind IN ('refund', 'revoke')
       AND p_revocation_date_ms IS NULL)
     OR (p_revocation_type = 'REFUND_PRORATED'
       AND (p_revocation_percentage IS NULL
         OR p_revocation_percentage NOT BETWEEN 1 AND 99999))
     OR (p_revocation_type IN ('REFUND_FULL', 'FAMILY_REVOKE')
       AND p_revocation_percentage IS NOT NULL
       AND p_revocation_percentage <> 100000
     ) THEN
    RAISE EXCEPTION 'Invalid reconciliation review fact';
  END IF;
  v_signed_at := to_timestamp(p_transaction_signed_date_ms / 1000.0);

  SELECT checkpoint.* INTO v_checkpoint
  FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.checkpoint_id = p_checkpoint_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_checkpoint.lease_token IS DISTINCT FROM p_lease_token
     OR v_checkpoint.environment IS DISTINCT FROM p_environment THEN
    RAISE EXCEPTION 'Reconciliation review lease is invalid';
  END IF;

  SELECT review.* INTO v_existing
  FROM iap_private.apple_transaction_review_facts AS review
  WHERE review.reconciliation_checkpoint_id = p_checkpoint_id
    AND review.environment = p_environment
    AND review.transaction_id = p_transaction_id
    AND review.transaction_signed_at = v_signed_at;
  IF FOUND THEN
    IF v_existing.original_transaction_id IS DISTINCT FROM p_original_transaction_id
       OR v_existing.product_id IS DISTINCT FROM p_product_id
       OR v_existing.product_type IS DISTINCT FROM p_product_type
       OR v_existing.bundle_id IS DISTINCT FROM p_bundle_id
       OR v_existing.event_kind IS DISTINCT FROM p_event_kind
       OR v_existing.transaction_payload_hash
         IS DISTINCT FROM p_transaction_payload_hash
       OR v_existing.observed_app_account_token_hash
         IS DISTINCT FROM p_observed_app_account_token_hash
       OR v_existing.purchase_date_ms IS DISTINCT FROM p_purchase_date_ms
       OR v_existing.expires_date_ms IS DISTINCT FROM p_expires_date_ms
       OR v_existing.revocation_date_ms IS DISTINCT FROM p_revocation_date_ms
       OR v_existing.quantity IS DISTINCT FROM p_quantity
       OR v_existing.revocation_type IS DISTINCT FROM p_revocation_type
       OR v_existing.revocation_percentage IS DISTINCT FROM p_revocation_percentage
       OR v_existing.reason_code IS DISTINCT FROM p_reason_code THEN
      RAISE EXCEPTION 'Reconciliation review fact conflicts';
    END IF;
    RETURN QUERY SELECT v_existing.review_id, TRUE;
    RETURN;
  END IF;

  INSERT INTO iap_private.apple_transaction_review_facts (
    reconciliation_checkpoint_id, environment, transaction_id,
    original_transaction_id, product_id, product_type, bundle_id,
    event_kind, transaction_signed_at, transaction_payload_hash,
    observed_app_account_token_hash, purchase_date_ms, expires_date_ms,
    revocation_date_ms, quantity, revocation_type, revocation_percentage,
    reason_code
  ) VALUES (
    p_checkpoint_id, p_environment, p_transaction_id,
    p_original_transaction_id, p_product_id, p_product_type, p_bundle_id,
    p_event_kind, v_signed_at, p_transaction_payload_hash,
    p_observed_app_account_token_hash, p_purchase_date_ms, p_expires_date_ms,
    p_revocation_date_ms, p_quantity, p_revocation_type,
    p_revocation_percentage, p_reason_code
  ) RETURNING * INTO v_inserted;
  RETURN QUERY SELECT v_inserted.review_id, FALSE;
END;
$$;

-- Settle one complete Apple history page in one ordered database transaction.
-- A history anchor identifies an App Store customer, not a GomsinLog user.
-- Each verified transaction is therefore resolved through its own opaque
-- appAccountToken hash. Missing, unknown, or deleted bindings become durable
-- review facts; no transaction is silently attributed to the anchor owner.
CREATE FUNCTION public.iap_settle_reconciliation_page(
  p_checkpoint_id UUID,
  p_lease_token UUID,
  p_environment TEXT,
  p_expected_revision TEXT,
  p_next_revision TEXT,
  p_has_more BOOLEAN,
  p_transactions JSONB
)
RETURNS TABLE (applied_count INTEGER, reviewed_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_checkpoint iap_private.apple_reconciliation_checkpoints%ROWTYPE;
  v_item JSONB;
  v_binding iap_private.apple_account_bindings%ROWTYPE;
  v_applied RECORD;
  v_review RECORD;
  v_product_type TEXT;
  v_token_hash TEXT;
  v_reason_code TEXT;
  v_transaction_id TEXT;
  v_original_transaction_id TEXT;
  v_product_id TEXT;
  v_apple_product_type TEXT;
  v_bundle_id TEXT;
  v_purchase_date_ms BIGINT;
  v_signed_date_ms BIGINT;
  v_expires_date_ms BIGINT;
  v_revocation_date_ms BIGINT;
  v_event_kind TEXT;
  v_payload_hash TEXT;
  v_quantity INTEGER;
  v_revocation_type TEXT;
  v_revocation_percentage INTEGER;
  v_applied_count INTEGER := 0;
  v_reviewed_count INTEGER := 0;
  v_page_hash TEXT;
BEGIN
  PERFORM iap_private.require_service_role();
  IF p_checkpoint_id IS NULL OR p_lease_token IS NULL
     OR p_environment NOT IN ('Sandbox', 'Production')
     OR (p_expected_revision IS NOT NULL
       AND char_length(p_expected_revision) NOT BETWEEN 1 AND 4096)
     OR p_next_revision IS NULL
       OR char_length(p_next_revision) NOT BETWEEN 1 AND 4096
     OR p_has_more IS NULL
     OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_transactions) NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'Invalid reconciliation page';
  END IF;
  v_page_hash := iap_private.sha256_text(
    pg_catalog.jsonb_build_object(
      'environment', p_environment,
      'expectedRevision', p_expected_revision,
      'nextRevision', p_next_revision,
      'hasMore', p_has_more,
      'transactions', p_transactions
    )::TEXT
  );

  SELECT checkpoint.* INTO v_checkpoint
  FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.checkpoint_id = p_checkpoint_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation page lease is invalid';
  END IF;
  IF v_checkpoint.lease_token IS DISTINCT FROM p_lease_token THEN
    IF v_checkpoint.last_completion_lease_token IS NOT DISTINCT FROM p_lease_token
       AND v_checkpoint.last_completion_succeeded IS TRUE
       AND v_checkpoint.last_completion_page_hash IS NOT DISTINCT FROM v_page_hash
       AND v_checkpoint.last_completion_revision IS NOT DISTINCT FROM p_next_revision
       AND v_checkpoint.last_completion_has_more IS NOT DISTINCT FROM p_has_more
       AND v_checkpoint.last_completion_applied_count IS NOT NULL
       AND v_checkpoint.last_completion_reviewed_count IS NOT NULL THEN
      RETURN QUERY SELECT v_checkpoint.last_completion_applied_count,
        v_checkpoint.last_completion_reviewed_count;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Reconciliation page lease is invalid';
  END IF;
  IF v_checkpoint.environment IS DISTINCT FROM p_environment
     OR v_checkpoint.next_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Reconciliation page lease is invalid';
  END IF;

  FOR v_item IN SELECT item.value
    FROM jsonb_array_elements(p_transactions) WITH ORDINALITY AS item(value, ordinal)
    ORDER BY item.ordinal
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 15
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_item) AS key(name)
         WHERE key.name NOT IN (
           'transactionId', 'originalTransactionId', 'productId',
           'productType', 'bundleId', 'appAccountTokenHash',
           'purchaseDateMs', 'signedDateMs', 'expiresDateMs',
           'revocationDateMs', 'eventKind', 'jwsSha256', 'quantity',
           'revocationType', 'revocationPercentage'
         )
       )
       OR jsonb_typeof(v_item->'transactionId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'originalTransactionId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'productId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'productType') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'bundleId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'purchaseDateMs') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'signedDateMs') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'eventKind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'jwsSha256') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item->'appAccountTokenHash') NOT IN ('string', 'null')
       OR jsonb_typeof(v_item->'expiresDateMs') NOT IN ('number', 'null')
       OR jsonb_typeof(v_item->'revocationDateMs') NOT IN ('number', 'null')
       OR jsonb_typeof(v_item->'revocationType') NOT IN ('string', 'null')
       OR jsonb_typeof(v_item->'revocationPercentage') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'Invalid reconciliation transaction object';
    END IF;

    BEGIN
      v_transaction_id := v_item->>'transactionId';
      v_original_transaction_id := v_item->>'originalTransactionId';
      v_product_id := v_item->>'productId';
      v_apple_product_type := v_item->>'productType';
      v_bundle_id := v_item->>'bundleId';
      v_token_hash := v_item->>'appAccountTokenHash';
      v_purchase_date_ms := (v_item->>'purchaseDateMs')::BIGINT;
      v_signed_date_ms := (v_item->>'signedDateMs')::BIGINT;
      v_expires_date_ms := (v_item->>'expiresDateMs')::BIGINT;
      v_revocation_date_ms := (v_item->>'revocationDateMs')::BIGINT;
      v_event_kind := v_item->>'eventKind';
      v_payload_hash := v_item->>'jwsSha256';
      v_quantity := (v_item->>'quantity')::INTEGER;
      v_revocation_type := v_item->>'revocationType';
      v_revocation_percentage := (v_item->>'revocationPercentage')::INTEGER;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid reconciliation transaction number';
    END;

    v_product_type := CASE v_apple_product_type
      WHEN 'Non-Consumable' THEN 'non_consumable'
      WHEN 'Consumable' THEN 'consumable'
      WHEN 'Auto-Renewable Subscription' THEN 'subscription'
      ELSE NULL
    END;
    IF NOT iap_private.is_uint64_text(v_transaction_id)
       OR NOT iap_private.is_uint64_text(v_original_transaction_id)
       OR v_product_id IS NULL
         OR v_product_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
       OR v_product_type IS NULL
       OR v_bundle_id IS NULL
         OR v_bundle_id !~ '^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$'
       OR (v_token_hash IS NOT NULL
         AND NOT iap_private.is_sha256_hex(v_token_hash))
       OR v_purchase_date_ms IS NULL OR v_purchase_date_ms <= 0
       OR v_signed_date_ms IS NULL OR v_signed_date_ms <= 0
       OR v_expires_date_ms IS NOT NULL AND v_expires_date_ms <= 0
       OR v_revocation_date_ms IS NOT NULL AND v_revocation_date_ms <= 0
       OR v_event_kind NOT IN ('purchase', 'refund', 'revoke')
       OR NOT iap_private.is_sha256_hex(v_payload_hash)
       OR v_quantity IS NULL OR v_quantity NOT BETWEEN 1 AND 10
       OR v_revocation_type IS NOT NULL AND v_revocation_type NOT IN (
         'REFUND_FULL', 'REFUND_PRORATED', 'FAMILY_REVOKE'
       )
       OR v_revocation_percentage IS NOT NULL
         AND v_revocation_percentage NOT BETWEEN 0 AND 100000
       OR (v_event_kind = 'purchase' AND (
         v_revocation_date_ms IS NOT NULL OR v_revocation_type IS NOT NULL
         OR v_revocation_percentage IS NOT NULL
       ))
       OR (v_event_kind IN ('refund', 'revoke')
         AND v_revocation_date_ms IS NULL) THEN
      RAISE EXCEPTION 'Invalid verified reconciliation transaction';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM iap_private.apple_product_catalog AS catalog
      WHERE catalog.environment = p_environment
        AND catalog.product_id = v_product_id
        AND catalog.product_type = v_product_type
        AND catalog.bundle_id = v_bundle_id
    ) THEN
      RAISE EXCEPTION 'Reconciliation product is outside the reviewed catalog';
    END IF;

    v_reason_code := NULL;
    IF v_token_hash IS NULL THEN
      v_reason_code := 'TOKEN_BINDING_MISSING';
    ELSE
      SELECT binding.* INTO v_binding
      FROM iap_private.apple_account_bindings AS binding
      WHERE binding.app_account_token_hash = v_token_hash;
      IF NOT FOUND THEN
        v_reason_code := 'TOKEN_BINDING_UNKNOWN';
      ELSIF v_binding.user_id IS NULL OR v_binding.deleted_at IS NOT NULL
         OR iap_private.is_account_deletion_pending(v_binding.user_id) THEN
        v_reason_code := 'ACCOUNT_DELETED';
      ELSE
        -- Match the account-deletion/V2 apply lock order: user fence, binding
        -- row, then original-chain fence. This prevents a reconciliation page
        -- from deadlocking with deletion while still rechecking the binding
        -- after the initially unlocked token lookup.
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(v_binding.user_id::TEXT, 15013)
        );
        SELECT binding.* INTO v_binding
        FROM iap_private.apple_account_bindings AS binding
        WHERE binding.app_account_token_hash = v_token_hash
        FOR UPDATE;
        IF NOT FOUND THEN
          v_reason_code := 'TOKEN_BINDING_UNKNOWN';
        ELSIF v_binding.user_id IS NULL OR v_binding.deleted_at IS NOT NULL
           OR iap_private.is_account_deletion_pending(v_binding.user_id) THEN
          v_reason_code := 'ACCOUNT_DELETED';
        ELSE
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
              p_environment || ':' || v_original_transaction_id, 0
            )
          );
          IF EXISTS (
            SELECT 1
            FROM iap_private.apple_transactions AS transaction
            WHERE transaction.environment = p_environment
              AND (
                transaction.transaction_id = v_transaction_id
                OR transaction.original_transaction_id = v_original_transaction_id
              )
              AND transaction.billing_account_id
                IS DISTINCT FROM v_binding.billing_account_id
          ) THEN
            v_reason_code := 'IDENTITY_AMBIGUOUS';
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_reason_code IS NOT NULL THEN
      SELECT * INTO v_review
      FROM public.iap_record_reconciliation_review(
        p_checkpoint_id, p_lease_token, p_environment,
        v_transaction_id, v_original_transaction_id, v_product_id,
        v_apple_product_type, v_bundle_id, v_event_kind,
        v_signed_date_ms, v_payload_hash, v_token_hash,
        v_purchase_date_ms, v_expires_date_ms, v_revocation_date_ms,
        v_quantity, v_revocation_type, v_revocation_percentage,
        v_reason_code
      );
      v_reviewed_count := v_reviewed_count + 1;
    ELSE
      SELECT * INTO v_applied
      FROM public.iap_apply_verified_transaction_v2(
        v_binding.user_id, p_environment, v_transaction_id,
        v_original_transaction_id, v_product_id, v_apple_product_type,
        v_bundle_id, v_token_hash, v_purchase_date_ms, v_signed_date_ms,
        v_expires_date_ms, v_revocation_date_ms, v_event_kind,
        v_payload_hash, v_quantity, v_revocation_type,
        v_revocation_percentage, NULL
      );
      v_applied_count := v_applied_count + 1;
    END IF;
  END LOOP;

  UPDATE iap_private.apple_reconciliation_checkpoints AS checkpoint
  SET lease_token = NULL,
      lease_expires_at = NULL,
      next_revision = p_next_revision,
      next_attempt_at = CASE WHEN p_has_more
        THEN clock_timestamp()
        ELSE clock_timestamp() + INTERVAL '15 minutes' END,
      last_succeeded_at = clock_timestamp(),
      last_error_code = NULL,
      last_completion_lease_token = p_lease_token,
      last_completion_succeeded = TRUE,
      last_completion_revision = p_next_revision,
      last_completion_has_more = p_has_more,
      last_completion_page_hash = v_page_hash,
      last_completion_applied_count = v_applied_count,
      last_completion_reviewed_count = v_reviewed_count,
      last_completion_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE checkpoint.checkpoint_id = p_checkpoint_id
    AND checkpoint.lease_token = p_lease_token
    AND checkpoint.next_revision IS NOT DISTINCT FROM p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reconciliation page completion lost its lease';
  END IF;

  RETURN QUERY SELECT v_applied_count, v_reviewed_count;
END;
$$;

DO $review_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM iap_private.apple_transaction_review_facts AS review
    JOIN iap_private.apple_transaction_events AS event
      ON event.notification_uuid = review.notification_uuid
     AND event.review_reason_code IS NOT NULL
    JOIN iap_private.apple_transactions AS transaction
      ON transaction.billing_account_id = event.billing_account_id
     AND transaction.environment = event.environment
     AND transaction.transaction_id = event.transaction_id
    WHERE review.event_id IS NULL
      AND (
        review.environment IS DISTINCT FROM event.environment
        OR review.transaction_id IS DISTINCT FROM event.transaction_id
        OR review.original_transaction_id
          IS DISTINCT FROM event.original_transaction_id
        OR review.product_id IS DISTINCT FROM event.product_id
        OR review.product_type IS DISTINCT FROM CASE transaction.product_type
          WHEN 'non_consumable' THEN 'Non-Consumable'
          WHEN 'consumable' THEN 'Consumable'
          WHEN 'subscription' THEN 'Auto-Renewable Subscription'
        END
        OR review.bundle_id IS DISTINCT FROM transaction.bundle_id
        OR review.event_kind IS DISTINCT FROM event.event_kind
        OR review.transaction_signed_at IS DISTINCT FROM event.signed_at
        OR review.transaction_payload_hash IS DISTINCT FROM event.payload_hash
      )
  ) THEN
    RAISE EXCEPTION 'IAP migration 082 found conflicting immutable review evidence';
  END IF;
END;
$review_backfill$;

UPDATE iap_private.apple_transaction_review_facts AS review
SET event_id = event.event_id
FROM iap_private.apple_transaction_events AS event
WHERE review.event_id IS NULL
  AND review.notification_uuid = event.notification_uuid
  AND event.review_reason_code IS NOT NULL;

INSERT INTO iap_private.apple_transaction_review_facts (
  notification_uuid, event_id, environment, transaction_id,
  original_transaction_id, product_id, product_type, bundle_id,
  event_kind, transaction_signed_at, transaction_payload_hash, reason_code
)
SELECT event.notification_uuid, event.event_id, event.environment,
  event.transaction_id, event.original_transaction_id, event.product_id,
  CASE transaction.product_type
    WHEN 'non_consumable' THEN 'Non-Consumable'
    WHEN 'consumable' THEN 'Consumable'
    WHEN 'subscription' THEN 'Auto-Renewable Subscription'
  END,
  transaction.bundle_id, event.event_kind, event.signed_at,
  event.payload_hash, event.review_reason_code
FROM iap_private.apple_transaction_events AS event
JOIN iap_private.apple_transactions AS transaction
  ON transaction.billing_account_id = event.billing_account_id
 AND transaction.environment = event.environment
 AND transaction.transaction_id = event.transaction_id
WHERE event.review_reason_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM iap_private.apple_transaction_review_facts AS review
    WHERE review.event_id = event.event_id
       OR (
         event.notification_uuid IS NOT NULL
         AND review.notification_uuid = event.notification_uuid
       )
  );

ALTER TABLE iap_private.apple_consumption_requests
  ADD CONSTRAINT apple_consumption_requests_status_v2_check
  CHECK (status IN (
    'pending_evidence', 'queued', 'in_flight', 'send_started',
    'retryable_failed', 'accepted', 'terminal_failed', 'send_result_unknown',
    'skipped_no_consent', 'skipped_withdrawn', 'skipped_account_deleted',
    'manual_review', 'cancelled', 'expired'
  )) NOT VALID;
ALTER TABLE iap_private.apple_consumption_requests
  VALIDATE CONSTRAINT apple_consumption_requests_status_v2_check;
ALTER TABLE iap_private.apple_consumption_requests
  DROP CONSTRAINT apple_consumption_requests_status_check,
  ALTER COLUMN consumption_request_reason DROP NOT NULL;


CREATE OR REPLACE FUNCTION public.iap_list_operational_alerts()
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
        WHEN request.deadline_at <= clock_timestamp() + INTERVAL '2 hours' THEN 'lt_2h'
        WHEN request.deadline_at <= clock_timestamp() + INTERVAL '6 hours' THEN 'lt_6h'
        ELSE 'gte_6h'
      END::TEXT AS deadline_bucket,
      request.attempts AS attempt_no,
      CASE
        WHEN request.status IN ('pending_evidence', 'queued')
          THEN 'APPLE_DEADLINE_IMMINENT'
        WHEN request.status = 'retryable_failed'
          THEN COALESCE(request.last_error_code, 'APPLE_DEADLINE_IMMINENT')
        ELSE COALESCE(request.last_error_code, 'REVIEW_REQUIRED')
      END AS error_code,
      COALESCE(request.warning_at, request.updated_at) AS sort_at
    FROM iap_private.apple_consumption_requests AS request
    WHERE request.status IN (
        'manual_review', 'send_result_unknown', 'terminal_failed', 'expired'
      )
      OR (
        request.status IN ('pending_evidence', 'queued', 'retryable_failed')
        AND request.deadline_at <= clock_timestamp() + INTERVAL '2 hours'
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
  p_resolution_code TEXT,
  p_operator_actor_id UUID,
  p_operation_id UUID
)
RETURNS TABLE (
  review_id UUID,
  status TEXT,
  resolution_code TEXT,
  operator_actor_id UUID,
  operation_id UUID,
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
  IF p_review_id IS NULL OR p_operator_actor_id IS NULL OR p_operation_id IS NULL
     OR p_resolution_code NOT IN (
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
    IF v_review.resolution_code IS DISTINCT FROM p_resolution_code
       OR v_review.reviewed_by_actor_id IS DISTINCT FROM p_operator_actor_id
       OR v_review.review_operation_id IS DISTINCT FROM p_operation_id THEN
      RAISE EXCEPTION 'Transaction review acknowledgement conflicts';
    END IF;
    RETURN QUERY SELECT p_review_id, 'acknowledged'::TEXT,
      p_resolution_code, p_operator_actor_id, p_operation_id, TRUE;
    RETURN;
  END IF;

  UPDATE iap_private.apple_transaction_review_facts AS review
  SET review_status = 'acknowledged',
      resolution_code = p_resolution_code,
      reviewed_by_actor_id = p_operator_actor_id,
      review_operation_id = p_operation_id,
      reviewed_at = clock_timestamp()
  WHERE review.review_id = p_review_id;
  RETURN QUERY SELECT p_review_id, 'acknowledged'::TEXT,
    p_resolution_code, p_operator_actor_id, p_operation_id, FALSE;
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
    IF v_reservation.amount IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'Export reservation idempotency conflict';
    END IF;
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

CREATE OR REPLACE FUNCTION public.iap_apply_verified_transaction_v2(
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
  v_review_reason TEXT;
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
      review_reason_code, notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id, v_effective_event_kind,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash, 'manual_review',
      CASE WHEN v_effective_event_kind IN ('refund', 'revoke', 'refund_reversed')
        THEN 'EXACT_LOT_UNAVAILABLE' ELSE NULL END,
      p_notification_uuid
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
    v_review_reason := CASE v_effective_event_kind
      WHEN 'refund' THEN 'REFUND_BEFORE_PURCHASE'
      WHEN 'revoke' THEN 'REFUND_BEFORE_PURCHASE'
      WHEN 'refund_reversed' THEN 'REVERSAL_WITHOUT_REFUND'
      ELSE NULL
    END;
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
      review_reason_code, notification_uuid
    ) VALUES (
      v_binding.billing_account_id, p_environment, p_transaction_id,
      p_original_transaction_id, p_product_id, v_effective_event_kind,
      p_quantity, p_revocation_type, p_revocation_percentage,
      v_signed_at, p_payload_hash, v_resolution, v_review_reason,
      p_notification_uuid
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
      v_review_reason := 'REVOCATION_METADATA_INCOMPLETE';
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
      v_review_reason := 'REVERSAL_WITHOUT_REFUND';
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
        v_review_reason := 'REVERSAL_ADJUSTMENT_MISSING';
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
    review_reason_code, notification_uuid
  ) VALUES (
    v_binding.billing_account_id, p_environment, p_transaction_id,
    p_original_transaction_id, p_product_id, v_effective_event_kind,
    p_quantity, p_revocation_type, p_revocation_percentage,
    v_signed_at, p_payload_hash, v_resolution, v_review_reason,
    p_notification_uuid
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

CREATE OR REPLACE FUNCTION public.iap_process_verified_notification_v2(
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
  v_binding_found BOOLEAN;
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
      IF FOUND AND (v_binding.user_id IS NULL OR v_binding.deleted_at IS NOT NULL) THEN
        v_status := 'skipped_account_deleted';
      ELSIF FOUND THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(v_binding.user_id::TEXT, 15013)
        );
        SELECT binding.* INTO v_binding
        FROM iap_private.apple_account_bindings AS binding
        WHERE binding.app_account_token_hash = p_app_account_token_hash
          AND binding.user_id IS NOT NULL
        FOR UPDATE;
        IF NOT FOUND OR v_binding.deleted_at IS NOT NULL
           OR iap_private.is_account_deletion_pending(v_binding.user_id) THEN
          v_status := 'skipped_account_deleted';
        ELSE
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
      consent_event_id, notice_version, notice_sha256,
      delivery_status, sample_content_provided, consumption_percentage,
      request_body_hash, status, received_at, deadline_at, next_attempt_at
    ) VALUES (
      p_notification_uuid,
      v_binding.billing_account_id,
      p_environment, p_transaction_id, p_transaction_original_transaction_id,
      p_product_id, COALESCE(v_product_type, 'consumable'), p_bundle_id,
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
    v_binding_found := FOUND;
    IF (NOT v_binding_found
         OR v_binding.user_id IS NULL
         OR v_binding.deleted_at IS NOT NULL)
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
        p_transaction_payload_hash,
        CASE WHEN v_binding_found THEN 'ACCOUNT_DELETED'
          ELSE 'TOKEN_BINDING_UNKNOWN' END
      );
    END IF;
    IF NOT v_binding_found
       OR v_binding.user_id IS NULL
       OR v_binding.deleted_at IS NOT NULL THEN
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

ALTER TABLE iap_private.apple_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE iap_private.apple_reconciliation_checkpoints
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.iap_acknowledge_transaction_review(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.iap_acknowledge_transaction_review(
  UUID, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_acknowledge_transaction_review(
  UUID, TEXT, UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.iap_claim_reconciliation_targets(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_claim_reconciliation_targets(INTEGER)
  TO service_role;
REVOKE ALL ON FUNCTION public.iap_fail_reconciliation_target(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_fail_reconciliation_target(
  UUID, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_record_reconciliation_review(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT,
  TEXT, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_record_reconciliation_review(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT,
  TEXT, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, INTEGER, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.iap_settle_reconciliation_page(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_settle_reconciliation_page(
  UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION iap_private.create_transaction_review_fact()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION iap_private.enqueue_apple_reconciliation_checkpoint()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.iap_list_operational_alerts()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_list_operational_alerts() TO service_role;
REVOKE ALL ON FUNCTION public.iap_apply_verified_transaction_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER, TEXT, INTEGER, UUID
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iap_apply_verified_transaction_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, INTEGER, TEXT, INTEGER, UUID
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

DO $postflight$
DECLARE
  v_transaction_chains BIGINT;
  v_checkpoint_chains BIGINT;
BEGIN
  SELECT count(*) INTO v_transaction_chains
  FROM (
    SELECT DISTINCT transaction.environment, transaction.original_transaction_id
    FROM iap_private.apple_transactions AS transaction
    WHERE transaction.environment IN ('Sandbox', 'Production')
  ) AS chain;
  SELECT count(*) INTO v_checkpoint_chains
  FROM iap_private.apple_reconciliation_checkpoints;
  IF v_transaction_chains <> v_checkpoint_chains
     OR EXISTS (
       SELECT 1
       FROM iap_private.apple_reconciliation_checkpoints AS checkpoint
       WHERE checkpoint.environment = 'Xcode'
     ) THEN
    RAISE EXCEPTION 'IAP migration 082 reconciliation anchor backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM iap_private.apple_transaction_events AS event
    LEFT JOIN iap_private.apple_transaction_review_facts AS review
      ON review.event_id = event.event_id
    WHERE event.review_reason_code IS NOT NULL
    GROUP BY event.event_id
    HAVING count(review.review_id) <> 1
  ) THEN
    RAISE EXCEPTION 'IAP migration 082 review-fact backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'iap_private.apple_consumption_requests'::regclass
      AND attribute.attname = 'consumption_request_reason'
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'IAP migration 082 data-minimization column remains required';
  END IF;

  IF has_function_privilege(
       'service_role',
       'public.iap_apply_verified_transaction(uuid,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.iap_process_verified_notification(uuid,text,text,text,text,text,bigint,text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.iap_acknowledge_transaction_review(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.iap_acknowledge_transaction_review(uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.iap_acknowledge_transaction_review(uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'IAP migration 082 restored an obsolete external contract';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';

COMMIT;
