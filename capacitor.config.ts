import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Android (Google Play) build.
 *
 * `appId` is the Play Store application id and can never be changed after the
 * first release, so it is treated as fixed.
 *
 * The custom scheme `gomsinlog://` is what Supabase redirects back to after an
 * OAuth sign-in. It must be registered in three places:
 *   1. here (`androidScheme` stays https; the deep link is declared in the
 *      Android manifest intent-filter -- see docs/kiro/PLAY_STORE_ROADMAP.md)
 *   2. Supabase dashboard -> Authentication -> URL Configuration -> Redirect URLs
 *   3. the Google Cloud OAuth client's authorised redirect list
 */
const config: CapacitorConfig = {
  appId: 'app.gomsinlog',
  appName: '곰신로그',
  webDir: 'dist',

  server: {
    // https keeps the WebView on a secure origin, which localStorage,
    // crypto.subtle and MediaRecorder all require.
    androidScheme: 'https',
  },

  android: {
    // Avoid the mixed-content warnings that a self-signed dev server triggers.
    allowMixedContent: false,
  },

  plugins: {
    App: {
      // Deep link used to hand the OAuth result back to the app.
      customUrlScheme: 'gomsinlog',
    },
  },
};

export default config;
