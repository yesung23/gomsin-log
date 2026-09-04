import { strict as assert } from 'node:assert';
import {
  type AppleIapConsumptionDeps,
  type AppleIapConsumptionJob,
  type AppleIapSendAuthorization,
  handleAppleIapConsumption,
} from './handler.ts';

const RECEIVED_AT = Date.parse('2026-09-04T00:00:00.000Z');
const DEADLINE_AT = RECEIVED_AT + 12 * 60 * 60 * 1000;
const SANDBOX_DEADLINE_AT = RECEIVED_AT + 5 * 60 * 1000;
const LEASE_EXPIRES_AT = RECEIVED_AT + 5 * 60 * 1000;
const SEND_AUTHORIZATION_TOKEN = '50000000-0000-4000-8000-000000000001';
const OPERATOR_ACTOR_ID = '60000000-0000-4000-8000-000000000001';
const OPERATION_ID = '70000000-0000-4000-8000-000000000001';

const request = (secret = 'scheduler-secret', body?: unknown) =>
  new Request(
    'https://edge.test/apple-iap-consumption',
    {
      method: 'POST',
      headers: {
        'x-iap-scheduler-secret': secret,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );

const operationRequest = (body: unknown, secret = 'operator-secret') =>
  new Request('https://edge.test/apple-iap-consumption', {
    method: 'POST',
    headers: {
      'x-iap-operator-secret': secret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

function job(overrides: Partial<AppleIapConsumptionJob> = {}): AppleIapConsumptionJob {
  return {
    requestId: '30000000-0000-4000-8000-000000000001',
    leaseToken: '40000000-0000-4000-8000-000000000001',
    attemptNo: 1,
    receivedAtMs: RECEIVED_AT,
    deadlineAtMs: DEADLINE_AT,
    leaseExpiresAtMs: LEASE_EXPIRES_AT,
    ...overrides,
  };
}

function authorization(
  overrides: Partial<AppleIapSendAuthorization> = {},
): AppleIapSendAuthorization {
  return {
    sendAuthorizationToken: SEND_AUTHORIZATION_TOKEN,
    sendAuthorizationExpiresAtMs: LEASE_EXPIRES_AT,
    attemptNo: 1,
    environment: 'Production',
    transactionId: '2000000000000001',
    productType: 'consumable',
    deliveryStatus: 'DELIVERED',
    sampleContentProvided: false,
    consumptionPercentage: 50_000,
    requestBodyHash: 'a'.repeat(64),
    ...overrides,
  };
}

function deps(jobs: AppleIapConsumptionJob[] = [job()]) {
  const queue = [...jobs];
  const defaultAuthorizationExpiresAtMs = jobs[0]?.leaseExpiresAtMs ?? LEASE_EXPIRES_AT;
  const sent: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const value: AppleIapConsumptionDeps = {
    schedulerSecret: 'scheduler-secret',
    operatorSecret: 'operator-secret',
    operatorActorId: OPERATOR_ACTOR_ID,
    now: () => RECEIVED_AT + 60_000,
    claimNext: async () => queue.shift() ?? null,
    authorizeSend: async () =>
      authorization({
        sendAuthorizationExpiresAtMs: defaultAuthorizationExpiresAtMs,
      }),
    sendConsumptionInformation: async (input) => {
      sent.push(input);
    },
    complete: async (input) => {
      completed.push(input);
    },
    listOperationalAlerts: async () => [],
    acknowledgeManualReview: async ({
      reviewId,
      resolutionCode,
      operatorActorId,
      operationId,
    }) => ({
      reviewId,
      status: 'acknowledged',
      resolutionCode,
      operatorActorId,
      operationId,
      duplicate: false,
    }),
  };
  return { value, sent, completed };
}

Deno.test('apple-iap-consumption: rejects the wrong scheduler secret before claiming work', async () => {
  const fixture = deps();
  let claims = 0;
  fixture.value.claimNext = async () => {
    claims += 1;
    return null;
  };
  const response = await handleAppleIapConsumption(request('wrong'), fixture.value);
  assert.equal(response.status, 401);
  assert.equal(claims, 0);
});

Deno.test('apple-iap-consumption: real Deno ingress drains zero-byte and whitespace POST bodies', async () => {
  const fixture = deps([]);
  const bodyPresence: boolean[] = [];
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (incoming) => {
      bodyPresence.push(incoming.body !== null);
      return handleAppleIapConsumption(incoming, fixture.value);
    },
  );
  const origin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  try {
    for (const body of ['', ' \n\t']) {
      const response = await fetch(origin, {
        method: 'POST',
        headers: { 'x-iap-scheduler-secret': 'scheduler-secret' },
        body,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        claimed: 0,
        sent: 0,
        retryable: 0,
        terminal: 0,
        expired: 0,
        unknown: 0,
        warnings: 0,
      });
    }
    assert.deepEqual(bodyPresence, [true, true]);
  } finally {
    await server.shutdown();
  }
});

Deno.test('apple-iap-consumption: sends one minimal immutable V2 payload and never refundPreference', async () => {
  const fixture = deps();
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    claimed: 1,
    sent: 1,
    retryable: 0,
    terminal: 0,
    expired: 0,
    unknown: 0,
    warnings: 0,
  });
  assert.deepEqual(fixture.sent, [{
    environment: 'Production',
    transactionId: '2000000000000001',
    timeoutMs: 120_000,
    request: {
      customerConsented: true,
      deliveryStatus: 'DELIVERED',
      sampleContentProvided: false,
      consumptionPercentage: 50_000,
    },
  }]);
  assert.equal('refundPreference' in (fixture.sent[0].request as Record<string, unknown>), false);
  assert.deepEqual(fixture.completed, [{
    requestId: '30000000-0000-4000-8000-000000000001',
    leaseToken: '40000000-0000-4000-8000-000000000001',
    sendAuthorizationToken: SEND_AUTHORIZATION_TOKEN,
    attemptNo: 1,
    requestBodyHash: 'a'.repeat(64),
    outcome: 'accepted',
    errorCode: null,
    retryAfterSeconds: null,
  }]);
});

Deno.test('apple-iap-consumption: enforces Apple’s five-minute Sandbox response window', async () => {
  const sandbox = job({
    deadlineAtMs: SANDBOX_DEADLINE_AT,
    leaseExpiresAtMs: SANDBOX_DEADLINE_AT,
  });
  const fixture = deps([sandbox]);
  fixture.value.authorizeSend = async () =>
    authorization({
      environment: 'Sandbox',
      sendAuthorizationExpiresAtMs: SANDBOX_DEADLINE_AT,
    });
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].environment, 'Sandbox');

  const invalid = deps([job({
    deadlineAtMs: DEADLINE_AT,
    leaseExpiresAtMs: LEASE_EXPIRES_AT,
  })]);
  invalid.value.authorizeSend = async () =>
    authorization({
      environment: 'Sandbox',
      sendAuthorizationExpiresAtMs: LEASE_EXPIRES_AT,
    });
  const invalidResponse = await handleAppleIapConsumption(request(), invalid.value);
  assert.equal(invalidResponse.status, 200);
  assert.equal(invalid.sent.length, 0);
  assert.equal(invalid.completed[0].outcome, 'terminal_failed');
  assert.equal(invalid.completed[0].errorCode, 'AUTHORIZATION_PAYLOAD_INVALID');
});

Deno.test('apple-iap-consumption: never sends when the just-in-time authorization was revoked', async () => {
  const fixture = deps();
  fixture.value.authorizeSend = async () => null;
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.completed.length, 0);
});

Deno.test('apple-iap-consumption: never starts Apple fetch after send authorization expires', async () => {
  const fixture = deps();
  const firstNow = RECEIVED_AT + 60_000;
  let nowCalls = 0;
  fixture.value.now = () => nowCalls++ === 0 ? firstNow : firstNow + 2_000;
  fixture.value.authorizeSend = async () => ({
    ...authorization(),
    sendAuthorizationExpiresAtMs: firstNow + 1_000,
  });
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.completed[0].outcome, 'retryable_failed');
  assert.equal(fixture.completed[0].errorCode, 'SEND_AUTHORIZATION_EXPIRED');
});

Deno.test('apple-iap-consumption: omits consumptionPercentage for auto-renewable subscriptions', async () => {
  const fixture = deps();
  fixture.value.authorizeSend = async () =>
    authorization({
      productType: 'subscription',
      consumptionPercentage: null,
    });
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.sent[0].request, {
    customerConsented: true,
    deliveryStatus: 'DELIVERED',
    sampleContentProvided: false,
  });
});

Deno.test('apple-iap-consumption: retries 401, 429, and 5xx but terminal payload errors do not retry', async () => {
  for (
    const [status, outcome, errorCode] of [
      [401, 'retryable_failed', 'APPLE_HTTP_401'],
      [429, 'retryable_failed', 'APPLE_HTTP_429'],
      [503, 'retryable_failed', 'APPLE_HTTP_503'],
      [400, 'terminal_failed', 'APPLE_HTTP_400'],
    ] as const
  ) {
    const fixture = deps();
    fixture.value.sendConsumptionInformation = async () => {
      throw Object.assign(new Error('must not be persisted'), { httpStatusCode: status });
    };
    const response = await handleAppleIapConsumption(request(), fixture.value);
    assert.equal(response.status, 200);
    assert.equal(fixture.completed[0].outcome, outcome);
    assert.equal(fixture.completed[0].errorCode, errorCode);
  }
});

Deno.test('apple-iap-consumption: persists a bounded Apple Retry-After hint without logging response data', async () => {
  const fixture = deps();
  fixture.value.sendConsumptionInformation = async () => {
    throw Object.assign(new Error('must not be persisted'), {
      httpStatusCode: 429,
      retryAfterSeconds: 120,
    });
  };
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(fixture.completed[0].outcome, 'retryable_failed');
  assert.equal(fixture.completed[0].retryAfterSeconds, 120);
});

Deno.test('apple-iap-consumption: a short worker lease retries instead of expiring before the 12-hour deadline', async () => {
  const now = RECEIVED_AT + 60_000;
  const fixture = deps([job({ leaseExpiresAtMs: now + 4_000 })]);
  fixture.value.now = () => now;
  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.deepEqual(await response.json(), {
    claimed: 1,
    sent: 0,
    retryable: 1,
    terminal: 0,
    expired: 0,
    unknown: 0,
    warnings: 0,
  });
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.completed[0].sendAuthorizationToken, null);
  assert.equal(fixture.completed[0].outcome, 'retryable_failed');
  assert.equal(fixture.completed[0].errorCode, 'APPLE_SEND_WINDOW_EXHAUSTED');
});

Deno.test('apple-iap-consumption: records a 10-hour warning and expires at 12 hours without sending', async () => {
  const warningNow = RECEIVED_AT + 10 * 60 * 60 * 1000;
  const warning = deps([job({ leaseExpiresAtMs: warningNow + 5 * 60 * 1000 })]);
  warning.value.now = () => warningNow;
  const warningResponse = await handleAppleIapConsumption(request(), warning.value);
  assert.equal((await warningResponse.json()).warnings, 1);
  assert.equal(warning.sent.length, 1);

  const expired = deps();
  expired.value.now = () => DEADLINE_AT;
  const expiredResponse = await handleAppleIapConsumption(request(), expired.value);
  assert.equal((await expiredResponse.json()).expired, 1);
  assert.equal(expired.sent.length, 0);
  assert.equal(expired.completed[0].outcome, 'expired');
});

Deno.test('apple-iap-consumption: an unknown transport result is quarantined without retrying or logging identifiers', async () => {
  const fixture = deps();
  fixture.value.sendConsumptionInformation = async () => {
    throw new Error('network secret');
  };
  const messages: unknown[][] = [];
  let response!: Response;
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => {
    messages.push(args);
  };
  console.log = (...args: unknown[]) => {
    messages.push(args);
  };
  try {
    response = await handleAppleIapConsumption(request(), fixture.value);
    assert.equal(response.status, 200);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.deepEqual(messages, []);
  assert.equal(fixture.completed[0].errorCode, 'APPLE_NETWORK');
  assert.equal(fixture.completed[0].outcome, 'send_result_unknown');
  assert.equal((await response.json()).unknown, 1);
});

Deno.test('apple-iap-consumption: builds the Apple body only from the just-in-time authorization snapshot', async () => {
  const fixture = deps();
  fixture.value.authorizeSend = async (input) => {
    assert.deepEqual(input, {
      requestId: '30000000-0000-4000-8000-000000000001',
      leaseToken: '40000000-0000-4000-8000-000000000001',
    });
    return authorization({ consumptionPercentage: 75_000 });
  };

  const response = await handleAppleIapConsumption(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.equal(
    (fixture.sent[0].request as { consumptionPercentage: number }).consumptionPercentage,
    75_000,
  );
});

Deno.test('apple-iap-consumption: returns only bounded opaque operational alerts', async () => {
  const fixture = deps([]);
  Object.assign(fixture.value, {
    listOperationalAlerts: async () => [
      {
        alertId: '30000000-0000-4000-8000-000000000099',
        source: 'consumption',
        environment: 'Production',
        status: 'send_result_unknown',
        deadlineBucket: 'overdue',
        attemptNo: 2,
        errorCode: 'SEND_RESULT_UNKNOWN',
      },
      {
        alertId: '30000000-0000-4000-8000-000000000097',
        source: 'consumption',
        environment: 'Sandbox',
        status: 'pending_evidence',
        deadlineBucket: 'lt_2h',
        attemptNo: 0,
        errorCode: 'APPLE_DEADLINE_IMMINENT',
      },
    ],
  });
  const response = await handleAppleIapConsumption(
    operationRequest({ action: 'alerts' }),
    fixture.value,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    alerts: [
      {
        alertId: '30000000-0000-4000-8000-000000000099',
        source: 'consumption',
        environment: 'Production',
        status: 'send_result_unknown',
        deadlineBucket: 'overdue',
        attemptNo: 2,
        errorCode: 'SEND_RESULT_UNKNOWN',
      },
      {
        alertId: '30000000-0000-4000-8000-000000000097',
        source: 'consumption',
        environment: 'Sandbox',
        status: 'pending_evidence',
        deadlineBucket: 'lt_2h',
        attemptNo: 0,
        errorCode: 'APPLE_DEADLINE_IMMINENT',
      },
    ],
  });
});

Deno.test('apple-iap-consumption: scheduler authorization is drain-only', async () => {
  const fixture = deps([]);
  let operatorReads = 0;
  fixture.value.listOperationalAlerts = async () => {
    operatorReads += 1;
    return [];
  };

  const response = await handleAppleIapConsumption(
    request('scheduler-secret', { action: 'alerts' }),
    fixture.value,
  );

  assert.equal(response.status, 401);
  assert.equal(operatorReads, 0);
});

Deno.test('apple-iap-consumption: rejects a shared scheduler/operator secret as unsafe configuration', async () => {
  const fixture = deps([]);
  fixture.value.operatorSecret = fixture.value.schedulerSecret;
  let claims = 0;
  let operatorReads = 0;
  fixture.value.claimNext = async () => {
    claims += 1;
    return null;
  };
  fixture.value.listOperationalAlerts = async () => {
    operatorReads += 1;
    return [];
  };

  const drain = await handleAppleIapConsumption(request(), fixture.value);
  const alerts = await handleAppleIapConsumption(
    operationRequest({ action: 'alerts' }, 'scheduler-secret'),
    fixture.value,
  );

  assert.equal(drain.status, 503);
  assert.equal(alerts.status, 503);
  assert.equal(claims, 0);
  assert.equal(operatorReads, 0);
});

Deno.test('apple-iap-consumption: operator authorization cannot drain the scheduler queue', async () => {
  const fixture = deps();
  let claims = 0;
  fixture.value.claimNext = async () => {
    claims += 1;
    return null;
  };
  const response = await handleAppleIapConsumption(
    new Request('https://edge.test/apple-iap-consumption', {
      method: 'POST',
      headers: { 'x-iap-operator-secret': 'operator-secret' },
    }),
    fixture.value,
  );
  assert.equal(response.status, 401);
  assert.equal(claims, 0);
});

Deno.test('apple-iap-consumption: manual review can only be acknowledged without a resend or account binding', async () => {
  const fixture = deps([]);
  const calls: Array<Record<string, unknown>> = [];
  Object.assign(fixture.value, {
    acknowledgeManualReview: async (input: Record<string, unknown>) => {
      calls.push(input);
      return {
        reviewId: input.reviewId,
        status: 'acknowledged',
        resolutionCode: input.resolutionCode,
        operatorActorId: input.operatorActorId,
        operationId: input.operationId,
        duplicate: false,
      };
    },
  });
  const response = await handleAppleIapConsumption(
    operationRequest({
      action: 'acknowledge-review',
      reviewId: '30000000-0000-4000-8000-000000000098',
      resolutionCode: 'APPLE_RECONCILIATION_REQUIRED',
      operationId: OPERATION_ID,
      userId: 'must-not-bind',
      transactionId: 'must-not-resend',
    }),
    fixture.value,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reviewId: '30000000-0000-4000-8000-000000000098',
    status: 'acknowledged',
    resolutionCode: 'APPLE_RECONCILIATION_REQUIRED',
    operatorActorId: OPERATOR_ACTOR_ID,
    operationId: OPERATION_ID,
    duplicate: false,
  });
  assert.deepEqual(calls, [{
    reviewId: '30000000-0000-4000-8000-000000000098',
    resolutionCode: 'APPLE_RECONCILIATION_REQUIRED',
    operatorActorId: OPERATOR_ACTOR_ID,
    operationId: OPERATION_ID,
  }]);
});
