const CYCLE_CONSENT_PREFIX = 'gomsinlog.cycle-sensitive-consent.v1:';

export const CYCLE_CONSENT_VERSION = '2026-08-09';

interface StoredConsent {
  version: string;
  grantedAt: string;
}

function storageKey(userId: string): string {
  return `${CYCLE_CONSENT_PREFIX}${userId}`;
}

export function hasCycleSensitiveConsent(userId?: string): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    return parsed.version === CYCLE_CONSENT_VERSION
      && typeof parsed.grantedAt === 'string'
      && !Number.isNaN(Date.parse(parsed.grantedAt));
  } catch {
    return false;
  }
}

export function grantCycleSensitiveConsent(userId?: string): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    const consent: StoredConsent = {
      version: CYCLE_CONSENT_VERSION,
      grantedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(consent));
    return true;
  } catch {
    return false;
  }
}

export function revokeCycleSensitiveConsent(userId?: string): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Failing closed is sufficient: a subsequent read returns false.
  }
}
