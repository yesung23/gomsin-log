import { strict as assert } from 'node:assert';
import {
  createAppleIapVerifier,
  normalizeNotification,
  normalizeTransaction,
} from './appleIapVerifier.ts';
import {
  appleTransactionEventKind,
  hashAppAccountToken,
  isVerifiedNotification,
  isVerifiedTransaction,
} from './appleIapContract.ts';
import { notificationFixture, transactionFixture } from './appleIapTestFixtures.ts';

Deno.test('Apple contract accepts only canonical UInt64 transaction ids and bounded notification names', () => {
  assert.equal(isVerifiedTransaction(transactionFixture()), true);
  assert.equal(isVerifiedTransaction(transactionFixture({ transactionId: 'tx-1' })), false);
  assert.equal(
    isVerifiedTransaction(transactionFixture({ transactionId: '18446744073709551616' })),
    false,
  );
  assert.equal(isVerifiedTransaction(transactionFixture({ type: 'unexpected' })), false);
  assert.equal(isVerifiedNotification(notificationFixture()), true);
  assert.equal(isVerifiedNotification(notificationFixture({ notificationType: 'REFUND!' })), false);
  assert.equal(isVerifiedNotification(notificationFixture({ subtype: '' })), false);
});

Deno.test('Apple account-token hashing is stable across UUID letter casing', async () => {
  const lower = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const upper = lower.toUpperCase();
  assert.equal(await hashAppAccountToken(lower), await hashAppAccountToken(upper));
});

Deno.test('Apple Edge contract rejects non-renewing subscriptions until the DB catalog supports them', () => {
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      type: 'Non-Renewing Subscription',
      expiresDate: 1_788_500_000_000,
    })),
    false,
  );
});

Deno.test('only entitlement-changing Apple notifications can apply a transaction', () => {
  assert.equal(appleTransactionEventKind('DID_RENEW'), 'purchase');
  assert.equal(appleTransactionEventKind('REFUND'), 'refund');
  assert.equal(appleTransactionEventKind('REFUND_REVERSED'), 'refund_reversed');
  assert.equal(appleTransactionEventKind('REVOKE'), 'revoke');
  assert.equal(appleTransactionEventKind('CONSUMPTION_REQUEST'), null);
  assert.equal(appleTransactionEventKind('FUTURE_UNKNOWN_TYPE'), null);
});

Deno.test('Apple verifier normalizes only the bounded claims the ledger accepts', () => {
  assert.deepEqual(
    normalizeTransaction({
      transactionId: '2000000000000001',
      originalTransactionId: '2000000000000000',
      productId: 'app.gomsinlog.paper.spring.v1',
      type: 'Non-Consumable',
      appAccountToken: '10000000-0000-4000-8000-00000000000a',
      bundleId: 'app.gomsinlog',
      environment: 'Sandbox',
      purchaseDate: 1_700_000_000_000,
      signedDate: 1_700_000_000_100,
      revocationDate: null,
      ignoredClaim: 'must-not-cross',
    }),
    {
      transactionId: '2000000000000001',
      originalTransactionId: '2000000000000000',
      productId: 'app.gomsinlog.paper.spring.v1',
      type: 'Non-Consumable',
      appAccountToken: '10000000-0000-4000-8000-00000000000a',
      bundleId: 'app.gomsinlog',
      environment: 'Sandbox',
      purchaseDate: 1_700_000_000_000,
      signedDate: 1_700_000_000_100,
      expiresDate: null,
      revocationDate: null,
      revocationReason: null,
      quantity: 1,
      revocationType: null,
      revocationPercentage: null,
      inAppOwnershipType: null,
    },
  );
});

Deno.test('Apple verifier preserves bounded quantity and prorated revocation claims', () => {
  const normalized = normalizeTransaction({
    transactionId: '2000000000000001',
    originalTransactionId: '2000000000000000',
    productId: 'app.gomsinlog.book.export.credit.1',
    type: 'Consumable',
    appAccountToken: '10000000-0000-4000-8000-00000000000a',
    bundleId: 'app.gomsinlog',
    environment: 'Sandbox',
    purchaseDate: 1_700_000_000_000,
    signedDate: 1_700_000_000_100,
    revocationDate: 1_700_000_000_050,
    quantity: 3,
    revocationType: 'REFUND_PRORATED',
    revocationPercentage: 33_333,
    ignoredClaim: 'must-not-cross',
  });

  assert.equal(normalized.quantity, 3);
  assert.equal(normalized.revocationType, 'REFUND_PRORATED');
  assert.equal(normalized.revocationPercentage, 33_333);
  assert.equal('ignoredClaim' in normalized, false);
  assert.equal(isVerifiedTransaction(normalized), true);
});

Deno.test('Apple transaction contract rejects invalid quantity and revocation combinations', () => {
  assert.equal(isVerifiedTransaction(transactionFixture({ quantity: 0 })), false);
  assert.equal(isVerifiedTransaction(transactionFixture({ quantity: 11 })), false);
  assert.equal(isVerifiedTransaction(transactionFixture({ quantity: 1.5 })), false);
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      revocationDate: 1_788_400_002_000,
      revocationType: 'REFUND_PRORATED',
      revocationPercentage: 0,
    })),
    false,
  );
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      revocationDate: 1_788_400_002_000,
      revocationType: 'REFUND_PRORATED',
      revocationPercentage: 100_000,
    })),
    false,
  );
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      revocationDate: 1_788_400_002_000,
      revocationType: 'REFUND_FULL',
      revocationPercentage: 100_001,
    })),
    false,
  );
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      revocationDate: 1_788_400_002_000,
      revocationType: 'UNKNOWN',
      revocationPercentage: 50_000,
    })),
    false,
  );
  assert.equal(
    isVerifiedTransaction(transactionFixture({
      revocationType: 'REFUND_FULL',
      revocationPercentage: 100_000,
    })),
    false,
  );
});

Deno.test('Apple notification environment comes from verified data and preserves the nested signed transaction only', () => {
  assert.deepEqual(
    normalizeNotification({
      notificationUUID: '30000000-0000-4000-8000-000000000001',
      notificationType: 'REFUND',
      subtype: null,
      signedDate: 1_700_000_000_200,
      data: {
        environment: 'Production',
        signedTransactionInfo: 'a.b.c',
        signedRenewalInfo: 'secret',
      },
    }),
    {
      notificationUUID: '30000000-0000-4000-8000-000000000001',
      notificationType: 'REFUND',
      subtype: null,
      signedDate: 1_700_000_000_200,
      environment: 'Production',
      data: { signedTransactionInfo: 'a.b.c' },
    },
  );
});

Deno.test('Apple consumption request preserves only a documented refund reason', () => {
  const normalized = normalizeNotification({
    notificationUUID: '30000000-0000-4000-8000-000000000001',
    notificationType: 'CONSUMPTION_REQUEST',
    subtype: null,
    signedDate: 1_700_000_000_200,
    data: {
      environment: 'Production',
      signedTransactionInfo: 'a.b.c',
      consumptionRequestReason: 'FULFILLMENT_ISSUE',
      signedRenewalInfo: 'must-not-cross',
    },
  });

  assert.deepEqual(normalized, {
    notificationUUID: '30000000-0000-4000-8000-000000000001',
    notificationType: 'CONSUMPTION_REQUEST',
    subtype: null,
    signedDate: 1_700_000_000_200,
    environment: 'Production',
    data: {
      signedTransactionInfo: 'a.b.c',
      consumptionRequestReason: 'FULFILLMENT_ISSUE',
    },
  });
  assert.equal(isVerifiedNotification(normalized), true);
  assert.equal(
    isVerifiedNotification(notificationFixture({
      notificationType: 'CONSUMPTION_REQUEST',
      data: { signedTransactionInfo: 'a.b.c', consumptionRequestReason: 'UNKNOWN' },
    })),
    false,
  );
});

Deno.test('verifier setup pins the GomsinLog bundle, requires production app id, and keeps Xcode trust off by default', () => {
  const calls: unknown[][] = [];
  const env = new Map<string, string>([
    ['APPLE_IAP_BUNDLE_ID', 'app.gomsinlog'],
    ['APPLE_IAP_APPLE_ID', '1234567890'],
    ['APPLE_IAP_ROOT_CA_CERTS_BASE64', JSON.stringify(['AQID'])],
  ]);
  const verifier = createAppleIapVerifier(
    (key) => env.get(key),
    (...args) => {
      calls.push(args);
      return {
        verifyAndDecodeTransaction: async () => ({ environment: 'Sandbox' }),
        verifyAndDecodeNotification: async () => ({ data: { environment: 'Sandbox' } }),
      };
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(calls).includes('LocalTesting'), false);
  assert.equal(typeof verifier.verifyTransaction, 'function');

  assert.throws(
    () =>
      createAppleIapVerifier(
        (key) => key === 'APPLE_IAP_BUNDLE_ID' ? 'attacker.example' : env.get(key),
        (...args) => calls.push(args) as never,
      ),
    /bundle/,
  );
});
