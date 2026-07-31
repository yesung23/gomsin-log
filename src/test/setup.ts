import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

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
