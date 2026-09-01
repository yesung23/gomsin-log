import { serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';

const CYCLE_CONSENT_PREFIX = 'gomsinlog.cycle-sensitive-consent.v1:';

export const CYCLE_CONSENT_VERSION = '2026-08-09';

/**
 * Consent write outcome, in the same reason-carrying shape as every cycle
 * mutation. A boolean could not distinguish "RLS refused" from "you are
 * offline", and the UI must not unlock a sensitive feature on an ambiguous
 * result.
 */
export type SensitiveConsentWriteResult =
  | { ok: true; granted: boolean }
  | { ok: false; reason: ServerErrorKind };

function consentWriteFailure(error: unknown): SensitiveConsentWriteResult {
  return { ok: false, reason: classifyServerError(error).kind };
}

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

/**
 * Read the authoritative consent state from the server.
 *
 * The server row is the source of truth; `localStorage` is a UX cache only. A
 * cache entry alone must never unlock the feature, because clearing the server
 * row (or revoking on another device) would otherwise be silently ignored.
 *
 * When Supabase is not configured at all there is no authority to consult, so
 * the cached answer is returned rather than inventing a verdict.
 */
export async function syncCycleConsentWithDB(
  userId?: string,
): Promise<SensitiveConsentWriteResult> {
  if (!userId) return { ok: true, granted: false };
  if (!isSupabaseConfigured || !supabase) {
    return { ok: true, granted: hasCycleSensitiveConsent(userId) };
  }

  try {
    const { data, error } = await supabase
      .from('user_sensitive_consents')
      .select('version, granted_at, revoked_at')
      .eq('user_id', userId)
      .eq('consent_type', 'cycle')
      .maybeSingle();

    if (error) {
      console.error('[gomsinlog] Failed to read sensitive consent.');
      return consentWriteFailure(error);
    }

    const granted = !!data
      && !data.revoked_at
      && data.version === CYCLE_CONSENT_VERSION;

    // Mirror the server verdict into the cache, in both directions: a consent
    // revoked elsewhere must not stay unlocked on this device.
    if (granted) grantCycleSensitiveConsent(userId);
    else revokeCycleSensitiveConsent(userId);

    return { ok: true, granted };
  } catch (err) {
    console.error('[gomsinlog] Failed to read sensitive consent.');
    return consentWriteFailure(err);
  }
}

/**
 * Record consent on the server, then cache it.
 *
 * Order is load-bearing: the local cache is written only after the server
 * confirms, so a failed write cannot leave the feature unlocked with no
 * server-side record of the user ever agreeing.
 */
export async function grantCycleConsentInDB(
  userId?: string,
): Promise<SensitiveConsentWriteResult> {
  if (!userId) return { ok: false, reason: 'auth_expired' };
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return { ok: false, reason: 'forbidden' };

  if (!isSupabaseConfigured || !supabase) {
    // No server to record consent on. Sensitive processing must not begin on a
    // promise we cannot store.
    return { ok: false, reason: 'server' };
  }

  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('user_sensitive_consents')
      .upsert({
        user_id: userId,
        consent_type: 'cycle',
        version: CYCLE_CONSENT_VERSION,
        granted_at: now,
        revoked_at: null,
        updated_at: now,
      }, { onConflict: 'user_id, consent_type' });

    if (error) {
      console.error('[gomsinlog] Failed to record sensitive consent.');
      return consentWriteFailure(error);
    }

    if (!grantCycleSensitiveConsent(userId)) {
      // The server has the consent; the cache simply could not be written.
      return { ok: true, granted: true };
    }
    return { ok: true, granted: true };
  } catch (err) {
    console.error('[gomsinlog] Failed to record sensitive consent.');
    return consentWriteFailure(err);
  }
}

/**
 * Revoke consent on the server, then clear the cache.
 *
 * `.update()` reports failure through `{ error }` rather than throwing, so the
 * result is inspected explicitly: a try/catch alone reported success on a
 * refused revoke.
 */
export async function revokeCycleConsentInDB(
  userId?: string,
): Promise<SensitiveConsentWriteResult> {
  if (!userId) return { ok: false, reason: 'auth_expired' };
  if (!isSupabaseConfigured || !supabase) {
    revokeCycleSensitiveConsent(userId);
    return { ok: true, granted: false };
  }
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return { ok: false, reason: 'forbidden' };

  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('user_sensitive_consents')
      .update({ revoked_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('consent_type', 'cycle');

    if (error) {
      console.error('[gomsinlog] Failed to revoke sensitive consent.');
      return consentWriteFailure(error);
    }

    // Only clear the cache once the server confirms, so a refused revoke is
    // never presented as done.
    revokeCycleSensitiveConsent(userId);
    return { ok: true, granted: false };
  } catch (err) {
    console.error('[gomsinlog] Failed to revoke sensitive consent.');
    return consentWriteFailure(err);
  }
}
