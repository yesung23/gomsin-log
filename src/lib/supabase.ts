import type { AuthUser, IAuthRepository, ILogRepository, AppState } from '@/types';

/**
 * Check if Supabase environment variables are configured.
 * NEVER put service_role, DB password, or API secrets in client env!
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

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

  async signInWithMagicLink(email: string): Promise<{ error?: string }> {
    console.info('[gomsinlog] Demo mode: Magic link requested for', email);
    this.currentUser = { id: 'demo-user-id', email, provider: 'email' };
    return {};
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    return { error: '현재 데모 모드에서는 구글 로그인이 설정되어 있지 않습니다. 데모 둘러보기를 이용해보세요.' };
  }

  async signInWithApple(): Promise<{ error?: string }> {
    return { error: '현재 데모 모드에서는 Apple 로그인이 설정되어 있지 않습니다. 데모 둘러보기를 이용해보세요.' };
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
  }
}

/**
 * Supabase Auth Repository stub for live pilot integration.
 */
export class SupabaseAuthRepository implements IAuthRepository {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!isSupabaseConfigured) return null;
    // Future: const { data } = await supabase.auth.getUser();
    return null;
  }

  async signInWithMagicLink(email: string): Promise<{ error?: string }> {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    // Future: return await supabase.auth.signInWithOtp({ email });
    return { error: 'Supabase SDK client disabled in offline pilot preview.' };
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    // Future: return await supabase.auth.signInWithOAuth({ provider: 'google' });
    return { error: 'Supabase Google OAuth provider not connected.' };
  }

  async signInWithApple(): Promise<{ error?: string }> {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    // Future: return await supabase.auth.signInWithOAuth({ provider: 'apple' });
    return { error: 'Supabase Apple OAuth provider not connected.' };
  }

  async signOut(): Promise<void> {
    if (!isSupabaseConfigured) return;
    // Future: await supabase.auth.signOut();
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
    console.info('[gomsinlog] Supabase configured but client in preview mode.');
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
