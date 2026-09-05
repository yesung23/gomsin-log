import { strict as assert } from 'node:assert';
import { AppleCredentialError } from '../_shared/appleAuthCredentials.ts';
import { type AppleRegistrationDeps, handleAppleAuthCredentialRegistration } from './handler.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const SUBJECT = '000111.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.0001';
const ATTEMPT = '20000000-0000-4000-8000-000000000001';
const CLAIM = '30000000-0000-4000-8000-000000000001';
const TOKEN_ID = '40000000-0000-4000-8000-000000000001';
const CODE = 'authorization-code-secret-fixture';
const REFRESH = 'refresh-token-secret-fixture';
const ID_TOKEN = 'header.payload.signature';

function request(body: unknown, bearer = 'valid-user-token'): Request {
  return new Request('https://edge.example/apple-auth-credentials', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fixture() {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const deps: AppleRegistrationDeps = {
    authenticate: async (bearer) => {
      calls.push({ name: 'authenticate', value: bearer });
      return bearer === 'valid-user-token' ? { userId: USER, appleSubject: SUBJECT } : null;
    },
    digestCode: async () => 'a'.repeat(64),
    beginRegistration: async (input) => {
      calls.push({ name: 'begin', value: input });
      return { state: 'ready', claimToken: CLAIM, tokenId: TOKEN_ID };
    },
    exchangeCode: async (input) => {
      calls.push({ name: 'exchange', value: { ...input, authorizationCode: '<redacted>' } });
      return { idToken: ID_TOKEN, refreshToken: REFRESH };
    },
    verifyIdentityToken: async (token, audience) => {
      calls.push({ name: 'verify', value: { token: '<redacted>', audience } });
      assert.equal(token, ID_TOKEN);
      return { subject: SUBJECT };
    },
    encryptRefreshToken: async (input) => {
      calls.push({ name: `encrypt_${input.aadKind}`, value: { ...input, refreshToken: '<redacted>' } });
      assert.equal(input.refreshToken, REFRESH);
      return {
        ciphertextB64: input.aadKind === 'quarantine' ? 'quarantine-ciphertext' : 'verified-ciphertext',
        nonceB64: 'nonce-fixture',
        keyId: 'key-2026-09',
        cryptoVersion: 1,
      };
    },
    captureRegistration: async (input) => {
      calls.push({ name: 'capture', value: input });
      return { state: 'captured' };
    },
    preparePromotion: async (input) => {
      calls.push({ name: 'prepare', value: input });
      return { state: 'prepared', generation: 1 };
    },
    promoteRegistration: async (input) => {
      calls.push({ name: 'promote', value: input });
      return { state: 'registered', generation: 1, unresolvedExchange: false };
    },
    failRegistration: async (input) => { calls.push({ name: 'fail', value: input }); },
    revokeToken: async () => { calls.push({ name: 'revoke', value: '<redacted>' }); },
  };
  return { deps, calls };
}

Deno.test('registration captures quarantine before remote identity verification then promotes with distinct verified AAD', async () => {
  const { deps, calls } = fixture();
  const response = await handleAppleAuthCredentialRegistration(request({
    attemptId: ATTEMPT,
    authorizationCode: CODE,
  }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    registered: true,
    duplicate: false,
    generation: 1,
    unresolvedExchange: false,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    'authenticate', 'begin', 'exchange', 'encrypt_quarantine', 'capture',
    'verify', 'prepare', 'encrypt_verified', 'promote',
  ]);
  const quarantine = calls.find((call) => call.name === 'encrypt_quarantine')?.value as Record<string, unknown>;
  const verified = calls.find((call) => call.name === 'encrypt_verified')?.value as Record<string, unknown>;
  assert.equal(quarantine.appleSubject, undefined);
  assert.equal(quarantine.generation, undefined);
  assert.equal(quarantine.tokenId, TOKEN_ID);
  assert.equal(verified.appleSubject, SUBJECT);
  assert.equal(verified.generation, 1);
  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes(CODE), false);
  assert.equal(serialized.includes(REFRESH), false);
  assert.equal(serialized.includes(ID_TOKEN), false);
});

Deno.test('signature, audience, expiry and sub failures revoke the already captured quarantine token', async () => {
  for (const code of ['TOKEN_SIGNATURE_INVALID', 'TOKEN_AUDIENCE_INVALID', 'TOKEN_EXPIRED'] as const) {
    const { deps, calls } = fixture();
    deps.verifyIdentityToken = async () => { throw new AppleCredentialError(code, 'rejected'); };
    const response = await handleAppleAuthCredentialRegistration(request({
      attemptId: ATTEMPT,
      authorizationCode: CODE,
    }), deps);
    assert.equal(response.status, 400);
    assert.deepEqual(calls.map((call) => call.name).slice(0, 7), [
      'authenticate', 'begin', 'exchange', 'encrypt_quarantine', 'capture', 'revoke', 'fail',
    ]);
    const failure = calls.at(-1)?.value as Record<string, unknown>;
    assert.equal(failure.failureCode, code);
    assert.equal(failure.tokenOutcome, 'revoked');
  }

  const { deps, calls } = fixture();
  deps.verifyIdentityToken = async () => ({ subject: 'different-subject' });
  const response = await handleAppleAuthCredentialRegistration(request({
    attemptId: ATTEMPT,
    authorizationCode: CODE,
  }), deps);
  assert.equal(response.status, 409);
  assert.equal(calls.some((call) => call.name === 'capture'), true);
  assert.equal(calls.some((call) => call.name === 'revoke'), true);
  assert.equal(calls.some((call) => call.name === 'promote'), false);
});

Deno.test('capture and promotion response loss are retried idempotently without another exchange', async () => {
  const { deps, calls } = fixture();
  let captures = 0;
  deps.captureRegistration = async () => {
    calls.push({ name: 'capture' });
    captures += 1;
    if (captures === 1) throw new Error('response lost');
    return { state: 'captured' };
  };
  let promotions = 0;
  deps.promoteRegistration = async () => {
    calls.push({ name: 'promote' });
    promotions += 1;
    if (promotions === 1) throw new Error('response lost');
    return { state: 'completed', generation: 1 };
  };
  const response = await handleAppleAuthCredentialRegistration(request({ attemptId: ATTEMPT, authorizationCode: CODE }), deps);
  assert.equal(response.status, 200);
  assert.equal(captures, 2);
  assert.equal(promotions, 2);
  assert.equal(calls.filter((call) => call.name === 'exchange').length, 1);
});

Deno.test('unproven capture plus failed revoke records sticky uncertainty', async () => {
  const { deps, calls } = fixture();
  let captures = 0;
  deps.captureRegistration = async () => { captures += 1; throw new Error('response lost'); };
  deps.revokeToken = async () => { calls.push({ name: 'revoke' }); throw new Error('timeout'); };
  const response = await handleAppleAuthCredentialRegistration(request({ attemptId: ATTEMPT, authorizationCode: CODE }), deps);
  assert.equal(response.status, 503);
  assert.equal(captures, 2);
  const failure = calls.find((call) => call.name === 'fail')?.value as Record<string, unknown>;
  assert.equal(failure.outcome, 'uncertain');
  assert.equal(failure.tokenOutcome, 'retryable');
});

Deno.test('admission outcomes freeze the HTTP contract and never exchange an Apple code', async () => {
  const cases = [
    [{ state: 'covered', generation: 3, unresolvedExchange: true } as const, 200,
      { registered: true, duplicate: true, generation: 3, unresolvedExchange: true }],
    [{ state: 'completed', generation: 3, unresolvedExchange: false } as const, 200,
      { registered: true, duplicate: true, generation: 3, unresolvedExchange: false }],
    [{ state: 'replay' } as const, 409, { error: 'E_APPLE_CODE_REPLAYED' }],
    [{ state: 'deletion_pending' } as const, 409, { error: 'E_ACCOUNT_DELETION_PENDING' }],
    [{ state: 'rate_limited' } as const, 429, { error: 'E_RATE_LIMITED' }],
    [{ state: 'capacity_limited' } as const, 429, { error: 'E_CREDENTIAL_CAPACITY' }],
    [{ state: 'busy' } as const, 409, { error: 'E_REGISTRATION_IN_PROGRESS' }],
    [{ state: 'captured' } as const, 409, { error: 'E_REGISTRATION_RECONCILIATION_REQUIRED' }],
    [{ state: 'identity_conflict' } as const, 409, { error: 'E_APPLE_IDENTITY_CONFLICT' }],
  ] as const;
  for (const [decision, status, expectedBody] of cases) {
    const { deps, calls } = fixture();
    deps.beginRegistration = async () => decision;
    const response = await handleAppleAuthCredentialRegistration(request({ attemptId: ATTEMPT, authorizationCode: CODE }), deps);
    assert.equal(response.status, status);
    assert.equal(calls.some((call) => call.name === 'exchange'), false);
    assert.deepEqual(await response.json(), expectedBody);
  }
});

Deno.test('malformed, oversized and caller-selected audience requests stop before admission', async () => {
  for (const [body, bearer] of [
    [{ attemptId: ATTEMPT, authorizationCode: CODE }, 'invalid'],
    [{ attemptId: 'not-a-uuid', authorizationCode: CODE }, 'valid-user-token'],
    [{ attemptId: ATTEMPT, authorizationCode: '' }, 'valid-user-token'],
    [{ attemptId: ATTEMPT, authorizationCode: CODE, audience: 'app.gomsinlog.web' }, 'valid-user-token'],
    [{ attemptId: ATTEMPT, authorizationCode: 'x'.repeat(4_097) }, 'valid-user-token'],
  ] as const) {
    const { deps, calls } = fixture();
    const response = await handleAppleAuthCredentialRegistration(request(body, bearer), deps);
    assert.equal([400, 401].includes(response.status), true);
    assert.equal(calls.some((call) => call.name === 'begin'), false);
  }
});

Deno.test('exchange failures are bounded and never capture or return token material', async () => {
  for (const [code, status, expectedBody] of [
    ['CODE_INVALID', 409, { error: 'E_APPLE_CODE_INVALID', reauthorizationRequired: true }],
    ['TOKEN_RESPONSE_INVALID', 502, {
      error: 'E_APPLE_TOKEN_RESPONSE_INVALID', reauthorizationRequired: true,
    }],
    ['EXCHANGE_TIMEOUT', 503, {
      error: 'E_APPLE_EXCHANGE_UNCERTAIN', reauthorizationRequired: true,
    }],
    ['EXCHANGE_SERVER', 503, {
      error: 'E_APPLE_EXCHANGE_UNCERTAIN', reauthorizationRequired: true,
    }],
  ] as const) {
    const { deps, calls } = fixture();
    deps.exchangeCode = async () => {
      throw new AppleCredentialError(code, code === 'CODE_INVALID' ? 'rejected' : 'uncertain');
    };
    const response = await handleAppleAuthCredentialRegistration(request({ attemptId: ATTEMPT, authorizationCode: CODE }), deps);
    assert.equal(response.status, status);
    assert.equal(calls.some((call) => call.name === 'capture'), false);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, expectedBody);
    const serialized = JSON.stringify(responseBody) + JSON.stringify(calls);
    assert.equal(serialized.includes(CODE), false);
    assert.equal(serialized.includes(REFRESH), false);
  }
});

Deno.test({
  name: 'real registration entrypoint fails closed when Apple env is absent',
  permissions: { net: true, env: true, read: true, run: true },
  fn: async () => {
    const child = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-net', '--allow-env', '--quiet', new URL('./index.ts', import.meta.url).href],
      env: {
        ...Deno.env.toObject(),
        NO_COLOR: '1',
        ALLOWED_ORIGINS: 'https://gomsinlog.app',
        SUPABASE_URL: 'http://127.0.0.1:9',
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test_key' }),
        APPLE_AUTH_TEAM_ID: '',
        APPLE_AUTH_SIGNING_KEY_ID: '',
        APPLE_AUTH_PRIVATE_KEY_P8: '',
        APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID: '',
        APPLE_AUTH_CREDENTIAL_KEYS: '',
      },
      stdout: 'piped',
      stderr: 'piped',
    }).spawn();
    const origin = 'http://127.0.0.1:8000';
    let ready = false;
    try {
      for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
        try {
          const probe = await fetch(`${origin}/apple-auth-credentials`, {
            method: 'OPTIONS', headers: { Origin: 'https://gomsinlog.app' },
          });
          await probe.body?.cancel();
          ready = true;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      assert.equal(ready, true);
      const response = await fetch(`${origin}/apple-auth-credentials`, {
        method: 'POST',
        headers: { Origin: 'https://gomsinlog.app', Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: ATTEMPT, authorizationCode: CODE }),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'E_APPLE_NOT_CONFIGURED' });
    } finally {
      try { child.kill('SIGKILL'); } catch { /* already stopped */ }
      await child.output();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },
});
