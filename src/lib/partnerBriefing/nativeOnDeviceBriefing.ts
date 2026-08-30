import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  DEFAULT_BRIEFING_LOCALE,
  type BriefingLocale,
  type UntrustedBriefingExtractPlan,
} from './contract';
import { isValidProviderEnvelope, type BriefingProviderEnvelope } from './chunk';
import type {
  BriefingExtractRequest,
  BriefingExtractResult,
  BriefingProvider,
  BriefingProviderAvailability,
  BriefingProviderAvailabilityOptions,
  BriefingProviderCapability,
  BriefingProviderErrorCode,
  BriefingProviderSelectExtractsOptions,
} from './provider';

export const ON_DEVICE_BRIEFING_PLUGIN_NAME = 'GomsinlogOnDeviceBriefing';

interface NativeBriefingPlugin {
  availability(options: { locale: BriefingLocale }): Promise<{ availability?: unknown }>;
  capability(): Promise<{ envelope?: unknown }>;
  selectExtracts(options: {
    requestId: string;
    locale: BriefingLocale;
    items: BriefingExtractRequest['items'];
  }): Promise<{ requestId?: unknown; output?: unknown }>;
  cancel(options: { requestId: string }): Promise<void>;
}

const AVAILABILITY = new Set<BriefingProviderAvailability>([
  'ready',
  'unsupported',
  'model_unavailable',
  'preparing',
  'locale_unsupported',
]);

let registeredPlugin: NativeBriefingPlugin | null = null;
let injectedPlugin: NativeBriefingPlugin | null = null;

function isSupportedNativePlatform(): boolean {
  try {
    if (!Capacitor.isNativePlatform()) return false;
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android';
  } catch {
    return false;
  }
}

function nativePlugin(): NativeBriefingPlugin | null {
  if (injectedPlugin) return injectedPlugin;
  if (!isSupportedNativePlatform()) return null;
  try {
    if (!Capacitor.isPluginAvailable(ON_DEVICE_BRIEFING_PLUGIN_NAME)) return null;
    registeredPlugin ??= registerPlugin<NativeBriefingPlugin>(ON_DEVICE_BRIEFING_PLUGIN_NAME);
    return registeredPlugin;
  } catch {
    return null;
  }
}

function signalFrom(
  options?: BriefingProviderAvailabilityOptions
    | BriefingProviderSelectExtractsOptions
    | AbortSignal,
): AbortSignal | undefined {
  if (!options) return undefined;
  return 'aborted' in options ? options : options.signal;
}

function localeFrom(
  options?: BriefingProviderAvailabilityOptions
    | BriefingProviderSelectExtractsOptions
    | AbortSignal,
): BriefingLocale {
  if (!options || 'aborted' in options) return DEFAULT_BRIEFING_LOCALE;
  return options.locale ?? DEFAULT_BRIEFING_LOCALE;
}

function nativeErrorCode(error: unknown): BriefingProviderErrorCode {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  switch (code) {
  case 'E_BUSY': return 'busy';
  case 'E_QUOTA': return 'quota';
  case 'E_CANCELLED': return 'cancelled';
  case 'E_BAD_REQUEST':
  case 'E_MALFORMED': return 'malformed';
  default: return 'native_error';
  }
}

function cancelQuietly(port: NativeBriefingPlugin, requestId: string): void {
  void Promise.resolve()
    .then(() => port.cancel({ requestId }))
    .catch(() => undefined);
}

function successResult(
  expectedRequestId: string,
  response: { requestId?: unknown; output?: unknown },
): BriefingExtractResult {
  if (
    response.requestId !== expectedRequestId
    || !response.output
    || typeof response.output !== 'object'
    || Array.isArray(response.output)
  ) {
    return { ok: false, requestId: expectedRequestId, code: 'malformed' };
  }
  return {
    ok: true,
    requestId: response.requestId,
    output: response.output as UntrustedBriefingExtractPlan,
  };
}

export const nativeOnDeviceBriefingProvider: BriefingProvider = {
  async getAvailability(options) {
    const signal = signalFrom(options);
    if (signal?.aborted) return 'model_unavailable';
    const port = nativePlugin();
    if (!port) return 'unsupported';
    try {
      const response = await port.availability({ locale: localeFrom(options) });
      return typeof response.availability === 'string'
        && AVAILABILITY.has(response.availability as BriefingProviderAvailability)
        ? response.availability as BriefingProviderAvailability
        : 'model_unavailable';
    } catch {
      return 'model_unavailable';
    }
  },

  async getCapability(): Promise<BriefingProviderCapability> {
    const port = nativePlugin();
    if (!port) throw new Error('on-device briefing unavailable');
    const response = await port.capability();
    if (!isValidProviderEnvelope(response.envelope)) {
      throw new Error('on-device briefing capability unavailable');
    }
    return { envelope: response.envelope as BriefingProviderEnvelope };
  },

  async selectExtracts(request, options): Promise<BriefingExtractResult> {
    const signal = signalFrom(options);
    if (signal?.aborted) {
      return { ok: false, requestId: request.requestId, code: 'cancelled' };
    }
    const port = nativePlugin();
    if (!port) {
      return { ok: false, requestId: request.requestId, code: 'native_error' };
    }

    return new Promise<BriefingExtractResult>((resolve) => {
      let settled = false;
      const finish = (result: BriefingExtractResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => {
        cancelQuietly(port, request.requestId);
        finish({ ok: false, requestId: request.requestId, code: 'cancelled' });
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      void Promise.resolve()
        .then(() => port.selectExtracts({
          requestId: request.requestId,
          locale: localeFrom(options),
          items: request.items,
        }))
        .then((response) => finish(successResult(request.requestId, response)))
        .catch((error: unknown) => finish({
          ok: false,
          requestId: request.requestId,
          code: nativeErrorCode(error),
        }));
    });
  },

  async cancel(requestId) {
    const port = nativePlugin();
    if (!port) return;
    try {
      await port.cancel({ requestId });
    } catch {
      // Best effort: cancellation must never replace deterministic fallback.
    }
  },
};

/** Test-only bridge seam. Production callers use `nativeOnDeviceBriefingProvider`. */
export function __setOnDeviceBriefingPluginForTests(
  port: NativeBriefingPlugin | null,
): void {
  injectedPlugin = port;
  registeredPlugin = null;
}
