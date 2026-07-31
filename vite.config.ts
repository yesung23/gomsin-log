import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'url';

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
 * Inject the complete hashed Vite asset graph into the generated service worker.
 * A waiting worker can then activate while offline without serving an index whose
 * JavaScript or CSS chunks were never cached.
 */
function injectServiceWorkerManifest(): Plugin {
  return {
    name: 'inject-service-worker-manifest',
    apply: 'build',
    closeBundle() {
      const outputDirectory = resolve(process.cwd(), 'dist');
      const assetsDirectory = resolve(outputDirectory, 'assets');
      const assetUrls = listFiles(assetsDirectory)
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

export default defineConfig({
  plugins: [react(), tailwindcss(), injectServiceWorkerManifest()],
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
