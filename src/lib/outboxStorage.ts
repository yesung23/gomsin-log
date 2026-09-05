import type { OutboxPersistence, QueuedRecord } from '@/lib/outbox';
import { OUTBOX_SCHEMA_VERSION } from '@/lib/outbox';

/**
 * IndexedDB storage for the outbox.
 *
 * Deliberately thin: every decision about ordering, retrying, blocking and account
 * isolation lives in `outbox.ts` and is tested against an in-memory double. This
 * file only opens a database and moves records in and out of one object store, so
 * that the part jsdom cannot execute is also the part with no logic in it.
 *
 * IndexedDB rather than `localStorage` because an entry carries `File` objects.
 * `localStorage` holds strings only; base64 inside a 5 MB quota cannot hold the
 * photos this app is built around, and IndexedDB stores a Blob natively with no
 * encoding step.
 */

const DATABASE_NAME = 'gomsinlog-outbox';
const STORE_NAME = 'records';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, OUTBOX_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        // Keyed by the entry id, which is also the eventual `daily_records` row id.
        // New intents use `add` (duplicate ids reject); `put` is reserved for
        // updates to an entry already selected by the queue workflow.
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    let result: T;
    let requestError: DOMException | null = null;

    // An IDBRequest can succeed before its containing transaction commits. Keep
    // the result, but do not tell callers that a queued record is durable until
    // the transaction itself completes.
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      requestError = request.error;
    };
    // Closing on completion rather than leaving the handle open: a held connection
    // blocks a later version upgrade in another tab.
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || requestError || new Error('IndexedDB transaction aborted.'));
    };
  }));
}

/** Issue a batch synchronously so IndexedDB commits all requests or none. */
function transactBatch(
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  return openDatabase().then((database) => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    let runError: unknown = null;
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      reject(runError || transaction.error || new Error('IndexedDB batch transaction aborted.'));
    };
    try {
      run(transaction.objectStore(STORE_NAME));
    } catch (error) {
      runError = error;
      try {
        transaction.abort();
      } catch {
        database.close();
        reject(error);
      }
    }
  }));
}

export function isOutboxStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * The persistence port, or `null` where IndexedDB does not exist.
 *
 * Returning null rather than a silently-forgetting stub is the point: a caller that
 * cannot persist must NOT tell the user their record is queued, because it is not.
 */
export function createIndexedDbOutbox(): OutboxPersistence | null {
  if (!isOutboxStorageAvailable()) return null;
  return {
    all: () => transact<QueuedRecord[]>('readonly', (store) => store.getAll()),
    add: (entry) => transact('readwrite', (store) => store.add(entry)).then(() => undefined),
    put: (entry) => transact('readwrite', (store) => store.put(entry)).then(() => undefined),
    putMany: (entries) => transactBatch((store) => {
      for (const entry of entries) store.put(entry);
    }),
    remove: (id) => transact('readwrite', (store) => store.delete(id)).then(() => undefined),
    removeMany: (ids) => transactBatch((store) => {
      for (const id of ids) store.delete(id);
    }),
  };
}
