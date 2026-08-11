/**
 * Signed device revocation and the per-user hash-chained revocation log.
 *
 * A revocation statement is signed, so a malicious server cannot forge one. It
 * can still *withhold* a statement a client has never seen — that is an honest
 * limitation of this design and is not claimed away. What the hash chain does
 * close is deletion and reordering behind a head a client has already pinned: a
 * device refuses any head that is not a forward extension of its pinned head,
 * so entries cannot be quietly removed from history.
 */

import { concat, equalBytes, u64be, readU64be } from './bytes';
import { REVOCATION_REASON, canEscalateReason, type RevocationReasonName } from './domains';
import { ecdsaVerify, label, sha256 } from './suite';
import { PROTOCOL_ID, REVOCATION_VERSION } from './versions';
import { P1363_LENGTH } from './ecdsaFormat';

/**
 * 22 label + 1 version + 1 protocol + 1 reserved + 16 user + 32 origin
 * + 16 recovery identity + 1 recovery version + 16 device + 32 fingerprint
 * + 1 reason + 8 revokedAt + 16 revoker + 8 issuedAt + 32 nonce.
 */
export const REVOCATION_TBS_LENGTH = 203;

const LABEL_TBS = label('gomsinlog/devrevoke/v1');
const LABEL_SIG = label('gomsinlog/devrevoke-sig/v1');
const LABEL_LOG = label('gomsinlog/revlog/v1');

export class RevocationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'RevocationError';
  }
}

function fail(code: string, message: string): never {
  throw new RevocationError(code, message);
}

export type RevocationStatement = {
  userId: Uint8Array;
  serverOriginId: Uint8Array;
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  revokedDeviceId: Uint8Array;
  revokedSubjectSigPubFp: Uint8Array;
  reason: RevocationReasonName;
  revokedAtMs: bigint;
  revokerDeviceId: Uint8Array;
  issuedAtMs: bigint;
  serverNonce: Uint8Array;
};

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

/** Canonical fixed-width body. Offsets are stable; do not reorder. */
export function encodeRevocationTbs(statement: RevocationStatement): Uint8Array {
  const out = new Uint8Array(REVOCATION_TBS_LENGTH);
  let at = 0;
  const put = (bytes: Uint8Array) => { out.set(bytes, at); at += bytes.length; };
  put(LABEL_TBS); // 22
  out[at] = REVOCATION_VERSION; at += 1;
  out[at] = PROTOCOL_ID; at += 1;
  out[at] = 0; at += 1; // reserved
  put(fixed('userId', statement.userId, 16));
  put(fixed('serverOriginId', statement.serverOriginId, 32));
  put(fixed('recoveryIdentityId', statement.recoveryIdentityId, 16));
  out[at] = statement.recoveryVersion; at += 1;
  put(fixed('revokedDeviceId', statement.revokedDeviceId, 16));
  put(fixed('revokedSubjectSigPubFp', statement.revokedSubjectSigPubFp, 32));
  out[at] = REVOCATION_REASON[statement.reason]; at += 1;
  put(u64be(statement.revokedAtMs));
  put(fixed('revokerDeviceId', statement.revokerDeviceId, 16));
  put(u64be(statement.issuedAtMs));
  put(fixed('serverNonce', statement.serverNonce, 32));
  if (at !== REVOCATION_TBS_LENGTH) {
    fail('E_TBS_LENGTH', `encoded ${at} bytes, expected ${REVOCATION_TBS_LENGTH}`);
  }
  return out;
}

export function decodeRevocationTbs(tbs: Uint8Array): RevocationStatement {
  if (tbs.length !== REVOCATION_TBS_LENGTH) fail('E_TBS_LENGTH', 'bad revocation body length');
  if (!equalBytes(tbs.subarray(0, LABEL_TBS.length), LABEL_TBS)) fail('E_BAD_LABEL', 'not a revocation statement');
  let at = LABEL_TBS.length;
  const version = tbs[at]; at += 1;
  if (version !== REVOCATION_VERSION) fail('E_BAD_VERSION', 'unsupported revocation version');
  if (tbs[at] !== PROTOCOL_ID) fail('E_BAD_PROTOCOL', 'unsupported protocol id');
  at += 1;
  if (tbs[at] !== 0) fail('E_RESERVED_NONZERO', 'reserved byte must be zero');
  at += 1;
  const take = (n: number) => { const v = tbs.slice(at, at + n); at += n; return v; };
  const userId = take(16);
  const serverOriginId = take(32);
  const recoveryIdentityId = take(16);
  const recoveryVersion = tbs[at]; at += 1;
  const revokedDeviceId = take(16);
  const revokedSubjectSigPubFp = take(32);
  const reasonCode = tbs[at]; at += 1;
  const reason = (Object.keys(REVOCATION_REASON) as RevocationReasonName[])
    .find((name) => REVOCATION_REASON[name] === reasonCode);
  if (!reason) fail('E_BAD_REASON', `unknown revocation reason ${reasonCode}`);
  const revokedAtMs = readU64be(tbs, at); at += 8;
  const revokerDeviceId = take(16);
  const issuedAtMs = readU64be(tbs, at); at += 8;
  const serverNonce = take(32);
  return {
    userId, serverOriginId, recoveryIdentityId, recoveryVersion,
    revokedDeviceId, revokedSubjectSigPubFp, reason,
    revokedAtMs, revokerDeviceId, issuedAtMs, serverNonce,
  };
}

export function revocationSignedMessage(tbs: Uint8Array): Uint8Array {
  return concat(LABEL_SIG, tbs);
}

export async function verifyRevocationStatement(
  tbs: Uint8Array,
  signature: Uint8Array,
  revokerSigSpki: Uint8Array,
): Promise<RevocationStatement> {
  if (signature.length !== P1363_LENGTH) fail('E_BAD_SIGNATURE_LENGTH', 'signature must be 64 bytes');
  const statement = decodeRevocationTbs(tbs);
  const ok = await ecdsaVerify(revokerSigSpki, revocationSignedMessage(tbs), signature);
  if (!ok) fail('E_BAD_SIGNATURE', 'revocation signature did not verify');
  return statement;
}

// --- hash-chained log -------------------------------------------------------

export async function revocationLogGenesis(
  userId: Uint8Array,
  recoveryIdentityId: Uint8Array,
): Promise<Uint8Array> {
  return sha256(concat(LABEL_LOG, userId, recoveryIdentityId));
}

export async function revocationLogAppend(head: Uint8Array, statementTbs: Uint8Array): Promise<Uint8Array> {
  if (head.length !== 32) fail('E_BAD_HEAD', 'log head must be 32 bytes');
  return sha256(concat(LABEL_LOG, head, statementTbs));
}

/**
 * Replay entries from a pinned head and confirm the server's head follows.
 *
 * This is what stops a server from rewriting history behind a client: it must
 * present entries that hash forward from the head the client already saw, so
 * removing or reordering an earlier entry cannot produce a matching head.
 */
export async function verifyLogExtension(
  pinnedHead: Uint8Array,
  entriesTbs: Uint8Array[],
  claimedHead: Uint8Array,
): Promise<Uint8Array> {
  let head = pinnedHead;
  for (const entry of entriesTbs) head = await revocationLogAppend(head, entry);
  if (!equalBytes(head, claimedHead)) {
    fail('E_LOG_FORK', 'revocation log head is not a forward extension of the pinned head');
  }
  return head;
}

/**
 * A device's monotone view of revocations.
 *
 * Never forgets: once a statement is seen it stays, so a server withholding it
 * later cannot restore the device's eligibility.
 */
export class RevocationSet {
  private readonly byDevice = new Map<string, { revokedAtMs: bigint; reason: RevocationReasonName }>();

  add(statement: RevocationStatement): void {
    const key = hexKey(statement.revokedDeviceId);
    const existing = this.byDevice.get(key);
    if (!existing) {
      this.byDevice.set(key, { revokedAtMs: statement.revokedAtMs, reason: statement.reason });
      return;
    }
    // Severity may only escalate, and the earliest revocation time wins so a
    // later restatement cannot narrow the window.
    if (canEscalateReason(existing.reason, statement.reason)) {
      this.byDevice.set(key, {
        revokedAtMs: statement.revokedAtMs < existing.revokedAtMs ? statement.revokedAtMs : existing.revokedAtMs,
        reason: statement.reason,
      });
    } else if (statement.revokedAtMs < existing.revokedAtMs) {
      this.byDevice.set(key, { revokedAtMs: statement.revokedAtMs, reason: existing.reason });
    }
  }

  lookup(deviceId: Uint8Array): { revokedAtMs: bigint; reason: RevocationReasonName } | null {
    return this.byDevice.get(hexKey(deviceId)) ?? null;
  }

  /** Shaped for `verifyCertificateChain`'s `isRevoked`. */
  asLookup(): (deviceId: Uint8Array) => { revokedAtMs: bigint } | null {
    return (deviceId) => this.lookup(deviceId);
  }

  get size(): number {
    return this.byDevice.size;
  }
}

function hexKey(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
