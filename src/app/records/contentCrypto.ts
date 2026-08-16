/**
 * The record content use case: route a record to a key, then seal or open it.
 *
 * This is the layer `AGENTS.md` §4 asks for between the repository and the
 * crypto: `src/lib/records.ts` calls into here and never touches GLE1, an epoch
 * or a scope key, and nothing here knows about Supabase, React or the store.
 *
 * The whole P5 decision set lives in `decideRecordWrite`:
 *
 *   - no floor for the scope        -> write plaintext, exactly as today
 *   - floor active                  -> write ciphertext, or refuse
 *   - private   -> personal domain, PMK, scope = the author
 *   - shared    -> couple domain,   CSK, scope = the couple
 *   - only an ACTIVE epoch may be written under
 *   - ACTIVE and RETIRED epochs may both be read
 *
 * Refusing is a first-class outcome, not an exception. A client that cannot
 * reach the active epoch after its scope has crossed the write floor MUST NOT
 * fall back to plaintext — that is precisely the downgrade the floor exists to
 * prevent, and the database would refuse it anyway. So the caller gets a typed
 * refusal it can queue or report, and there is no code path from "key
 * unavailable" to "send it in the clear".
 */

import { epochAcceptsWrites, epochAllowsDecrypt, type EpochState, type KeyDomainName } from '@/crypto/domains';
import {
  domainForRecord,
  openRecordContent,
  scopeIdForRecord,
  sealRecordContent,
  type RecordContentDocument,
} from '@/crypto/recordContent';
import { isCoupleProtectionRequired } from '@/app/e2ee/coupleProtectionBarrier';

/** The cipher_format column values, mirroring `crypto/versions.ts`. */
export const RECORD_CIPHER_PLAINTEXT = 0;
export const RECORD_CIPHER_GLE1 = 1;

/** One epoch of one scope, as the routing layer needs it. */
export type ScopeEpoch = {
  domain: KeyDomainName;
  scopeId: string;
  epoch: bigint;
  state: EpochState;
};

/**
 * What the routing layer needs from the outside world.
 *
 * A port rather than a repository import: the write floor and the epoch list are
 * server state, the scope key is device state, and keeping all three behind one
 * narrow interface is what lets every branch below be driven in a test without a
 * database or a keystore.
 */
export type RecordCryptoEnvironment = {
  /**
   * The minimum cipher format for a scope, from `crypto_write_floor`.
   * 0 means no floor. Never inferred from whether ciphertext happens to exist.
   */
  floorFor(domain: KeyDomainName, scopeId: string): Promise<number>;
  /** Every epoch for a scope, including RETIRED ones. */
  epochsFor(domain: KeyDomainName, scopeId: string): Promise<ScopeEpoch[]>;
  /**
   * The usable scope key for one epoch, or null when this device holds no
   * envelope for it. Null is normal — a device enrolled after a rotation may
   * legitimately lack an older epoch — and it must never become plaintext.
   *
   * This is a trust-boundary contract, not a key lookup by caller-supplied
   * labels. A real implementation may return a key only after opening a GLK2
   * envelope whose signed, certificate-verified header matches the requested
   * domain, exact scope id, owner and epoch. Device Bootstrap is responsible
   * for installing only those verified keys. P5 deliberately does not invent a
   * second key-authentication protocol here; an arbitrary self-consistent key
   * supplied by a compromised client is outside what the server can detect and
   * produces ciphertext that the legitimate recipient cannot decrypt.
   */
  scopeKeyFor(domain: KeyDomainName, scopeId: string, epoch: bigint): Promise<CryptoKey | null>;
};

export type RecordRouting = {
  isPrivate: boolean;
  ownerUserId: string;
  coupleId: string;
};

/** Why a write or read could not be performed. Never a reason to use plaintext. */
export type RecordCryptoRefusal =
  /** The scope is past its write floor but no ACTIVE epoch is visible. */
  | 'no_active_epoch'
  /** An ACTIVE epoch exists but this device holds no key for it. */
  | 'key_unavailable'
  /** The row names an epoch this device cannot open (older or rotated away). */
  | 'undecryptable';

/**
 * The subset a READ can produce.
 *
 * `no_active_epoch` is a write-time condition only — opening a row does not care
 * whether the scope currently accepts writes, and a RETIRED epoch is expected to
 * be readable. Stating the narrower type here keeps the caller from having to
 * handle a case that cannot occur.
 */
export type RecordReadRefusal = Exclude<RecordCryptoRefusal, 'no_active_epoch'>;

export type RecordWritePlan =
  | { mode: 'plaintext' }
  | {
    mode: 'gle1';
    cipherFormat: typeof RECORD_CIPHER_GLE1;
    keyDomain: Extract<KeyDomainName, 'personal' | 'couple'>;
    keyEpoch: bigint;
    scopeKey: CryptoKey;
  }
  | { mode: 'refused'; reason: RecordCryptoRefusal };

/**
 * Decide how one record must be written.
 *
 * The floor is read for the record's OWN scope. That matters: a user may have
 * activated their personal floor and not the couple's, or the reverse, and each
 * record follows the scope its visibility routes it to. Reading a single global
 * flag would either encrypt shared content under a scope with no key or leave
 * private content in the clear.
 */
export async function decideRecordWrite(
  environment: RecordCryptoEnvironment,
  routing: RecordRouting,
): Promise<RecordWritePlan> {
  const domain = domainForRecord(routing.isPrivate);
  const scopeId = scopeIdForRecord(routing.isPrivate, routing.ownerUserId, routing.coupleId);

  const serverFloor = await environment.floorFor(domain, scopeId);
  // A connected couple is protection-required before the irreversible server
  // floor is confirmed. This local barrier is exact-scope and account-bound;
  // it does not change the legacy floor=0 contract for genuinely unprotected
  // scopes, and it never supplies a key or substitutes another key domain.
  const localCoupleBarrier = domain === 'couple'
    && isCoupleProtectionRequired(routing.ownerUserId, scopeId);
  const floor = Math.max(serverFloor, localCoupleBarrier ? RECORD_CIPHER_GLE1 : 0);
  if (floor < RECORD_CIPHER_GLE1) return { mode: 'plaintext' };

  const epochs = await environment.epochsFor(domain, scopeId);
  const active = epochs.find((candidate) => epochAcceptsWrites(candidate.state));
  if (!active) return { mode: 'refused', reason: 'no_active_epoch' };

  const scopeKey = await environment.scopeKeyFor(domain, scopeId, active.epoch);
  if (!scopeKey) return { mode: 'refused', reason: 'key_unavailable' };

  return {
    mode: 'gle1',
    cipherFormat: RECORD_CIPHER_GLE1,
    keyDomain: domain,
    keyEpoch: active.epoch,
    scopeKey,
  };
}

export type EncryptedRecordColumns = {
  cipherFormat: number;
  contentRevision: number;
  keyDomain: string;
  keyEpoch: string;
  /** The GLE1 envelope. Base64 at this boundary; the adapter encodes for `bytea`. */
  contentEnvelope: Uint8Array;
};

/**
 * Seal a record and return the columns a row needs.
 *
 * `contentRevision` is a string in the returned columns because it is a 64-bit
 * server-validated counter: a JSON number silently rewrites anything above 2^53,
 * and the same rule already governs every other protocol u64 in this codebase.
 */
export async function encryptRecordForWrite(input: {
  plan: Extract<RecordWritePlan, { mode: 'gle1' }>;
  routing: RecordRouting;
  recordId: string;
  contentRevision: bigint;
  document: RecordContentDocument;
}): Promise<EncryptedRecordColumns> {
  const envelope = await sealRecordContent({
    scopeKey: input.plan.scopeKey,
    document: input.document,
    isPrivate: input.routing.isPrivate,
    recordId: input.recordId,
    ownerUserId: input.routing.ownerUserId,
    coupleId: input.routing.coupleId,
    keyEpoch: input.plan.keyEpoch,
    contentRevision: input.contentRevision,
  });
  return {
    cipherFormat: RECORD_CIPHER_GLE1,
    contentRevision: Number(input.contentRevision),
    keyDomain: input.plan.keyDomain,
    keyEpoch: input.plan.keyEpoch.toString(),
    contentEnvelope: envelope,
  };
}

export type DecryptedRecord =
  | { ok: true; document: RecordContentDocument }
  | { ok: false; reason: RecordReadRefusal };

/**
 * Open one encrypted row.
 *
 * A RETIRED epoch is opened without complaint — historical ciphertext needs its
 * key forever, and `epochAllowsDecrypt` is the single place that rule lives. An
 * ABANDONED epoch is not readable: it belongs to a rotation that never completed
 * and no content should reference it.
 */
export async function decryptRecordRow(
  environment: RecordCryptoEnvironment,
  row: {
    recordId: string;
    isPrivate: boolean;
    ownerUserId: string;
    coupleId: string;
    keyDomain: string;
    keyEpoch: bigint;
    contentRevision: bigint;
    envelope: Uint8Array;
  },
): Promise<DecryptedRecord> {
  const expected = domainForRecord(row.isPrivate);
  // The row's declared domain must match what its visibility implies. The
  // database enforces this on write (032 R7, 039); checking it again on read
  // means a row written before that enforcement, or by a compromised writer,
  // cannot steer this client into using the wrong key.
  if (row.keyDomain !== expected) return { ok: false, reason: 'undecryptable' };

  const scopeId = scopeIdForRecord(row.isPrivate, row.ownerUserId, row.coupleId);
  const epochs = await environment.epochsFor(expected, scopeId);
  const epoch = epochs.find((candidate) => candidate.epoch === row.keyEpoch);
  if (!epoch || !epochAllowsDecrypt(epoch.state)) return { ok: false, reason: 'undecryptable' };

  const scopeKey = await environment.scopeKeyFor(expected, scopeId, row.keyEpoch);
  if (!scopeKey) return { ok: false, reason: 'key_unavailable' };

  try {
    const document = await openRecordContent({
      scopeKey,
      envelope: row.envelope,
      isPrivate: row.isPrivate,
      recordId: row.recordId,
      ownerUserId: row.ownerUserId,
      coupleId: row.coupleId,
      keyEpoch: row.keyEpoch,
      contentRevision: row.contentRevision,
    });
    return { ok: true, document };
  } catch {
    // Authentication failure. This is the honest limit stated in 039: a forged
    // envelope whose header agrees with its routing columns is accepted by the
    // server and fails HERE, because the AAD binds the owner, scope, object and
    // revision that the forger cannot reproduce without the key.
    return { ok: false, reason: 'undecryptable' };
  }
}
