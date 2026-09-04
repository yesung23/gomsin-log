import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildEnvironmentValidationPlugin } from '../../build/viteBuildEnvironmentPlugin';

type ConfigHook = (
  config: Record<string, unknown>,
  environment: { command: 'build'; mode: string },
) => unknown;

function buildValidationHook(): ConfigHook {
  const plugin = createBuildEnvironmentValidationPlugin({
    loadModeEnvironment: () => ({}),
    onValidated: () => undefined,
  }) as unknown as {
    config?: ConfigHook | { handler: ConfigHook };
  };
  if (!plugin.config) throw new Error('validate-build-environment config hook is missing');
  return typeof plugin.config === 'function' ? plugin.config : plugin.config.handler;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the Vite build hook cannot bypass the Apple IAP release fuse', () => {
  it('validates a Vercel production target even when someone selects development mode', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_prod_mock_key');
    vi.stubEnv('VITE_LEGAL_OPERATOR_NAME', '한예준');
    vi.stubEnv('VITE_PRIVACY_CONTACT_EMAIL', 'privacy@gomsinlog.app');
    vi.stubEnv('VITE_APPLE_IAP_SALE_ENABLED', 'true');

    expect(() => buildValidationHook()({}, {
      command: 'build',
      mode: 'development',
    })).toThrow(/Apple IAP|VITE_APPLE_IAP_SALE_ENABLED/i);
  });
});
