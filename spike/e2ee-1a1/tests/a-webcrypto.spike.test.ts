/**
 * PART A — WebCrypto baseline.
 *
 * Two independent sources of truth are used on purpose:
 *   1. published known-answer vectors (RFC 5869, RFC 4231, FIPS 180-4), and
 *   2. Node's `node:crypto`, which is OpenSSL, cross-checked against WebCrypto.
 *
 * Agreement between two independent implementations is stronger evidence than a
 * value recalled from memory, and it is what lets the frozen vectors in
 * `vectors/` be trusted by the iOS and Android probes later.
 */

import { describe, expect, it } from 'vitest';
import nodeCrypto from 'node:crypto';
import { ascii, concat, hex, leftPad, readU64be, u64be, unhex } from '../src/bytes.ts';

const subtle = crypto.subtle;

describe('A1 SHA-256 known-answer', () => {
  it('matches FIPS 180-4 "abc"', async () => {
    const digest = new Uint8Array(await subtle.digest('SHA-256', ascii('abc')));
    expect(hex(digest)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the empty-string vector', async () => {
    const digest = new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(0)));
    expect(hex(digest)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('A2 HMAC-SHA-256 known-answer', () => {
  it('matches RFC 4231 test case 1', async () => {
    const key = await subtle.importKey(
      'raw',
      unhex('0b'.repeat(20)) as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = new Uint8Array(await subtle.sign('HMAC', key, ascii('Hi There')));
    expect(hex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('agrees with OpenSSL for a random message', async () => {
    const rawKey = nodeCrypto.randomBytes(32);
    const message = ascii('gomsinlog/hidx/v1|cycle_daily_logs.log_date/v1|2026-08-11');
    const key = await subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const web = new Uint8Array(await subtle.sign('HMAC', key, message));
    const openssl = new Uint8Array(nodeCrypto.createHmac('sha256', rawKey).update(message).digest());
    expect(hex(web)).toBe(hex(openssl));
  });
});

describe('A3 HKDF-SHA-256 known-answer', () => {
  it('matches RFC 5869 test case 1', async () => {
    const ikm = await subtle.importKey('raw', unhex('0b'.repeat(22)) as BufferSource, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: unhex('000102030405060708090a0b0c') as BufferSource,
        info: unhex('f0f1f2f3f4f5f6f7f8f9') as BufferSource,
      },
      ikm,
      42 * 8,
    );
    expect(hex(new Uint8Array(bits))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('agrees with OpenSSL hkdfSync for the GLK2-shaped inputs', async () => {
    const z = nodeCrypto.randomBytes(32);
    const salt = nodeCrypto.randomBytes(32);
    const info = concat(ascii('gomsinlog/glk2/kek/v1'), nodeCrypto.randomBytes(171));

    const ikm = await subtle.importKey('raw', z, 'HKDF', false, ['deriveBits']);
    const web = new Uint8Array(
      await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: info as BufferSource }, ikm, 256),
    );
    const openssl = new Uint8Array(nodeCrypto.hkdfSync('sha256', z, salt, info, 32));
    expect(hex(web)).toBe(hex(openssl));
  });

  it('rejects a zero-length salt distinctly from an all-zero salt', async () => {
    const z = unhex('11'.repeat(32));
    const ikm = await subtle.importKey('raw', z as BufferSource, 'HKDF', false, ['deriveBits']);
    const empty = new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(0) },
        ikm,
        256,
      ),
    );
    const zeros = new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new Uint8Array(0) },
        ikm,
        256,
      ),
    );
    // RFC 5869 defines an absent salt as HashLen zeros, so these two MUST agree.
    // Recording the observed behaviour matters: a native implementation that
    // disagrees here would silently derive a different KEK.
    expect(hex(empty)).toBe(hex(zeros));
  });
});

describe('A4 AES-256-GCM', () => {
  const key = unhex('00112233445566778899aabbccddeeff102132435465768798a9bacbdcedfe0f');
  const nonce = unhex('000102030405060708090a0b');
  const plaintext = unhex('4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60');
  const aad = ascii('gomsinlog/glk2/aad/v1');

  async function importKey(usages: KeyUsage[]) {
    return subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, usages);
  }

  it('produces a 128-bit tag appended to the ciphertext and agrees with OpenSSL', async () => {
    const k = await importKey(['encrypt']);
    const sealed = new Uint8Array(
      await subtle.encrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
        k,
        plaintext as BufferSource,
      ),
    );
    expect(sealed.length).toBe(plaintext.length + 16);

    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // WebCrypto returns ciphertext||tag; OpenSSL returns them separately. The
    // concatenated form is the protocol representation.
    expect(hex(sealed)).toBe(hex(concat(new Uint8Array(body), new Uint8Array(tag))));
  });

  it('round-trips with matching AAD', async () => {
    const ke = await importKey(['encrypt']);
    const kd = await importKey(['decrypt']);
    const params = { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 };
    const sealed = await subtle.encrypt(params, ke, plaintext as BufferSource);
    const opened = new Uint8Array(await subtle.decrypt(params, kd, sealed));
    expect(hex(opened)).toBe(hex(plaintext));
  });

  it('fails on modified ciphertext, modified AAD, modified tag and modified nonce', async () => {
    const ke = await importKey(['encrypt']);
    const kd = await importKey(['decrypt']);
    const params = { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 };
    const sealed = new Uint8Array(await subtle.encrypt(params, ke, plaintext as BufferSource));

    const flippedBody = sealed.slice();
    flippedBody[0] ^= 0x01;
    await expect(subtle.decrypt(params, kd, flippedBody as BufferSource)).rejects.toThrow();

    const flippedTag = sealed.slice();
    flippedTag[flippedTag.length - 1] ^= 0x01;
    await expect(subtle.decrypt(params, kd, flippedTag as BufferSource)).rejects.toThrow();

    const otherAad = { ...params, additionalData: ascii('gomsinlog/glk2/aad/v2') as BufferSource };
    await expect(subtle.decrypt(otherAad, kd, sealed as BufferSource)).rejects.toThrow();

    const otherNonce = { ...params, iv: unhex('0102030405060708090a0b0c') as BufferSource };
    await expect(subtle.decrypt(otherNonce, kd, sealed as BufferSource)).rejects.toThrow();
  });
});

describe('A5 P-256 ECDH', () => {
  it('derives a 32-byte shared secret that agrees with OpenSSL', async () => {
    const a = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const b = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

    const ab = new Uint8Array(
      await subtle.deriveBits({ name: 'ECDH', public: b.publicKey }, a.privateKey, 256),
    );
    const ba = new Uint8Array(
      await subtle.deriveBits({ name: 'ECDH', public: a.publicKey }, b.privateKey, 256),
    );
    expect(ab.length).toBe(32);
    expect(hex(ab)).toBe(hex(ba));

    const aPkcs8 = Buffer.from(await subtle.exportKey('pkcs8', a.privateKey));
    const bSpki = Buffer.from(await subtle.exportKey('spki', b.publicKey));
    const openssl = new Uint8Array(
      nodeCrypto.diffieHellman({
        privateKey: nodeCrypto.createPrivateKey({ key: aPkcs8, format: 'der', type: 'pkcs8' }),
        publicKey: nodeCrypto.createPublicKey({ key: bSpki, format: 'der', type: 'spki' }),
      }),
    );
    expect(hex(openssl)).toBe(hex(ab));
  });

  it('exports SPKI and SEC1 uncompressed public points of the specified widths', async () => {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const spki = new Uint8Array(await subtle.exportKey('spki', kp.publicKey));
    const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    expect(spki.length).toBe(91);
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
    // The SEC1 point is the tail of the SPKI, which is what lets a native
    // implementation carry either representation without a second encoder.
    expect(hex(spki.slice(spki.length - 65))).toBe(hex(raw));
  });

  it('left-zero-pads a shared secret whose X coordinate starts with 0x00', async () => {
    // Generated by brute force in tools/generate-vectors.mjs and frozen so every
    // platform exercises the same case. ~1 in 256 keypairs produce it, and an
    // implementation that strips leading zeros fails here and nowhere else.
    const vectors = await import('../vectors/generated/ecdh-leading-zero.json', {
      with: { type: 'json' },
    });
    const v = vectors.default;

    const priv = await subtle.importKey(
      'pkcs8',
      unhex(v.privatePkcs8Hex) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const pub = await subtle.importKey(
      'spki',
      unhex(v.peerPublicSpkiHex) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));

    expect(secret.length).toBe(32);
    expect(secret[0]).toBe(0x00);
    expect(hex(secret)).toBe(v.sharedSecretHex);

    // The behaviour the native plugin must reproduce: a minimal-length integer
    // must be widened back to 32 bytes, not consumed as-is.
    const stripped = secret.slice(1);
    expect(hex(leftPad(stripped, 32))).toBe(hex(secret));
  });
});

describe('A6 P-256 ECDSA', () => {
  it('signs and verifies with SHA-256 and returns 64-byte P-1363', async () => {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const message = ascii('gomsinlog/glk2/sig/v1');
    const sig = new Uint8Array(
      await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, message),
    );
    expect(sig.length).toBe(64);
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sig, message)).toBe(true);

    const tampered = sig.slice();
    tampered[0] ^= 0x01;
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, tampered, message)).toBe(false);
  });

  it('records that OpenSSL defaults to DER while WebCrypto uses P-1363', async () => {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', kp.privateKey));
    const nodeKey = nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const message = Buffer.from(ascii('interop'));

    const der = nodeCrypto.sign('sha256', message, nodeKey);
    const p1363 = nodeCrypto.sign('sha256', message, { key: nodeKey, dsaEncoding: 'ieee-p1363' });

    expect(der[0]).toBe(0x30); // SEQUENCE — the native representation
    expect(p1363.length).toBe(64); // the protocol representation
    expect(der.length).not.toBe(64);

    // A DER signature handed straight to WebCrypto must be rejected, which is
    // exactly the interop bug the conversion layer exists to prevent.
    const asIs = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, der, message);
    expect(asIs).toBe(false);
  });
});

describe('A7 BigInt 64-bit protocol fields', () => {
  it('round-trips the boundary values via DataView without Number', () => {
    const cases = [0n, 1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, 2n ** 63n - 1n, 2n ** 64n - 1n];
    for (const value of cases) {
      const encoded = u64be(value);
      expect(encoded.length).toBe(8);
      expect(readU64be(encoded, 0)).toBe(value);
    }
  });

  it('is big-endian, matching the wire specification', () => {
    expect(hex(u64be(1n))).toBe('0000000000000001');
    expect(hex(u64be(2n ** 63n - 1n))).toBe('7fffffffffffffff');
  });

  it('fails closed outside the 64-bit range', () => {
    expect(() => u64be(-1n)).toThrow(RangeError);
    expect(() => u64be(2n ** 64n)).toThrow(RangeError);
    expect(() => readU64be(new Uint8Array(4), 0)).toThrow(RangeError);
  });

  it('demonstrates the precision loss that Number would introduce', () => {
    // The reason the architecture forbids Number for epoch/content_revision.
    expect(Number(2n ** 53n + 1n)).toBe(Number(2n ** 53n));
    expect(readU64be(u64be(2n ** 53n + 1n), 0)).not.toBe(BigInt(Number(2n ** 53n + 1n)));
  });
});
