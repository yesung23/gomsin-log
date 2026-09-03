import { strict as assert } from 'node:assert';
import { handleAppleIapNotification } from './handler.ts';
import { JWS_A, notificationFixture, transactionFixture } from '../_shared/appleIapTestFixtures.ts';

const request = (signedPayload = 'notification.jws.signature') => new Request('https://edge.test/apple-iap-notifications', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signedPayload }),
});

function deps() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    value: {
      verifyNotification: async (jws: string) => {
        if (jws !== 'notification.jws.signature') throw new Error('unverified');
        return notificationFixture();
      },
      verifyTransaction: async (jws: string) => {
        if (jws !== JWS_A) throw new Error('unverified');
        return transactionFixture({ revocationDate: 1_788_400_002_000, revocationReason: 1 });
      },
      persistVerifiedNotification: async (input: Record<string, unknown>) => {
        calls.push(input);
        return { duplicate: false, stale: false };
      },
    },
  };
}

Deno.test('apple-iap-notifications: malformed or unverified outer JWS never reaches the ledger', async () => {
  const fixture = deps();
  const malformed = await handleAppleIapNotification(request(''), fixture.value);
  const unverified = await handleAppleIapNotification(request('bad.jws.value'), fixture.value);
  assert.equal(malformed.status, 400);
  assert.equal(unverified.status, 400);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-notifications: oversized request bodies never reach JWS verification', async () => {
  const fixture = deps();
  let verifies = 0;
  fixture.value.verifyNotification = async () => { verifies += 1; return notificationFixture(); };
  const response = await handleAppleIapNotification(new Request('https://edge.test/apple-iap-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(40_001) }),
  }), fixture.value);
  assert.equal(response.status, 400);
  assert.equal(verifies, 0);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-notifications: unverified nested transaction causes retryable failure and no mutation', async () => {
  const fixture = deps();
  fixture.value.verifyTransaction = async () => { throw new Error('unverified'); };
  const response = await handleAppleIapNotification(request(), fixture.value);
  assert.equal(response.status, 400);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-notifications: a cross-environment nested transaction is rejected before persistence', async () => {
  const fixture = deps();
  fixture.value.verifyTransaction = async () => transactionFixture({ environment: 'Production' });
  const response = await handleAppleIapNotification(request(), fixture.value);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'E_IAP_ENVIRONMENT_MISMATCH' });
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-notifications: refund and revocation facts reach one atomic persistence call without raw JWS', async () => {
  const fixture = deps();
  const response = await handleAppleIapNotification(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.length, 1);
  assert.equal((fixture.calls[0].notification as { notificationType: string }).notificationType, 'REFUND');
  assert.equal((fixture.calls[0].transaction as { revocationDate: number }).revocationDate, 1_788_400_002_000);
  assert.equal('signedPayload' in fixture.calls[0], false);
  assert.match(String(fixture.calls[0].notificationJwsSha256), /^[a-f0-9]{64}$/);
});

Deno.test('apple-iap-notifications: duplicate, replay, and out-of-order delivery still return 200 after idempotent persistence', async () => {
  const fixture = deps();
  fixture.value.persistVerifiedNotification = async (input) => {
    fixture.calls.push(input);
    return { duplicate: true, stale: true };
  };
  const response = await handleAppleIapNotification(request(), fixture.value);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { received: true, duplicate: true, stale: true });
});

Deno.test('apple-iap-notifications: transient persistence failure returns 503 so Apple retries', async () => {
  const fixture = deps();
  fixture.value.persistVerifiedNotification = async () => { throw new Error('database unavailable'); };
  const response = await handleAppleIapNotification(request(), fixture.value);
  assert.equal(response.status, 503);
});

Deno.test('apple-iap-notifications: verified test notification without transaction is recorded safely', async () => {
  const fixture = deps();
  fixture.value.verifyNotification = async () => notificationFixture({
    notificationType: 'TEST',
    data: null,
  });
  const response = await handleAppleIapNotification(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].transaction, null);
});
