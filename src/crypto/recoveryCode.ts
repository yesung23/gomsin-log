/**
 * The recovery kit code. Architecture V2.1 section 11.1.
 *
 * 32 random bytes — a full 256 bits — encoded as **52** Crockford Base32
 * symbols, followed by a 4-symbol checksum group. Displayed as 14 groups of 4.
 *
 * The 52 is arithmetic, not taste: 256/5 = 51.2, so 52 symbols are required and
 * the last one carries a single data bit with four zero pad bits. An earlier
 * draft of this architecture said 25 symbols, which encodes 125 bits and would
 * have silently halved the entropy of every recovery kit.
 *
 * The checksum is a typo detector and nothing more. It is unkeyed, so an
 * adversary can forge it trivially; it rejects a mistyped code with probability
 * about 1 - 2^-20 and makes no integrity claim. It is never stored server-side.
 */

import { concat, equalBytes, utf8 } from './bytes';
import { sha256 } from './suite';

export const RECOVERY_SECRET_BYTES = 32;
export const SECRET_SYMBOLS = 52;
export const CHECKSUM_SYMBOLS = 4;
export const CHECKSUM_BITS = 20;
export const TOTAL_SYMBOLS = SECRET_SYMBOLS + CHECKSUM_SYMBOLS;
export const GROUP_SIZE = 4;
export const GROUP_COUNT = TOTAL_SYMBOLS / GROUP_SIZE; // 14

/**
 * The canonical recovery kit: the secret AND the trust anchor it belongs to.
 *
 * V2.1 section 7 requires the kit to be the external trust anchor, carrying the
 * recovery identity, version and bundle fingerprint so that a server serving an
 * older genuine bundle is detected. An optional side-channel cannot do that job:
 * anything a caller may omit is something an attacker may omit, and once it is
 * absent the only remaining authority on which recovery generation is current is
 * the server — which is precisely the rollback this is supposed to prevent.
 *
 * So the anchor is part of the artifact rather than printed beside it. A kit that
 * decodes at all has an anchor, and `verifyKitAnchor` is a total function over
 * what the server offers.
 */
export const KIT_ANCHOR_BYTES = 16 /* recovery identity */
  + 1 /* recovery version */
  + 32 /* recovery bundle fp */
  + 32 /* server origin id */
  + 16 /* user id */;

/** Kit format version, so a future layout is distinguishable rather than ambiguous. */
export const KIT_FORMAT_V1 = 1;

/** Crockford Base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CHECKSUM_LABEL = utf8('gomsinlog/recovery-checksum/v1');
const KIT_ANCHOR_LABEL = utf8('gomsinlog/kit-anchor/v1');
const KIT_BINDING_LABEL = utf8('gomsinlog/kit-binding/v1');

export class RecoveryCodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'RecoveryCodeError';
  }
}

function fail(code: string, message: string): never {
  throw new RecoveryCodeError(code, message);
}

function encodeBase32(bytes: Uint8Array, symbols: number): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
  }
  if (bits > 0) {
    // Remaining data bits sit in the high positions; pad bits are zero.
    out += ALPHABET[(acc << (5 - bits)) & 31];
  }
  if (out.length !== symbols) fail('E_ENCODE_WIDTH', `encoded ${out.length} symbols, expected ${symbols}`);
  return out;
}

/**
 * Normalize user input.
 *
 * Crockford's confusable mapping: I and L read as 1, O reads as 0. U is not in
 * the alphabet at all and is rejected rather than mapped, so a code containing
 * one is a typo and is reported as such.
 */
export function normalizeSymbols(input: string): string {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  let out = '';
  for (const ch of cleaned) {
    if (ch === 'U') fail('E_INVALID_SYMBOL', 'U is not a valid Crockford Base32 symbol');
    const mapped = ch === 'I' || ch === 'L' ? '1' : ch === 'O' ? '0' : ch;
    if (!ALPHABET.includes(mapped)) fail('E_INVALID_SYMBOL', `invalid symbol: ${ch}`);
    out += mapped;
  }
  return out;
}

async function checksumSymbols(secret: Uint8Array): Promise<string> {
  const digest = await sha256(concat(CHECKSUM_LABEL, secret));
  // Top 20 bits of the digest, as four 5-bit symbols.
  const value = ((digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4)) & 0xf_ffff;
  let out = '';
  for (let i = CHECKSUM_SYMBOLS - 1; i >= 0; i -= 1) out += ALPHABET[(value >> (i * 5)) & 31];
  return out;
}

/** Groups of four, hyphen separated: 13 groups of secret plus one of checksum. */
export function formatGroups(symbols: string): string {
  const groups: string[] = [];
  for (let i = 0; i < symbols.length; i += GROUP_SIZE) groups.push(symbols.slice(i, i + GROUP_SIZE));
  return groups.join('-');
}

export async function encodeRecoveryCode(secret: Uint8Array): Promise<string> {
  if (secret.length !== RECOVERY_SECRET_BYTES) {
    fail('E_SECRET_WIDTH', `recovery secret must be ${RECOVERY_SECRET_BYTES} bytes`);
  }
  const body = encodeBase32(secret, SECRET_SYMBOLS);
  const checksum = await checksumSymbols(secret);
  return formatGroups(body + checksum);
}

/**
 * Decode and verify a typed or scanned recovery code.
 *
 * Rejects, in order: bad symbols, wrong length, non-zero padding bits in the
 * final data symbol, and a checksum mismatch. The padding check matters because
 * two different 52-symbol strings could otherwise decode to the same 32 bytes,
 * and a kit that accepts more than one spelling of itself is a kit whose
 * fingerprint cannot be compared.
 */
export async function decodeRecoveryCode(input: string): Promise<Uint8Array> {
  const symbols = normalizeSymbols(input);
  if (symbols.length !== TOTAL_SYMBOLS) {
    fail('E_CODE_LENGTH', `recovery code must be ${TOTAL_SYMBOLS} symbols, saw ${symbols.length}`);
  }
  const body = symbols.slice(0, SECRET_SYMBOLS);
  const checksum = symbols.slice(SECRET_SYMBOLS);

  const secret = new Uint8Array(RECOVERY_SECRET_BYTES);
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of body) {
    acc = (acc << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      secret[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  if (at !== RECOVERY_SECRET_BYTES) fail('E_DECODE_WIDTH', 'recovery code did not decode to 32 bytes');
  if ((acc & ((1 << bits) - 1)) !== 0) fail('E_BAD_PADDING', 'recovery code has non-zero padding bits');

  const expected = await checksumSymbols(secret);
  if (expected !== checksum) fail('E_BAD_CHECKSUM', 'recovery code checksum does not match');
  return secret;
}

/**
 * Everything the user's artifact must independently bind.
 *
 * All six fields are required. There is no partial form and no optional field,
 * because each omission is a substitution an attacker gets for free: drop the
 * origin and a kit works against another deployment; drop the version and a
 * rollback stops being detectable.
 */
export type RecoveryKitAnchor = {
  recoveryIdentityId: Uint8Array;
  recoveryVersion: number;
  recoveryBundleFp: Uint8Array;
  serverOriginId: Uint8Array;
  userId: Uint8Array;
};

export type RecoveryKit = {
  secret: Uint8Array;
  anchor: RecoveryKitAnchor;
};

function assertAnchor(anchor: RecoveryKitAnchor): void {
  if (anchor.recoveryIdentityId.length !== 16) {
    fail('E_FIELD_WIDTH', 'recovery identity id must be 16 bytes');
  }
  if (!Number.isInteger(anchor.recoveryVersion)
    || anchor.recoveryVersion < 1 || anchor.recoveryVersion > 255) {
    fail('E_FIELD_WIDTH', 'recovery version must be a single byte from 1 to 255');
  }
  if (anchor.recoveryBundleFp.length !== 32) {
    fail('E_FIELD_WIDTH', 'recovery bundle fingerprint must be 32 bytes');
  }
  if (anchor.serverOriginId.length !== 32) fail('E_FIELD_WIDTH', 'server origin id must be 32 bytes');
  if (anchor.userId.length !== 16) fail('E_FIELD_WIDTH', 'user id must be 16 bytes');
}

/** The canonical anchor bytes. Fixed width, fixed order, no JSON. */
export function encodeKitAnchor(anchor: RecoveryKitAnchor): Uint8Array {
  assertAnchor(anchor);
  return concat(
    anchor.recoveryIdentityId,
    new Uint8Array([anchor.recoveryVersion]),
    anchor.recoveryBundleFp,
    anchor.serverOriginId,
    anchor.userId,
  );
}

/**
 * The 12-digit tag a human transcribes or compares.
 *
 * Derived over the FULL canonical anchor, so it commits to origin and account as
 * well as to identity, version and bundle. Rejection sampling matches the SAS to
 * avoid modulo bias.
 */
export async function deriveKitAnchorTagV2(anchor: RecoveryKitAnchor): Promise<string> {
  const encoded = encodeKitAnchor(anchor);
  for (let counter = 0; counter < 256; counter += 1) {
    const digest = await sha256(concat(KIT_ANCHOR_LABEL, new Uint8Array([counter]), encoded));
    let value = 0n;
    for (let i = 0; i < 8; i += 1) value = (value << 8n) | BigInt(digest[i]);
    const ceiling = 18_446_744_000_000_000_000n;
    if (value >= ceiling) continue;
    const digits = String(value % 1_000_000_000_000n).padStart(12, '0');
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  fail('E_SAMPLING', 'anchor tag rejection sampling failed to terminate');
}

/**
 * Bind a secret to exactly one anchor.
 *
 * This is what makes "valid secret paired with the wrong anchor" detectable. The
 * binding is a hash, not a MAC under a separate key, and it makes no
 * confidentiality claim: its job is to ensure the two halves of a kit cannot be
 * recombined across accounts, deployments or recovery generations.
 */
export async function deriveKitBinding(
  secret: Uint8Array,
  anchor: RecoveryKitAnchor,
): Promise<Uint8Array> {
  if (secret.length !== RECOVERY_SECRET_BYTES) {
    fail('E_SECRET_WIDTH', `recovery secret must be ${RECOVERY_SECRET_BYTES} bytes`);
  }
  return sha256(concat(KIT_BINDING_LABEL, new Uint8Array([KIT_FORMAT_V1]), secret, encodeKitAnchor(anchor)));
}

/**
 * What the server offers, checked against what the user holds.
 *
 * Every field is compared. `verifyKitAnchor` is the single gate the recovery
 * path calls, so there is no route through recovery that skips one: an older but
 * cryptographically valid bundle differs in version and fingerprint and is
 * rejected here, before any AEAD is attempted.
 */
export async function verifyKitAnchor(
  kit: RecoveryKit,
  served: RecoveryKitAnchor,
): Promise<void> {
  assertAnchor(kit.anchor);
  assertAnchor(served);

  if (!equalBytes(kit.anchor.userId, served.userId)) {
    fail('E_KIT_ACCOUNT_MISMATCH', 'this kit belongs to a different account');
  }
  if (!equalBytes(kit.anchor.serverOriginId, served.serverOriginId)) {
    fail('E_KIT_ORIGIN_MISMATCH', 'this kit belongs to a different deployment');
  }
  if (!equalBytes(kit.anchor.recoveryIdentityId, served.recoveryIdentityId)) {
    fail('E_KIT_IDENTITY_MISMATCH', 'the served recovery identity is not the one this kit names');
  }
  if (kit.anchor.recoveryVersion !== served.recoveryVersion) {
    // Strictly a mismatch rather than "older": a server offering a NEWER
    // generation than the kit is equally unusable, and treating it as an upgrade
    // would let a server retire a kit the user still holds.
    fail(
      'E_KIT_VERSION_MISMATCH',
      `this kit names recovery generation ${kit.anchor.recoveryVersion}, the server offered ${served.recoveryVersion}`,
    );
  }
  if (!equalBytes(kit.anchor.recoveryBundleFp, served.recoveryBundleFp)) {
    fail('E_KIT_BUNDLE_MISMATCH', 'the served recovery bundle is not the one this kit names');
  }
}

/**
 * The 12-digit anchor tag printed alongside a manually typed code.
 *
 * Binds the identity, generation and bundle fingerprint so a server that serves
 * an older genuine recovery bundle is detected even when the user's kit could
 * technically decrypt it. Derived with the same rejection-sampling procedure as
 * the SAS to avoid modulo bias.
 */
export async function deriveKitAnchorTag(
  recoveryIdentityId: Uint8Array,
  recoveryVersion: number,
  recoveryBundleFp: Uint8Array,
): Promise<string> {
  if (recoveryIdentityId.length !== 16) fail('E_FIELD_WIDTH', 'recovery identity id must be 16 bytes');
  if (recoveryBundleFp.length !== 32) fail('E_FIELD_WIDTH', 'recovery bundle fingerprint must be 32 bytes');
  const labelBytes = utf8('gomsinlog/kit-anchor/v1');
  for (let counter = 0; counter < 256; counter += 1) {
    const digest = await sha256(
      concat(labelBytes, new Uint8Array([counter]), recoveryIdentityId,
        new Uint8Array([recoveryVersion]), recoveryBundleFp),
    );
    let value = 0n;
    for (let i = 0; i < 8; i += 1) value = (value << 8n) | BigInt(digest[i]);
    const ceiling = 18_446_744_000_000_000_000n; // largest multiple of 10^12 below 2^64
    if (value >= ceiling) continue;
    const reduced = value % 1_000_000_000_000n;
    const digits = String(reduced).padStart(12, '0');
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  fail('E_SAMPLING', 'anchor tag rejection sampling failed to terminate');
}
