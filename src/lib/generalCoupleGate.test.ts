import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGeneralCoupleOnboardingEnabled } from '@/lib/generalCoupleGate';

describe('general-couple onboarding release gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])('stays off for %s', (value) => {
    if (value === undefined) vi.stubEnv('VITE_GENERAL_COUPLE_ONBOARDING_ENABLED', undefined);
    else vi.stubEnv('VITE_GENERAL_COUPLE_ONBOARDING_ENABLED', value);
    expect(isGeneralCoupleOnboardingEnabled()).toBe(false);
  });

  it('turns on only for the reviewed exact-true build setting', () => {
    vi.stubEnv('VITE_GENERAL_COUPLE_ONBOARDING_ENABLED', 'true');
    expect(isGeneralCoupleOnboardingEnabled()).toBe(true);
  });
});
