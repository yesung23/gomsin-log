import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Bug condition:
 *   isBugCondition(tree) = some client route of the deployed SPA is answered by
 *                          the hosting platform's own 404 instead of `index.html`
 *                       OR the platform ships none of the security headers in
 *                          `public/_headers`.
 *
 * Measured on the unfixed tree: the repository contained NO history-fallback
 * configuration for any platform -- no `public/_redirects`, no `vercel.json`, no
 * `netlify.toml`. `src/App.tsx` declares `/auth/callback`, `/legal/:doc`,
 * `/trips/:id`, `/settings` and the tab routes, none of which exist as a file in
 * `dist`, so a direct navigation returned the host's 404 and the app never
 * booted.
 *
 * Why that is release-blocking rather than cosmetic: `authRedirectUrl()` in
 * `src/lib/platform.ts` hands Supabase `${window.location.origin}/auth/callback`,
 * so every web OAuth and magic-link sign-in returns to that URL as a fresh
 * top-level navigation. On a static host with no fallback, web sign-in cannot
 * complete at all.
 *
 * Why the service worker did not cover for it: `public/sw.js` serves navigations
 * network-first and falls back to the cached shell only when `fetch` REJECTS. A
 * 404 is a resolved response, so the host's 404 page is returned even to a client
 * with the worker already installed.
 *
 * Nothing caught it: `_headers` is asserted by `cspExternalResources.test.ts`,
 * the CI CSP scan reads `dist/_headers`, and both are blind to routing and to
 * platforms that ignore `_headers`. `npm run build`, typecheck, lint and 1,070
 * unit tests all pass with every client route 404ing in production.
 */

/**
 * Vercel reads `vercel.json` from the repository before the build runs, so the
 * `VITE_SUPABASE_URL` substitution that `vite.config.ts` performs on
 * `dist/_headers` cannot reach it. These are the deliberate stand-ins, and they
 * mirror `injectCspOrigins()`: the HTTP marker becomes the origin, the connect
 * marker becomes the origin plus its websocket origin.
 *
 * The trade-off is explicit: host-restricted to Supabase, but not pinned to one
 * project. A platform that honours `_headers` still gets the exact origin.
 */
const VERCEL_MARKER_SUBSTITUTIONS = new Map([
  ['__SUPABASE_HTTP_SRC__', 'https://*.supabase.co'],
  ['__SUPABASE_CONNECT_SRC__', 'https://*.supabase.co wss://*.supabase.co'],
]);

type VercelConfig = {
  rewrites?: { source: string; destination: string }[];
  headers?: { source: string; headers: { key: string; value: string }[] }[];
};

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

/** `name -> value` for one path block of a `_headers` file, comments dropped. */
function parseUnderscoreHeaders(source: string, path: string): Map<string, string> {
  const lines = source.split(/\r?\n/).filter((line) => !line.trim().startsWith('#'));
  const start = lines.findIndex((line) => line.trim() === path);
  if (start < 0) throw new Error(`public/_headers has no block for ${path}`);
  const headers = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    // A non-indented line starts the next path block.
    if (!/^\s/.test(line)) break;
    const separator = line.indexOf(':');
    if (separator < 0) throw new Error(`Unparseable _headers line: ${line}`);
    headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

function substituteMarkers(value: string): string {
  let substituted = value;
  for (const [marker, replacement] of VERCEL_MARKER_SUBSTITUTIONS) {
    substituted = substituted.split(marker).join(replacement);
  }
  return substituted;
}

const underscoreHeaders = parseUnderscoreHeaders(read('public/_headers'), '/*');
const vercel = JSON.parse(read('vercel.json')) as VercelConfig;

describe('every documented hosting platform gets an SPA history fallback', () => {
  it('_headers-aware platforms get one from public/_redirects', () => {
    expect(existsSync(resolve(process.cwd(), 'public/_redirects'))).toBe(true);
    const rules = read('public/_redirects')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules).toEqual(['/*    /index.html    200']);
    // `!` would shadow real files, so `/assets/*` and `/sw.js` would stop being
    // served. The rule must stay unforced.
    expect(rules[0]).not.toContain('!');
  });

  it('Vercel gets one from vercel.json, because it ignores both underscore files', () => {
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('the fallback is load-bearing: no client route exists as a shipped file', () => {
    const app = read('src/App.tsx');
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path !== '*' && path !== '/');
    // The routes that make this a production defect rather than a nicety.
    expect(paths).toContain('/auth/callback');
    expect(paths).toContain('/legal/:doc');
    expect(paths.length).toBeGreaterThanOrEqual(10);
    for (const path of paths) {
      const asFile = resolve(process.cwd(), 'public', path.replace(/^\//, ''));
      expect(existsSync(asFile), `${path} unexpectedly exists in public/`).toBe(false);
    }
  });

  it('PRESERVATION: web sign-in still returns to /auth/callback on the app origin', () => {
    // This is the precondition that makes a missing fallback break sign-in. If it
    // ever changes, this suite's reasoning has to be revisited, not silently kept.
    expect(read('src/lib/platform.ts'))
      .toContain('return `${window.location.origin}/auth/callback`;');
  });

  it('PRESERVATION: the service worker still cannot mask a 404 navigation', () => {
    // Network-first with a fallback only on rejection. A resolved 404 passes
    // straight through, which is why hosting configuration -- not the worker --
    // has to fix this.
    const serviceWorker = read('public/sw.js');
    expect(serviceWorker).toContain("if (request.mode === 'navigate')");
    expect(serviceWorker).toContain('fetch(request).catch(async () =>');
  });

  it('clones cacheable responses before the browser can consume their bodies', () => {
    const serviceWorker = read('public/sw.js');
    const cloneAt = serviceWorker.indexOf('const responseForCache = response.clone();');
    const asyncCacheAt = serviceWorker.indexOf('caches.open(CACHE_NAME).then((cache) => cache.put(request, responseForCache))');
    expect(cloneAt).toBeGreaterThan(-1);
    expect(asyncCacheAt).toBeGreaterThan(cloneAt);
    expect(serviceWorker).not.toContain('cache.put(request, response.clone())');
  });
});

describe('vercel.json carries the same security headers as public/_headers', () => {
  const block = vercel.headers?.find((entry) => entry.source === '/(.*)');

  it('applies them to every path', () => {
    expect(block, 'vercel.json has no catch-all headers block').toBeDefined();
  });

  it('ships exactly the same header names, in the same order', () => {
    expect(block!.headers.map((header) => header.key)).toEqual([...underscoreHeaders.keys()]);
  });

  it('ships the same value for each header, with the build-time markers resolved', () => {
    for (const { key, value } of block!.headers) {
      const expected = substituteMarkers(underscoreHeaders.get(key)!);
      expect(value, `${key} drifted from public/_headers`).toBe(expected);
    }
  });

  it('leaves no unsubstituted marker, which a browser would reject as an origin', () => {
    const raw = read('vercel.json');
    for (const marker of VERCEL_MARKER_SUBSTITUTIONS.keys()) {
      expect(raw, `${marker} survived into vercel.json`).not.toContain(marker);
    }
  });

  it('keeps every stand-in host-restricted to Supabase', () => {
    // A widening from one project to any Supabase project is the accepted cost.
    // A widening to `*`, `https:` or `data:` is not, so it fails here.
    for (const replacement of VERCEL_MARKER_SUBSTITUTIONS.values()) {
      for (const token of replacement.split(' ')) {
        expect(token, `${token} is not host-restricted`).toMatch(
          /^(https|wss):\/\/\*\.supabase\.co$/,
        );
      }
    }
  });

  it('does not commit a real project URL, which _headers is also careful never to do', () => {
    // The character class deliberately excludes `*`, so the documented wildcard
    // does not match and any concrete project host does.
    const concreteProjectHosts = read('vercel.json').match(/[a-z0-9-]+\.supabase\.co/g) ?? [];
    expect(concreteProjectHosts).toEqual([]);
  });
});
