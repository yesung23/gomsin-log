import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * The client half of push token lifecycle.
 *
 * ## What the server already covers, and why that shapes this file
 *
 * §14.3 requires a token to be invalidated on unlink, sign-out, account deletion
 * AND account switch. Three of those four need nothing from the client:
 *
 *   * unlink           -- `disconnect_couple()` deletes both members' tokens
 *   * account deletion -- `ON DELETE CASCADE` from `auth.users`
 *   * account switch   -- `register_push_token()` DELETES whoever held the token
 *                         before claiming it, so the arriving account taking a
 *                         handed-over phone removes the departing one
 *
 * Sign-out is the one that has to be asked for, because nothing about signing out
 * touches the couple, the account row, or another account's registration. The row
 * would simply outlive the session that created it.
 *
 * That division matters when reading `revokeOwnPushTokens` below: it is HYGIENE,
 * not the security boundary. The boundary is the handover DELETE in the migration,
 * which holds even when this call never happens -- a dead session, a killed app, a
 * phone that never came back online.
 *
 * ## Nothing here is user content
 *
 * A token addresses a device for delivery. It is never logged, never put in a
 * URL, and never sent anywhere but the two RPCs below.
 */

export type PushPlatform = 'ios' | 'android';

export interface PushTokenResult {
  ok: boolean;
  /** Present only on failure. Safe to show; never contains the token. */
  error?: string;
}

/**
 * Claim this device's token for the signed-in account.
 *
 * Idempotent by design: the RPC removes any previous holder and inserts, so
 * calling it on every launch is correct rather than merely tolerable. That
 * matters because APNs and FCM reissue tokens without warning, and the app has no
 * reliable way to know whether the token it holds is the one the server has.
 */
export async function registerPushToken(
  platform: PushPlatform,
  token: string,
): Promise<PushTokenResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: '지금은 알림을 설정할 수 없어요.' };
  }
  if (!token.trim()) {
    return { ok: false, error: '알림 등록에 필요한 정보를 받지 못했어요.' };
  }

  const { error } = await supabase.rpc('register_push_token', {
    p_platform: platform,
    p_token: token,
  });

  if (error) {
    // The token itself is deliberately absent from this log line.
    console.error('[gomsinlog] Push token registration failed:', error.message);
    return { ok: false, error: '알림을 설정하지 못했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { ok: true };
}

/**
 * Release this account's tokens.
 *
 * Called while the session is still valid -- after sign-out the RPC has no actor
 * and refuses, which is correct and is why the ordering at the call site is not
 * arbitrary.
 *
 * A failure here is not surfaced and does not block anything. Refusing to sign
 * someone out because a notification cleanup failed would be the wrong trade in
 * every direction, and the handover DELETE in migration 048 already prevents the
 * outcome §14.3 actually forbids: a departed account receiving a device's
 * notifications.
 */
export async function revokeOwnPushTokens(): Promise<PushTokenResult> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };

  const { error } = await supabase.rpc('revoke_my_push_tokens');
  if (error) {
    console.warn('[gomsinlog] Push token revocation failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Lower this account's own delivery flag.
 *
 * Someone reading the app should not be invited back to what they are already
 * looking at. This acts on the caller's own row and is invisible to the partner,
 * who has no policy that selects it -- which is what keeps it from being a read
 * receipt. A read receipt is defined by the OTHER side learning something, and
 * nothing here reaches them.
 */
export async function clearOwnUnseen(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.rpc('clear_my_unseen');
  if (error) console.warn('[gomsinlog] Clearing the delivery flag failed:', error.message);
}
