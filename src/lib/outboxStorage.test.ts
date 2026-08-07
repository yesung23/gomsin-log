import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedRecord } from '@/lib/outbox';
import { createIndexedDbOutbox } from '@/lib/outboxStorage';

function queuedRecord(): QueuedRecord {
  return {
    id: 'queued-1',
    userId: 'user-1',
    coupleId: 'couple-1',
    queuedAt: '2026-08-07T00:00:00.000Z',
    attempts: 0,
    record: {
      date: '2026-08-07',
      time: '09:00',
      authorRole: 'gomsin',
      log: 'offline record',
      isPrivate: false,
    },
    files: [],
  };
}

function indexedDbHarness() {
  const request = {
    result: 'queued-1',
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<IDBValidKey>;
  const store = { put: vi.fn(() => request) } as unknown as IDBObjectStore;
  const transaction = {
    error: null,
    objectStore: vi.fn(() => store),
    oncomplete: null,
    onabort: null,
  } as unknown as IDBTransaction;
  const database = {
    objectStoreNames: { contains: vi.fn(() => true) },
    transaction: vi.fn(() => transaction),
    close: vi.fn(),
  } as unknown as IDBDatabase;
  const openRequest = {
    result: database,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBOpenDBRequest;

  vi.stubGlobal('indexedDB', { open: vi.fn(() => openRequest) });
  return { request, transaction, database, openRequest };
}

async function openAndStart(
  openRequest: IDBOpenDBRequest,
  request: IDBRequest<IDBValidKey>,
) {
  openRequest.onsuccess?.call(openRequest, new Event('success'));
  await Promise.resolve();
  request.onsuccess?.call(request, new Event('success'));
  await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IndexedDB outbox transaction durability', () => {
  it('does not report success until the transaction commits', async () => {
    const { request, transaction, database, openRequest } = indexedDbHarness();
    const outbox = createIndexedDbOutbox();
    expect(outbox).not.toBeNull();

    let settled = false;
    const saving = outbox!.put(queuedRecord());
    void saving.finally(() => {
      settled = true;
    });

    await openAndStart(openRequest, request);
    expect(settled).toBe(false);
    expect(database.close).not.toHaveBeenCalled();

    transaction.oncomplete?.call(transaction, new Event('complete'));
    await expect(saving).resolves.toBeUndefined();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('rejects when a successful request is followed by a transaction abort', async () => {
    const { request, transaction, database, openRequest } = indexedDbHarness();
    const outbox = createIndexedDbOutbox();
    const saving = outbox!.put(queuedRecord());

    await openAndStart(openRequest, request);
    const failure = new DOMException('commit failed', 'AbortError');
    Object.defineProperty(transaction, 'error', { value: failure });
    transaction.onabort?.call(transaction, new Event('abort'));

    await expect(saving).rejects.toBe(failure);
    expect(database.close).toHaveBeenCalledOnce();
  });
});
