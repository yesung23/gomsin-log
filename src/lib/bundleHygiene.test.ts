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
    // The delete now carries the author as an ownership predicate (DEF-09); the
    // property this guard exists for -- a static call, awaited, result checked --
    // is unchanged.
    expect(store).toContain('const deleted = await deleteEventFromDB(id, identity.userId);');
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
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

  it('splits by import identity so the entry chunk clears the warning threshold', () => {
    expect(viteConfig).toContain('manualChunks');
    for (const entry of [
      "'vendor-react'", "'vendor-supabase'", "'vendor-dnd'", "'vendor-icons'",
    ]) {
      expect(viteConfig, entry).toContain(entry);
    }
  });

  it('names no package that is no longer installed at all', () => {
    // `'vendor-date-fns': ['date-fns']` survived here after nothing imported
    // date-fns any more, and rollup answered with `Generated an empty chunk:
    // "vendor-date-fns"` -- a 0.00 kB file that the service worker then precached
    // on every install. The build now fails on that warning (see
    // `failOnEmptyChunks`), and this is the cheap unit-level half of the guard.
    //
    // Resolved against the lockfile rather than `dependencies`, deliberately:
    // `react-router` is chunked with `react-router-dom` to keep the router in one
    // vendor chunk, and it is a transitive package, not a declared dependency.
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    const block = viteConfig.slice(
      viteConfig.indexOf('manualChunks: {'),
      viteConfig.indexOf('},', viteConfig.indexOf('manualChunks: {')),
    );
    const named = [...block.matchAll(/'([^']+)'/g)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith('vendor-'));
    expect(named.length).toBeGreaterThanOrEqual(6);
    expect(named).not.toContain('date-fns');
    for (const name of named) {
      expect(
        lock.packages[`node_modules/${name}`],
        `${name} is chunked but is not in the installed graph`,
      ).toBeDefined();
    }
  });

  it('drops the dependency an empty chunk pointed at, instead of only the chunk', () => {
    expect(pkg.dependencies['date-fns']).toBeUndefined();
    expect(read('package-lock.json')).not.toContain('node_modules/date-fns');
  });

  it('turns an empty chunk into a build failure rather than a printed warning', () => {
    // Verified against the real build, not assumed: with the entry still present
    // this guard aborted `npm run build` with
    // `[gomsinlog] build aborted: Generated an empty chunk: "vendor-date-fns"`.
    expect(viteConfig).toContain("warning.code === 'EMPTY_BUNDLE'");
    expect(viteConfig).toContain('/Generated an empty chunk/.test(warning.message');
    expect(viteConfig).toContain('function failOnEmptyChunks');
    expect(viteConfig).toContain('failOnEmptyChunks(() => emptyChunkWarnings)');
    // It must fail AFTER the write, or the only error the user sees is
    // injectServiceWorkerManifest() failing to scandir a dist that never existed.
    expect(viteConfig.indexOf('failOnEmptyChunks(() => emptyChunkWarnings)'))
      .toBeGreaterThan(viteConfig.indexOf('injectServiceWorkerManifest(),'));
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
    overrides?: Record<string, unknown>;
    dependencies: Record<string, string>;
  };
  const lock = JSON.parse(read('package-lock.json')) as {
    packages: Record<string, {
      version?: string;
      dependencies?: Record<string, string>;
    }>;
  };

  it('pins brace-expansion with a SCOPED override, not a global one', () => {
    // Registry-verified: 1.1.18 exists on the 1.x line (5.0.9 on 5.x), which
    // supersedes the earlier audit conclusion that no patched 1.x release
    // existed.
    //
    // The override MUST stay scoped to `minimatch@3`. A global
    // `{"brace-expansion": "1.1.18"}` also forced 1.1.18 into the `minimatch@10`
    // consumers, which declare `^5.0.5` / `^5.0.8` -- a dependency-range
    // violation, and a latent break because 1.x is a single CommonJS export
    // while 5.x uses named exports.
    expect(pkg.overrides).toEqual({
      // GHSA-5p4m-2wfm-xmqj / CVE-2026-59870 is fixed in 4.3.1. eslint
      // reaches it transitively, so keep the safe patch explicit until eslint
      // itself requires that line.
      'js-yaml': '4.3.1',
      'minimatch@3': { 'brace-expansion': '1.1.18' },
    });
    expect(pkg.overrides?.['brace-expansion']).toBeUndefined();
  });

  it('resolves every brace-expansion consumer inside its declared range', () => {
    // The invariant that actually matters, asserted structurally rather than by
    // pinning version numbers: nearest-ancestor resolution must satisfy the range
    // each consumer declares.
    const resolveFor = (consumer: string): string | undefined => {
      let parts = consumer.split('/');
      for (;;) {
        const candidate = [...parts, 'node_modules', 'brace-expansion'].join('/');
        if (lock.packages[candidate]) return lock.packages[candidate].version;
        const index = parts.lastIndexOf('node_modules');
        if (index < 0) return lock.packages['node_modules/brace-expansion']?.version;
        parts = parts.slice(0, index);
      }
    };

    const consumers = Object.entries(lock.packages)
      .filter(([, entry]) => entry.dependencies?.['brace-expansion']);
    expect(consumers.length).toBeGreaterThanOrEqual(3);

    let sawOneX = false;
    let sawFiveX = false;
    for (const [name, entry] of consumers) {
      const range = entry.dependencies!['brace-expansion'];
      const resolved = resolveFor(name);
      expect(resolved, `${name} requires ${range}`).toBeDefined();
      const major = Number(resolved!.split('.')[0]);
      const rangeMajor = Number(range.replace(/^[^0-9]*/, '').split('.')[0]);
      // Same major line as the declared range: this is what a global override
      // broke.
      expect(major, `${name} requires ${range} but resolved ${resolved}`).toBe(rangeMajor);
      if (major === 1) {
        sawOneX = true;
        // Patched on the 1.x line.
        expect(resolved).toBe('1.1.18');
      }
      if (major === 5) {
        sawFiveX = true;
        // 5.x is outside the advisory's affected ranges; 5.0.8+ satisfies both
        // declared ranges.
        expect(Number(resolved!.split('.')[2])).toBeGreaterThanOrEqual(8);
      }
    }
    expect(sawOneX, 'the vulnerable 1.x consumer must still be pinned').toBe(true);
    expect(sawFiveX, 'the 5.x consumers must keep their own major').toBe(true);
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
    // The scoped-override reasoning must be recorded, not just the version.
    expect(checklist).toContain('minimatch@3');
    expect(checklist).toContain('minimatch@10');
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
