import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProtectedE2eeLocalState } from './protectedLocalState';

function storedCiphertextHarness() {
  const getRequest = {
    result: {
      key: 'test-installation:test-user:v1',
      nonce: new Uint8Array(12),
      ciphertext: new Uint8Array([1]),
    },
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest;
  const transaction = {
    error: null,
    objectStore: vi.fn(() => ({
      get: vi.fn(() => {
        queueMicrotask(() => {
          getRequest.onsuccess?.call(getRequest, new Event('success'));
          transaction.oncomplete?.call(transaction, new Event('complete'));
        });
        return getRequest;
      }),
    })),
    oncomplete: null,
    onabort: null,
  } as unknown as IDBTransaction;
  const database = {
    objectStoreNames: { contains: vi.fn(() => true) },
    transaction: vi.fn(() => transaction),
    close: vi.fn(),
  } as unknown as IDBDatabase;
  const openRequest = {
    result: database,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBOpenDBRequest;
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success')));
      return openRequest;
    }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('protected production E2EE local state contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/app/e2ee/protectedLocalState.ts'), 'utf8');

  it('stores only capability-sealed state and never uses plaintext browser storage', () => {
    expect(source).toContain('protectedCapability.seal');
    expect(source).toContain('protectedCapability.open');
    expect(source).not.toMatch(/(?:localStorage|sessionStorage|Preferences)\s*\./);
    expect(source).toContain("purpose: 'protected_state'");
  });

  it('covers bootstrap, anchors, couple authority and accepted-envelope metadata', () => {
    for (const field of ['bootstrap', 'anchors', 'coupleAuthorities', 'acceptedEnvelopes']) {
      expect(source).toContain(field);
    }
  });

  it('fails closed without creating a replacement key for existing ciphertext', async () => {
    storedCiphertextHarness();
    const load = vi.fn().mockResolvedValue(null);
    const loadOrCreate = vi.fn();

    await expect(createProtectedE2eeLocalState({
      installationId: 'test-installation',
      userId: 'test-user',
      localKeys: { load, loadOrCreate },
    })).rejects.toThrow('E_PROTECTED_STATE_KEY_MISSING');

    expect(load).toHaveBeenCalledOnce();
    expect(loadOrCreate).not.toHaveBeenCalled();
  });
});
