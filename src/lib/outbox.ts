import type { DailyRecord } from '@/types';
import {
  isSealedOutboxRecord,
  openOutboxRecord,
  sealOutboxRecord,
  type SealedOutboxRecord,
  type OutboxLocalKey,
} from '@/lib/outboxCrypto';

/**
 * A queue for writes the network refused, so they are not lost.
 *
 * Bug this exists for: a record written while unreachable was gone. There was no
 * outbox anywhere in the codebase -- `store.tsx` said so about itself: "the 'no
 * queued mutation delivered' claim holds because there is no outbox in this
 * codebase". The composer refused to fire when `navigator.onLine === false`, which
 * covers the honest-offline case, but `navigator.onLine === true` only means the OS
 * sees a link: on a flaky connection the write was attempted, failed, and the typed
 * text was discarded with a toast.
 *
 * Three decisions shape everything here.
 *
 * 1. **The queue holds INTENT, not a half-finished write.** An entry is the same
 *    payload the composer passed to `addRecordWithMedia`, so replay re-invokes that
 *    one function. Nothing about the save/upload pipeline is duplicated, and every
 *    identity and couple-membership guard in it still applies at replay time --
 *    which is correct: if the couple space changed while the entry waited, the
 *    write SHOULD be refused rather than forced through.
 *
 * 2. **A definitive refusal is not retried, and is not thrown away either.** Only
 *    `offline` and `unreachable` mean "the same request could succeed later".
 *    Anything else -- a membership rejection, an expired session, a missing
 *    workspace -- returns the same answer however many times it is sent, so the
 *    entry is marked `blocked` and kept. Retrying it forever would hammer the
 *    server; dropping it would be the silent data loss this module exists to end.
 *
 * 3. **Entries are per account, and never leak across one.** Every read is
 *    filtered by `userId`. Signing out does NOT clear the queue -- the same person
 *    signing back in must still find their unsent record -- so the filter is what
 *    stops account B from replaying account A's writes into B's couple space.
 */

export const OUTBOX_SCHEMA_VERSION = 2;
export const OUTBOX_MEDIA_PLAN_VERSION = 1 as const;

export type QueuedMediaSlot = {
  /** Stable object basename reused after an upload response is lost. */
  objectId: string;
  fileIndex: number;
  byteLength: number;
  mimeType: string;
};

export type QueuedMediaPlan = {
  version: typeof OUTBOX_MEDIA_PLAN_VERSION;
  slots: QueuedMediaSlot[];
};

/**
 * Why a queued write could not be delivered.
 *
 * Deliberately a narrow list rather than `ServerErrorKind`: this module only needs
 * to know retryable from definitive, and stating the two `ServerErrorKind` values
 * that are retryable keeps that decision in one place.
 */
export const RETRYABLE_REASONS = ['offline', 'unreachable'] as const;
export type RetryableReason = (typeof RETRYABLE_REASONS)[number];

export function isRetryableReason(reason: string): reason is RetryableReason {
  return (RETRYABLE_REASONS as readonly string[]).includes(reason);
}

/**
 * How many delivery attempts an entry gets before it stops being retried
 * automatically.
 *
 * High on purpose. Every automatic attempt happens because the device came back
 * online or the tab became visible, so a fortnight in a barracks with no signal
 * costs a handful of attempts, not twenty. The cap is here for a poison entry the
 * server keeps rejecting with a retryable-looking error, which would otherwise
 * retry on every reconnection forever.
 */
export const MAX_DELIVERY_ATTEMPTS = 20;

export type QueuedRecord = {
  /**
   * Stable across retries.
   *
   * This becomes the `daily_records` row id on delivery, so a reply that was
   * actually written but whose response was lost cannot be inserted twice.
   */
  id: string;
  /** The account that queued it. Never replayed for any other. */
  userId: string;
  /** The couple space it was written for, checked again at delivery. */
  coupleId: string;
  queuedAt: string;
  attempts: number;
  /**
   * Set when delivery failed for a reason that retrying cannot change. Kept in the
   * queue so the user can be told, and can retry by hand once the cause is gone.
   */
  blocked?: { reason: string; message: string; at: string };
  /**
   * Preserve the profile post's ordered-media contract across offline replay.
   * Legacy entries omit this and retain the normal partial-media behaviour.
   */
  allOrNothingMedia?: boolean;
  /** Immutable file-to-object mapping; generated and persisted before upload. */
  mediaPlan?: QueuedMediaPlan;
  /**
   * The queued record.
   *
   * Present in the clear only for an entry queued before outbox encryption
   * existed, or on a device with no local cache key. New entries carry
   * `sealedRecord` instead — see `enqueueRecord`.
   */
  record?: Omit<DailyRecord, 'id' | 'createdAt'>;
  /**
   * The record, AES-256-GCM sealed under the device's local cache key.
   *
   * P4 decision 5: offline queued User Content must be ciphertext. Storing the
   * diary text as readable JSON in IndexedDB is the defect the chat contract §8
   * names explicitly, and it is fixed here rather than duplicated into chat.
   */
  sealedRecord?: SealedOutboxRecord;
  files: File[];
};

const OUTBOX_OBJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createQueuedMediaPlan(
  files: File[],
  randomId: () => string = () => crypto.randomUUID(),
): QueuedMediaPlan {
  return {
    version: OUTBOX_MEDIA_PLAN_VERSION,
    slots: files.map((file, fileIndex) => ({
      objectId: randomId(),
      fileIndex,
      byteLength: file.size,
      mimeType: file.type,
    })),
  };
}

export function isValidQueuedMediaPlan(
  plan: QueuedMediaPlan | undefined,
  files: File[],
): plan is QueuedMediaPlan {
  if (!plan || plan.version !== OUTBOX_MEDIA_PLAN_VERSION || plan.slots.length !== files.length) {
    return false;
  }
  const objectIds = new Set<string>();
  return plan.slots.every((slot, index) => {
    const file = files[index];
    if (!file
      || slot.fileIndex !== index
      || !OUTBOX_OBJECT_ID_PATTERN.test(slot.objectId)
      || objectIds.has(slot.objectId)
      || slot.byteLength !== file.size
      || slot.mimeType !== file.type) return false;
    objectIds.add(slot.objectId);
    return true;
  });
}

export type QueuedMediaPlanResult =
  | { kind: 'ready'; entry: QueuedRecord; created: boolean }
  | { kind: 'invalid' };

/** Upgrade a legacy entry before any remote upload; never replace a corrupt plan. */
export async function ensureQueuedMediaPlan(
  persistence: OutboxPersistence,
  entry: QueuedRecord,
  canApply: () => boolean = () => true,
): Promise<QueuedMediaPlanResult> {
  if (entry.files.length === 0) return { kind: 'ready', entry, created: false };
  if (entry.mediaPlan) {
    return isValidQueuedMediaPlan(entry.mediaPlan, entry.files)
      ? { kind: 'ready', entry, created: false }
      : { kind: 'invalid' };
  }
  const upgraded = { ...entry, mediaPlan: createQueuedMediaPlan(entry.files) };
  if (!canApply()) return { kind: 'invalid' };
  await persistence.put(upgraded);
  return { kind: 'ready', entry: upgraded, created: true };
}

/**
 * Where entries live between sessions.
 *
 * A port, not a concrete store, for one reason that matters: entries carry `File`
 * objects. `localStorage` cannot hold a Blob at all, and base64 in a 5 MB quota is
 * unusable for photos, so the real implementation is IndexedDB -- which jsdom does
 * not provide. Keeping persistence behind this interface means the queue's
 * behaviour is tested against an in-memory double, and the IndexedDB adapter stays
 * thin enough to read.
 */
export interface OutboxPersistence {
  all(): Promise<QueuedRecord[]>;
  /** Insert a brand-new queue id. Must reject rather than replace a duplicate. */
  add(entry: QueuedRecord): Promise<void>;
  /** Update an entry already owned by the delivery/retry workflow. */
  put(entry: QueuedRecord): Promise<void>;
  /** Atomically update several already-owned entries in one durable transaction. */
  putMany(entries: QueuedRecord[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Atomically remove several entries in one durable transaction. */
  removeMany(ids: string[]): Promise<void>;
}

/** Entries for one account, oldest first, so a day is replayed in the order written. */
export async function pendingForAccount(
  persistence: OutboxPersistence,
  userId: string,
): Promise<QueuedRecord[]> {
  const all = await persistence.all();
  return all
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/**
 * Probe only for ciphertext already bound to this account.  Runtime setup uses
 * this before creating an LCK: replacing a lost LCK would strand that content.
 */
export async function hasSealedOutboxForAccount(
  persistence: OutboxPersistence,
  userId: string,
): Promise<boolean> {
  return (await persistence.all()).some((entry) => entry.userId === userId && !!entry.sealedRecord);
}

/** The entries a flush should attempt: this account's, not blocked, under the cap. */
export async function deliverableForAccount(
  persistence: OutboxPersistence,
  userId: string,
): Promise<QueuedRecord[]> {
  const pending = await pendingForAccount(persistence, userId);
  return pending.filter((entry) => !entry.blocked && entry.attempts < MAX_DELIVERY_ATTEMPTS);
}

/**
 * What to tell the user: how many are still going to be tried, and how many have
 * stopped being tried automatically.
 *
 * Two separate numbers because they need two different sentences. "보낼 기록 2개" is
 * reassurance; "보내지 못한 기록 1개" is a request for attention, and collapsing them
 * into one count would make the second invisible.
 */
export async function countForAccount(
  persistence: OutboxPersistence,
  userId: string,
): Promise<{ waiting: number; blocked: number }> {
  const pending = await pendingForAccount(persistence, userId);
  const blocked = pending.filter(
    (entry) => entry.blocked || entry.attempts >= MAX_DELIVERY_ATTEMPTS,
  ).length;
  return { waiting: pending.length - blocked, blocked };
}

/**
 * The device's local cache key (LCK), or null where there is none.
 *
 * Injected the same way the record crypto environment is, so the queue has no
 * opinion about the keystore and every branch stays testable. Null means entries
 * are queued in the clear, which is the pre-P5 behaviour. This is a capability
 * boundary, not a claim that the current runtime is protected: Device Bootstrap
 * has not yet installed an LCK, so production currently remains on this legacy
 * branch. Once an LCK is installed, new entries are sealed and the plaintext is
 * dropped before persistence. Refusing to queue before that activation would
 * trade a disk-at-rest exposure for guaranteed data loss, and losing the user's
 * record is the worse outcome. The entry records which it is, so nothing
 * downstream has to guess.
 */
let localCacheKey: OutboxLocalKey | null = null;

export function setOutboxLocalCacheKey(key: OutboxLocalKey | null): void {
  localCacheKey = key;
}

export function getOutboxLocalCacheKey(): OutboxLocalKey | null {
  return localCacheKey;
}

/**
 * Read an entry's record, opening it when it is sealed.
 *
 * Throws when a sealed entry cannot be opened. That is deliberate: a queue entry
 * whose ciphertext fails authentication has been tampered with or the key has
 * changed, and delivering a guessed payload would write the wrong content to the
 * server under a real record id.
 */
export async function readQueuedRecord(
  entry: QueuedRecord,
): Promise<Omit<DailyRecord, 'id' | 'createdAt'>> {
  if (entry.sealedRecord) {
    if (!localCacheKey) {
      throw new Error('Queued record is sealed but no local cache key is available.');
    }
    const opened = await openOutboxRecord({
      localCacheKey,
      entryId: entry.id,
      userId: entry.userId,
      sealed: entry.sealedRecord,
    });
    return opened as Omit<DailyRecord, 'id' | 'createdAt'>;
  }
  if (entry.record) return entry.record;
  throw new Error('Queued record carries neither a sealed nor a plaintext payload.');
}

export async function enqueueRecord(
  persistence: OutboxPersistence,
  entry: Omit<QueuedRecord, 'attempts' | 'queuedAt' | 'sealedRecord'> & { queuedAt?: string },
  canInsert: () => boolean = () => true,
): Promise<QueuedRecord> {
  const queuedAt = entry.queuedAt ?? new Date().toISOString();
  const mediaPlan = entry.files.length > 0 ? createQueuedMediaPlan(entry.files) : undefined;
  let queued: QueuedRecord;

  if (localCacheKey && entry.record) {
    const sealedRecord = await sealOutboxRecord({
      localCacheKey,
      entryId: entry.id,
      userId: entry.userId,
      record: entry.record,
    });
    // The plaintext is dropped from the stored entry, not kept alongside the
    // ciphertext. Keeping both would make the encryption decorative.
    queued = { ...entry, record: undefined, sealedRecord, mediaPlan, queuedAt, attempts: 0 };
    delete queued.record;
  } else {
    queued = { ...entry, mediaPlan, queuedAt, attempts: 0 };
  }

  // Sealing is asynchronous. The caller's cooperative lock still owns the
  // operation, but identity or an out-of-contract writer may have changed the
  // local fence while crypto was running. Re-check before touching IndexedDB.
  if (!canInsert()) throw new Error('Outbox insert authorization changed.');
  await persistence.add(queued);
  return queued;
}

export { isSealedOutboxRecord };

export type DeliveryOutcome =
  | { ok: true }
  | { ok: false; reason: string; message: string };

/**
 * Record what a delivery attempt did to an entry.
 *
 * Returns what happened to the ENTRY, which is not the same as what happened to the
 * request: a retryable failure leaves it queued, a definitive one blocks it, and
 * exhausting the cap blocks it too. Nothing here ever silently discards an entry --
 * only a successful delivery removes one.
 */
export type EntryDisposition = 'delivered' | 'requeued' | 'blocked' | 'preserved';

export async function applyDeliveryOutcome(
  persistence: OutboxPersistence,
  entry: QueuedRecord,
  outcome: DeliveryOutcome,
  canApply: () => boolean = () => true,
  now: () => string = () => new Date().toISOString(),
): Promise<EntryDisposition> {
  // The caller owns the cooperative account lock. This final synchronous guard
  // catches a fence or identity change observed after the remote/decrypt await;
  // preserving the original object is safer than guessing whether an uncertain
  // response committed. It is not a claim of protection from arbitrary writers.
  try {
    if (!canApply()) return 'preserved';
  } catch {
    return 'preserved';
  }

  if (outcome.ok) {
    await persistence.remove(entry.id);
    return 'delivered';
  }

  const attempts = entry.attempts + 1;
  const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS;

  if (isRetryableReason(outcome.reason) && !exhausted) {
    await persistence.put({ ...entry, attempts });
    return 'requeued';
  }

  await persistence.put({
    ...entry,
    attempts,
    blocked: {
      reason: outcome.reason,
      // The cap being reached is a different fact from the last error, and saying
      // the last error alone would misdescribe why it stopped being retried.
      message: exhausted && isRetryableReason(outcome.reason)
        ? '여러 번 보내려 했지만 실패했어요. 다시 시도해 주세요.'
        : outcome.message,
      at: now(),
    },
  });
  return 'blocked';
}

/** Clear a blocked entry's block so the next flush attempts it again. */
export async function unblockEntry(
  persistence: OutboxPersistence,
  entry: QueuedRecord,
): Promise<QueuedRecord> {
  const unblocked: QueuedRecord = { ...entry, attempts: 0 };
  delete unblocked.blocked;
  await persistence.put(unblocked);
  return unblocked;
}

/**
 * Drop an entry at the user's explicit request.
 *
 * Separate from every automatic path on purpose: this module never discards an
 * entry on its own, so the only way a queued record disappears undelivered is
 * someone choosing that.
 */
export async function discardEntry(
  persistence: OutboxPersistence,
  id: string,
): Promise<void> {
  await persistence.remove(id);
}

/** Remove everything belonging to one account, for account deletion. */
export async function purgeAccount(
  persistence: OutboxPersistence,
  userId: string,
): Promise<number> {
  const mine = await pendingForAccount(persistence, userId);
  await persistence.removeMany(mine.map((entry) => entry.id));
  return mine.length;
}
