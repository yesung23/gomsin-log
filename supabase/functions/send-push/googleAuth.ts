/**
 * The OAuth exchange FCM v1 requires, with no dependency.
 *
 * The obvious move is `npm:google-auth-library`, and the first version of this
 * did exactly that. It does not work here: Deno resolves npm specifiers out of
 * `node_modules`, this repository does not carry that package, and adding it to
 * `package.json` would put a server-only Google SDK into the dependency graph of
 * a browser bundle that deliberately ships no third-party SDK at all.
 *
 * So: Web Crypto, which Deno has built in. The whole exchange is a signed
 * assertion traded for a bearer token, and the only part that needs care is the
 * signature.
 *
 * Split out of `index.ts` so the encoding helpers can be unit-tested. The
 * exchange itself is not: it needs a real service account, and a fake one proves
 * nothing about whether Google accepts the signature. That verification is an
 * external gate.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * base64url, which is base64 with two substitutions and no padding.
 *
 * JWT uses it because a `+` or a `/` in a URL segment means something else. Every
 * one of the three JWT parts goes through here; a single unconverted character
 * makes Google reject the assertion with a message that says nothing useful.
 */
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  // A loop rather than `String.fromCharCode(...bytes)`: spreading a large array
  // into an argument list overflows the stack. A 256-byte signature is safe today
  // and a 4096-bit key would not be.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlText(value: string): string {
  return base64url(new TextEncoder().encode(value));
}

/**
 * The DER bytes inside a PEM block.
 *
 * Service-account keys arrive as PKCS#8 PEM with literal `\n` escapes when they
 * have been through a JSON round trip, so the newline handling matters: stripping
 * only real newlines leaves the escaped ones in the base64 and the import fails.
 */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) der[i] = binary.charCodeAt(i);
  return der;
}

/** The assertion's claim set. `now` is injected so the shape can be tested. */
export function buildClaim(account: ServiceAccount, nowSeconds: number) {
  return {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    // One hour is Google's maximum. Asking for more is rejected outright.
    exp: nowSeconds + 3600,
  };
}

export async function signAssertion(
  account: ServiceAccount,
  nowSeconds: number,
): Promise<string> {
  const unsigned = `${base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.`
    + `${base64urlText(JSON.stringify(buildClaim(account, nowSeconds)))}`;

  /*
    `as BufferSource` matches `_shared/e2eeVerify.ts`, which casts the same way at
    every Web Crypto boundary. TypeScript 5.7 parameterised `Uint8Array` by its
    buffer type, and a plain `new Uint8Array(n)` widens to `ArrayBufferLike`,
    which no longer satisfies `BufferSource`. The bytes are identical; only the
    declaration disagrees.
  */
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(unsigned) as BufferSource,
    ),
  );
  return `${unsigned}.${base64url(signature)}`;
}

export async function fetchAccessToken(
  account: ServiceAccount,
  nowSeconds: number,
): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: GRANT_TYPE,
      assertion: await signAssertion(account, nowSeconds),
    }),
  });
  if (!response.ok) throw new Error('E_PUSH_AUTH_FAILED');
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('E_PUSH_AUTH_FAILED');
  return body.access_token;
}
