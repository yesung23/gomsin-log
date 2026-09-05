import { strict as assert } from 'node:assert';
import { notificationFixture, transactionFixture } from '../_shared/appleIapTestFixtures.ts';
import type {
  VerifiedAppleNotification,
  VerifiedAppleTransaction,
} from '../_shared/appleIapContract.ts';
import { buildVerifiedNotificationRpcArgs } from './rpc.ts';

Deno.test('notification RPC mapping keeps verified consumption-request identity and bounded fields', async () => {
  const args = await buildVerifiedNotificationRpcArgs({
    notification: notificationFixture({
      notificationType: 'CONSUMPTION_REQUEST',
      data: {
        signedTransactionInfo: 'header.payload.signature-a',
        consumptionRequestReason: 'FULFILLMENT_ISSUE',
      },
    }) as VerifiedAppleNotification,
    transaction: transactionFixture({
      productId: 'app.gomsinlog.book.export.credit.1',
      type: 'Consumable',
      quantity: 3,
      revocationDate: null,
      revocationType: null,
      revocationPercentage: null,
    }) as VerifiedAppleTransaction,
    notificationJwsSha256: 'a'.repeat(64),
    transactionJwsSha256: 'b'.repeat(64),
    receivedAtMs: 1_788_534_000_000,
  });

  assert.equal(args.p_consumption_request_reason, 'FULFILLMENT_ISSUE');
  assert.equal(args.p_transaction_id, '2000000000000001');
  assert.equal(args.p_event_kind, null);
  assert.equal(args.p_quantity, 3);
  assert.equal(args.p_transaction_payload_hash, 'b'.repeat(64));
  assert.equal(args.p_received_at_ms, 1_788_534_000_000);
  assert.match(String(args.p_app_account_token_hash), /^[0-9a-f]{64}$/);
  assert.equal('signedPayload' in args, false);
  assert.equal('signedTransactionInfo' in args, false);
});

Deno.test('notification RPC mapping propagates verified partial-revocation facts only for an assignable event', async () => {
  const args = await buildVerifiedNotificationRpcArgs({
    notification: notificationFixture({ notificationType: 'REFUND' }) as VerifiedAppleNotification,
    transaction: transactionFixture({
      productId: 'app.gomsinlog.book.export.credit.1',
      type: 'Consumable',
      quantity: 2,
      revocationDate: 1_788_400_002_000,
      revocationType: 'REFUND_PRORATED',
      revocationPercentage: 50_000,
    }) as VerifiedAppleTransaction,
    notificationJwsSha256: 'c'.repeat(64),
    transactionJwsSha256: 'd'.repeat(64),
    receivedAtMs: 1_788_534_000_000,
  });

  assert.equal(args.p_event_kind, 'refund');
  assert.equal(args.p_quantity, 2);
  assert.equal(args.p_revocation_type, 'REFUND_PRORATED');
  assert.equal(args.p_revocation_percentage, 50_000);
  assert.equal(args.p_consumption_request_reason, null);
});

Deno.test('notification RPC mapping preserves verified tokenless refund identity without guessing an account', async () => {
  const args = await buildVerifiedNotificationRpcArgs({
    notification: notificationFixture({ notificationType: 'REFUND' }) as VerifiedAppleNotification,
    transaction: transactionFixture({ appAccountToken: null }) as VerifiedAppleTransaction,
    notificationJwsSha256: 'e'.repeat(64),
    transactionJwsSha256: 'f'.repeat(64),
    receivedAtMs: 1_788_534_000_000,
  });

  assert.equal(args.p_transaction_id, '2000000000000001');
  assert.equal(args.p_transaction_original_transaction_id, '2000000000000001');
  assert.equal(args.p_product_id, 'app.gomsinlog.paper.season.spring.v1');
  assert.equal(args.p_bundle_id, 'app.gomsinlog');
  assert.equal(args.p_app_account_token_hash, null);
  assert.equal(args.p_event_kind, 'refund');
  assert.equal(args.p_transaction_payload_hash, 'f'.repeat(64));
});
