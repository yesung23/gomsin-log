import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DELIVERY_ATTEMPTS,
  applyDeliveryOutcome,
  deliverableForAccount,
  discardEntry,
  enqueueRecord,
  ensureQueuedMediaPlan,
  isValidQueuedMediaPlan,
  isRetryableReason,
  pendingForAccount,
  purgeAccount,
  unblockEntry,
  type OutboxPersistence,
  type QueuedRecord,
} from '@/lib/outbox';
import type { DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(app) = a record the network refused is gone.
 *
 * Measured on the unfixed tree: there was no outbox at all. `store.tsx` documented
 * its own absence -- "the 'no queued mutation delivered' claim holds because there
 * is no outbox in this codebase" -- and `addRecordWithMedia` returned
 * `{ ok: false }` with the payload discarded. The composer refuses to fire when
 * `navigator.onLine === false`, which covers honest offline, but `true` only means
 * the OS sees a link: on a flaky connection the write was attempted, failed, and the
 * typed text was lost with a toast.
 *
 * The properties asserted here are the ones that make a queue trustworthy rather
 * than just present: FIFO within an account, no bleed between accounts, a
 * definitive refusal never retried and never discarded, and NOTHING removed except
 * by delivery or by an explicit choice.
 */

function memoryPersistence(seed: QueuedRecord[] = []): OutboxPersistence & { rows: QueuedRecord[] } {
  const rows = [...seed];
  return {
    rows,
    all: async () => rows.map((row) => ({ ...row })),
    add: async (entry) => {
      if (rows.some((row) => row.id === entry.id)) {
        throw new DOMException('The key already exists.', 'ConstraintError');
      }
      rows.push({ ...entry });
    },
    put: async (entry) => {
      const index = rows.findIndex((row) => row.id === entry.id);
      if (index >= 0) rows[index] = { ...entry };
      else rows.push({ ...entry });
    },
    putMany: async (entries) => {
      for (const entry of entries) {
        const index = rows.findIndex((row) => row.id === entry.id);
        if (index >= 0) rows[index] = { ...entry };
        else rows.push({ ...entry });
      }
    },
    remove: async (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    removeMany: async (ids) => {
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
}

const ME = 'user-me';
const OTHER = 'user-other';

function draft(overrides: Partial<Omit<DailyRecord, 'id' | 'createdAt'>> = {}) {
  return {
    userId: ME,
    date: '2026-07-31',
    time: '09:00',
    authorRole: 'gomsin' as const,
    log: '오프라인에서 쓴 기록',
    isPrivate: false,
    ...overrides,
  };
}

function entry(overrides: Partial<QueuedRecord> = {}): QueuedRecord {
  return {
    id: 'q-1',
    userId: ME,
    coupleId: 'couple-1',
    queuedAt: '2026-07-31T09:00:00.000Z',
    attempts: 0,
    record: draft(),
    files: [],
    ...overrides,
  };
}

let store: ReturnType<typeof memoryPersistence>;

beforeEach(() => {
  store = memoryPersistence();
});

describe('a refused write is kept instead of lost', () => {
  it('queues the intent, not a half-finished write', async () => {
    const queued = await enqueueRecord(store, {
      id: 'q-1',
      userId: ME,
      coupleId: 'couple-1',
      record: draft({ log: '눈이 왔어' }),
      files: [],
    });

    expect(queued.attempts).toBe(0);
    expect(queued.queuedAt).toBeTruthy();
    // The payload is exactly what the composer passed, so replay re-invokes the
    // one write path rather than reimplementing it.
    expect(queued.record.log).toBe('눈이 왔어');
    expect(store.rows).toHaveLength(1);
  });

  it('keeps the id stable, so a lost response cannot insert the row twice', async () => {
    const queued = await enqueueRecord(store, {
      id: 'q-stable',
      userId: ME,
      coupleId: 'couple-1',
      record: draft(),
      files: [],
    });

    await applyDeliveryOutcome(store, queued, { ok: false, reason: 'offline', message: '오프라인' });

    expect(store.rows[0].id).toBe('q-stable');
    expect(store.rows).toHaveLength(1);
  });

  it('carries files through, which is why persistence is a port and not localStorage', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const queued = await enqueueRecord(store, {
      id: 'q-file',
      userId: ME,
      coupleId: 'couple-1',
      record: draft(),
      files: [file],
    });

    expect(queued.files).toHaveLength(1);
    expect(queued.files[0].name).toBe('photo.jpg');
    expect(queued.mediaPlan?.slots).toHaveLength(1);
    expect(queued.mediaPlan?.slots[0]).toMatchObject({
      fileIndex: 0,
      byteLength: 3,
      mimeType: 'image/jpeg',
    });
    expect(isValidQueuedMediaPlan(queued.mediaPlan, queued.files)).toBe(true);
  });

  it('durably upgrades a legacy media entry before replay and never replaces that plan', async () => {
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['bb'], 'b.jpg', { type: 'image/jpeg' }),
    ];
    const legacy = entry({ id: 'legacy', files });
    await store.put(legacy);

    const first = await ensureQueuedMediaPlan(store, legacy);
    expect(first.kind).toBe('ready');
    if (first.kind !== 'ready') throw new Error('plan was not created');
    expect(first.created).toBe(true);
    expect(isValidQueuedMediaPlan(first.entry.mediaPlan, files)).toBe(true);
    const objectIds = first.entry.mediaPlan!.slots.map((slot) => slot.objectId);

    const second = await ensureQueuedMediaPlan(store, store.rows[0]);
    expect(second).toMatchObject({ kind: 'ready', created: false });
    if (second.kind !== 'ready') throw new Error('plan was not preserved');
    expect(second.entry.mediaPlan!.slots.map((slot) => slot.objectId)).toEqual(objectIds);
  });

  it('rejects a mismatched persisted media plan instead of remapping files after upload', async () => {
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    const corrupt = entry({
      files: [file],
      mediaPlan: {
        version: 1,
        slots: [{
          objectId: '11111111-1111-4111-8111-111111111111',
          fileIndex: 0,
          byteLength: file.size + 1,
          mimeType: file.type,
        }],
      },
    });

    await expect(ensureQueuedMediaPlan(store, corrupt)).resolves.toEqual({ kind: 'invalid' });
    expect(store.rows).toHaveLength(0);
  });

  it('never overwrites an existing same-id entry or File when a new insert conflicts', async () => {
    const oldFile = new File([new Uint8Array([1, 2, 3])], 'old.jpg', { type: 'image/jpeg' });
    const newFile = new File([new Uint8Array([9, 8, 7, 6])], 'new.jpg', { type: 'image/jpeg' });
    const oldEntry = entry({
      id: 'duplicate-id',
      record: draft({ log: 'original record' }),
      files: [oldFile],
    });
    store = memoryPersistence([oldEntry]);

    await expect(enqueueRecord(store, {
      id: 'duplicate-id',
      userId: ME,
      coupleId: 'couple-1',
      record: draft({ log: 'replacement record' }),
      files: [newFile],
    })).rejects.toMatchObject({ name: 'ConstraintError' });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toBe(oldEntry);
    expect(store.rows[0].record?.log).toBe('original record');
    expect(store.rows[0].files[0]).toBe(oldFile);
    expect(store.rows[0].files[0]).toMatchObject({ name: 'old.jpg', size: 3 });
  });
});

describe('a day is replayed in the order it was written', () => {
  it('returns oldest first regardless of insertion order', async () => {
    store = memoryPersistence([
      entry({ id: 'c', queuedAt: '2026-07-31T21:00:00.000Z' }),
      entry({ id: 'a', queuedAt: '2026-07-31T08:00:00.000Z' }),
      entry({ id: 'b', queuedAt: '2026-07-31T13:00:00.000Z' }),
    ]);

    expect((await pendingForAccount(store, ME)).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('a queue never bleeds between accounts', () => {
  it('reads only this account, even on a shared device', async () => {
    store = memoryPersistence([
      entry({ id: 'mine', userId: ME }),
      entry({ id: 'theirs', userId: OTHER }),
    ]);

    expect((await pendingForAccount(store, ME)).map((row) => row.id)).toEqual(['mine']);
    expect((await deliverableForAccount(store, ME)).map((row) => row.id)).toEqual(['mine']);
  });

  it('survives sign-out, because the same person signing back in must find it', async () => {
    // Nothing here clears on sign-out. The account filter is what makes that safe:
    // account B can never see or replay account A's entry.
    store = memoryPersistence([entry({ id: 'mine', userId: ME })]);

    expect(await pendingForAccount(store, OTHER)).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });

  it('purges one account without touching the other, for account deletion', async () => {
    store = memoryPersistence([
      entry({ id: 'mine-1', userId: ME }),
      entry({ id: 'mine-2', userId: ME, queuedAt: '2026-07-31T10:00:00.000Z' }),
      entry({ id: 'theirs', userId: OTHER }),
    ]);

    expect(await purgeAccount(store, ME)).toBe(2);
    expect(store.rows.map((row) => row.id)).toEqual(['theirs']);
  });
});

describe('retryable and definitive refusals are treated differently', () => {
  it('names only the two reasons a later attempt could change', () => {
    expect(isRetryableReason('offline')).toBe(true);
    expect(isRetryableReason('unreachable')).toBe(true);
    for (const definitive of ['forbidden', 'auth_expired', 'not_found', 'server', 'unknown']) {
      expect(isRetryableReason(definitive), definitive).toBe(false);
    }
  });

  it('keeps a retryable failure queued and counts the attempt', async () => {
    const queued = entry();
    await store.put(queued);

    const disposition = await applyDeliveryOutcome(
      store, queued, { ok: false, reason: 'unreachable', message: '연결 실패' },
    );

    expect(disposition).toBe('requeued');
    expect(store.rows[0].attempts).toBe(1);
    expect(store.rows[0].blocked).toBeUndefined();
    expect((await deliverableForAccount(store, ME)).map((row) => row.id)).toEqual(['q-1']);
  });

  it('blocks a definitive failure rather than retrying it forever', async () => {
    // A membership rejection returns the same answer however many times it is sent.
    const queued = entry();
    await store.put(queued);

    const disposition = await applyDeliveryOutcome(
      store, queued, { ok: false, reason: 'forbidden', message: '권한이 없어요.' },
    );

    expect(disposition).toBe('blocked');
    expect(store.rows[0].blocked).toMatchObject({ reason: 'forbidden', message: '권한이 없어요.' });
    // Excluded from automatic flushes...
    expect(await deliverableForAccount(store, ME)).toEqual([]);
    // ...but still there, so the user can be told and can retry by hand.
    expect(await pendingForAccount(store, ME)).toHaveLength(1);
  });

  it('stops auto-retrying a poison entry at the cap, and says why', async () => {
    const queued = entry({ attempts: MAX_DELIVERY_ATTEMPTS - 1 });
    await store.put(queued);

    const disposition = await applyDeliveryOutcome(
      store, queued, { ok: false, reason: 'offline', message: '오프라인이에요.' },
    );

    expect(disposition).toBe('blocked');
    // The cap being reached is a different fact from the last error, and reporting
    // the last error alone would misdescribe why it stopped.
    expect(store.rows[0].blocked?.message).toContain('여러 번');
    expect(await deliverableForAccount(store, ME)).toEqual([]);
  });

  it('removes an entry on delivery, and only on delivery', async () => {
    const queued = entry();
    await store.put(queued);

    expect(await applyDeliveryOutcome(store, queued, { ok: true })).toBe('delivered');
    expect(store.rows).toEqual([]);
  });

  it('preserves the exact entry when a fence is observed before an uncertain disposition', async () => {
    const queued = entry({
      attempts: 7,
      blocked: { reason: 'forbidden', message: 'original', at: '2026-07-31T09:00:00.000Z' },
      files: [new File(['original'], 'original.jpg', { type: 'image/jpeg' })],
    });
    store = memoryPersistence([queued]);

    const disposition = await applyDeliveryOutcome(
      store,
      queued,
      { ok: false, reason: 'unreachable', message: 'unknown result' },
      () => false,
    );

    expect(disposition).toBe('preserved');
    expect(store.rows).toEqual([queued]);
    expect(store.rows[0]).toBe(queued);
  });

  it('removes a confirmed success exactly once when disposition remains authorized', async () => {
    const queued = entry();
    store = memoryPersistence([queued]);
    let removeCalls = 0;
    const remove = store.remove;
    store.remove = async (id) => {
      removeCalls += 1;
      await remove(id);
    };

    expect(await applyDeliveryOutcome(store, queued, { ok: true }, () => true))
      .toBe('delivered');
    expect(removeCalls).toBe(1);
    expect(store.rows).toEqual([]);
  });

  it('never discards an entry as a side effect of failing', async () => {
    // The property that makes this module worth having: the only paths out of the
    // queue are a successful delivery and an explicit discard.
    const queued = entry();
    await store.put(queued);

    for (const reason of ['offline', 'unreachable', 'forbidden', 'auth_expired', 'server']) {
      await applyDeliveryOutcome(store, store.rows[0], { ok: false, reason, message: reason });
      expect(store.rows, reason).toHaveLength(1);
    }
  });
});

describe('a blocked entry can be retried or dropped, by the user', () => {
  it('unblocking resets the attempt count so it is tried again', async () => {
    const queued = entry({
      attempts: MAX_DELIVERY_ATTEMPTS,
      blocked: { reason: 'forbidden', message: '권한이 없어요.', at: '2026-07-31T09:00:00.000Z' },
    });
    await store.put(queued);

    await unblockEntry(store, queued);

    expect(store.rows[0].blocked).toBeUndefined();
    expect(store.rows[0].attempts).toBe(0);
    expect((await deliverableForAccount(store, ME)).map((row) => row.id)).toEqual(['q-1']);
  });

  it('discarding is the only way an undelivered entry disappears', async () => {
    await store.put(entry());
    await discardEntry(store, 'q-1');
    expect(store.rows).toEqual([]);
  });
});
