import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser regression suite.
 *
 * Deliberately separate from `vitest.config.ts`: `npm test` stays a fast jsdom
 * suite, and this proves the things jsdom structurally cannot -- real layout at
 * real viewports, real hit-testing (`elementFromPoint`), real focus order, real
 * CSS cascade, and the real production bundle.
 *
 * The server under test is the PRODUCTION build with public placeholder
 * environment values, so `isSupabaseConfigured` is true and the configured code
 * paths run -- not the demo fallback. All network is intercepted per browser
 * context (see e2e/fixtures/mockBackend.ts). No real Supabase project is
 * contacted and no credential is required.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: './e2e/.artifacts/html', open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    /*
     * The browser's clock must agree with the fixtures' clock.
     *
     * `e2e/scenarios.ts` builds `TODAY` in `Asia/Seoul` on purpose -- the product's
     * calendar is Korean-local -- but the browser was left on the runner's zone,
     * which is UTC. Between 00:00 and 08:59 KST those are different DATES, so the
     * fixtures wrote records dated 8월 9일 while `localToday()` in the app asked
     * for 8월 8일, the 기록 tab answered `이 날은 남긴 순간이 없어요`, and eight
     * date-dependent specs failed on a product that was behaving correctly.
     *
     * Fixing only the fixture side (which is what the comment in scenarios.ts
     * describes) moved the mismatch rather than removing it: both ends have to name
     * the same zone. Pinning it here also makes the suite deterministic on any
     * machine, instead of passing in Seoul and failing in CI.
     */
    timezoneId: 'Asia/Seoul',
    locale: 'ko-KR',
  },
  projects: [
    {
      name: 'chromium-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key_not_a_secret',
    },
  },
});
