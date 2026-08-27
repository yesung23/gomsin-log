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
 * a permanently backend-less artifact, and `public/_headers` shipped no CSP at all
 * (verified zero occurrences of either marker token).
 */

const VALID = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  /*
   * A realistically-shaped anon JWT, not `'public-key'`.
   *
   * The validator now checks the SHAPE of the key, so a placeholder would fail here
   * for the right reason and make every unrelated assertion in this file confusing.
   * Payload decodes to `{"role":"anon","ref":"project"}`; the signature is filler
   * because nothing verifies it.
   */
  VITE_SUPABASE_PUBLISHABLE_KEY:
    'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InByb2plY3QifQ.sig',
};

describe('C3 - a misconfigured production build cannot produce an artifact', () => {
  it('refuses a public production deployment with anonymous legal ownership or no monitored contact', () => {
    expect(() => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_mock_key',
      deploymentTarget: 'production',
    })).toThrow(/VITE_LEGAL_OPERATOR_NAME/);
    expect(() => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_mock_key',
      deploymentTarget: 'production',
      VITE_LEGAL_OPERATOR_NAME: '곰신로그 운영자',
      VITE_PRIVACY_CONTACT_EMAIL: 'privacy@example.com',
    })).toThrow(/VITE_LEGAL_OPERATOR_NAME/);
    expect(() => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_mock_key',
      deploymentTarget: 'production',
      VITE_LEGAL_OPERATOR_NAME: '테스트 운영자',
    })).toThrow(/VITE_PRIVACY_CONTACT_EMAIL/);
  });

  it('accepts real legal ownership details for the public production target', () => {
    expect(() => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_mock_key',
      deploymentTarget: 'production',
      VITE_LEGAL_OPERATOR_NAME: '테스트 운영자',
      VITE_PRIVACY_CONTACT_EMAIL: 'privacy@gomsinlog.app',
    })).not.toThrow();
  });

  it('production fails closed with legacy JWT, anon-key fallback, or missing sb_publishable_ key', () => {
    const prodBase = {
      VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL,
      deploymentTarget: 'production',
      VITE_LEGAL_OPERATOR_NAME: '테스트 운영자',
      VITE_PRIVACY_CONTACT_EMAIL: 'privacy@gomsinlog.app',
    };

    // Legacy JWT is rejected for production artifacts
    expect(() => validateBuildEnvironment({
      ...prodBase,
      VITE_SUPABASE_PUBLISHABLE_KEY: VALID.VITE_SUPABASE_PUBLISHABLE_KEY,
    })).toThrow(/sb_publishable_/);

    // VITE_SUPABASE_ANON_KEY fallback is rejected for production
    expect(() => validateBuildEnvironment({
      ...prodBase,
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_prod_key',
    })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY is required for production/);

    // Missing or invalid format is rejected
    expect(() => validateBuildEnvironment({
      ...prodBase,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'invalid_format_key',
    })).toThrow(BuildEnvironmentError);
  });

  it('isRelease signal triggers strict production key and ownership validation', () => {
    const releaseBase = {
      VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL,
      isRelease: true,
      VITE_LEGAL_OPERATOR_NAME: '테스트 운영자',
      VITE_PRIVACY_CONTACT_EMAIL: 'privacy@gomsinlog.app',
    };

    // Legacy JWT rejected under explicit release signal
    expect(() => validateBuildEnvironment({
      ...releaseBase,
      VITE_SUPABASE_PUBLISHABLE_KEY: VALID.VITE_SUPABASE_PUBLISHABLE_KEY,
    })).toThrow(/sb_publishable_/);

    // Anon fallback rejected under explicit release signal
    expect(() => validateBuildEnvironment({
      ...releaseBase,
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_prod_key',
    })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY is required for production/);

    // Valid sb_publishable_ key accepted under release signal
    expect(() => validateBuildEnvironment({
      ...releaseBase,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_release_valid_token',
    })).not.toThrow();
  });

  it('keeps development sync usable while release build commands enforce the release signal', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:release']).toBeDefined();
    expect(pkg.scripts['build:release']).toContain('GOMSINLOG_RELEASE=true');
    expect(pkg.scripts['cap:sync:ios']).not.toContain('GOMSINLOG_RELEASE=true');
    expect(pkg.scripts['cap:release:ios']).toContain('GOMSINLOG_RELEASE=true');
    expect(pkg.scripts['cap:assemble']).toContain('GOMSINLOG_RELEASE=true');
  });

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
      // Shaped like a real key: the validator now checks the shape, so `'anon-key'`
      // would fail here for a reason unrelated to the fallback being tested.
      VITE_SUPABASE_ANON_KEY: VALID.VITE_SUPABASE_PUBLISHABLE_KEY,
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

describe('the key is checked for shape, not just for presence', () => {
  /*
   * This exists because it already happened. Production shipped with the Postgres
   * connection string in `VITE_SUPABASE_PUBLISHABLE_KEY`:
   *
   *   postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres
   *
   * The build passed -- the old check was only `if (!key)` -- and every request then
   * sent that string as `apikey`. GoTrue answered 401 Invalid API key, which reached
   * the user as "로그인 처리에 실패했습니다", indistinguishable from a genuine auth
   * failure. The two values sit next to each other in the Supabase dashboard.
   */
  it('rejects a Postgres connection string and says which value was wanted', () => {
    const run = () => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'postgresql://postgres:[YOUR-PASSWORD]@db.project.supabase.co:5432/postgres',
    });
    expect(run).toThrow(BuildEnvironmentError);
    // The message has to name the fix, since the person reading it just pasted the
    // wrong field and needs to know which one is right.
    expect(run).toThrow(/anon public/);
    expect(run).toThrow(/eyJ/);
  });

  it('rejects a placeholder that is merely non-empty', () => {
    for (const key of ['eyJ...', 'public-key', 'your-anon-key', 'TODO']) {
      expect(
        () => validateBuildEnvironment({ ...VALID, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
        key,
      ).toThrow(BuildEnvironmentError);
    }
  });

  it('refuses a service_role key outright, because that would be a data breach', () => {
    /*
     * Every `VITE_` value is inlined into the browser bundle and service_role bypasses
     * every RLS policy, so shipping one exposes all user data to anyone who opens the
     * app. The role claim is readable without verifying the signature, so this is the
     * cheapest possible place to stop it.
     */
    const payload = Buffer.from(JSON.stringify({ role: 'service_role', ref: 'project' })).toString('base64url');
    const run = () => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`,
    });
    expect(run).toThrow(BuildEnvironmentError);
    expect(run).toThrow(/service_role/);
    expect(run).toThrow(/rotate/);
  });

  it('error message on invalid key shape never leaks key candidate, prefix, or length', () => {
    const badKey = 'my_super_secret_invalid_key_value_12345';
    let thrown: Error | null = null;
    try {
      validateBuildEnvironment({ ...VALID, VITE_SUPABASE_PUBLISHABLE_KEY: badKey });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).not.toContain(badKey);
    expect(thrown!.message).not.toContain(badKey.slice(0, 10));
    expect(thrown!.message).not.toMatch(/\d+\s+characters/i);
    expect(thrown!.message).not.toMatch(/starting/i);
  });

  it('accepts both key formats Supabase issues', () => {
    // Legacy anon JWT.
    expect(() => validateBuildEnvironment(VALID)).not.toThrow();
    // Newer publishable format, which is not a JWT at all.
    expect(() => validateBuildEnvironment({
      ...VALID,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123DEF456',
    })).not.toThrow();
  });

  it('still accepts the ANON_KEY variable name, which src/lib/supabase.ts reads too', () => {
    expect(() => validateBuildEnvironment({
      VITE_SUPABASE_URL: VALID.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: VALID.VITE_SUPABASE_PUBLISHABLE_KEY,
    })).not.toThrow();
  });

  it('keeps every non-empty CI publishable-key placeholder buildable', () => {
    const workflowDirectory = resolve(process.cwd(), '.github', 'workflows');
    const workflows = [
      'master-validation.yml',
      'native-release-validation.yml',
      'two-account-pr-validation.yml',
      'v1-product-excellence-audit-pr-validation.yml',
      'web-release-validation.yml',
    ];

    for (const workflow of workflows) {
      const source = readFileSync(resolve(workflowDirectory, workflow), 'utf8');
      const values = Array.from(
        source.matchAll(/^\s*VITE_SUPABASE_PUBLISHABLE_KEY:\s*([^\s#]+)\s*$/gm),
        (match) => match[1].replace(/^['"]|['"]$/g, ''),
      ).filter((value) => value.length > 0);

      expect(values.length, workflow).toBeGreaterThan(0);
    for (const value of values) {
      expect(
        () => validateBuildEnvironment({
          VITE_SUPABASE_URL: 'https://ci-placeholder.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: value,
        }),
        `${workflow}: ${value}`,
      ).not.toThrow();
    }
  }
});

describe('supabase/config.toml function verification configuration', () => {
  it('declares explicit verify_jwt configuration for all edge functions', () => {
    const configPath = resolve(process.cwd(), 'supabase', 'config.toml');
    const config = readFileSync(configPath, 'utf8');
    expect(config).toMatch(/\[functions\.send-push\]\s*verify_jwt\s*=\s*false/);
    expect(config).toMatch(/\[functions\.delete-account\]\s*verify_jwt\s*=\s*true/);
    expect(config).toMatch(/\[functions\.approve-device\]\s*verify_jwt\s*=\s*true/);
    expect(config).toMatch(/\[functions\.issue-recovery-challenge\]\s*verify_jwt\s*=\s*true/);
    expect(config).toMatch(/\[functions\.verify-recovery\]\s*verify_jwt\s*=\s*true/);
  });
});
});
