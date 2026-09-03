import { describe, expect, it, vi } from 'vitest';

import { createAppleIapServerPort, createStoreKitNativePort } from './adapters';

describe('Apple IAP adapters', () => {
  it('never sends a client-selected account id or entitlement claim to the Edge Function', async () => {
    const invoke = vi.fn(async (_name: string, options: { body: Record<string, unknown> }) => ({
      data: options.body && (options.body as { action?: string }).action === 'prepare'
        ? { appAccountToken: '10000000-0000-4000-8000-00000000000a' }
        : { accepted: true, transactionId: 'tx-1', entitlements: [], exportCredits: 0 },
      error: null,
    }));
    const port = createAppleIapServerPort({ invoke });

    await port.preparePurchase('account-must-not-cross-boundary', 'app.gomsinlog.paper.spring.v1', 'Sandbox');
    await port.ingestTransaction('account-must-not-cross-boundary', 'header.payload.signature');
    await port.loadEntitlements('account-must-not-cross-boundary', 'Sandbox');

    expect(invoke).toHaveBeenNthCalledWith(1, 'apple-iap-sync', {
      body: { action: 'prepare', productId: 'app.gomsinlog.paper.spring.v1', environment: 'Sandbox' },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'apple-iap-sync', {
      body: { signedTransactionJws: 'header.payload.signature' },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'apple-iap-sync', {
      body: { action: 'status', environment: 'Sandbox' },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('account-must-not-cross-boundary');
  });

  it('maps the native listener and only finishes the exact server-accepted transaction id', async () => {
    const remove = vi.fn(async () => undefined);
    const addListener = vi.fn(async (_event: string, listener: (value: unknown) => void) => {
      listener({ transactionId: 'tx-1', productId: 'p', signedTransactionJws: 'a.b.c' });
      return { remove };
    });
    const plugin = {
      addListener,
      currentEntitlements: vi.fn(async () => ({ transactions: [] })),
      sync: vi.fn(async () => undefined),
      purchase: vi.fn(),
      finish: vi.fn(async () => ({ finished: true })),
    };
    const port = createStoreKitNativePort(plugin);
    const seen: unknown[] = [];
    const dispose = await port.addTransactionListener((value) => seen.push(value));
    await port.finish({ transactionId: 'tx-1' });
    dispose();

    expect(seen).toEqual([{ transactionId: 'tx-1', productId: 'p', signedTransactionJws: 'a.b.c' }]);
    expect(plugin.finish).toHaveBeenCalledWith({ transactionId: 'tx-1' });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('fails closed when an Edge response is missing its required shape', async () => {
    const port = createAppleIapServerPort({
      invoke: vi.fn(async () => ({ data: { purchased: true }, error: null })),
    });

    await expect(port.preparePurchase('a', 'p', 'Production')).rejects.toThrow('E_IAP_BAD_RESPONSE');
    await expect(port.loadEntitlements('a', 'Production')).rejects.toThrow('E_IAP_BAD_RESPONSE');
  });
});
