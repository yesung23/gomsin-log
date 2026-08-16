import { afterEach, describe, expect, it } from 'vitest';

import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';
import { sealRecordContent } from '@/crypto/recordContent';
import type { EpochState, KeyDomainName } from '@/crypto/domains';

import {
  RECORD_CIPHER_GLE1,
  decideRecordWrite,
  decryptRecordRow,
  encryptRecordForWrite,
  type RecordCryptoEnvironment,
  type ScopeEpoch,
} from './contentCrypto';
import {
  clearCoupleProtectionRequirement,
  requireCoupleProtection,
} from '@/app/e2ee/coupleProtectionBarrier';

const OWNER = '11111111-2222-4333-8444-555555555555';
const COUPLE = 'aaaaaaaa-2222-4333-8444-555555555555';
const RECORD = 'bbbbbbbb-2222-4333-8444-555555555555';

async function key(seed: number): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

/**
 * A scriptable environment.
 *
 * Every branch of the routing decision is reachable from here without a database
 * or a keystore, which is what the port exists for.
 */
function environment(options: {
  floors?: Partial<Record<string, number>>;
  epochs?: Partial<Record<string, ScopeEpoch[]>>;
  keys?: Partial<Record<string, CryptoKey | null>>;
}): RecordCryptoEnvironment {
  const at = (domain: KeyDomainName, scopeId: string) => `${domain}:${scopeId}`;
  return {
    floorFor: async (domain, scopeId) => options.floors?.[at(domain, scopeId)] ?? 0,
    epochsFor: async (domain, scopeId) => options.epochs?.[at(domain, scopeId)] ?? [],
    scopeKeyFor: async (domain, scopeId, epoch) =>
      options.keys?.[`${at(domain, scopeId)}:${epoch}`] ?? null,
  };
}

function epoch(domain: KeyDomainName, scopeId: string, value: bigint, state: EpochState): ScopeEpoch {
  return { domain, scopeId, epoch: value, state };
}

const sharedRouting = { isPrivate: false, ownerUserId: OWNER, coupleId: COUPLE };
const privateRouting = { isPrivate: true, ownerUserId: OWNER, coupleId: COUPLE };

describe('decideRecordWrite', () => {
  afterEach(() => clearCoupleProtectionRequirement(OWNER, COUPLE));

  it('writes plaintext while the scope has no write floor', async () => {
    const plan = await decideRecordWrite(environment({}), sharedRouting);
    expect(plan.mode).toBe('plaintext');
  });

  it('refuses a connected couple while its local protection barrier is active', async () => {
    requireCoupleProtection(OWNER, COUPLE);
    const plan = await decideRecordWrite(environment({}), sharedRouting);
    expect(plan).toEqual({ mode: 'refused', reason: 'no_active_epoch' });
  });

  it('reads the floor of the scope the record routes to, not a global flag', async () => {
    // The couple floor is active; the personal one is not. A shared record must
    // encrypt and a private one must not, in the same account at the same time.
    const env = environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 1n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:1`]: await key(3) },
    });
    expect((await decideRecordWrite(env, sharedRouting)).mode).toBe('gle1');
    expect((await decideRecordWrite(env, privateRouting)).mode).toBe('plaintext');
  });

  it('routes a shared record to the couple domain', async () => {
    const plan = await decideRecordWrite(environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 5n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:5`]: await key(3) },
    }), sharedRouting);
    expect(plan).toMatchObject({ mode: 'gle1', keyDomain: 'couple', keyEpoch: 5n });
  });

  it('routes a private record to the personal domain', async () => {
    const plan = await decideRecordWrite(environment({
      floors: { [`personal:${OWNER}`]: 1 },
      epochs: { [`personal:${OWNER}`]: [epoch('personal', OWNER, 2n, 'ACTIVE')] },
      keys: { [`personal:${OWNER}:2`]: await key(4) },
    }), privateRouting);
    expect(plan).toMatchObject({ mode: 'gle1', keyDomain: 'personal', keyEpoch: 2n });
  });

  it('picks the ACTIVE epoch and never a RETIRED one', async () => {
    const plan = await decideRecordWrite(environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: {
        [`couple:${COUPLE}`]: [
          epoch('couple', COUPLE, 1n, 'RETIRED'),
          epoch('couple', COUPLE, 2n, 'ACTIVE'),
          epoch('couple', COUPLE, 3n, 'PREPARING'),
        ],
      },
      keys: { [`couple:${COUPLE}:1`]: await key(3), [`couple:${COUPLE}:2`]: await key(5) },
    }), sharedRouting);
    expect(plan).toMatchObject({ mode: 'gle1', keyEpoch: 2n });
  });

  it('REFUSES rather than falling back to plaintext when no epoch is ACTIVE', async () => {
    // This is the whole point of the write floor. A client that cannot encrypt
    // must not write in the clear, and must not be able to.
    const plan = await decideRecordWrite(environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 1n, 'RETIRED')] },
    }), sharedRouting);
    expect(plan).toEqual({ mode: 'refused', reason: 'no_active_epoch' });
  });

  it('REFUSES when the device holds no key for the ACTIVE epoch', async () => {
    const plan = await decideRecordWrite(environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 9n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:9`]: null },
    }), sharedRouting);
    expect(plan).toEqual({ mode: 'refused', reason: 'key_unavailable' });
  });

  it('never returns a plan whose mode is plaintext once a floor exists', async () => {
    for (const routing of [sharedRouting, privateRouting]) {
      const scope = routing.isPrivate ? `personal:${OWNER}` : `couple:${COUPLE}`;
      const plan = await decideRecordWrite(environment({ floors: { [scope]: 1 } }), routing);
      expect(plan.mode).not.toBe('plaintext');
    }
  });
});

describe('encryptRecordForWrite', () => {
  it('returns the routing columns a row needs, with the epoch as a string', async () => {
    const plan = await decideRecordWrite(environment({
      floors: { [`couple:${COUPLE}`]: 1 },
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 4n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:4`]: await key(6) },
    }), sharedRouting);
    if (plan.mode !== 'gle1') throw new Error('expected a gle1 plan');

    const columns = await encryptRecordForWrite({
      plan,
      routing: sharedRouting,
      recordId: RECORD,
      contentRevision: 1n,
      document: { log: '비밀 일기' },
    });

    expect(columns.cipherFormat).toBe(RECORD_CIPHER_GLE1);
    expect(columns.keyDomain).toBe('couple');
    // A 64-bit counter must not travel as a JSON number.
    expect(columns.keyEpoch).toBe('4');
    expect(columns.contentEnvelope.length).toBeGreaterThanOrEqual(108);
    expect(new TextDecoder('utf-8', { fatal: false }).decode(columns.contentEnvelope))
      .not.toContain('비밀 일기');
  });
});

describe('decryptRecordRow', () => {
  const row = {
    recordId: RECORD,
    isPrivate: false,
    ownerUserId: OWNER,
    coupleId: COUPLE,
    keyDomain: 'couple',
    keyEpoch: 2n,
    contentRevision: 1n,
  };

  async function envelopeFor(scopeKey: CryptoKey, overrides = {}) {
    return sealRecordContent({
      scopeKey,
      document: { log: '공유 기록' },
      isPrivate: false,
      recordId: RECORD,
      ownerUserId: OWNER,
      coupleId: COUPLE,
      keyEpoch: 2n,
      contentRevision: 1n,
      ...overrides,
    });
  }

  it('opens a row under an ACTIVE epoch', async () => {
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:2`]: scopeKey },
    }), { ...row, envelope: await envelopeFor(scopeKey) });
    expect(result).toEqual({ ok: true, document: { log: '공유 기록' } });
  });

  it('still opens a row under a RETIRED epoch', async () => {
    // Retired epochs stay readable forever; historical ciphertext needs them.
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'RETIRED')] },
      keys: { [`couple:${COUPLE}:2`]: scopeKey },
    }), { ...row, envelope: await envelopeFor(scopeKey) });
    expect(result).toEqual({ ok: true, document: { log: '공유 기록' } });
  });

  it('refuses a row under an ABANDONED epoch', async () => {
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ABANDONED')] },
      keys: { [`couple:${COUPLE}:2`]: scopeKey },
    }), { ...row, envelope: await envelopeFor(scopeKey) });
    expect(result).toEqual({ ok: false, reason: 'undecryptable' });
  });

  it('refuses a row whose declared domain contradicts its visibility', async () => {
    // A shared row claiming the personal domain, or the reverse, is forged
    // routing. The DB refuses it on write; this refuses it on read too, so a row
    // written before that enforcement cannot steer the client to the wrong key.
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:2`]: scopeKey },
    }), { ...row, keyDomain: 'personal', envelope: await envelopeFor(scopeKey) });
    expect(result).toEqual({ ok: false, reason: 'undecryptable' });
  });

  it('refuses a row whose epoch this device has no key for', async () => {
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:2`]: null },
    }), { ...row, envelope: await envelopeFor(scopeKey) });
    expect(result).toEqual({ ok: false, reason: 'key_unavailable' });
  });

  it('refuses a forged envelope that the server would have accepted', async () => {
    // 039's honest limit: a self-consistent envelope sealed under a key nobody
    // else holds passes every server check and fails HERE, on the AAD.
    const attacker = await key(1);
    const legitimate = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:2`]: legitimate },
    }), { ...row, envelope: await envelopeFor(attacker) });
    expect(result).toEqual({ ok: false, reason: 'undecryptable' });
  });

  it('refuses a row moved from another record', async () => {
    const scopeKey = await key(9);
    const envelope = await envelopeFor(scopeKey, { recordId: '00000000-2222-4333-8444-555555555555' });
    const result = await decryptRecordRow(environment({
      epochs: { [`couple:${COUPLE}`]: [epoch('couple', COUPLE, 2n, 'ACTIVE')] },
      keys: { [`couple:${COUPLE}:2`]: scopeKey },
    }), { ...row, envelope });
    expect(result).toEqual({ ok: false, reason: 'undecryptable' });
  });

  it('never returns an empty document in place of a failure', async () => {
    // An empty record is indistinguishable from one the author cleared, so a
    // failure must never be presentable as content.
    const scopeKey = await key(9);
    const result = await decryptRecordRow(environment({
      epochs: {},
      keys: {},
    }), { ...row, envelope: await envelopeFor(scopeKey) });
    expect(result.ok).toBe(false);
    expect('document' in result).toBe(false);
  });
});
