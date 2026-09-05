import { createHash, type Hash } from 'node:crypto';
import type { Plugin } from 'vite';

const OFFLINE_CRITICAL_MODULES = [
  '/src/pages/HomePage.tsx',
  '/src/pages/OnboardingPage.tsx',
  '/src/pages/RecordPage.tsx',
  '/src/features/compose/ComposePage.tsx',
] as const;

type BundleAsset = {
  type: 'asset';
  fileName: string;
};

type BundleChunk = {
  type: 'chunk';
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  dynamicImports?: string[];
  viteMetadata?: {
    importedCss?: Iterable<string>;
  };
};

export type ServiceWorkerOutputBundle = Record<string, BundleAsset | BundleChunk>;

export type ServiceWorkerBuildArtifact = {
  fileName: string;
  contents: string | Uint8Array;
};

function updateFramedHash(
  hash: Hash,
  label: string,
  value: string | Uint8Array,
): void {
  const byteLength = typeof value === 'string'
    ? Buffer.byteLength(value)
    : value.byteLength;
  hash.update(`${label}:${byteLength}:`);
  hash.update(value);
  hash.update('\n');
}

export function serializeServiceWorkerManifest(assetUrls: readonly string[]): string {
  return [...new Set(assetUrls)]
    .sort()
    .map((url) => JSON.stringify(url))
    .join(',\n  ');
}

/**
 * Derive the cache namespace before mutating the placeholder service worker.
 * The injected worker is deliberately excluded from `artifacts`: hashing its
 * own build id would create a circular dependency. Its original bytes and the
 * exact canonical manifest are covered as separate framed inputs instead.
 */
export function deriveServiceWorkerBuildId({
  artifacts,
  serviceWorkerTemplate,
  manifestAssetUrls,
}: {
  artifacts: readonly ServiceWorkerBuildArtifact[];
  serviceWorkerTemplate: string | Uint8Array;
  manifestAssetUrls: readonly string[];
}): string {
  const hash = createHash('sha256');
  hash.update('gomsinlog-service-worker-cache-v1\n');
  for (const artifact of [...artifacts].sort((left, right) => (
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0
  ))) {
    updateFramedHash(hash, 'artifact-name', artifact.fileName);
    updateFramedHash(hash, 'artifact-bytes', artifact.contents);
  }
  updateFramedHash(hash, 'service-worker-template', serviceWorkerTemplate);
  updateFramedHash(
    hash,
    'service-worker-manifest',
    serializeServiceWorkerManifest(manifestAssetUrls),
  );
  return hash.digest('hex').slice(0, 12);
}

export function serviceWorkerCloseBundleHook(
  handler: () => void,
): Plugin['closeBundle'] {
  return {
    order: 'post',
    sequential: true,
    handler,
  };
}

function normalizedModuleId(moduleId: string | null): string {
  return (moduleId ?? '').split('?')[0].replaceAll('\\', '/');
}

function assetUrl(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized.startsWith('assets/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe offline-critical asset path: ${fileName}`);
  }
  return `/${normalized}`;
}

/**
 * Return the static Rollup closure needed to enter the app and preserve its
 * smallest useful offline loop: Home -> write -> exact record. Signed-out
 * Onboarding remains available too. Truly dynamic descendants stay on-demand.
 */
export function collectOfflineCriticalAssetUrls(
  bundle: ServiceWorkerOutputBundle,
): string[] {
  const entries = new Map(
    Object.values(bundle).map((entry) => [entry.fileName, entry] as const),
  );
  const roots = OFFLINE_CRITICAL_MODULES.map((moduleSuffix) => {
    const root = Object.values(bundle).find((entry): entry is BundleChunk => (
      entry.type === 'chunk'
      && normalizedModuleId(entry.facadeModuleId).endsWith(moduleSuffix)
    ));
    if (!root) {
      throw new Error(`Offline-critical route chunk is missing: ${moduleSuffix}`);
    }
    return root.fileName;
  });

  const visited = new Set<string>();
  const urls = new Set<string>();

  const visit = (fileName: string) => {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    urls.add(assetUrl(fileName));

    const entry = entries.get(fileName);
    if (!entry || entry.type !== 'chunk') return;
    for (const imported of entry.imports) visit(imported);
    // `referencedFiles` / `importedAssets` deliberately stay out. Vite reports
    // every unicode-range font referenced by the shared stylesheet there; adding
    // them would turn a two-route shell back into a 7 MB whole-font download.
    // Images and font slices degrade gracefully offline, while JS and route CSS
    // are required for the screen to boot at all.
    for (const stylesheet of entry.viteMetadata?.importedCss ?? []) visit(stylesheet);
  };

  for (const root of roots) visit(root);
  return [...urls].sort();
}
