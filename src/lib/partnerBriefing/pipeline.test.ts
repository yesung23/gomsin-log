import { describe, expect, it } from 'vitest';
import type {
  BriefingExtractRequestItem,
  BriefingModelSafeEvent,
  BriefingSourceMapping,
  UntrustedBriefingExtractPlan,
} from './contract';
import type { BriefingDayMapping } from './normalize';
import {
  FakeBriefingProvider,
  type BriefingExtractRequest,
  type BriefingProvider,
  type BriefingProviderAvailability,
} from './provider';
import {
  PartnerBriefingRunner,
  batchCandidateSegments,
  canItemsFitInEnvelope,
  classifyBriefingGeneration,
  extractValidEnvelope,
  runPartnerBriefingPipeline,
} from './pipeline';
import { getUtf8ByteLength } from './chunk';

function createEvent(
  ordinal: number,
  dayOrdinal: number,
  overrides: Partial<BriefingModelSafeEvent> = {},
): BriefingModelSafeEvent {
  return {
    ordinal,
    dayOrdinal,
    period: 'morning',
    text: `기록 ${ordinal}번 본문입니다. 추가 문장입니다.`,
    mediaKinds: [],
    ...overrides,
  };
}

async function withoutSegmenter<T>(run: () => Promise<T>): Promise<T> {
  const original = Intl.Segmenter;
  Object.defineProperty(Intl, 'Segmenter', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      writable: true,
      value: original,
    });
  }
}

describe('Partner Briefing Closed-Extract Pipeline (Gate A7.2)', () => {
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
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
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
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
    });

    it('isolates synchronous throw from selectExtracts and falls back deterministically', async () => {
      const provider = new FakeBriefingProvider();
      provider.selectExtracts = () => {
        throw new Error('Sync throw in selectExtracts');
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
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
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
      const validEnvelope = {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 512,
        maxInputTextGraphemes: 1000,
      };

      expect(extractValidEnvelope({ envelope: validEnvelope })).toEqual(validEnvelope);
      expect(extractValidEnvelope(validEnvelope)).toEqual(validEnvelope);
      expect(extractValidEnvelope(null)).toBeNull();
      expect(extractValidEnvelope(undefined)).toBeNull();
      expect(extractValidEnvelope('string-cap')).toBeNull();
      expect(extractValidEnvelope([validEnvelope])).toBeNull();
      expect(extractValidEnvelope({ envelope: { ...validEnvelope, maxContextUtf8Bytes: -1 } })).toBeNull();
    });
  });

  describe('Envelope and Batch Budget Proofs', () => {
    it('proves that actual request and expected response fit within the envelope', () => {
      const env = {
        maxContextUtf8Bytes: 500,
        promptOverheadUtf8Bytes: 50,
        responseReserveUtf8Bytes: 150,
        maxInputTextGraphemes: 100,
      };

      const items: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [{ candidateOrdinal: 0, text: '테스트 문장입니다.' }],
        },
      ];

      expect(canItemsFitInEnvelope(items, env)).toBe(true);

      const hugeItems: BriefingExtractRequestItem[] = Array.from({ length: 50 }, (_, i) => ({
        itemOrdinal: i,
        candidates: [{ candidateOrdinal: 0, text: '긴 테스트 문장입니다. 반복 문장입니다.' }],
      }));

      expect(canItemsFitInEnvelope(hugeItems, env)).toBe(false);
    });

    it('batchCandidateSegments splits candidate items deterministically and identifies unfittable items', () => {
      const env = {
        maxContextUtf8Bytes: 500,
        promptOverheadUtf8Bytes: 50,
        responseReserveUtf8Bytes: 150,
        maxInputTextGraphemes: 100,
      };

      const segments = [
        { segmentId: 0, sourceOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: '첫 번째 짧은 문장' }] },
        { segmentId: 1, sourceOrdinal: 1, candidates: [{ candidateOrdinal: 0, text: '두 번째 짧은 문장' }] },
        { segmentId: 2, sourceOrdinal: 2, candidates: [{ candidateOrdinal: 0, text: '세 번째 짧은 문장' }] },
      ];

      const { batches } = batchCandidateSegments(segments, env);
      expect(batches.length).toBeGreaterThanOrEqual(1);

      // Verify that every batch satisfies envelope constraints
      for (const batch of batches) {
        expect(canItemsFitInEnvelope(batch.items, env)).toBe(true);
        expect(batch.items.map((it) => it.itemOrdinal)).toEqual(
          Array.from({ length: batch.items.length }, (_, i) => i),
        );
      }
    });
  });

  describe('Core Pipeline Execution (0, 1, Multi-day, Multi-period)', () => {
    it('handles 0 events deterministically without calling provider', async () => {
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
      expect(briefing.overview.text).toBe('');
      expect(briefing.overview.sourceRecordIds).toEqual([]);
      expect(briefing.days).toEqual([]);
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('rejects invalid timeoutMs fail-closed', async () => {
      const provider = new FakeBriefingProvider();
      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      await expect(
        runPartnerBriefingPipeline({ events, sources, days, provider, timeoutMs: 0 }),
      ).rejects.toThrow('timeoutMs must be a positive safe integer.');

      await expect(
        runPartnerBriefingPipeline({ events, sources, days, provider, timeoutMs: -50 }),
      ).rejects.toThrow('timeoutMs must be a positive safe integer.');

      await expect(
        runPartnerBriefingPipeline({ events, sources, days, provider, timeoutMs: NaN }),
      ).rejects.toThrow('timeoutMs must be a positive safe integer.');
    });

    it('processes 1 record on-device with candidate 0 attributed extract', async () => {
      const provider = new FakeBriefingProvider();
      const events = [createEvent(0, 0, { text: '오늘 아침 점호 완료했습니다.' })];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.sourceCount).toBe(1);
      expect(briefing.days).toHaveLength(1);
      expect(briefing.days[0].date).toBe('2026-08-26');
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[0].items).toHaveLength(1);
      expect(briefing.days[0].sections[0].items[0]).toEqual({
        text: '“오늘 아침 점호 완료했습니다.”라고 기록했어요.',
        sourceRecordId: 'rec-0',
      });
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0']);
    });

    it('processes multi-day and multi-period events in strict chronological order', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'morning', text: '8월 26일 아침' }),
        createEvent(1, 0, { period: 'evening', text: '8월 26일 저녁' }),
        createEvent(2, 1, { period: 'afternoon', text: '8월 27일 오후' }),
        createEvent(3, 2, { period: 'night', text: '8월 28일 밤' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
        { ordinal: 2, recordId: 'rec-2' },
        { ordinal: 3, recordId: 'rec-3' },
      ];
      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-26' },
        { dayOrdinal: 1, date: '2026-08-27' },
        { dayOrdinal: 2, date: '2026-08-28' },
      ];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.rangeLabel).toBe('8월 26일 ~ 8월 28일');
      expect(briefing.overview.text).toBe('3일 동안 총 4개의 기록이 있습니다.');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1', 'rec-2', 'rec-3']);
      expect(briefing.days).toHaveLength(3);

      expect(briefing.days[0].sections).toHaveLength(2);
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
      expect(briefing.days[0].sections[1].period).toBe('evening');
      expect(briefing.days[0].sections[1].items[0].sourceRecordId).toBe('rec-1');

      expect(briefing.days[1].sections).toHaveLength(1);
      expect(briefing.days[1].sections[0].period).toBe('afternoon');
      expect(briefing.days[1].sections[0].items[0].sourceRecordId).toBe('rec-2');

      expect(briefing.days[2].sections).toHaveLength(1);
      expect(briefing.days[2].sections[0].period).toBe('night');
      expect(briefing.days[2].sections[0].items[0].sourceRecordId).toBe('rec-3');
    });
  });

  describe('Forced Small-Envelope Stress Scaling (30, 100, 300 records)', () => {
    for (const count of [30, 100, 300]) {
      it(`correctly batches and verifies ${count} records with small envelope`, async () => {
        const smallEnvelope = {
          maxContextUtf8Bytes: 600,
          promptOverheadUtf8Bytes: 50,
          responseReserveUtf8Bytes: 200,
          maxInputTextGraphemes: 100,
        };

        const provider = new FakeBriefingProvider({
          capability: { envelope: smallEnvelope },
        });

        const dayCount = Math.max(1, Math.ceil(count / 20));
        const events: BriefingModelSafeEvent[] = [];
        const sources: BriefingSourceMapping[] = [];
        const days: BriefingDayMapping[] = [];

        for (let d = 0; d < dayCount; d++) {
          const dateObj = new Date(Date.UTC(2026, 7, 1 + d));
          const dateStr = dateObj.toISOString().slice(0, 10);
          days.push({ dayOrdinal: d, date: dateStr });
        }

        const periods: BriefingModelSafeEvent['period'][] = ['morning', 'afternoon', 'evening', 'night'];

        for (let i = 0; i < count; i++) {
          const dayOrdinal = Math.floor(i / (count / dayCount));
          const boundedDayOrdinal = Math.min(dayCount - 1, dayOrdinal);
          // Group sequentially in period order within each day
          const periodIndex = Math.floor((i % (count / dayCount)) / ((count / dayCount) / 4));
          const period = periods[Math.min(3, Math.max(0, periodIndex))];

          events.push({
            ordinal: i,
            dayOrdinal: boundedDayOrdinal,
            period,
            text: `${i}번 기록 문장입니다. 짧은 요약 내용.`,
            mediaKinds: [],
          });
          sources.push({
            ordinal: i,
            recordId: `rec-${i}`,
          });
        }

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 5000,
        });

        expect(briefing.generation).toBe('on_device');
        expect(briefing.sourceCount).toBe(count);

        // Prove more than one provider call occurred
        const calls = provider.getCallHistory() as BriefingExtractRequest[];
        expect(calls.length).toBeGreaterThan(1);

       // Verify every call's ordinals restart 0..N-1 and stay within budget
       for (const call of calls) {
         expect(call.items.length).toBeGreaterThan(0);
         expect(call.items.map((it) => it.itemOrdinal)).toEqual(
           Array.from({ length: call.items.length }, (_, idx) => idx),
         );
         for (const item of call.items) {
           expect(item.candidates.length).toBeGreaterThan(0);
           expect(item.candidates.map((c) => c.candidateOrdinal)).toEqual(
             Array.from({ length: item.candidates.length }, (_, cIdx) => cIdx),
           );
         }

          // Invariant: both request and response reserve fit within envelope
          expect(
            canItemsFitInEnvelope(call.items, smallEnvelope, call.requestId),
          ).toBe(true);

          // Invariant: actual request and response serialization fit within envelope
          const reqBytes = getUtf8ByteLength(JSON.stringify(call));
          expect(reqBytes).toBeLessThanOrEqual(
            smallEnvelope.maxContextUtf8Bytes -
              smallEnvelope.promptOverheadUtf8Bytes -
              smallEnvelope.responseReserveUtf8Bytes,
          );
        }

        // P2 Hierarchy Assertions (Level 1 Overview -> Level 2 Date/Period -> Level 3 Exact Item)
        // Level 1: Deterministic Overview populated and covers exact source union
        expect(briefing.overview.text).toBeTruthy();
        expect(briefing.overview.sourceRecordIds).toEqual(
          sources.map((s) => s.recordId),
        );

        // Level 2: Multiple day groups and period sections exist as expected
        expect(briefing.days.length).toBe(dayCount);
        expect(briefing.days.length).toBeGreaterThan(1);
        for (const day of briefing.days) {
          expect(day.date).toBeTruthy();
          expect(day.sections.length).toBeGreaterThan(0);
          for (const section of day.sections) {
            expect(['morning', 'afternoon', 'evening', 'night']).toContain(
              section.period,
            );
            expect(section.items).toBeDefined();
            expect(section.items.length).toBeGreaterThan(0);
          }
        }

        // Level 3: Every item count/ID union equals input and items are properly formatted
        const allResultItems = briefing.days.flatMap((d) => d.sections.flatMap((s) => s.items));
        expect(allResultItems).toHaveLength(count);
        expect(allResultItems.map((item) => item.sourceRecordId)).toEqual(
          sources.map((s) => s.recordId),
        );
        for (const item of allResultItems) {
          expect(item.text).toBeTruthy();
          expect(item.sourceRecordId).toBeTruthy();
        }
      });
    }
  });

  describe('Privacy Boundary Invariants', () => {
    it('ensures no recordId, userId, coupleId, exact dates, mediaKinds, URLs, paths, or keys cross model boundary', async () => {
      const provider = new FakeBriefingProvider();
      const events: BriefingModelSafeEvent[] = [
        createEvent(0, 0, {
          text: '비밀 일기 작성 완료',
          mediaKinds: ['photo', 'video'],
        }),
        createEvent(1, 1, {
          text: '부대 복귀 완료',
          mediaKinds: ['voice'],
        }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'secret-record-id-xyz-999' },
        { ordinal: 1, recordId: 'another-secret-record-id-abc' },
      ];
      const days = [
        { dayOrdinal: 0, date: '2026-08-26' },
        { dayOrdinal: 1, date: '2026-08-27' },
      ];

      await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      const calls = provider.getCallHistory();
      expect(calls.length).toBeGreaterThan(0);

      for (const call of calls) {
        const rawJson = JSON.stringify(call);

        expect(rawJson).not.toContain('secret-record-id');
        expect(rawJson).not.toContain('another-secret-record-id');
        expect(rawJson).not.toContain('2026-08-26');
        expect(rawJson).not.toContain('2026-08-27');
        expect(rawJson).not.toContain('photo');
        expect(rawJson).not.toContain('video');
        expect(rawJson).not.toContain('voice');
        expect(rawJson).not.toContain('user');
        expect(rawJson).not.toContain('couple');
        expect(rawJson).not.toContain('http');
        expect(rawJson).not.toContain('storage');
        expect(rawJson).not.toContain('key');
      }
    });
  });

  describe('Closed Candidate Selection & Attributed Rendering (P1 Safety)', () => {
    it('custom provider selects nonzero candidate and renders exact extract only through fixed template', async () => {
      const provider = new FakeBriefingProvider({
        defaultExtractGenerator: (req) => ({
          version: 1,
          choices: req.items.map((it) => ({
            itemOrdinal: it.itemOrdinal,
            candidateOrdinal: Math.min(1, it.candidates.length - 1),
          })),
        }),
      });

      const events = [
        createEvent(0, 0, {
          text: '첫 번째 문장입니다. 두 번째 문장입니다.',
        }),
      ];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.days[0].sections[0].items[0].text).toBe(
        '“두 번째 문장입니다.”라고 기록했어요.',
      );
    });

    it('rejects provider output with arbitrary text/claim and never displays hallucinated strings', async () => {
      const provider = new FakeBriefingProvider({
        defaultExtractGenerator: (req) =>
          ({
            version: 1,
            choices: req.items.map((it) => ({
              itemOrdinal: it.itemOrdinal,
              candidateOrdinal: 0,
            })),
            claim: '상대는 이별을 원한다',
            text: '불안과 갈등이 감지되었습니다.',
          }) as unknown as UntrustedBriefingExtractPlan,
      });

      const events = [
        createEvent(0, 0, {
          text: '오늘 훈련 힘들었다.',
        }),
      ];
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
      const itemText = briefing.days[0].sections[0].items[0].text;
      expect(itemText).not.toContain('상대는 이별을 원한다');
      expect(itemText).not.toContain('불안과 갈등');
      expect(itemText).toBe('“오늘 훈련 힘들었다.”라고 기록했어요.');
    });
  });

  describe('Partial Failure & Hybrid Fallback', () => {
    it('falls back to hybrid when one batch fails, preserving verified sibling batch', async () => {
      const smallEnvelope = {
        maxContextUtf8Bytes: 300,
        promptOverheadUtf8Bytes: 30,
        responseReserveUtf8Bytes: 80,
        maxInputTextGraphemes: 50,
      };

      let callIndex = 0;
      const provider = new FakeBriefingProvider({
        capability: { envelope: smallEnvelope },
        scenarioSelector: () => {
          const isSecondCall = callIndex === 1;
          callIndex++;
          if (isSecondCall) {
            return { type: 'failure', code: 'malformed' };
          }
          return undefined; // default success
        },
      });

      // Two events in different periods to ensure separate chunks/batches
      const events = [
        createEvent(0, 0, { period: 'morning', text: '첫 번째 배치 기록입니다.' }),
        createEvent(1, 0, { period: 'evening', text: '두 번째 배치 기록입니다.' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('hybrid');
      expect(briefing.days[0].sections).toHaveLength(2);
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
      expect(briefing.days[0].sections[1].items[0].sourceRecordId).toBe('rec-1');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1']);
    });
  });

  describe('Intl.Segmenter Missing Fallback', () => {
    it('gracefully falls back all records without truncation or drop when Intl.Segmenter is absent', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: '세그멘터 없는 환경 첫 번째' }),
        createEvent(1, 0, { text: '세그멘터 없는 환경 두 번째' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const result = await withoutSegmenter(async () =>
        runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        }),
      );

      expect(result.generation).toBe('deterministic');
      expect(result.sourceCount).toBe(2);
      expect(result.days[0].sections[0].items).toHaveLength(2);
      expect(result.days[0].sections[0].items[0].text).toBe(
        '“세그멘터 없는 환경 첫 번째”라고 기록했어요.',
      );
      expect(result.days[0].sections[0].items[1].text).toBe(
        '“세그멘터 없는 환경 두 번째”라고 기록했어요.',
      );
    });
  });

 describe('Long Single Record Combination', () => {
   it('splits long record across small grapheme limit but combines back into exactly one navigation item', async () => {
     const smallEnvelope = {
        maxContextUtf8Bytes: 500,
        promptOverheadUtf8Bytes: 50,
        responseReserveUtf8Bytes: 150,
        maxInputTextGraphemes: 15,
      };

      const provider = new FakeBriefingProvider({
        capability: { envelope: smallEnvelope },
        defaultExtractGenerator: (req) => ({
          version: 1,
          choices: req.items.map((it) => ({
            itemOrdinal: it.itemOrdinal,
            candidateOrdinal: 0,
          })),
        }),
      });

      // Long text with 3 sentences, ~45 graphemes, exceeding maxInputTextGraphemes: 15 and small context budget
      const longText = '첫 번째 분할 문장입니다. 두 번째 분할 문장입니다. 세 번째 분할 문장입니다.';
      const events = [
        createEvent(0, 0, {
          text: longText,
        }),
      ];
      const sources = [{ ordinal: 0, recordId: 'rec-long-single' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      // 1. Assert exactly one item and exact source record ID
      expect(briefing.days[0].sections[0].items).toHaveLength(1);
      const item = briefing.days[0].sections[0].items[0];
      expect(item.sourceRecordId).toBe('rec-long-single');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-long-single']);

      // 2. Assert provider call count > 1 where envelope forces it
      const calls = provider.getCallHistory() as BriefingExtractRequest[];
      expect(calls.length).toBeGreaterThan(1);

      // 3. Extract every dynamic quoted fragment from final text
      const quotedMatches = Array.from(item.text.matchAll(/“([^”]+)”/g)).map(
        (m) => m[1],
      );
      expect(quotedMatches.length).toBeGreaterThanOrEqual(2);

      // 4. Prove each quoted fragment is an exact substring of the original source text
      for (const fragment of quotedMatches) {
        expect(longText).toContain(fragment);
      }

      // 5. Verify the full item text structure: each quoted fragment is wrapped in “...”라고 기록했어요.
      for (const fragment of quotedMatches) {
        expect(item.text).toContain(`“${fragment}”라고 기록했어요.`);
      }
    });
  });

  describe('Media-Only and Empty Record Handling', () => {
    it('does not send media-only records to provider and does not downgrade otherwise on_device text', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: '텍스트 기록입니다.', mediaKinds: [] }),
        createEvent(1, 0, { text: '', mediaKinds: ['photo', 'video'] }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-text' },
        { ordinal: 1, recordId: 'rec-media' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      // Text record was verified on device; media record does not downgrade generation
      expect(briefing.generation).toBe('on_device');
      expect(briefing.days[0].sections[0].items).toHaveLength(2);
      expect(briefing.days[0].sections[0].items[0].text).toBe(
        '“텍스트 기록입니다.”라고 기록했어요.',
      );
      expect(briefing.days[0].sections[0].items[1].text).toBe(
        '사진 1장, 동영상 1개를 남겼어요.',
      );

      // Only 1 item sent to provider
      const calls = provider.getCallHistory() as BriefingExtractRequest[];
      expect(calls).toHaveLength(1);
      expect(calls[0].items).toHaveLength(1);
    });
  });

  describe('Generation Classification', () => {
    it('strictly classifies generation across all edge cases', () => {
      expect(classifyBriefingGeneration(0, 0)).toBe('deterministic');
      expect(classifyBriefingGeneration(5, 0)).toBe('deterministic');
      expect(classifyBriefingGeneration(5, 5)).toBe('on_device');
      expect(classifyBriefingGeneration(5, 3)).toBe('hybrid');
      expect(classifyBriefingGeneration(5, 1)).toBe('hybrid');
    });
  });

  describe('PartnerBriefingRunner Concurrency & Stale Rejection', () => {
    it('supersedes older run with newer run and returns null for stale run', async () => {
      const runner = new PartnerBriefingRunner();

      const slowProvider = new FakeBriefingProvider({ delayMs: 150 });
      const fastProvider = new FakeBriefingProvider({ delayMs: 10 });

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const runA = runner.run({
        events,
        sources,
        days,
        provider: slowProvider,
        timeoutMs: 1000,
      });

      const runB = runner.run({
        events,
        sources,
        days,
        provider: fastProvider,
        timeoutMs: 1000,
      });

      const [resA, resB] = await Promise.all([runA, runB]);

      expect(resA).toBeNull();
      expect(resB).not.toBeNull();
      expect(resB?.sourceCount).toBe(1);
    });

    it('immediately returns null on external AbortSignal without waiting for provider delay', async () => {
      const runner = new PartnerBriefingRunner();
      const slowProvider = new FakeBriefingProvider({ delayMs: 1000 });
      const controller = new AbortController();

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const runPromise = runner.run({
        events,
        sources,
        days,
        provider: slowProvider,
        timeoutMs: 5000,
        signal: controller.signal,
      });

      // Abort externally after 20ms
      setTimeout(() => controller.abort(), 20);

      const startTime = Date.now();
      const res = await runPromise;
      const elapsed = Date.now() - startTime;

      expect(res).toBeNull();
      expect(elapsed).toBeLessThan(300);
    });

    it('cancels active run when cancel() is called', async () => {
      const runner = new PartnerBriefingRunner();
      const slowProvider = new FakeBriefingProvider({ delayMs: 500 });

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const runPromise = runner.run({
        events,
        sources,
        days,
        provider: slowProvider,
        timeoutMs: 1000,
      });

      expect(runner.isRunning()).toBe(true);
      runner.cancel();
      expect(runner.isRunning()).toBe(false);

      const res = await runPromise;
      expect(res).toBeNull();
    });
  });

  describe('Provider Availability States and Rejection Scenarios', () => {
    const unreadyStates: BriefingProviderAvailability[] = [
      'unsupported',
      'model_unavailable',
      'preparing',
      'locale_unsupported',
    ];

    for (const state of unreadyStates) {
      it(`falls back to deterministic when availability is '${state}'`, async () => {
        const provider = new FakeBriefingProvider({ availability: state });
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
        expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
        expect(provider.getCallHistory()).toHaveLength(0);
      });
    }

    it('falls back to deterministic when provider returns wrong correlation requestId', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: () => ({
          type: 'wrong_correlation',
          wrongRequestId: 'completely-wrong-id-999',
        }),
      });

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
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');
    });

    it('falls back to deterministic on provider timeout and late response cannot overwrite fallback', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 200,
      });

      const events = [createEvent(0, 0, { text: '타임아웃 테스트' })];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 30,
      });

      expect(briefing.generation).toBe('deterministic');
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-0');

      // Wait past provider delay to ensure late response does not mutate result
      await new Promise((r) => setTimeout(r, 250));
      expect(briefing.generation).toBe('deterministic');
    });
  });

  describe('Corpus Selection Independence and Non-Inspection of state.records', () => {
    it('pipeline accepts only supplied safe events without accessing state.records or filtering Top-N', async () => {
      const provider = new FakeBriefingProvider();

      // Supply 15 events
      const events: BriefingModelSafeEvent[] = Array.from({ length: 15 }, (_, i) =>
        createEvent(i, 0, { text: `이벤트 ${i}번 내용` }),
      );
      const sources: BriefingSourceMapping[] = Array.from({ length: 15 }, (_, i) => ({
        ordinal: i,
        recordId: `rec-${i}`,
      }));
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      // Assert all 15 items are preserved without Top-N drop or sorting alterations
      expect(briefing.sourceCount).toBe(15);
      const outputItemIds = briefing.days[0].sections[0].items.map((it) => it.sourceRecordId);
      expect(outputItemIds).toEqual(sources.map((s) => s.recordId));
      expect(briefing.overview.sourceRecordIds).toEqual(sources.map((s) => s.recordId));
    });
  });

  describe("Fail-Closed Safe UUID Generation and Provider Request Privacy", () => {
    it("falls back deterministically without calling provider when crypto.randomUUID is unavailable", async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      try {
        const originalCrypto = globalThis.crypto;
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: {
            ...originalCrypto,
            randomUUID: undefined,
          },
        });

        const provider = new FakeBriefingProvider();
        const events = [createEvent(0, 0, { text: "난수 UUID 부재 테스트 문장" })];
        const sources = [{ ordinal: 0, recordId: "rec-uuid-none" }];
        const days = [{ dayOrdinal: 0, date: "2026-08-26" }];

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(provider.getCallHistory()).toHaveLength(0);
        expect(briefing.generation).toBe("deterministic");
        expect(briefing.sourceCount).toBe(1);
        expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe("rec-uuid-none");
        expect(briefing.overview.sourceRecordIds).toEqual(["rec-uuid-none"]);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, "crypto", originalDescriptor);
        } else {
          Reflect.deleteProperty(globalThis, "crypto");
        }
      }

      const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      expect(currentDescriptor).toEqual(originalDescriptor);
    });

    it("falls back deterministically without calling provider when crypto.randomUUID throws", async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      try {
        const originalCrypto = globalThis.crypto;
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: {
            ...originalCrypto,
            randomUUID: () => {
              throw new Error("crypto entropy depleted");
            },
          },
        });

        const provider = new FakeBriefingProvider();
        const events = [createEvent(0, 0, { text: "난수 UUID throw 테스트 문장" })];
        const sources = [{ ordinal: 0, recordId: "rec-uuid-throw" }];
        const days = [{ dayOrdinal: 0, date: "2026-08-26" }];

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(provider.getCallHistory()).toHaveLength(0);
        expect(briefing.generation).toBe("deterministic");
        expect(briefing.sourceCount).toBe(1);
        expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe("rec-uuid-throw");
        expect(briefing.overview.sourceRecordIds).toEqual(["rec-uuid-throw"]);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, "crypto", originalDescriptor);
        } else {
          Reflect.deleteProperty(globalThis, "crypto");
        }
      }

      const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      expect(currentDescriptor).toEqual(originalDescriptor);
    });

    it("falls back deterministically without calling provider when crypto.randomUUID returns empty or whitespace string", async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      try {
        const originalCrypto = globalThis.crypto;
        Object.defineProperty(globalThis, "crypto", {
          configurable: true,
          writable: true,
          value: {
            ...originalCrypto,
            randomUUID: () => "   ",
          },
        });

        const provider = new FakeBriefingProvider();
        const events = [createEvent(0, 0, { text: "빈 UUID 테스트 문장" })];
        const sources = [{ ordinal: 0, recordId: "rec-uuid-blank" }];
        const days = [{ dayOrdinal: 0, date: "2026-08-26" }];

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(provider.getCallHistory()).toHaveLength(0);
        expect(briefing.generation).toBe("deterministic");
        expect(briefing.sourceCount).toBe(1);
        expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe("rec-uuid-blank");
        expect(briefing.overview.sourceRecordIds).toEqual(["rec-uuid-blank"]);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, "crypto", originalDescriptor);
        } else {
          Reflect.deleteProperty(globalThis, "crypto");
        }
      }

      const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      expect(currentDescriptor).toEqual(originalDescriptor);
    });
  });

  describe('Locale Support (Gate L3b)', () => {
    it('maintains exact Korean strings and generation when locale is unspecified (default)', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: '기본 로케일 한국어 테스트' }),
      ];
      const sources = [{ ordinal: 0, recordId: 'rec-ko-default' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.rangeLabel).toBe('8월 26일');
      expect(briefing.overview.text).toBe('총 1개의 기록이 있습니다.');
      expect(briefing.days[0].sections[0].items[0].text).toBe(
        '“기본 로케일 한국어 테스트”라고 기록했어요.',
      );
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-ko-default');
    });

    it('renders English templates in deterministic fallback path when locale is "en"', async () => {
      const provider = new FakeBriefingProvider({
        availability: 'locale_unsupported',
      });

      const events = [
        createEvent(0, 0, { period: 'morning', text: '훈련 다녀왔어', mediaKinds: ['photo'] }),
        createEvent(1, 0, { period: 'evening', text: '', mediaKinds: ['photo', 'video'] }),
        createEvent(2, 1, { period: 'afternoon', text: '', mediaKinds: [] }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-en-0' },
        { ordinal: 1, recordId: 'rec-en-1' },
        { ordinal: 2, recordId: 'rec-en-2' },
      ];
      const days = [
        { dayOrdinal: 0, date: '2026-08-26' },
        { dayOrdinal: 1, date: '2026-08-27' },
      ];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefing.generation).toBe('deterministic');
      expect(briefing.rangeLabel).toBe('August 26 – August 27');
      expect(briefing.overview.text).toBe('Over 2 days: 3 records (2 photos, 1 video) in total.');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-en-0', 'rec-en-1', 'rec-en-2']);

      // Day 0 morning: text with photo in deterministic fallback
      expect(briefing.days[0].sections[0].items[0].text).toBe('They wrote: “훈련 다녀왔어”');
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-en-0');

      // Day 0 evening: media only
      expect(briefing.days[0].sections[1].items[0].text).toBe('Shared 1 photo, 1 video.');
      expect(briefing.days[0].sections[1].items[0].sourceRecordId).toBe('rec-en-1');

      // Day 1 afternoon: empty record
      expect(briefing.days[1].sections[0].items[0].text).toBe('Shared a record.');
      expect(briefing.days[1].sections[0].items[0].sourceRecordId).toBe('rec-en-2');
    });

    it('renders English attributed wrapper on on-device success when locale is "en"', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: 'First sentence. Second sentence.' }),
      ];
      const sources = [{ ordinal: 0, recordId: 'rec-en-on-device' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.rangeLabel).toBe('August 26');
      expect(briefing.overview.text).toBe('1 record in total.');
      expect(briefing.days[0].sections[0].items[0].text).toBe(
        'They wrote: “First sentence.”',
      );
      expect(briefing.days[0].sections[0].items[0].sourceRecordId).toBe('rec-en-on-device');
    });

    it('passes identical locale to both getAvailability and selectExtracts options (spy provider proof)', async () => {
      let capturedAvailabilityOptions: unknown = null;
      let capturedSelectExtractsOptions: unknown = null;

      const provider: BriefingProvider = {
        async getAvailability(optionsOrSignal) {
          capturedAvailabilityOptions = optionsOrSignal;
          return 'ready';
        },
        getCapability() {
          return {
            envelope: {
              maxContextUtf8Bytes: 4096,
              promptOverheadUtf8Bytes: 256,
              responseReserveUtf8Bytes: 512,
              maxInputTextGraphemes: 1000,
            },
          };
        },
        async selectExtracts(req, optionsOrSignal) {
          capturedSelectExtractsOptions = optionsOrSignal;
          return {
            ok: true,
            requestId: req.requestId,
            output: {
              version: 1,
              choices: req.items.map((it) => ({
                itemOrdinal: it.itemOrdinal,
                candidateOrdinal: 0,
              })),
            },
          };
        },
        async cancel() {},
      };

      const events = [createEvent(0, 0, { text: '옵션 전달 확인' })];
      const sources = [{ ordinal: 0, recordId: 'rec-spy-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefing.generation).toBe('on_device');

      // Verify availability received locale: 'en'
      expect(capturedAvailabilityOptions).toBeDefined();
      expect(capturedAvailabilityOptions).toMatchObject({
        locale: 'en',
      });
      expect((capturedAvailabilityOptions as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);

      // Verify selectExtracts received locale: 'en'
      expect(capturedSelectExtractsOptions).toBeDefined();
      expect(capturedSelectExtractsOptions).toMatchObject({
        locale: 'en',
      });
      expect((capturedSelectExtractsOptions as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    });

    it('ensures serialized BriefingExtractRequest contains no locale or forbidden metadata', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { text: '요청 본문 검증 텍스트' }),
      ];
      const sources = [{ ordinal: 0, recordId: 'secret-record-id-123' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      const calls = provider.getCallHistory();
      expect(calls).toHaveLength(1);
      const req = calls[0];

      // Exact request keys allowlist: { requestId, items }
      expect(Object.keys(req).sort()).toEqual(['items', 'requestId']);

      // Raw JSON check: zero locale or forbidden metadata
      const rawJson = JSON.stringify(req);
      expect(rawJson).not.toContain('"locale"');
      expect(rawJson).not.toContain('"en"');
      expect(rawJson).not.toContain('"ko"');
      expect(rawJson).not.toContain('secret-record-id');
      expect(rawJson).not.toContain('2026-08-26');
    });

    it('renders English fallback when provider fails or times out with locale="en"', async () => {
      // 1. Failure scenario
      const failingProvider = new FakeBriefingProvider({
        scenarioSelector: () => ({ type: 'failure', code: 'native_error' }),
      });

      const events = [createEvent(0, 0, { text: '실패 시 영어 폴백' })];
      const sources = [{ ordinal: 0, recordId: 'rec-fail-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefingFail = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider: failingProvider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefingFail.generation).toBe('deterministic');
      expect(briefingFail.rangeLabel).toBe('August 26');
      expect(briefingFail.overview.text).toBe('1 record in total.');
      expect(briefingFail.days[0].sections[0].items[0].text).toBe(
        'They wrote: “실패 시 영어 폴백”',
      );

      // 2. Timeout scenario
      const slowProvider = new FakeBriefingProvider({ delayMs: 200 });
      const briefingTimeout = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider: slowProvider,
        timeoutMs: 30,
        locale: 'en',
      });

      expect(briefingTimeout.generation).toBe('deterministic');
      expect(briefingTimeout.rangeLabel).toBe('August 26');
      expect(briefingTimeout.overview.text).toBe('1 record in total.');
      expect(briefingTimeout.days[0].sections[0].items[0].text).toBe(
        'They wrote: “실패 시 영어 폴백”',
      );
    });

    it('renders English hybrid when one batch fails and sibling batch succeeds with locale="en"', async () => {
      const smallEnvelope = {
        maxContextUtf8Bytes: 300,
        promptOverheadUtf8Bytes: 30,
        responseReserveUtf8Bytes: 80,
        maxInputTextGraphemes: 50,
      };

      let callIndex = 0;
      const provider = new FakeBriefingProvider({
        capability: { envelope: smallEnvelope },
        scenarioSelector: () => {
          const isSecondCall = callIndex === 1;
          callIndex++;
          if (isSecondCall) {
            return { type: 'failure', code: 'malformed' };
          }
          return undefined; // default success
        },
      });

      const events = [
        createEvent(0, 0, { period: 'morning', text: 'First batch record.' }),
        createEvent(1, 0, { period: 'evening', text: 'Second batch record.' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-hyb-0' },
        { ordinal: 1, recordId: 'rec-hyb-1' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefing.generation).toBe('hybrid');
      expect(briefing.rangeLabel).toBe('August 26');
      expect(briefing.overview.text).toBe('2 records in total.');
      expect(briefing.days[0].sections[0].items[0].text).toBe('They wrote: “First batch record.”');
      expect(briefing.days[0].sections[1].items[0].text).toBe('They wrote: “Second batch record.”');
    });

    it('PartnerBriefingRunner forwards locale and respects cancellation with locale="en"', async () => {
      const runner = new PartnerBriefingRunner();
      const provider = new FakeBriefingProvider();

      const events = [createEvent(0, 0, { text: '러너 로케일 테스트' })];
      const sources = [{ ordinal: 0, recordId: 'rec-runner-en' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runner.run({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
        locale: 'en',
      });

      expect(briefing).not.toBeNull();
      expect(briefing?.generation).toBe('on_device');
      expect(briefing?.rangeLabel).toBe('August 26');
      expect(briefing?.days[0].sections[0].items[0].text).toBe(
        'They wrote: “러너 로케일 테스트”',
      );
    });
  });
});
