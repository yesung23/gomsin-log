import { strict as assert } from 'node:assert';
import {
  createAppleIapVerifier,
  normalizeNotification,
  normalizeTransaction,
} from './appleIapVerifier.ts';
import { isVerifiedNotification, isVerifiedTransaction } from './appleIapContract.ts';
import { notificationFixture, transactionFixture } from './appleIapTestFixtures.ts';

Deno.test('Apple contract accepts only canonical UInt64 transaction ids and bounded notification names', () => {
  assert.equal(isVerifiedTransaction(transactionFixture()), true);
  assert.equal(isVerifiedTransaction(transactionFixture({ transactionId: 'tx-1' })), false);
  assert.equal(isVerifiedTransaction(transactionFixture({ transactionId: '18446744073709551616' })), false);
  assert.equal(isVerifiedNotification(notificationFixture()), true);
  assert.equal(isVerifiedNotification(notificationFixture({ notificationType: 'REFUND!' })), false);
  assert.equal(isVerifiedNotification(notificationFixture({ subtype: '' })), false);
});

Deno.test('Apple verifier normalizes only the bounded claims the ledger accepts', () => {
  assert.deepEqual(normalizeTransaction({
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
  }), {
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
    inAppOwnershipType: null,
  });
});

Deno.test('Apple notification environment comes from verified data and preserves the nested signed transaction only', () => {
  assert.deepEqual(normalizeNotification({
    notificationUUID: '30000000-0000-4000-8000-000000000001',
    notificationType: 'REFUND',
    subtype: null,
    signedDate: 1_700_000_000_200,
    data: { environment: 'Production', signedTransactionInfo: 'a.b.c', signedRenewalInfo: 'secret' },
  }), {
    notificationUUID: '30000000-0000-4000-8000-000000000001',
    notificationType: 'REFUND',
    subtype: null,
    signedDate: 1_700_000_000_200,
    environment: 'Production',
    data: { signedTransactionInfo: 'a.b.c' },
  });
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

  assert.throws(() => createAppleIapVerifier((key) => key === 'APPLE_IAP_BUNDLE_ID'
    ? 'attacker.example'
    : env.get(key), (...args) => calls.push(args) as never), /bundle/);
});
