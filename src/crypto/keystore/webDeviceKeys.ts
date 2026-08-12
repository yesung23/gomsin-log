/**
 * Web implementation of the device key port.
 *
 * Keys are non-extractable `CryptoKey` objects held in IndexedDB. Phase 1A-1
 * measured all of the following in a real browser rather than assuming it:
 *
 *   - the key survives reload and restart, and is still usable afterwards;
 *   - `exportKey` is refused for pkcs8, jwk and raw, with `InvalidAccessError`;
 *   - clearing site data destroys the key irrecoverably;
 *   - **same-origin script can still USE the key it cannot export.**
 *
 * That last point is why `ASSURANCE.webNonExtractable` is the weakest class and
 * why health access is off by default on web. Non-extractability stops
 * exfiltration of the key; it does not stop injected script from signing and
 * deriving with it, and therefore is not XSS protection. The mitigation is CSP
 * and dependency hygiene, not this file.
 */

import { ASSURANCE, type Assurance } from '../domains';
import { normalizeSharedSecret, assertValidSpki, importPublicKey, SHARED_SECRET_BYTES } from '../suite';
import { decodeP1363 } from '../ecdsaFormat';
import {
  type DeviceKeyPort,
  type GeneratedKey,
  type KeyHandle,
  type KeyPolicy,
  deviceKeyFail,
} from './DeviceKeyPort';

const DATABASE_NAME = 'gomsinlog-device-keys';
const STORE_NAME = 'keys';
const DATABASE_VERSION = 1;

type StoredKey = {
  alias: string;
  kind: 'ECDSA' | 'ECDH';
  privateKey: CryptoKey;
  publicKeySpki: ArrayBuffer;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'alias' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (database) => new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      // Resolve on commit, not on request success: a queued write is not durable
      // until the transaction completes, and a device key that silently failed
      // to persist would strand the account on the next launch.
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      };
    }),
  );
}

export function isWebDeviceKeyStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
}

async function generate(
  alias: string,
  kind: 'ECDSA' | 'ECDH',
  _policy?: KeyPolicy,
): Promise<GeneratedKey> {
  if (!alias) deviceKeyFail('E_BAD_ALIAS', 'alias must be a non-empty string');
  if (await hasKeyInternal(alias)) deviceKeyFail('E_ALIAS_EXISTS', `a key already exists for alias ${alias}`);

  // `extractable: false` is the whole point: the private half can never be read
  // back, by this code or by injected script.
  const pair = await crypto.subtle.generateKey(
    { name: kind, namedCurve: 'P-256' },
    false,
    kind === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'],
  ) as CryptoKeyPair;

  const publicKeySpki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const record: StoredKey = { alias, kind, privateKey: pair.privateKey, publicKeySpki };
  await transact('readwrite', (store) => store.put(record));

  return {
    handle: alias,
    publicKeySpki: new Uint8Array(publicKeySpki),
    assurance: ASSURANCE.webNonExtractable,
  };
}

async function load(handle: KeyHandle): Promise<StoredKey> {
  const record = await transact<StoredKey | undefined>('readonly', (store) => store.get(handle));
  // Fail closed: a deleted or unknown handle must never fall through to a
  // freshly generated key, which would silently orphan every existing envelope.
  if (!record) deviceKeyFail('E_NO_SUCH_HANDLE', `no key for handle ${handle}`);
  return record;
}

async function hasKeyInternal(alias: string): Promise<boolean> {
  const record = await transact<StoredKey | undefined>('readonly', (store) => store.get(alias));
  return !!record;
}

export function createWebDeviceKeyPort(): DeviceKeyPort {
  return {
    generateSigningKey: (alias, policy) => generate(alias, 'ECDSA', policy),
    generateAgreementKey: (alias, policy) => generate(alias, 'ECDH', policy),

    async getPublicKey(handle) {
      const record = await load(handle);
      return new Uint8Array(record.publicKeySpki);
    },

    async sign(handle, message) {
      const record = await load(handle);
      if (record.kind !== 'ECDSA') deviceKeyFail('E_WRONG_KEY_KIND', 'handle is not a signing key');
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        record.privateKey,
        message as BufferSource,
      );
      // WebCrypto emits P-1363 by specification, so this validates rather than
      // converts. Running it through the strict decoder anyway means a malformed
      // signature is caught here rather than at some verifier later.
      const p1363 = new Uint8Array(signature);
      decodeP1363(p1363);
      return p1363;
    },

    async deriveSecret(handle, peerPublicKeySpki) {
      const record = await load(handle);
      if (record.kind !== 'ECDH') deviceKeyFail('E_WRONG_KEY_KIND', 'handle is not an agreement key');
      assertValidSpki(peerPublicKeySpki);
      const peer = await importPublicKey(peerPublicKeySpki, 'ECDH');
      const bits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peer },
        record.privateKey,
        SHARED_SECRET_BYTES * 8,
      );
      return normalizeSharedSecret(new Uint8Array(bits));
    },

    async deleteKey(handle) {
      await transact('readwrite', (store) => store.delete(handle));
    },

    async getAssurance(handle) {
      await load(handle);
      // Never claim hardware backing here. The browser offers none.
      return ASSURANCE.webNonExtractable satisfies Assurance;
    },

    hasKey: hasKeyInternal,
  };
}
