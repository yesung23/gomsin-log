/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_LEGAL_OPERATOR_NAME?: string;
  readonly VITE_PRIVACY_CONTACT_EMAIL?: string;
  readonly VITE_E2EE_DEVICE_PROTECTION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
