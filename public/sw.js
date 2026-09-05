const CACHE_NAME = 'gomsinlog-app-shell-__BUILD_ID__';
const BUILD_ASSETS = [
  /* __BUILD_ASSETS__ */
];
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  ...BUILD_ASSETS,
];
const CACHEABLE_DESTINATIONS = new Set([
  'script',
  'style',
  'image',
  'font',
  'manifest',
]);

function responseMatchesDestination(request, response) {
  const contentType = (response.headers.get('Content-Type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const pathname = new URL(request.url).pathname;

  switch (request.destination) {
    case 'script':
      return pathname.startsWith('/assets/') && (
        contentType === 'text/javascript'
        || contentType === 'application/javascript'
        || contentType === 'application/ecmascript'
        || contentType === 'text/ecmascript'
        || contentType === 'application/wasm'
      );
    case 'style':
      return pathname.startsWith('/assets/') && contentType === 'text/css';
    case 'font':
      return pathname.startsWith('/assets/') && (
        contentType.startsWith('font/')
        || contentType === 'application/font-woff'
        || contentType === 'application/font-sfnt'
        || (contentType === 'application/octet-stream' && /\.woff2?$/.test(pathname))
      );
    case 'image':
      return contentType.startsWith('image/');
    case 'manifest':
      return contentType === 'application/manifest+json' || contentType === 'application/json';
    default:
      return false;
  }
}

async function matchCurrentCache(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

// Installation must fail if the offline shell cannot be cached. Silently
// accepting a partial cache installs a worker that promises offline support but
// cannot provide it.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Activate a new worker as soon as its app shell is completely cached.
//
// Authentication fixes must not wait for a person to notice an update toast:
// an older installed shell can otherwise keep sending a query for a column that
// the current API no longer has, even after the corrected site is deployed.
// All JavaScript assets are content-hashed, so the next navigation receives a
// matching index and bundle rather than a mixed release.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((name) => name === CACHE_NAME ? undefined : caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache navigation URLs. In particular, an OAuth callback can contain
  // a one-time authorization code in its query string; using it as a Cache
  // Storage key unnecessarily persists that sensitive value. Navigations are
  // network-first and fall back to the already-cached SPA shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () =>
        (await matchCurrentCache('/index.html')) ?? matchCurrentCache('/offline.html')),
    );
    return;
  }

  // Only immutable/static browser resources are runtime-cached. Same-origin API
  // responses and arbitrary GET endpoints pass through untouched.
  if (!CACHEABLE_DESTINATIONS.has(request.destination)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const cacheControl = response.headers.get('Cache-Control') || '';
        if (
          response.ok
          && response.type === 'basic'
          && !/\bno-store\b/i.test(cacheControl)
          && responseMatchesDestination(request, response)
        ) {
          // Clone synchronously, before returning the original response to the
          // browser. Cloning inside the later `caches.open().then(...)` callback
          // races with the browser consuming the body and throws
          // "Response body is already used" on real Chrome installations.
          const responseForCache = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseForCache)),
          );
        }
        return response;
      })
      .catch(async () => (await matchCurrentCache(request)) ?? Response.error()),
  );
});
