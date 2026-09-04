import {
  AppStoreServerAPIClient,
  type ConsumptionRequest,
  Environment,
} from 'npm:@apple/app-store-server-library@3.1.0';
import type { RequestInit, Response } from 'npm:@types/node-fetch@2.6.13';
import fetch from 'npm:node-fetch@2.7.0';
import { URLSearchParams } from 'node:url';

type Env = (key: string) => string | undefined;
type AppleApiClientLike = {
  sendConsumptionInformation: (
    transactionId: string,
    request: ConsumptionRequest,
  ) => Promise<void>;
};
type AppleApiClientFactory = (
  privateKey: string,
  keyId: string,
  issuerId: string,
  bundleId: string,
  environment: Environment,
  timeoutMs: number,
) => AppleApiClientLike;

export type AppleConsumptionSendInput = {
  environment: 'Sandbox' | 'Production';
  transactionId: string;
  timeoutMs: number;
  request: ConsumptionRequest;
};

export function appleServerApiBaseUrl(
  environment: AppleConsumptionSendInput['environment'],
): string {
  return environment === 'Production'
    ? 'https://api.storekit.apple.com'
    : 'https://api.storekit-sandbox.apple.com';
}

export function parseAppleRetryAfterSeconds(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (/^[0-9]+$/.test(normalized)) {
    const retryAtMs = Number(normalized);
    if (!Number.isSafeInteger(retryAtMs) || retryAtMs <= nowMs) return null;
    return Math.min(Math.ceil((retryAtMs - nowMs) / 1_000), 43_200);
  }
  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt) || retryAt <= nowMs) return null;
  return Math.min(Math.ceil((retryAt - nowMs) / 1_000), 43_200);
}

export function fetchAppleServerApiWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, { ...init, timeout: timeoutMs });
}

class TimedAppStoreServerAPIClient extends AppStoreServerAPIClient {
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
      throw new Error('Apple consumption environment is unsupported');
    }
    this.#urlBase = appleServerApiBaseUrl(
      environment === Environment.PRODUCTION ? 'Production' : 'Sandbox',
    );
    this.#timeoutMs = timeoutMs;
  }

  protected override async makeFetchRequest(
    path: string,
    parsedQueryParameters: URLSearchParams,
    method: string,
    requestBody: string | Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    // node-fetch v2's timeout destroys the underlying request. This is a real
    // cancellation boundary, not Promise.race with a request left running.
    const response = await fetchAppleServerApiWithTimeout(
      `${this.#urlBase}${path}?${parsedQueryParameters.toString()}`,
      { method, body: requestBody, headers },
      this.#timeoutMs,
    );
    if (response.status === 429) {
      const retryAfterSeconds = parseAppleRetryAfterSeconds(
        response.headers.get('retry-after'),
      );
      if (retryAfterSeconds != null) {
        throw Object.assign(new Error('Apple request is rate limited'), {
          httpStatusCode: 429,
          retryAfterSeconds,
        });
      }
    }
    return response;
  }
}

export function createAppleIapConsumptionSender(
  env: Env = (key) => Deno.env.get(key),
  factory: AppleApiClientFactory = (...args) => new TimedAppStoreServerAPIClient(...args),
): (input: AppleConsumptionSendInput) => Promise<void> {
  const privateKey = env('APPLE_IAP_PRIVATE_KEY');
  const keyId = env('APPLE_IAP_KEY_ID');
  const issuerId = env('APPLE_IAP_ISSUER_ID');
  const bundleId = env('APPLE_IAP_BUNDLE_ID');
  if (!privateKey || !keyId || !issuerId || bundleId !== 'app.gomsinlog') {
    throw new Error('Apple Server API credentials are not configured');
  }
  return async (input) => {
    if (
      !Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1 || input.timeoutMs > 120_000
    ) {
      throw new Error('Apple consumption timeout is invalid');
    }
    const environment = input.environment === 'Production'
      ? Environment.PRODUCTION
      : input.environment === 'Sandbox'
      ? Environment.SANDBOX
      : null;
    if (!environment) throw new Error('Apple consumption environment is unsupported');
    const client = factory(
      privateKey,
      keyId,
      issuerId,
      bundleId,
      environment,
      input.timeoutMs,
    );
    await client.sendConsumptionInformation(input.transactionId, input.request);
  };
}
