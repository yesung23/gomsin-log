/**
 * SAS derivation.
 *
 * The SAS is the only control that stops a malicious server substituting a
 * public key during enrollment or pairing, so its two properties both need
 * defending: the value must be unbiased across its 10^18 space, and comparison
 * must be exact with no lenient path.
 */

import { describe, expect, it } from 'vitest';
import {
  SAS_ENTROPY_BITS,
  SAS_GROUPS,
  SAS_REJECTION_CEILING,
  SAS_SPACE,
  buildQrPayload,
  deriveSas,
  isWellFormedSas,
  parseQrPayload,
  sasMatches,
} from './sas';
import { randomBytes, sha256 } from './suite';
import { hex } from './bytes';

describe('shape', () => {
  it('is six zero-padded 3-digit groups', async () => {
    const sas = await deriveSas('pair', await sha256(new Uint8Array([1])));
    expect(sas).toMatch(/^\d{3}(-\d{3}){5}$/);
    expect(sas.split('-')).toHaveLength(SAS_GROUPS);
  });

  it('documents the space exactly, not rounded up', () => {
    expect(SAS_SPACE).toBe(10n ** 18n);
    expect(SAS_ENTROPY_BITS).toBeCloseTo(Math.log2(1e18), 2);
    expect(SAS_ENTROPY_BITS).toBeLessThan(60);
    // The rejection ceiling is the largest multiple of 10^18 below 2^64.
    expect(SAS_REJECTION_CEILING).toBe(18n * 10n ** 18n);
    expect(SAS_REJECTION_CEILING).toBeLessThan(2n ** 64n);
    expect(SAS_REJECTION_CEILING + 10n ** 18n).toBeGreaterThan(2n ** 64n);
  });

  it('is deterministic for a transcript and context', async () => {
    const transcript = await sha256(new Uint8Array([7]));
    expect(await deriveSas('enroll', transcript)).toBe(await deriveSas('enroll', transcript));
  });

  it('separates contexts, so an enrollment SAS cannot be replayed into pairing', async () => {
    const transcript = await sha256(new Uint8Array([9]));
    const enroll = await deriveSas('enroll', transcript);
    const pair = await deriveSas('pair', transcript);
    const assist = await deriveSas('partner-assist', transcript);
    expect(new Set([enroll, pair, assist]).size).toBe(3);
  });

  it('rejects a transcript hash of the wrong width', async () => {
    await expect(deriveSas('pair', randomBytes(31))).rejects.toThrow(/32 bytes/);
  });
});

describe('distribution', () => {
  it('produces a different value for a changed transcript', async () => {
    const a = await deriveSas('pair', await sha256(new Uint8Array([1])));
    const b = await deriveSas('pair', await sha256(new Uint8Array([2])));
    expect(a).not.toBe(b);
  });

  it('spreads across the leading group rather than clustering', async () => {
    // Rejection sampling exists to remove modulo bias. A crude check that the
    // top group is not pinned to a narrow band.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const sas = await deriveSas('pair', await sha256(new Uint8Array([i, i >> 8])));
      seen.add(sas.split('-')[0]);
    }
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe('comparison', () => {
  it('matches identical values and rejects any difference', async () => {
    const sas = await deriveSas('pair', await sha256(new Uint8Array([3])));
    expect(sasMatches(sas, sas)).toBe(true);

    const groups = sas.split('-');
    for (let i = 0; i < groups.length; i += 1) {
      const changed = [...groups];
      changed[i] = changed[i] === '000' ? '001' : '000';
      // Every group is load-bearing; there is no prefix or partial acceptance.
      expect(sasMatches(sas, changed.join('-'))).toBe(false);
    }
  });

  it('treats a malformed value as a mismatch, never a lenient match', () => {
    expect(sasMatches('123-004-998-231-042-551', '123-004-998-231-042-551')).toBe(true);
    expect(sasMatches('123-004-998-231-042-55', '123-004-998-231-042-55')).toBe(false);
    expect(sasMatches('', '')).toBe(false);
    expect(sasMatches('abc-004-998-231-042-551', 'abc-004-998-231-042-551')).toBe(false);
    expect(isWellFormedSas('123-4-998-231-042-551')).toBe(false);
    expect(isWellFormedSas('123-004-998-231-042-551')).toBe(true);
  });
});

describe('QR payload', () => {
  it('carries the full transcript hash, not the truncated SAS', async () => {
    const transcriptHash = await sha256(new Uint8Array([5]));
    const subjectId = randomBytes(16);
    const payload = buildQrPayload('enroll', transcriptHash, subjectId);
    const parsed = parseQrPayload(payload);
    expect(parsed.context).toBe('enroll');
    expect(hex(parsed.transcriptHash)).toBe(hex(transcriptHash));
    expect(hex(parsed.subjectId)).toBe(hex(subjectId));
    // 32 bytes of hash, far beyond the 59.79 bits the digits carry.
    expect(parsed.transcriptHash).toHaveLength(32);
  });

  it('rejects a foreign or truncated payload', () => {
    expect(() => parseQrPayload(new Uint8Array(10))).toThrow(/too short/);
    const foreign = new Uint8Array(60);
    foreign.set(new TextEncoder().encode('OTHER1'), 0);
    expect(() => parseQrPayload(foreign)).toThrow(/not a GomsinLog SAS payload/);
  });
});
