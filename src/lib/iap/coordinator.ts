export type NativeTransaction = {
  transactionId: string;
  productId: string;
  signedTransactionJws: string;
};

export type AppleIapEnvironment = 'Xcode' | 'Sandbox' | 'Production';

export type AppleIapNativePort = {
  addTransactionListener: (listener: (transaction: NativeTransaction) => void) => Promise<() => void>;
  currentEntitlements: () => Promise<NativeTransaction[]>;
  sync: () => Promise<void>;
  purchase: (input: { productId: string; appAccountToken: string }) => Promise<
    | { status: 'success'; transaction: NativeTransaction }
    | { status: 'pending' }
    | { status: 'cancelled' }
  >;
  finish: (input: { transactionId: string }) => Promise<void>;
};

export type AppleIapServerSnapshot = {
  entitlements: Array<{ key: string; active: boolean }>;
  exportCredits: number;
};

export type AppleIapServerPort = {
  preparePurchase: (
    accountId: string,
    productId: string,
    environment: AppleIapEnvironment,
  ) => Promise<{
    appAccountToken: string;
  }>;
  ingestTransaction: (accountId: string, signedTransactionJws: string) => Promise<AppleIapServerSnapshot & {
    accepted: boolean;
    transactionId: string;
  }>;
  loadEntitlements: (
    accountId: string,
    environment: AppleIapEnvironment,
  ) => Promise<AppleIapServerSnapshot>;
};

export type AppleIapSnapshot = AppleIapServerSnapshot & {
  accountId: string | null;
  phase: 'idle' | 'syncing' | 'ready' | 'pending' | 'error';
};

export function createAppleIapCoordinator(deps: {
  native: AppleIapNativePort;
  server: AppleIapServerPort;
}) {
  let generation = 0;
  let boundEnvironment: AppleIapEnvironment | null = null;
  let removeListener: (() => void) | null = null;
  let state: AppleIapSnapshot = {
    accountId: null,
    phase: 'idle',
    entitlements: [],
    exportCredits: 0,
  };

  const isCurrent = (accountId: string, expectedGeneration: number) =>
    state.accountId === accountId && generation === expectedGeneration;

  const applyServerSnapshot = (
    accountId: string,
    expectedGeneration: number,
    snapshot: AppleIapServerSnapshot,
  ) => {
    if (!isCurrent(accountId, expectedGeneration)) return false;
    state = { ...state, ...snapshot, phase: 'ready' };
    return true;
  };

  const ingest = async (
    accountId: string,
    expectedGeneration: number,
    transactionValue: NativeTransaction,
  ) => {
    if (!isCurrent(accountId, expectedGeneration)) return false;
    try {
      const result = await deps.server.ingestTransaction(
        accountId,
        transactionValue.signedTransactionJws,
      );
      if (!isCurrent(accountId, expectedGeneration)) return false;
      if (!result.accepted || result.transactionId !== transactionValue.transactionId) {
        state = { ...state, phase: 'error' };
        return false;
      }
      applyServerSnapshot(accountId, expectedGeneration, result);
      await deps.native.finish({ transactionId: transactionValue.transactionId });
      return true;
    } catch {
      if (isCurrent(accountId, expectedGeneration)) {
        state = { ...state, phase: 'error' };
      }
      return false;
    }
  };

  const reconcile = async (
    accountId: string,
    environment: AppleIapEnvironment,
    expectedGeneration: number,
  ) => {
    const transactions = await deps.native.currentEntitlements();
    let allTransactionsAccepted = true;
    for (const item of transactions) {
      if (!isCurrent(accountId, expectedGeneration)) return false;
      if (!(await ingest(accountId, expectedGeneration, item))) {
        allTransactionsAccepted = false;
      }
    }
    if (!isCurrent(accountId, expectedGeneration)) return false;
    const snapshot = await deps.server.loadEntitlements(accountId, environment);
    applyServerSnapshot(accountId, expectedGeneration, snapshot);
    return allTransactionsAccepted;
  };

  return {
    snapshot: (): AppleIapSnapshot => ({
      ...state,
      entitlements: state.entitlements.map((item) => ({ ...item })),
    }),

    async bindAccount(accountId: string, environment: AppleIapEnvironment): Promise<void> {
      generation += 1;
      const expectedGeneration = generation;
      boundEnvironment = environment;
      removeListener?.();
      removeListener = null;
      state = {
        accountId,
        phase: 'syncing',
        entitlements: [],
        exportCredits: 0,
      };

      const registeredRemove = await deps.native.addTransactionListener((item) => {
        void ingest(accountId, expectedGeneration, item);
      });
      if (!isCurrent(accountId, expectedGeneration)) {
        registeredRemove();
        return;
      }
      removeListener = registeredRemove;
      await reconcile(accountId, environment, expectedGeneration);
    },

    async restorePurchases(accountId: string): Promise<void> {
      if (state.accountId !== accountId) throw new Error('E_IAP_SESSION_STALE');
      if (!boundEnvironment) throw new Error('E_IAP_ENVIRONMENT_UNKNOWN');
      const expectedGeneration = generation;
      state = { ...state, phase: 'syncing' };
      await deps.native.sync();
      if (!isCurrent(accountId, expectedGeneration)) return;
      const complete = await reconcile(accountId, boundEnvironment, expectedGeneration);
      if (!complete) throw new Error('E_IAP_RESTORE_INCOMPLETE');
    },

    async purchase(
      accountId: string,
      productId: string,
      environment: AppleIapEnvironment,
      saleGateOpen: boolean,
    ): Promise<{ status: 'success' | 'pending' | 'cancelled' | 'sale_closed' | 'error' }> {
      if (!saleGateOpen) return { status: 'sale_closed' };
      if (state.accountId !== accountId || boundEnvironment !== environment) return { status: 'error' };
      const expectedGeneration = generation;
      let prepared: { appAccountToken: string };
      try {
        prepared = await deps.server.preparePurchase(accountId, productId, environment);
      } catch {
        if (isCurrent(accountId, expectedGeneration)) state = { ...state, phase: 'error' };
        return { status: 'error' };
      }
      if (!isCurrent(accountId, expectedGeneration)) return { status: 'error' };
      const result = await deps.native.purchase({
        productId,
        appAccountToken: prepared.appAccountToken,
      });
      if (!isCurrent(accountId, expectedGeneration)) return { status: 'error' };
      if (result.status === 'pending') {
        state = { ...state, phase: 'pending' };
        return { status: 'pending' };
      }
      if (result.status === 'cancelled') return { status: 'cancelled' };
      const accepted = await ingest(accountId, expectedGeneration, result.transaction);
      return { status: accepted ? 'success' : 'error' };
    },

    dispose(): void {
      generation += 1;
      boundEnvironment = null;
      removeListener?.();
      removeListener = null;
      state = { accountId: null, phase: 'idle', entitlements: [], exportCredits: 0 };
    },
  };
}
