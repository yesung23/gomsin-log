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
 * Create a new couple in Supabase and generate invitation code via RPC.
 */
export async function createCoupleInvitation(role: Role): Promise<{ coupleId: string; code: string; error?: string }> {
  if (!supabase) {
    // Offline/Demo Fallback
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return { coupleId: crypto.randomUUID(), code };
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return { coupleId: '', code: '', error: '인증되지 않은 사용자입니다. 로그인 후 다시 시도해주세요.' };
    }

    // Generate 6-digit code and hash it
    const code = Math.floor(100000 + Math.random() * 900000).toString();
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
export async function consumeCoupleInvitation(code: string): Promise<{ coupleId?: string; error?: string }> {
  if (!supabase) {
    if (code.trim() === '123456' || code.trim().length === 6) {
      return { coupleId: 'demo-couple-id' };
    }
    return { error: '올바르지 않거나 만료된 초대 코드입니다.' };
  }

  try {
    const codeHash = await hashInvitationCode(code);
    const { data, error } = await supabase.rpc('consume_invitation', {
      p_code_hash: codeHash,
    });

    if (error) {
      if (error.message.includes('Invalid or expired')) {
        return { error: '유효하지 않거나 만료된 초대 코드입니다. (유효기간: 24시간)' };
      }
      if (error.message.includes('Couple space is full')) {
        return { error: '이미 2명이 가입한 커플 공간입니다.' };
      }
      return { error: error.message };
    }

    return { coupleId: data as string };
  } catch (err: any) {
    return { error: err?.message || '초대 코드 확인 중 오류가 발생했습니다.' };
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
