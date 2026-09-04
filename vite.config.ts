import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'url';
import {
  injectCspOrigins,
  type ValidatedBuildEnvironment,
} from './build/buildEnv';
import { createBuildEnvironmentValidationPlugin } from './build/viteBuildEnvironmentPlugin';
import {
  collectOfflineCriticalAssetUrls,
  deriveServiceWorkerBuildId,
  serializeServiceWorkerManifest,
  serviceWorkerCloseBundleHook,
  type ServiceWorkerBuildArtifact,
  type ServiceWorkerOutputBundle,
} from './build/serviceWorkerManifest';

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
 * Return only the hashed assets that the built HTML needs before React can run.
 * Lazy routes, feature chunks, artwork and font subsets remain on-demand and are
 * runtime-cached by `public/sw.js` after the browser actually requests them.
 */
function extractAppShellAssetUrls(indexHtml: string): string[] {
  const urls = new Set<string>();
  for (const match of indexHtml.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+)["']/g)) {
    const url = match[1];
    if (url.includes('..')) {
      throw new Error(`Built index contains an unsafe app-shell asset URL: ${url}`);
    }
    urls.add(url);
  }
  if (urls.size === 0) {
    throw new Error('Built index contains no app-shell assets to precache.');
  }
  return [...urls].sort();
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
 * Inject the eager, hashed app shell into the generated service worker.
 * A waiting worker can then activate while offline without serving an index whose
 * entry JavaScript or CSS was never cached, while lazy screens stay truly lazy.
 */
function injectServiceWorkerManifest(): Plugin {
  let offlineCriticalAssetUrls: string[] = [];
  return {
    name: 'inject-service-worker-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      offlineCriticalAssetUrls = collectOfflineCriticalAssetUrls(
        bundle as ServiceWorkerOutputBundle,
      );
    },
    closeBundle: serviceWorkerCloseBundleHook(() => {
      const outputDirectory = resolve(process.cwd(), 'dist');
      const assetsDirectory = resolve(outputDirectory, 'assets');
      const indexHtml = readFileSync(resolve(outputDirectory, 'index.html'), 'utf8');
      const assetUrls = [...new Set([
        ...extractAppShellAssetUrls(indexHtml),
        ...offlineCriticalAssetUrls,
      ])].sort();
      /*
       * A font that got inlined is a font that is downloaded on every load, which
       * silently undoes the `unicode-range` slicing. Nothing else in the pipeline
       * would notice -- the build succeeds, the page renders, and only a network
       * tab shows it. So fail here instead.
       */
      for (const file of listFiles(assetsDirectory)) {
        if (!file.endsWith('.css')) continue;
        const contents = readFileSync(resolve(assetsDirectory, file), 'utf8');
        if (/url\(\s*["']?data:(?:font|application\/font)/.test(contents)) {
          throw new Error(
            `A font was inlined into ${file}. Fonts must stay separate files so `
            + 'unicode-range can keep them off the critical path '
            + '(see build.assetsInlineLimit).',
          );
        }
      }
      const serviceWorkerPath = resolve(outputDirectory, 'sw.js');
      const serviceWorkerTemplate = readFileSync(serviceWorkerPath);
      const serviceWorker = serviceWorkerTemplate.toString('utf8');
      if (
        !serviceWorker.includes(SERVICE_WORKER_ASSET_MARKER)
        || !serviceWorker.includes(SERVICE_WORKER_BUILD_ID)
      ) {
        throw new Error('Service worker build markers are missing.');
      }
      const artifacts: ServiceWorkerBuildArtifact[] = listFiles(outputDirectory)
        .filter((file) => file !== 'sw.js')
        .map((file) => ({
          fileName: file,
          contents: readFileSync(resolve(outputDirectory, file)),
        }));
      const buildId = deriveServiceWorkerBuildId({
        artifacts,
        serviceWorkerTemplate,
        manifestAssetUrls: assetUrls,
      });
      const manifest = serializeServiceWorkerManifest(assetUrls);
      writeFileSync(
        serviceWorkerPath,
        serviceWorker
          .replace(SERVICE_WORKER_ASSET_MARKER, manifest)
          .replace(SERVICE_WORKER_BUILD_ID, buildId),
      );
    }),
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
    createBuildEnvironmentValidationPlugin({
      loadModeEnvironment: loadEnv,
      onValidated: (validated) => { validatedBuildEnvironment = validated; },
    }),
    // Order matters: CSP substitution must happen before the service-worker
    // build id is derived from the contents of `dist`.
    emitCspHeaders(() => validatedBuildEnvironment),
    injectServiceWorkerManifest(),
    failOnEmptyChunks(() => emptyChunkWarnings),
  ],
  build: {
    /*
     * Never inline a font, whatever its size.
     *
     * Vite inlines any asset under 4 kB as a base64 data URI. That is right for a
     * small icon and wrong for a font slice: the handwriting face is cut into 187
     * `unicode-range` slices precisely so a browser fetches only the few a screen
     * actually renders, and a slice living inside the stylesheet is fetched on
     * every single load no matter what its range says.
     *
     * It bit exactly one slice -- `hand-186`, the 12 rarest syllables at 3.7 kB --
     * which is the worst possible one to make unconditional. Base64 also adds ~33%,
     * so the cost was paid twice.
     *
     * `false` means "emit as a file"; `undefined` leaves every other asset on the
     * default rule.
     */
    assetsInlineLimit: (filePath: string) =>
      (/\.woff2?$/.test(filePath) ? false : undefined),
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
      'npm:@supabase/supabase-js@2.111.0': '@supabase/supabase-js',
      'npm:@supabase/supabase-js@2': '@supabase/supabase-js',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
} as any);
