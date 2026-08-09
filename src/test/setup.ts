import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
 * Node 26 ships an experimental built-in `localStorage` whose getter throws or
 * returns `undefined` unless the process was started with `--localstorage-file`.
 * That global is installed on `globalThis`, which jsdom's `window` inherits from
 * in Vitest's environment, so it SHADOWS the working jsdom implementation and
 * every suite dies in the shared `afterEach` below with
 * "Cannot read properties of undefined (reading 'clear')" -- including pure
 * date-formatting tests that never touch storage.
 *
 * CI pins Node 22, where jsdom's own implementation survives, so this is invisible
 * there and only breaks contributors on newer Node. Rather than pinning the local
 * toolchain, install a spec-compliant in-memory Storage whenever the inherited one
 * is unusable. Probed through an actual round-trip because merely being present is
 * not enough: jsdom also throws `SecurityError` for opaque origins.
 */
function inheritedStorageIsUsable(name: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const candidate = (window as unknown as Record<string, Storage | undefined>)[name];
    if (!candidate) return false;
    const probe = '__gomsinlog_storage_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/*
 * Two observable details of the real `Storage` are load-bearing for existing
 * suites, so the replacement reproduces both rather than being a plain object:
 *
 *   1. The methods live on the PROTOTYPE. `avatarImage.test.ts` simulates
 *      private-mode Safari with `vi.spyOn(Object.getPrototypeOf(localStorage),
 *      'setItem')`, which fails if the methods are own properties.
 *   2. Only stored keys are OWN ENUMERABLE properties, so `Object.keys(localStorage)`
 *      lists data keys and not the API surface.
 */
function createMemoryStorage(): Storage {
  // Held in a closure rather than on the target: a Proxy `ownKeys` trap must report
  // every non-configurable own property of its target, so any bookkeeping field
  // stored there would leak into `Object.keys(localStorage)` or throw a TypeError.
  const entries = new Map<string, string>();

  const prototype = {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      const stored = entries.get(String(key));
      return stored === undefined ? null : stored;
    },
    key(index: number): string | null {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(String(key));
    },
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value));
    },
  };

  const target = Object.create(prototype) as Record<string, unknown>;
  const isApi = (key: string | symbol) => typeof key === 'symbol' || key in prototype;

  // A Proxy, because the real thing exposes stored keys as indexed properties.
  return new Proxy(target, {
    get(receiver, key) {
      if (isApi(key)) {
        const value = Reflect.get(receiver, key);
        return value;
      }
      return entries.get(String(key));
    },
    set(receiver, key, value) {
      if (isApi(key)) return Reflect.set(receiver, key, value);
      entries.set(String(key), String(value));
      return true;
    },
    has: (receiver, key) => (isApi(key) ? Reflect.has(receiver, key) : entries.has(String(key))),
    deleteProperty(receiver, key) {
      if (isApi(key)) return Reflect.deleteProperty(receiver, key);
      entries.delete(String(key));
      return true;
    },
    ownKeys: () => Array.from(entries.keys()),
    getOwnPropertyDescriptor(receiver, key) {
      if (isApi(key)) return Reflect.getOwnPropertyDescriptor(receiver, key);
      if (!entries.has(String(key))) return undefined;
      return {
        value: entries.get(String(key)),
        configurable: true,
        enumerable: true,
        writable: true,
      };
    },
  }) as unknown as Storage;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (inheritedStorageIsUsable(name)) continue;
  const replacement = createMemoryStorage();
  // Defined on BOTH so bare `localStorage.x` and `window.localStorage.x` agree;
  // otherwise the Node global keeps winning for the unqualified form.
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: replacement,
    });
  }
}

// jsdom does not implement these, but the app touches them during render.
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!('crypto' in globalThis) || typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    writable: true,
    value: {
      ...(globalThis.crypto || {}),
      randomUUID: () => `test-${Math.random().toString(16).slice(2)}-uuid`,
      getRandomValues: (arr: Uint32Array) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 0xffffffff);
        return arr;
      },
    },
  });
}

if (typeof URL.createObjectURL !== 'function') {
  // @ts-expect-error -- jsdom stub
  URL.createObjectURL = () => 'blob:mock';
}
if (typeof URL.revokeObjectURL !== 'function') {
  // @ts-expect-error -- jsdom stub
  URL.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
