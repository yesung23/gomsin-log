import { aesGcmOpen, aesGcmSeal, randomNonce } from '@/crypto/suite';
import type { LocalKeyBinding, LocalKeyCapability, LocalKeyPort } from './LocalKeyPort';

const DB = 'gomsinlog-local-capabilities';
const STORE = 'lck';

type Stored = { alias: string; binding: LocalKeyBinding; key: CryptoKey };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'alias' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function alias(binding: LocalKeyBinding): string {
  return `${binding.installationId}:${binding.userId}:${binding.deviceId}:${binding.purpose}:v${binding.version}`;
}

function read<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('local key transaction aborted')); };
  }));
}

async function get(binding: LocalKeyBinding): Promise<Stored | null> {
  return (await read<Stored | undefined>('readonly', (store) => store.get(alias(binding)))) ?? null;
}

export function isWebLocalKeyPortAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

export function createWebLocalKeyPort(): LocalKeyPort {
  return {
    async load(binding) {
      const keyAlias = alias(binding);
      const stored = await get(binding);
      if (!stored) return null;
      const key = stored.key;
      return {
        binding: stored.binding,
        has: async () => !!(await get(binding)),
        seal: async ({ plaintext, aad }) => {
          const nonce = randomNonce();
          const ciphertext = new Uint8Array(await aesGcmSeal(key, nonce, plaintext, aad));
          return { nonce, ciphertext };
        },
        open: async ({ sealed, aad }) => new Uint8Array(await aesGcmOpen(key, sealed.nonce, sealed.ciphertext, aad)),
        delete: async () => { await read('readwrite', (store) => store.delete(keyAlias)); },
      } satisfies LocalKeyCapability;
    },
    async loadOrCreate(binding) {
      const existing = await this.load(binding);
      if (existing) return existing;
      const keyAlias = alias(binding);
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await read('readwrite', (store) => store.put({ alias: keyAlias, binding, key } satisfies Stored));
      return this.load(binding);
    },
  };
}
