import type { Plugin } from 'vite';
import {
  validateBuildEnvironment,
  type ValidatedBuildEnvironment,
} from './buildEnv';

type LoadModeEnvironment = (
  mode: string,
  directory: string,
  prefix: string,
) => Record<string, string>;

export function createBuildEnvironmentValidationPlugin({
  loadModeEnvironment,
  onValidated,
}: {
  loadModeEnvironment: LoadModeEnvironment;
  onValidated: (validated: ValidatedBuildEnvironment) => void;
}): Plugin {
  return {
    name: 'validate-build-environment',
    apply: 'build',
    config(_config, { mode }) {
      const isExplicitRelease =
        process.env.GOMSINLOG_RELEASE === 'true'
        || process.env.GOMSINLOG_RELEASE === '1'
        || process.env.npm_lifecycle_event === 'build:release';
      const isProductionDeployment = process.env.VERCEL_ENV === 'production';
      if (mode !== 'production' && !isExplicitRelease && !isProductionDeployment) return;

      // Vite loads `.env*` after resolving the config, so values from a local
      // `.env` are not present in `process.env` here. Read them explicitly while
      // still giving CI/Vercel environment variables precedence.
      const fileEnv = loadModeEnvironment(mode, process.cwd(), 'VITE_');
      const validated = validateBuildEnvironment({
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
        VITE_SUPABASE_ANON_KEY:
          process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY,
        VITE_LEGAL_OPERATOR_NAME:
          process.env.VITE_LEGAL_OPERATOR_NAME || fileEnv.VITE_LEGAL_OPERATOR_NAME,
        VITE_PRIVACY_CONTACT_EMAIL:
          process.env.VITE_PRIVACY_CONTACT_EMAIL || fileEnv.VITE_PRIVACY_CONTACT_EMAIL,
        VITE_APPLE_LOGIN_ENABLED:
          process.env.VITE_APPLE_LOGIN_ENABLED ?? fileEnv.VITE_APPLE_LOGIN_ENABLED,
        VITE_E2EE_DEVICE_PROTECTION_ENABLED:
          process.env.VITE_E2EE_DEVICE_PROTECTION_ENABLED
          ?? fileEnv.VITE_E2EE_DEVICE_PROTECTION_ENABLED,
        VITE_APPLE_IAP_SALE_ENABLED:
          process.env.VITE_APPLE_IAP_SALE_ENABLED
          ?? fileEnv.VITE_APPLE_IAP_SALE_ENABLED,
        buildMode: mode,
        deploymentTarget: process.env.VERCEL_ENV,
        isRelease: isExplicitRelease,
      });
      onValidated(validated);
    },
  };
}
