/**
 * GLK2 envelope: structure, round-trip, and every authenticated field mutated
 * individually.
 *
 * The mutation tests are run twice — once through the full `openEnvelope`, and
 * once with the signature check bypassed — because the header is bound into
 * both the signed message and the AEAD associated data, and a regression that
 * silently dropped one binding would still pass a signature-only test.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { concat, hex, uuidToBytes } from './bytes';
import { KEY_DOMAIN, RECIPIENT_KIND } from './domains';
import {
  ENVELOPE_LENGTH,
  HEADER_LENGTH,
  OFFSET,
  decodeHeader,
  envelopeAad,
  openEnvelope,
  signedMessage,
  splitEnvelope,
} from './glk2';
import {
  AES_KEY_BYTES,
  aesGcmOpen,
  ecdsaVerify,
  hkdfSha256,
  importAesKey,
  generateEphemeralAgreement,
  sec1ToSpki,
} from './suite';
import { kekSalt, kekInfo } from './glk2';
import {
  createTestAccount,
  deriveWith,
  sealScopeKeyFrom,
  type TestAccount,
  type TestDevice,
} from './testing/virtualAccount';

const HEADER = {
  scopeKeyId: uuidToBytes('11111111-1111-4111-8111-111111111111'),
  ownerUserId: uuidToBytes('22222222-2222-4222-8222-222222222222'),
  scopeId: uuidToBytes('33333333-3333-4333-8333-333333333333'),
  epoch: 1n,
};

let account: TestAccount;
let sender: TestDevice;
let recipient: TestDevice;
let scopeKey: Uint8Array;

beforeAll(async () => {
  account = await createTestAccount();
  sender = account.devices[0];
  const { addEnrolledDevice } = await import('./testing/virtualAccount');
  recipient = await addEnrolledDevice(account, sender, { grantedDomains: ['personal', 'couple'] });
  scopeKey = new Uint8Array(AES_KEY_BYTES).map((_, i) => (i * 11 + 3) & 0xff);
});

async function seal(overrides: Partial<typeof HEADER> & { domain?: number } = {}) {
  return sealScopeKeyFrom(
    sender,
    { id: recipient.deviceId, kemSpki: recipient.kem.spki, kind: RECIPIENT_KIND.device },
    scopeKey,
    {
      domain: (overrides.domain ?? KEY_DOMAIN.couple) as 1 | 2 | 3,
      scopeKeyId: overrides.scopeKeyId ?? HEADER.scopeKeyId,
      ownerUserId: overrides.ownerUserId ?? HEADER.ownerUserId,
      scopeId: overrides.scopeId ?? HEADER.scopeId,
      epoch: overrides.epoch ?? HEADER.epoch,
    },
  );
}

function open(envelope: Uint8Array) {
  return openEnvelope({
    envelope,
    recipientKemSpki: recipient.kem.spki,
    senderSigSpki: sender.sig.spki,
    deriveSecret: (peer) => deriveWith(recipient.kem, peer),
  });
}

/** Bypasses the signature to prove the AEAD binding stands on its own. */
async function openWithoutSignature(envelope: Uint8Array) {
  const parts = splitEnvelope(envelope);
  const shared = await deriveWith(recipient.kem, sec1ToSpki(parts.ephemeralPub));
  const salt = await kekSalt(parts.ephemeralPub, recipient.kem.spki);
  const bits = await hkdfSha256(shared, salt, kekInfo(parts.header), AES_KEY_BYTES);
  const kek = await importAesKey(bits, ['decrypt']);
  return aesGcmOpen(kek, parts.nonce, parts.wrappedKey, envelopeAad(parts.header, parts.ephemeralPub));
}

describe('GLK2 structure', () => {
  it('is exactly 360 bytes with a 171-byte header', async () => {
    const envelope = await seal();
    expect(envelope.length).toBe(ENVELOPE_LENGTH);
    expect(ENVELOPE_LENGTH).toBe(HEADER_LENGTH + 65 + 12 + 48 + 64);
    expect(new TextDecoder().decode(envelope.slice(0, 4))).toBe('GLK2');
    expect(envelope[HEADER_LENGTH]).toBe(0x04);
  });

  it('round-trips the scope key and header fields', async () => {
    const { scopeKey: opened, header } = await open(await seal());
    expect(hex(opened)).toBe(hex(scopeKey));
    expect(header.domain).toBe(KEY_DOMAIN.couple);
    expect(header.epoch).toBe(1n);
    expect(hex(header.scopeKeyId)).toBe(hex(HEADER.scopeKeyId));
  });

  it('carries a 64-bit epoch beyond the Number-safe range', async () => {
    const big = 2n ** 53n + 1n;
    const { header } = await open(await seal({ epoch: big }));
    expect(header.epoch).toBe(big);
    expect(header.epoch).not.toBe(BigInt(Number(big)));
  });
});

describe('GLK2 authenticated-field mutations', () => {
  const mutations: Array<[string, number]> = [
    ['domain', OFFSET.domain],
    ['recipientKind', OFFSET.recipientKind],
    ['scopeKeyId', OFFSET.scopeKeyId],
    ['ownerUserId', OFFSET.ownerUserId],
    ['scopeId', OFFSET.scopeId],
    ['epoch', OFFSET.epoch + 7],
    ['senderDeviceId', OFFSET.senderDeviceId],
    ['senderSigPubFp', OFFSET.senderSigPubFp],
    ['recipientId', OFFSET.recipientId],
    ['recipientKemPubFp', OFFSET.recipientKemPubFp],
    ['createdAtMs', OFFSET.createdAtMs + 7],
  ];

  for (const [name, offset] of mutations) {
    it(`rejects a flipped bit in ${name}`, async () => {
      const envelope = await seal();
      envelope[offset] ^= 0x01;
      await expect(open(envelope)).rejects.toThrow();
    });

    it(`rejects a flipped bit in ${name} with signature checking bypassed`, async () => {
      const envelope = await seal();
      envelope[offset] ^= 0x01;
      await expect(openWithoutSignature(envelope)).rejects.toThrow(/E_AEAD_FAILED/);
    });
  }

  it('rejects a swapped ephemeral public key', async () => {
    const envelope = await seal();
    const other = await generateEphemeralAgreement(recipient.kem.spki);
    envelope.set(other.publicKeySec1, HEADER_LENGTH);
    await expect(open(envelope)).rejects.toThrow(/E_BAD_SIGNATURE/);
    await expect(openWithoutSignature(envelope)).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects a flipped nonce, ciphertext, tag and signature', async () => {
    const nonce = await seal();
    nonce[HEADER_LENGTH + 65] ^= 0x01;
    await expect(open(nonce)).rejects.toThrow(/E_BAD_SIGNATURE/);
    await expect(openWithoutSignature(nonce)).rejects.toThrow(/E_AEAD_FAILED/);

    const body = await seal();
    body[HEADER_LENGTH + 65 + 12] ^= 0x01;
    await expect(openWithoutSignature(body)).rejects.toThrow(/E_AEAD_FAILED/);

    const tag = await seal();
    tag[HEADER_LENGTH + 65 + 12 + 47] ^= 0x01;
    await expect(openWithoutSignature(tag)).rejects.toThrow(/E_AEAD_FAILED/);

    const signature = await seal();
    signature[ENVELOPE_LENGTH - 1] ^= 0x01;
    await expect(open(signature)).rejects.toThrow(/E_BAD_SIGNATURE/);
  });

  it('rejects structural corruption', async () => {
    const reserved = await seal();
    reserved[OFFSET.reserved] = 1;
    await expect(open(reserved)).rejects.toThrow(/E_RESERVED_NONZERO/);

    const magic = await seal();
    magic[0] ^= 0x01;
    await expect(open(magic)).rejects.toThrow(/E_BAD_MAGIC/);

    const version = await seal();
    version[OFFSET.envelopeVersion] = 3;
    await expect(open(version)).rejects.toThrow(/E_BAD_VERSION/);

    const protocolId = await seal();
    protocolId[OFFSET.protocolId] = 9;
    await expect(open(protocolId)).rejects.toThrow(/E_BAD_PROTOCOL/);

    const suite = await seal();
    suite[OFFSET.suiteId] = 9;
    await expect(open(suite)).rejects.toThrow(/E_BAD_SUITE/);

    const short = (await seal()).slice(0, ENVELOPE_LENGTH - 1);
    await expect(open(short)).rejects.toThrow(/E_ENVELOPE_LENGTH/);

    const long = concat(await seal(), new Uint8Array([0]));
    await expect(open(long)).rejects.toThrow(/E_ENVELOPE_LENGTH/);

    const point = await seal();
    point[HEADER_LENGTH] = 0x02;
    await expect(open(point)).rejects.toThrow(/E_BAD_POINT_FORMAT/);

    const domain = await seal();
    domain[OFFSET.domain] = 9;
    await expect(open(domain)).rejects.toThrow(/E_BAD_DOMAIN/);
  });
});

describe('GLK2 cross-context substitution', () => {
  it('cannot re-home a health envelope into a couple header', async () => {
    const health = await seal({ domain: KEY_DOMAIN.health });
    const couple = await seal({ domain: KEY_DOMAIN.couple });
    const spliced = couple.slice();
    spliced.set(health.slice(HEADER_LENGTH, HEADER_LENGTH + 65 + 12 + 48), HEADER_LENGTH);
    await expect(openWithoutSignature(spliced)).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('cannot re-home an envelope from another scope', async () => {
    const other = await seal({ scopeId: uuidToBytes('99999999-9999-4999-8999-999999999999') });
    const mine = await seal();
    const spliced = mine.slice();
    spliced.set(other.slice(HEADER_LENGTH, HEADER_LENGTH + 65 + 12 + 48), HEADER_LENGTH);
    await expect(openWithoutSignature(spliced)).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('cannot re-home an envelope from another epoch', async () => {
    const other = await seal({ epoch: 2n });
    const mine = await seal();
    const spliced = mine.slice();
    spliced.set(other.slice(HEADER_LENGTH, HEADER_LENGTH + 65 + 12 + 48), HEADER_LENGTH);
    await expect(openWithoutSignature(spliced)).rejects.toThrow(/E_AEAD_FAILED/);
  });
});

describe('GLK2 wrong-key rejection', () => {
  it('rejects an envelope addressed to a different agreement key', async () => {
    const envelope = await seal();
    await expect(
      openEnvelope({
        envelope,
        recipientKemSpki: sender.kem.spki,
        senderSigSpki: sender.sig.spki,
        deriveSecret: (peer) => deriveWith(sender.kem, peer),
      }),
    ).rejects.toThrow(/E_RECIPIENT_FP_MISMATCH/);
  });

  it('rejects a mismatched sender signing key', async () => {
    const envelope = await seal();
    await expect(
      openEnvelope({
        envelope,
        recipientKemSpki: recipient.kem.spki,
        senderSigSpki: recipient.sig.spki,
        deriveSecret: (peer) => deriveWith(recipient.kem, peer),
      }),
    ).rejects.toThrow(/E_SENDER_FP_MISMATCH/);
  });

  it('signs over the exact specified message', async () => {
    const envelope = await seal();
    const parts = splitEnvelope(envelope);
    const message = signedMessage(parts.header, parts.ephemeralPub, parts.nonce, parts.wrappedKey);
    expect(await ecdsaVerify(sender.sig.spki, message, parts.signature)).toBe(true);
    // ...and not over the header alone, which would leave the body unbound.
    expect(await ecdsaVerify(sender.sig.spki, parts.header, parts.signature)).toBe(false);
  });

  it('decodes the header it encoded', async () => {
    const envelope = await seal();
    const header = decodeHeader(envelope.slice(0, HEADER_LENGTH));
    expect(header.recipientKind).toBe(RECIPIENT_KIND.device);
    expect(hex(header.recipientId)).toBe(hex(recipient.deviceId));
    expect(hex(header.senderDeviceId)).toBe(hex(sender.deviceId));
  });
});
