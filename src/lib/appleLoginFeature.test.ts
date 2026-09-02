import { afterEach, describe, expect, it, vi } from 'vitest';
import { appleLoginEnabled } from './appleLoginFeature';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Apple login build gate', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])(
    'stays off for non-exact value %s',
    (value) => {
      vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', value);
      expect(appleLoginEnabled()).toBe(false);
    },
  );

  it('turns on only for the exact string true', () => {
    vi.stubEnv('VITE_APPLE_LOGIN_ENABLED', 'true');
    expect(appleLoginEnabled()).toBe(true);
  });
});
