import { describe, expect, it } from 'vitest';
import type {
  BriefingModelSafeEvent,
  BriefingSourceMapping,
} from './contract';
import type { BriefingDayMapping } from './normalize';
import {
  FakeBriefingProvider,
  type BriefingProviderAvailability,
} from './provider';
import {
  PartnerBriefingRunner,
  areOrdinalSetsEqual,
  classifyBriefingGeneration,
  computeSortedUniqueUnion,
  deriveVerifyLimits,
  runPartnerBriefingPipeline,
} from './pipeline';

function createEvent(
  ordinal: number,
  dayOrdinal: number,
  overrides: Partial<BriefingModelSafeEvent> = {},
): BriefingModelSafeEvent {
  return {
    ordinal,
    dayOrdinal,
    period: 'morning',
    text: `기록 ${ordinal}번 본문`,
    mediaKinds: [],
    ...overrides,
  };
}

describe('Partner Briefing Pipeline and Concurrency (Gate A7)', () => {
  describe('Provider Synchronous Throw and Trust-Boundary Isolation', () => {
    it('isolates synchronous throw from getAvailability and falls back deterministically', async () => {
      const provider = new FakeBriefingProvider();
      provider.getAvailability = () => {
        throw new Error('Sync throw in getAvailability');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('deterministic');
    });

    it('isolates synchronous throw from getCapability and falls back deterministically', async () => {
      const provider = new FakeBriefingProvider();
      provider.getCapability = () => {
        throw new Error('Sync throw in getCapability');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('deterministic');
    });

    it('isolates synchronous throw from summarize and falls back deterministically', async () => {
      const provider = new FakeBriefingProvider();
      provider.summarize = () => {
        throw new Error('Sync throw in summarize');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('deterministic');
    });

    it('isolates synchronous throw from cancel and falls back deterministically without unhandled rejection', async () => {
      const provider = new FakeBriefingProvider({ delayMs: 500 });
      provider.cancel = () => {
        throw new Error('Sync throw in cancel');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 50,
      });

      expect(briefing.generation).toBe('deterministic');
    });
  });

  describe('Capability Runtime Shape Validation', () => {
    it('falls back deterministically on primitive, array, or malformed capability objects without TypeError', async () => {
      const validEnvelope = { maxContextUtf8Bytes: 4096, promptOverheadUtf8Bytes: 256, responseReserveUtf8Bytes: 512, maxInputTextGraphemes: 1000 };
      const malformedCapabilities: unknown[] = [
        { envelope: validEnvelope, extra: 'not-allowed' },
        null,
        undefined,
        'capability-string',
        123,
        true,
        [],
        ['array-cap'],
        {},
        { envelope: null },
        { envelope: 'invalid-string' },
        { envelope: [] },
        { envelope: { maxContextUtf8Bytes: -1 } },
      ];

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      for (const malformed of malformedCapabilities) {
        const provider = new FakeBriefingProvider();
        // @ts-expect-error simulating runtime violation
        provider.getCapability = () => malformed;

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(briefing.generation).toBe('deterministic');
      }
    });
  });

  describe('Ordinal Helper Fail-Closed Hardening', () => {
    it('areOrdinalSetsEqual returns false if inputs contain non-safe, negative, NaN, or duplicate ordinals', () => {
      expect(areOrdinalSetsEqual([0, 1, 2], [0, 1, 2])).toBe(true);
      expect(areOrdinalSetsEqual([0, 1, 2], [2, 0, 1])).toBe(true);

      // Duplicates in either input
      expect(areOrdinalSetsEqual([0, 1, 1], [0, 1])).toBe(false);
      expect(areOrdinalSetsEqual([0, 1], [0, 1, 1])).toBe(false);

      // Negative numbers, NaN, non-integers
      expect(areOrdinalSetsEqual([-1, 0], [-1, 0])).toBe(false);
      expect(areOrdinalSetsEqual([NaN, 0], [NaN, 0])).toBe(false);
      expect(areOrdinalSetsEqual([0.5, 1], [0.5, 1])).toBe(false);

      // Non-array inputs
      // @ts-expect-error testing invalid input
      expect(areOrdinalSetsEqual(null, [0])).toBe(false);
    });

    it('computeSortedUniqueUnion filters non-safe numbers cleanly and produces sorted unique union', () => {
      expect(computeSortedUniqueUnion([[3, 1], [2, 1], [0]])).toEqual([0, 1, 2, 3]);
      // @ts-expect-error testing invalid input
      expect(computeSortedUniqueUnion([[3, -1, NaN], [2, 0]])).toEqual([0, 2, 3]);
    });
  });

  describe('Leaf Ordinal Binding and Accurate Provenance', () => {
    it('binds exact global source ordinals for multiple sequential leaf chunks without double-indexing', async () => {
      const tightEnvelope = {
        maxContextUtf8Bytes: 300,
        promptOverheadUtf8Bytes: 40,
        responseReserveUtf8Bytes: 100,
        maxInputTextGraphemes: 15,
      };

      const provider = new FakeBriefingProvider({
        capability: { envelope: tightEnvelope },
        defaultGenerator: (req) => [
          {
            text: `청크 요약: ${req.chunk.sourceOrdinals.join(',')}`,
            sourceOrdinals: [...req.chunk.sourceOrdinals],
          },
        ],
      });

      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, { period: 'morning', text: '첫 번째 긴 기록' }),
        createEvent(1, 0, { period: 'afternoon', text: '두 번째 긴 기록' }),
        createEvent(2, 0, { period: 'evening', text: '세 번째 긴 기록' }),
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
        { ordinal: 2, recordId: 'rec-2' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 2000,
      });

      expect(briefing.days[0].sections).toHaveLength(3);
      expect(briefing.days[0].sections[0].sourceRecordIds).toEqual(['rec-0']);
      expect(briefing.days[0].sections[1].sourceRecordIds).toEqual(['rec-1']);
      expect(briefing.days[0].sections[2].sourceRecordIds).toEqual(['rec-2']);
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1', 'rec-2']);
    });
  });

  describe('Long Single Record Fallback Deduplication', () => {
    it('deduplicates a single long record segmented across multiple chunks into 1 record count on fallback', async () => {
      const segmentEnvelope = {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 512,
        maxInputTextGraphemes: 5,
      };

      const provider = new FakeBriefingProvider({
        availability: 'ready',
        capability: { envelope: segmentEnvelope },
        scenarioSelector: () => ({
          type: 'failure',
          code: 'native_error',
        }),
      });

      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, { period: 'morning', text: '매우긴단일기록텍스트입니다' }),
      ];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-long-0' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(provider.getCallHistory().length).toBeGreaterThan(1);
      expect(briefing.generation).toBe('deterministic');
      expect(briefing.days[0].sections).toHaveLength(1);
      expect(briefing.days[0].sections[0].text).toBe('기록 1개');
      expect(briefing.days[0].sections[0].sourceRecordIds).toEqual(['rec-long-0']);
      expect(briefing.overview.text).toBe('기록 1개');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-long-0']);
    });
  });

  describe('Displayed Output Generation Classification', () => {
    it('classifies as deterministic when all leaf model outputs are replaced by period fallback', async () => {
      let callCount = 0;
      const tightEnvelope = {
        maxContextUtf8Bytes: 300,
        promptOverheadUtf8Bytes: 40,
        responseReserveUtf8Bytes: 100,
        maxInputTextGraphemes: 15,
      };

      const provider = new FakeBriefingProvider({
        capability: { envelope: tightEnvelope },
        scenarioSelector: (req) => {
          callCount += 1;
          if (callCount <= 2) {
            return {
              type: 'success',
              sections: [{ text: '리프 모델 요약', sourceOrdinals: [...req.chunk.sourceOrdinals] }],
            };
          }
          return {
            type: 'failure',
            code: 'native_error',
          };
        },
      });

      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, { period: 'morning', text: '오전 긴 훈련 기록 0' }),
        createEvent(1, 0, { period: 'morning', text: '오전 긴 훈련 기록 1' }),
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('deterministic');
      expect(briefing.days[0].sections[0].text).toBe('기록 2개');
      expect(briefing.overview.text).toBe('기록 2개');
    });

    it('classifies as hybrid when model day section is displayed and overview is deterministic fallback', async () => {
      let callCount = 0;
      const provider = new FakeBriefingProvider({
        scenarioSelector: (req) => {
          callCount += 1;
          if (callCount === 1) {
            return {
              type: 'success',
              sections: [{ text: '오전 모델 요약 완료', sourceOrdinals: [...req.chunk.sourceOrdinals] }],
            };
          }
          return {
            type: 'failure',
            code: 'native_error',
          };
        },
      });

      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, { period: 'morning' }),
        createEvent(1, 0, { period: 'evening' }),
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('hybrid');
      expect(briefing.days[0].sections[0].text).toBe('오전 모델 요약 완료');
      expect(briefing.overview.text).toContain('총 2개의 기록');
    });
  });

  describe('Zero Abort Listener Leaks', () => {
    it('removes abort listener upon normal operation completion and does not trigger cancel later', async () => {
      let cancelCalledAfterCompletion = false;
      const provider = new FakeBriefingProvider();
      provider.cancel = async () => {
        cancelCalledAfterCompletion = true;
      };

      const controller = new AbortController();
      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        signal: controller.signal,
      });

      expect(briefing.generation).toBe('on_device');

      controller.abort();
      expect(cancelCalledAfterCompletion).toBe(false);
    });
  });

  describe('0, 1, 30, 100 Events and Multi-Day Scaling', () => {
    it('handles 0 events (empty corpus) deterministically without calling provider and with empty text', async () => {
      const provider = new FakeBriefingProvider();
      const briefing = await runPartnerBriefingPipeline({
        events: [],
        sources: [],
        days: [],
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.version).toBe(1);
      expect(briefing.sourceCount).toBe(0);
      expect(briefing.generation).toBe('deterministic');
      expect(briefing.rangeLabel).toBe('');
      expect(briefing.overview.text).toBe('');
      expect(briefing.overview.text).not.toContain('없');
      expect(briefing.overview.sourceRecordIds).toEqual([]);
      expect(briefing.days).toEqual([]);
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('handles 1 event with on_device verified output', async () => {
      const provider = new FakeBriefingProvider({
        defaultGenerator: (req) => [
          {
            text: '오전에 일어났습니다.',
            sourceOrdinals: [...req.chunk.sourceOrdinals],
          },
        ],
      });

      const events: BriefingModelSafeEvent[] = [createEvent(0, 0)];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-uuid-1' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.sourceCount).toBe(1);
      expect(briefing.generation).toBe('on_device');
      expect(briefing.rangeLabel).toBe('8월 26일');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-uuid-1']);
      expect(briefing.days).toHaveLength(1);
      expect(briefing.days[0].date).toBe('2026-08-26');
      expect(briefing.days[0].sections).toHaveLength(1);
      expect(briefing.days[0].sections[0].sourceRecordIds).toEqual(['rec-uuid-1']);
      expect(briefing.days[0].sections[0].text).toBe('오전에 일어났습니다.');
    });

    it('handles 30 events with proper leaf chunking, recursive period/overview reduction, and provenance', async () => {
      const provider = new FakeBriefingProvider({
        defaultGenerator: (req) => [
          {
            text: `청크 요약 (${req.chunk.sourceOrdinals.length}개)`,
            sourceOrdinals: [...req.chunk.sourceOrdinals],
          },
        ],
      });

      const events: BriefingModelSafeEvent[] = [];
      const sources: BriefingSourceMapping[] = [];
      for (let i = 0; i < 30; i += 1) {
        const period = i < 10 ? 'morning' : i < 20 ? 'afternoon' : 'evening';
        events.push(createEvent(i, 0, { period, text: `훈련 ${i}` }));
        sources.push({ ordinal: i, recordId: `rec-${i}` });
      }
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 2000,
      });

      expect(briefing.sourceCount).toBe(30);
      expect(briefing.generation).toBe('on_device');
      expect(briefing.overview.sourceRecordIds).toHaveLength(30);
      expect(briefing.overview.sourceRecordIds).toEqual(
        sources.map((s) => s.recordId),
      );
      expect(briefing.days[0].sections).toHaveLength(3);
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[1].period).toBe('afternoon');
      expect(briefing.days[0].sections[2].period).toBe('evening');
    });

    it('handles 100 events across 3 days with multi-pass reduction, multi-day rangeLabel, and exact ID union', async () => {
      const provider = new FakeBriefingProvider({
        defaultGenerator: (req) => [
          {
            text: '요약 완료',
            sourceOrdinals: [...req.chunk.sourceOrdinals],
          },
        ],
      });

      const events: BriefingModelSafeEvent[] = [];
      const sources: BriefingSourceMapping[] = [];
      for (let i = 0; i < 100; i += 1) {
        const dayOrdinal = i < 30 ? 0 : i < 70 ? 1 : 2;
        const period = i % 2 === 0 ? 'morning' : 'evening';
        events.push(createEvent(i, dayOrdinal, { period, text: `기록 ${i}` }));
        sources.push({ ordinal: i, recordId: `rec-${i}` });
      }

      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-25' },
        { dayOrdinal: 1, date: '2026-08-26' },
        { dayOrdinal: 2, date: '2026-08-27' },
      ];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 3000,
      });

      expect(briefing.sourceCount).toBe(100);
      expect(briefing.rangeLabel).toBe('8월 25일 ~ 8월 27일');
      expect(briefing.days).toHaveLength(3);
      expect(briefing.overview.sourceRecordIds).toHaveLength(100);
      expect(briefing.overview.sourceRecordIds).toEqual(
        sources.map((s) => s.recordId),
      );
    });
  });

  describe('Timeout, Cancellation, and Hangs', () => {
    it('direct runPartnerBriefingPipeline immediately returns deterministic fallback when signal is aborted', async () => {
      const controller = new AbortController();
      const provider = new FakeBriefingProvider();
      provider.summarize = () => new Promise(() => {});

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const pipelinePromise = runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 5000,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 20);

      const briefing = await pipelinePromise;
      expect(briefing.generation).toBe('deterministic');
    });

    it('handles availability hang by timing out and falling back cleanly', async () => {
      const provider = new FakeBriefingProvider();
      provider.getAvailability = () => new Promise(() => {});

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 50,
      });

      expect(briefing.generation).toBe('deterministic');
    });

    it('handles capability hang by timing out and falling back cleanly', async () => {
      const provider = new FakeBriefingProvider();
      provider.getCapability = () => new Promise(() => {});

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 50,
      });

      expect(briefing.generation).toBe('deterministic');
    });

    it('cancels provider and isolates provider.cancel rejections on timeout', async () => {
      let cancelCalled = false;
      const provider = new FakeBriefingProvider({ delayMs: 500 });
      provider.cancel = async () => {
        cancelCalled = true;
        throw new Error('Cancel failed');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 50,
      });

      expect(cancelCalled).toBe(true);
      expect(briefing.generation).toBe('deterministic');
    });

    it('runner immediately returns null on external abort even if provider ignores abort and hangs', async () => {
      const runner = new PartnerBriefingRunner();
      const provider = new FakeBriefingProvider();
      provider.summarize = () => new Promise(() => {});

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const controller = new AbortController();
      const runPromise = runner.run({
        events,
        sources,
        days,
        provider,
        timeoutMs: 5000,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 20);

      const result = await runPromise;
      expect(result).toBeNull();
    });

    it('runner cancels Run A when Run B starts and rejects late Run A completion', async () => {
      const runner = new PartnerBriefingRunner();
      const provider = new FakeBriefingProvider({
        delayMs: (req) => (req.chunk.events[0]?.text.includes('RunA') ? 200 : 10),
      });

      const eventsA = [createEvent(0, 0, { text: 'RunA 기록' })];
      const sourcesA = [{ ordinal: 0, recordId: 'rec-A' }];
      const daysA = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const eventsB = [createEvent(0, 0, { text: 'RunB 기록' })];
      const sourcesB = [{ ordinal: 0, recordId: 'rec-B' }];
      const daysB = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const promiseA = runner.run({
        events: eventsA,
        sources: sourcesA,
        days: daysA,
        provider,
        timeoutMs: 1000,
      });

      const promiseB = runner.run({
        events: eventsB,
        sources: sourcesB,
        days: daysB,
        provider,
        timeoutMs: 1000,
      });

      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

      expect(resultA).toBeNull();
      expect(resultB).not.toBeNull();
      expect(resultB?.overview.sourceRecordIds).toEqual(['rec-B']);
    });
  });

  describe('Verifier Limits and Fail-Closed Safeguards', () => {
    it('validates timeoutMs strictly and throws on non-positive or non-safe integer', async () => {
      const provider = new FakeBriefingProvider();
      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      await expect(
        runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: -10,
        }),
      ).rejects.toThrow(/timeoutMs must be a positive safe integer/);

      await expect(
        runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: NaN,
        }),
      ).rejects.toThrow(/timeoutMs must be a positive safe integer/);
    });

    it('does not inflate response reserve and derives exact limits', () => {
      const chunk = {
        dayOrdinal: 0,
        period: 'morning' as const,
        sourceOrdinals: [0, 1],
        events: [createEvent(0, 0), createEvent(1, 0)],
      };
      const envelope = {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 128,
        maxInputTextGraphemes: 500,
      };

      const limits = deriveVerifyLimits(chunk, envelope);
      expect(limits).not.toBeNull();
      expect(limits?.maxSectionUtf8Bytes).toBe(128);
      expect(limits?.maxTotalUtf8Bytes).toBe(128);
      expect(limits?.maxSectionGraphemes).toBe(500);
      expect(limits?.maxSections).toBe(4);
    });

    it('returns null on invalid responseReserveUtf8Bytes in envelope', () => {
      const chunk = {
        dayOrdinal: 0,
        period: 'morning' as const,
        sourceOrdinals: [0],
        events: [createEvent(0, 0)],
      };
      const invalidEnvelope = {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 0,
        maxInputTextGraphemes: 500,
      };

      const limits = deriveVerifyLimits(chunk, invalidEnvelope);
      expect(limits).toBeNull();
    });

    it('proves zero real database IDs or date strings are ever sent to provider across all passes', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: '사격 훈련' }),
        createEvent(1, 0, { text: '체력 단련' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-secret-uuid-999' },
        { ordinal: 1, recordId: 'rec-secret-uuid-888' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      const history = provider.getCallHistory();
      expect(history.length).toBeGreaterThan(0);

      for (const call of history) {
        const payloadStr = JSON.stringify(call);
        expect(payloadStr).not.toContain('rec-secret-uuid');
        expect(payloadStr).not.toContain('2026-08-26');
        expect(payloadStr).not.toContain('userId');
        expect(payloadStr).not.toContain('coupleId');
      }
    });
  });

  describe('Hierarchical Multi-Level Reduction and Reduction Fallback Preservation', () => {
    it('preserves reduction deterministicFallbackSourceOrdinals when Segmenter is absent in reduction pass', async () => {
      let passCount = 0;
      const originalSegmenter = Intl.Segmenter;

      const provider = new FakeBriefingProvider({
        defaultGenerator: (req) => {
          passCount += 1;
          if (passCount > 2) {
            // @ts-expect-error simulating absence
            Intl.Segmenter = undefined;
          }
          return [
            {
              text: '성공',
              sourceOrdinals: [...req.chunk.sourceOrdinals],
            },
          ];
        },
      });

      try {
        const events: BriefingModelSafeEvent[] = [
          createEvent(0, 0, { period: 'morning' }),
          createEvent(1, 0, { period: 'evening' }),
        ];
        const sources: BriefingSourceMapping[] = [
          { ordinal: 0, recordId: 'rec-0' },
          { ordinal: 1, recordId: 'rec-1' },
        ];
        const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(briefing.generation).toBe('hybrid');
        expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1']);
      } finally {
        Intl.Segmenter = originalSegmenter;
      }
    });

    it('falls back that group to deterministic when reduction output is malformed, while sibling model sections remain', async () => {
      let callCount = 0;
      const provider = new FakeBriefingProvider({
        scenarioSelector: (req) => {
          callCount += 1;
          if (req.chunk.period === 'morning') {
            return {
              type: 'success',
              sections: [{ text: '오전 성공', sourceOrdinals: [...req.chunk.sourceOrdinals] }],
            };
          }
          if (req.chunk.period === 'evening') {
            return {
              type: 'malformed',
              rawOutput: { invalid: 'structure' },
            };
          }
          return {
            type: 'success',
            sections: [{ text: '상위 요약', sourceOrdinals: [...req.chunk.sourceOrdinals] }],
          };
        },
      });

      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, { period: 'morning' }),
        createEvent(1, 0, { period: 'evening' }),
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('hybrid');
      expect(briefing.days[0].sections[0].text).toBe('오전 성공');
      expect(briefing.days[0].sections[1].text).toBe('기록 1개');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1']);
    });
  });

  describe('Helper Functions and Classification', () => {
    it('classifies on_device, hybrid, and deterministic correctly', () => {
      expect(classifyBriefingGeneration([], false, true)).toBe('deterministic');

      const modelNode = {
        dayOrdinal: 0,
        period: 'morning' as const,
        text: '요약',
        actualSourceOrdinals: [0],
        hasOnDevice: true,
        hasDeterministic: false,
        firstSourceOrdinal: 0,
      };
      const fallbackNode = {
        dayOrdinal: 0,
        period: 'evening' as const,
        text: '폴백',
        actualSourceOrdinals: [1],
        hasOnDevice: false,
        hasDeterministic: true,
        firstSourceOrdinal: 1,
      };

      expect(classifyBriefingGeneration([modelNode], true, false)).toBe('on_device');
      expect(classifyBriefingGeneration([modelNode, fallbackNode], true, false)).toBe('hybrid');
      expect(classifyBriefingGeneration([fallbackNode], false, true)).toBe('deterministic');
    });
  });
});
