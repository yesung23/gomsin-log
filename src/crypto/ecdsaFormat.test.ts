/**
 * DER <-> P-1363 conversion.
 *
 * Real signatures are the positive corpus. Phase 1A-1 measured that Apple's
 * Security.framework and JCA both emit DER while WebCrypto emits and accepts
 * only P-1363, and that WebCrypto *silently returns false* for an unconverted
 * DER signature rather than throwing — a failure that reads as "bad signature"
 * and sends you looking in the wrong place.
 */

import { describe, expect, it } from 'vitest';
import {
  P1363_LENGTH,
  P256_ORDER,
  SignatureFormatError,
  decodeP1363,
  derToP1363,
  p1363ToDer,
  toP1363,
} from './ecdsaFormat';
import { concat, hex, unhex } from './bytes';
import { ecdsaVerify } from './suite';

async function signer() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { pair, spki };
}

describe('round-trips over real signatures', () => {
  it('P1363 -> DER -> P1363 is a fixed point, and the result still verifies', async () => {
    const { pair, spki } = await signer();
    for (let i = 0; i < 200; i += 1) {
      const message = new TextEncoder().encode(`fixed-point/${i}`);
      const p1363 = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, message),
      );
      const der = p1363ToDer(p1363);
      expect(der[0]).toBe(0x30);
      expect(hex(derToP1363(der))).toBe(hex(p1363));
      expect(await ecdsaVerify(spki, message, derToP1363(der))).toBe(true);
    }
  });

  it('covers the short and high-bit integer cases produced naturally', async () => {
    const { pair } = await signer();
    const seen = new Set<string>();
    for (let i = 0; i < 600 && seen.size < 3; i += 1) {
      const message = new TextEncoder().encode(`widths/${i}`);
      const p1363 = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, message),
      );
      const rHigh = (p1363[0] & 0x80) !== 0;
      const rShort = p1363[0] === 0x00;
      seen.add(rHigh ? 'pad' : rShort ? 'short' : 'plain');
      expect(hex(derToP1363(p1363ToDer(p1363)))).toBe(hex(p1363));
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('toP1363 accepts either representation', async () => {
    const { pair } = await signer();
    const message = new TextEncoder().encode('either');
    const p1363 = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, message),
    );
    expect(hex(toP1363(p1363))).toBe(hex(p1363));
    expect(hex(toP1363(p1363ToDer(p1363)))).toBe(hex(p1363));
  });
});

describe('DER decoder rejects malformed encodings', () => {
  function der(rHex: string, sHex: string): Uint8Array {
    const int = (bytes: Uint8Array) => concat(new Uint8Array([0x02, bytes.length]), bytes);
    const body = concat(int(unhex(rHex)), int(unhex(sHex)));
    return concat(new Uint8Array([0x30, body.length]), body);
  }
  const R = '11'.repeat(32);
  const S = '22'.repeat(32);

  const cases: Array<[string, () => Uint8Array, string]> = [
    ['wrong SEQUENCE tag', () => { const d = der(R, S); d[0] = 0x31; return d; }, 'E_BAD_SEQ_TAG'],
    ['wrong INTEGER tag', () => { const d = der(R, S); d[2] = 0x04; return d; }, 'E_BAD_INT_TAG'],
    ['trailing bytes', () => concat(der(R, S), new Uint8Array([0])), 'E_TRAILING_BYTES'],
    ['truncated', () => der(R, S).slice(0, 10), 'E_TRAILING_BYTES'],
    ['long-form SEQUENCE length', () => { const d = der(R, S); d[1] = 0x81; return d; }, 'E_LONG_FORM_LENGTH'],
    ['long-form INTEGER length', () => { const d = der(R, S); d[3] = 0x81; return d; }, 'E_LONG_FORM_LENGTH'],
    ['negative INTEGER', () => der(`80${'11'.repeat(31)}`, S), 'E_NEGATIVE_INT'],
    ['redundant leading zero', () => der(`00${'11'.repeat(31)}`, S), 'E_REDUNDANT_LEADING_ZERO'],
    ['two leading zeros', () => der(`0000${'11'.repeat(30)}`, S), 'E_REDUNDANT_LEADING_ZERO'],
    ['zero-length INTEGER', () => der('', S), 'E_EMPTY_INT'],
    ['INTEGER longer than 33 bytes', () => der('11'.repeat(34), S), 'E_INT_TOO_LONG'],
    ['r = 0', () => der('00', S), 'E_ZERO_SCALAR'],
    ['s = 0', () => der(R, '00'), 'E_ZERO_SCALAR'],
    ['r >= order', () => der(`00${P256_ORDER.toString(16)}`, S), 'E_SCALAR_GE_ORDER'],
    ['s >= order', () => der(R, `00${(P256_ORDER + 1n).toString(16)}`), 'E_SCALAR_GE_ORDER'],
    ['too short overall', () => new Uint8Array([0x30, 0x02, 0x02, 0x00]), 'E_TRUNCATED'],
  ];

  for (const [name, build, code] of cases) {
    it(`rejects ${name}`, () => {
      let thrown: unknown;
      try { derToP1363(build()); } catch (error) { thrown = error; }
      expect(thrown, `${name} was accepted`).toBeInstanceOf(SignatureFormatError);
      expect((thrown as SignatureFormatError).code).toBe(code);
    });
  }
});

describe('P-1363 decoder', () => {
  const valid = concat(unhex('11'.repeat(32)), unhex('22'.repeat(32)));

  it('rejects a wrong length', () => {
    expect(() => decodeP1363(valid.slice(0, 63))).toThrow(/E_BAD_P1363_LENGTH/);
    expect(() => decodeP1363(concat(valid, new Uint8Array([0])))).toThrow(/E_BAD_P1363_LENGTH/);
    expect(P1363_LENGTH).toBe(64);
  });

  it('rejects zero and out-of-range scalars', () => {
    expect(() => decodeP1363(concat(new Uint8Array(32), unhex('22'.repeat(32))))).toThrow(/E_ZERO_SCALAR/);
    expect(() => decodeP1363(concat(unhex('11'.repeat(32)), new Uint8Array(32)))).toThrow(/E_ZERO_SCALAR/);
    const order = unhex(P256_ORDER.toString(16));
    expect(() => decodeP1363(concat(order, unhex('22'.repeat(32))))).toThrow(/E_SCALAR_GE_ORDER/);
    const justBelow = unhex((P256_ORDER - 1n).toString(16));
    expect(() => decodeP1363(concat(justBelow, justBelow))).not.toThrow();
  });

  it('accepts a half with a leading zero and re-encodes it minimally', () => {
    const shortR = concat(new Uint8Array([0x00]), unhex('11'.repeat(31)));
    const signature = concat(shortR, unhex('22'.repeat(32)));
    expect(() => decodeP1363(signature)).not.toThrow();
    expect(p1363ToDer(signature)[3]).toBe(31);
  });
});
