import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CYCLE_CONSENT_VERSION,
  grantCycleSensitiveConsent,
  hasCycleSensitiveConsent,
  revokeCycleSensitiveConsent,
  syncCycleConsentWithDB,
} from '@/lib/sensitiveConsent';

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}));

describe('cycle sensitive-information consent', () => {
  beforeEach(() => window.localStorage.clear());

  it('fails closed until this specific account grants the current version', () => {
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    expect(grantCycleSensitiveConsent('user-a')).toBe(true);
    expect(hasCycleSensitiveConsent('user-a')).toBe(true);
    expect(hasCycleSensitiveConsent('user-b')).toBe(false);
  });

  it('rejects stale, malformed and dateless consent records', () => {
    window.localStorage.setItem('gomsinlog.cycle-sensitive-consent.v1:user-a', JSON.stringify({
      version: `${CYCLE_CONSENT_VERSION}-old`, grantedAt: new Date().toISOString(),
    }));
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    window.localStorage.setItem('gomsinlog.cycle-sensitive-consent.v1:user-a', '{bad');
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    window.localStorage.setItem('gomsinlog.cycle-sensitive-consent.v1:user-a', JSON.stringify({
      version: CYCLE_CONSENT_VERSION, grantedAt: 'not-a-date',
    }));
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
  });

  it('revokes one account without changing another account', () => {
    grantCycleSensitiveConsent('user-a');
    grantCycleSensitiveConsent('user-b');
    revokeCycleSensitiveConsent('user-a');
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    expect(hasCycleSensitiveConsent('user-b')).toBe(true);
  });

  it('reports failure instead of pretending consent was saved', () => {
    const setItem = vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota');
    });
    expect(grantCycleSensitiveConsent('user-a')).toBe(false);
    expect(hasCycleSensitiveConsent('user-a')).toBe(false);
    setItem.mockRestore();
  });

  it('never treats a local cache entry as authority when the server is unavailable', async () => {
    grantCycleSensitiveConsent('user-a');

    await expect(syncCycleConsentWithDB('user-a')).resolves.toEqual({
      ok: false,
      reason: 'server',
    });
    expect(hasCycleSensitiveConsent('user-a')).toBe(true);
  });
});
