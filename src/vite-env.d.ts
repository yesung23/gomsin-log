/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** New Apple IAP sales only. Exact string `'true'` enables; unset is OFF. */
  readonly VITE_APPLE_IAP_SALE_ENABLED?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_LEGAL_OPERATOR_NAME?: string;
  readonly VITE_PRIVACY_CONTACT_EMAIL?: string;
  readonly VITE_E2EE_DEVICE_PROTECTION_ENABLED?: string;
  /** OS/browser push surfaces. Exact string `'true'` enables; unset is OFF. */
  readonly VITE_PUSH_NOTIFICATIONS_ENABLED?: string;
  /** Sign in with Apple. Exact string `'true'` enables; unset is OFF. */
  readonly VITE_APPLE_LOGIN_ENABLED?: string;
  /**
   * iOS 온디바이스 일일 요약 다듬기. 정확한 `'true'`에서만 켜지고 미설정은 OFF다.
   * 공개 불리언이며 자격증명이 아니다. `src/lib/dailySummary/nativeOnDeviceSummary.ts`.
   */
  readonly VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED?: string;
  /** Multi-day Partner Briefing. Exact string `'true'` enables; unset is OFF. */
  readonly VITE_PARTNER_BRIEFING_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
