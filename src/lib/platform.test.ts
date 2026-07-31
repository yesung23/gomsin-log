import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isNativePlatformMock = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

const { isNativePlatform, authRedirectUrl, NATIVE_URL_SCHEME } = await import('@/lib/platform');

describe('isNativePlatform', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
  });

  it('is false in a browser', () => {
    expect(isNativePlatform()).toBe(false);
  });

  it('is true inside the Capacitor shell', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(isNativePlatform()).toBe(true);
  });

  it('does not throw when Capacitor is unavailable', () => {
    isNativePlatformMock.mockImplementation(() => {
      throw new Error('not available');
    });
    expect(() => isNativePlatform()).not.toThrow();
    expect(isNativePlatform()).toBe(false);
  });
});

describe('authRedirectUrl', () => {
  const originalOrigin = window.location.origin;

  beforeEach(() => {
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
  });

  afterEach(() => {
    expect(originalOrigin).toBeTruthy();
  });

  it('uses the page origin on the web so the normal redirect flow works', () => {
    expect(authRedirectUrl()).toBe(`${window.location.origin}/auth/callback`);
    expect(authRedirectUrl().startsWith('http')).toBe(true);
  });

  it('uses the custom scheme on native, since Google blocks WebView sign-in', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(authRedirectUrl()).toBe(`${NATIVE_URL_SCHEME}://auth/callback`);
  });

  it('keeps the scheme in sync with the value registered in capacitor.config.ts', () => {
    // capacitor.config.ts declares customUrlScheme: 'gomsinlog'
    expect(NATIVE_URL_SCHEME).toBe('gomsinlog');
  });
});
