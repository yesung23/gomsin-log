import { strict as assert } from 'node:assert';
import { handleAppleIapReconcile } from './handler.ts';
import { JWS_A, transactionFixture } from '../_shared/appleIapTestFixtures.ts';

const request = (secret = 'scheduler-secret') => new Request('https://edge.test/apple-iap-reconcile', {
  method: 'POST',
  headers: { 'x-iap-scheduler-secret': secret },
});

function deps() {
  const ingested: Array<Record<string, unknown>> = [];
  return {
    ingested,
    value: {
      schedulerSecret: 'scheduler-secret',
      listTargets: async () => [{
        userId: '00000000-0000-4000-8000-00000000000a',
        environment: 'Sandbox' as const,
        originalTransactionId: '2000000000000001',
      }],
      transactionHistory: async () => [JWS_A, JWS_A],
      verifyTransaction: async () => transactionFixture(),
      ingestTransaction: async (input: Record<string, unknown>) => { ingested.push(input); },
    },
  };
}

Deno.test('apple-iap-reconcile: rejects missing or wrong scheduler secret before Apple or database reads', async () => {
  const fixture = deps();
  let reads = 0;
  fixture.value.listTargets = async () => { reads += 1; return []; };
  const response = await handleAppleIapReconcile(request('wrong'), fixture.value);
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

Deno.test('apple-iap-reconcile: deduplicates JWS pages and reuses verified idempotent ingest', async () => {
  const fixture = deps();
  const response = await handleAppleIapReconcile(request(), fixture.value);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { originals: 1, transactions: 1 });
  assert.equal(fixture.ingested.length, 1);
  assert.equal(fixture.ingested[0].userId, '00000000-0000-4000-8000-00000000000a');
  assert.equal(fixture.ingested[0].environment, 'Sandbox');
  assert.match(String(fixture.ingested[0].jwsSha256), /^[a-f0-9]{64}$/);
});

Deno.test('apple-iap-reconcile: a verification or Apple outage fails the batch for retry', async () => {
  const fixture = deps();
  fixture.value.transactionHistory = async () => { throw new Error('Apple unavailable'); };
  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(fixture.ingested.length, 0);
});
