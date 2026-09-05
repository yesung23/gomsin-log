import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import {
  type AppleIapReconcileDeps,
  type AppleIapReconcileTarget,
  handleAppleIapReconcile,
  MAX_RECONCILIATION_TARGETS,
  RECONCILIATION_FINALIZATION_RESERVE_MS,
  RECONCILIATION_RUNTIME_BUDGET_MS,
} from './handler.ts';
import { JWS_A, transactionFixture } from '../_shared/appleIapTestFixtures.ts';
import { createAppleIapHistory, fetchAppleHistoryWithTimeout } from '../_shared/appleIapHistory.ts';

const request = (secret = 'scheduler-secret') =>
  new Request('https://edge.test/apple-iap-reconcile', {
    method: 'POST',
    headers: { 'x-iap-scheduler-secret': secret },
  });

function deps() {
  const settled: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const historyTimeouts: number[] = [];
  return {
    settled,
    completed,
    historyTimeouts,
    value: {
      schedulerSecret: 'scheduler-secret',
      invocationStartedAtMs: 0,
      monotonicNow: () => 1_000,
      listTargets: async () => [{
        checkpointId: '10000000-0000-4000-8000-000000000001',
        leaseToken: '20000000-0000-4000-8000-000000000001',
        environment: 'Sandbox' as const,
        anchorTransactionId: '2000000000000001',
        revision: null,
      }],
      transactionHistory: async (_target: AppleIapReconcileTarget, timeoutMs: number) => {
        historyTimeouts.push(timeoutMs);
        return {
          signedTransactions: [JWS_A, JWS_A],
          nextRevision: 'revision-1',
          hasMore: false,
        };
      },
      verifyTransaction: async () => transactionFixture(),
      settlePage: async (input: Record<string, unknown>) => {
        settled.push(input);
        const transactions = input.transactions as Array<{ appAccountTokenHash: string | null }>;
        return {
          applied: transactions.filter((transaction) => transaction.appAccountTokenHash !== null)
            .length,
          reviewed: transactions.filter((transaction) => transaction.appAccountTokenHash === null)
            .length,
        };
      },
      failTarget: async (input: Record<string, unknown>) => {
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

Deno.test('apple-iap-reconcile: deduplicates JWS pages and settles one ordered page atomically', async () => {
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
  assert.equal(fixture.settled.length, 1);
  assert.equal(fixture.settled[0].environment, 'Sandbox');
  const transactions = fixture.settled[0].transactions as Array<Record<string, unknown>>;
  assert.equal(transactions.length, 1);
  assert.match(String(transactions[0].jwsSha256), /^[a-f0-9]{64}$/);
  assert.match(String(transactions[0].appAccountTokenHash), /^[a-f0-9]{64}$/);
  assert.equal(fixture.historyTimeouts.length, 1);
  assert.ok(fixture.historyTimeouts[0] > 0 && fixture.historyTimeouts[0] <= 30_000);
  assert.equal(fixture.settled[0].expectedRevision, null);
  assert.equal(fixture.settled[0].nextRevision, 'revision-1');
  assert.equal(fixture.settled[0].hasMore, false);
  assert.deepEqual(fixture.completed, []);
});

Deno.test('apple-iap-reconcile: rejects more than one Apple-customer anchor per invocation', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () => [{
    checkpointId: '10000000-0000-4000-8000-000000000001',
    leaseToken: '20000000-0000-4000-8000-000000000001',
    environment: 'Sandbox' as const,
    anchorTransactionId: '2000000000000001',
    revision: null,
  }, {
    checkpointId: '10000000-0000-4000-8000-000000000002',
    leaseToken: '20000000-0000-4000-8000-000000000002',
    environment: 'Sandbox' as const,
    anchorTransactionId: '2000000000000002',
    revision: 'revision-prior',
  }];
  let historyCalls = 0;
  fixture.value.transactionHistory = async () => {
    historyCalls += 1;
    return { signedTransactions: [], nextRevision: 'revision-next', hasMore: true };
  };
  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(historyCalls, 0);
  assert.equal(fixture.settled.length, 0);
  assert.equal(fixture.completed.length, 0);
});

Deno.test('apple-iap-reconcile: rejects an oversized target batch before Apple calls', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () =>
    Array.from({ length: MAX_RECONCILIATION_TARGETS + 1 }, (_, index) => ({
      checkpointId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      leaseToken: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      environment: 'Sandbox' as const,
      anchorTransactionId: String(2_000_000_000_000_001n + BigInt(index)),
      revision: null,
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

Deno.test('apple-iap-reconcile: delegates each transaction token to the database instead of comparing it to the anchor account', async () => {
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
    transactions: 2,
    reviews: 1,
  });
  const transactions = fixture.settled[0].transactions as Array<Record<string, unknown>>;
  assert.equal(transactions.length, 3);
  assert.equal(transactions[0].appAccountTokenHash, null);
  assert.match(String(transactions[1].appAccountTokenHash), /^[a-f0-9]{64}$/);
  assert.match(String(transactions[2].appAccountTokenHash), /^[a-f0-9]{64}$/);
  assert.notEqual(transactions[1].appAccountTokenHash, transactions[2].appAccountTokenHash);
  assert.equal(fixture.settled[0].nextRevision, 'revision-reviewed');
});

Deno.test('apple-iap-reconcile: target-list failure remains retryable', async () => {
  const fixture = deps();
  fixture.value.listTargets = async () => {
    throw new Error('database unavailable');
  };
  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(fixture.settled.length, 0);
});

Deno.test('apple-iap-reconcile: does not claim an anchor after the ingress runtime budget is exhausted', async () => {
  const fixture = deps();
  let claims = 0;
  fixture.value.monotonicNow = () => RECONCILIATION_RUNTIME_BUDGET_MS;
  fixture.value.listTargets = async () => {
    claims += 1;
    return [];
  };

  const response = await handleAppleIapReconcile(request(), fixture.value);

  assert.equal(response.status, 503);
  assert.equal(claims, 0);
  assert.equal(fixture.settled.length, 0);
  assert.equal(fixture.completed.length, 0);
});

Deno.test('apple-iap-reconcile: does not start Apple history when the invocation reserve is exhausted', async () => {
  const fixture = deps();
  let elapsed = 0;
  let historyCalls = 0;
  fixture.value.monotonicNow = () => elapsed;
  const originalList = fixture.value.listTargets;
  fixture.value.listTargets = async () => {
    const targets = await originalList();
    elapsed = RECONCILIATION_RUNTIME_BUDGET_MS -
      RECONCILIATION_FINALIZATION_RESERVE_MS;
    return targets;
  };
  fixture.value.transactionHistory = async () => {
    historyCalls += 1;
    return { signedTransactions: [], nextRevision: 'must-not-run', hasMore: false };
  };

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(historyCalls, 0);
  assert.equal(fixture.settled.length, 0);
  assert.deepEqual(fixture.completed, []);
});

Deno.test('apple-iap-reconcile: never advances revision unless the whole verified page is durably settled', async () => {
  const fixture = deps();
  let elapsed = 0;
  fixture.value.monotonicNow = () => elapsed;
  fixture.value.transactionHistory = async () => {
    elapsed = RECONCILIATION_RUNTIME_BUDGET_MS -
      RECONCILIATION_FINALIZATION_RESERVE_MS;
    return {
      signedTransactions: [JWS_A],
      nextRevision: 'revision-must-retry',
      hasMore: true,
    };
  };

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.equal(fixture.settled.length, 0);
  assert.deepEqual(fixture.completed, []);
});

Deno.test('apple-iap-reconcile: settles an empty page atomically with its next revision', async () => {
  const fixture = deps();
  fixture.value.transactionHistory = async () => ({
    signedTransactions: [],
    nextRevision: 'revision-empty',
    hasMore: false,
  });

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.settled.length, 1);
  assert.deepEqual(fixture.settled[0].transactions, []);
  assert.equal(fixture.settled[0].nextRevision, 'revision-empty');
  assert.deepEqual(fixture.completed, []);
});

Deno.test('apple-iap-reconcile: settlement failure releases the lease without a revision advance', async () => {
  const fixture = deps();
  fixture.value.settlePage = async () => {
    throw new Error('database rollback');
  };

  const response = await handleAppleIapReconcile(request(), fixture.value);
  assert.equal(response.status, 503);
  assert.deepEqual(fixture.completed, [{
    checkpointId: '10000000-0000-4000-8000-000000000001',
    leaseToken: '20000000-0000-4000-8000-000000000001',
    errorCode: 'RECONCILIATION_TARGET_FAILED',
  }]);
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
  timeoutMs?: number,
) => Promise<{ signedTransactions: string[]; nextRevision: string; hasMore: boolean }>;

Deno.test('apple-iap-history: applies the handler runtime timeout to each Apple request', async () => {
  const clientTimeouts: unknown[] = [];
  const history = createHistoryWithFactory(historyEnv, (...args) => {
    clientTimeouts.push(args[5]);
    return {
      getTransactionHistory: async () => ({
        signedTransactions: [],
        hasMore: false,
        revision: 'revision',
      }),
    };
  });
  await history({
    environment: 'Production',
    anchorTransactionId: '2000000000000001',
    revision: null,
  }, 7_000);
  await history({
    environment: 'Sandbox',
    anchorTransactionId: '2000000000000002',
    revision: null,
  }, 9_000);
  assert.deepEqual(clientTimeouts, [7_000, 9_000]);
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
  }, 12_345);
  assert.deepEqual(result, {
    signedTransactions: [JWS_A],
    nextRevision: 'revision-next',
    hasMore: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '2000000000000001');
  assert.equal(calls[0][1], 'revision-prior');
});

Deno.test('apple-iap-history: rejects an invalid runtime-derived timeout before Apple I/O', async () => {
  let clients = 0;
  const history = createHistoryWithFactory(historyEnv, () => {
    clients += 1;
    return {
      getTransactionHistory: async () => ({
        signedTransactions: [],
        hasMore: false,
        revision: 'revision',
      }),
    };
  });

  await assert.rejects(
    () => history({
      environment: 'Production',
      anchorTransactionId: '2000000000000001',
      revision: null,
    }, 30_001),
    /timeout/,
  );
  assert.equal(clients, 0);
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
