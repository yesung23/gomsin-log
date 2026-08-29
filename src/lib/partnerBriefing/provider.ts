/**
 * Partner Briefing Closed-Extract Provider Contract and Configurable Fake (Phase A5 Amendment - v2 Grouping Plan)
 *
 * Defines the common on-device provider contract for candidate extract selection
 * and a deterministic fake provider for testing and cross-platform pipeline execution.
 *
 * Architectural invariants:
 * 1. Model boundary: Request crosses the model boundary with exactly { requestId, items }.
 *    Each item contains only request-local itemOrdinal and candidate extracts.
 *    Zero record/user/couple IDs, exact dates/times, URLs, storage paths, or key material.
 * 2. Closed extract selection: The provider returns ONLY UntrustedBriefingExtractPlan
 *    (version: 2, groups: { groupOrdinal, choices: { itemOrdinal, candidateOrdinal }[] }[]).
 *    Zero generated, free-form, or displayable text fields whatsoever.
 * 3. Method semantics: The primary method is `selectExtracts`, reflecting closed candidate
 *    selection rather than free-form summarization.
 * 4. Runtime availability states ('ready' | 'unsupported' | 'model_unavailable' |
 *    'preparing' | 'locale_unsupported') are kept separate from domain generation
 *    ('on_device' | 'hybrid' | 'deterministic').
 * 5. Failure codes ('busy' | 'quota' | 'timeout' | 'cancelled' | 'malformed' |
 *    'native_error') capture execution failure modes without throwing.
 *    Failures contain only { ok: false, requestId?, code } with no arbitrary message strings.
 * 6. Explicit cancellation support via both cancel(requestId) and AbortSignal.
 * 7. Default fake behavior: Deterministically partitions requested items into contiguous groups
 *    sized 2..4 (or 1 singleton if exactly 1 item requested) covering all requested items
 *    in request order. Avoids trailing singletons for N >= 2 (e.g. 5 => 2 + 3).
 *    Selects candidateOrdinal 0 for every item choice. Never invents candidates for empty items.
 * 8. Configurable testing scenarios: Success, failure codes, wrong correlation, malformed
 *    raw output passthrough, delay, and call history.
 * 9. Zero verification (Gate A6), zero fallback/pipeline (Gate A7), zero native plugins,
 *    zero server inference, zero logging, and zero persistence.
 */

import type {
  BriefingExtractRequestItem,
  BriefingLocale,
  UntrustedBriefingChoice,
  UntrustedBriefingGroup,
  UntrustedBriefingGroupPlan,
  UntrustedBriefingExtractPlan,
} from './contract';
import { isValidProviderEnvelope, type BriefingProviderEnvelope } from './chunk';

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
 * Model-safe extract selection request sent to a briefing provider.
 * Contains only requestId and model-safe request-local items with source candidates.
 */
export interface BriefingExtractRequest {
  readonly requestId: string;
  readonly items: readonly BriefingExtractRequestItem[];
}

export type BriefingProviderExtractRequest = BriefingExtractRequest;

/**
 * Successful response from a briefing provider with correlated requestId.
 * Output extract plan contains only version 2 and request-local ordinal groups and choices.
 * Contains zero generated or displayable text fields.
 */
export interface BriefingExtractSuccess {
  readonly ok: true;
  readonly requestId: string;
  readonly output: UntrustedBriefingExtractPlan;
}

export type BriefingProviderExtractSuccess = BriefingExtractSuccess;

/**
 * Failed response from a briefing provider with correlated requestId and error code.
 * Excludes arbitrary message strings to prevent logging or leaking sensitive runtime details.
 */
export interface BriefingExtractFailure {
  readonly ok: false;
  readonly requestId?: string;
  readonly code: BriefingProviderErrorCode;
}

export type BriefingProviderExtractFailure = BriefingExtractFailure;

/**
 * Discriminated union of closed-extract provider results.
 */
export type BriefingExtractResult =
  | BriefingExtractSuccess
  | BriefingExtractFailure;

export type BriefingExtractResponse = BriefingExtractResult;
export type BriefingProviderExtractResult = BriefingExtractResult;

/**
 * Options passed when checking provider availability.
 */
export interface BriefingProviderAvailabilityOptions {
  readonly signal?: AbortSignal;
  readonly locale?: BriefingLocale;
}

/**
 * Options passed when executing a candidate extract selection request.
 */
export interface BriefingProviderSelectExtractsOptions {
  readonly signal?: AbortSignal;
  readonly locale?: BriefingLocale;
}

/**
 * Common provider interface for on-device Partner Briefing inference.
 */
export interface BriefingProvider {
  getAvailability(
    optionsOrSignal?: BriefingProviderAvailabilityOptions | AbortSignal,
  ): Promise<BriefingProviderAvailability>;
  getCapability(): Promise<BriefingProviderCapability> | BriefingProviderCapability;
  selectExtracts(
    request: BriefingExtractRequest,
    optionsOrSignal?: BriefingProviderSelectExtractsOptions | AbortSignal,
  ): Promise<BriefingExtractResult>;
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
  // Same structural limits both native parsers enforce, so the fake provider exercises
  // the same batcher behaviour a device does.
  maxItems: 64,
  maxCandidatesPerItem: 32,
};

/**
 * Scenario override configuration for fake provider testing.
 */
export type FakeBriefingResponseOverride =
  | {
      readonly type: 'success';
      readonly output?: UntrustedBriefingExtractPlan;
      readonly groups?: readonly UntrustedBriefingGroup[];
      readonly choices?: readonly UntrustedBriefingChoice[];
    }
  | {
      readonly type: 'failure';
      readonly code: BriefingProviderErrorCode;
    }
  | {
      readonly type: 'wrong_correlation';
      readonly wrongRequestId: string;
      readonly output?: UntrustedBriefingExtractPlan;
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
  readonly delayMs?:
    | number
    | ((request: BriefingExtractRequest) => number);
  readonly defaultExtractGenerator?: (
    request: BriefingExtractRequest,
  ) => UntrustedBriefingExtractPlan | readonly UntrustedBriefingGroup[];
  readonly scenariosByRequestId?: Record<string, FakeBriefingResponseOverride>;
  readonly scenarioSelector?: (
    request: BriefingExtractRequest,
    callIndex: number,
  ) => FakeBriefingResponseOverride | undefined;
}

function extractSignal(
  optionsOrSignal?:
    | BriefingProviderSelectExtractsOptions
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
  private delayMs?:
    | number
    | ((request: BriefingExtractRequest) => number);
  private defaultExtractGenerator?: (
    request: BriefingExtractRequest,
  ) => UntrustedBriefingExtractPlan | readonly UntrustedBriefingGroup[];
  private scenariosByRequestId: Map<string, FakeBriefingResponseOverride>;
  private scenarioSelector?: (
    request: BriefingExtractRequest,
    callIndex: number,
  ) => FakeBriefingResponseOverride | undefined;
  private callHistory: BriefingExtractRequest[] = [];
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
    this.defaultExtractGenerator = config.defaultExtractGenerator;
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

  getCallHistory(): readonly BriefingExtractRequest[] {
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

  async selectExtracts(
    request: BriefingExtractRequest,
    optionsOrSignal?: BriefingProviderSelectExtractsOptions | AbortSignal,
  ): Promise<BriefingExtractResult> {
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

      return await this.executeExtractScenario(
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

  private async executeExtractScenario(
    request: BriefingExtractRequest,
    scenario: FakeBriefingResponseOverride | undefined,
    signal?: AbortSignal,
  ): Promise<BriefingExtractResult> {
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
      return this.generateDefaultExtractSuccess(request);
    }

   switch (currentScenario.type) {
     case 'success': {
        let output: UntrustedBriefingExtractPlan;
        if (currentScenario.output) {
          output = currentScenario.output;
        } else if (currentScenario.groups) {
          output = { version: 2 as const, groups: currentScenario.groups };
        } else if (currentScenario.choices) {
          output = {
            version: 2 as const,
            groups: [{ groupOrdinal: 0, choices: currentScenario.choices }],
          };
        } else {
          output = this.generateDefaultExtractOutput(request);
        }
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
          (currentScenario.output as UntrustedBriefingExtractPlan | undefined) ??
          this.generateDefaultExtractOutput(request);
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
          output: currentScenario.rawOutput as unknown as UntrustedBriefingExtractPlan,
        };
      }
      default: {
        return this.generateDefaultExtractSuccess(request);
      }
    }
  }

  private generateDefaultExtractOutput(
    request: BriefingExtractRequest,
  ): UntrustedBriefingExtractPlan {
    if (this.defaultExtractGenerator) {
      const generated = this.defaultExtractGenerator(request);
      if (Array.isArray(generated)) {
        return { version: 2, groups: generated };
      }
      return generated as UntrustedBriefingGroupPlan;
    }

    const validItems = request.items.filter(
      (item) => item.candidates && item.candidates.length > 0,
    );

    if (validItems.length === 0) {
      return {
        version: 2,
        groups: [],
      };
    }

    if (validItems.length === 1) {
      return {
        version: 2,
        groups: [
          {
            groupOrdinal: 0,
            choices: [
              {
                itemOrdinal: validItems[0].itemOrdinal,
                candidateOrdinal: validItems[0].candidates[0].candidateOrdinal,
              },
            ],
          },
        ],
      };
    }

    // Partition valid items into contiguous groups sized 2..4, avoiding trailing singletons
    const groupSizes: number[] = [];
    let remaining = validItems.length;
    while (remaining > 0) {
      if (remaining === 5) {
        groupSizes.push(3, 2);
        remaining = 0;
      } else if (remaining >= 4) {
        groupSizes.push(4);
        remaining -= 4;
      } else {
        groupSizes.push(remaining);
        remaining = 0;
      }
    }

    const groups: UntrustedBriefingGroup[] = [];
    let itemIdx = 0;
    for (let g = 0; g < groupSizes.length; g++) {
      const size = groupSizes[g];
      const choices: UntrustedBriefingChoice[] = [];
      for (let i = 0; i < size; i++) {
        const item = validItems[itemIdx++];
        choices.push({
          itemOrdinal: item.itemOrdinal,
          candidateOrdinal: item.candidates[0].candidateOrdinal,
        });
      }
      groups.push({
        groupOrdinal: g,
        choices,
      });
    }

    return {
      version: 2,
      groups,
    };
  }

  private generateDefaultExtractSuccess(
    request: BriefingExtractRequest,
  ): BriefingExtractSuccess {
    return {
      ok: true,
      requestId: request.requestId,
      output: this.generateDefaultExtractOutput(request),
    };
  }
}
