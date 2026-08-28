import { describe, expect, it } from 'vitest';
import type {
  BriefingGeneration,
  UntrustedBriefingGeneratedSection,
  UntrustedBriefingProviderOutput,
} from './contract';
import type { BriefingModelChunk, BriefingProviderEnvelope } from './chunk';
import {
  DEFAULT_FAKE_PROVIDER_ENVELOPE,
  FakeBriefingProvider,
  type BriefingProvider,
  type BriefingProviderAvailability,
  type BriefingProviderCapability,
  type BriefingProviderErrorCode,
  type BriefingProviderFailure,
  type BriefingProviderRequest,
  type BriefingProviderResult,
  type BriefingProviderSuccess,
} from './provider';

function makeSampleChunk(
  overrides: Partial<BriefingModelChunk> = {},
): BriefingModelChunk {
  return {
    dayOrdinal: 0,
    period: 'morning',
    sourceOrdinals: [0, 1],
    events: [
      {
        ordinal: 0,
        dayOrdinal: 0,
        period: 'morning',
        text: '오전 훈련 시작',
        mediaKinds: ['photo'],
      },
      {
        ordinal: 1,
        dayOrdinal: 0,
        period: 'morning',
        text: '체력단련 완료',
        mediaKinds: [],
      },
    ],
    ...overrides,
  };
}

describe('Partner Briefing Provider Contract & Fake (Phase A5)', () => {
  describe('Availability & Error Code Unions', () => {
    it('pins BriefingProviderAvailability to the exact 5 states', () => {
      type ExpectedAvailability =
        | 'ready'
        | 'unsupported'
        | 'model_unavailable'
        | 'preparing'
        | 'locale_unsupported';

      type CoversExpected = [ExpectedAvailability] extends [BriefingProviderAvailability] ? true : false;
      type HasNoExtra = [BriefingProviderAvailability] extends [ExpectedAvailability] ? true : false;
      type Exact = CoversExpected extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);

      const states: BriefingProviderAvailability[] = [
        'ready',
        'unsupported',
        'model_unavailable',
        'preparing',
        'locale_unsupported',
      ];
      expect(states).toHaveLength(5);
    });

    it('strictly separates provider availability from domain generation classification', () => {
      type AvailabilityOverlapsGeneration = [BriefingProviderAvailability & BriefingGeneration] extends [never]
        ? false
        : true;

      const hasOverlap: AvailabilityOverlapsGeneration = false;
      expect(hasOverlap).toBe(false);
    });

    it('pins BriefingProviderErrorCode to the exact 6 failure codes', () => {
      type ExpectedCodes =
        | 'busy'
        | 'quota'
        | 'timeout'
        | 'cancelled'
        | 'malformed'
        | 'native_error';

      type CoversExpected = [ExpectedCodes] extends [BriefingProviderErrorCode] ? true : false;
      type HasNoExtra = [BriefingProviderErrorCode] extends [ExpectedCodes] ? true : false;
      type Exact = CoversExpected extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);

      const codes: BriefingProviderErrorCode[] = [
        'busy',
        'quota',
        'timeout',
        'cancelled',
        'malformed',
        'native_error',
      ];
      expect(codes).toHaveLength(6);
    });

    it('proves BriefingProviderFailure does not carry arbitrary message strings', () => {
      type FailureKeys = keyof BriefingProviderFailure;
      type ExpectedKeys = 'ok' | 'requestId' | 'code';

      type HasAll = [ExpectedKeys] extends [FailureKeys] ? true : false;
      type HasNoExtra = [FailureKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);

      type HasMessage = 'message' extends keyof BriefingProviderFailure ? true : false;
      const hasMessage: HasMessage = false;
      expect(hasMessage).toBe(false);
    });
  });

  describe('Wire Key Allowlist & Leakage Prevention', () => {
    it('pins BriefingProviderRequest compile-time keys to exactly requestId and chunk', () => {
      type RequestKeys = keyof BriefingProviderRequest;
      type ExpectedKeys = 'requestId' | 'chunk';

      type HasAll = [ExpectedKeys] extends [RequestKeys] ? true : false;
      type HasNoExtra = [RequestKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('proves forbidden identity, timestamp, path, URL, and key fields are absent from request', () => {
      type ForbiddenKeys =
        | 'id'
        | 'recordId'
        | 'userId'
        | 'coupleId'
        | 'partnerUserId'
        | 'date'
        | 'time'
        | 'createdAt'
        | 'updatedAt'
        | 'url'
        | 'path'
        | 'storagePath'
        | 'key'
        | 'secret'
        | 'keyMaterial'
        | 'attachments'
        | 'emotionFlow'
        | 'isPrivate';

      type HasForbidden = [ForbiddenKeys & keyof BriefingProviderRequest] extends [never] ? false : true;
      const hasForbidden: HasForbidden = false;
      expect(hasForbidden).toBe(false);
    });

    it('serializes request with zero forbidden metadata or leaked keys', () => {
      const sampleRequest: BriefingProviderRequest = {
        requestId: 'req-001',
        chunk: makeSampleChunk(),
      };

      const serialized = JSON.stringify(sampleRequest);
      expect(serialized).not.toContain('recordId');
      expect(serialized).not.toContain('userId');
      expect(serialized).not.toContain('coupleId');
      expect(serialized).not.toContain('http');
      expect(serialized).not.toContain('2026-');
    });
  });

  describe('Provider Capability Access', () => {
    it('exposes default envelope capability', async () => {
      const provider = new FakeBriefingProvider();
      const cap = await provider.getCapability();
      expect(cap.envelope).toEqual(DEFAULT_FAKE_PROVIDER_ENVELOPE);
      expect(cap.envelope.maxContextUtf8Bytes).toBe(4096);
    });

    it('accepts custom envelope on initialization and mutation', async () => {
      const customEnvelope: BriefingProviderEnvelope = {
        maxContextUtf8Bytes: 8192,
        promptOverheadUtf8Bytes: 512,
        responseReserveUtf8Bytes: 1024,
        maxInputTextGraphemes: 2000,
      };

      const provider = new FakeBriefingProvider({ capability: customEnvelope });
      expect((await provider.getCapability()).envelope).toEqual(customEnvelope);

      const updatedEnvelope: BriefingProviderEnvelope = {
        maxContextUtf8Bytes: 2048,
        promptOverheadUtf8Bytes: 128,
        responseReserveUtf8Bytes: 256,
        maxInputTextGraphemes: 500,
      };
      provider.setCapability(updatedEnvelope);
      expect((await provider.getCapability()).envelope).toEqual(updatedEnvelope);
    });
  });

  describe('Deterministic Fake Behavior & Output Generation', () => {
    it('produces deterministic output with request-local sourceOrdinals', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingProviderRequest = {
        requestId: 'req-leaf-1',
        chunk: makeSampleChunk({ sourceOrdinals: [0, 1] }),
      };

      const res1 = await provider.summarize(request);
      const res2 = await provider.summarize(request);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res1.requestId).toBe('req-leaf-1');
        expect(res1.output).toEqual(res2.output);
        expect(res1.output.sections[0].sourceOrdinals).toEqual([0, 1]);
        expect(res1.output.sections[0].text).toContain('오전 훈련 시작');
      }
    });

    it('tracks call history accurately and supports clearing', async () => {
      const provider = new FakeBriefingProvider();
      const req1: BriefingProviderRequest = {
        requestId: 'req-1',
        chunk: makeSampleChunk(),
      };
      const req2: BriefingProviderRequest = {
        requestId: 'req-2',
        chunk: makeSampleChunk({ dayOrdinal: 1, sourceOrdinals: [2] }),
      };

      await provider.summarize(req1);
      await provider.summarize(req2);

      expect(provider.getCallHistory()).toHaveLength(2);
      expect(provider.getCallHistory()[0].requestId).toBe('req-1');
      expect(provider.getCallHistory()[1].requestId).toBe('req-2');

      provider.clearCallHistory();
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('supports custom output generator', async () => {
      const customProvider = new FakeBriefingProvider({
        defaultGenerator: (req) => [
          {
            text: '요약 청크 이벤트',
            sourceOrdinals: req.chunk.sourceOrdinals,
          },
        ],
      });

      const res = await customProvider.summarize({
        requestId: 'custom-gen',
        chunk: makeSampleChunk(),
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.sections[0].text).toBe('요약 청크 이벤트');
        expect(res.output.sections[0].sourceOrdinals).toEqual([0, 1]);
      }
    });
  });

  describe('Per-Request Isolation', () => {
    it('isolates concurrent requests with distinct requestIds and chunks', async () => {
      const provider = new FakeBriefingProvider();
      const reqA: BriefingProviderRequest = {
        requestId: 'flight-A',
        chunk: makeSampleChunk({ sourceOrdinals: [0] }),
      };
      const reqB: BriefingProviderRequest = {
        requestId: 'flight-B',
        chunk: makeSampleChunk({ sourceOrdinals: [1, 2] }),
      };

      const [resA, resB] = await Promise.all([
        provider.summarize(reqA),
        provider.summarize(reqB),
      ]);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      if (resA.ok && resB.ok) {
        expect(resA.requestId).toBe('flight-A');
        expect(resB.requestId).toBe('flight-B');
        expect(resA.output.sections[0].sourceOrdinals).toEqual([0]);
        expect(resB.output.sections[0].sourceOrdinals).toEqual([1, 2]);
      }
    });
  });

  describe('Explicit cancel(requestId) Method Behavior', () => {
    it('cancels an in-flight delayed request A immediately when cancel(A) is called', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 150 });
      const reqA: BriefingProviderRequest = {
        requestId: 'req-delayed-A',
        chunk: makeSampleChunk({ sourceOrdinals: [0] }),
      };

      const promiseA = provider.summarize(reqA);
      setTimeout(() => {
        void provider.cancel('req-delayed-A');
      }, 20);

      const resultA = await promiseA;
      expect(resultA.ok).toBe(false);
      if (!resultA.ok) {
        expect(resultA.code).toBe('cancelled');
        expect(resultA.requestId).toBe('req-delayed-A');
      }
    });

    it('cancels request A while concurrent request B completes successfully', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 100 });
      const reqA: BriefingProviderRequest = {
        requestId: 'req-cancel-target',
        chunk: makeSampleChunk({ sourceOrdinals: [0] }),
      };
      const reqB: BriefingProviderRequest = {
        requestId: 'req-concurrent-b',
        chunk: makeSampleChunk({ sourceOrdinals: [1] }),
      };

      const promiseA = provider.summarize(reqA);
      const promiseB = provider.summarize(reqB);

      setTimeout(() => {
        void provider.cancel('req-cancel-target');
      }, 20);

      const [resA, resB] = await Promise.all([promiseA, promiseB]);

      expect(resA.ok).toBe(false);
      if (!resA.ok) {
        expect(resA.code).toBe('cancelled');
        expect(resA.requestId).toBe('req-cancel-target');
      }

      expect(resB.ok).toBe(true);
      if (resB.ok) {
        expect(resB.requestId).toBe('req-concurrent-b');
        expect(resB.output.sections[0].sourceOrdinals).toEqual([1]);
      }
    });

    it('treats unknown or stale cancel(requestId) as a safe no-op without cancelling other requests', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 50 });
      const req: BriefingProviderRequest = {
        requestId: 'req-active',
        chunk: makeSampleChunk(),
      };

      const promise = provider.summarize(req);
      await provider.cancel('non-existent-or-stale-id');

      const res = await promise;
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.requestId).toBe('req-active');
      }
    });
  });

  describe('AbortSignal Behavior', () => {
    it('returns cancelled failure immediately when signal is already aborted', async () => {
      const provider = new FakeBriefingProvider();
      const controller = new AbortController();
      controller.abort();

      const result = await provider.summarize(
        {
          requestId: 'aborted-pre',
          chunk: makeSampleChunk(),
        },
        controller.signal,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('cancelled');
        expect(result.requestId).toBe('aborted-pre');
      }
    });

    it('cancels delayed request mid-flight when signal aborts', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 100 });
      const controller = new AbortController();

      const promise = provider.summarize(
        {
          requestId: 'delayed-abort',
          chunk: makeSampleChunk(),
        },
        { signal: controller.signal },
      );

      setTimeout(() => controller.abort(), 20);

      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('cancelled');
        expect(result.requestId).toBe('delayed-abort');
      }
    });
  });

  describe('Configured Scenarios (Failures, Malformed, Wrong Correlation)', () => {
    it('supports configured failure codes per requestId without arbitrary message', async () => {
      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-busy': { type: 'failure', code: 'busy' },
          'req-quota': { type: 'failure', code: 'quota' },
          'req-timeout': { type: 'failure', code: 'timeout' },
          'req-native': { type: 'failure', code: 'native_error' },
        },
      });

      const resBusy = await provider.summarize({ requestId: 'req-busy', chunk: makeSampleChunk() });
      expect(resBusy.ok).toBe(false);
      if (!resBusy.ok) {
        expect(resBusy.code).toBe('busy');
        expect(resBusy.requestId).toBe('req-busy');
        expect('message' in resBusy).toBe(false);
      }

      const resQuota = await provider.summarize({ requestId: 'req-quota', chunk: makeSampleChunk() });
      expect(resQuota.ok).toBe(false);
      if (!resQuota.ok) expect(resQuota.code).toBe('quota');

      const resTimeout = await provider.summarize({ requestId: 'req-timeout', chunk: makeSampleChunk() });
      expect(resTimeout.ok).toBe(false);
      if (!resTimeout.ok) expect(resTimeout.code).toBe('timeout');

      const resNative = await provider.summarize({ requestId: 'req-native', chunk: makeSampleChunk() });
      expect(resNative.ok).toBe(false);
      if (!resNative.ok) expect(resNative.code).toBe('native_error');
    });

    it('supports malformed raw output scenario', async () => {
      const malformedRaw = { unexpected: 123, invalidField: true };
      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-malformed': { type: 'malformed', rawOutput: malformedRaw },
        },
      });

      const res = await provider.summarize({
        requestId: 'req-malformed',
        chunk: makeSampleChunk(),
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output).toEqual(malformedRaw);
      }
    });

    it('supports wrong/stale correlation scenario', async () => {
      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-expected': {
            type: 'wrong_correlation',
            wrongRequestId: 'req-stale-other',
          },
        },
      });

      const res = await provider.summarize({
        requestId: 'req-expected',
        chunk: makeSampleChunk(),
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.requestId).toBe('req-stale-other');
      }
    });

    it('supports dynamic scenarioSelector for partial / conditional behaviors', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: (req, callIndex) => {
          if (callIndex === 0) {
            return { type: 'failure', code: 'busy' };
          }
          return undefined;
        },
      });

      const res1 = await provider.summarize({ requestId: 'call-1', chunk: makeSampleChunk() });
      const res2 = await provider.summarize({ requestId: 'call-2', chunk: makeSampleChunk() });

      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.code).toBe('busy');
      expect(res2.ok).toBe(true);
    });
  });
});
