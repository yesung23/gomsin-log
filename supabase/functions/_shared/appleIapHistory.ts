import {
  AppStoreServerAPIClient,
  Environment,
  GetTransactionHistoryVersion,
  Order,
} from 'npm:@apple/app-store-server-library@3.1.0';
import type { AppleIapReconcileTarget } from '../apple-iap-reconcile/handler.ts';

type Env = (key: string) => string | undefined;

export function createAppleIapHistory(env: Env = (key) => Deno.env.get(key)) {
  const privateKey = env('APPLE_IAP_PRIVATE_KEY');
  const keyId = env('APPLE_IAP_KEY_ID');
  const issuerId = env('APPLE_IAP_ISSUER_ID');
  const bundleId = env('APPLE_IAP_BUNDLE_ID');
  if (!privateKey || !keyId || !issuerId || bundleId !== 'app.gomsinlog') {
    throw new Error('Apple Server API credentials are not configured');
  }
  const clients = {
    Production: new AppStoreServerAPIClient(
      privateKey, keyId, issuerId, bundleId, Environment.PRODUCTION,
    ),
    Sandbox: new AppStoreServerAPIClient(
      privateKey, keyId, issuerId, bundleId, Environment.SANDBOX,
    ),
  };

  return async (target: AppleIapReconcileTarget): Promise<string[]> => {
    const client = clients[target.environment];
    const result: string[] = [];
    let revision: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const response = await client.getTransactionHistory(
        target.originalTransactionId,
        revision,
        { sort: Order.ASCENDING },
        GetTransactionHistoryVersion.V2,
      );
      result.push(...(response.signedTransactions ?? []));
      if (!response.hasMore) return result;
      if (!response.revision || response.revision === revision) {
        throw new Error('Apple history pagination did not advance');
      }
      revision = response.revision;
    }
    throw new Error('Apple history pagination exceeded limit');
  };
}
