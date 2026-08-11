/**
 * PART B — strict DER <-> P-1363 ECDSA conversion.
 *
 * Real OpenSSL DER signatures are the positive corpus, because a hand-written
 * DER blob proves nothing about what Apple and Android actually emit. The
 * adversarial corpus is built by mutating those real signatures.
 */

import { describe, expect, it } from 'vitest';
import nodeCrypto from 'node:crypto';
import { concat, hex, unhex } from '../src/bytes.ts';
import { P256_ORDER, SignatureFormatError, decodeP1363, derToP1363, p1363ToDer } from '../src/ecdsaFormat.ts';

const subtle = crypto.subtle;

/** TEST ONLY keypair, generated per run. */
async function testSigner() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', kp.privateKey));
  return {
    webPublic: kp.publicKey,
    nodePrivate: nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }),
  };
}

/**
 * Collect real OpenSSL signatures until every DER integer-width case appears.
 *
 * ECDSA is randomised, so a signature must be produced ONCE and then converted.
 * Signing the same message twice yields two unrelated valid signatures, which
 * is why nothing here compares bytes across two separate `sign` calls.
 */
async function corpus() {
  const signer = await testSigner();
  const found = new Map<string, { der: Uint8Array; message: Uint8Array }>();

  for (let i = 0; i < 4000 && found.size < 4; i += 1) {
    const message = Buffer.from(`gomsinlog/1a1/ecdsa-corpus/${i}`);
    const der = new Uint8Array(nodeCrypto.sign('sha256', message, signer.nodePrivate));
    const p1363 = derToP1363(der);
    // Classify by whether each half needed a 0x00 pad (high bit set) or was short.
    const rHigh = (p1363[0] & 0x80) !== 0;
    const sHigh = (p1363[32] & 0x80) !== 0;
    const rShort = p1363[0] === 0x00;
    const key = `${rHigh ? 'rpad' : rShort ? 'rshort' : 'rplain'}|${sHigh ? 'spad' : 'splain'}`;
    if (!found.has(key)) found.set(key, { der, message: new Uint8Array(message) });
  }
  return { signer, samples: [...found.entries()] };
}

describe('B1 real OpenSSL DER converts to P-1363 that WebCrypto accepts', () => {
  it('converts every observed integer-width case into a signature WebCrypto verifies', async () => {
    const { signer, samples } = await corpus();
    expect(samples.length).toBeGreaterThanOrEqual(3);

    for (const [label, { der, message }] of samples) {
      const converted = derToP1363(der);

      // The only assertion that proves byte order and padding are right: the
      // converted signature must verify under an independent implementation.
      const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signer.webPublic, converted, message);
      expect(ok, `WebCrypto rejected converted signature for ${label}`).toBe(true);

      // ...and back, byte-identical to what OpenSSL produced.
      expect(hex(p1363ToDer(converted)), `P1363->DER mismatch for ${label}`).toBe(hex(der));
    }
  });

  it('converts WebCrypto P-1363 into DER that OpenSSL verifies', async () => {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = Buffer.from(await subtle.exportKey('spki', kp.publicKey));
    const nodePublic = nodeCrypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    for (let i = 0; i < 100; i += 1) {
      const message = Buffer.from(`web-to-openssl/${i}`);
      const p1363 = new Uint8Array(
        await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, message),
      );
      const der = p1363ToDer(p1363);
      expect(nodeCrypto.verify('sha256', message, nodePublic, der), `OpenSSL rejected DER at ${i}`).toBe(true);
    }
  });

  it('DER -> P1363 -> DER is a fixed point over many real signatures', async () => {
    const signer = await testSigner();
    for (let i = 0; i < 300; i += 1) {
      const message = Buffer.from(`fixed-point/${i}`);
      const der = new Uint8Array(nodeCrypto.sign('sha256', message, signer.nodePrivate));
      expect(hex(p1363ToDer(derToP1363(der)))).toBe(hex(der));
    }
  });

  it('P1363 -> DER -> P1363 is a fixed point over many real signatures', async () => {
    const signer = await testSigner();
    for (let i = 0; i < 300; i += 1) {
      const message = Buffer.from(`fixed-point-b/${i}`);
      const p1363 = new Uint8Array(
        nodeCrypto.sign('sha256', message, { key: signer.nodePrivate, dsaEncoding: 'ieee-p1363' }),
      );
      expect(hex(derToP1363(p1363ToDer(p1363)))).toBe(hex(p1363));
    }
  });
});

describe('B2 DER decoder rejects every malformed encoding', () => {
  function scalarDer(rHex: string, sHex: string): Uint8Array {
    const int = (bytes: Uint8Array) => concat(new Uint8Array([0x02, bytes.length]), bytes);
    const body = concat(int(unhex(rHex)), int(unhex(sHex)));
    return concat(new Uint8Array([0x30, body.length]), body);
  }
  const validR = '11'.repeat(32);
  const validS = '22'.repeat(32);

  const cases: Array<[string, () => Uint8Array, string]> = [
    ['wrong SEQUENCE tag', () => { const d = scalarDer(validR, validS); d[0] = 0x31; return d; }, 'E_BAD_SEQ_TAG'],
    ['wrong INTEGER tag', () => { const d = scalarDer(validR, validS); d[2] = 0x04; return d; }, 'E_BAD_INT_TAG'],
    ['trailing bytes', () => concat(scalarDer(validR, validS), new Uint8Array([0x00])), 'E_TRAILING_BYTES'],
    ['truncated body', () => scalarDer(validR, validS).slice(0, 10), 'E_TRAILING_BYTES'],
    ['long-form SEQUENCE length', () => { const d = scalarDer(validR, validS); d[1] = 0x81; return d; }, 'E_LONG_FORM_LENGTH'],
    ['long-form INTEGER length', () => { const d = scalarDer(validR, validS); d[3] = 0x81; return d; }, 'E_LONG_FORM_LENGTH'],
    ['negative INTEGER', () => scalarDer(`80${'11'.repeat(31)}`, validS), 'E_NEGATIVE_INT'],
    ['redundant leading zero', () => scalarDer(`00${'11'.repeat(31)}`, validS), 'E_REDUNDANT_LEADING_ZERO'],
    ['two leading zeros', () => scalarDer(`0000${'11'.repeat(30)}`, validS), 'E_REDUNDANT_LEADING_ZERO'],
    ['zero-length INTEGER', () => scalarDer('', validS), 'E_EMPTY_INT'],
    ['INTEGER longer than 33 bytes', () => scalarDer('11'.repeat(34), validS), 'E_INT_TOO_LONG'],
    ['r = 0', () => scalarDer('00', validS), 'E_ZERO_SCALAR'],
    ['s = 0', () => scalarDer(validR, '00'), 'E_ZERO_SCALAR'],
    [
      'r >= curve order',
      () => scalarDer(`00${P256_ORDER.toString(16)}`, validS),
      'E_SCALAR_GE_ORDER',
    ],
    [
      's >= curve order',
      () => scalarDer(validR, `00${(P256_ORDER + 1n).toString(16)}`),
      'E_SCALAR_GE_ORDER',
    ],
    ['too short to be a signature', () => new Uint8Array([0x30, 0x02, 0x02, 0x00]), 'E_TRUNCATED'],
  ];

  for (const [name, build, code] of cases) {
    it(`rejects ${name}`, () => {
      let thrown: unknown;
      try {
        derToP1363(build());
      } catch (error) {
        thrown = error;
      }
      expect(thrown, `${name} was accepted`).toBeInstanceOf(SignatureFormatError);
      expect((thrown as SignatureFormatError).code).toBe(code);
    });
  }
});

describe('B3 P-1363 decoder rejects every malformed encoding', () => {
  const valid = concat(unhex('11'.repeat(32)), unhex('22'.repeat(32)));

  it('rejects a wrong length', () => {
    expect(() => decodeP1363(valid.slice(0, 63))).toThrow(/E_BAD_P1363_LENGTH/);
    expect(() => decodeP1363(concat(valid, new Uint8Array([0])))).toThrow(/E_BAD_P1363_LENGTH/);
    expect(() => decodeP1363(new Uint8Array(0))).toThrow(/E_BAD_P1363_LENGTH/);
  });

  it('rejects r = 0 and s = 0', () => {
    expect(() => decodeP1363(concat(new Uint8Array(32), unhex('22'.repeat(32))))).toThrow(/E_ZERO_SCALAR/);
    expect(() => decodeP1363(concat(unhex('11'.repeat(32)), new Uint8Array(32)))).toThrow(/E_ZERO_SCALAR/);
  });

  it('rejects scalars at or above the curve order', () => {
    const order = unhex(P256_ORDER.toString(16));
    expect(() => decodeP1363(concat(order, unhex('22'.repeat(32))))).toThrow(/E_SCALAR_GE_ORDER/);
    expect(() => decodeP1363(concat(unhex('11'.repeat(32)), order))).toThrow(/E_SCALAR_GE_ORDER/);
    const justBelow = unhex((P256_ORDER - 1n).toString(16));
    expect(() => decodeP1363(concat(justBelow, justBelow))).not.toThrow();
  });

  it('accepts a P-1363 half with a leading zero byte', () => {
    const shortR = concat(new Uint8Array([0x00]), unhex('11'.repeat(31)));
    expect(() => decodeP1363(concat(shortR, unhex('22'.repeat(32))))).not.toThrow();
    // ...and re-encoding drops the pad, as DER minimality requires.
    const der = p1363ToDer(concat(shortR, unhex('22'.repeat(32))));
    expect(der[3]).toBe(31);
  });
});
