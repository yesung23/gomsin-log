/**
 * Byte helpers and 64-bit protocol integers.
 *
 * The BigInt tests encode a measured platform fact rather than a preference:
 * Phase 1A-1 ran `9223372036854775807` through the real Postgres-to-JSON path
 * and got `9223372036854776000` back, silently. Any 64-bit protocol value that
 * passes through a JavaScript `Number` is corrupt above 2^53, so these guards
 * are what keep `key_epoch` and `content_revision` trustworthy.
 */

import { describe, expect, it } from 'vitest';
import {
  I64_MAX,
  U64_MAX,
  bytesToUuid,
  concat,
  equalBytes,
  fromBase64,
  hex,
  leftPad,
  parseProtocolU64,
  readU64be,
  toBase64,
  u64be,
  unhex,
  utf8,
  uuidToBytes,
  zeroize,
} from './bytes';

describe('hex and base64', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(hex(bytes)).toBe('00017f80ff');
    expect(hex(unhex('00017f80ff'))).toBe(hex(bytes));
    expect(hex(fromBase64(toBase64(bytes)))).toBe(hex(bytes));
  });

  it('round-trips every length up to 64 bytes, including padding cases', () => {
    for (let n = 0; n <= 64; n += 1) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 0xff);
      expect(hex(fromBase64(toBase64(bytes)))).toBe(hex(bytes));
    }
  });

  it('rejects malformed input', () => {
    expect(() => unhex('abc')).toThrow(/odd length/);
    expect(() => unhex('zz')).toThrow(/non-hex/);
    expect(() => fromBase64('!!!!')).toThrow(/not base64/);
  });
});

describe('constant-time comparison', () => {
  it('compares content, not identity', () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(equalBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe('padding and concatenation', () => {
  it('left-pads and refuses to truncate', () => {
    expect(hex(leftPad(new Uint8Array([0xff]), 4))).toBe('000000ff');
    expect(hex(leftPad(new Uint8Array([1, 2]), 2))).toBe('0102');
    expect(() => leftPad(new Uint8Array([1, 2, 3]), 2)).toThrow(/wider than/);
  });

  it('concatenates in order', () => {
    expect(hex(concat(new Uint8Array([1]), new Uint8Array([2, 3]), new Uint8Array(0)))).toBe('010203');
  });
});

describe('64-bit protocol integers', () => {
  it('round-trips the boundaries big-endian', () => {
    for (const value of [0n, 1n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, I64_MAX, U64_MAX]) {
      const encoded = u64be(value);
      expect(encoded.length).toBe(8);
      expect(readU64be(encoded, 0)).toBe(value);
    }
    expect(hex(u64be(1n))).toBe('0000000000000001');
    expect(hex(u64be(I64_MAX))).toBe('7fffffffffffffff');
  });

  it('refuses a JavaScript number outright', () => {
    // @ts-expect-error deliberate misuse
    expect(() => u64be(1)).toThrow(TypeError);
  });

  it('fails closed outside range', () => {
    expect(() => u64be(-1n)).toThrow(RangeError);
    expect(() => u64be(U64_MAX + 1n)).toThrow(RangeError);
    expect(() => readU64be(new Uint8Array(4), 0)).toThrow(RangeError);
    expect(() => readU64be(new Uint8Array(8), 1)).toThrow(RangeError);
  });

  describe('parseProtocolU64', () => {
    it('accepts a decimal string, which is how the database must return bigint', () => {
      expect(parseProtocolU64('9223372036854775807', 'key_epoch')).toBe(I64_MAX);
      expect(parseProtocolU64('1', 'key_epoch')).toBe(1n);
      expect(parseProtocolU64(9007199254740991n, 'key_epoch')).toBe(9007199254740991n);
    });

    it('accepts a safe JSON number', () => {
      expect(parseProtocolU64(42, 'content_revision')).toBe(42n);
      expect(parseProtocolU64(Number.MAX_SAFE_INTEGER, 'content_revision')).toBe(9007199254740991n);
    });

    it('REFUSES an unsafe JSON number instead of rounding it', () => {
      // The exact corruption measured in 1A-1: JSON.parse turns the maximum
      // bigint into 9223372036854776000 with no error. Rounding here would make
      // a revision CAS compare the wrong numbers and appear to work.
      const corrupted = JSON.parse('{"v":9223372036854775807}').v;
      expect(corrupted).toBe(9223372036854776000);
      expect(() => parseProtocolU64(corrupted, 'content_revision')).toThrow(/unsafe JSON number/);

      // 2^53 + 1 arrives as 2^53, which is itself outside the safe-integer
      // range, so it is refused too rather than accepted at a rounded value.
      const rounded = JSON.parse('{"v":9007199254740993}').v;
      expect(rounded).toBe(9007199254740992);
      expect(Number.isSafeInteger(rounded)).toBe(false);
      expect(() => parseProtocolU64(rounded, 'x')).toThrow(/unsafe JSON number/);

      // The same value as text survives intact, which is why the repository
      // layer must select these columns as text.
      expect(parseProtocolU64('9007199254740993', 'x')).toBe(9007199254740993n);
    });

    it('rejects malformed and out-of-range values', () => {
      expect(() => parseProtocolU64('12a', 'x')).toThrow(/base-10/);
      expect(() => parseProtocolU64('-1', 'x')).toThrow(/base-10/);
      expect(() => parseProtocolU64('', 'x')).toThrow(/base-10/);
      expect(() => parseProtocolU64(null, 'x')).toThrow(TypeError);
      expect(() => parseProtocolU64(U64_MAX, 'x')).toThrow(/signed 64-bit/);
      expect(() => parseProtocolU64(-5, 'x')).toThrow();
    });
  });
});

describe('uuid', () => {
  it('round-trips', () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(bytesToUuid(uuidToBytes(uuid))).toBe(uuid);
    expect(uuidToBytes(uuid)).toHaveLength(16);
  });

  it('rejects anything that is not a UUID', () => {
    expect(() => uuidToBytes('not-a-uuid')).toThrow(/not a UUID/);
    expect(() => uuidToBytes('11111111222243338444555555555555')).toThrow(/not a UUID/);
    expect(() => bytesToUuid(new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

describe('zeroize', () => {
  it('overwrites the buffer it is given', () => {
    const buffer = new Uint8Array([1, 2, 3]);
    zeroize(buffer, undefined, null);
    expect(hex(buffer)).toBe('000000');
  });
});

describe('utf8', () => {
  it('encodes multi-byte text correctly', () => {
    expect(hex(utf8('가'))).toBe('eab080');
    expect(utf8('').length).toBe(0);
  });
});
