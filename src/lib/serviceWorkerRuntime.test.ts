import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type FakeResponse = {
  source: 'network' | 'current' | 'stale' | 'error';
  ok: boolean;
  type: 'basic' | 'error';
  headers: { get(name: string): string | null };
  clone(): FakeResponse;
};

function response(source: FakeResponse['source'], options?: {
  ok?: boolean;
  type?: FakeResponse['type'];
  contentType?: string;
}): FakeResponse {
  const value: FakeResponse = {
    source,
    ok: options?.ok ?? true,
    type: options?.type ?? 'basic',
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return options?.contentType ?? 'image/png';
        return null;
      },
    },
    clone: () => value,
  };
  return value;
}

function loadFetchHandler({
  networkFetch,
  currentCacheMatch,
  globalCacheMatch,
  cachePut = async () => undefined,
}: {
  networkFetch: () => Promise<FakeResponse>;
  currentCacheMatch: () => Promise<FakeResponse | undefined>;
  globalCacheMatch: () => Promise<FakeResponse | undefined>;
  cachePut?: () => Promise<void>;
}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const currentCache = {
    addAll: async () => undefined,
    match: currentCacheMatch,
    put: cachePut,
  };
  const self = {
    location: { origin: 'https://app.test' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, listener);
    },
  };
  class Response {
    static error() {
      return response('error', { ok: false, type: 'error', contentType: '' });
    }
  }

  runInNewContext(
    readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8'),
    {
      self,
      caches: {
        open: async () => currentCache,
        keys: async () => [],
        delete: async () => true,
        match: globalCacheMatch,
      },
      fetch: networkFetch,
      URL,
      Response,
      Set,
      Promise,
    },
  );

  const handler = listeners.get('fetch');
  if (!handler) throw new Error('service-worker fetch handler is missing');
  return handler;
}

function loadActivationHandler() {
  const currentCacheName = 'gomsinlog-app-shell-current-build';
  const previousCacheName = 'gomsinlog-app-shell-previous-build';
  const entries = new Map<string, Map<string, FakeResponse>>([
    [currentCacheName, new Map()],
    [previousCacheName, new Map([
      ['/previous-only.js', response('stale', { contentType: 'text/javascript' })],
    ])],
  ]);
  const deleted: string[] = [];
  let clientsClaimed = 0;
  const listeners = new Map<string, (event: unknown) => void>();
  const cacheStorage = {
    async keys() {
      return [...entries.keys()];
    },
    async delete(name: string) {
      deleted.push(name);
      return entries.delete(name);
    },
    async open(name: string) {
      const cacheEntries = entries.get(name) ?? new Map<string, FakeResponse>();
      entries.set(name, cacheEntries);
      return {
        addAll: async () => undefined,
        match: async (request: string) => cacheEntries.get(request),
        put: async (request: string, value: FakeResponse) => {
          cacheEntries.set(request, value);
        },
      };
    },
    async match(request: string) {
      for (const cacheEntries of entries.values()) {
        const match = cacheEntries.get(request);
        if (match) return match;
      }
      return undefined;
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    clients: {
      claim: async () => {
        clientsClaimed += 1;
      },
    },
    skipWaiting: async () => undefined,
    addEventListener(name: string, listener: (event: unknown) => void) {
      listeners.set(name, listener);
    },
  };
  class Response {
    static error() {
      return response('error', { ok: false, type: 'error', contentType: '' });
    }
  }
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')
    .replace('__BUILD_ID__', 'current-build');

  runInNewContext(source, {
    self,
    caches: cacheStorage,
    fetch: async () => response('network'),
    URL,
    Response,
    Set,
    Promise,
  });

  const handler = listeners.get('activate');
  if (!handler) throw new Error('service-worker activate handler is missing');
  return {
    cacheStorage,
    currentCacheName,
    previousCacheName,
    deleted,
    entries,
    getClientsClaimed: () => clientsClaimed,
    handler,
  };
}

describe('service-worker runtime cache isolation', () => {
  it('deletes the previous app-shell cache before claiming clients', async () => {
    const worker = loadActivationHandler();
    let activation: Promise<unknown> | undefined;

    worker.handler({
      waitUntil(promise: Promise<unknown>) {
        activation = promise;
      },
    });

    expect(activation).toBeDefined();
    await activation;
    expect([...worker.entries.keys()]).toEqual([worker.currentCacheName]);
    expect(worker.deleted).toContain(worker.previousCacheName);
    await expect(worker.cacheStorage.match('/previous-only.js')).resolves.toBeUndefined();
    expect(worker.getClientsClaimed()).toBe(1);
  });

  it('does not serve a same-URL response from an unrelated stale cache after network failure', async () => {
    const handler = loadFetchHandler({
      networkFetch: async () => { throw new Error('network failed'); },
      currentCacheMatch: async () => undefined,
      globalCacheMatch: async () => response('stale'),
    });
    let responsePromise: Promise<FakeResponse> | undefined;

    handler({
      request: {
        method: 'GET',
        mode: 'no-cors',
        destination: 'image',
        url: 'https://app.test/assets/stale-release-image.png',
      },
      respondWith(promise: Promise<FakeResponse>) {
        responsePromise = promise;
      },
      waitUntil() {
        throw new Error('a failed request must not schedule a cache write');
      },
    });

    expect(responsePromise).toBeDefined();
    await expect(responsePromise).resolves.toMatchObject({ source: 'error' });
  });

  it('does not store an HTML SPA rewrite under a JavaScript asset cache key', async () => {
    let writes = 0;
    const handler = loadFetchHandler({
      networkFetch: async () => response('network', { contentType: 'text/html' }),
      currentCacheMatch: async () => undefined,
      globalCacheMatch: async () => undefined,
      cachePut: async () => { writes += 1; },
    });
    let responsePromise: Promise<FakeResponse> | undefined;
    const background: Promise<unknown>[] = [];

    handler({
      request: {
        method: 'GET',
        mode: 'no-cors',
        destination: 'script',
        url: 'https://app.test/assets/missing-release-chunk.js',
      },
      respondWith(promise: Promise<FakeResponse>) {
        responsePromise = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    });

    expect(responsePromise).toBeDefined();
    await responsePromise;
    await Promise.all(background);
    expect(writes).toBe(0);
  });
});
