import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateInvitationCode,
  hashInvitationCode,
  consumeCoupleInvitation,
  __resetInviteAttemptsForTest,
} from '@/lib/supabase';

describe('generateInvitationCode', () => {
  it('always produces exactly six digits in range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateInvitationCode();
      expect(code).toMatch(/^\d{6}$/);
      const value = Number(code);
      expect(value).toBeGreaterThanOrEqual(100000);
      expect(value).toBeLessThanOrEqual(999999);
    }
  });

  it('does not use Math.random (predictable) as its entropy source', () => {
    // If Math.random were the source, stubbing it would pin the output.
    const original = Math.random;
    Math.random = () => 0.5;
    try {
      const codes = new Set(Array.from({ length: 40 }, () => generateInvitationCode()));
      expect(codes.size).toBeGreaterThan(1);
    } finally {
      Math.random = original;
    }
  });

  it('produces a well spread distribution', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInvitationCode()));
    // Collisions in 1000 draws from 900k values should be very rare.
    expect(codes.size).toBeGreaterThan(990);
  });
});

describe('hashInvitationCode', () => {
  it('produces a stable 64-char sha-256 hex digest', async () => {
    const hash = await hashInvitationCode('123456');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInvitationCode('123456')).toBe(hash);
  });

  it('normalises surrounding whitespace and casing', async () => {
    expect(await hashInvitationCode('  123456 ')).toBe(await hashInvitationCode('123456'));
    expect(await hashInvitationCode('abcdef')).toBe(await hashInvitationCode('ABCDEF'));
  });

  it('produces different digests for different codes', async () => {
    expect(await hashInvitationCode('123456')).not.toBe(await hashInvitationCode('123457'));
  });
});

describe('consumeCoupleInvitation input validation', () => {
  beforeEach(() => {
    __resetInviteAttemptsForTest();
  });

  it('rejects codes that are not six digits before any network call', async () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', '12345a']) {
      const result = await consumeCoupleInvitation(bad);
      expect(result.error).toBeTruthy();
      expect(result.coupleId).toBeUndefined();
    }
  });

  it('accepts only the demo code when Supabase is not configured', async () => {
    // Without VITE_SUPABASE_URL the module falls back to the offline demo path.
    await expect(consumeCoupleInvitation('123456')).resolves.toEqual({ coupleId: 'demo-couple-id' });
    const other = await consumeCoupleInvitation('999999');
    expect(other.error).toBeTruthy();
    expect(other.coupleId).toBeUndefined();
  });
});
