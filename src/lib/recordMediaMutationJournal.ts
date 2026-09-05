import type { RecordMediaMutationIdentity } from '@/lib/records';

const JOURNAL_PREFIX = 'gomsin.record-media-operation.v1.';
const OWNER_TOKEN_KEY = 'gomsin.record-media-operation.owner.v1';

type JournalStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export type RecordMediaMutationJournalEntry = RecordMediaMutationIdentity & {
  version: 1;
  /** Per-tab token. It lets a refreshed tab recover its own interrupted work. */
  ownerToken: string;
  createdAtMs: number;
};

function journalKey(userId: string, operationId: string): string {
  return `${JOURNAL_PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(operationId)}`;
}

function validIdentity(value: RecordMediaMutationIdentity): boolean {
  return Boolean(value.operationId && value.recordId && value.userId && value.coupleId);
}

export function getOrCreateRecordMediaMutationOwnerToken(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage,
  createToken: () => string = () => crypto.randomUUID(),
): string | null {
  try {
    const existing = storage.getItem(OWNER_TOKEN_KEY);
    if (existing) return existing;
    const created = createToken();
    if (!created) return null;
    storage.setItem(OWNER_TOKEN_KEY, created);
    return storage.getItem(OWNER_TOKEN_KEY) === created ? created : null;
  } catch {
    return null;
  }
}

function parseEntry(raw: string | null): RecordMediaMutationJournalEntry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecordMediaMutationJournalEntry>;
    if (
      value.version !== 1
      || typeof value.operationId !== 'string'
      || typeof value.recordId !== 'string'
      || typeof value.userId !== 'string'
      || typeof value.coupleId !== 'string'
      || typeof value.ownerToken !== 'string'
      || !value.ownerToken
      || typeof value.createdAtMs !== 'number'
      || !Number.isSafeInteger(value.createdAtMs)
      || value.createdAtMs < 0
      || !validIdentity(value as RecordMediaMutationIdentity)
    ) return null;
    return value as RecordMediaMutationJournalEntry;
  } catch {
    return null;
  }
}

/**
 * Persist the opaque server-operation identity before the begin RPC. No record
 * text, file name, path, blob, or encryption material is stored here.
 */
export function writeRecordMediaMutationJournalEntry(
  identity: RecordMediaMutationIdentity,
  ownerToken: string,
  storage: JournalStorage = window.localStorage,
  createdAtMs = Date.now(),
): boolean {
  if (!validIdentity(identity) || !ownerToken || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    return false;
  }
  const entry: RecordMediaMutationJournalEntry = {
    version: 1,
    operationId: identity.operationId,
    recordId: identity.recordId,
    userId: identity.userId,
    coupleId: identity.coupleId,
    ownerToken,
    createdAtMs,
  };
  const key = journalKey(identity.userId, identity.operationId);
  const serialized = JSON.stringify(entry);
  try {
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

export function listRecordMediaMutationJournalEntries(
  userId: string,
  ownerToken: string,
  storage: JournalStorage = window.localStorage,
): RecordMediaMutationJournalEntry[] {
  if (!userId || !ownerToken) return [];
  const entries: RecordMediaMutationJournalEntry[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(JOURNAL_PREFIX)) continue;
      const entry = parseEntry(storage.getItem(key));
      if (
        !entry
        || entry.userId !== userId
        || entry.ownerToken !== ownerToken
        || key !== journalKey(entry.userId, entry.operationId)
      ) continue;
      entries.push(entry);
    }
  } catch {
    return [];
  }
  return entries.sort((left, right) => left.createdAtMs - right.createdAtMs);
}

export function clearRecordMediaMutationJournalEntry(
  identity: RecordMediaMutationIdentity,
  storage: JournalStorage = window.localStorage,
): boolean {
  if (!validIdentity(identity)) return false;
  const key = journalKey(identity.userId, identity.operationId);
  try {
    const stored = parseEntry(storage.getItem(key));
    if (
      !stored
      || stored.recordId !== identity.recordId
      || stored.coupleId !== identity.coupleId
      || stored.userId !== identity.userId
      || stored.operationId !== identity.operationId
    ) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

export function purgeRecordMediaMutationJournalForUser(
  userId: string,
  storage: JournalStorage = window.localStorage,
): boolean {
  if (!userId) return false;
  try {
    const keys: string[] = [];
    const accountPrefix = `${JOURNAL_PREFIX}${encodeURIComponent(userId)}.`;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(accountPrefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys.every((key) => storage.getItem(key) === null);
  } catch {
    return false;
  }
}
