import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bug condition:
 *   isBugCondition(tree) = some shipped document/stylesheet loads a subresource
 *                          from an origin that the CSP in `public/_headers`
 *                          does not permit for that resource's directive.
 *
 * Measured on the unfixed tree: `index.html` loaded Pretendard from
 * `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/...`, while the CSP
 * shipped `style-src 'self' 'unsafe-inline'` and `font-src 'self' data:`. On every
 * platform that honours `_headers` (Netlify, Cloudflare Pages) the browser blocked
 * the stylesheet AND every font file it referenced, so the entire app rendered in
 * a system font.
 *
 * Nothing caught it: `buildEnv.test.ts` only checks that the marker tokens and no
 * real project URL are present, and typecheck, lint, the 1000+ unit tests and the
 * production build all passed while the defect shipped. This suite closes that
 * gap by comparing the two files against each other instead of each on its own.
 */

const CSP_ALLOWED_TOKENS = new Set([
  "'self'",
  "'unsafe-inline'",
  "'none'",
  'data:',
  'blob:',
]);

/** Origins the CSP may name, each with the reason it is there. */
const DOCUMENTED_THIRD_PARTY_ORIGINS = new Map([
  // Substituted at build time from VITE_SUPABASE_URL by vite.config.ts.
  ['__SUPABASE_HTTP_SRC__', 'Supabase origin marker'],
  ['__SUPABASE_CONNECT_SRC__', 'Supabase origin + websocket marker'],
]);

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function parseCsp(headers: string): Map<string, string[]> {
  const line = headers
    .split(/\r?\n/)
    .map((raw) => raw.trim())
    .find((raw) => raw.startsWith('Content-Security-Policy:'));
  if (!line) throw new Error('public/_headers ships no Content-Security-Policy.');
  const policy = line.slice('Content-Security-Policy:'.length).trim();
  const directives = new Map<string, string[]>();
  for (const directive of policy.split(';')) {
    const [name, ...values] = directive.trim().split(/\s+/).filter(Boolean);
    if (name) directives.set(name, values);
  }
  return directives;
}

/** Every absolute http(s) URL an HTML document or a CSS file asks the browser for. */
function externalUrls(source: string): string[] {
  const matches = source.match(/https?:\/\/[^"'\s)]+/g) ?? [];
  return matches.filter((url) => {
    // A URL inside an HTML comment or a CSS comment is documentation, not a
    // subresource request, and neither is an og/meta value or a licence link.
    const index = source.indexOf(url);
    const before = source.slice(0, index);
    const inHtmlComment = before.lastIndexOf('<!--') > before.lastIndexOf('-->');
    const inCssComment = before.lastIndexOf('/*') > before.lastIndexOf('*/');
    return !inHtmlComment && !inCssComment;
  });
}

describe('the shipped CSP and the resources the app actually loads agree', () => {
  const csp = parseCsp(read('public/_headers'));

  it('every origin the CSP names is documented', () => {
    for (const [directive, values] of csp) {
      for (const value of values) {
        if (CSP_ALLOWED_TOKENS.has(value)) continue;
        expect(
          DOCUMENTED_THIRD_PARTY_ORIGINS.has(value),
          `${directive} names undocumented origin ${value}`,
        ).toBe(true);
      }
    }
  });

  it('style-src and font-src name no third-party origin, so fonts must be self-hosted', () => {
    for (const directive of ['style-src', 'font-src']) {
      const values = csp.get(directive);
      expect(values, `${directive} is missing from the CSP`).toBeDefined();
      for (const value of values!) {
        expect(
          CSP_ALLOWED_TOKENS.has(value),
          `${directive} allows ${value}; a self-hosted font needs no such origin`,
        ).toBe(true);
      }
    }
  });

  it('index.html requests nothing from another origin', () => {
    // This is the exact assertion the jsdelivr <link> would have failed.
    expect(externalUrls(read('index.html'))).toEqual([]);
  });

  it('offline.html requests nothing from another origin', () => {
    // It has to render with no network at all, so it may not depend on one.
    expect(externalUrls(read('public/offline.html'))).toEqual([]);
  });

  it('has no external placeholder media or unauthenticated product shortcut', () => {
    const store = read('src/lib/store.tsx');
    expect(externalUrls(store)).toEqual([]);
    expect(read('src/pages/OnboardingPage.tsx')).not.toMatch(/둘러보기/);
  });

  it('the app stylesheet pulls Pretendard from the package, not from a CDN', () => {
    const css = read('src/styles/index.css');
    expect(css).toContain('@import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"');
    expect(externalUrls(css)).toEqual([]);
    // The family the @font-face rules define must still be the one --font-sans asks for.
    expect(css).toContain('"Pretendard Variable"');
  });

  it('pretendard is a pinned direct dependency, not a floating range', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.pretendard).toBe('1.3.9');
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages['node_modules/pretendard']?.version).toBe('1.3.9');
  });
});

describe('the service worker precache stays an app shell', () => {
  const viteConfig = read('vite.config.ts');
  const serviceWorker = read('public/sw.js');

  it('excludes fonts from the all-or-nothing install list', () => {
    // 92 subset files / ~2.9 MB behind `cache.addAll()` would make a first visit
    // a multi-megabyte download and fail installation on a flaky connection.
    expect(viteConfig).toContain('const isPrecachedAsset = (file: string) => !/\\.woff2?$/.test(file)');
    expect(viteConfig).toContain('.filter(isPrecachedAsset)');
  });

  it('PRESERVATION: fonts are still runtime-cached, so offline keeps working', () => {
    // The exclusion above is only safe because of this.
    const destinations = serviceWorker.slice(
      serviceWorker.indexOf('const CACHEABLE_DESTINATIONS'),
      serviceWorker.indexOf(']))'),
    );
    expect(destinations).toContain("'font'");
  });

  it('PRESERVATION: script, style and image chunks are still precached', () => {
    expect(viteConfig).toContain('const assetUrls = listFiles(assetsDirectory)');
    expect(viteConfig).toContain('Service worker build markers are missing.');
    expect(serviceWorker).toContain('...BUILD_ASSETS,');
  });
});
