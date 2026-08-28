import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isNativePlatformMock = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

const {
  isNativePlatform,
  authRedirectUrl,
  NATIVE_URL_SCHEME,
  NATIVE_AUTH_CALLBACK_URL,
  isNativeAuthCallbackUrl,
} = await import('@/lib/platform');

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

/**
 * iOS cannot filter a custom URL scheme by host or path.
 *
 * `CFBundleURLTypes` registers `gomsinlog` and nothing more, so the app is handed
 * EVERY `gomsinlog://...` URL that anything on the device opens. The Android
 * intent-filter pins scheme + host + exact path, so the two platforms only behave
 * the same if the JS layer applies the same narrowing -- otherwise a WKWebView
 * build would pass an arbitrary URL from any app, or from a tapped link, to the
 * PKCE token exchange in lib/deepLinks.ts.
 */
describe('isNativeAuthCallbackUrl', () => {
  it('accepts the exact route the app registers', () => {
    expect(NATIVE_AUTH_CALLBACK_URL).toBe(`${NATIVE_URL_SCHEME}://auth/callback`);
    expect(isNativeAuthCallbackUrl(NATIVE_AUTH_CALLBACK_URL)).toBe(true);
  });

  it('accepts the query and fragment forms Supabase actually returns', () => {
    expect(isNativeAuthCallbackUrl(`${NATIVE_AUTH_CALLBACK_URL}?code=abc123`)).toBe(true);
    expect(isNativeAuthCallbackUrl(`${NATIVE_AUTH_CALLBACK_URL}#access_token=abc`)).toBe(true);
    expect(isNativeAuthCallbackUrl(`${NATIVE_AUTH_CALLBACK_URL}?error=access_denied`)).toBe(true);
  });

  it('rejects a sibling path, which is what a prefix match would have allowed', () => {
    expect(isNativeAuthCallbackUrl(`${NATIVE_URL_SCHEME}://auth/callbackx`)).toBe(false);
    expect(isNativeAuthCallbackUrl(`${NATIVE_URL_SCHEME}://auth/callback-evil`)).toBe(false);
  });

  it('rejects a deeper path and a different host', () => {
    expect(isNativeAuthCallbackUrl(`${NATIVE_URL_SCHEME}://auth/callback/extra`)).toBe(false);
    expect(isNativeAuthCallbackUrl(`${NATIVE_URL_SCHEME}://evil/callback`)).toBe(false);
    expect(isNativeAuthCallbackUrl(`${NATIVE_URL_SCHEME}://auth`)).toBe(false);
  });

  it('rejects another scheme carrying the same path', () => {
    expect(isNativeAuthCallbackUrl('https://gomsinlog.app/auth/callback')).toBe(false);
    expect(isNativeAuthCallbackUrl('gomsinlogx://auth/callback')).toBe(false);
  });

  it('rejects nothing-at-all instead of throwing, since appUrlOpen is untyped input', () => {
    expect(isNativeAuthCallbackUrl(null)).toBe(false);
    expect(isNativeAuthCallbackUrl(undefined)).toBe(false);
    expect(isNativeAuthCallbackUrl('')).toBe(false);
    expect(isNativeAuthCallbackUrl(42 as unknown as string)).toBe(false);
  });

  it('is what deepLinks.ts gates the token exchange on', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/deepLinks.ts', 'utf8');
    expect(source).toContain('if (!isNativeAuthCallbackUrl(url)) return');
    // The old guard accepted any URL with the scheme.
    expect(source).not.toContain('url?.startsWith(`${NATIVE_URL_SCHEME}://`)');
  });
});
