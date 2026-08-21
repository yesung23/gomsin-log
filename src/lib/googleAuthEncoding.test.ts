import { describe, expect, it } from 'vitest';
import {
  base64url,
  base64urlText,
  buildClaim,
  pemToDer,
} from '../../supabase/functions/send-push/googleAuth.ts';

/**
 * The encoding half of the FCM OAuth exchange.
 *
 * The exchange itself is not tested here and cannot usefully be: it needs a real
 * service account, and a fake one proves nothing about whether Google accepts the
 * signature. What IS testable is every place this could be silently wrong in a way
 * that surfaces as "auth failed" with no further detail -- which is exactly the
 * failure mode that costs a day.
 */

describe('base64url', () => {
  it('substitutes the two characters that mean something else in a URL', () => {
    // 0xFB 0xFF encodes to `+/8=` in standard base64. Both substitutions and the
    // padding strip are exercised by this one vector.
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('drops padding, which JWT does not use', () => {
    expect(base64urlText('a')).not.toContain('=');
    expect(base64urlText('ab')).not.toContain('=');
    expect(base64urlText('abc')).not.toContain('=');
  });

  it('round-trips through the standard decoder', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 254]);
    const restored = atob(
      base64url(bytes).replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - (base64url(bytes).length % 4)) % 4),
    );
    expect([...restored].map((c) => c.charCodeAt(0))).toEqual([...bytes]);
  });

  it('handles a signature-sized input without spreading it into an argument list', () => {
    // The reason this is a loop and not `String.fromCharCode(...bytes)`. 256 bytes
    // is fine either way; a 4096-bit key's 512 would still be, and the pattern is
    // what eventually is not.
    const large = new Uint8Array(512).fill(0x41);
    expect(() => base64url(large)).not.toThrow();
    expect(base64url(large).length).toBeGreaterThan(600);
  });
});

describe('pemToDer', () => {
  const DER = new Uint8Array([0x30, 0x82, 0x01, 0x00]);
  const BODY = btoa(String.fromCharCode(...DER));

  it('strips the armour and the newlines', () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`;
    expect([...pemToDer(pem)]).toEqual([...DER]);
  });

  it('handles the escaped newlines a JSON round trip leaves behind', () => {
    /*
      The case this function exists for. A service account read out of an env var
      arrives with literal backslash-n rather than real newlines, and stripping
      only real whitespace leaves those two characters inside the base64 -- so the
      key import fails with an error that says nothing about newlines.
    */
    const pem = `-----BEGIN PRIVATE KEY-----\\n${BODY}\\n-----END PRIVATE KEY-----\\n`;
    expect([...pemToDer(pem)]).toEqual([...DER]);
  });

  it('accepts a body already stripped of armour', () => {
    expect([...pemToDer(BODY)]).toEqual([...DER]);
  });
});

describe('buildClaim', () => {
  const account = { client_email: 'push@example.iam.gserviceaccount.com', private_key: 'x' };

  it('asks for exactly one hour, which is the maximum Google grants', () => {
    // Asking for more is rejected outright rather than clamped.
    const claim = buildClaim(account, 1_000);
    expect(claim.exp - claim.iat).toBe(3600);
  });

  it('scopes the assertion to messaging alone', () => {
    expect(buildClaim(account, 0).scope).toBe(
      'https://www.googleapis.com/auth/firebase.messaging',
    );
  });

  it('addresses the token endpoint, not the messaging one', () => {
    // `aud` is the endpoint the assertion is presented TO. Pointing it at FCM is
    // a mistake that reads correct and is refused every time.
    expect(buildClaim(account, 0).aud).toBe('https://oauth2.googleapis.com/token');
  });
});
