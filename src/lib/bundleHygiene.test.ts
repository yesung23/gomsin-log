import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * C5 bug condition:
 *   isBugConditionC5(build) = warnings CONTAINS mixedStaticDynamicImport
 *                         OR warnings CONTAINS largeChunk
 *
 * Measured on the unfixed tree: two mixed static/dynamic import warnings
 * (`@/lib/events` from three call sites in store.tsx, and `@capacitor/browser`
 * from supabase.ts) plus a ~520 kB / 151 kB gzip entry chunk.
 *
 * The build itself is asserted by the release gates, which capture the real
 * `npm run build` output. This suite pins the SOURCE conditions that produced
 * those warnings, so a reintroduction fails fast in the unit suite.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('C5 - no module is both statically and dynamically imported', () => {
  const store = read('src/lib/store.tsx');
  const supabase = read('src/lib/supabase.ts');

  it('store.tsx imports @/lib/events statically only', () => {
    expect(store).not.toMatch(/await import\(['"]@\/lib\/events['"]\)/);
    expect(store).not.toMatch(/import\(['"]@\/lib\/events['"]\)/);
    for (const named of ['saveEventToDB', 'updateEventInDB', 'deleteEventFromDB']) {
      expect(store, named).toContain(`  ${named},`);
    }
  });

  it('supabase.ts imports @capacitor/browser statically only', () => {
    expect(supabase).not.toMatch(/await import\(['"]@capacitor\/browser['"]\)/);
    expect(supabase).toContain("import { Browser } from '@capacitor/browser';");
  });

  it('PRESERVATION: each converted call site keeps its guard and failure path', () => {
    // The three event call sites keep their `isCurrentLinkedCouple` /
    // `isCurrentScope` guards and their `try`/`catch` blocks.
    expect(store).toContain('const saved = await saveEventToDB(newEvent);');
    expect(store).toContain('if (!isCurrentLinkedCouple(workspace) || !saved) return false;');
    expect(store).toContain('const saved = await updateEventInDB(updated);');
    expect(store).toContain('const deleted = await deleteEventFromDB(id);');
    expect(store).toContain('if (!isCurrentScope() || !deleted) return false;');
  });

  it('PRESERVATION: Browser.open still fires only under isNativePlatform()', () => {
    const native = supabase.slice(supabase.indexOf('const native = isNativePlatform();'));
    expect(native).toMatch(/if \(native && data\?\.url\) \{[\s\S]*?await Browser\.open\(/);
    expect(supabase).toContain('skipBrowserRedirect: native');
  });

  it('deepLinks.ts already had it in the eager graph, so there is no size regression', () => {
    expect(read('src/lib/deepLinks.ts')).toContain("from '@capacitor/browser'");
    expect(read('src/main.tsx')).toContain("@/lib/deepLinks");
  });
});

describe('C5 - vendor chunk splitting', () => {
  const viteConfig = read('vite.config.ts');

  it('splits by import identity so the entry chunk clears the warning threshold', () => {
    expect(viteConfig).toContain('manualChunks');
    for (const entry of [
      "'vendor-react'", "'vendor-supabase'", "'vendor-dnd'",
      "'vendor-date-fns'", "'vendor-icons'",
    ]) {
      expect(viteConfig, entry).toContain(entry);
    }
  });

  it('PRESERVATION: the service worker manifest still enumerates dist/assets recursively', () => {
    // Verified rather than assumed: new chunks must be cached, or an offline
    // activation would serve an index whose JS was never stored.
    expect(viteConfig).toContain('function listFiles(directory: string, prefix = \'\')');
    expect(viteConfig).toContain('listFiles(resolve(directory, entry.name), relativePath)');
    expect(viteConfig).toContain('const assetUrls = listFiles(assetsDirectory)');
    expect(viteConfig).toContain('Service worker build markers are missing.');
  });
});

describe('C5 - dependency posture is verified, not assumed', () => {
  const pkg = JSON.parse(read('package.json')) as {
    overrides?: Record<string, string>;
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(read('package-lock.json')) as {
    packages: Record<string, { version?: string }>;
  };

  it('pins brace-expansion to 1.1.18 on the 1.x line', () => {
    // Registry-verified: 1.1.18 exists on the 1.x line (5.0.9 on 5.x), which
    // supersedes the earlier audit conclusion that no patched 1.x release
    // existed. The 1.x line is kept so `minimatch@3`'s CJS `require` shape is
    // preserved; `npm run lint` at 0/0 is the proof, and it is a release gate.
    expect(pkg.overrides?.['brace-expansion']).toBe('1.1.18');
    const resolved = Object.entries(lock.packages)
      .filter(([name]) => name.endsWith('node_modules/brace-expansion'))
      .map(([, entry]) => entry.version);
    expect(resolved.length).toBeGreaterThan(0);
    for (const version of resolved) {
      expect(version).toBe('1.1.18');
      expect(version?.startsWith('1.')).toBe(true);
    }
  });

  it('PRESERVATION: react-router stays pinned at 7.18.2 and declarative', () => {
    expect(pkg.dependencies['react-router-dom']).toBe('7.18.2');
    expect(lock.packages['node_modules/react-router']?.version).toBe('7.18.2');
    expect(lock.packages['node_modules/react-router-dom']?.version).toBe('7.18.2');
    // The preconditions that make GHSA-qwww-vcr4-c8h2 inapplicable.
    expect(read('src/main.tsx')).toContain('BrowserRouter');
    const sources = ['src/main.tsx', 'src/App.tsx'].map(read).join('\n');
    for (const forbidden of ['useFetcher', 'createBrowserRouter', 'RouterProvider']) {
      expect(sources, forbidden).not.toContain(forbidden);
    }
  });

  it('records both advisory decisions where a maintainer will meet them', () => {
    const checklist = read('docs/kiro/SUPABASE_DEPLOYMENT_CHECKLIST.md');
    expect(checklist).toContain('GHSA-mh99-v99m-4gvg');
    expect(checklist).toContain('GHSA-qwww-vcr4-c8h2');
    expect(checklist).toContain('1.1.18');
    expect(checklist).toContain('invalidation trigger');
    expect(checklist).toContain('npm audit fix --force');
  });

  it('PRESERVATION: the Android shell and cap:* scripts are untouched', () => {
    const raw = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(raw.scripts['cap:sync']).toBe('npm run build && cap sync android');
    expect(raw.scripts['cap:open']).toBe('cap open android');
    expect(read('capacitor.config.ts')).toContain('appId');
  });
});
