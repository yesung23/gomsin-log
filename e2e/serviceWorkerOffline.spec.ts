import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { installMockBackend, SUPABASE_URL } from './fixtures/mockBackend';
import { CREATOR, NO_SPACE } from './scenarios';

async function waitForActiveWorker(page: Page) {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
    return true;
  });
}

async function reloadWithoutNetworkOrHttpCache(context: BrowserContext, page: Page) {
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.clearBrowserCache');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function registerWorkerWithoutLoadingTheApp(page: Page) {
  await page.goto('/offline.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
}

test('a fresh worker boots the onboarding shell after the network and HTTP cache disappear', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await installMockBackend(context, NO_SPACE);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.clear());

  await page.goto('/');
  const landingCopy = page.getByText('답장이 늦어도, 서로의 하루를 이어 둘만의 기억으로 남겨요.');
  await expect(landingCopy).toBeVisible({ timeout: 20_000 });
  await waitForActiveWorker(page);
  await reloadWithoutNetworkOrHttpCache(context, page);

  await expect(landingCopy).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: '문제가 발생했어요' })).toHaveCount(0);
  await context.close();
});

test('a fresh worker boots authenticated Home after the network and HTTP cache disappear', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await installMockBackend(context, CREATOR);
  const page = await context.newPage();

  await page.goto('/us');
  const bottomNavigation = page.getByRole('navigation', { name: '하단 내비게이션' });
  await expect(bottomNavigation).toBeVisible({ timeout: 20_000 });
  await expect(bottomNavigation.getByRole('link', { name: '우리' }))
    .toHaveAttribute('aria-current', 'page');
  await waitForActiveWorker(page);

  const homeChunk = await page.evaluate(async () => {
    const cacheName = (await caches.keys())
      .find((name) => name.startsWith('gomsinlog-app-shell-'));
    if (!cacheName) return null;
    const requests = await (await caches.open(cacheName)).keys();
    return requests
      .map((request) => new URL(request.url).pathname)
      .find((pathname) => /\/HomePage-[^/]+\.js$/.test(pathname)) ?? null;
  });
  expect(homeChunk).not.toBeNull();
  const homeWasLoadedByThePage = await page.evaluate((chunkPath) => (
    performance.getEntriesByName(new URL(chunkPath!, location.origin).href).length
  ), homeChunk);
  expect(homeWasLoadedByThePage).toBe(0);

  await context.unrouteAll({ behavior: 'wait' });
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.clearBrowserCache');
  await context.setOffline(true);
  const backendUnavailable = await page.evaluate(async (supabaseUrl) => {
    try {
      await fetch(`${supabaseUrl}/auth/v1/user`, { cache: 'no-store' });
      return false;
    } catch {
      return true;
    }
  }, SUPABASE_URL);
  expect(backendUnavailable).toBe(true);

  await bottomNavigation.getByRole('link', { name: '홈' }).click();
  await expect(page.getByTestId('home-core')).toBeVisible({ timeout: 20_000 });
  await expect(bottomNavigation.getByRole('link', { name: '홈' }))
    .toHaveAttribute('aria-current', 'page');
  const homeChunkTiming = await page.waitForFunction((chunkPath) => {
    const entry = performance.getEntriesByName(
      new URL(chunkPath as string, location.origin).href,
    )[0] as PerformanceResourceTiming | undefined;
    return entry
      ? { workerStart: entry.workerStart, transferSize: entry.transferSize }
      : null;
  }, homeChunk).then((handle) => handle.jsonValue() as Promise<{
    workerStart: number;
    transferSize: number;
  }>);
  expect(homeChunkTiming.workerStart).toBeGreaterThan(0);
  expect(homeChunkTiming.transferSize).toBe(0);
  await context.close();
});

test('an HTML rewrite response can never poison a missing JavaScript asset cache key', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await installMockBackend(context, NO_SPACE);
  const missingAssetUrl = 'http://127.0.0.1:4173/assets/missing-release-chunk.js';
  await context.route(missingAssetUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>SPA fallback must not be cached as JavaScript</title>',
    });
  });
  const page = await context.newPage();

  await page.goto('/');
  await waitForActiveWorker(page);
  await page.addScriptTag({ url: missingAssetUrl }).catch(() => undefined);

  const cachedContentType = await page.evaluate(async (assetUrl) => {
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const cacheName = (await caches.keys())
        .find((name) => name.startsWith('gomsinlog-app-shell-'));
      const cached = cacheName
        ? await (await caches.open(cacheName)).match(assetUrl)
        : undefined;
      if (cached) return cached.headers.get('Content-Type');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }, missingAssetUrl);

  await context.close();
  expect(cachedContentType).toBeNull();
});

test('activating a fresh worker deletes the previous app-shell namespace', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto('/offline.html', { waitUntil: 'domcontentloaded' });
  const staleCacheName = 'gomsinlog-app-shell-stale-build';
  const staleOnlyUrl = 'http://127.0.0.1:4173/assets/stale-only.js';

  await page.evaluate(async ({ cacheName, assetUrl }) => {
    const staleCache = await caches.open(cacheName);
    await staleCache.put(assetUrl, new Response('stale release'));
  }, { cacheName: staleCacheName, assetUrl: staleOnlyUrl });
  const staleCacheVisible = await page.evaluate(async (assetUrl) => ({
    keys: await caches.keys(),
    globallyMatched: Boolean(await caches.match(assetUrl)),
  }), staleOnlyUrl);
  expect(staleCacheVisible.keys).toContain(staleCacheName);
  expect(staleCacheVisible.globallyMatched).toBe(true);

  await registerWorkerWithoutLoadingTheApp(page);
  await expect.poll(() => page.evaluate(async ({ cacheName, assetUrl }) => ({
    keys: await caches.keys(),
    globallyMatched: Boolean(await caches.match(assetUrl)),
    currentCacheCount: (await caches.keys())
      .filter((name) => name.startsWith('gomsinlog-app-shell-') && name !== cacheName)
      .length,
  }), { cacheName: staleCacheName, assetUrl: staleOnlyUrl })).toEqual({
    keys: expect.not.arrayContaining([staleCacheName]),
    globallyMatched: false,
    currentCacheCount: 1,
  });

  await context.close();
});
