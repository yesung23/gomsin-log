import { describe, expect, it } from 'vitest';
import type {
  BriefingMediaKind,
  BriefingModelSafeEvent,
  BriefingPeriod,
} from './contract';
import {
  chunkPartnerBriefingEvents,
  countGraphemes,
  getGraphemeClusters,
  getSerializedModelSafeEventsUtf8Bytes,
  getUtf8ByteLength,
  isValidModelSafeEvent,
  isValidProviderEnvelope,
  serializeModelSafeEvents,
  type BriefingChunkRejectionReason,
  type BriefingModelChunk,
  type BriefingProviderEnvelope,
} from './chunk';

function makeEvent(
  overrides: Partial<BriefingModelSafeEvent> = {},
): BriefingModelSafeEvent {
  return {
    ordinal: 0,
    dayOrdinal: 0,
    period: 'morning',
    text: '오전 훈련 완료',
    mediaKinds: [],
    ...overrides,
  };
}

function envelope(
  availablePayloadBytes: number,
  maxInputTextGraphemes = 10_000,
  promptOverheadUtf8Bytes = 17,
  responseReserveUtf8Bytes = 29,
): BriefingProviderEnvelope {
  return {
    maxContextUtf8Bytes:
      availablePayloadBytes +
      promptOverheadUtf8Bytes +
      responseReserveUtf8Bytes,
    promptOverheadUtf8Bytes,
    responseReserveUtf8Bytes,
    maxInputTextGraphemes,
    // Structural limits the natives enforce; generous here so the byte/grapheme
    // assertions below stay the thing under test.
    maxItems: 1_000,
    maxCandidatesPerItem: 1_000,
  };
}

function sourceCoverage(
  modelChunks: readonly BriefingModelChunk[],
  fallbackOrdinals: readonly number[],
): number[] {
  return [
    ...new Set([
      ...modelChunks.flatMap((chunk) => chunk.sourceOrdinals),
      ...fallbackOrdinals,
    ]),
  ].sort((a, b) => a - b);
}

function withoutSegmenter<T>(run: () => T): T {
  const original = Intl.Segmenter;
  Object.defineProperty(Intl, 'Segmenter', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    return run();
  } finally {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      writable: true,
      value: original,
    });
  }
}

describe('Partner Briefing chunker (Gate A4)', () => {
  describe('provider envelope', () => {
    it('requires the exact approved envelope and safe integer ranges', () => {
      expect(
        isValidProviderEnvelope({
          maxContextUtf8Bytes: 1,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        }),
      ).toBe(true);

      const invalid: unknown[] = [
        {},
        // Missing maxInputTextGraphemes, maxItems and maxCandidatesPerItem.
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
        },
        // Missing only the two structural limits.
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
        },
        {
          maxContextUtf8Bytes: 0,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: -1,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: -1,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 0,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100.5,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: Number.MAX_SAFE_INTEGER + 1,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 32,
          maxUtf8Bytes: 99,
        },
        // maxItems must be a positive safe integer.
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 0,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 1.5,
          maxCandidatesPerItem: 32,
        },
        // maxCandidatesPerItem likewise.
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: 0,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 0,
          responseReserveUtf8Bytes: 0,
          maxInputTextGraphemes: 1,
          maxItems: 64,
          maxCandidatesPerItem: -1,
        },
        null,
        [],
      ];

      for (const value of invalid) {
        expect(isValidProviderEnvelope(value)).toBe(false);
      }
    });

    it('rejects impossible envelopes where overhead plus reserve consumes context', () => {
      for (const value of [
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 40,
          responseReserveUtf8Bytes: 60,
          maxInputTextGraphemes: 10,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
        {
          maxContextUtf8Bytes: 100,
          promptOverheadUtf8Bytes: 70,
          responseReserveUtf8Bytes: 40,
          maxInputTextGraphemes: 10,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        },
      ]) {
        expect(chunkPartnerBriefingEvents([], value)).toEqual({
          ok: false,
          rejection: { reason: 'invalid_provider_envelope' },
        });
      }
    });

    it('pins rejection reasons to the A4 contract', () => {
      type Expected =
        | 'invalid_provider_envelope'
        | 'invalid_ordinals'
        | 'invalid_event';
      type Exact = [Expected] extends [BriefingChunkRejectionReason]
        ? [BriefingChunkRejectionReason] extends [Expected]
          ? true
          : false
        : false;
      const exact: Exact = true;
      expect(exact).toBe(true);
    });
  });

  describe('deterministic measurement and serialization', () => {
    it('uses TextEncoder UTF-8 bytes for Korean text', () => {
      expect(getUtf8ByteLength('곰신로그')).toBe(
        new TextEncoder().encode('곰신로그').length,
      );
      expect(getUtf8ByteLength('곰신로그')).toBe(12);
    });

    it('serializes only model-safe fields in deterministic order', () => {
      const event = makeEvent({
        ordinal: 3,
        dayOrdinal: 2,
        period: 'evening',
        text: '점호 완료',
        mediaKinds: ['photo'],
      });
      expect(serializeModelSafeEvents([event])).toBe(
        '[{"ordinal":3,"dayOrdinal":2,"period":"evening","text":"점호 완료","mediaKinds":["photo"]}]',
      );
      expect(getSerializedModelSafeEventsUtf8Bytes([event])).toBe(
        new TextEncoder().encode(serializeModelSafeEvents([event])).length,
      );
    });

    it('counts NFD and ZWJ sequences only through Intl.Segmenter', () => {
      expect(countGraphemes('cafe\u0301')).toBe(4);
      expect(countGraphemes('👨‍👩‍👧‍👦')).toBe(1);
      expect(getGraphemeClusters('cafe\u0301👨‍👩‍👧‍👦')).toEqual([
        'c',
        'a',
        'f',
        'e\u0301',
        '👨‍👩‍👧‍👦',
      ]);
    });

    it('returns unverifiable instead of code-point counting without Segmenter', () => {
      withoutSegmenter(() => {
        expect(countGraphemes('cafe\u0301')).toBeNull();
        expect(countGraphemes('👨‍👩‍👧‍👦')).toBeNull();
        expect(getGraphemeClusters('가')).toBeNull();
        expect(countGraphemes('')).toBe(0);
      });
    });
  });

  describe('validation', () => {
    it('accepts only the exact model-safe event allowlist', () => {
      expect(isValidModelSafeEvent(makeEvent())).toBe(true);
      expect(
        isValidModelSafeEvent({ ...makeEvent(), recordId: 'not-model-safe' }),
      ).toBe(false);
      expect(
        isValidModelSafeEvent({
          ...makeEvent(),
          period: 'dawn' as unknown as BriefingPeriod,
        }),
      ).toBe(false);
      expect(
        isValidModelSafeEvent({
          ...makeEvent(),
          mediaKinds: ['file' as unknown as BriefingMediaKind],
        }),
      ).toBe(false);
    });

    it('rejects missing, duplicate, decreasing, and non-safe ordinals', () => {
      const cases: BriefingModelSafeEvent[][] = [
        [makeEvent({ ordinal: 1 })],
        [makeEvent({ ordinal: 0 }), makeEvent({ ordinal: 0 })],
        [makeEvent({ ordinal: 0 }), makeEvent({ ordinal: 2 })],
        [
          makeEvent({ ordinal: 0, dayOrdinal: 1 }),
          makeEvent({ ordinal: 1, dayOrdinal: 0 }),
        ],
        [makeEvent({ ordinal: Number.MAX_SAFE_INTEGER + 1 })],
      ];

      for (const events of cases) {
        const result = chunkPartnerBriefingEvents(events, envelope(10_000));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(
            result.rejection.reason === 'invalid_ordinals' ||
              result.rejection.reason === 'invalid_event',
          ).toBe(true);
        }
      }
    });
  });

  describe('full provider-envelope fitting', () => {
    it('includes serialized metadata and array punctuation, not only event.text', () => {
      const first = makeEvent({ ordinal: 0, text: 'a' });
      const second = makeEvent({ ordinal: 1, text: 'b' });
      const singleBytes = Math.max(
        getSerializedModelSafeEventsUtf8Bytes([first]),
        getSerializedModelSafeEventsUtf8Bytes([second]),
      );
      const pairBytes = getSerializedModelSafeEventsUtf8Bytes([
        first,
        second,
      ]);
      expect(pairBytes).toBeGreaterThan(singleBytes);

      const result = chunkPartnerBriefingEvents(
        [first, second],
        envelope(singleBytes),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.modelChunks.map((chunk) => chunk.sourceOrdinals)).toEqual([
          [0],
          [1],
        ]);
        expect(result.deterministicFallbackSourceOrdinals).toEqual([]);
      }
    });

    it('subtracts prompt overhead and response reserve from max context', () => {
      const event = makeEvent({ text: 'ab' });
      const fullPayloadBytes =
        getSerializedModelSafeEventsUtf8Bytes([event]);
      const maxContextUtf8Bytes = fullPayloadBytes + 10;

      const fits = chunkPartnerBriefingEvents([event], {
        maxContextUtf8Bytes,
        promptOverheadUtf8Bytes: 10,
        responseReserveUtf8Bytes: 0,
        maxInputTextGraphemes: 10,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      });
      const reserved = chunkPartnerBriefingEvents([event], {
        maxContextUtf8Bytes,
        promptOverheadUtf8Bytes: 10,
        responseReserveUtf8Bytes: 1,
        maxInputTextGraphemes: 10,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      });

      expect(fits.ok).toBe(true);
      expect(reserved.ok).toBe(true);
      if (fits.ok && reserved.ok) {
        expect(fits.modelChunks).toHaveLength(1);
        expect(fits.modelChunks[0].events[0].text).toBe('ab');
        expect(reserved.modelChunks).toHaveLength(2);
        expect(
          reserved.modelChunks.map((chunk) => chunk.events[0].text),
        ).toEqual(['a', 'b']);
      }
    });

    it('keeps every model chunk inside byte and grapheme limits', () => {
      const events = Array.from({ length: 30 }, (_, index) =>
        makeEvent({
          ordinal: index,
          dayOrdinal: Math.floor(index / 10),
          period: index % 2 === 0 ? 'morning' : 'afternoon',
          text: '한글 기록 ' + index,
        }),
      );
      const providerEnvelope = envelope(260, 20);
      const available =
        providerEnvelope.maxContextUtf8Bytes -
        providerEnvelope.promptOverheadUtf8Bytes -
        providerEnvelope.responseReserveUtf8Bytes;
      const result = chunkPartnerBriefingEvents(events, providerEnvelope);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const chunk of result.modelChunks) {
          expect(
            getSerializedModelSafeEventsUtf8Bytes(chunk.events),
          ).toBeLessThanOrEqual(available);
          const graphemes = chunk.events.reduce((sum, event) => {
            const count = countGraphemes(event.text);
            expect(count).not.toBeNull();
            return sum + (count ?? 0);
          }, 0);
          expect(graphemes).toBeLessThanOrEqual(
            providerEnvelope.maxInputTextGraphemes,
          );
        }
      }
    });
  });

  describe('coverage, order, and boundaries', () => {
    it.each([0, 1, 5, 6, 30, 100, 300])(
      'covers all %i input ordinals without selection or caps',
      (count) => {
        const periods: BriefingPeriod[] = [
          'morning',
          'afternoon',
          'evening',
          'night',
        ];
        const events = Array.from({ length: count }, (_, ordinal) =>
          makeEvent({
            ordinal,
            dayOrdinal: Math.floor(ordinal / 30),
            period: periods[Math.floor((ordinal % 30) / 8) % 4],
            text: '기록 ' + ordinal,
          }),
        );
        const result = chunkPartnerBriefingEvents(
          events,
          envelope(1_000_000, 1_000_000),
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(
            sourceCoverage(
              result.modelChunks,
              result.deterministicFallbackSourceOrdinals,
            ),
          ).toEqual(Array.from({ length: count }, (_, ordinal) => ordinal));
          expect(result.deterministicFallbackSourceOrdinals).toEqual([]);
        }
      },
    );

    it('preserves input order and never crosses day or period boundaries', () => {
      const events: BriefingModelSafeEvent[] = [
        makeEvent({ ordinal: 0, dayOrdinal: 0, period: 'morning' }),
        makeEvent({ ordinal: 1, dayOrdinal: 0, period: 'morning' }),
        makeEvent({ ordinal: 2, dayOrdinal: 0, period: 'afternoon' }),
        makeEvent({ ordinal: 3, dayOrdinal: 1, period: 'morning' }),
        makeEvent({ ordinal: 4, dayOrdinal: 1, period: 'evening' }),
        makeEvent({ ordinal: 5, dayOrdinal: 1, period: 'night' }),
      ];
      const result = chunkPartnerBriefingEvents(
        events,
        envelope(1_000_000, 1_000_000),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.modelChunks.map((chunk) => ({
            dayOrdinal: chunk.dayOrdinal,
            period: chunk.period,
            ordinals: chunk.sourceOrdinals,
          })),
        ).toEqual([
          { dayOrdinal: 0, period: 'morning', ordinals: [0, 1] },
          { dayOrdinal: 0, period: 'afternoon', ordinals: [2] },
          { dayOrdinal: 1, period: 'morning', ordinals: [3] },
          { dayOrdinal: 1, period: 'evening', ordinals: [4] },
          { dayOrdinal: 1, period: 'night', ordinals: [5] },
        ]);
      }
    });
  });

  describe('grapheme-safe splitting and fallback isolation', () => {
    it('splits oversized Korean, NFD, and ZWJ text only at grapheme boundaries', () => {
      const text = '가나다cafe\u0301👨‍👩‍👧‍👦라마';
      const event = makeEvent({ text });
      const clusters = getGraphemeClusters(text)!;
      const oneGraphemePayload = Math.max(
        ...clusters.map((cluster) =>
          getSerializedModelSafeEventsUtf8Bytes([
            makeEvent({ text: cluster }),
          ]),
        ),
      );
      const result = chunkPartnerBriefingEvents(
        [event],
        envelope(oneGraphemePayload, 1),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.modelChunks.map((chunk) => chunk.events[0].text),
        ).toEqual(clusters);
        expect(
          result.modelChunks.every(
            (chunk) => chunk.sourceOrdinals[0] === 0,
          ),
        ).toBe(true);
        expect(result.deterministicFallbackSourceOrdinals).toEqual([]);
      }
    });

    it('marks byte-safe non-empty NFD and ZWJ sources fallback when Segmenter is missing', () => {
      const events = [
        makeEvent({ ordinal: 0, text: 'cafe\u0301' }),
        makeEvent({ ordinal: 1, text: '👨‍👩‍👧‍👦' }),
      ];

      withoutSegmenter(() => {
        const result = chunkPartnerBriefingEvents(
          events,
          envelope(10_000, 10_000),
        );
        expect(result).toEqual({
          ok: true,
          modelChunks: [],
          deterministicFallbackSourceOrdinals: [0, 1],
        });
      });
    });

    it('does not emit partial model segments if a later grapheme is impossible', () => {
      const sendablePrefix = makeEvent({ text: 'a' });
      const impossibleText = 'a👨‍👩‍👧‍👦';
      const result = chunkPartnerBriefingEvents(
        [makeEvent({ text: impossibleText })],
        envelope(
          getSerializedModelSafeEventsUtf8Bytes([sendablePrefix]),
          10,
        ),
      );

      expect(result).toEqual({
        ok: true,
        modelChunks: [],
        deterministicFallbackSourceOrdinals: [0],
      });
      expect(JSON.stringify(result)).not.toContain(impossibleText);
    });

    it('keeps fallback content out of every serializable model payload candidate', () => {
      const modelEvent = makeEvent({ ordinal: 0, text: 'ok' });
      const fallbackText = '👨‍👩‍👧‍👦';
      const fallbackEvent = makeEvent({
        ordinal: 1,
        text: fallbackText,
      });
      const available =
        getSerializedModelSafeEventsUtf8Bytes([modelEvent]);
      const providerEnvelope = envelope(available, 10);
      const result = chunkPartnerBriefingEvents(
        [modelEvent, fallbackEvent],
        providerEnvelope,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deterministicFallbackSourceOrdinals).toEqual([1]);
        expect(result.modelChunks).toHaveLength(1);
        expect(
          result.modelChunks.flatMap((chunk) =>
            chunk.events.map((event) => event.ordinal),
          ),
        ).toEqual([0]);
        expect(JSON.stringify(result)).not.toContain(fallbackText);
        for (const chunk of result.modelChunks) {
          expect(
            getSerializedModelSafeEventsUtf8Bytes(chunk.events),
          ).toBeLessThanOrEqual(available);
        }
      }
    });
  });
});
