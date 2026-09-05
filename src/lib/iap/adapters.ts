import type { StoreKitPlugin } from '@gomsinlog/capacitor-storekit';

import type {
  AppleIapNativePort,
  AppleIapServerPort,
  AppleIapServerSnapshot,
} from './coordinator';

type InvokeResult = { data: unknown; error: unknown };
type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<InvokeResult>;

export type ReviewedRefundDataNotice = {
  version: string;
  sha256: string;
};

export type AppleIapRefundConsentPort = {
  loadRefundDataConsent: (notice: ReviewedRefundDataNotice) => Promise<{
    noticeMatches: boolean;
    decision: 'granted' | 'withdrawn' | null;
  }>;
  setRefundDataConsent: (input: {
    decision: 'granted' | 'withdrawn';
    notice: ReviewedRefundDataNotice;
    idempotencyKey: string;
  }) => Promise<{
    decision: 'granted' | 'withdrawn';
    notice: ReviewedRefundDataNotice;
    duplicate: boolean;
  }>;
};

function validNotice(notice: ReviewedRefundDataNotice): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(notice.version)
    && /^[0-9a-f]{64}$/.test(notice.sha256);
}

function snapshot(value: unknown): AppleIapServerSnapshot {
  if (!value || typeof value !== 'object') throw new Error('E_IAP_BAD_RESPONSE');
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.entitlements) || !Number.isSafeInteger(record.exportCredits)) {
    throw new Error('E_IAP_BAD_RESPONSE');
  }
  const entitlements = record.entitlements.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('E_IAP_BAD_RESPONSE');
    const item = entry as Record<string, unknown>;
    if (typeof item.key !== 'string' || typeof item.active !== 'boolean') {
      throw new Error('E_IAP_BAD_RESPONSE');
    }
    return { key: item.key, active: item.active };
  });
  return { entitlements, exportCredits: record.exportCredits as number };
}

async function invokeChecked(invoke: Invoke, body: Record<string, unknown>): Promise<unknown> {
  const result = await invoke('apple-iap-sync', { body });
  if (result.error) throw new Error('E_IAP_SERVER');
  return result.data;
}

export function createAppleIapServerPort(
  deps: { invoke: Invoke },
): AppleIapServerPort & AppleIapRefundConsentPort {
  return {
    async preparePurchase(_accountId, productId, environment) {
      const data = await invokeChecked(deps.invoke, { action: 'prepare', productId, environment });
      if (!data || typeof data !== 'object'
        || typeof (data as Record<string, unknown>).appAccountToken !== 'string') {
        throw new Error('E_IAP_BAD_RESPONSE');
      }
      return { appAccountToken: (data as { appAccountToken: string }).appAccountToken };
    },

    async ingestTransaction(_accountId, signedTransactionJws) {
      const data = await invokeChecked(deps.invoke, { signedTransactionJws });
      if (!data || typeof data !== 'object') throw new Error('E_IAP_BAD_RESPONSE');
      const record = data as Record<string, unknown>;
      if (typeof record.accepted !== 'boolean' || typeof record.transactionId !== 'string') {
        throw new Error('E_IAP_BAD_RESPONSE');
      }
      return {
        ...snapshot(data),
        accepted: record.accepted,
        transactionId: record.transactionId,
      };
    },

    async loadEntitlements(_accountId, environment) {
      return snapshot(await invokeChecked(deps.invoke, { action: 'status', environment }));
    },

    async loadRefundDataConsent(notice) {
      if (!validNotice(notice)) throw new Error('E_IAP_NOTICE_INVALID');
      const data = await invokeChecked(deps.invoke, {
        action: 'refund-consent-state',
        noticeVersion: notice.version,
        noticeSha256: notice.sha256,
      });
      if (!data || typeof data !== 'object') throw new Error('E_IAP_BAD_RESPONSE');
      const record = data as Record<string, unknown>;
      if (typeof record.noticeMatches !== 'boolean'
        || (record.decision !== null
          && record.decision !== 'granted'
          && record.decision !== 'withdrawn')) {
        throw new Error('E_IAP_BAD_RESPONSE');
      }
      return {
        noticeMatches: record.noticeMatches,
        decision: record.decision,
      };
    },

    async setRefundDataConsent({ decision, notice, idempotencyKey }) {
      if (!validNotice(notice)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(idempotencyKey)) {
        throw new Error('E_IAP_NOTICE_INVALID');
      }
      const data = await invokeChecked(deps.invoke, {
        action: 'refund-consent-decision',
        decision,
        noticeVersion: notice.version,
        noticeSha256: notice.sha256,
        idempotencyKey,
      });
      if (!data || typeof data !== 'object') throw new Error('E_IAP_BAD_RESPONSE');
      const record = data as Record<string, unknown>;
      if (record.decision !== decision
        || record.noticeVersion !== notice.version
        || record.noticeSha256 !== notice.sha256
        || typeof record.duplicate !== 'boolean') {
        throw new Error('E_IAP_BAD_RESPONSE');
      }
      return { decision, notice: { ...notice }, duplicate: record.duplicate };
    },
  };
}

export function createStoreKitNativePort(plugin: StoreKitPlugin): AppleIapNativePort {
  return {
    async addTransactionListener(listener) {
      const handle = await plugin.addListener('transactionUpdated', listener);
      return () => { void handle.remove().catch(() => undefined); };
    },
    async currentEntitlements() {
      return (await plugin.currentEntitlements()).transactions;
    },
    async sync() {
      await plugin.sync();
    },
    purchase: (input) => plugin.purchase(input),
    async finish(input) {
      await plugin.finish(input);
    },
  };
}
