import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Design preview — deliberately SEPARATE from the production app.
 *
 * `npm run build` uses the repository root `vite.config.ts` and never sees this
 * file, so nothing here can reach `dist/`. There is no Supabase client, no store,
 * no router and no production route: the screens below are fed by static fixtures
 * in `fixtures.ts`, so opening the preview cannot read or write real user data.
 *
 * Run it with:
 *   npx vite --config design-preview/vite.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: { port: 5199, open: false },
});
