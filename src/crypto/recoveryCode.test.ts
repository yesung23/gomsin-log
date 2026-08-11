/**
 * Recovery code encoding.
 *
 * The arithmetic is the point: 32 bytes is 256 bits, 256/5 = 51.2, so the code
 * needs 52 Crockford symbols. An earlier architecture draft specified 25, which
 * encodes 125 bits — these tests exist so that class of mistake cannot return
 * unnoticed.
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKSUM_SYMBOLS,
  GROUP_COUNT,
  RECOVERY_SECRET_BYTES,
  SECRET_SYMBOLS,
  TOTAL_SYMBOLS,
  decodeRecoveryCode,
  deriveKitAnchorTag,
  encodeRecoveryCode,
  formatGroups,
  normalizeSymbols,
} from './recoveryCode';
import { hex, unhex } from './bytes';
import { randomBytes } from './suite';

const SECRET = unhex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

describe('shape', () => {
  it('encodes 256 bits as 52 symbols plus a 4-symbol checksum', async () => {
    expect(RECOVERY_SECRET_BYTES * 8).toBe(256);
    expect(SECRET_SYMBOLS).toBe(52);
    expect(SECRET_SYMBOLS * 5).toBeGreaterThanOrEqual(256);
    expect((SECRET_SYMBOLS - 1) * 5).toBeLessThan(256);
    expect(TOTAL_SYMBOLS).toBe(SECRET_SYMBOLS + CHECKSUM_SYMBOLS);
    expect(GROUP_COUNT).toBe(14);

    const code = await encodeRecoveryCode(SECRET);
    expect(code.split('-')).toHaveLength(14);
    expect(code.replace(/-/g, '')).toHaveLength(56);
  });

  it('never emits a confusable or excluded symbol', async () => {
    for (let i = 0; i < 50; i += 1) {
      const code = await encodeRecoveryCode(randomBytes(32));
      expect(code).not.toMatch(/[ILOU]/);
      expect(code.replace(/-/g, '')).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{56}$/);
    }
  });
});

describe('round-trip', () => {
  it('recovers the exact secret', async () => {
    const code = await encodeRecoveryCode(SECRET);
    expect(hex(await decodeRecoveryCode(code))).toBe(hex(SECRET));
  });

  it('round-trips 200 random secrets', async () => {
    for (let i = 0; i < 200; i += 1) {
      const secret = randomBytes(32);
      expect(hex(await decodeRecoveryCode(await encodeRecoveryCode(secret)))).toBe(hex(secret));
    }
  });

  it('accepts lowercase, missing hyphens and stray whitespace', async () => {
    const code = await encodeRecoveryCode(SECRET);
    const mangled = `  ${code.toLowerCase().replace(/-/g, ' ')} `;
    expect(hex(await decodeRecoveryCode(mangled))).toBe(hex(SECRET));
  });

  it('applies the Crockford confusable mapping', async () => {
    // O reads as 0 and I/L read as 1, so a user who transcribes them by eye
    // still recovers their account.
    const code = await encodeRecoveryCode(SECRET);
    const symbols = code.replace(/-/g, '');
    const withConfusables = symbols.replace(/0/g, 'O').replace(/1/g, 'I');
    expect(hex(await decodeRecoveryCode(withConfusables))).toBe(hex(SECRET));
  });
});

describe('rejection', () => {
  it('rejects U outright rather than mapping it', () => {
    expect(() => normalizeSymbols('AAAU')).toThrow(/E_INVALID_SYMBOL/);
  });

  it('rejects a wrong length', async () => {
    const code = (await encodeRecoveryCode(SECRET)).replace(/-/g, '');
    await expect(decodeRecoveryCode(code.slice(0, 55))).rejects.toThrow(/E_CODE_LENGTH/);
    await expect(decodeRecoveryCode(`${code}A`)).rejects.toThrow(/E_CODE_LENGTH/);
  });

  it('rejects a single-symbol typo via the checksum', async () => {
    const code = (await encodeRecoveryCode(SECRET)).replace(/-/g, '');
    let rejected = 0;
    for (let i = 0; i < SECRET_SYMBOLS; i += 1) {
      const ch = code[i];
      const swapped = ch === '0' ? '2' : '0';
      const typo = code.slice(0, i) + swapped + code.slice(i + 1);
      try {
        await decodeRecoveryCode(typo);
      } catch {
        rejected += 1;
      }
    }
    // Every single-symbol change must be caught; a 20-bit checksum makes a
    // false accept a ~1-in-a-million event, and none occurs on this fixture.
    expect(rejected).toBe(SECRET_SYMBOLS);
  });

  it('rejects non-zero padding bits in the final data symbol', async () => {
    const code = (await encodeRecoveryCode(SECRET)).replace(/-/g, '');
    const body = code.slice(0, SECRET_SYMBOLS);
    const last = body[SECRET_SYMBOLS - 1];
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    // The final symbol carries one data bit and four zero pad bits, so any
    // symbol differing only in the pad bits decodes to the same 32 bytes. Two
    // spellings of one kit would make the kit fingerprint ambiguous.
    const lastValue = alphabet.indexOf(last);
    const withPad = alphabet[lastValue | 0b0_1111];
    if (withPad !== last) {
      const tampered = body.slice(0, -1) + withPad + code.slice(SECRET_SYMBOLS);
      await expect(decodeRecoveryCode(tampered)).rejects.toThrow(/E_BAD_PADDING|E_BAD_CHECKSUM/);
    }
  });

  it('rejects a bad checksum group', async () => {
    const code = (await encodeRecoveryCode(SECRET)).replace(/-/g, '');
    const tampered = `${code.slice(0, TOTAL_SYMBOLS - 1)}${code[TOTAL_SYMBOLS - 1] === 'Z' ? 'Y' : 'Z'}`;
    await expect(decodeRecoveryCode(tampered)).rejects.toThrow(/E_BAD_CHECKSUM/);
  });

  it('rejects a wrong-width secret at encode time', async () => {
    await expect(encodeRecoveryCode(randomBytes(31))).rejects.toThrow(/E_SECRET_WIDTH/);
  });
});

describe('kit anchor tag', () => {
  it('is 12 digits in four groups and is deterministic', async () => {
    const id = randomBytes(16);
    const fp = randomBytes(32);
    const tag = await deriveKitAnchorTag(id, 1, fp);
    expect(tag).toMatch(/^\d{3}-\d{3}-\d{3}-\d{3}$/);
    expect(await deriveKitAnchorTag(id, 1, fp)).toBe(tag);
  });

  it('changes when the identity, generation or bundle changes', async () => {
    const id = randomBytes(16);
    const fp = randomBytes(32);
    const base = await deriveKitAnchorTag(id, 1, fp);
    expect(await deriveKitAnchorTag(id, 2, fp)).not.toBe(base);
    expect(await deriveKitAnchorTag(randomBytes(16), 1, fp)).not.toBe(base);
    expect(await deriveKitAnchorTag(id, 1, randomBytes(32))).not.toBe(base);
  });
});

describe('formatting', () => {
  it('groups in fours', () => {
    expect(formatGroups('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});
