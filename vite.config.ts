import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'url';
import {
  injectCspOrigins,
  validateBuildEnvironment,
  type ValidatedBuildEnvironment,
} from './build/buildEnv';

const SERVICE_WORKER_ASSET_MARKER = '/* __BUILD_ASSETS__ */';
const SERVICE_WORKER_BUILD_ID = '__BUILD_ID__';

function listFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(resolve(directory, entry.name), relativePath)
      : [relativePath];
  });
}

/**
 * Refuse to produce a production artifact from an unusable configuration.
 *
 * A build with no Supabase URL/key used to succeed and emit a bundle that was
 * permanently stuck in demo mode. Scoped to `apply: 'build'` and production
 * mode, so `vite dev` is unaffected; `npm test` loads `vitest.config.ts` and
 * cannot be affected at all.
 */
function validateBuildEnvironmentPlugin(
  onValidated: (validated: ValidatedBuildEnvironment) => void,
): Plugin {
  return {
    name: 'validate-build-environment',
    apply: 'build',
    config(_config, { mode }) {
      if (mode !== 'production') return;
      // Vite loads `.env*` after resolving the config, so values from a local
      // `.env` are not present in `process.env` here. Read them explicitly while
      // still giving CI/Vercel environment variables precedence.
      const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
      const validated = validateBuildEnvironment({
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
        VITE_SUPABASE_ANON_KEY:
          process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY,
        VITE_LEGAL_OPERATOR_NAME:
          process.env.VITE_LEGAL_OPERATOR_NAME || fileEnv.VITE_LEGAL_OPERATOR_NAME,
        VITE_PRIVACY_CONTACT_EMAIL:
          process.env.VITE_PRIVACY_CONTACT_EMAIL || fileEnv.VITE_PRIVACY_CONTACT_EMAIL,
        deploymentTarget: process.env.VERCEL_ENV,
      });
      onValidated(validated);
    },
  };
}

/**
 * Substitute the CSP marker tokens in `dist/_headers`.
 *
 * Registered BEFORE `injectServiceWorkerManifest()` so its `closeBundle` runs
 * first: that plugin hashes every file in `dist` except `sw.js` to derive
 * `SERVICE_WORKER_BUILD_ID`, and `_headers` is one of them, so substituting
 * afterwards would make the build id reflect pre-substitution content.
 */
function emitCspHeaders(getValidated: () => ValidatedBuildEnvironment | null): Plugin {
  return {
    name: 'emit-csp-headers',
    apply: 'build',
    closeBundle() {
      const validated = getValidated();
      if (!validated) return;
      const headersPath = resolve(process.cwd(), 'dist', '_headers');
      const headers = readFileSync(headersPath, 'utf8');
      writeFileSync(headersPath, injectCspOrigins(headers, validated));
    },
  };
}

/**
 * Inject the hashed Vite asset graph into the generated service worker.
 * A waiting worker can then activate while offline without serving an index whose
 * JavaScript or CSS chunks were never cached. Fonts are the one deliberate
 * exclusion — see the comment on `isPrecachedAsset` below.
 */
function injectServiceWorkerManifest(): Plugin {
  return {
    name: 'inject-service-worker-manifest',
    apply: 'build',
    closeBundle() {
      const outputDirectory = resolve(process.cwd(), 'dist');
      const assetsDirectory = resolve(outputDirectory, 'assets');
      // Fonts are deliberately NOT precached. The self-hosted Pretendard dynamic
      // subset is 92 files / ~2.9 MB, and `install` in sw.js uses
      // `cache.addAll()`, which is all-or-nothing: precaching them would turn
      // every first visit into a multi-megabyte download and make installation
      // fail outright on a flaky connection. sw.js already runtime-caches any
      // response whose request destination is 'font', so the handful of subsets a
      // session actually rendered are available offline from then on, and the
      // `unicode-range` metadata means a browser never asks for the rest.
      const isPrecachedAsset = (file: string) => !/\.woff2?$/.test(file);
      const assetUrls = listFiles(assetsDirectory)
        .filter(isPrecachedAsset)
        .sort()
        .map((file) => `/assets/${file}`);
      const buildHash = createHash('sha256');
      for (const file of listFiles(outputDirectory).sort()) {
        if (file === 'sw.js') continue;
        buildHash.update(file);
        buildHash.update(readFileSync(resolve(outputDirectory, file)));
      }
      const buildId = buildHash.digest('hex').slice(0, 12);
      const serviceWorkerPath = resolve(outputDirectory, 'sw.js');
      const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
      if (
        !serviceWorker.includes(SERVICE_WORKER_ASSET_MARKER)
        || !serviceWorker.includes(SERVICE_WORKER_BUILD_ID)
      ) {
        throw new Error('Service worker build markers are missing.');
      }
      const manifest = assetUrls.map((url) => JSON.stringify(url)).join(',\n  ');
      writeFileSync(
        serviceWorkerPath,
        serviceWorker
          .replace(SERVICE_WORKER_ASSET_MARKER, manifest)
          .replace(SERVICE_WORKER_BUILD_ID, buildId),
      );
    },
  };
}

/**
 * Turn `Generated an empty chunk: "..."` into a build failure.
 *
 * An empty chunk means a `manualChunks` entry names a package that nothing in
 * the eager graph imports. It is dead weight in the service-worker precache
 * manifest and a signal that the dependency is unused or no longer reachable,
 * and `npm run build` used to print it and exit 0.
 *
 * Registered LAST so the other `closeBundle` hooks -- which rollup runs in
 * parallel -- have already done their work against a fully written `dist`. The
 * write itself is allowed to complete for the same reason: this failure must
 * report the empty chunk, not a downstream scandir error.
 */
function failOnEmptyChunks(getWarnings: () => string[]): Plugin {
  return {
    name: 'fail-on-empty-chunks',
    apply: 'build',
    closeBundle() {
      const warnings = getWarnings();
      if (warnings.length === 0) return;
      const listed = warnings.map((message) => message.replace(/\.$/, '')).join('; ');
      throw new Error(
        `[gomsinlog] build aborted: ${listed}. A manualChunks entry names a `
        + 'package that nothing in the eager graph imports. Remove the entry, and the '
        + 'dependency too if it is unused.',
      );
    },
  };
}

let validatedBuildEnvironment: ValidatedBuildEnvironment | null = null;
const emptyChunkWarnings: string[] = [];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    validateBuildEnvironmentPlugin((validated) => { validatedBuildEnvironment = validated; }),
    // Order matters: CSP substitution must happen before the service-worker
    // build id is derived from the contents of `dist`.
    emitCspHeaders(() => validatedBuildEnvironment),
    injectServiceWorkerManifest(),
    failOnEmptyChunks(() => emptyChunkWarnings),
  ],
  build: {
    rollupOptions: {
      /**
       * An entry in `manualChunks` that no module in the eager graph actually
       * imports produces `Generated an empty chunk: "..."`, which every gate in
       * this repository was happy to print and pass.
       *
       * Recorded here and turned into a failure by `failOnEmptyChunks()` rather
       * than thrown on the spot: throwing from `onwarn` aborts the write, and the
       * only error the user then sees is `injectServiceWorkerManifest()` failing
       * to scandir a `dist/assets` that was never written -- the real reason
       * disappears.
       */
      onwarn(warning: Rollup.RollupLog, defaultHandler: (log: Rollup.RollupLog) => void) {
        if (
          warning.code === 'EMPTY_BUNDLE'
          || /Generated an empty chunk/.test(warning.message ?? '')
        ) {
          emptyChunkWarnings.push(warning.message ?? String(warning.code));
        }
        defaultHandler(warning);
      },
      output: {
        /**
         * Split by import identity so the entry chunk stops crossing the 500 kB
         * warning threshold. Module evaluation order does not change
         * observably: these are all library entry points that were already in
         * the eager graph.
         */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/.codex-runtime/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
} as any);
