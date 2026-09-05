import {
  AppStoreServerAPIClient,
  Environment,
  GetTransactionHistoryVersion,
  Order,
} from 'npm:@apple/app-store-server-library@3.1.0';
import type { Buffer } from 'node:buffer';
import { URLSearchParams } from 'node:url';
import type { AppleIapReconcileTarget } from '../apple-iap-reconcile/handler.ts';

type AppleIapHistoryTarget = Pick<
  AppleIapReconcileTarget,
  'environment' | 'anchorTransactionId' | 'revision'
>;

type Env = (key: string) => string | undefined;
type HistoryResponse = {
  signedTransactions?: string[];
  hasMore?: boolean;
  revision?: string | null;
};
type AppleHistoryClientLike = {
  getTransactionHistory: (
    transactionId: string,
    revision: string | null,
    request: { sort: Order },
    version: GetTransactionHistoryVersion,
  ) => Promise<HistoryResponse>;
};
type AppleHistoryClientFactory = (
  privateKey: string,
  keyId: string,
  issuerId: string,
  bundleId: string,
  environment: Environment,
  timeoutMs: number,
) => AppleHistoryClientLike;

const MAX_HISTORY_TIMEOUT_MS = 30_000;
const MAX_HISTORY_TRANSACTIONS_PER_PAGE = 20;

export async function fetchAppleHistoryWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

class TimedAppStoreHistoryClient extends AppStoreServerAPIClient {
  readonly #urlBase: string;
  readonly #timeoutMs: number;

  constructor(
    privateKey: string,
    keyId: string,
    issuerId: string,
    bundleId: string,
    environment: Environment,
    timeoutMs: number,
  ) {
    super(privateKey, keyId, issuerId, bundleId, environment);
    if (environment !== Environment.PRODUCTION && environment !== Environment.SANDBOX) {
      throw new Error('Apple history environment is unsupported');
    }
    this.#urlBase = environment === Environment.PRODUCTION
      ? 'https://api.storekit.apple.com'
      : 'https://api.storekit-sandbox.apple.com';
    this.#timeoutMs = timeoutMs;
  }

  protected override async makeFetchRequest(
    path: string,
    parsedQueryParameters: URLSearchParams,
    method: string,
    requestBody: string | Buffer | undefined,
    headers: Record<string, string>,
  ) {
    const query = parsedQueryParameters.toString();
    const body = typeof requestBody === 'string' || requestBody === undefined
      ? requestBody
      : requestBody.buffer.slice(
        requestBody.byteOffset,
        requestBody.byteOffset + requestBody.byteLength,
      ) as ArrayBuffer;
    const response = await fetchAppleHistoryWithTimeout(
      `${this.#urlBase}${path}${query ? `?${query}` : ''}`,
      { method, body, headers },
      this.#timeoutMs,
    );
    return response as never;
  }
}

export function createAppleIapHistory(
  env: Env = (key) => Deno.env.get(key),
  factory: AppleHistoryClientFactory = (...args) => new TimedAppStoreHistoryClient(...args),
) {
  const privateKey = env('APPLE_IAP_PRIVATE_KEY');
  const keyId = env('APPLE_IAP_KEY_ID');
  const issuerId = env('APPLE_IAP_ISSUER_ID');
  const bundleId = env('APPLE_IAP_BUNDLE_ID');
  if (!privateKey || !keyId || !issuerId || bundleId !== 'app.gomsinlog') {
    throw new Error('Apple Server API credentials are not configured');
  }
  return async (
    target: AppleIapHistoryTarget,
    timeoutMs = MAX_HISTORY_TIMEOUT_MS,
  ) => {
    if (
      !Number.isInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > MAX_HISTORY_TIMEOUT_MS
    ) {
      throw new Error('Apple history timeout is invalid');
    }
    const environment = target.environment === 'Production'
      ? Environment.PRODUCTION
      : Environment.SANDBOX;
    const client = factory(
      privateKey,
      keyId,
      issuerId,
      bundleId,
      environment,
      timeoutMs,
    );
    const response = await client.getTransactionHistory(
      target.anchorTransactionId,
      target.revision,
      { sort: Order.ASCENDING },
      GetTransactionHistoryVersion.V2,
    );
    const signedTransactions = response.signedTransactions ?? [];
    if (
      !Array.isArray(signedTransactions) ||
      signedTransactions.length > MAX_HISTORY_TRANSACTIONS_PER_PAGE
    ) {
      throw new Error('Apple history transaction limit exceeded');
    }
    if (
      typeof response.revision !== 'string' || response.revision.length < 1 ||
      response.revision.length > 4096
    ) {
      throw new Error('Apple history response lacks a durable revision cursor');
    }
    if (typeof response.hasMore !== 'boolean') {
      throw new Error('Apple history response lacks pagination state');
    }
    return {
      signedTransactions,
      nextRevision: response.revision,
      hasMore: response.hasMore,
    };
  };
}
