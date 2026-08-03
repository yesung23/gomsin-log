import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Android (Google Play) and iOS (App Store)
 * builds.
 *
 * `appId` is the store application id and can never be changed after the first
 * release, so it is treated as fixed. It is also the Android `applicationId`
 * and the iOS `PRODUCT_BUNDLE_IDENTIFIER`.
 *
 * The custom scheme `gomsinlog://` is what Supabase redirects back to after an
 * OAuth sign-in. It must be registered in four places:
 *   1. here (`plugins.App.customUrlScheme`)
 *   2. `android/app/src/main/AndroidManifest.xml` -- the VIEW intent-filter
 *   3. `ios/App/App/Info.plist` -- `CFBundleURLTypes`
 *   4. Supabase dashboard -> Authentication -> URL Configuration -> Redirect URLs
 *      and the Google / Apple OAuth clients' authorised redirect lists
 *
 * `src/lib/platform.ts` builds the redirect URL from the same literal and
 * `src/lib/platform.test.ts` pins the two together; `src/lib/nativeConfig.test.ts`
 * pins the native projects to it as well.
 */
const config: CapacitorConfig = {
  appId: 'app.gomsinlog',
  appName: '곰신로그',
  webDir: 'dist',

  server: {
    // https keeps the WebView on a secure origin, which localStorage,
    // crypto.subtle and MediaRecorder all require.
    androidScheme: 'https',
    iosScheme: 'https',
  },

  android: {
    // Avoid the mixed-content warnings that a self-signed dev server triggers.
    allowMixedContent: false,
    // Never expose the WebView to `chrome://inspect`. Capacitor's default ties
    // this to FLAG_DEBUGGABLE, which is already false in release, but a diary
    // app should not depend on a build flag for it: with remote debugging on,
    // any local process that can talk to adb can read the whole DOM and
    // localStorage, including private records.
    webContentsDebuggingEnabled: false,
  },

  ios: {
    // Same reasoning as Android: no Safari Web Inspector attachment in any
    // build we ship.
    webContentsDebuggingEnabled: false,
    // Keyboard insets are handled by the safe-area padding in index.css rather
    // than by resizing the whole native container, which would fight the
    // sticky bottom tab bar in MobileShell.
    contentInset: 'never',
    // Leave App Transport Security at its secure defaults. Supabase is
    // https-only, so nothing needs an ATS exception.
    limitsNavigationsToAppBoundDomains: false,
  },

  plugins: {
    App: {
      // Deep link used to hand the OAuth result back to the app.
      customUrlScheme: 'gomsinlog',
    },
  },
};

export default config;
