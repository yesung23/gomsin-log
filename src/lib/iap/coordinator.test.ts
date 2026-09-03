import { describe, expect, it, vi } from 'vitest';

import {
  createAppleIapCoordinator,
  type AppleIapNativePort,
  type AppleIapServerPort,
  type NativeTransaction,
} from './coordinator';

const JWS = 'header.payload.signature';
const ACCOUNT_A = '00000000-0000-4000-8000-00000000000a';
const ACCOUNT_B = '00000000-0000-4000-8000-00000000000b';
const TOKEN_A = '10000000-0000-4000-8000-00000000000a';

function transaction(overrides: Partial<NativeTransaction> = {}): NativeTransaction {
  return {
    transactionId: 'tx-1',
    productId: 'app.gomsinlog.paper.season.spring.v1',
    signedTransactionJws: JWS,
    ...overrides,
  };
}

function ports() {
  let listener: ((value: NativeTransaction) => void) | null = null;
  const native: AppleIapNativePort = {
    addTransactionListener: vi.fn(async (next) => {
      listener = next;
      return () => { listener = null; };
    }),
    currentEntitlements: vi.fn(async () => []),
    sync: vi.fn(async () => undefined),
    purchase: vi.fn(async () => ({ status: 'cancelled' as const })),
    finish: vi.fn(async () => undefined),
  };
  const server: AppleIapServerPort = {
    preparePurchase: vi.fn(async () => ({ appAccountToken: TOKEN_A })),
    ingestTransaction: vi.fn(async () => ({
      accepted: true,
      transactionId: 'tx-1',
      entitlements: [{ key: 'paper.spring', active: true }],
      exportCredits: 0,
    })),
    loadEntitlements: vi.fn(async () => ({ entitlements: [], exportCredits: 0 })),
  };
  return { native, server, emit: (value: NativeTransaction) => listener?.(value) };
}

describe('Apple IAP coordinator', () => {
  it('starts the transaction listener and reconciles current entitlements even while new sale is off', async () => {
    const { native, server } = ports();
    vi.mocked(native.currentEntitlements).mockResolvedValue([transaction()]);
    vi.mocked(server.loadEntitlements).mockResolvedValue({
      entitlements: [{ key: 'paper.spring', active: true }],
      exportCredits: 0,
    });
    const coordinator = createAppleIapCoordinator({ native, server });

    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');

    expect(native.addTransactionListener).toHaveBeenCalledOnce();
    expect(server.ingestTransaction).toHaveBeenCalledWith(ACCOUNT_A, JWS);
    expect(native.finish).toHaveBeenCalledWith({ transactionId: 'tx-1' });
    expect(coordinator.snapshot()).toMatchObject({
      accountId: ACCOUNT_A,
      phase: 'ready',
      entitlements: [{ key: 'paper.spring', active: true }],
    });
  });

  it('runs StoreKit sync only after an explicit restore and sends every returned JWS to the server', async () => {
    const { native, server } = ports();
    const coordinator = createAppleIapCoordinator({ native, server });
    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');
    vi.mocked(native.currentEntitlements).mockResolvedValue([
      transaction({ transactionId: 'tx-2', signedTransactionJws: 'jws-2' }),
      transaction({ transactionId: 'tx-3', signedTransactionJws: 'jws-3' }),
    ]);

    await coordinator.restorePurchases(ACCOUNT_A);

    expect(native.sync).toHaveBeenCalledOnce();
    expect(server.ingestTransaction).toHaveBeenCalledWith(ACCOUNT_A, 'jws-2');
    expect(server.ingestTransaction).toHaveBeenCalledWith(ACCOUNT_A, 'jws-3');
  });

  it('loads server state even when StoreKit exposes a transaction bound to another app account', async () => {
    const { native, server } = ports();
    vi.mocked(native.currentEntitlements).mockResolvedValue([transaction()]);
    vi.mocked(server.ingestTransaction).mockRejectedValue(new Error('account mismatch'));
    vi.mocked(server.loadEntitlements).mockResolvedValue({
      entitlements: [{ key: 'plus', active: true }],
      exportCredits: 0,
    });
    const coordinator = createAppleIapCoordinator({ native, server });

    await coordinator.bindAccount(ACCOUNT_B, 'Xcode');

    expect(native.finish).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({
      accountId: ACCOUNT_B,
      phase: 'ready',
      entitlements: [{ key: 'plus', active: true }],
    });
  });

  it('does not grant from pending or cancelled purchase results', async () => {
    const { native, server } = ports();
    const coordinator = createAppleIapCoordinator({ native, server });
    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');
    vi.mocked(server.ingestTransaction).mockClear();
    vi.mocked(native.purchase)
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'cancelled' });

    expect(await coordinator.purchase(ACCOUNT_A, 'product-1', 'Xcode', true)).toEqual({ status: 'pending' });
    expect(await coordinator.purchase(ACCOUNT_A, 'product-1', 'Xcode', true)).toEqual({ status: 'cancelled' });
    expect(server.ingestTransaction).not.toHaveBeenCalled();
    expect(native.finish).not.toHaveBeenCalled();
  });

  it('requests a product-scoped server token only after the double gate passes', async () => {
    const { native, server } = ports();
    const coordinator = createAppleIapCoordinator({ native, server });
    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');

    expect(await coordinator.purchase(ACCOUNT_A, 'product-1', 'Xcode', false)).toEqual({ status: 'sale_closed' });
    expect(server.preparePurchase).not.toHaveBeenCalled();
    expect(native.purchase).not.toHaveBeenCalled();

    vi.mocked(native.purchase).mockResolvedValue({ status: 'success', transaction: transaction() });
    await coordinator.purchase(ACCOUNT_A, 'product-1', 'Xcode', true);
    expect(server.preparePurchase).toHaveBeenCalledWith(ACCOUNT_A, 'product-1', 'Xcode');
    expect(native.purchase).toHaveBeenCalledWith({ productId: 'product-1', appAccountToken: TOKEN_A });
  });

  it('finishes a transaction only after the authoritative server accepts it', async () => {
    const { native, server, emit } = ports();
    const coordinator = createAppleIapCoordinator({ native, server });
    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');
    vi.mocked(server.ingestTransaction).mockRejectedValueOnce(new Error('server unavailable'));

    emit(transaction());
    await vi.waitFor(() => expect(server.ingestTransaction).toHaveBeenCalled());

    expect(native.finish).not.toHaveBeenCalled();
    expect(coordinator.snapshot().phase).toBe('error');
  });

  it('drops a late account-A response after account switch and never finishes it inside account B', async () => {
    const { native, server, emit } = ports();
    let resolveIngest: ((value: Awaited<ReturnType<AppleIapServerPort['ingestTransaction']>>) => void) | null = null;
    vi.mocked(server.ingestTransaction).mockImplementationOnce(() => new Promise((resolve) => {
      resolveIngest = resolve;
    }));
    const coordinator = createAppleIapCoordinator({ native, server });
    await coordinator.bindAccount(ACCOUNT_A, 'Xcode');
    emit(transaction());
    await vi.waitFor(() => expect(server.ingestTransaction).toHaveBeenCalledOnce());

    await coordinator.bindAccount(ACCOUNT_B, 'Xcode');
    resolveIngest?.({ accepted: true, transactionId: 'tx-1', entitlements: [{ key: 'paper.spring', active: true }], exportCredits: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.snapshot().accountId).toBe(ACCOUNT_B);
    expect(coordinator.snapshot().entitlements).toEqual([]);
    expect(native.finish).not.toHaveBeenCalled();
  });
});
