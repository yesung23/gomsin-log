import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import {
  appleServerApiBaseUrl,
  createAppleIapConsumptionSender,
  fetchAppleServerApiWithTimeout,
  parseAppleRetryAfterSeconds,
} from './appleIapServerApi.ts';

Deno.test('Apple server API uses the current official production and sandbox hosts', () => {
  assert.equal(appleServerApiBaseUrl('Production'), 'https://api.storekit.apple.com');
  assert.equal(appleServerApiBaseUrl('Sandbox'), 'https://api.storekit-sandbox.apple.com');
});

Deno.test('Apple numeric Retry-After is an absolute epoch-millisecond deadline', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z');
  assert.equal(parseAppleRetryAfterSeconds(String(now + 120_000), now), 120);
  assert.equal(parseAppleRetryAfterSeconds(String(now - 1), now), null);
  assert.equal(parseAppleRetryAfterSeconds('not-a-deadline', now), null);
  assert.equal(
    parseAppleRetryAfterSeconds(String(now + 48 * 60 * 60 * 1_000), now),
    43_200,
  );
});

Deno.test('Apple Retry-After parser retains HTTP-date compatibility', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z');
  assert.equal(
    parseAppleRetryAfterSeconds('Fri, 04 Sep 2026 00:02:00 GMT', now),
    120,
  );
});

Deno.test('Apple server timeout aborts the underlying request instead of leaving it running', async () => {
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
        fetchAppleServerApiWithTimeout(
          `http://127.0.0.1:${address.port}/slow`,
          { method: 'POST', body: '{}' },
          25,
        ),
      (error: unknown) => (error as { type?: unknown }).type === 'request-timeout',
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(connectionClosed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

Deno.test('Apple consumption sender selects the signed transaction environment and V2 API', async () => {
  const clients: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  const env = new Map<string, string>([
    ['APPLE_IAP_PRIVATE_KEY', 'private-key'],
    ['APPLE_IAP_KEY_ID', 'key-id'],
    ['APPLE_IAP_ISSUER_ID', 'issuer-id'],
    ['APPLE_IAP_BUNDLE_ID', 'app.gomsinlog'],
  ]);
  const send = createAppleIapConsumptionSender(
    (key) => env.get(key),
    (...args) => {
      clients.push({ args });
      return {
        sendConsumptionInformation: async (transactionId, request) => {
          calls.push({ transactionId, request });
        },
      };
    },
  );

  const input = {
    environment: 'Sandbox',
    transactionId: '2000000000000001',
    timeoutMs: 120_000,
    request: {
      customerConsented: true,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
      consumptionPercentage: 25_000,
    },
  } as const;
  await send(input);
  assert.equal(clients.length, 1);
  assert.equal((clients[0].args as unknown[])[5], 120_000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transactionId, '2000000000000001');
  assert.equal((calls[0].request as Record<string, unknown>).refundPreference, undefined);
});

Deno.test('Apple consumption sender rejects missing credentials and Xcode remote sends', async () => {
  assert.throws(() => createAppleIapConsumptionSender(() => undefined), /credentials/);
  const send = createAppleIapConsumptionSender(
    (key) =>
      ({
        APPLE_IAP_PRIVATE_KEY: 'private-key',
        APPLE_IAP_KEY_ID: 'key-id',
        APPLE_IAP_ISSUER_ID: 'issuer-id',
        APPLE_IAP_BUNDLE_ID: 'app.gomsinlog',
      })[key],
    () => ({ sendConsumptionInformation: async () => undefined }),
  );
  const xcodeInput = {
    environment: 'Xcode' as 'Sandbox',
    transactionId: '2000000000000001',
    timeoutMs: 120_000,
    request: {
      customerConsented: true,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
    },
  } as const;
  await assert.rejects(() => send(xcodeInput), /environment/);
});
