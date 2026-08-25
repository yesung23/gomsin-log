/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_LEGAL_OPERATOR_NAME?: string;
  readonly VITE_PRIVACY_CONTACT_EMAIL?: string;
  readonly VITE_E2EE_DEVICE_PROTECTION_ENABLED?: string;
  /**
   * iOS 온디바이스 일일 요약 다듬기. `'true'`가 아니면 꺼짐이고, 미설정이 기본값이다.
   * 공개 불리언이며 자격증명이 아니다. `src/lib/dailySummary/nativeOnDeviceSummary.ts`.
   */
  readonly VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
