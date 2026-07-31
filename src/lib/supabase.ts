import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser, IAuthRepository, ILogRepository, AppState, Role } from '@/types';

/**
 * Supabase environment variables configuration.
 * NEVER put service_role, DB password, or API secrets in client env!
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Pinned explicitly so the callback page's `exchangeCodeForSession` path
        // always matches the flow the provider redirect actually uses.
        flowType: 'pkce',
      },
    })
  : null;

/**
 * Hash invitation code using Web Crypto API SHA-256.
 * Normalizes code (trim + uppercase) before hashing.
 */
export async function hashInvitationCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 6-digit invitation code using a cryptographically secure RNG.
 *
 * `Math.random()` is not suitable here: its output is predictable, which would
 * let an attacker guess codes that are valid for the next 24 hours.
 * Rejection sampling keeps the distribution uniform across 100000-999999.
 */
export function generateInvitationCode(): string {
  const range = 900000; // 100000..999999
  const limit = Math.floor(0xffffffff / range) * range;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return String(100000 + (value % range));
}

/**
 * Persist the couple anniversary on the shared `couples` row.
 */
export async function saveCoupleAnniversary(coupleId: string, anniversaryDate: string): Promise<boolean> {
  if (!supabase || !coupleId || !anniversaryDate) return false;
  const { error } = await supabase
    .from('couples')
    .update({ anniversary_date: anniversaryDate, updated_at: new Date().toISOString() })
    .eq('id', coupleId);
  if (error) {
    console.error('[gomsinlog] Failed to save anniversary date:', error);
    return false;
  }
  return true;
}

/**
 * Create a new couple in Supabase and generate invitation code via RPC.
 */
export async function createCoupleInvitation(role: Role): Promise<{ coupleId: string; code: string; error?: string }> {
  if (!supabase) {
    // Offline/Demo Fallback
    return { coupleId: crypto.randomUUID(), code: generateInvitationCode() };
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return { coupleId: '', code: '', error: '인증되지 않은 사용자입니다. 로그인 후 다시 시도해주세요.' };
    }

    const code = generateInvitationCode();
    const codeHash = await hashInvitationCode(code);

    // Call atomic SECURITY DEFINER RPC to create couple, member, and invitation
    const { data: coupleIdData, error: rpcError } = await supabase.rpc('create_couple_and_invitation', {
      p_role: role,
      p_code_hash: codeHash,
    });

    if (rpcError) {
      return {
        coupleId: '',
        code: '',
        error: rpcError.message || '커플 공간 생성에 실패했습니다.',
      };
    }

    return { coupleId: coupleIdData as string, code };
  } catch (err: any) {
    return { coupleId: '', code: '', error: err?.message || '초대 코드 생성 중 오류가 발생했습니다.' };
  }
}

/**
 * Consume an invitation code via RPC consume_invitation.
 */
/**
 * Client-side brute-force damper for invitation codes.
 *
 * This is only a first line of defence for the honest UI path -- it is trivially
 * bypassed by calling the RPC directly, which is why `consume_invitation` also
 * enforces a server-side throttle (see migration 013). Keeping it here gives
 * immediate feedback and avoids hammering the server.
 */
const INVITE_ATTEMPT_LIMIT = 5;
const INVITE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const inviteAttempts: number[] = [];

export function __resetInviteAttemptsForTest() {
  inviteAttempts.length = 0;
}

function registerInviteAttempt(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  while (inviteAttempts.length > 0 && now - inviteAttempts[0] > INVITE_ATTEMPT_WINDOW_MS) {
    inviteAttempts.shift();
  }
  if (inviteAttempts.length >= INVITE_ATTEMPT_LIMIT) {
    const retryAfterSeconds = Math.ceil(
      (INVITE_ATTEMPT_WINDOW_MS - (now - inviteAttempts[0])) / 1000,
    );
    return { allowed: false, retryAfterSeconds };
  }
  inviteAttempts.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clear the local damper after a successful redemption. */
function clearInviteAttempts() {
  inviteAttempts.length = 0;
}

/**
 * Consume an invitation code via RPC consume_invitation.
 */
export async function consumeCoupleInvitation(code: string): Promise<{ coupleId?: string; error?: string }> {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return { error: '초대 코드는 숫자 6자리입니다. 다시 확인해 주세요.' };
  }

  if (!supabase) {
    // Offline demo space only accepts the demo code.
    if (normalized === '123456') return { coupleId: 'demo-couple-id' };
    return { error: '올바르지 않거나 만료된 초대 코드입니다.' };
  }

  const throttle = registerInviteAttempt();
  if (!throttle.allowed) {
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    return { error: `시도 횟수가 많습니다. 약 ${minutes}분 후에 다시 시도해 주세요.` };
  }

  try {
    const codeHash = await hashInvitationCode(normalized);
    const { data, error } = await supabase.rpc('consume_invitation', {
      p_code_hash: codeHash,
    });

    if (error) {
      const message = error.message || '';
      if (message.includes('Too many invitation attempts')) {
        return { error: '초대 코드 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.' };
      }
      if (message.includes('Invalid or expired')) {
        return { error: '유효하지 않거나 만료된 초대 코드입니다. (유효기간: 24시간)' };
      }
      if (message.includes('Couple space is full')) {
        return { error: '이미 2명이 참여한 커플 공간입니다.' };
      }
      if (message.includes('already in an active couple')) {
        return { error: '이미 다른 커플 공간에 연결되어 있습니다. 먼저 연결을 해제해 주세요.' };
      }
      if (message.includes('own invitation')) {
        return { error: '내가 만든 초대 코드로는 연결할 수 없습니다. 상대방에게 코드를 전달해 주세요.' };
      }
      console.error('[gomsinlog] consume_invitation failed:', error);
      return { error: '초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }

    clearInviteAttempts();
    return { coupleId: data as string };
  } catch (err: any) {
    console.error('[gomsinlog] consume_invitation threw:', err);
    return { error: '초대 코드 확인 중 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.' };
  }
}

/**
 * Mint a fresh invitation code for the caller's existing couple.
 *
 * Needed because the server only stores a hash of the code: if the creator
 * clears their browser storage before the partner joins, the plaintext code is
 * gone and the unique-active-couple constraint prevents creating a new space.
 */
export async function regenerateCoupleInvitation(): Promise<{ code?: string; error?: string }> {
  if (!supabase) return { code: generateInvitationCode() };

  const code = generateInvitationCode();
  try {
    const codeHash = await hashInvitationCode(code);
    const { error } = await supabase.rpc('regenerate_invitation', { p_code_hash: codeHash });
    if (error) {
      // PGRST202 = the function is not deployed on this project yet.
      if (error.code === 'PGRST202') {
        return {
          error:
            '서버에 초대 코드 재발급 기능이 아직 배포되지 않았습니다. 관리자에게 문의해 주세요.',
        };
      }
      if ((error.message || '').includes('No active couple')) {
        return { error: '연결할 커플 공간이 없습니다. 먼저 우리 공간을 만들어 주세요.' };
      }
      if ((error.message || '').includes('already connected')) {
        return { error: '이미 두 사람이 연결되어 있어 초대 코드가 필요하지 않습니다.' };
      }
      console.error('[gomsinlog] regenerate_invitation failed:', error);
      return { error: '초대 코드를 재발급하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
    return { code };
  } catch (err: any) {
    console.error('[gomsinlog] regenerate_invitation threw:', err);
    return { error: '초대 코드 재발급 중 오류가 발생했습니다.' };
  }
}

/**
 * Disconnect active couple using disconnect_couple RPC.
 */
export async function disconnectCoupleFromDB(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('disconnect_couple');
    if (error) {
      console.error('Error in disconnect_couple RPC:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to call disconnect_couple RPC:', err);
    return false;
  }
}

export async function deleteAccountFromDB(): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.functions.invoke('delete-account', {
      method: 'POST',
    });
    if (error) {
      console.error('Failed to delete account:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to invoke account deletion:', error);
    return false;
  }
}

/**
 * Demo Auth Repository implementation for offline fallback.
 */
export class DemoAuthRepository implements IAuthRepository {
  private currentUser: AuthUser | null = null;

  isConfigured(): boolean {
    return false;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentUser;
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    return { error: '현재 데모 모드에서는 구글 로그인이 설정되어 있지 않습니다. 데모 둘러보기를 이용해보세요.' };
  }

  async signInWithApple(): Promise<{ error?: string }> {
    return { error: '현재 데모 모드에서는 Apple 로그인이 설정되어 있지 않습니다. 데모 둘러보기를 이용해보세요.' };
  }

  async signInWithEmail(email: string): Promise<{ error?: string }> {
    return { error: '현재 데모 모드에서는 이메일 로그인이 지원되지 않습니다.' };
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
  }
}

/**
 * Supabase Auth Repository for live integration.
 */
export class SupabaseAuthRepository implements IAuthRepository {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      const provider = (session.user.app_metadata?.provider as 'apple' | 'google') || 'google';
      return {
        id: session.user.id,
        email: session.user.email,
        provider,
      };
    } catch (e) {
      console.error('[SupabaseAuthRepository] getCurrentUser error:', e);
      return null;
    }
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    if (!supabase) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) return { error: error.message };
    return {};
  }

  async signInWithApple(): Promise<{ error?: string }> {
    if (!supabase) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
    if (error) return { error: error.message };
    return {};
  }

  async signInWithEmail(email: string): Promise<{ error?: string }> {
    if (!supabase) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    return { error: error?.message };
  }

  async signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  }
}

/**
 * Supabase Log Repository placeholder for future server sync.
 */
export class SupabaseLogRepository implements ILogRepository {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  }

  async loadState(): Promise<AppState | null> {
    if (!isSupabaseConfigured) return null;
    console.info('[gomsinlog] Supabase configured repository placeholder.');
    return null;
  }

  async saveState(state: AppState): Promise<void> {
    if (!isSupabaseConfigured) return;
    console.info('[gomsinlog] Supabase saveState called for', state.profile.myName);
  }
}

// Select active repositories based on configuration
export const authRepository: IAuthRepository = isSupabaseConfigured
  ? new SupabaseAuthRepository()
  : new DemoAuthRepository();
