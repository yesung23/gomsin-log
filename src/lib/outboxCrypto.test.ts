import { afterEach, describe, expect, it } from 'vitest';

import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';

import {
  enqueueRecord,
  pendingForAccount,
  readQueuedRecord,
  setOutboxLocalCacheKey,
  type OutboxPersistence,
  type QueuedRecord,
} from '@/lib/outbox';
import { isSealedOutboxRecord, openOutboxRecord, sealOutboxRecord } from '@/lib/outboxCrypto';

const USER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const COUPLE = 'aaaaaaaa-2222-4333-8444-555555555555';
const ENTRY = 'bbbbbbbb-2222-4333-8444-555555555555';

async function key(seed = 5): Promise<CryptoKey> {
  return importAesKey(new Uint8Array(AES_KEY_BYTES).fill(seed), ['encrypt', 'decrypt']);
}

function memoryPersistence(): OutboxPersistence & { rows: Map<string, QueuedRecord> } {
  const rows = new Map<string, QueuedRecord>();
  return {
    rows,
    all: async () => [...rows.values()],
    put: async (entry) => { rows.set(entry.id, entry); },
    remove: async (id) => { rows.delete(id); },
  };
}

const record = {
  date: '2026-08-14',
  time: '21:14',
  authorRole: 'gomsin' as const,
  log: '오늘 진짜 힘들었어',
  isPrivate: false,
};

afterEach(() => {
  setOutboxLocalCacheKey(null);
});

describe('outbox record sealing', () => {
  it('round-trips the record', async () => {
    const localCacheKey = await key();
    const sealed = await sealOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, record });
    await expect(openOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, sealed }))
      .resolves.toEqual(record);
  });

  it('leaves no plaintext in the sealed bytes', async () => {
    const localCacheKey = await key();
    const sealed = await sealOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, record });
    const asText = new TextDecoder('utf-8', { fatal: false }).decode(sealed.ciphertext);
    expect(asText).not.toContain('힘들었어');
  });

  it('cannot be opened under a different key', async () => {
    const sealed = await sealOutboxRecord({
      localCacheKey: await key(5), entryId: ENTRY, userId: USER, record,
    });
    await expect(openOutboxRecord({
      localCacheKey: await key(6), entryId: ENTRY, userId: USER, sealed,
    })).rejects.toThrow();
  });

  it('cannot be moved onto another entry id', async () => {
    // Otherwise a tampered queue could redirect one record's content onto a
    // different record's row at delivery time.
    const localCacheKey = await key();
    const sealed = await sealOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, record });
    await expect(openOutboxRecord({
      localCacheKey, entryId: '00000000-2222-4333-8444-555555555555', userId: USER, sealed,
    })).rejects.toThrow();
  });

  it('cannot be replayed into another account', async () => {
    const localCacheKey = await key();
    const sealed = await sealOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, record });
    await expect(openOutboxRecord({ localCacheKey, entryId: ENTRY, userId: OTHER, sealed }))
      .rejects.toThrow();
  });

  it('refuses an unknown cipher version', async () => {
    const localCacheKey = await key();
    const sealed = await sealOutboxRecord({ localCacheKey, entryId: ENTRY, userId: USER, record });
    await expect(openOutboxRecord({
      localCacheKey, entryId: ENTRY, userId: USER, sealed: { ...sealed, version: 99 },
    })).rejects.toThrow(/E_OUTBOX_VERSION/);
  });
});

describe('the queue stores ciphertext', () => {
  it('stores no readable record text once a local cache key exists', async () => {
    setOutboxLocalCacheKey(await key());
    const persistence = memoryPersistence();
    await enqueueRecord(persistence, { id: ENTRY, userId: USER, coupleId: COUPLE, record, files: [] });

    const stored = persistence.rows.get(ENTRY)!;
    // The plaintext must be GONE, not merely accompanied by a ciphertext copy.
    expect(stored.record).toBeUndefined();
    expect(isSealedOutboxRecord(stored.sealedRecord)).toBe(true);
    expect(JSON.stringify(stored.sealedRecord)).not.toContain('힘들었어');
  });

  it('gives the record back at delivery time', async () => {
    setOutboxLocalCacheKey(await key());
    const persistence = memoryPersistence();
    await enqueueRecord(persistence, { id: ENTRY, userId: USER, coupleId: COUPLE, record, files: [] });
    const [entry] = await pendingForAccount(persistence, USER);
    await expect(readQueuedRecord(entry)).resolves.toEqual(record);
  });

  it('still queues in the clear when the device has no local cache key', async () => {
    // Refusing to queue would trade a disk-at-rest exposure for guaranteed data
    // loss, which is the worse outcome. The entry says which it is.
    setOutboxLocalCacheKey(null);
    const persistence = memoryPersistence();
    await enqueueRecord(persistence, { id: ENTRY, userId: USER, coupleId: COUPLE, record, files: [] });
    const stored = persistence.rows.get(ENTRY)!;
    expect(stored.sealedRecord).toBeUndefined();
    expect(stored.record).toEqual(record);
  });

  it('reads a legacy plaintext entry queued before encryption existed', async () => {
    setOutboxLocalCacheKey(await key());
    const legacy: QueuedRecord = {
      id: ENTRY, userId: USER, coupleId: COUPLE, queuedAt: '2026-08-01T00:00:00.000Z',
      attempts: 0, record, files: [],
    };
    await expect(readQueuedRecord(legacy)).resolves.toEqual(record);
  });

  it('throws rather than deliver a guessed payload when a sealed entry cannot be opened', async () => {
    setOutboxLocalCacheKey(await key(5));
    const persistence = memoryPersistence();
    await enqueueRecord(persistence, { id: ENTRY, userId: USER, coupleId: COUPLE, record, files: [] });
    const [entry] = await pendingForAccount(persistence, USER);

    // The key changed, e.g. a reinstall.
    setOutboxLocalCacheKey(await key(6));
    await expect(readQueuedRecord(entry)).rejects.toThrow();
  });

  it('throws when a sealed entry is read with no key at all', async () => {
    setOutboxLocalCacheKey(await key());
    const persistence = memoryPersistence();
    await enqueueRecord(persistence, { id: ENTRY, userId: USER, coupleId: COUPLE, record, files: [] });
    const [entry] = await pendingForAccount(persistence, USER);

    setOutboxLocalCacheKey(null);
    await expect(readQueuedRecord(entry)).rejects.toThrow(/no local cache key/);
  });
});
