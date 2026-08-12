import { defineConfig } from 'vitest/config';

/**
 * Isolated from the product test run on purpose.
 *
 * The root `vitest.config.ts` includes only `src/**`, so spike tests can never
 * enter `npm run test` or `npm run verify` by accident. This config is the only
 * way to execute them.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['spike/e2ee-1a1/tests/**/*.spike.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
