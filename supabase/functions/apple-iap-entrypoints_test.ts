import { assertEquals, startEntrypoint } from './_shared/entrypointHarness.ts';

Deno.test({
  name: 'Apple IAP real Deno entrypoints fail closed before credentials or remote mutation',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const cases: Array<{
      name: string;
      url: URL;
      env: Record<string, string>;
      request: RequestInit;
      expectedStatus: number;
      expectedError: string;
    }> = [
      {
        name: 'sync',
        url: new URL('./apple-iap-sync/index.ts', import.meta.url),
        env: { ALLOWED_ORIGINS: 'https://gomsinlog.app' },
        request: {
          method: 'POST',
          headers: { Authorization: 'Bearer fake-user-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', environment: 'Production' }),
        },
        expectedStatus: 503,
        expectedError: 'E_IAP_NOT_CONFIGURED',
      },
      {
        name: 'notifications',
        url: new URL('./apple-iap-notifications/index.ts', import.meta.url),
        env: {},
        request: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signedPayload: 'a.b.c' }),
        },
        expectedStatus: 503,
        expectedError: 'E_IAP_NOT_CONFIGURED',
      },
      {
        name: 'reconcile',
        url: new URL('./apple-iap-reconcile/index.ts', import.meta.url),
        env: { APPLE_IAP_SCHEDULER_SECRET: 'configured-scheduler-secret-32-bytes' },
        request: {
          method: 'POST',
          headers: { 'x-iap-scheduler-secret': 'not-a-real-secret' },
        },
        expectedStatus: 401,
        expectedError: 'E_UNAUTHENTICATED',
      },
    ];

    for (const testCase of cases) {
      const entrypoint = await startEntrypoint(testCase.url, testCase.env, { method: 'GET' });
      try {
        const response = await fetch(entrypoint.origin, testCase.request);
        assertEquals(response.status, testCase.expectedStatus, `${testCase.name} must fail closed`);
        assertEquals(
          (await response.json()).error,
          testCase.expectedError,
          `${testCase.name} must not advance without server configuration`,
        );
      } finally {
        await entrypoint.stop();
      }
    }
  },
});
