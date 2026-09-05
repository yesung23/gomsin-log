import { strict as assert } from 'node:assert';
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'npm:jose@6.2.3';
import {
  AppleCredentialError,
  APPLE_NATIVE_CLIENT_ID,
  createAppleClientSecret,
  decryptRefreshToken,
  encryptRefreshToken,
  exchangeAuthorizationCode,
  extractVerifiedAppleSubject,
  loadAppleAuthCredentialConfig,
  revokeAppleCredentialForDeletion,
  revokeRefreshToken,
  verifyAppleIdentityToken,
} from './appleAuthCredentials.ts';

const USER = '10000000-0000-4000-8000-000000000001';
const ATTEMPT = '20000000-0000-4000-8000-000000000001';
const TOKEN_ID = '30000000-0000-4000-8000-000000000001';
const DELETION_LIFECYCLE = '40000000-0000-4000-8000-000000000001';
const REPLACEMENT_DELETION_LIFECYCLE = '40000000-0000-4000-8000-000000000002';
const SUBJECT = '000111.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.0001';
const AUDIENCE = 'app.gomsinlog';
const KEY_ID = 'credential-key-2026-09';

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function envFixture(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    APPLE_AUTH_TEAM_ID: 'TEAM123456',
    APPLE_AUTH_SIGNING_KEY_ID: 'KEY1234567',
    APPLE_AUTH_PRIVATE_KEY_P8: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID: KEY_ID,
    APPLE_AUTH_CREDENTIAL_KEYS: JSON.stringify({ [KEY_ID]: base64(new Uint8Array(32).fill(7)) }),
    ...overrides,
  };
  return (key: string) => values[key];
}

function appleUser(subject: string | null = SUBJECT) {
  return {
    id: USER,
    app_metadata: { provider: 'apple', providers: ['apple'] },
    identities: subject === null ? [] : [{
      provider: 'apple',
      user_id: USER,
      identity_data: { sub: subject },
    }],
  };
}

Deno.test('apple credential config accepts only the native app audience', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  assert.equal(APPLE_NATIVE_CLIENT_ID, AUDIENCE);
  assert.equal(config.activeCredentialKeyId, KEY_ID);
  await assert.rejects(
    () => createAppleClientSecret(config, 'app.gomsinlog.web'),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'APPLE_CLIENT_CONFIGURATION',
  );
});

Deno.test('apple credential config fails closed for missing, malformed or wrong-sized keys', () => {
  for (const overrides of [
    { APPLE_AUTH_TEAM_ID: undefined },
    { APPLE_AUTH_CREDENTIAL_KEYS: JSON.stringify({ [KEY_ID]: base64(new Uint8Array(16)) }) },
    { APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID: 'missing-key' },
  ]) {
    assert.throws(() => loadAppleAuthCredentialConfig(envFixture(overrides)));
  }
});

Deno.test('verified Apple subject comes only from a same-user Apple identity', () => {
  assert.equal(extractVerifiedAppleSubject(appleUser()), SUBJECT);
  assert.equal(extractVerifiedAppleSubject({
    ...appleUser(),
    identities: [{
      provider: 'apple',
      user_id: 'another-user',
      identity_data: { sub: SUBJECT },
    }],
  }), null);
  assert.equal(extractVerifiedAppleSubject({
    ...appleUser(),
    identities: [
      ...appleUser().identities,
      { provider: 'apple', user_id: USER, identity_data: { sub: 'different-subject' } },
    ],
  }), null);
});

Deno.test('Apple identity JWT verification accepts RS256 issuer/audience/time and rejects signature, audience and expiry', async () => {
  const good = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'good' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(good.privateKey);
  assert.deepEqual(
    await verifyAppleIdentityToken(token, AUDIENCE, good.publicKey),
    { subject: SUBJECT },
  );

  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'good' })
    .setIssuer('https://appleid.apple.com')
    .setAudience('another.client')
    .setSubject(SUBJECT)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(good.privateKey);
  await assert.rejects(() => verifyAppleIdentityToken(wrongAudience, AUDIENCE, good.publicKey));
  await assert.rejects(() => verifyAppleIdentityToken(token, AUDIENCE, other.publicKey));

  const wrongIssuer = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'good' })
    .setIssuer('https://attacker.example')
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(good.privateKey);
  await assert.rejects(() => verifyAppleIdentityToken(wrongIssuer, AUDIENCE, good.publicKey));

  const futureIssued = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'good' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt(now + 60)
    .setExpirationTime(now + 300)
    .sign(good.privateKey);
  await assert.rejects(() => verifyAppleIdentityToken(futureIssued, AUDIENCE, good.publicKey));

  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'good' })
    .setIssuer('https://appleid.apple.com')
    .setAudience(AUDIENCE)
    .setSubject(SUBJECT)
    .setIssuedAt(now - 600)
    .setExpirationTime(now - 300)
    .sign(good.privateKey);
  await assert.rejects(() => verifyAppleIdentityToken(expired, AUDIENCE, good.publicKey));
  const jwk = await exportJWK(good.publicKey);
  assert.equal(jwk.kty, 'RSA');
});

Deno.test('Apple client secret uses the official ES256 claims and selected client ID', async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const privateKey = await exportPKCS8(pair.privateKey);
  const config = loadAppleAuthCredentialConfig(envFixture({ APPLE_AUTH_PRIVATE_KEY_P8: privateKey }));
  const now = 1_800_000_000;
  const secret = await createAppleClientSecret(config, AUDIENCE, now);
  const { payload, protectedHeader } = await jwtVerify(secret, pair.publicKey, {
    issuer: 'TEAM123456', audience: 'https://appleid.apple.com',
    subject: AUDIENCE, algorithms: ['ES256'], currentDate: new Date(now * 1_000),
  });
  assert.equal(protectedHeader.kid, 'KEY1234567');
  assert.equal(payload.exp, now + 300);
});

Deno.test('AES-GCM refresh-token storage round-trips and fails under changed authenticated context', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  assert.equal(encrypted.cryptoVersion, 1);
  assert.equal(encrypted.keyId, KEY_ID);
  assert.notEqual(encrypted.ciphertextB64.includes('refresh-token-secret'), true);
  assert.equal(await decryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, ...encrypted,
  }), 'refresh-token-secret');
  await assert.rejects(() => decryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: 'different-subject', generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, ...encrypted,
  }));
});

Deno.test('missing old encryption key is distinct from authenticated-data corruption', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const withoutOldKey = loadAppleAuthCredentialConfig(envFixture({
    APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID: 'new-key',
    APPLE_AUTH_CREDENTIAL_KEYS: JSON.stringify({
      'new-key': base64(new Uint8Array(32).fill(8)),
    }),
  }));
  await assert.rejects(
    () => decryptRefreshToken({
      config: withoutOldKey, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
      audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, ...encrypted,
    }),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'KEY_UNAVAILABLE',
  );
  await assert.rejects(
    () => decryptRefreshToken({
      config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
      audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID,
      ...encrypted, ciphertextB64: base64(new Uint8Array(32).fill(9)),
    }),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'CREDENTIAL_UNRECOVERABLE',
  );
});

Deno.test('authorization-code exchange sends form body, parses a bounded token response and never uses a URL query', async () => {
  let seenUrl = '';
  let seenBody = '';
  const result = await exchangeAuthorizationCode({
    authorizationCode: 'raw-code-secret', audience: AUDIENCE, timeoutMs: 1_000,
    clientSecret: async () => 'client-secret-fixture',
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenBody = String(init?.body);
      return new Response(JSON.stringify({
        access_token: 'ignored-access', token_type: 'Bearer', expires_in: 3600,
        refresh_token: 'refresh-secret', id_token: 'header.payload.signature',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.deepEqual(result, {
    refreshToken: 'refresh-secret', idToken: 'header.payload.signature',
  });
  assert.equal(seenUrl, 'https://appleid.apple.com/auth/token');
  assert.equal(seenUrl.includes('raw-code-secret'), false);
  assert.equal(new URLSearchParams(seenBody).get('code'), 'raw-code-secret');
  assert.equal(new URLSearchParams(seenBody).get('grant_type'), 'authorization_code');
});

Deno.test('exchange classifies invalid code separately from timeout/non-JSON/429/5xx and missing refresh token', async () => {
  const run = (fetchImpl: typeof fetch) => exchangeAuthorizationCode({
    authorizationCode: 'raw-code-secret', audience: AUDIENCE, timeoutMs: 20,
    clientSecret: async () => 'client-secret-fixture', fetchImpl,
  });
  await assert.rejects(
    () => run(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'CODE_INVALID',
  );
  await assert.rejects(
    () => run(async () => new Response('not-json', { status: 200 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_NON_JSON',
  );
  await assert.rejects(
    () => run(async () => new Response('{}', { status: 429 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_RATE_LIMITED',
  );
  await assert.rejects(
    () => run(async () => new Response('{}', { status: 503 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_SERVER',
  );
  await assert.rejects(
    () => run(async () => new Response(JSON.stringify({ id_token: 'header.payload.signature' }), { status: 200 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'TOKEN_RESPONSE_INVALID',
  );
  await assert.rejects(
    () => run((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_TIMEOUT',
  );
});

Deno.test('Apple provider deadline includes a response body that stalls after headers', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => exchangeAuthorizationCode({
      authorizationCode: 'raw-code-secret',
      audience: AUDIENCE,
      timeoutMs: 20,
      clientSecret: async () => 'client-secret-fixture',
      fetchImpl: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = setTimeout(() => controller.close(), 200);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            controller.error(new DOMException('aborted', 'AbortError'));
          }, { once: true });
        },
      }), { status: 200 }),
    }),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_TIMEOUT',
  );
  assert.equal(Date.now() - startedAt < 150, true);
});

Deno.test('revocation accepts only HTTP 200 and classifies retryable and configuration failures', async () => {
  const run = (fetchImpl: typeof fetch) => revokeRefreshToken({
    refreshToken: 'refresh-secret', audience: AUDIENCE, timeoutMs: 100,
    clientSecret: async () => 'client-secret-fixture', fetchImpl,
  });
  await run(async () => new Response(null, { status: 200 }));
  await assert.rejects(
    () => run(async () => new Response('{"error":"invalid_client"}', { status: 400 })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'APPLE_CLIENT_CONFIGURATION',
  );
  for (const status of [429, 500, 503]) {
    await assert.rejects(
      () => run(async () => new Response('{}', { status })),
      (error: unknown) => error instanceof AppleCredentialError && error.outcome === 'retryable',
    );
  }
});

Deno.test('Apple revoke deadline includes a stalled error body', async () => {
  await assert.rejects(
    () => revokeRefreshToken({
      refreshToken: 'refresh-secret',
      audience: AUDIENCE,
      timeoutMs: 20,
      clientSecret: async () => 'client-secret-fixture',
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
        pull() { return new Promise(() => {}); },
      }), { status: 400 }),
    }),
    (error: unknown) => error instanceof AppleCredentialError &&
      error.code === 'REVOKE_TIMEOUT' && error.outcome === 'retryable',
  );
});

Deno.test('Apple exchange and revoke deadlines do not await a non-cooperative stream cancel', async () => {
  const nonCooperativeResponse = () => new Response(new ReadableStream<Uint8Array>({
    pull() { return new Promise(() => {}); },
    cancel() { return new Promise(() => {}); },
  }), { status: 400 });
  const watchdog = async <T>(operation: Promise<T>) => await Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('non-cooperative cancel exceeded watchdog')), 150);
    }),
  ]);

  const exchangeStartedAt = Date.now();
  await assert.rejects(
    () => watchdog(exchangeAuthorizationCode({
      authorizationCode: 'raw-code-secret',
      audience: AUDIENCE,
      timeoutMs: 20,
      clientSecret: async () => 'client-secret-fixture',
      fetchImpl: async () => nonCooperativeResponse(),
    })),
    (error: unknown) => error instanceof AppleCredentialError && error.code === 'EXCHANGE_TIMEOUT',
  );
  assert.equal(Date.now() - exchangeStartedAt < 140, true);

  const revokeStartedAt = Date.now();
  await assert.rejects(
    () => watchdog(revokeRefreshToken({
      refreshToken: 'refresh-secret',
      audience: AUDIENCE,
      timeoutMs: 20,
      clientSecret: async () => 'client-secret-fixture',
      fetchImpl: async () => nonCooperativeResponse(),
    })),
    (error: unknown) => error instanceof AppleCredentialError &&
      error.code === 'REVOKE_TIMEOUT' && error.outcome === 'retryable',
  );
  assert.equal(Date.now() - revokeStartedAt < 140, true);
});

Deno.test('deletion revocation is a no-op for Google-only users with no stored credential', async () => {
  const calls: string[] = [];
  const finalizeCalls: Record<string, unknown>[] = [];
  const result = await revokeAppleCredentialForDeletion({
    admin: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push(name);
        if (name === 'apple_auth_claim_deletion_revocation') {
          return { data: { state: 'none', deletion_lifecycle_id: DELETION_LIFECYCLE }, error: null };
        }
        finalizeCalls.push(args);
        return { data: { state: 'not_required', reason: 'VERIFIED_NO_APPLE_PROVIDER', provenance: 'runtime_admin_identity' }, error: null };
      },
    },
    user: {
      id: USER,
      app_metadata: { provider: 'google', providers: ['google'] },
      identities: [{ provider: 'google', user_id: USER, identity_data: { sub: 'google-sub' } }],
    },
    attemptId: ATTEMPT,
    env: () => undefined,
  });
  assert.deepEqual(result, { status: 'not_required' });
  assert.deepEqual(calls, [
    'apple_auth_claim_deletion_revocation',
    'apple_auth_finalize_deletion_no_token',
  ]);
  assert.equal(finalizeCalls[0]?.p_deletion_lifecycle_id, DELETION_LIFECYCLE);
});

Deno.test('deletion revocation rejects missing or malformed lifecycle fences before classification', async () => {
  for (const lifecycle of [undefined, 'not-a-lifecycle', `${DELETION_LIFECYCLE} `]) {
    const calls: string[] = [];
    let providerCalls = 0;
    const result = await revokeAppleCredentialForDeletion({
      admin: { rpc: async (name: string) => {
        calls.push(name);
        if (name === 'apple_auth_claim_deletion_revocation') {
          return {
            data: {
              state: 'none',
              ...(lifecycle === undefined ? {} : { deletion_lifecycle_id: lifecycle }),
            },
            error: null,
          };
        }
        return {
          data: { state: 'not_required', reason: 'VERIFIED_NO_APPLE_PROVIDER', provenance: 'runtime_admin_identity' },
          error: null,
        };
      } },
      user: {
        id: USER,
        app_metadata: { provider: 'google', providers: ['google'] },
        identities: [{ provider: 'google', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      attemptId: ATTEMPT,
      env: () => undefined,
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(null, { status: 200 });
      },
    });
    assert.deepEqual(result, { status: 'retry_required', reason: 'provider_unavailable' });
    assert.deepEqual(calls, ['apple_auth_claim_deletion_revocation']);
    assert.equal(providerCalls, 0);
  }
});

Deno.test('one deletion invocation refuses a replacement lifecycle before more provider work', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  let claims = 0;
  let providerCalls = 0;
  const calls: string[] = [];
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async (name: string) => {
      calls.push(name);
      if (name === 'apple_auth_claim_deletion_revocation') {
        claims += 1;
        return claims === 1
          ? { data: {
            state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE,
            token_id: TOKEN_ID, lease_token: '30000000-0000-4000-8000-000000000001',
            aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
            audience: AUDIENCE, registration_attempt_id: ATTEMPT,
            ciphertext_b64: encrypted.ciphertextB64, nonce_b64: encrypted.nonceB64,
            key_id: encrypted.keyId, crypto_version: 1,
          }, error: null }
          : { data: { state: 'none', deletion_lifecycle_id: REPLACEMENT_DELETION_LIFECYCLE }, error: null };
      }
      if (name === 'apple_auth_complete_deletion_revocation') {
        return { data: { state: 'revoked', all_settled: false }, error: null };
      }
      return {
        data: { state: 'manual_required', reason: 'APPLE_PROVIDER_WITHOUT_TOKEN', provenance: 'runtime_admin_identity' },
        error: null,
      };
    } },
    user: appleUser(),
    attemptId: ATTEMPT,
    env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(result, { status: 'retry_required', reason: 'operator_review_required' });
  assert.equal(providerCalls, 1);
  assert.deepEqual(calls, [
    'apple_auth_claim_deletion_revocation',
    'apple_auth_complete_deletion_revocation',
    'apple_auth_claim_deletion_revocation',
  ]);
});

Deno.test('no-token provider evidence is tri-state and incomplete metadata never becomes not-required', async () => {
  const fixtures = [
    {
      label: 'complete non-Apple evidence',
      user: {
        id: USER,
        app_metadata: { provider: 'google', providers: ['google'] },
        identities: [{ provider: 'google', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      rpcOutcome: 'not_required',
      rpcReason: 'VERIFIED_NO_APPLE_PROVIDER',
      expected: { status: 'not_required' },
    },
    {
      label: 'complete email evidence',
      user: {
        id: USER,
        app_metadata: { provider: 'email', providers: ['email'] },
        identities: [{ provider: 'email', user_id: USER, identity_data: { sub: 'email-sub' } }],
      },
      rpcOutcome: 'not_required',
      rpcReason: 'VERIFIED_NO_APPLE_PROVIDER',
      expected: { status: 'not_required' },
    },
    {
      label: 'unknown but well-formed provider is not allowlisted',
      user: {
        id: USER,
        app_metadata: { provider: 'github', providers: ['github'] },
        identities: [{ provider: 'github', user_id: USER, identity_data: { sub: 'github-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'uppercase provider is malformed without case repair',
      user: {
        id: USER,
        app_metadata: { provider: 'Google', providers: ['Google'] },
        identities: [{ provider: 'Google', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'whitespace provider is malformed without trimming',
      user: {
        id: USER,
        app_metadata: { provider: 'google ', providers: ['google '] },
        identities: [{ provider: 'google ', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'punctuated provider is malformed',
      user: {
        id: USER,
        app_metadata: { provider: 'google.com', providers: ['google.com'] },
        identities: [{ provider: 'google.com', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'overlong provider is malformed',
      user: {
        id: USER,
        app_metadata: { provider: `g${'a'.repeat(64)}`, providers: [`g${'a'.repeat(64)}`] },
        identities: [{ provider: `g${'a'.repeat(64)}`, user_id: USER, identity_data: { sub: 'provider-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'scalar-only provider',
      user: { id: USER, app_metadata: { provider: 'google' } },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'missing providers collection',
      user: {
        id: USER,
        app_metadata: { provider: 'google' },
        identities: [{ provider: 'google', user_id: USER, identity_data: { sub: 'google-sub' } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'malformed providers collection',
      user: { id: USER, app_metadata: { provider: 'google', providers: 'google' }, identities: [] },
      rpcOutcome: 'manual_required',
      rpcReason: 'PROVIDER_IDENTITY_UNVERIFIED',
      expected: { status: 'manual_required', reason: 'provider_identity_unverified' },
    },
    {
      label: 'conflicting Apple identity evidence',
      user: {
        id: USER,
        app_metadata: { provider: 'google', providers: ['google'] },
        identities: [{ provider: 'apple', user_id: USER, identity_data: { sub: SUBJECT } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'APPLE_PROVIDER_WITHOUT_TOKEN',
      expected: { status: 'manual_required', reason: 'no_credential' },
    },
    {
      label: 'valid Apple identity stays conservative despite malformed ancillary evidence',
      user: {
        id: USER,
        app_metadata: { provider: 'Google', providers: ['google '] },
        identities: [{ provider: 'apple', user_id: USER, identity_data: { sub: SUBJECT } }],
      },
      rpcOutcome: 'manual_required',
      rpcReason: 'APPLE_PROVIDER_WITHOUT_TOKEN',
      expected: { status: 'manual_required', reason: 'no_credential' },
    },
  ] as const;

  for (const fixture of fixtures) {
    const finalizeCalls: Record<string, unknown>[] = [];
    let providerCalls = 0;
    const result = await revokeAppleCredentialForDeletion({
      admin: { rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'apple_auth_claim_deletion_revocation') {
          return { data: { state: 'none', deletion_lifecycle_id: DELETION_LIFECYCLE }, error: null };
        }
        finalizeCalls.push(args);
        return { data: {
          state: fixture.rpcOutcome,
          reason: fixture.rpcReason,
          provenance: 'runtime_admin_identity',
        }, error: null };
      } },
      user: fixture.user,
      attemptId: ATTEMPT,
      env: () => undefined,
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(null, { status: 200 });
      },
    });
    assert.deepEqual(result, fixture.expected, fixture.label);
    assert.equal(finalizeCalls[0]?.p_deletion_lifecycle_id, DELETION_LIFECYCLE, fixture.label);
    assert.equal(finalizeCalls[0]?.p_outcome, fixture.rpcOutcome, fixture.label);
    assert.equal(finalizeCalls[0]?.p_reason, fixture.rpcReason, fixture.label);
    assert.equal(providerCalls, 0, fixture.label);
  }
});

Deno.test('Apple deletion with no stored token proceeds only with explicit manual guidance', async () => {
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async (name: string) => name === 'apple_auth_claim_deletion_revocation'
      ? { data: { state: 'none', deletion_lifecycle_id: DELETION_LIFECYCLE }, error: null }
      : { data: { state: 'manual_required', reason: 'APPLE_PROVIDER_WITHOUT_TOKEN', provenance: 'runtime_admin_identity' }, error: null } },
    user: appleUser(), attemptId: ATTEMPT, env: () => undefined,
  });
  assert.deepEqual(result, { status: 'manual_required', reason: 'no_credential' });
});

Deno.test('lost exchange response remains explicit manual recovery evidence during deletion', async () => {
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async () => ({ data: {
      state: 'manual_required', deletion_lifecycle_id: DELETION_LIFECYCLE,
      reason: 'EXCHANGE_UNCERTAIN', provenance: 'runtime_admin_identity',
    }, error: null }) },
    user: appleUser(), attemptId: ATTEMPT, env: () => undefined,
  });
  assert.deepEqual(result, { status: 'manual_required', reason: 'exchange_uncertain' });
});

Deno.test('deletion decrypts the bound credential, revokes it and confirms durable completion', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const lease = '30000000-0000-4000-8000-000000000001';
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let revokeBody = '';
  let signalProviderStarted = () => {};
  const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve; });
  let releaseProvider = () => {};
  const providerDelay = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const operation = revokeAppleCredentialForDeletion({
    admin: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === 'apple_auth_claim_deletion_revocation') {
          return { data: {
            state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE,
            token_id: TOKEN_ID, lease_token: lease,
            aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
            audience: AUDIENCE, registration_attempt_id: ATTEMPT,
            ciphertext_b64: encrypted.ciphertextB64, nonce_b64: encrypted.nonceB64,
            key_id: encrypted.keyId, crypto_version: encrypted.cryptoVersion,
          }, error: null };
        }
        return { data: {
          state: 'revoked', all_settled: true, terminal_state: 'revoked',
          terminal_reason: 'ALL_KNOWN_TOKENS_REVOKED', terminal_provenance: 'provider_http_200',
        }, error: null };
      },
    },
    user: appleUser(), attemptId: ATTEMPT, env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
      revokeBody = String(init?.body);
      signalProviderStarted();
      await providerDelay;
      return new Response(null, { status: 200 });
    },
  });
  await providerStarted;
  releaseProvider();
  const result = await operation;
  assert.deepEqual(result, { status: 'revoked' });
  assert.equal(new URLSearchParams(revokeBody).get('token'), 'refresh-token-secret');
  assert.equal(JSON.stringify(rpcCalls).includes('refresh-token-secret'), false);
  assert.deepEqual(rpcCalls.at(-1), {
    name: 'apple_auth_complete_deletion_revocation',
    args: {
      p_user_id: USER, p_attempt_id: ATTEMPT, p_deletion_lifecycle_id: DELETION_LIFECYCLE,
      p_token_id: TOKEN_ID, p_lease_token: lease,
      p_outcome: 'revoked', p_error_code: null,
    },
  });
});

Deno.test('a stale lifecycle completion never becomes handled revocation success', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async (name: string) => name === 'apple_auth_claim_deletion_revocation'
      ? { data: {
        state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE,
        token_id: TOKEN_ID, lease_token: '30000000-0000-4000-8000-000000000001',
        aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
        audience: AUDIENCE, registration_attempt_id: ATTEMPT,
        ciphertext_b64: encrypted.ciphertextB64, nonce_b64: encrypted.nonceB64,
        key_id: encrypted.keyId, crypto_version: 1,
      }, error: null }
      : { data: { state: 'stale' }, error: null } },
    user: appleUser(),
    attemptId: ATTEMPT,
    env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async () => new Response(null, { status: 200 }),
  });
  assert.deepEqual(result, { status: 'retry_required', reason: 'provider_unavailable' });
});

Deno.test('terminal completion preserves authoritative exchange-uncertain reason instead of narrowing it', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async (name: string) => name === 'apple_auth_claim_deletion_revocation'
      ? { data: {
        state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE, token_id: TOKEN_ID,
        lease_token: '30000000-0000-4000-8000-000000000001',
        aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
        audience: AUDIENCE, registration_attempt_id: ATTEMPT,
        ciphertext_b64: encrypted.ciphertextB64, nonce_b64: encrypted.nonceB64,
        key_id: encrypted.keyId, crypto_version: 1,
      }, error: null }
      : { data: {
        state: 'revoked', all_settled: true, terminal_state: 'manual_required',
        terminal_reason: 'EXCHANGE_UNCERTAIN', terminal_provenance: 'runtime_admin_identity',
      }, error: null } },
    user: appleUser(),
    attemptId: ATTEMPT,
    env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async () => new Response(null, { status: 200 }),
  });
  assert.deepEqual(result, { status: 'manual_required', reason: 'exchange_uncertain' });
});

Deno.test('durable manual terminal state replays without provider work', async () => {
  let fetched = false;
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async () => ({ data: {
      state: 'manual_required', deletion_lifecycle_id: DELETION_LIFECYCLE,
      reason: 'EXCHANGE_UNCERTAIN', provenance: 'runtime_admin_identity',
    }, error: null }) },
    user: appleUser(), attemptId: ATTEMPT, env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async () => { fetched = true; return new Response(null, { status: 200 }); },
  });
  assert.deepEqual(result, { status: 'manual_required', reason: 'exchange_uncertain' });
  assert.equal(fetched, false);
});

Deno.test('retryable Apple failure and missing encryption key stop deletion without claiming success', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const claimed = {
    state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE, token_id: TOKEN_ID,
    lease_token: '30000000-0000-4000-8000-000000000001',
    aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
    audience: AUDIENCE, registration_attempt_id: ATTEMPT,
    ciphertext_b64: encrypted.ciphertextB64, nonce_b64: encrypted.nonceB64,
    key_id: encrypted.keyId, crypto_version: encrypted.cryptoVersion,
  };
  const run = async (env: (key: string) => string | undefined, fetchImpl?: typeof fetch) => {
    const completions: Record<string, unknown>[] = [];
    const result = await revokeAppleCredentialForDeletion({
      admin: { rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'apple_auth_claim_deletion_revocation') {
          return { data: claimed, error: null };
        }
        completions.push(args);
        return { data: { state: args.p_outcome }, error: null };
      } },
      user: appleUser(), attemptId: ATTEMPT, env,
      createClientSecret: async () => 'client-secret-fixture', fetchImpl,
    });
    return { result, completions };
  };

  const retryable = await run(envFixture(), async () => new Response('{}', { status: 503 }));
  assert.deepEqual(retryable.result, { status: 'retry_required', reason: 'provider_unavailable' });
  assert.equal(retryable.completions[0].p_deletion_lifecycle_id, DELETION_LIFECYCLE);
  assert.equal(retryable.completions[0].p_outcome, 'retryable');

  const missingKey = await run(envFixture({
    APPLE_AUTH_CREDENTIAL_ACTIVE_KEY_ID: 'new-key',
    APPLE_AUTH_CREDENTIAL_KEYS: JSON.stringify({
      'new-key': base64(new Uint8Array(32).fill(8)),
    }),
  }));
  assert.deepEqual(missingKey.result, { status: 'retry_required', reason: 'configuration_recovery' });
  assert.equal(missingKey.completions[0].p_deletion_lifecycle_id, DELETION_LIFECYCLE);
  assert.equal(missingKey.completions[0].p_outcome, 'configuration');
});

Deno.test('one deletion invocation revokes at most three verified or quarantine token rows', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const tokenIds = Array.from({ length: 4 }, (_, index) =>
    `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const encrypted = await Promise.all(tokenIds.map((tokenId) => encryptRefreshToken({
    config,
    aadKind: 'quarantine',
    userId: USER,
    audience: AUDIENCE,
    attemptId: ATTEMPT,
    tokenId,
    refreshToken: `refresh-token-${tokenId}`,
  })));
  let claims = 0;
  let providerCalls = 0;
  const result = await revokeAppleCredentialForDeletion({
    admin: { rpc: async (name: string) => {
      if (name === 'apple_auth_claim_deletion_revocation') {
        const index = claims++;
        return { data: {
          state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE, token_id: tokenIds[index],
          lease_token: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          aad_kind: 'quarantine', verified_subject: null, generation: null,
          audience: AUDIENCE, registration_attempt_id: ATTEMPT,
          ciphertext_b64: encrypted[index].ciphertextB64,
          nonce_b64: encrypted[index].nonceB64,
          key_id: encrypted[index].keyId, crypto_version: 1,
        }, error: null };
      }
      return { data: { state: 'revoked', all_settled: false }, error: null };
    } },
    user: appleUser(),
    attemptId: ATTEMPT,
    env: envFixture(),
    createClientSecret: async () => 'client-secret-fixture',
    fetchImpl: async () => { providerCalls += 1; return new Response(null, { status: 200 }); },
  });
  assert.deepEqual(result, { status: 'retry_required', reason: 'provider_unavailable' });
  assert.equal(claims, 3);
  assert.equal(providerCalls, 3);
});

Deno.test('corrupt Apple credentials become manual without provider work', async () => {
  const config = loadAppleAuthCredentialConfig(envFixture());
  const encrypted = await encryptRefreshToken({
    config, aadKind: 'verified', userId: USER, appleSubject: SUBJECT, generation: 1,
    audience: AUDIENCE, attemptId: ATTEMPT, tokenId: TOKEN_ID, refreshToken: 'refresh-token-secret',
  });
  const run = async (ciphertextB64: string) => {
    let fetched = false;
    let completion: any = null;
    const result = await revokeAppleCredentialForDeletion({
      admin: { rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'apple_auth_claim_deletion_revocation') return { data: {
          state: 'claimed', deletion_lifecycle_id: DELETION_LIFECYCLE, token_id: TOKEN_ID,
          lease_token: '30000000-0000-4000-8000-000000000001',
          aad_kind: 'verified', verified_subject: SUBJECT, generation: 1,
          audience: AUDIENCE, registration_attempt_id: ATTEMPT,
          ciphertext_b64: ciphertextB64, nonce_b64: encrypted.nonceB64,
          key_id: encrypted.keyId, crypto_version: encrypted.cryptoVersion,
        }, error: null };
        completion = args;
        return { data: {
          state: 'manual_required', all_settled: true, terminal_state: 'manual_required',
          terminal_reason: 'TOKEN_MANUAL_REQUIRED', terminal_provenance: 'runtime_admin_identity',
        }, error: null };
      } },
      user: appleUser(), attemptId: ATTEMPT, env: envFixture(),
      createClientSecret: async () => 'client-secret-fixture',
      fetchImpl: async () => { fetched = true; return new Response(null, { status: 200 }); },
    });
    return { result, fetched, completion };
  };
  const corrupt = await run(base64(new Uint8Array(32).fill(9)));
  assert.deepEqual(corrupt.result, { status: 'manual_required', reason: 'credential_unrecoverable' });
  assert.equal(corrupt.fetched, false);
  assert.equal(corrupt.completion?.p_deletion_lifecycle_id, DELETION_LIFECYCLE);
  assert.equal(corrupt.completion?.p_error_code, 'CREDENTIAL_UNRECOVERABLE');
});
