import { afterEach, describe, expect, it, vi } from 'vitest';

import { appleIapWebSaleFlag, canOpenAppleIapSale } from './saleGate';

describe('Apple IAP sale gate', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['TRUE', '1', 'yes', '', 'false', ' true']) (
    'keeps sale closed unless the build-time flag is exactly true (%s)',
    (value) => {
      vi.stubEnv('VITE_APPLE_IAP_SALE_ENABLED', value);
      expect(appleIapWebSaleFlag()).toBe(false);
    },
  );

  it('accepts the exact build-time flag', () => {
    vi.stubEnv('VITE_APPLE_IAP_SALE_ENABLED', 'true');
    expect(appleIapWebSaleFlag()).toBe(true);
  });

  it.each([
    { web: false, platform: 'ios', signed: true, payments: true },
    { web: true, platform: 'web', signed: true, payments: true },
    { web: true, platform: 'android', signed: true, payments: true },
    { web: true, platform: 'ios', signed: false, payments: true },
    { web: true, platform: 'ios', signed: true, payments: false },
  ] as const)('rejects any missing side of the web/native/payment gate: %j', (input) => {
    expect(canOpenAppleIapSale({
      webSaleEnabled: input.web,
      platform: input.platform,
      native: {
        signedSaleEnabled: input.signed,
        canMakePayments: input.payments,
        environment: 'xcode',
      },
    })).toBe(false);
  });

  it('opens only when the exact web flag and signed iOS gate both allow it', () => {
    expect(canOpenAppleIapSale({
      webSaleEnabled: true,
      platform: 'ios',
      native: {
        signedSaleEnabled: true,
        canMakePayments: true,
        environment: 'sandbox',
      },
    })).toBe(true);
  });
});
