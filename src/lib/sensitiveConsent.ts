const CYCLE_CONSENT_PREFIX = 'gomsinlog.cycle-sensitive-consent.v1:';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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

export async function syncConsentWithDB(userId?: string): Promise<boolean> {
  if (!userId) return false;
  const localConsent = hasCycleSensitiveConsent(userId);

  if (!isSupabaseConfigured || !supabase) return localConsent;

  try {
    const { data } = await supabase
      .from('user_sensitive_consents')
      .select('version, granted_at, revoked_at')
      .eq('user_id', userId)
      .eq('consent_type', 'cycle')
      .maybeSingle();

    if (data && !data.revoked_at && data.version === CYCLE_CONSENT_VERSION) {
      grantCycleSensitiveConsent(userId);
      return true;
    }

    if (localConsent) {
      await supabase
        .from('user_sensitive_consents')
        .upsert({
          user_id: userId,
          consent_type: 'cycle',
          version: CYCLE_CONSENT_VERSION,
          granted_at: new Date().toISOString(),
          revoked_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id, consent_type' });
      return true;
    }
  } catch (err) {
    console.error('Failed to sync consent with DB:', err);
  }
  return localConsent;
}

export async function revokeConsentInDB(userId?: string): Promise<boolean> {
  revokeCycleSensitiveConsent(userId);
  if (!userId || !isSupabaseConfigured || !supabase) return true;
  try {
    await supabase
      .from('user_sensitive_consents')
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('consent_type', 'cycle');
    return true;
  } catch (err) {
    console.error('Failed to revoke consent in DB:', err);
    return false;
  }
}
