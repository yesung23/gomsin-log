import { describe, expect, it } from 'vitest';
import type {
  BriefingExtractCandidate,
  BriefingExtractRequestItem,
  BriefingGeneration,
  BriefingLocale,
  UntrustedBriefingChoice,
  UntrustedBriefingGroup,
  UntrustedBriefingGroupPlan,
  UntrustedBriefingExtractPlan,
} from './contract';
import type { BriefingProviderEnvelope } from './chunk';
import {
  DEFAULT_FAKE_PROVIDER_ENVELOPE,
  FakeBriefingProvider,
  type BriefingExtractFailure,
  type BriefingExtractRequest,
  type BriefingExtractResult,
  type BriefingExtractSuccess,
  type BriefingProvider,
  type BriefingProviderAvailability,
  type BriefingProviderAvailabilityOptions,
  type BriefingProviderCapability,
  type BriefingProviderErrorCode,
  type BriefingProviderSelectExtractsOptions,
} from './provider';

function makeSampleExtractRequest(
  overrides: Partial<BriefingExtractRequest> = {},
): BriefingExtractRequest {
  return {
    requestId: 'req-001',
    items: [
      {
        itemOrdinal: 0,
        candidates: [
          { candidateOrdinal: 0, text: '오전 훈련 시작' },
          { candidateOrdinal: 1, text: '훈련 시작' },
        ],
      },
      {
        itemOrdinal: 1,
        candidates: [
          { candidateOrdinal: 0, text: '체력단련 완료' },
          { candidateOrdinal: 1, text: '오후 체력단련 완료' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Partner Briefing Provider Contract & Fake (Phase A5 Amendment)', () => {
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

    it('proves BriefingExtractFailure does not carry arbitrary message strings', () => {
      type FailureKeys = keyof BriefingExtractFailure;
      type ExpectedKeys = 'ok' | 'requestId' | 'code';

      type HasAll = [ExpectedKeys] extends [FailureKeys] ? true : false;
      type HasNoExtra = [FailureKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);

      type HasMessage = 'message' extends keyof BriefingExtractFailure ? true : false;
      const hasMessage: HasMessage = false;
      expect(hasMessage).toBe(false);
    });
  });

  describe('Closed-Extract Wire Key Allowlist & Leakage Prevention', () => {
    it('pins BriefingExtractRequest compile-time keys to exactly requestId and items', () => {
      type RequestKeys = keyof BriefingExtractRequest;
      type ExpectedKeys = 'requestId' | 'items';

      type HasAll = [ExpectedKeys] extends [RequestKeys] ? true : false;
      type HasNoExtra = [RequestKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('pins BriefingExtractRequestItem compile-time keys to exactly itemOrdinal and candidates', () => {
      type ItemKeys = keyof BriefingExtractRequestItem;
      type ExpectedKeys = 'itemOrdinal' | 'candidates';

      type HasAll = [ExpectedKeys] extends [ItemKeys] ? true : false;
      type HasNoExtra = [ItemKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('pins BriefingExtractCandidate compile-time keys to exactly candidateOrdinal and text', () => {
      type CandidateKeys = keyof BriefingExtractCandidate;
      type ExpectedKeys = 'candidateOrdinal' | 'text';

      type HasAll = [ExpectedKeys] extends [CandidateKeys] ? true : false;
      type HasNoExtra = [CandidateKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('proves forbidden identity, timestamp, path, URL, media, and key fields are absent from request', () => {
      type ForbiddenKeys =
        | 'id'
        | 'recordId'
        | 'sourceRecordId'
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
        | 'mediaKinds'
        | 'attachments'
        | 'emotionFlow'
        | 'isPrivate'
        | 'locale';

      type HasForbiddenInRequest = [ForbiddenKeys & keyof BriefingExtractRequest] extends [never] ? false : true;
      const hasForbiddenInRequest: HasForbiddenInRequest = false;
      expect(hasForbiddenInRequest).toBe(false);

      type HasForbiddenInItem = [ForbiddenKeys & keyof BriefingExtractRequestItem] extends [never] ? false : true;
      const hasForbiddenInItem: HasForbiddenInItem = false;
      expect(hasForbiddenInItem).toBe(false);

      type HasForbiddenInCandidate = [ForbiddenKeys & keyof BriefingExtractCandidate] extends [never] ? false : true;
      const hasForbiddenInCandidate: HasForbiddenInCandidate = false;
      expect(hasForbiddenInCandidate).toBe(false);
    });

    it('serializes extract request with zero forbidden metadata or leaked keys', () => {
      const sampleRequest = makeSampleExtractRequest();
      const serialized = JSON.stringify(sampleRequest);

      expect(serialized).not.toContain('recordId');
      expect(serialized).not.toContain('sourceRecordId');
      expect(serialized).not.toContain('userId');
      expect(serialized).not.toContain('coupleId');
      expect(serialized).not.toContain('mediaKinds');
      expect(serialized).not.toContain('http');
      expect(serialized).not.toContain('2026-');
      expect(serialized).not.toContain('locale');
    });
  });

  describe('Success Output Wire Keys & Text Exclusion Invariants', () => {
    it('pins BriefingExtractSuccess compile-time keys to exactly ok, requestId, and output', () => {
      type SuccessKeys = keyof BriefingExtractSuccess;
      type ExpectedKeys = 'ok' | 'requestId' | 'output';

      type HasAll = [ExpectedKeys] extends [SuccessKeys] ? true : false;
      type HasNoExtra = [SuccessKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('pins UntrustedBriefingGroupPlan compile-time keys to exactly version and groups', () => {
      type PlanKeys = keyof UntrustedBriefingGroupPlan;
      type ExpectedKeys = 'version' | 'groups';

      type HasAll = [ExpectedKeys] extends [PlanKeys] ? true : false;
      type HasNoExtra = [PlanKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('pins UntrustedBriefingChoice compile-time keys to exactly itemOrdinal and candidateOrdinal', () => {
      type ChoiceKeys = keyof UntrustedBriefingChoice;
      type ExpectedKeys = 'itemOrdinal' | 'candidateOrdinal';

      type HasAll = [ExpectedKeys] extends [ChoiceKeys] ? true : false;
      type HasNoExtra = [ChoiceKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('proves choices contain numeric ordinals only and NO generated text fields', () => {
      type ForbiddenChoiceFields =
        | 'text'
        | 'string'
        | 'claim'
        | 'title'
        | 'label'
        | 'summary'
        | 'overview'
        | 'section';

      type HasForbiddenChoice = [ForbiddenChoiceFields & keyof UntrustedBriefingChoice] extends [never]
        ? false
        : true;
      const hasForbiddenChoice: HasForbiddenChoice = false;
      expect(hasForbiddenChoice).toBe(false);

      type HasForbiddenPlan = [ForbiddenChoiceFields & keyof UntrustedBriefingExtractPlan] extends [never]
        ? false
        : true;
      const hasForbiddenPlan: HasForbiddenPlan = false;
      expect(hasForbiddenPlan).toBe(false);
    });

    it('verifies fake success output has version 2 and numeric ordinal groups with no authored text', async () => {
      const provider = new FakeBriefingProvider();
      const request = makeSampleExtractRequest();

      const result = await provider.selectExtracts(request);
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.requestId).toBe('req-001');
        expect(result.output.version).toBe(2);
        expect(Array.isArray(result.output.groups)).toBe(true);
        expect(result.output.groups).toHaveLength(1);
        expect(result.output.groups[0].choices).toHaveLength(2);

        for (const group of result.output.groups) {
          expect(typeof group.groupOrdinal).toBe('number');
          for (const choice of group.choices) {
            expect(typeof choice.itemOrdinal).toBe('number');
            expect(typeof choice.candidateOrdinal).toBe('number');
            expect(Number.isSafeInteger(choice.itemOrdinal)).toBe(true);
            expect(Number.isSafeInteger(choice.candidateOrdinal)).toBe(true);
            expect('text' in choice).toBe(false);
          }
        }

        const serializedOutput = JSON.stringify(result.output);
        expect(serializedOutput).not.toContain('"text"');
        expect(serializedOutput).not.toContain('요약');
      }
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
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      const provider = new FakeBriefingProvider({ capability: customEnvelope });
      expect((await provider.getCapability()).envelope).toEqual(customEnvelope);

      const updatedEnvelope: BriefingProviderEnvelope = {
        maxContextUtf8Bytes: 2048,
        promptOverheadUtf8Bytes: 128,
        responseReserveUtf8Bytes: 256,
        maxInputTextGraphemes: 500,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };
      provider.setCapability(updatedEnvelope);
      expect((await provider.getCapability()).envelope).toEqual(updatedEnvelope);
    });
  });

  describe('Deterministic Fake Behavior & Request-Order Choices', () => {
    it('produces deterministic output selecting candidateOrdinal 0 in request order', async () => {
      const provider = new FakeBriefingProvider();
      const request = makeSampleExtractRequest();

      const res1 = await provider.selectExtracts(request);
      const res2 = await provider.selectExtracts(request);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      if (res1.ok && res2.ok) {
        expect(res1.requestId).toBe('req-001');
        expect(res1.output).toEqual(res2.output);
        expect(res1.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 0 },
            ],
          },
        ]);
      }
    });

    it('preserves request order for multi-item requests with arbitrary candidate counts', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingExtractRequest = {
        requestId: 'req-multi',
        items: [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: 'extract 0-0' },
              { candidateOrdinal: 1, text: 'extract 0-1' },
              { candidateOrdinal: 2, text: 'extract 0-2' },
            ],
          },
          {
            itemOrdinal: 1,
            candidates: [
              { candidateOrdinal: 0, text: 'extract 1-0' },
            ],
          },
          {
            itemOrdinal: 2,
            candidates: [
              { candidateOrdinal: 0, text: 'extract 2-0' },
              { candidateOrdinal: 1, text: 'extract 2-1' },
            ],
          },
        ],
      };

      const res = await provider.selectExtracts(request);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.groups).toHaveLength(1);
        expect(res.output.groups[0].choices).toHaveLength(3);
        expect(res.output.groups[0].choices[0]).toEqual({ itemOrdinal: 0, candidateOrdinal: 0 });
        expect(res.output.groups[0].choices[1]).toEqual({ itemOrdinal: 1, candidateOrdinal: 0 });
        expect(res.output.groups[0].choices[2]).toEqual({ itemOrdinal: 2, candidateOrdinal: 0 });
      }
    });

    it('groups 5 items into contiguous groups of 3 and 2 to avoid trailing singleton', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingExtractRequest = {
        requestId: 'req-5-items',
        items: Array.from({ length: 5 }, (_, i) => ({
          itemOrdinal: i,
          candidates: [{ candidateOrdinal: 0, text: `item ${i}` }],
        })),
      };

      const res = await provider.selectExtracts(request);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.version).toBe(2);
        expect(res.output.groups).toHaveLength(2);
        expect(res.output.groups[0].groupOrdinal).toBe(0);
        expect(res.output.groups[0].choices).toHaveLength(3);
        expect(res.output.groups[0].choices.map((c) => c.itemOrdinal)).toEqual([0, 1, 2]);
        expect(res.output.groups[1].groupOrdinal).toBe(1);
        expect(res.output.groups[1].choices).toHaveLength(2);
        expect(res.output.groups[1].choices.map((c) => c.itemOrdinal)).toEqual([3, 4]);
      }
    });

    it('groups 8 items into contiguous groups of 4 and 4', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingExtractRequest = {
        requestId: 'req-8-items',
        items: Array.from({ length: 8 }, (_, i) => ({
          itemOrdinal: i,
          candidates: [{ candidateOrdinal: 0, text: `item ${i}` }],
        })),
      };

      const res = await provider.selectExtracts(request);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.version).toBe(2);
        expect(res.output.groups).toHaveLength(2);
        expect(res.output.groups[0].choices).toHaveLength(4);
        expect(res.output.groups[0].choices.map((c) => c.itemOrdinal)).toEqual([0, 1, 2, 3]);
        expect(res.output.groups[1].choices).toHaveLength(4);
        expect(res.output.groups[1].choices.map((c) => c.itemOrdinal)).toEqual([4, 5, 6, 7]);
      }
    });

    it('groups 1 item into a single singleton group', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingExtractRequest = {
        requestId: 'req-1-item',
        items: [
          {
            itemOrdinal: 0,
            candidates: [{ candidateOrdinal: 0, text: 'only item' }],
          },
        ],
      };

      const res = await provider.selectExtracts(request);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.version).toBe(2);
        expect(res.output.groups).toHaveLength(1);
        expect(res.output.groups[0].choices).toHaveLength(1);
        expect(res.output.groups[0].choices[0].itemOrdinal).toBe(0);
      }
    });

    it('supports custom choice generator without text fields', async () => {
      const customProvider = new FakeBriefingProvider({
        defaultExtractGenerator: (req) => ({
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: [
                { itemOrdinal: 0, candidateOrdinal: 1 },
                { itemOrdinal: 1, candidateOrdinal: 1 },
              ],
            },
          ],
        }),
      });

      const res = await customProvider.selectExtracts(makeSampleExtractRequest());
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.version).toBe(2);
        expect(res.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 1 },
              { itemOrdinal: 1, candidateOrdinal: 1 },
            ],
          },
        ]);
      }
    });
  });

  describe('Empty Candidates Handling & No Silent Invention', () => {
    it('does not silently invent candidate extracts for items with empty candidate lists', async () => {
      const provider = new FakeBriefingProvider();
      const request: BriefingExtractRequest = {
        requestId: 'req-empty-cand',
        items: [
          { itemOrdinal: 0, candidates: [] },
          {
            itemOrdinal: 1,
            candidates: [{ candidateOrdinal: 0, text: '단련 완료' }],
          },
        ],
      };

      const res = await provider.selectExtracts(request);
      expect(res.ok).toBe(true);
      if (res.ok) {
        // Does not invent candidate 0 for item 0
        expect(res.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 1, candidateOrdinal: 0 },
            ],
          },
        ]);
      }
    });
  });

  describe('Per-Request Isolation', () => {
    it('isolates concurrent requests with distinct requestIds and item sets', async () => {
      const provider = new FakeBriefingProvider();
      const reqA: BriefingExtractRequest = {
        requestId: 'flight-A',
        items: [
          { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: 'A0' }] },
        ],
      };
      const reqB: BriefingExtractRequest = {
        requestId: 'flight-B',
        items: [
          { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: 'B0' }] },
          { itemOrdinal: 1, candidates: [{ candidateOrdinal: 0, text: 'B1' }] },
        ],
      };

      const [resA, resB] = await Promise.all([
        provider.selectExtracts(reqA),
        provider.selectExtracts(reqB),
      ]);

      expect(resA.ok).toBe(true);
      expect(resB.ok).toBe(true);
      if (resA.ok && resB.ok) {
        expect(resA.requestId).toBe('flight-A');
        expect(resB.requestId).toBe('flight-B');
        expect(resA.output.groups).toHaveLength(1);
        expect(resA.output.groups[0].choices).toHaveLength(1);
        expect(resB.output.groups).toHaveLength(1);
        expect(resB.output.groups[0].choices).toHaveLength(2);
      }
    });
  });

  describe('Explicit cancel(requestId) Method Behavior', () => {
    it('cancels an in-flight delayed request A immediately when cancel(A) is called', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 150 });
      const reqA = makeSampleExtractRequest({ requestId: 'req-delayed-A' });

      const promiseA = provider.selectExtracts(reqA);
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
      const reqA = makeSampleExtractRequest({ requestId: 'req-cancel-target' });
      const reqB = makeSampleExtractRequest({ requestId: 'req-concurrent-b' });

      const promiseA = provider.selectExtracts(reqA);
      const promiseB = provider.selectExtracts(reqB);

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
        expect(resB.output.groups).toHaveLength(1);
        expect(resB.output.groups[0].choices).toHaveLength(2);
      }
    });

    it('treats unknown or stale cancel(requestId) as a safe no-op without cancelling other requests', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 50 });
      const req = makeSampleExtractRequest({ requestId: 'req-active' });

      const promise = provider.selectExtracts(req);
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

      const result = await provider.selectExtracts(
        makeSampleExtractRequest({ requestId: 'aborted-pre' }),
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

      const promise = provider.selectExtracts(
        makeSampleExtractRequest({ requestId: 'delayed-abort' }),
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

  describe('Configured Scenarios (Failures, Malformed, Wrong Correlation, Custom Choices)', () => {
    it('supports configured failure codes per requestId without arbitrary message', async () => {
      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-busy': { type: 'failure', code: 'busy' },
          'req-quota': { type: 'failure', code: 'quota' },
          'req-timeout': { type: 'failure', code: 'timeout' },
          'req-native': { type: 'failure', code: 'native_error' },
        },
      });

      const resBusy = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-busy' }));
      expect(resBusy.ok).toBe(false);
      if (!resBusy.ok) {
        expect(resBusy.code).toBe('busy');
        expect(resBusy.requestId).toBe('req-busy');
        expect('message' in resBusy).toBe(false);
      }

      const resQuota = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-quota' }));
      expect(resQuota.ok).toBe(false);
      if (!resQuota.ok) expect(resQuota.code).toBe('quota');

      const resTimeout = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-timeout' }));
      expect(resTimeout.ok).toBe(false);
      if (!resTimeout.ok) expect(resTimeout.code).toBe('timeout');

      const resNative = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-native' }));
      expect(resNative.ok).toBe(false);
      if (!resNative.ok) expect(resNative.code).toBe('native_error');
    });

    it('supports malformed raw output scenario passthrough for verifier', async () => {
      const malformedRaw = { invalidRoot: true, unexpectedText: 'hello' };
      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-malformed': { type: 'malformed', rawOutput: malformedRaw },
        },
      });

      const res = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-malformed' }));
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

      const res = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-expected' }));
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.requestId).toBe('req-stale-other');
      }
    });

    it('supports custom success choices scenario', async () => {
      const customChoices: readonly UntrustedBriefingChoice[] = [
        { itemOrdinal: 0, candidateOrdinal: 1 },
        { itemOrdinal: 1, candidateOrdinal: 0 },
      ];

      const provider = new FakeBriefingProvider({
        scenariosByRequestId: {
          'req-custom-choices': {
            type: 'success',
            choices: customChoices,
          },
        },
      });

      const res = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'req-custom-choices' }));
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.output.version).toBe(2);
        expect(res.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: customChoices,
          },
        ]);
      }
    });

    it('supports dynamic scenarioSelector for conditional / partial behaviors', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: (req, callIndex) => {
          if (callIndex === 0) {
            return { type: 'failure', code: 'busy' };
          }
          return undefined;
        },
      });

      const res1 = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'call-1' }));
      const res2 = await provider.selectExtracts(makeSampleExtractRequest({ requestId: 'call-2' }));

      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.code).toBe('busy');
      expect(res2.ok).toBe(true);
    });
  });

  describe('Call History Tracking', () => {
    it('tracks extract call history accurately and supports clearing', async () => {
      const provider = new FakeBriefingProvider();
      const req1 = makeSampleExtractRequest({ requestId: 'req-1' });
      const req2 = makeSampleExtractRequest({ requestId: 'req-2' });

      await provider.selectExtracts(req1);
      await provider.selectExtracts(req2);

      expect(provider.getCallHistory()).toHaveLength(2);
      expect(provider.getCallHistory()[0].requestId).toBe('req-1');
      expect(provider.getCallHistory()[1].requestId).toBe('req-2');

      provider.clearCallHistory();
      expect(provider.getCallHistory()).toHaveLength(0);
    });
  });

  describe('Provider Options Contract (Locale L3a)', () => {
    it('pins BriefingProviderAvailabilityOptions compile-time keys to exactly signal and locale', () => {
      type OptionsKeys = keyof BriefingProviderAvailabilityOptions;
      type ExpectedKeys = 'signal' | 'locale';

      type HasAll = [ExpectedKeys] extends [OptionsKeys] ? true : false;
      type HasNoExtra = [OptionsKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('pins BriefingProviderSelectExtractsOptions compile-time keys to exactly signal and locale', () => {
      type OptionsKeys = keyof BriefingProviderSelectExtractsOptions;
      type ExpectedKeys = 'signal' | 'locale';

      type HasAll = [ExpectedKeys] extends [OptionsKeys] ? true : false;
      type HasNoExtra = [OptionsKeys] extends [ExpectedKeys] ? true : false;
      type Exact = HasAll extends true ? (HasNoExtra extends true ? true : false) : false;

      const isExact: Exact = true;
      expect(isExact).toBe(true);
    });

    it('proves options locale property reuses BriefingLocale type without ad-hoc extensions', () => {
      type AvailLocale = NonNullable<BriefingProviderAvailabilityOptions['locale']>;
      type SelectLocale = NonNullable<BriefingProviderSelectExtractsOptions['locale']>;

      type AvailMatches = [BriefingLocale] extends [AvailLocale]
        ? [AvailLocale] extends [BriefingLocale]
          ? true
          : false
        : false;
      type SelectMatches = [BriefingLocale] extends [SelectLocale]
        ? [SelectLocale] extends [BriefingLocale]
          ? true
          : false
        : false;

      const availMatches: AvailMatches = true;
      const selectMatches: SelectMatches = true;
      expect(availMatches).toBe(true);
      expect(selectMatches).toBe(true);
    });

    it('preserves getAvailability semantics when passed options with locale or direct AbortSignal', async () => {
      const provider = new FakeBriefingProvider();

      // Default ready without options
      expect(await provider.getAvailability()).toBe('ready');

      // With locale 'ko' / 'en'
      expect(await provider.getAvailability({ locale: 'ko' })).toBe('ready');
      expect(await provider.getAvailability({ locale: 'en' })).toBe('ready');

      // With aborted signal inside options
      const controller = new AbortController();
      controller.abort();
      expect(await provider.getAvailability({ locale: 'ko', signal: controller.signal })).toBe('unsupported');
      expect(await provider.getAvailability({ locale: 'en', signal: controller.signal })).toBe('unsupported');

      // Direct AbortSignal overload compatibility
      const activeController = new AbortController();
      expect(await provider.getAvailability(activeController.signal)).toBe('ready');
      expect(await provider.getAvailability(controller.signal)).toBe('unsupported');
    });

    it('preserves selectExtracts success semantics when passed options with locale (ko / en)', async () => {
      const provider = new FakeBriefingProvider();
      const request = makeSampleExtractRequest({ requestId: 'req-locale-test' });

      const resKo = await provider.selectExtracts(request, { locale: 'ko' });
      expect(resKo.ok).toBe(true);
      if (resKo.ok) {
        expect(resKo.requestId).toBe('req-locale-test');
        expect(resKo.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 0 },
            ],
          },
        ]);
      }

      const resEn = await provider.selectExtracts(request, { locale: 'en' });
      expect(resEn.ok).toBe(true);
      if (resEn.ok) {
        expect(resEn.requestId).toBe('req-locale-test');
        expect(resEn.output.groups).toEqual([
          {
            groupOrdinal: 0,
            choices: [
              { itemOrdinal: 0, candidateOrdinal: 0 },
              { itemOrdinal: 1, candidateOrdinal: 0 },
            ],
          },
        ]);
      }
    });

    it('preserves selectExtracts cancellation semantics when passed options with locale and signal', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 100 });
      const controller = new AbortController();
      const req = makeSampleExtractRequest({ requestId: 'req-abort-with-locale' });

      const promise = provider.selectExtracts(req, {
        locale: 'ko',
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 20);

      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('cancelled');
        expect(result.requestId).toBe('req-abort-with-locale');
      }
    });

    it('preserves direct AbortSignal overload compatibility for selectExtracts', async () => {
      const provider = new FakeBriefingProvider();
      const activeController = new AbortController();
      const req = makeSampleExtractRequest({ requestId: 'req-direct-signal' });

      const result = await provider.selectExtracts(req, activeController.signal);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.requestId).toBe('req-direct-signal');
      }

      const abortedController = new AbortController();
      abortedController.abort();
      const abortedResult = await provider.selectExtracts(req, abortedController.signal);
      expect(abortedResult.ok).toBe(false);
      if (!abortedResult.ok) {
        expect(abortedResult.code).toBe('cancelled');
      }
    });
  });
});
