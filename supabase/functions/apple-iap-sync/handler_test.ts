import { strict as assert } from 'node:assert';
import { handleAppleIapSync } from './handler.ts';
import {
  JWS_A,
  TOKEN_A,
  TOKEN_B,
  transactionFixture,
  USER_A,
} from '../_shared/appleIapTestFixtures.ts';

const request = (body: unknown, token = 'valid-user-token') =>
  new Request('https://edge.test/apple-iap-sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function deps() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    value: {
      authenticate: async (token: string) => token === 'valid-user-token' ? USER_A : null,
      preparePurchase: async (_userId: string, productId: string) =>
        productId === 'app.gomsinlog.paper.season.spring.v1'
          ? { appAccountToken: TOKEN_A }
          : Promise.reject(new Error('sale closed')),
      verifyTransaction: async (jws: string) => {
        if (jws !== JWS_A) throw new Error('unverified');
        return transactionFixture();
      },
      ingestTransaction: async (input: Record<string, unknown>) => {
        calls.push(input);
        return {
          accepted: true,
          duplicate: false,
          transactionId: '2000000000000001',
          entitlements: [{ key: 'paper.spring', active: true }],
          exportCredits: 0,
        };
      },
      loadEntitlements: async () => ({ entitlements: [], exportCredits: 0 }),
      loadRefundDataConsent: async () => ({ noticeMatches: false, decision: null }),
      setRefundDataConsent: async (input: {
        decision: 'granted' | 'withdrawn';
        noticeVersion: string;
        noticeSha256: string;
      }) => ({ ...input, duplicate: false }),
    },
  };
}

Deno.test('apple-iap-sync: anon and invalid bearer are denied before JWS verification', async () => {
  const fixture = deps();
  let verifies = 0;
  fixture.value.verifyTransaction = async () => {
    verifies += 1;
    return transactionFixture();
  };
  const response = await handleAppleIapSync(
    request({ signedTransactionJws: JWS_A }, 'invalid'),
    fixture.value,
  );
  assert.equal(response.status, 401);
  assert.equal(verifies, 0);
});

Deno.test('apple-iap-sync: malformed and unverified JWS are rejected without ledger writes', async () => {
  const fixture = deps();
  const malformed = await handleAppleIapSync(request({ signedTransactionJws: '' }), fixture.value);
  const unverified = await handleAppleIapSync(
    request({ signedTransactionJws: 'bad.jws.value' }),
    fixture.value,
  );
  assert.equal(malformed.status, 400);
  assert.equal(unverified.status, 400);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-sync: oversized request bodies are rejected before verification', async () => {
  const fixture = deps();
  let verifies = 0;
  fixture.value.verifyTransaction = async () => {
    verifies += 1;
    return transactionFixture();
  };
  const response = await handleAppleIapSync(
    request({ padding: 'x'.repeat(40_001) }),
    fixture.value,
  );
  assert.equal(response.status, 400);
  assert.equal(verifies, 0);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-sync: another account token cannot claim or finish a transaction', async () => {
  const fixture = deps();
  fixture.value.verifyTransaction = async () => transactionFixture({ appAccountToken: TOKEN_B });
  fixture.value.ingestTransaction = async () => {
    throw new Error('database binding mismatch');
  };
  const response = await handleAppleIapSync(
    request({ signedTransactionJws: JWS_A }),
    fixture.value,
  );
  assert.equal(response.status, 503);
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-sync: verified account-bound JWS reaches the idempotent ledger with a digest', async () => {
  const fixture = deps();
  const response = await handleAppleIapSync(
    request({ signedTransactionJws: JWS_A }),
    fixture.value,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.accepted, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].userId, USER_A);
  assert.match(String(fixture.calls[0].jwsSha256), /^[a-f0-9]{64}$/);
  assert.equal('signedTransactionJws' in fixture.calls[0], false);
});

Deno.test('apple-iap-sync: duplicate delivery remains success and returns authoritative state', async () => {
  const fixture = deps();
  fixture.value.ingestTransaction = async () => ({
    accepted: true,
    duplicate: true,
    transactionId: '2000000000000001',
    entitlements: [{ key: 'paper.spring', active: true }],
    exportCredits: 0,
  });
  const response = await handleAppleIapSync(
    request({ signedTransactionJws: JWS_A }),
    fixture.value,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.deepEqual(body.entitlements, [{ key: 'paper.spring', active: true }]);
});

Deno.test('apple-iap-sync: read action returns server state without accepting client entitlement claims', async () => {
  const fixture = deps();
  const response = await handleAppleIapSync(
    request({ action: 'status', environment: 'Production', entitlements: ['forged'] }),
    fixture.value,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { entitlements: [], exportCredits: 0 });
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-sync: read action requires an explicit StoreKit environment', async () => {
  const fixture = deps();
  const response = await handleAppleIapSync(request({ action: 'status' }), fixture.value);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'E_BAD_REQUEST' });
});

Deno.test('apple-iap-sync: purchase token is product-scoped and remains unavailable when server sale is off', async () => {
  const fixture = deps();
  const open = await handleAppleIapSync(
    request({
      action: 'prepare',
      productId: 'app.gomsinlog.paper.season.spring.v1',
      environment: 'Sandbox',
      accountId: 'forged-client-account',
    }),
    fixture.value,
  );
  assert.equal(open.status, 200);
  assert.deepEqual(await open.json(), { appAccountToken: TOKEN_A });

  const closed = await handleAppleIapSync(
    request({
      action: 'prepare',
      productId: 'app.gomsinlog.unknown',
      environment: 'Sandbox',
    }),
    fixture.value,
  );
  assert.equal(closed.status, 409);
  assert.deepEqual(await closed.json(), { error: 'E_IAP_SALE_CLOSED' });
  assert.equal(fixture.calls.length, 0);
});

Deno.test('apple-iap-sync: consent state compares an exact reviewed notice without trusting an account id', async () => {
  const fixture = deps();
  const consentCalls: Array<Record<string, unknown>> = [];
  Object.assign(fixture.value, {
    loadRefundDataConsent: async (input: Record<string, unknown>) => {
      consentCalls.push(input);
      return { noticeMatches: true, decision: null };
    },
  });
  const response = await handleAppleIapSync(
    request({
      action: 'refund-consent-state',
      noticeVersion: 'reviewed-test-notice-v1',
      noticeSha256: 'a'.repeat(64),
      accountId: 'forged-client-account',
    }),
    fixture.value,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { noticeMatches: true, decision: null });
  assert.deepEqual(consentCalls, [{
    userId: USER_A,
    noticeVersion: 'reviewed-test-notice-v1',
    noticeSha256: 'a'.repeat(64),
  }]);
});

Deno.test('apple-iap-sync: consent decisions carry only the reviewed notice and an idempotency key', async () => {
  const fixture = deps();
  const consentCalls: Array<Record<string, unknown>> = [];
  Object.assign(fixture.value, {
    setRefundDataConsent: async (input: Record<string, unknown>) => {
      consentCalls.push(input);
      return {
        decision: 'granted',
        noticeVersion: input.noticeVersion,
        noticeSha256: input.noticeSha256,
        duplicate: false,
      };
    },
  });
  const response = await handleAppleIapSync(
    request({
      action: 'refund-consent-decision',
      decision: 'granted',
      noticeVersion: 'reviewed-test-notice-v1',
      noticeSha256: 'b'.repeat(64),
      idempotencyKey: '79000000-0000-4000-8000-000000000901',
      transactionId: 'must-not-cross-the-consent-boundary',
    }),
    fixture.value,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(consentCalls, [{
    userId: USER_A,
    decision: 'granted',
    noticeVersion: 'reviewed-test-notice-v1',
    noticeSha256: 'b'.repeat(64),
    idempotencyKey: '79000000-0000-4000-8000-000000000901',
  }]);
  assert.equal(JSON.stringify(consentCalls).includes('transactionId'), false);
});
