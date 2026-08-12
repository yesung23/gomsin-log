/**
 * The signed partner acknowledgement for a future Phase 1F migration.
 *
 * Phase 1A defines the transcript; no migration runs here.
 *
 * Note what is absent: there is no hash of plaintext anywhere in this file, and
 * none is ever persisted. An unkeyed digest of a low-cardinality health field —
 * `flow`, `pain_level`, `mood` — is a dictionary-attackable oracle for anyone
 * holding the database, and it bought nothing: the database validates that
 * `content_revision` increments on every update, so equality of revision
 * between acknowledgement and deletion already proves the row is unchanged.
 */

import { concat, u64be, utf8 } from './bytes';
import { KEY_DOMAIN, type KeyDomainCode } from './domains';
import { sha256 } from './suite';
import { MIGRATION_ACK_VERSION, PROTOCOL_ID, SUITE_ID } from './versions';

export const MIGRATION_ACK_TBS_LENGTH = 176;

const LABEL = utf8('gomsinlog/migrate-ack/v1');
const SIG_LABEL = utf8('gomsinlog/migrate-ack-sig/v1');

export class MigrationAckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'MigrationAckError';
  }
}

function fail(code: string, message: string): never {
  throw new MigrationAckError(code, message);
}

function fixed(name: string, value: Uint8Array, width: number): Uint8Array {
  if (value.length !== width) fail('E_FIELD_WIDTH', `${name} must be ${width} bytes, saw ${value.length}`);
  return value;
}

export type MigrationAck = {
  serverOriginId: Uint8Array;
  coupleId: Uint8Array;
  objectType: number;
  objectId: Uint8Array;
  sourceRevision: bigint;
  ciphertextHash: Uint8Array;
  keyDomain: KeyDomainCode;
  keyEpoch: bigint;
  membershipRevision: bigint;
  acknowledgingDeviceId: Uint8Array;
  acknowledgedAtMs: bigint;
};

export function encodeMigrationAckTbs(ack: MigrationAck): Uint8Array {
  if (ack.sourceRevision <= 0n) fail('E_BAD_REVISION', 'source revision starts at 1');
  if (!Object.values(KEY_DOMAIN).includes(ack.keyDomain)) fail('E_BAD_DOMAIN', 'unknown key domain');
  if (ack.objectType <= 0 || ack.objectType > 255) fail('E_BAD_OBJECT_TYPE', 'object type out of range');

  const labelBlock = new Uint8Array(24);
  labelBlock.set(LABEL.subarray(0, 24), 0);

  const out = concat(
    labelBlock,
    new Uint8Array([PROTOCOL_ID, MIGRATION_ACK_VERSION, SUITE_ID, 0]),
    fixed('serverOriginId', ack.serverOriginId, 32),
    fixed('coupleId', ack.coupleId, 16),
    new Uint8Array([ack.objectType]),
    fixed('objectId', ack.objectId, 16),
    u64be(ack.sourceRevision),
    fixed('ciphertextHash', ack.ciphertextHash, 32),
    new Uint8Array([ack.keyDomain]),
    u64be(ack.keyEpoch),
    u64be(ack.membershipRevision),
    fixed('acknowledgingDeviceId', ack.acknowledgingDeviceId, 16),
    u64be(ack.acknowledgedAtMs),
  );
  if (out.length !== MIGRATION_ACK_TBS_LENGTH) {
    fail('E_TBS_LENGTH', `encoded ${out.length} bytes, expected ${MIGRATION_ACK_TBS_LENGTH}`);
  }
  return out;
}

export function migrationAckSignedMessage(tbs: Uint8Array): Uint8Array {
  return concat(SIG_LABEL, tbs);
}

export async function migrationAckFingerprint(tbs: Uint8Array): Promise<Uint8Array> {
  return sha256(tbs);
}
