# Apple IAP V2 rollout and rollback runbook

Status: local implementation and actor-test evidence only. No remote migration,
Edge deployment, scheduler activation, App Store Connect change, Sandbox purchase,
or Production purchase is proven by this document.

## Non-negotiable holds

- New sales remain closed in the repository and database. Migration 079 adds
  `apple_product_catalog_sale_hold`, which permits only `sale_enabled = false`.
- Do not create or apply a sale-activation migration in this rollout. It requires
  a separate approved change with a new, unused migration identifier after every
  external gate below has evidence. `082_apple_iap_refund_reconciliation_forward_fix.sql`
  already exists for reconciliation; it is not a sale-activation slot.
- Do not activate the consumption scheduler until an approved refund-data
  notice version/hash and the scheduler secret are configured and verified.
- Apple consumption information is evidence Apple may consider. It does not
  guarantee that Apple denies a refund.
- Never manually resend a request in `send_result_unknown`.

## Forward rollout order

1. Preflight the target remotely, read-only: migration catalog, current grants,
   catalog sale state, affected row counts, backup/PITR readiness, and deployed
   Edge versions. Record the exact results; repository files are not remote proof.
2. Apply 079 as the additive expand migration. Verify the sale hold, V1 and V2
   service-role compatibility, private-table isolation, and V1 consumable
   quarantine. Do not enable sales or cron.
3. Deploy the V2 sync, notification, reconcile, and consumption Edge artifacts.
   Keep the consumption scheduler OFF. Canary verified V2 transaction ingestion,
   required-transaction notification failures, per-target reconciliation, frozen
   request-body authorization, exact completion credentials, and bounded alerts.
4. Only after the exact deployed V2 artifacts pass canary, apply 081. It revokes
   `service_role` execute from only the two V1 external entrypoints and does not
   drop their owner/internal helper functions.
5. Recheck that the database sale hold remains enforced and scheduler remains OFF.

## Consumption scheduler and operations boundary

The `apple-iap-consumption` function accepts a high-entropy
`APPLE_IAP_SCHEDULER_SECRET` via `x-iap-scheduler-secret`. Secret creation and
installation are external operations and are not performed by this branch.

- An empty POST drains at most 25 eligible requests.
- `{ "action": "alerts" }` returns at most 100 rows containing only opaque alert
  UUID, source, environment, status, deadline bucket, attempt number, and static
  error code.
- `{ "action": "acknowledge-review", "reviewId": "...", "resolutionCode":
  "NO_AUTOMATIC_ACTION" }` or `APPLE_RECONCILIATION_REQUIRED` records an
  acknowledgement only. It cannot bind a user, grant entitlement/credits, or
  resend an unknown result.

If a one-minute cron is later approved, configure single-flight execution and an
alert consumer outside this repository, then prove both against the deployed
artifact. Do not infer activation from `supabase/config.toml`.

## Consent and fulfillment gates

- The app/Edge/DB consent adapter accepts only an exact reviewed notice
  version/hash. No legal notice or retention duration is supplied here. An absent
  or mismatched active notice fails closed, and refusal is independent of purchase
  value.
- Export fulfillment remains: reserve credit, successfully generate and store the
  artifact, then call `iap_export_credit_commit_after_fulfillment`. On generation
  or storage failure, release the reservation. Transaction ownership or a
  reservation alone is not delivery evidence.
- This task does not modify Book Studio and therefore does not claim that a live
  artifact generator/storage caller is connected.

## Forward-only recovery

- Before 081: stop any scheduler, redeploy the previously verified compatible
  Edge artifacts, and leave additive database state and evidence intact.
- After 081: keep sales and scheduler stopped and redeploy a V2-compatible Edge
  artifact. Do not drop or rewrite ledger history.
- If V1 Edge must be restored, use a new reviewed forward migration that restores
  `service_role` execute only on `iap_apply_verified_transaction(...)` and
  `iap_process_verified_notification(...)`. Keep the 079 sale hold and V1
  consumable quarantine. Revoke those temporary grants again in a later forward
  migration after V2 recovery.

## External evidence required before any sale activation

- approved legal notice text, exact version/hash, and retention decision;
- remote migration preflight, backup, rehearsal, and exact 079/081 state;
- exact deployed V2 artifacts and canary results;
- scheduler secret, single-flight one-minute cron, alert delivery, and operator
  handling proof;
- authoritative artifact generation/storage followed by fulfillment commit;
- App Store Connect product/contract state, Apple credentials, Sandbox/TestFlight,
  restore flow, and real-device purchase/refund behavior;
- separately approved Production migration and sale activation.

Until each item has current evidence, report it as `UNVERIFIED` and keep sales OFF.
