import { runServerMutationBehindDeletionBarrier } from '@/lib/accountDeletion';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';

const CYCLE_CONSENT_PREFIX = 'gomsinlog.cycle-sensitive-consent.v1:';
const CYCLE_REVOCATION_PENDING_PREFIX = 'gomsinlog.cycle-sensitive-revocation-pending.v1:';
/**
 * Process-lifetime fallback when Web Storage refuses a write (quota, WebView
 * failure, privacy mode). It cannot survive an operating-system process kill,
 * but it prevents a component remount or SPA navigation from forgetting an
 * explicit stop request while the server retry is still pending.
 */
const runtimePendingCycleRevocations = new Set<string>();

export const CYCLE_CONSENT_VERSION = '2026-08-09';

/**
 * Consent reads carry the monotonic server revision that the next explicit
 * grant must compare-and-set against. Writes additionally say whether this
 * exact request advanced authority; a stale response may report the current
 * state, but it must never be mistaken for an applied grant.
 */
export type SensitiveConsentStateResult =
  | { ok: true; granted: boolean; revision: number }
  | { ok: false; reason: ServerErrorKind };

export type SensitiveConsentWriteResult =
  | { ok: true; applied: boolean; granted: boolean; revision: number }
  | { ok: false; reason: ServerErrorKind };

function consentFailure(error: unknown): { ok: false; reason: ServerErrorKind } {
  return { ok: false, reason: classifyServerError(error).kind };
}

function parseRevision(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseConsentMutation(data: unknown): SensitiveConsentWriteResult {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unknown' };
  const row = data as Record<string, unknown>;
  const revision = parseRevision(row.revision);
  if (typeof row.applied !== 'boolean'
    || typeof row.granted !== 'boolean'
    || revision === null) {
    return { ok: false, reason: 'unknown' };
  }
  return {
    ok: true,
    applied: row.applied,
    granted: row.granted,
    revision,
  };
}

interface StoredConsent {
  version: string;
  grantedAt: string;
}

function storageKey(userId: string): string {
  return `${CYCLE_CONSENT_PREFIX}${userId}`;
}

function revocationPendingStorageKey(userId: string): string {
  return `${CYCLE_REVOCATION_PENDING_PREFIX}${userId}`;
}

/**
 * Persist an explicit stop request until the server confirms it.
 *
 * The value is deliberately opaque: presence means "stay locked". Treating a
 * malformed value as pending is fail-closed and lets a successful retry remove
 * it, rather than reopening health data after a crash or app restart.
 */
export function hasPendingCycleConsentRevocation(userId?: string): boolean {
  if (!userId) return false;
  if (runtimePendingCycleRevocations.has(userId)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(revocationPendingStorageKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function markCycleConsentRevocationPending(userId?: string): boolean {
  if (!userId) return false;
  // Memory first: even when the durable write throws, this running app remains
  // locked and can offer the explicit server retry.
  runtimePendingCycleRevocations.add(userId);
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(revocationPendingStorageKey(userId), 'pending');
    return true;
  } catch {
    return false;
  }
}

export function clearPendingCycleConsentRevocation(userId?: string): void {
  if (!userId) return;
  if (typeof window === 'undefined') {
    runtimePendingCycleRevocations.delete(userId);
    return;
  }
  try {
    window.localStorage.removeItem(revocationPendingStorageKey(userId));
    runtimePendingCycleRevocations.delete(userId);
  } catch {
    // Keep the runtime lock too. A later successful retry can clear both.
  }
}

export function hasCycleSensitiveConsent(userId?: string): boolean {
  if (!userId || typeof window === 'undefined') return false;
  if (runtimePendingCycleRevocations.has(userId)) return false;
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
 * Read the authoritative consent state from the server without mutating cache.
 *
 * The server row is the source of truth; `localStorage` is a UX cache only. A
 * cache entry alone must never unlock the feature, because clearing the server
 * row (or revoking on another device) would otherwise be silently ignored.
 *
 * When Supabase is not configured there is no authority to consult. That is a
 * failure, not permission: a local cache entry can improve copy or recovery,
 * but it must never authorize health-data processing by itself.
 */
export async function syncCycleConsentWithDB(
  userId?: string,
): Promise<SensitiveConsentStateResult> {
  if (!userId) return { ok: true, granted: false, revision: 0 };
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'server' };
  }

  try {
    const { data, error } = await supabase
      .from('user_sensitive_consents')
      .select('version, granted_at, revoked_at, revision')
      .eq('user_id', userId)
      .eq('consent_type', 'cycle')
      .maybeSingle();

    if (error) {
      console.error('[gomsinlog] Failed to read sensitive consent.');
      return consentFailure(error);
    }

    const revision = data ? parseRevision(data.revision) : 0;
    if (revision === null) {
      console.error('[gomsinlog] Sensitive consent returned an invalid revision.');
      return { ok: false, reason: 'unknown' };
    }

    const granted = !!data
      && !data.revoked_at
      && data.version === CYCLE_CONSENT_VERSION;

    return { ok: true, granted, revision };
  } catch (err) {
    console.error('[gomsinlog] Failed to read sensitive consent.');
    return consentFailure(err);
  }
}

/**
 * Record consent on the server without mutating the local UX cache.
 *
 * The component-level authority coordinator owns cache commits. Keeping this
 * helper side-effect free prevents a stale response from another account or an
 * older authority operation from reopening sensitive UI.
 */
export async function grantCycleConsentInDB(
  userId: string | undefined,
  expectedRevision: number,
): Promise<SensitiveConsentWriteResult> {
  if (!userId) return { ok: false, reason: 'auth_expired' };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, reason: 'unknown' };
  }
  if (!isSupabaseConfigured || !supabase) {
    // No server to record consent on. Sensitive processing must not begin on a
    // promise we cannot store.
    return { ok: false, reason: 'server' };
  }

  try {
    const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
      assertCurrent();
      const { data, error } = await supabase!
        .rpc('grant_cycle_sensitive_consent', {
          p_expected_user_id: userId,
          p_expected_revision: expectedRevision,
          p_version: CYCLE_CONSENT_VERSION,
        })
        .single();
      assertCurrent();
      if (error) {
        console.error('[gomsinlog] Failed to record sensitive consent.');
        return consentFailure(error);
      }
      return parseConsentMutation(data);
    }, { expectedUserId: userId });
    return result.kind === 'executed' ? result.value : { ok: false, reason: 'forbidden' };
  } catch (err) {
    console.error('[gomsinlog] Failed to record sensitive consent.');
    return consentFailure(err);
  }
}

/**
 * Revoke consent on the server without mutating the local UX cache.
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
    return { ok: false, reason: 'server' };
  }
  // Deliberate exception to the normal deletion write barrier: revocation only
  // removes authority, and the server RPC is designed to remain available while
  // deletion is pending. Privacy must not depend on the cleanup job finishing.

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || user?.id !== userId) {
      console.error('[gomsinlog] Sensitive consent revoke identity mismatch.');
      return { ok: false, reason: 'forbidden' };
    }

    // This is intentionally outside the ordinary barrier so revocation remains
    // available during deletion. The identity read above prevents a stale
    // account from using the privacy-reduction exception for another account.
    const { data, error } = await supabase!
      .rpc('revoke_cycle_sensitive_consent', {
        p_expected_user_id: userId,
      })
      .single();

    if (error) {
      console.error('[gomsinlog] Failed to revoke sensitive consent.');
      return consentFailure(error);
    }

    return parseConsentMutation(data);
  } catch (err) {
    console.error('[gomsinlog] Failed to revoke sensitive consent.');
    return consentFailure(err);
  }
}
