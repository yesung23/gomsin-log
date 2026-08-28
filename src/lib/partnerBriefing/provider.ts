/**
 * Partner Briefing Provider Contract and Configurable Fake (Phase A5)
 *
 * Defines the common on-device provider contract and a deterministic fake provider
 * for testing and cross-platform pipeline execution.
 *
 * Architectural invariants:
 * 1. Runtime availability states ('ready' | 'unsupported' | 'model_unavailable' |
 *    'preparing' | 'locale_unsupported') are kept separate from domain generation
 *    ('on_device' | 'hybrid' | 'deterministic').
 * 2. Model-safe requests contain only requestId and BriefingModelChunk (synthetic
 *    ordinals, normalized text, media kinds). Zero record/user/couple IDs, exact
 *    dates/times, URLs, storage paths, or key material.
 * 3. Source ordinals represent request-local input ordinals (leaf record ordinals now,
 *    future reduction child ordinals), never real database IDs.
 * 4. Response correlation binds requestId to untrusted output sections.
 * 5. Failure codes ('busy' | 'quota' | 'timeout' | 'cancelled' | 'malformed' |
 *    'native_error') capture execution failure modes without throwing.
 *    Failures contain only { ok: false, requestId?, code } with no arbitrary message strings.
 * 6. Explicit cancellation support via both cancel(requestId) and AbortSignal.
 * 7. Zero verification (Gate A6), zero timeout policy/hierarchy/fallback (Gate A7),
 *    zero native plugins, zero server inference, zero AI prompts, zero logging,
 *    and zero persistence.
 */

import type {
  UntrustedBriefingGeneratedSection,
  UntrustedBriefingProviderOutput,
} from './contract';
import {
  isValidProviderEnvelope,
  type BriefingModelChunk,
  type BriefingProviderEnvelope,
} from './chunk';

/**
 * Availability state of the on-device briefing model/provider.
 * Kept strictly separate from final domain generation classification.
 */
export type BriefingProviderAvailability =
  | 'ready'
  | 'unsupported'
  | 'model_unavailable'
  | 'preparing'
  | 'locale_unsupported';

/**
 * Failure codes emitted by a briefing provider when an execution error occurs.
 */
export type BriefingProviderErrorCode =
  | 'busy'
  | 'quota'
  | 'timeout'
  | 'cancelled'
  | 'malformed'
  | 'native_error';

/**
 * Provider capability describing model budget and envelope limits.
 * Uses Phase A4 BriefingProviderEnvelope.
 */
export interface BriefingProviderCapability {
  readonly envelope: BriefingProviderEnvelope;
}
/**
 * Model-safe summarize request sent to a briefing provider.
 * Contains only requestId and the model-safe chunk.
 */
export interface BriefingProviderRequest {
  readonly requestId: string;
  readonly chunk: BriefingModelChunk;
}

/**
 * Successful response from a briefing provider with correlated requestId.
 * Output sections are untrusted and must undergo Gate A6 verification.
 */
export interface BriefingProviderSuccess {
  readonly ok: true;
  readonly requestId: string;
  readonly output: UntrustedBriefingProviderOutput;
}

/**
 * Failed response from a briefing provider with correlated requestId and error code.
 * Excludes arbitrary message strings to prevent logging or leaking sensitive runtime details.
 */
export interface BriefingProviderFailure {
  readonly ok: false;
  readonly requestId?: string;
  readonly code: BriefingProviderErrorCode;
}

/**
 * Discriminated union of provider results.
 */
export type BriefingProviderResult =
  | BriefingProviderSuccess
  | BriefingProviderFailure;

/**
 * Type alias for provider response.
 */
export type BriefingProviderResponse = BriefingProviderResult;

/**
 * Options passed when checking provider availability.
 */
export interface BriefingProviderAvailabilityOptions {
  readonly signal?: AbortSignal;
}

/**
 * Options passed when executing a summarize request.
 */
export interface BriefingProviderSummarizeOptions {
  readonly signal?: AbortSignal;
}

/**
 * Common provider interface for on-device Partner Briefing inference.
 */
export interface BriefingProvider {
  getAvailability(
    optionsOrSignal?: BriefingProviderAvailabilityOptions | AbortSignal,
  ): Promise<BriefingProviderAvailability>;
  getCapability(): Promise<BriefingProviderCapability> | BriefingProviderCapability;
  summarize(
    request: BriefingProviderRequest,
    optionsOrSignal?: BriefingProviderSummarizeOptions | AbortSignal,
  ): Promise<BriefingProviderResult>;
  cancel(requestId: string): Promise<void>;
}

/**
 * Default conservative provider envelope for testing and fake providers.
 */
export const DEFAULT_FAKE_PROVIDER_ENVELOPE: BriefingProviderEnvelope = {
  maxContextUtf8Bytes: 4096,
  promptOverheadUtf8Bytes: 256,
  responseReserveUtf8Bytes: 512,
  maxInputTextGraphemes: 1000,
};

/**
 * Scenario override configuration for fake provider testing.
 */
export type FakeBriefingResponseOverride =
  | {
      readonly type: 'success';
      readonly output?: UntrustedBriefingProviderOutput;
      readonly sections?: readonly UntrustedBriefingGeneratedSection[];
    }
  | {
      readonly type: 'failure';
      readonly code: BriefingProviderErrorCode;
    }
  | {
      readonly type: 'wrong_correlation';
      readonly wrongRequestId: string;
      readonly output?: UntrustedBriefingProviderOutput;
    }
  | {
      readonly type: 'malformed';
      readonly rawOutput: unknown;
    }
  | {
      readonly type: 'delay';
      readonly delayMs: number;
      readonly then: FakeBriefingResponseOverride;
    };

/**
 * Configuration options for FakeBriefingProvider.
 */
export interface FakeBriefingProviderConfig {
  readonly availability?:
    | BriefingProviderAvailability
    | (() => Promise<BriefingProviderAvailability> | BriefingProviderAvailability);
  readonly capability?: BriefingProviderCapability | BriefingProviderEnvelope;
  readonly delayMs?: number | ((request: BriefingProviderRequest) => number);
  readonly defaultGenerator?: (
    request: BriefingProviderRequest,
  ) => UntrustedBriefingProviderOutput | readonly UntrustedBriefingGeneratedSection[];
  readonly scenariosByRequestId?: Record<string, FakeBriefingResponseOverride>;
  readonly scenarioSelector?: (
    request: BriefingProviderRequest,
    callIndex: number,
  ) => FakeBriefingResponseOverride | undefined;
}

function extractSignal(
  optionsOrSignal?:
    | BriefingProviderSummarizeOptions
    | BriefingProviderAvailabilityOptions
    | AbortSignal,
): AbortSignal | undefined {
  if (!optionsOrSignal) {
    return undefined;
  }
  if (optionsOrSignal instanceof AbortSignal || 'aborted' in optionsOrSignal) {
    return optionsOrSignal as AbortSignal;
  }
  if ('signal' in optionsOrSignal && optionsOrSignal.signal) {
    return optionsOrSignal.signal;
  }
  return undefined;
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(new Error('Aborted'));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      reject(new Error('Aborted'));
    };

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Configurable fake briefing provider for deterministic unit and integration tests.
 */
export class FakeBriefingProvider implements BriefingProvider {
  private availability:
    | BriefingProviderAvailability
    | (() => Promise<BriefingProviderAvailability> | BriefingProviderAvailability);
  private capability: BriefingProviderCapability;
  private delayMs?: number | ((request: BriefingProviderRequest) => number);
  private defaultGenerator?: (
    request: BriefingProviderRequest,
  ) => UntrustedBriefingProviderOutput | readonly UntrustedBriefingGeneratedSection[];
  private scenariosByRequestId: Map<string, FakeBriefingResponseOverride>;
  private scenarioSelector?: (
    request: BriefingProviderRequest,
    callIndex: number,
  ) => FakeBriefingResponseOverride | undefined;
  private callHistory: BriefingProviderRequest[] = [];
  private inFlightControllers: Map<string, AbortController> = new Map();

  constructor(config: FakeBriefingProviderConfig = {}) {
    this.availability = config.availability ?? 'ready';
    let envelope = DEFAULT_FAKE_PROVIDER_ENVELOPE;
    if (config.capability) {
      const candidate =
        'envelope' in config.capability
          ? config.capability.envelope
          : config.capability;
      if (isValidProviderEnvelope(candidate)) {
        envelope = candidate;
      }
    }

    this.capability = { envelope };
    this.delayMs = config.delayMs;
    this.defaultGenerator = config.defaultGenerator;
    this.scenariosByRequestId = new Map(
      Object.entries(config.scenariosByRequestId ?? {}),
    );
    this.scenarioSelector = config.scenarioSelector;
  }

  async getAvailability(
    optionsOrSignal?: BriefingProviderAvailabilityOptions | AbortSignal,
  ): Promise<BriefingProviderAvailability> {
    const signal = extractSignal(optionsOrSignal);
    if (signal?.aborted) {
      return 'unsupported';
    }
    if (typeof this.availability === 'function') {
      return this.availability();
    }
    return this.availability;
  }

  getCapability(): BriefingProviderCapability {
    return this.capability;
  }

  getCallHistory(): readonly BriefingProviderRequest[] {
    return [...this.callHistory];
  }

  clearCallHistory(): void {
    this.callHistory = [];
  }

  setAvailability(
    availability:
      | BriefingProviderAvailability
      | (() => Promise<BriefingProviderAvailability> | BriefingProviderAvailability),
  ): void {
    this.availability = availability;
  }

  setCapability(
    capability: BriefingProviderCapability | BriefingProviderEnvelope,
  ): void {
    const envelope = 'envelope' in capability ? capability.envelope : capability;
    if (isValidProviderEnvelope(envelope)) {
      this.capability = { envelope };
    }
  }

  setScenarioForRequestId(
    requestId: string,
    scenario: FakeBriefingResponseOverride,
  ): void {
    this.scenariosByRequestId.set(requestId, scenario);
  }

  removeScenarioForRequestId(requestId: string): void {
    this.scenariosByRequestId.delete(requestId);
  }

  async cancel(requestId: string): Promise<void> {
    const controller = this.inFlightControllers.get(requestId);
    if (controller) {
      controller.abort();
    }
  }

  async summarize(
    request: BriefingProviderRequest,
    optionsOrSignal?: BriefingProviderSummarizeOptions | AbortSignal,
  ): Promise<BriefingProviderResult> {
    const externalSignal = extractSignal(optionsOrSignal);
    const callIndex = this.callHistory.length;
    this.callHistory.push(request);

    if (externalSignal?.aborted) {
      return {
        ok: false,
        requestId: request.requestId,
        code: 'cancelled',
      };
    }

    const internalController = new AbortController();
    this.inFlightControllers.set(request.requestId, internalController);

    const onExternalAbort = () => {
      internalController.abort();
    };

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      let scenario: FakeBriefingResponseOverride | undefined =
        this.scenariosByRequestId.get(request.requestId);

      if (!scenario && this.scenarioSelector) {
        scenario = this.scenarioSelector(request, callIndex);
      }

      return await this.executeScenario(
        request,
        scenario,
        internalController.signal,
      );
    } finally {
      this.inFlightControllers.delete(request.requestId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async executeScenario(
    request: BriefingProviderRequest,
    scenario: FakeBriefingResponseOverride | undefined,
    signal?: AbortSignal,
  ): Promise<BriefingProviderResult> {
    let currentScenario = scenario;
    let delay =
      typeof this.delayMs === 'function'
        ? this.delayMs(request)
        : (this.delayMs ?? 0);

    if (currentScenario?.type === 'delay') {
      delay = currentScenario.delayMs;
      currentScenario = currentScenario.then;
    }

    if (delay > 0) {
      try {
        await delayWithAbort(delay, signal);
      } catch {
        return {
          ok: false,
          requestId: request.requestId,
          code: 'cancelled',
        };
      }
    }

    if (signal?.aborted) {
      return {
        ok: false,
        requestId: request.requestId,
        code: 'cancelled',
      };
    }

    if (!currentScenario) {
      return this.generateDefaultSuccess(request);
    }

    switch (currentScenario.type) {
      case 'success': {
        const output =
          currentScenario.output ??
          (currentScenario.sections
            ? { sections: currentScenario.sections }
            : this.generateDefaultOutput(request));
        return {
          ok: true,
          requestId: request.requestId,
          output,
        };
      }
      case 'failure': {
        return {
          ok: false,
          requestId: request.requestId,
          code: currentScenario.code,
        };
      }
      case 'wrong_correlation': {
        const output =
          currentScenario.output ?? this.generateDefaultOutput(request);
        return {
          ok: true,
          requestId: currentScenario.wrongRequestId,
          output,
        };
      }
      case 'malformed': {
        return {
          ok: true,
          requestId: request.requestId,
          output: currentScenario.rawOutput as unknown as UntrustedBriefingProviderOutput,
        };
      }
      default: {
        return this.generateDefaultSuccess(request);
      }
    }
  }

  private generateDefaultOutput(
    request: BriefingProviderRequest,
  ): UntrustedBriefingProviderOutput {
    if (this.defaultGenerator) {
      const generated = this.defaultGenerator(request);
      if (Array.isArray(generated)) {
        return { sections: generated };
      }
      return generated as UntrustedBriefingProviderOutput;
    }

    const text = request.chunk.events.map((e) => e.text).join(' ');
    return {
      sections: [
        {
          text: text || '요약된 내용입니다.',
          sourceOrdinals: [...request.chunk.sourceOrdinals],
        },
      ],
    };
  }

  private generateDefaultSuccess(
    request: BriefingProviderRequest,
  ): BriefingProviderSuccess {
    return {
      ok: true,
      requestId: request.requestId,
      output: this.generateDefaultOutput(request),
    };
  }
}
