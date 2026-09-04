import {
  serverCallBlockedByPendingDeletion,
  type AccountDeletionLockLease,
} from '@/lib/accountDeletion';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { isValidUsername, normalizeUsername } from '@/lib/profileCaption';

/**
 * The caller may name the active partner, but never an arbitrary account.
 * The database RPC resolves the partner from the active couple membership and
 * keeps the profiles table owner-only for ordinary clients.
 */
export async function setPartnerUsernameInDB(
  username: string,
  deletionLease?: AccountDeletionLockLease,
): Promise<boolean> {
  const normalized = normalizeUsername(username);
  if (!isValidUsername(normalized)) return false;
  if (await serverCallBlockedByPendingDeletion(deletionLease)) return false;
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase.rpc('set_partner_username', {
    p_username: normalized,
  });
  return !error;
}
