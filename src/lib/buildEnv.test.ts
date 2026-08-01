import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BuildEnvironmentError,
  CSP_CONNECT_MARKER,
  CSP_HTTP_MARKER,
  injectCspOrigins,
  validateBuildEnvironment,
} from '../../build/buildEnv';

/**
 * C3 bug condition:
 *   isBugConditionC3(env) = VITE_SUPABASE_URL empty
 *                        OR both keys empty
 *                        OR the URL is unparseable / non-HTTPS (non-loopback)
 *
 * Before the fix a production build with none of them set succeeded and emitted
 * a permanently demo-mode artifact, and `public/_headers` shipped no CSP at all
 * (verified zero occurrences of either marker token).
 */

const VALID = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
};

describe('C3 - a misconfigured production build cannot produce an artifact', () => {
  it('fails when VITE_SUPABASE_URL is missing or empty, naming the variable', () => {
    for (const url of [undefined, '', '   ']) {
      expect(() => validateBuildEnvironment({ ...VALID, VITE_SUPABASE_URL: url }))
        .toThrow(/VITE_SUPABASE_URL is missing or empty/);
    }
  });

  it('fails when both key variables are missing or empty, naming the variable', () => {
    expect(() => validateBuildEnvironment({ VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL }))
      .toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY is missing or empty/);
    expect(() => validateBuildEnvironment({
      VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_SUPABASE_ANON_KEY: '  ',
    })).toThrow(BuildEnvironmentError);
  });

  it('PRESERVATION: the VITE_SUPABASE_ANON_KEY fallback satisfies the key requirement', () => {
    // This fallback is load-bearing: `src/lib/supabase.ts` already accepts it,
    // so a build that only sets it must keep working.
    expect(validateBuildEnvironment({
      VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toEqual({
      origin: 'https://project.supabase.co',
      websocketOrigin: 'wss://project.supabase.co',
    });
  });

  it('accepts every valid URL form and rejects every invalid one', () => {
    const cases: Array<[string, 'accept' | 'reject']> = [
      ['https://project.supabase.co', 'accept'],
      ['https://project.supabase.co/', 'accept'],
      ['http://localhost:54321', 'accept'],
      ['http://127.0.0.1:54321', 'accept'],
      ['http://project.supabase.co', 'reject'],
      ['http://example.com', 'reject'],
      ['ftp://project.supabase.co', 'reject'],
      ['not-a-url', 'reject'],
      ['//project.supabase.co', 'reject'],
      ['project.supabase.co', 'reject'],
    ];
    for (const [url, expectation] of cases) {
      const run = () => validateBuildEnvironment({ ...VALID, VITE_SUPABASE_URL: url });
      if (expectation === 'accept') {
        expect(run, url).not.toThrow();
      } else {
        expect(run, url).toThrow(BuildEnvironmentError);
      }
    }
  });

  it('derives the websocket origin realtime actually connects to', () => {
    expect(validateBuildEnvironment(VALID).websocketOrigin).toBe('wss://project.supabase.co');
    expect(validateBuildEnvironment({ ...VALID, VITE_SUPABASE_URL: 'http://localhost:54321' })
      .websocketOrigin).toBe('ws://localhost:54321');
  });
});

describe('C3 - a valid build emits a complete, marker-free CSP', () => {
  const headersPath = resolve(process.cwd(), 'public', '_headers');
  const headers = readFileSync(headersPath, 'utf8');

  it('public/_headers ships both marker tokens and never a real project URL', () => {
    expect(headers).toContain(CSP_HTTP_MARKER);
    expect(headers).toContain(CSP_CONNECT_MARKER);
    expect(headers).toMatch(/^\s*Content-Security-Policy:/m);
    // Committing a real or placeholder project URL is the thing the markers exist
    // to avoid.
    expect(headers).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/);
  });

  it('PRESERVATION: the five non-CSP headers are byte-identical', () => {
    for (const header of [
      '  X-Content-Type-Options: nosniff',
      '  X-Frame-Options: DENY',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
      '  X-DNS-Prefetch-Control: off',
    ]) {
      expect(headers.split(/\r?\n/)).toContain(header);
    }
  });

  it('substitutes both markers and names the https and wss origins', () => {
    const injected = injectCspOrigins(headers, validateBuildEnvironment(VALID));
    expect(injected).not.toContain(CSP_HTTP_MARKER);
    expect(injected).not.toContain(CSP_CONNECT_MARKER);
    expect(injected).toMatch(/connect-src 'self' https:\/\/project\.supabase\.co wss:\/\/project\.supabase\.co/);
    expect(injected).toMatch(/img-src [^;]*https:\/\/project\.supabase\.co/);
  });

  it('throws rather than shipping a policy with a surviving marker', () => {
    // Simulates a substitution helper that only handled one of the two tokens.
    const brokenInject = (text: string) => injectCspOrigins(
      text,
      { origin: CSP_CONNECT_MARKER, websocketOrigin: 'wss://x' },
    );
    expect(() => brokenInject(`connect-src ${CSP_HTTP_MARKER}`))
      .toThrow(/CSP marker __SUPABASE_CONNECT_SRC__ survived/);
  });

  it('records why CSP moved back into _headers', () => {
    expect(headers).toMatch(/SUPERSEDES/);
    expect(headers).toMatch(/Still required from the operator/);
  });
});
