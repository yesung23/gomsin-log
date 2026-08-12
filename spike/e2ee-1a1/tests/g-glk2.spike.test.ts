/**
 * PART G — GLK2 envelope feasibility and mutation resistance.
 *
 * Experimental evidence for Phase 1A-3 only. Nothing here touches application
 * data; every key is generated inside the test process.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hex, unhex, uuidBytes } from '../src/bytes.ts';
import { ENVELOPE_LENGTH, HEADER_LENGTH, OFFSETS, decodeHeader } from '../src/glk2.ts';
import { open, seal } from '../src/glk2Seal.ts';

const subtle = crypto.subtle;
const here = dirname(fileURLToPath(import.meta.url));
const vectorDir = join(here, '..', 'vectors', 'generated');
const vectorPath = join(vectorDir, 'glk2-vector.json');

/** Fixed TEST ONLY identifiers so the frozen vector is stable and readable. */
const IDS = {
  scopeKeyId: '11111111-1111-4111-8111-111111111111',
  ownerUserId: '22222222-2222-4222-8222-222222222222',
  scopeId: '33333333-3333-4333-8333-333333333333',
  senderDeviceId: '44444444-4444-4444-8444-444444444444',
  recipientId: '55555555-5555-4555-8555-555555555555',
};

const BASE_HEADER = {
  domain: 3, // couple
  recipientKind: 1, // device
  scopeKeyId: uuidBytes(IDS.scopeKeyId),
  ownerUserId: uuidBytes(IDS.ownerUserId),
  scopeId: uuidBytes(IDS.scopeId),
  epoch: 1n,
  senderDeviceId: uuidBytes(IDS.senderDeviceId),
  recipientId: uuidBytes(IDS.recipientId),
  createdAtMs: 1_770_000_000_000n,
};

type Fixture = {
  senderSigPrivate: CryptoKey;
  senderSigSpki: Uint8Array;
  otherSigSpki: Uint8Array;
  recipientKemPrivate: CryptoKey;
  recipientKemSpki: Uint8Array;
  otherKemPrivate: CryptoKey;
  otherKemSpki: Uint8Array;
  scopeKey: Uint8Array;
};

let fx: Fixture;

beforeAll(async () => {
  const senderSig = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const otherSig = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const recipientKem = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const otherKem = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

  fx = {
    senderSigPrivate: senderSig.privateKey,
    senderSigSpki: new Uint8Array(await subtle.exportKey('spki', senderSig.publicKey)),
    otherSigSpki: new Uint8Array(await subtle.exportKey('spki', otherSig.publicKey)),
    recipientKemPrivate: recipientKem.privateKey,
    recipientKemSpki: new Uint8Array(await subtle.exportKey('spki', recipientKem.publicKey)),
    otherKemPrivate: otherKem.privateKey,
    otherKemSpki: new Uint8Array(await subtle.exportKey('spki', otherKem.publicKey)),
    // TEST ONLY scope key: a fixed pattern, never a real key.
    scopeKey: new Uint8Array(32).map((_, i) => (i * 11 + 3) & 0xff),
  };
});

async function sealBase(overrides: Partial<typeof BASE_HEADER> = {}) {
  return seal({
    header: { ...BASE_HEADER, ...overrides },
    scopeKey: fx.scopeKey,
    senderSigPrivate: fx.senderSigPrivate,
    senderSigSpki: fx.senderSigSpki,
    recipientKemSpki: fx.recipientKemSpki,
  });
}

function openBase(envelope: Uint8Array, opts: { skipSignature?: boolean } = {}) {
  return open({
    envelope,
    recipientKemPrivate: fx.recipientKemPrivate,
    recipientKemSpki: fx.recipientKemSpki,
    senderSigSpki: fx.senderSigSpki,
    skipSignature: opts.skipSignature,
  });
}

describe('G1 structure', () => {
  it('is exactly 360 bytes with a 171-byte header', async () => {
    const envelope = await sealBase();
    expect(envelope.length).toBe(ENVELOPE_LENGTH);
    expect(ENVELOPE_LENGTH).toBe(HEADER_LENGTH + 65 + 12 + 48 + 64);
    expect(new TextDecoder().decode(envelope.slice(0, 4))).toBe('GLK2');
    expect(envelope[OFFSETS.envelopeVersion]).toBe(2);
    expect(envelope[HEADER_LENGTH]).toBe(0x04); // SEC1 uncompressed ephemeral point
  });

  it('round-trips the scope key and every header field', async () => {
    const envelope = await sealBase();
    const { scopeKey, header } = await openBase(envelope);
    expect(hex(scopeKey)).toBe(hex(fx.scopeKey));
    expect(header.domain).toBe(3);
    expect(header.epoch).toBe(1n);
    expect(header.createdAtMs).toBe(1_770_000_000_000n);
    expect(hex(header.scopeKeyId)).toBe(hex(uuidBytes(IDS.scopeKeyId)));
    expect(hex(header.ownerUserId)).toBe(hex(uuidBytes(IDS.ownerUserId)));
  });

  it('carries a 64-bit epoch beyond the Number-safe range', async () => {
    const big = 2n ** 53n + 1n;
    const envelope = await sealBase({ epoch: big });
    const { header } = await openBase(envelope);
    expect(header.epoch).toBe(big);
    expect(header.epoch).not.toBe(BigInt(Number(big)));
  });
});

describe('G2 every specified mutation fails verification', () => {
  const headerMutations: Array<[string, number]> = [
    ['domain', OFFSETS.domain],
    ['scope_key_id', OFFSETS.scopeKeyId],
    ['owner_user_id', OFFSETS.ownerUserId],
    ['scope_id', OFFSETS.scopeId],
    ['epoch', OFFSETS.epoch + 7],
    ['sender_sig_pub_fp', OFFSETS.senderSigPubFp],
    ['recipient_kem_pub_fp', OFFSETS.recipientKemPubFp],
    ['recipient_id', OFFSETS.recipientId],
    ['created_at_ms', OFFSETS.createdAtMs + 7],
  ];

  for (const [name, offset] of headerMutations) {
    it(`rejects a flipped bit in ${name}`, async () => {
      const envelope = await sealBase();
      envelope[offset] ^= 0x01;
      await expect(openBase(envelope)).rejects.toThrow();
    });

    it(`rejects a flipped bit in ${name} even with signature checking disabled`, async () => {
      // Defence in depth: the header is inside the AEAD associated data as well
      // as the signed message, so neither layer alone is load-bearing.
      const envelope = await sealBase();
      envelope[offset] ^= 0x01;
      await expect(openBase(envelope, { skipSignature: true })).rejects.toThrow();
    });
  }

  it('rejects a swapped ephemeral public key', async () => {
    const envelope = await sealBase();
    const other = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await subtle.exportKey('raw', other.publicKey));
    envelope.set(raw, HEADER_LENGTH);
    await expect(openBase(envelope)).rejects.toThrow(/E_BAD_SIGNATURE/);
    await expect(openBase(envelope, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects a flipped nonce', async () => {
    const envelope = await sealBase();
    envelope[HEADER_LENGTH + 65] ^= 0x01;
    await expect(openBase(envelope)).rejects.toThrow(/E_BAD_SIGNATURE/);
    await expect(openBase(envelope, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects flipped wrapped-key ciphertext and a flipped tag', async () => {
    const body = await sealBase();
    body[HEADER_LENGTH + 65 + 12] ^= 0x01;
    await expect(openBase(body)).rejects.toThrow(/E_BAD_SIGNATURE/);
    await expect(openBase(body, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);

    const tag = await sealBase();
    tag[HEADER_LENGTH + 65 + 12 + 47] ^= 0x01;
    await expect(openBase(tag, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects a flipped signature', async () => {
    const envelope = await sealBase();
    envelope[ENVELOPE_LENGTH - 1] ^= 0x01;
    await expect(openBase(envelope)).rejects.toThrow(/E_BAD_SIGNATURE/);
  });

  it('rejects a signature from a different sender key', async () => {
    const envelope = await sealBase();
    await expect(
      open({
        envelope,
        recipientKemPrivate: fx.recipientKemPrivate,
        recipientKemSpki: fx.recipientKemSpki,
        senderSigSpki: fx.otherSigSpki,
      }),
    ).rejects.toThrow(/E_SENDER_FP_MISMATCH/);
  });

  it('rejects an envelope addressed to a different recipient key', async () => {
    const envelope = await sealBase();
    await expect(
      open({
        envelope,
        recipientKemPrivate: fx.otherKemPrivate,
        recipientKemSpki: fx.otherKemSpki,
        senderSigSpki: fx.senderSigSpki,
      }),
    ).rejects.toThrow(/E_RECIPIENT_FP_MISMATCH/);
  });

  it('rejects non-zero reserved bytes, bad magic, bad version and bad length', async () => {
    const reserved = await sealBase();
    reserved[OFFSETS.reserved] = 0x01;
    await expect(openBase(reserved, { skipSignature: true })).rejects.toThrow(/E_RESERVED_NONZERO/);

    const magic = await sealBase();
    magic[0] = 0x47 ^ 0x01;
    await expect(openBase(magic, { skipSignature: true })).rejects.toThrow(/E_BAD_MAGIC/);

    const version = await sealBase();
    version[OFFSETS.envelopeVersion] = 3;
    await expect(openBase(version, { skipSignature: true })).rejects.toThrow(/E_BAD_VERSION/);

    const short = (await sealBase()).slice(0, ENVELOPE_LENGTH - 1);
    await expect(openBase(short)).rejects.toThrow(/E_ENVELOPE_LENGTH/);
  });

  it('rejects a compressed or malformed ephemeral point encoding', async () => {
    const envelope = await sealBase();
    envelope[HEADER_LENGTH] = 0x02; // compressed point prefix
    await expect(openBase(envelope, { skipSignature: true })).rejects.toThrow(/E_BAD_POINT_FORMAT/);
  });
});

describe('G3 cross-domain and cross-scope substitution', () => {
  it('an envelope for the health domain does not open as a couple envelope', async () => {
    const health = await sealBase({ domain: 2 });
    const couple = await sealBase({ domain: 3 });
    // Splice the health wrapped key into the couple header: the AAD differs, so
    // the ciphertext cannot be re-homed into another domain.
    const spliced = couple.slice();
    spliced.set(health.slice(HEADER_LENGTH, HEADER_LENGTH + 65 + 12 + 48), HEADER_LENGTH);
    await expect(openBase(spliced, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('an envelope for another scope_id does not open under this scope', async () => {
    const otherScope = await sealBase({ scopeId: uuidBytes('99999999-9999-4999-8999-999999999999') });
    const mine = await sealBase();
    const spliced = mine.slice();
    spliced.set(otherScope.slice(HEADER_LENGTH, HEADER_LENGTH + 65 + 12 + 48), HEADER_LENGTH);
    await expect(openBase(spliced, { skipSignature: true })).rejects.toThrow(/E_AEAD_FAILED/);
  });
});

describe('G4 frozen cross-platform vector', () => {
  it('produces or re-verifies the committed GLK2 vector', async () => {
    if (!existsSync(vectorPath)) {
      const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const fixedNonce = new Uint8Array(12).map((_, i) => (i * 17 + 5) & 0xff);
      const envelope = await seal({
        header: BASE_HEADER,
        scopeKey: fx.scopeKey,
        senderSigPrivate: fx.senderSigPrivate,
        senderSigSpki: fx.senderSigSpki,
        recipientKemSpki: fx.recipientKemSpki,
        fixed: {
          nonce: fixedNonce,
          ephemeralPkcs8: new Uint8Array(await subtle.exportKey('pkcs8', ephemeral.privateKey)),
          ephemeralPublicRaw: new Uint8Array(await subtle.exportKey('raw', ephemeral.publicKey)),
        },
      });

      mkdirSync(vectorDir, { recursive: true });
      writeFileSync(
        vectorPath,
        `${JSON.stringify(
          {
            _comment:
              'TEST ONLY throwaway keys. Experimental GLK2 vector for iOS/Android probes. Not production format approval.',
            specification: 'Architecture V2.1 section 7',
            envelopeLength: ENVELOPE_LENGTH,
            headerLength: HEADER_LENGTH,
            senderSigSpkiHex: hex(fx.senderSigSpki),
            recipientKemSpkiHex: hex(fx.recipientKemSpki),
            recipientKemPkcs8Hex: hex(
              new Uint8Array(await subtle.exportKey('pkcs8', fx.recipientKemPrivate)),
            ),
            expectedScopeKeyHex: hex(fx.scopeKey),
            envelopeHex: hex(envelope),
          },
          null,
          2,
        )}\n`,
      );
    }

    const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
    const envelope = unhex(vector.envelopeHex);
    expect(envelope.length).toBe(ENVELOPE_LENGTH);

    const kemPrivate = await subtle.importKey(
      'pkcs8',
      unhex(vector.recipientKemPkcs8Hex) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const { scopeKey, header } = await open({
      envelope,
      recipientKemPrivate: kemPrivate,
      recipientKemSpki: unhex(vector.recipientKemSpkiHex),
      senderSigSpki: unhex(vector.senderSigSpkiHex),
    });
    expect(hex(scopeKey)).toBe(vector.expectedScopeKeyHex);
    expect(header.epoch).toBe(1n);
    expect(decodeHeader(envelope.slice(0, HEADER_LENGTH)).domain).toBe(3);
  });
});
