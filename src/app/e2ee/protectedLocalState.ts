import { fromBase64, toBase64, utf8, equalBytes } from '@/crypto/bytes';
import type { LocalKeyPort, LocalKeyBinding } from '@/crypto/keystore';
import type {
  AcceptedEnvelopeRecord,
  E2eeLocalState,
  PendingBootstrap,
  PinnedCoupleAuthority,
  PinnedTrustAnchor,
} from './ports';

const DATABASE = 'gomsinlog-protected-e2ee-state';
const STORE = 'state';
const STATE_VERSION = 1;

type Persisted = {
  bootstrap: PendingBootstrap | null;
  anchors: Record<string, PinnedTrustAnchor>;
  coupleAuthorities: Record<string, PinnedCoupleAuthority>;
  acceptedEnvelopes: Record<string, AcceptedEnvelopeRecord[]>;
};

type StoredCiphertext = { key: string; nonce: Uint8Array; ciphertext: Uint8Array };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStored(key: string): Promise<StoredCiphertext | null> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('protected state read aborted')); };
  }));
}

function writeStored(value: StoredCiphertext): Promise<void> {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('protected state write aborted')); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('protected state write failed')); };
  }));
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, (_key, current) => {
    if (typeof current === 'bigint') return { __bigint: current.toString(10) };
    if (current instanceof Uint8Array) return { __bytes: toBase64(current) };
    return current;
  }));
}

function decode(bytes: Uint8Array): Persisted {
  const parsed = JSON.parse(new TextDecoder().decode(bytes), (_key, current) => {
    if (current && typeof current === 'object' && typeof current.__bigint === 'string') return BigInt(current.__bigint);
    if (current && typeof current === 'object' && typeof current.__bytes === 'string') return fromBase64(current.__bytes);
    return current;
  }) as Persisted;
  return parsed;
}

function emptyState(): Persisted {
  return { bootstrap: null, anchors: {}, coupleAuthorities: {}, acceptedEnvelopes: {} };
}

function sameAnchor(a: PinnedTrustAnchor, b: PinnedTrustAnchor): boolean {
  return a.subjectUserId === b.subjectUserId
    && a.recoveryIdentityId === b.recoveryIdentityId
    && a.recoveryVersion === b.recoveryVersion
    && equalBytes(a.serverOriginId, b.serverOriginId)
    && equalBytes(a.rootRecSigPubFp, b.rootRecSigPubFp)
    && equalBytes(a.rootRecSigSpki, b.rootRecSigSpki)
    && equalBytes(a.recoveryBundleFp, b.recoveryBundleFp);
}

function sameAuthorityIdentity(a: PinnedCoupleAuthority, b: PinnedCoupleAuthority): boolean {
  return a.coupleId === b.coupleId
    && a.lowUserId === b.lowUserId
    && a.highUserId === b.highUserId
    && equalBytes(a.serverOriginId, b.serverOriginId)
    && equalBytes(a.transcriptHash, b.transcriptHash)
    && sameAnchor(a.lowAnchor, b.lowAnchor)
    && sameAnchor(a.highAnchor, b.highAnchor);
}

/**
 * Protected local state: IndexedDB stores only AES-GCM ciphertext, while the
 * native/Web capability owns the key. No Preferences/localStorage/plaintext
 * IndexedDB path is offered. Native capability absence returns null.
 */
export async function createProtectedE2eeLocalState(input: {
  installationId: string;
  userId: string;
  localKeys: LocalKeyPort;
}): Promise<E2eeLocalState | null> {
  if (typeof indexedDB === 'undefined') return null;
  const binding: LocalKeyBinding = {
    installationId: input.installationId,
    userId: input.userId,
    deviceId: 'protected-state',
    purpose: 'protected_state',
    version: 1,
  };
  const capability = await input.localKeys.loadOrCreate(binding);
  if (!capability) return null;
  const protectedCapability = capability;
  const storageKey = `${input.installationId}:${input.userId}:v${STATE_VERSION}`;
  const aad = utf8(`gomsinlog/protected-state/v${STATE_VERSION}|${storageKey}`);

  async function load(): Promise<Persisted> {
    const stored = await readStored(storageKey);
    if (!stored) return emptyState();
    try {
      return decode(await protectedCapability.open({ sealed: { nonce: stored.nonce, ciphertext: stored.ciphertext }, aad }));
    } catch {
      throw new Error('E_PROTECTED_STATE_UNREADABLE');
    }
  }

  async function save(state: Persisted): Promise<void> {
    const sealed = await protectedCapability.seal({ plaintext: encode(state), aad });
    await writeStored({ key: storageKey, nonce: sealed.nonce, ciphertext: sealed.ciphertext });
  }

  return {
    loadBootstrap: async () => (await load()).bootstrap,
    saveBootstrap: async (_userId, pending) => { const state = await load(); state.bootstrap = pending; await save(state); },
    clearBootstrapSecret: async (_userId) => {
      const state = await load();
      if (state.bootstrap) state.bootstrap = { ...state.bootstrap, recoverySecret: null, recoveryCode: null };
      await save(state);
    },
    pinTrustAnchor: async (userId, anchor) => {
      const state = await load();
      const existing = state.anchors[userId];
      if (existing && !sameAnchor(existing, anchor)) throw new Error('E_TRUST_ANCHOR_PINNED');
      if (!existing) state.anchors[userId] = anchor;
      await save(state);
    },
    loadTrustAnchor: async (userId) => (await load()).anchors[userId] ?? null,
    pinCoupleAuthority: async (record) => {
      const state = await load();
      const existing = state.coupleAuthorities[record.coupleId];
      if (existing) {
        if (!sameAuthorityIdentity(existing, record)) throw new Error('E_COUPLE_AUTHORITY_PINNED');
        const allowed = existing.state === record.state
          || (existing.state === 'CONFIRMED' && record.state === 'CRYPTO_ACTIVE')
          || (existing.state !== 'UNLINKED' && record.state === 'UNLINKED');
        if (!allowed) throw new Error('E_COUPLE_AUTHORITY_STATE');
      }
      state.coupleAuthorities[record.coupleId] = record;
      await save(state);
    },
    loadCoupleAuthority: async (coupleId) => (await load()).coupleAuthorities[coupleId] ?? null,
    markCoupleAuthorityCryptoActive: async (coupleId) => {
      const state = await load();
      const existing = state.coupleAuthorities[coupleId];
      if (!existing || existing.state === 'UNLINKED') throw new Error('E_COUPLE_AUTHORITY_STATE');
      if (existing.state === 'CONFIRMED') state.coupleAuthorities[coupleId] = { ...existing, state: 'CRYPTO_ACTIVE' };
      await save(state);
    },
    markCoupleAuthorityUnlinked: async (coupleId) => {
      const state = await load();
      const existing = state.coupleAuthorities[coupleId];
      if (existing && existing.state !== 'UNLINKED') state.coupleAuthorities[coupleId] = { ...existing, state: 'UNLINKED' };
      await save(state);
    },
    recordAcceptedEnvelope: async (record) => {
      const state = await load();
      const list = state.acceptedEnvelopes[record.coupleId] ?? [];
      if (!list.some((item) => item.scopeKeyId === record.scopeKeyId && item.epoch === record.epoch
        && equalBytes(item.envelopeFingerprint, record.envelopeFingerprint))) list.push(record);
      state.acceptedEnvelopes[record.coupleId] = list;
      await save(state);
    },
    listAcceptedEnvelopes: async (coupleId) => (await load()).acceptedEnvelopes[coupleId] ?? [],
  };
}
