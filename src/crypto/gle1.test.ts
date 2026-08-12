/**
 * GLE1 content envelope.
 *
 * This file exists because the module previously had none. It declared an
 * 84-byte header while writing a 12-byte nonce at offset 80, so `encodeHeader`
 * threw on every call — a defect no amount of surrounding test count would have
 * surfaced, because nothing executed it.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { hex, uuidToBytes, utf8 } from './bytes';
import { KEY_DOMAIN } from './domains';
import {
  FIELD_ID,
  GLE1_HEADER_LENGTH,
  GLE1_OFFSET,
  OBJECT_TYPE,
  WRAPPED_DEK_LENGTH,
  buildAad,
  decodeHeader,
  encodedLength,
  openContent,
  readStrategy,
  sealContent,
  type Gle1Aad,
} from './gle1';
import { AES_KEY_BYTES, GCM_NONCE_BYTES, GCM_TAG_BYTES, importAesKey, randomBytes } from './suite';

const OWNER = uuidToBytes('11111111-1111-4111-8111-111111111111');
const SCOPE = uuidToBytes('22222222-2222-4222-8222-222222222222');
const OBJECT = uuidToBytes('33333333-3333-4333-8333-333333333333');

let scopeKey: CryptoKey;
let otherScopeKey: CryptoKey;

function aad(overrides: Partial<Gle1Aad> = {}): Gle1Aad {
  return {
    domain: KEY_DOMAIN.couple,
    keyEpoch: 1n,
    ownerUserId: OWNER,
    scopeId: SCOPE,
    objectType: OBJECT_TYPE.dailyRecord,
    objectId: OBJECT,
    fieldId: FIELD_ID.logText,
    contentRevision: 1n,
    ...overrides,
  };
}

beforeAll(async () => {
  scopeKey = await importAesKey(new Uint8Array(AES_KEY_BYTES).fill(7), ['encrypt', 'decrypt']);
  otherScopeKey = await importAesKey(new Uint8Array(AES_KEY_BYTES).fill(9), ['encrypt', 'decrypt']);
});

describe('layout arithmetic', () => {
  it('has a 92-byte header, derived from its last field', () => {
    // The regression guard. With the old 84-byte constant this is 84 and every
    // seal below throws.
    expect(GLE1_HEADER_LENGTH).toBe(92);
    expect(GLE1_HEADER_LENGTH).toBe(GLE1_OFFSET.contentNonce + GCM_NONCE_BYTES);
    expect(GLE1_OFFSET.contentNonce).toBe(80);
    expect(WRAPPED_DEK_LENGTH).toBe(48);
    expect(GLE1_OFFSET.wrappedDek + WRAPPED_DEK_LENGTH).toBe(GLE1_OFFSET.contentNonce);
  });

  it('the content nonce fits entirely inside the header', () => {
    // The exact overflow: writing 12 bytes at offset 80 needs 92 bytes of room.
    expect(GLE1_OFFSET.contentNonce + GCM_NONCE_BYTES).toBeLessThanOrEqual(GLE1_HEADER_LENGTH);
  });

  it('computes total encoded length as header + plaintext + tag', () => {
    expect(encodedLength(0)).toBe(GLE1_HEADER_LENGTH + GCM_TAG_BYTES);
    expect(encodedLength(100)).toBe(GLE1_HEADER_LENGTH + 100 + GCM_TAG_BYTES);
  });
});

describe('seal and open', () => {
  it('round-trips a normal plaintext', async () => {
    const plaintext = utf8('오늘 훈련 끝나고 전화했어');
    const envelope = await sealContent({ scopeKey, plaintext, aad: aad() });
    expect(envelope.length).toBe(encodedLength(plaintext.length));
    const opened = await openContent({ scopeKey, envelope, aad: aad() });
    expect(hex(opened)).toBe(hex(plaintext));
  });

  it('round-trips an empty plaintext', async () => {
    const envelope = await sealContent({ scopeKey, plaintext: new Uint8Array(0), aad: aad() });
    expect(envelope.length).toBe(encodedLength(0));
    expect((await openContent({ scopeKey, envelope, aad: aad() })).length).toBe(0);
  });

  it('round-trips a large plaintext', async () => {
    // Deterministic filler rather than 256 KB of CSPRNG output: `randomBytes`
    // deliberately refuses requests that large, because nothing in this
    // protocol legitimately needs them.
    const plaintext = new Uint8Array(256 * 1024).map((_, i) => (i * 31 + 7) & 0xff);
    const envelope = await sealContent({ scopeKey, plaintext, aad: aad() });
    expect(envelope.length).toBe(encodedLength(plaintext.length));
    expect(hex(await openContent({ scopeKey, envelope, aad: aad() }))).toBe(hex(plaintext));
  });

  it('uses a fresh DEK and nonces per call, so two seals never match', async () => {
    const plaintext = utf8('same text');
    const a = await sealContent({ scopeKey, plaintext, aad: aad() });
    const b = await sealContent({ scopeKey, plaintext, aad: aad() });
    expect(hex(a)).not.toBe(hex(b));
    const headerA = decodeHeader(a);
    const headerB = decodeHeader(b);
    expect(hex(headerA.contentNonce)).not.toBe(hex(headerB.contentNonce));
    expect(hex(headerA.dekWrapNonce)).not.toBe(hex(headerB.dekWrapNonce));
  });

  it('decodes the header it encoded', async () => {
    const envelope = await sealContent({ scopeKey, plaintext: utf8('x'), aad: aad({ keyEpoch: 42n }) });
    const header = decodeHeader(envelope);
    expect(header.domain).toBe(KEY_DOMAIN.couple);
    expect(header.keyEpoch).toBe(42n);
    expect(header.dekWrapNonce).toHaveLength(GCM_NONCE_BYTES);
    expect(header.wrappedDek).toHaveLength(WRAPPED_DEK_LENGTH);
    expect(header.contentNonce).toHaveLength(GCM_NONCE_BYTES);
  });

  it('round-trips a 64-bit epoch and revision beyond the Number-safe range', async () => {
    const big = 2n ** 53n + 1n;
    const context = aad({ keyEpoch: big, contentRevision: big });
    const envelope = await sealContent({ scopeKey, plaintext: utf8('big'), aad: context });
    expect(decodeHeader(envelope).keyEpoch).toBe(big);
    expect(decodeHeader(envelope).keyEpoch).not.toBe(BigInt(Number(big)));
    expect(hex(await openContent({ scopeKey, envelope, aad: context }))).toBe(hex(utf8('big')));
  });
});

describe('wrong key', () => {
  it('a different scope key cannot unwrap the DEK', async () => {
    const envelope = await sealContent({ scopeKey, plaintext: utf8('secret'), aad: aad() });
    await expect(openContent({ scopeKey: otherScopeKey, envelope, aad: aad() }))
      .rejects.toThrow(/E_AEAD_FAILED/);
  });
});

describe('AAD-bound field mutations', () => {
  const mutations: Array<[string, Partial<Gle1Aad>]> = [
    ['domain', { domain: KEY_DOMAIN.personal }],
    ['keyEpoch', { keyEpoch: 2n }],
    ['ownerUserId', { ownerUserId: uuidToBytes('99999999-9999-4999-8999-999999999999') }],
    ['scopeId', { scopeId: uuidToBytes('88888888-8888-4888-8888-888888888888') }],
    ['objectType', { objectType: OBJECT_TYPE.event }],
    ['objectId', { objectId: uuidToBytes('77777777-7777-4777-8777-777777777777') }],
    ['fieldId', { fieldId: FIELD_ID.reaction }],
    ['contentRevision', { contentRevision: 2n }],
  ];

  for (const [name, override] of mutations) {
    it(`rejects a changed ${name}`, async () => {
      const envelope = await sealContent({ scopeKey, plaintext: utf8('bound'), aad: aad() });
      // domain and epoch are also in the header, so they are caught earlier by
      // the explicit consistency check; either refusal is correct.
      await expect(openContent({ scopeKey, envelope, aad: aad(override) })).rejects.toThrow();
    });
  }

  it('a ciphertext cannot be re-homed onto another object', async () => {
    const mine = await sealContent({ scopeKey, plaintext: utf8('mine'), aad: aad() });
    const otherAad = aad({ objectId: uuidToBytes('44444444-4444-4444-8444-444444444444') });
    await expect(openContent({ scopeKey, envelope: mine, aad: otherAad })).rejects.toThrow(/E_AEAD_FAILED/);
  });
});

describe('structural corruption', () => {
  async function envelope() {
    return sealContent({ scopeKey, plaintext: utf8('corrupt me'), aad: aad() });
  }

  it('rejects a truncated header', async () => {
    const short = (await envelope()).slice(0, GLE1_HEADER_LENGTH - 1);
    await expect(openContent({ scopeKey, envelope: short, aad: aad() })).rejects.toThrow(/E_ENVELOPE_LENGTH|E_HEADER_LENGTH/);
  });

  it('rejects an envelope shorter than header plus tag', async () => {
    const tooShort = new Uint8Array(GLE1_HEADER_LENGTH);
    await expect(openContent({ scopeKey, envelope: tooShort, aad: aad() })).rejects.toThrow(/E_ENVELOPE_LENGTH/);
  });

  it('rejects truncated ciphertext', async () => {
    const e = await envelope();
    await expect(openContent({ scopeKey, envelope: e.slice(0, e.length - 1), aad: aad() }))
      .rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects bad magic, version, protocol and suite', async () => {
    for (const [offset, value, pattern] of [
      [GLE1_OFFSET.magic, 0x00, /E_BAD_MAGIC/],
      [GLE1_OFFSET.formatVersion, 9, /E_BAD_VERSION/],
      [GLE1_OFFSET.protocolId, 9, /E_BAD_PROTOCOL/],
      [GLE1_OFFSET.suiteId, 9, /E_BAD_SUITE/],
      [GLE1_OFFSET.domain, 9, /E_BAD_DOMAIN/],
      [GLE1_OFFSET.flags, 1, /E_FLAGS_RESERVED/],
      [GLE1_OFFSET.reserved, 1, /E_RESERVED_NONZERO/],
    ] as Array<[number, number, RegExp]>) {
      const e = await envelope();
      e[offset] = value;
      await expect(openContent({ scopeKey, envelope: e, aad: aad() })).rejects.toThrow(pattern);
    }
  });

  it('rejects a mutated content nonce', async () => {
    const e = await envelope();
    e[GLE1_OFFSET.contentNonce] ^= 0x01;
    await expect(openContent({ scopeKey, envelope: e, aad: aad() })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects a mutated DEK wrap nonce and wrapped DEK', async () => {
    const nonce = await envelope();
    nonce[GLE1_OFFSET.dekWrapNonce] ^= 0x01;
    await expect(openContent({ scopeKey, envelope: nonce, aad: aad() })).rejects.toThrow(/E_AEAD_FAILED/);

    const dek = await envelope();
    dek[GLE1_OFFSET.wrappedDek] ^= 0x01;
    await expect(openContent({ scopeKey, envelope: dek, aad: aad() })).rejects.toThrow(/E_AEAD_FAILED/);
  });

  it('rejects mutated ciphertext and a mutated tag', async () => {
    const body = await envelope();
    body[GLE1_HEADER_LENGTH] ^= 0x01;
    await expect(openContent({ scopeKey, envelope: body, aad: aad() })).rejects.toThrow(/E_AEAD_FAILED/);

    const tag = await envelope();
    tag[tag.length - 1] ^= 0x01;
    await expect(openContent({ scopeKey, envelope: tag, aad: aad() })).rejects.toThrow(/E_AEAD_FAILED/);
  });
});

describe('AAD construction guards', () => {
  it('rejects a revision below 1 and an out-of-range type or field', () => {
    expect(() => buildAad(aad({ contentRevision: 0n }))).toThrow(/E_BAD_REVISION/);
    expect(() => buildAad(aad({ objectType: 0 }))).toThrow(/E_BAD_OBJECT_TYPE/);
    expect(() => buildAad(aad({ fieldId: 300 }))).toThrow(/E_BAD_FIELD_ID/);
  });

  it('produces a deterministic byte string', () => {
    expect(hex(buildAad(aad()))).toBe(hex(buildAad(aad())));
    expect(hex(buildAad(aad()))).not.toBe(hex(buildAad(aad({ fieldId: FIELD_ID.reaction }))));
  });
});

describe('read strategy', () => {
  it('treats 0 as plaintext explicitly and an unknown format as unsupported', () => {
    expect(readStrategy(0)).toBe('plaintext');
    expect(readStrategy(1)).toBe('gle1');
    expect(readStrategy(2)).toBe('unsupported');
    expect(readStrategy(99)).toBe('unsupported');
  });
});
