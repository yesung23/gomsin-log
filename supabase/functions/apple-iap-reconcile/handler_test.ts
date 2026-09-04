import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import {
  type AppleIapReconcileDeps,
  type AppleIapReconcileTarget,
  handleAppleIapReconcile,
} from './handler.ts';
import { JWS_A, transactionFixture } from '../_shared/appleIapTestFixtures.ts';
import { createAppleIapHistory, fetchAppleHistoryWithTimeout } from '../_shared/appleIapHistory.ts';

const request = (secret = 'scheduler-secret') =>
  new Request('https://edge.test/apple-iap-reconcile', {
    method: 'POST',
    headers: { 'x-iap-scheduler-secret': secret },
  });

function deps() {
  const ingested: Array<Record<string, unknown>> = [];
  const reviewed: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  return {
    ingested,
    reviewed,
    completed,
    value: {
      schedulerSecret: 'scheduler-secret',
      listTargets: async () => [{
        checkpointId: '10000000-0000-4000-8000-000000000001',
        leaseToken: '20000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-00000000000a',
        environment: 'Sandbox' as const,
        anchorTransactionId: '2000000000000001',
        revision: null,
        appAccountTokenHash: 'cf6fef2e19aeb9ede73fe6d30895826ff08249c1bf087c2db252a54f008e8d80',
      }],
      transactionHistory: async (_target: AppleIapReconcileTarget) => ({
        signedTransactions: [JWS_A, JWS_A],
        nextRevision: 'revision-1',
        hasMore: false,
      }),
      verifyTransaction: async () => transactionFixture(),
      ingestTransaction: async (input: Record<string, unknown>) => {
        ingested.push(input);
      },
      recordReview: async (input: Record<string, unknown>) => {
        reviewed.push(input);
      },
      completeTarget: async (input: Record<string, unknown>) => {
        completed.push(input);
      },
    } as AppleIapReconcileDeps,
  };
}

Deno.test('apple-iap-reconcile: rejects missing or wrong scheduler secret before Apple or database reads', async () => {
  const fixture = deps();
  let reads = 0;
  fixture.value.listTargets = async () => {
    reads += 1;
    return [];
  };
  const response = await handleAppleIapReconcile(request('wrong'), fixture.value);
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

Deno.test('apple-iap-reconcile: deduplicates JWS pages and reuses verified idempotent ingest', async () => {
  const fixture = deps();
  const response = await handleAppleIapReconcile(request(), fixture.value);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    targets: 1,
    succeeded: 1,
    failed: 0,
    transactions: 1,
    reviews: 0,
  });
  assert.equal(fixture.ingested.length, 1);
  assert.equal(fixture.ingested[0].userId, '00000000-0000-4000-8000-00000000000a');
  assert.equal(fixture.ingested[0].environment, 'Sandbox');
  assert.match(String(fixture.ingested[0].jwsSha256), /^[a-f0-9]{64}$/);
  assert.deepEqual(fixture.completed, [{
    checkpointId: '10000000-0000-4000-8000-000000000001',
    leaseToken: '20000000-0000-4000-8000-000000000001',
    succeeded: true,
    errorCode: null,
    nextRevision: 'revision-1',
    hasMore: false,
  }]);
});

Deno.test('apple-iap-reconcile: one target failure does not block later targets', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () => [{
    checkpointId: '10000000-0000-4000-8000-000000000001',
    leaseToken: '20000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-00000000000a',
    environment: 'Sandbox' as const,
    anchorTransactionId: '2000000000000001',
    revision: null,
    appAccountTokenHash: 'cf6fef2e19aeb9ede73fe6d30895826ff08249c1bf087c2db252a54f008e8d80',
  }, {
    checkpointId: '10000000-0000-4000-8000-000000000002',
    leaseToken: '20000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-00000000000b',
    environment: 'Sandbox' as const,
    anchorTransactionId: '2000000000000002',
    revision: 'revision-prior',
    appAccountTokenHash: 'cf6fef2e19aeb9ede73fe6d30895826ff08249c1bf087c2db252a54f008e8d80',
  }];
  fixture.value.transactionHistory = async (target) => {
    if (target.anchorTransactionId === '2000000000000001') {
      throw new Error('Apple unavailable');
    }
    return {
      signedTransactions: [JWS_A],
      nextRevision: 'revision-next',
      hasMore: true,
    };
  };
  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    targets: 2,
    succeeded: 1,
    failed: 1,
    transactions: 1,
    reviews: 0,
  });
  assert.equal(fixture.ingested.length, 1);
  assert.equal(fixture.ingested[0].userId, '00000000-0000-4000-8000-00000000000b');
  assert.deepEqual(fixture.completed, [{
    checkpointId: '10000000-0000-4000-8000-000000000001',
    leaseToken: '20000000-0000-4000-8000-000000000001',
    succeeded: false,
    errorCode: 'RECONCILIATION_TARGET_FAILED',
    nextRevision: null,
    hasMore: null,
  }, {
    checkpointId: '10000000-0000-4000-8000-000000000002',
    leaseToken: '20000000-0000-4000-8000-000000000002',
    succeeded: true,
    errorCode: null,
    nextRevision: 'revision-next',
    hasMore: true,
  }]);
});

Deno.test('apple-iap-reconcile: rejects an oversized target batch before Apple calls', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () =>
    Array.from({ length: 3 }, (_, index) => ({
      checkpointId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      leaseToken: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      userId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      environment: 'Sandbox' as const,
      anchorTransactionId: String(2_000_000_000_000_001n + BigInt(index)),
      revision: null,
      appAccountTokenHash: 'cf6fef2e19aeb9ede73fe6d30895826ff08249c1bf087c2db252a54f008e8d80',
    }));
  let historyCalls = 0;
  fixture.value.transactionHistory = async () => {
    historyCalls += 1;
    return { signedTransactions: [], nextRevision: 'revision', hasMore: false };
  };

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(historyCalls, 0);
});

Deno.test('apple-iap-reconcile: quarantines missing and mismatched account tokens without stalling the page', async () => {
  const fixture = deps();
  fixture.value.transactionHistory = async () => ({
    signedTransactions: [
      'header.payload.signature-missing',
      'header.payload.signature-mismatch',
      'header.payload.signature-match',
    ],
    nextRevision: 'revision-reviewed',
    hasMore: false,
  });
  fixture.value.verifyTransaction = async (jws) => transactionFixture({
    transactionId: jws.endsWith('missing')
      ? '2000000000000002'
      : jws.endsWith('mismatch') ? '2000000000000003' : '2000000000000004',
    originalTransactionId: jws.endsWith('missing')
      ? '2000000000000002'
      : jws.endsWith('mismatch') ? '2000000000000003' : '2000000000000004',
    appAccountToken: jws.endsWith('missing')
      ? null
      : jws.endsWith('mismatch')
      ? '10000000-0000-4000-8000-00000000000b'
      : '10000000-0000-4000-8000-00000000000a',
  });

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    targets: 1,
    succeeded: 1,
    failed: 0,
    transactions: 1,
    reviews: 2,
  });
  assert.equal(fixture.ingested.length, 1);
  assert.deepEqual(
    fixture.reviewed.map((review) => review.reasonCode),
    ['TOKEN_BINDING_MISSING', 'TOKEN_BINDING_MISMATCH'],
  );
  assert.equal(fixture.completed[0].nextRevision, 'revision-reviewed');
});

Deno.test('apple-iap-reconcile: target-list failure remains retryable', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () => {
    throw new Error('database unavailable');
  };
  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(fixture.ingested.length, 0);
});

type HistoryClient = {
  getTransactionHistory: (...args: unknown[]) => Promise<{
    signedTransactions?: string[];
    hasMore?: boolean;
    revision?: string | null;
  }>;
};

const historyEnv = (key: string) =>
  ({
    APPLE_IAP_PRIVATE_KEY: 'private-key',
    APPLE_IAP_KEY_ID: 'key-id',
    APPLE_IAP_ISSUER_ID: 'issuer-id',
    APPLE_IAP_BUNDLE_ID: 'app.gomsinlog',
  })[key];

const createHistoryWithFactory = createAppleIapHistory as unknown as (
  env: (key: string) => string | undefined,
  factory: (...args: unknown[]) => HistoryClient,
) => (
  target: Pick<AppleIapReconcileTarget, 'environment' | 'anchorTransactionId' | 'revision'>,
) => Promise<{ signedTransactions: string[]; nextRevision: string; hasMore: boolean }>;

Deno.test('apple-iap-history: configures a real aborting timeout for both Apple environments', () => {
  const clientTimeouts: unknown[] = [];
  createHistoryWithFactory(historyEnv, (...args) => {
    clientTimeouts.push(args[5]);
    return {
      getTransactionHistory: async () => ({ signedTransactions: [], hasMore: false }),
    };
  });
  assert.deepEqual(clientTimeouts, [30_000, 30_000]);
});

Deno.test('apple-iap-history: timeout aborts the underlying fetch', async () => {
  let connectionClosed = false;
  const server = createServer((_request, response) => {
    response.on('close', () => {
      connectionClosed = true;
    });
    setTimeout(() => {
      if (!response.destroyed) response.end('late response');
    }, 250);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await assert.rejects(
      () =>
        fetchAppleHistoryWithTimeout(
          `http://127.0.0.1:${address.port}/slow`,
          { method: 'GET' },
          25,
        ),
      (error: unknown) => (error as { name?: unknown }).name === 'AbortError',
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(connectionClosed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

Deno.test('apple-iap-history: fetches exactly one page and forwards the stored revision', async () => {
  const calls: unknown[][] = [];
  const history = createHistoryWithFactory(historyEnv, () => ({
    getTransactionHistory: async (...args) => {
      calls.push(args);
      return {
        signedTransactions: [JWS_A],
        hasMore: true,
        revision: 'revision-next',
      };
    },
  }));

  const result = await history({
    environment: 'Sandbox',
    anchorTransactionId: '2000000000000001',
    revision: 'revision-prior',
  });
  assert.deepEqual(result, {
    signedTransactions: [JWS_A],
    nextRevision: 'revision-next',
    hasMore: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '2000000000000001');
  assert.equal(calls[0][1], 'revision-prior');
});

Deno.test('apple-iap-history: rejects a response batch above the transaction bound', async () => {
  const history = createHistoryWithFactory(historyEnv, () => ({
    getTransactionHistory: async () => ({
      signedTransactions: Array.from({ length: 21 }, () => JWS_A),
      hasMore: false,
      revision: 'revision-next',
    }),
  }));

  await assert.rejects(
    () =>
      history({
        environment: 'Production',
        anchorTransactionId: '2000000000000001',
        revision: null,
      }),
    /transaction limit/,
  );
});

Deno.test('apple-iap-history: rejects a response without a durable revision cursor', async () => {
  const history = createHistoryWithFactory(historyEnv, () => ({
    getTransactionHistory: async () => ({
      signedTransactions: [],
      hasMore: false,
      revision: null,
    }),
  }));

  await assert.rejects(
    () => history({
      environment: 'Sandbox',
      anchorTransactionId: '2000000000000001',
      revision: null,
    }),
    /revision cursor/,
  );
});
