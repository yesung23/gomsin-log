import { describe, expect, it } from 'vitest';
import type {
  BriefingExtractRequestItem,
  BriefingModelSafeEvent,
  BriefingSourceMapping,
  UntrustedBriefingGroupPlan,
} from './contract';
import type { BriefingDayMapping } from './normalize';
import {
  DEFAULT_FAKE_PROVIDER_ENVELOPE,
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
  JS_GRAPHEME_SAFETY_MARGIN,
} from './pipeline';
import { getUtf8ByteLength } from './chunk';
import { buildBriefingExtractCandidates } from './fallback';

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

describe('Partner Briefing Closed-Extract Pipeline (Gate A7.2 - v2 Grouping Plan)', () => {
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
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
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
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
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
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
    });

    it('isolates synchronous throw from cancel and falls back deterministically without unhandled rejection', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 200,
      });
      provider.cancel = () => {
        throw new Error('Sync throw in cancel');
      };

      const events = [createEvent(0, 0)];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      // Timeout quickly (50ms) to trigger cancel()
      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 50,
      });

      expect(briefing.generation).toBe('deterministic');
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
    });
  });

  describe('Capability Runtime Shape Validation', () => {
    it('falls back deterministically on primitive, array, or malformed capability objects without TypeError', async () => {
      expect(extractValidEnvelope(null)).toBeNull();
      expect(extractValidEnvelope(undefined)).toBeNull();
      expect(extractValidEnvelope(123)).toBeNull();
      expect(extractValidEnvelope('string')).toBeNull();
      expect(extractValidEnvelope([])).toBeNull();
      expect(extractValidEnvelope({})).toBeNull();
      expect(extractValidEnvelope({ envelope: null })).toBeNull();
      expect(extractValidEnvelope({ envelope: {} })).toBeNull();
      expect(extractValidEnvelope({ randomKey: 4096 })).toBeNull();

      const validEnv = {
        maxContextUtf8Bytes: 4096,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 512,
        maxInputTextGraphemes: 1000,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };
      expect(extractValidEnvelope({ envelope: validEnv })).toEqual(validEnv);
      expect(extractValidEnvelope(validEnv)).toEqual(validEnv);
    });
  });

  describe('Envelope and Batch Budget Proofs', () => {
    it('proves request/response fit and rejects a reserve sized only for one group', () => {
      const envelope = {
        maxContextUtf8Bytes: 2000,
        promptOverheadUtf8Bytes: 200,
        responseReserveUtf8Bytes: 300,
        maxInputTextGraphemes: 500,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      const items: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [
            { candidateOrdinal: 0, text: '문장 1' },
            { candidateOrdinal: 1, text: '문장 1 대안' },
          ],
        },
      ];

      expect(canItemsFitInEnvelope(items, envelope)).toBe(true);

      // Oversized items that exceed available payload bytes
      const giantText = '가'.repeat(2000);
      const giantItems: BriefingExtractRequestItem[] = [
        {
          itemOrdinal: 0,
          candidates: [{ candidateOrdinal: 0, text: giantText }],
        },
      ];
      expect(canItemsFitInEnvelope(giantItems, envelope)).toBe(false);

      const tightlyBudgetedItems: BriefingExtractRequestItem[] = Array.from(
        { length: 4 },
        (_, itemOrdinal) => ({
          itemOrdinal,
          candidates: [{ candidateOrdinal: 0, text: `짧은 문장 ${itemOrdinal}` }],
        }),
      );
      const oneGroupResponse: UntrustedBriefingGroupPlan = {
        version: 2,
        groups: [
          {
            groupOrdinal: 0,
            choices: tightlyBudgetedItems.map(({ itemOrdinal }) => ({
              itemOrdinal,
              candidateOrdinal: 0,
            })),
          },
        ],
      };
      const worstCaseSingletonResponse: UntrustedBriefingGroupPlan = {
        version: 2,
        groups: tightlyBudgetedItems.map(({ itemOrdinal }) => ({
          groupOrdinal: itemOrdinal,
          choices: [{ itemOrdinal, candidateOrdinal: 0 }],
        })),
      };
      const placeholderRequest: BriefingExtractRequest = {
        requestId: '00000000-0000-0000-0000-000000000000',
        items: tightlyBudgetedItems,
      };
      const requestBytes = getUtf8ByteLength(JSON.stringify(placeholderRequest));
      const oneGroupResponseBytes = getUtf8ByteLength(JSON.stringify(oneGroupResponse));
      const singletonResponseBytes = getUtf8ByteLength(
        JSON.stringify(worstCaseSingletonResponse),
      );
      const oneGroupOnlyEnvelope = {
        maxContextUtf8Bytes: 64 + oneGroupResponseBytes + requestBytes,
        promptOverheadUtf8Bytes: 64,
        responseReserveUtf8Bytes: oneGroupResponseBytes,
        maxInputTextGraphemes: 500,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      expect(singletonResponseBytes).toBeGreaterThan(oneGroupResponseBytes);
      expect(requestBytes).toBe(
        oneGroupOnlyEnvelope.maxContextUtf8Bytes -
          oneGroupOnlyEnvelope.promptOverheadUtf8Bytes -
          oneGroupOnlyEnvelope.responseReserveUtf8Bytes,
      );
      expect(canItemsFitInEnvelope(tightlyBudgetedItems, oneGroupOnlyEnvelope)).toBe(false);
    });

    it('batchCandidateSegments splits candidate items deterministically and identifies unfittable items', () => {
      const tightEnvelope = {
        maxContextUtf8Bytes: 400,
        promptOverheadUtf8Bytes: 50,
        responseReserveUtf8Bytes: 100,
        maxInputTextGraphemes: 200,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      const segments = [
        {
          segmentId: 0,
          sourceOrdinal: 0,
          candidates: [{ candidateOrdinal: 0, text: '첫 번째 짧은 문장' }],
        },
        {
          segmentId: 1,
          sourceOrdinal: 1,
          candidates: [{ candidateOrdinal: 0, text: '두 번째 짧은 문장' }],
        },
        {
          segmentId: 2,
          sourceOrdinal: 2,
          candidates: [{ candidateOrdinal: 0, text: '가'.repeat(300) }],
        },
      ];

      const { batches, unfittableSegmentIds } = batchCandidateSegments(
        segments,
        tightEnvelope,
      );

      expect(batches.length).toBeGreaterThanOrEqual(1);
      expect(unfittableSegmentIds.has(2)).toBe(true);
    });

    /*
      The aggregate grapheme budget.

      `maxInputTextGraphemes` is a WHOLE-REQUEST limit on both native sides: each parser
      keeps one running total across every candidate of every item and rejects the entire
      request the moment it is passed (`OnDeviceBriefingPlugin.swift` totalGraphemes +=
      text.count; `OnDeviceBriefingPlugin.kt` the same via engine.countGraphemes). The JS
      batcher only proved bytes, so it could assemble a batch that was byte-legal and
      grapheme-illegal -- native hard-rejected it and the batch silently became
      deterministic output. ASCII fixtures are used deliberately: one byte per grapheme
      makes it impossible for the byte proof to be doing this work by accident.
    */
    /*
      구조 한도는 native가 강제하고, JS는 그것을 몰랐다.

      두 native parser는 언제나 `maxItems`/`maxCandidatesPerItem`을 강제하고 넘으면 요청
      전체를 bad_request로 거부해 왔다. 그런데 광고되지 않아 JS 배처가 볼 수 없었다.
      문장 33개로 쪼개지는 기록 하나가 JS에서는 통과하고 기기에서는 거부돼, 충분히
      가능한 기기에서 조용히 deterministic으로 떨어졌다.
    */
    describe('native structural capacity is part of the envelope', () => {
      const envelope = {
        maxContextUtf8Bytes: 200_000,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 40_000,
        maxInputTextGraphemes: 1_000_000,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      const candidates = (count: number) =>
        Array.from({ length: count }, (_, i) => ({ candidateOrdinal: i, text: `후보 ${i}` }));
      const items = (count: number, per = 1): BriefingExtractRequestItem[] =>
        Array.from({ length: count }, (_, i) => ({ itemOrdinal: i, candidates: candidates(per) }));

      it('accepts exactly maxCandidatesPerItem and rejects one more', () => {
        expect(canItemsFitInEnvelope(items(1, 32), envelope)).toBe(true);
        expect(canItemsFitInEnvelope(items(1, 33), envelope)).toBe(false);
      });

      it('accepts exactly maxItems and rejects one more', () => {
        expect(canItemsFitInEnvelope(items(64), envelope)).toBe(true);
        expect(canItemsFitInEnvelope(items(65), envelope)).toBe(false);
      });

      it('rejects an empty request and empty candidates', () => {
        expect(canItemsFitInEnvelope([], envelope)).toBe(false);
        expect(
          canItemsFitInEnvelope([{ itemOrdinal: 0, candidates: [] }], envelope),
        ).toBe(false);
        expect(
          canItemsFitInEnvelope(
            [{ itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: '   ' }] }],
            envelope,
          ),
        ).toBe(false);
      });

      it('requires dense sequential itemOrdinal and candidateOrdinal', () => {
        // Native requires `itemOrdinal == parsed.count`, so anything else is refused there.
        expect(
          canItemsFitInEnvelope(
            [
              { itemOrdinal: 1, candidates: candidates(1) },
              { itemOrdinal: 0, candidates: candidates(1) },
            ],
            envelope,
          ),
        ).toBe(false);
        expect(
          canItemsFitInEnvelope([{ itemOrdinal: 5, candidates: candidates(1) }], envelope),
        ).toBe(false);
        expect(
          canItemsFitInEnvelope(
            [
              {
                itemOrdinal: 0,
                candidates: [
                  { candidateOrdinal: 0, text: 'a' },
                  { candidateOrdinal: 2, text: 'b' },
                ],
              },
            ],
            envelope,
          ),
        ).toBe(false);
      });

      it('follows the runtime capability, not a JS constant', () => {
        // A provider advertising a smaller limit must constrain the batcher by that value.
        const tight = { ...envelope, maxCandidatesPerItem: 4, maxItems: 2 };
        expect(canItemsFitInEnvelope(items(1, 4), tight)).toBe(true);
        expect(canItemsFitInEnvelope(items(1, 5), tight)).toBe(false);
        expect(canItemsFitInEnvelope(items(2), tight)).toBe(true);
        expect(canItemsFitInEnvelope(items(3), tight)).toBe(false);
      });

      it('sends an over-capacity record to deterministic output without trimming it', () => {
        const over = [{ itemOrdinal: 0, candidates: candidates(33) }];
        const ok = [{ itemOrdinal: 0, candidates: candidates(2) }];

        const { batches, unfittableSegmentIds } = batchCandidateSegments(
          [
            { segmentId: 0, sourceOrdinal: 0, candidates: ok[0].candidates },
            { segmentId: 1, sourceOrdinal: 1, candidates: over[0].candidates },
          ],
          envelope,
        );

        expect(unfittableSegmentIds.has(1)).toBe(true);
        const batched = batches.flatMap((b) => b.segments.map((seg) => seg.segmentId));
        expect(batched).toEqual([0]);

        // The 33 candidates are neither truncated to 32 nor partially sent.
        for (const batch of batches) {
          for (const item of batch.items) {
            expect(item.candidates).toHaveLength(2);
          }
        }
      });
    });

    describe('aggregate grapheme budget matches the native request-wide limit', () => {
      const SAFE_BUDGET = 30;
      const GRAPHEME_CAP = SAFE_BUDGET + JS_GRAPHEME_SAFETY_MARGIN;

      // Roomy in bytes, tight in graphemes: only the new check can constrain this.
      const graphemeBoundEnvelope = {
        maxContextUtf8Bytes: 100_000,
        promptOverheadUtf8Bytes: 256,
        responseReserveUtf8Bytes: 4_000,
        maxInputTextGraphemes: GRAPHEME_CAP,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      /** The native running total, recomputed here from the request the batcher built. */
      function batchGraphemes(items: readonly BriefingExtractRequestItem[]): number {
        let total = 0;
        for (const item of items) {
          for (const candidate of item.candidates) {
            total += [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(candidate.text)].length;
          }
        }
        return total;
      }

      // 6 records x 10 ASCII graphemes = 60, exactly double the cap.
      const asciiSegments = Array.from({ length: 6 }, (_, i) => ({
        segmentId: i,
        sourceOrdinal: i,
        candidates: [{ candidateOrdinal: 0, text: `record${i}---` }],
      }));

      it('rejects a byte-legal item set that exceeds the request-wide grapheme total', () => {
        const items: BriefingExtractRequestItem[] = asciiSegments.map((seg, idx) => ({
          itemOrdinal: idx,
          candidates: seg.candidates,
        }));

        // Bytes alone would pass comfortably; the grapheme total is 60 against a cap of 30.
        expect(getUtf8ByteLength(JSON.stringify({ requestId: 'x', items }))).toBeLessThan(
          graphemeBoundEnvelope.maxContextUtf8Bytes,
        );
        expect(batchGraphemes(items)).toBeGreaterThan(GRAPHEME_CAP);
        expect(canItemsFitInEnvelope(items, graphemeBoundEnvelope)).toBe(false);

        // The first three (30 graphemes) are exactly at the safe budget and must still pass.
        const three = items.slice(0, 3);
        expect(batchGraphemes(three)).toBe(SAFE_BUDGET);
        expect(canItemsFitInEnvelope(three, graphemeBoundEnvelope)).toBe(true);
      });

      it('sums every candidate of an item, not just the first', () => {
        const multiCandidate: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: 'aaaaaaaaaaaaaaa' },
              { candidateOrdinal: 1, text: 'bbbbbbbbbbbbbbbb' },
            ],
          },
        ];
        // 15 + 16 = 31 > 30 (SAFE_BUDGET). Counting only the longest, or only the first, would pass.
        expect(batchGraphemes(multiCandidate)).toBe(31);
        expect(canItemsFitInEnvelope(multiCandidate, graphemeBoundEnvelope)).toBe(false);
      });

      it('keeps every produced batch at or under the cap, losing no source', () => {
        const { batches, unfittableSegmentIds } = batchCandidateSegments(
          asciiSegments,
          graphemeBoundEnvelope,
        );

        expect(batches.length).toBeGreaterThan(1);
        for (const batch of batches) {
          expect(batchGraphemes(batch.items)).toBeLessThanOrEqual(GRAPHEME_CAP);
          // itemOrdinal stays request-local and dense, as the native parsers require.
          expect(batch.items.map((item) => item.itemOrdinal)).toEqual(
            batch.items.map((_, idx) => idx),
          );
        }

        // Source coverage: every input segment is either batched or explicitly unfittable,
        // exactly once. Nothing may quietly disappear because of the new constraint.
        const batched = batches.flatMap((b) => b.segments.map((seg) => seg.segmentId));
        const union = [...batched, ...unfittableSegmentIds].sort((a, b) => a - b);
        expect(union).toEqual(asciiSegments.map((seg) => seg.segmentId));
        expect(new Set(batched).size).toBe(batched.length);
        expect(unfittableSegmentIds.size).toBe(0);
      });

      it('routes a single over-cap record to deterministic fallback instead of trimming it', () => {
        const oversized = [
          { segmentId: 0, sourceOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: 'ok' }] },
          {
            segmentId: 1,
            sourceOrdinal: 1,
            candidates: [{ candidateOrdinal: 0, text: 'x'.repeat(GRAPHEME_CAP + 1) }],
          },
        ];

        const { batches, unfittableSegmentIds } = batchCandidateSegments(
          oversized,
          graphemeBoundEnvelope,
        );

        expect(unfittableSegmentIds.has(1)).toBe(true);
        const batched = batches.flatMap((b) => b.segments.map((seg) => seg.segmentId));
        expect(batched).toEqual([0]);
        // The exact source text is never shortened to make it fit.
        for (const batch of batches) {
          for (const item of batch.items) {
            for (const candidate of item.candidates) {
              expect(candidate.text).toBe('ok');
            }
          }
        }
      });

      it('fails closed, without truncating, when graphemes cannot be counted', async () => {
        await withoutSegmenter(async () => {
          const items: BriefingExtractRequestItem[] = [
            { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: 'record0---' }] },
          ];
          // No usable Intl.Segmenter means the count cannot be proven. Guessing it, or
          // trimming the text to a byte length, would put a non-exact source in front of
          // the model; the deterministic path is the correct answer instead.
          expect(canItemsFitInEnvelope(items, graphemeBoundEnvelope)).toBe(false);

          const { batches, unfittableSegmentIds } = batchCandidateSegments(
            asciiSegments,
            graphemeBoundEnvelope,
          );
          expect(batches).toEqual([]);
          expect([...unfittableSegmentIds].sort((a, b) => a - b)).toEqual(
            asciiSegments.map((seg) => seg.segmentId),
          );
        });
      });

      it('rejects a malformed candidate rather than counting it as zero', () => {
        const malformed = [
          { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: 123 }] },
        ] as unknown as BriefingExtractRequestItem[];
        expect(canItemsFitInEnvelope(malformed, graphemeBoundEnvelope)).toBe(false);

        const noCandidates = [{ itemOrdinal: 0 }] as unknown as BriefingExtractRequestItem[];
        expect(canItemsFitInEnvelope(noCandidates, graphemeBoundEnvelope)).toBe(false);
      });

      it('rejects candidate sets with ZWJ emoji in the safety margin before native hard limit', () => {
        // Complex ZWJ emoji sequence (e.g. Family: 👨‍👩‍👧‍👦 which is 7 codepoints but 1 grapheme cluster in JS)
        const familyEmoji = '👨‍👩‍👧‍👦';
        expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(familyEmoji)].length).toBe(1);

        // Safe items: exactly at SAFE_BUDGET
        const safeItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: `${familyEmoji.repeat(5)}${'a'.repeat(SAFE_BUDGET - 5)}` },
            ],
          },
        ];
        expect(batchGraphemes(safeItems)).toBe(SAFE_BUDGET);
        expect(canItemsFitInEnvelope(safeItems, graphemeBoundEnvelope)).toBe(true);

        // Margin items: SAFE_BUDGET + 1 (31 graphemes).
        // 31 <= GRAPHEME_CAP (46), but > SAFE_BUDGET (30).
        // JS rejects in the safety margin before native hard limit is hit.
        const marginItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: `${familyEmoji.repeat(5)}${'a'.repeat(SAFE_BUDGET - 5 + 1)}` },
            ],
          },
        ];
        expect(batchGraphemes(marginItems)).toBe(SAFE_BUDGET + 1);
        expect(batchGraphemes(marginItems)).toBeLessThanOrEqual(graphemeBoundEnvelope.maxInputTextGraphemes);
        expect(canItemsFitInEnvelope(marginItems, graphemeBoundEnvelope)).toBe(false);
      });

      it('rejects candidate sets with NFD decomposed Hangul in the safety margin before native hard limit', () => {
        // NFD Hangul: decomposed into Choseong + Jungseong + Jongseong jamo
        const nfdHangul = '가나다라마바사아자차'.normalize('NFD');
        const nfdGraphemeCount = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(nfdHangul)].length;
        expect(nfdGraphemeCount).toBe(10);

        // Safe items: exactly at SAFE_BUDGET
        const safeItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: `${nfdHangul}${'a'.repeat(SAFE_BUDGET - nfdGraphemeCount)}` },
            ],
          },
        ];
        expect(batchGraphemes(safeItems)).toBe(SAFE_BUDGET);
        expect(canItemsFitInEnvelope(safeItems, graphemeBoundEnvelope)).toBe(true);

        // Margin items: SAFE_BUDGET + 1 (31 graphemes).
        // Sits in safety margin window: > 30, but <= 46.
        // JS rejects early to prevent platform-specific ICU/Swift mismatch from causing native rejection.
        const marginItems: BriefingExtractRequestItem[] = [
          {
            itemOrdinal: 0,
            candidates: [
              { candidateOrdinal: 0, text: `${nfdHangul}${'a'.repeat(SAFE_BUDGET - nfdGraphemeCount + 1)}` },
            ],
          },
        ];
        expect(batchGraphemes(marginItems)).toBe(SAFE_BUDGET + 1);
        expect(batchGraphemes(marginItems)).toBeLessThanOrEqual(graphemeBoundEnvelope.maxInputTextGraphemes);
        expect(canItemsFitInEnvelope(marginItems, graphemeBoundEnvelope)).toBe(false);
      });

      it('retains all sources through deterministic fallback when items with ZWJ emoji or NFD Hangul exceed JS safe margin', () => {
        const emojiText = '👨‍👩‍👧‍👦'.repeat(SAFE_BUDGET + 2); // 32 graphemes > 30
        const segments = [
          {
            segmentId: 0,
            sourceOrdinal: 0,
            candidates: [{ candidateOrdinal: 0, text: '정상 기록입니다.' }],
          },
          {
            segmentId: 1,
            sourceOrdinal: 1,
            candidates: [{ candidateOrdinal: 0, text: emojiText }],
          },
        ];

        const { batches, unfittableSegmentIds } = batchCandidateSegments(
          segments,
          graphemeBoundEnvelope,
        );

        // Segment 1 exceeds safe margin, so it is routed to unfittableSegmentIds (deterministic fallback)
        expect(unfittableSegmentIds.has(1)).toBe(true);
        const batched = batches.flatMap((b) => b.segments.map((seg) => seg.segmentId));
        expect(batched).toEqual([0]);

        // Full union retains both sources: zero dropped sources
        const union = [...batched, ...unfittableSegmentIds].sort((a, b) => a - b);
        expect(union).toEqual([0, 1]);
      });
    });
  });

  describe('Core Pipeline Execution (0, 1, 2, 5, 8 Sources & Grouping)', () => {
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
      expect(briefing.rangeLabel).toBe('');
      expect(briefing.overview.text).toBe('');
      expect(briefing.overview.sourceRecordIds).toEqual([]);
      expect(briefing.days).toEqual([]);
      expect(provider.getCallHistory()).toHaveLength(0);
    });

    it('rejects invalid timeoutMs fail-closed', async () => {
      const provider = new FakeBriefingProvider();
      await expect(
        runPartnerBriefingPipeline({
          events: [createEvent(0, 0)],
          sources: [{ ordinal: 0, recordId: 'rec-0' }],
          days: [{ dayOrdinal: 0, date: '2026-08-26' }],
          provider,
          timeoutMs: 0,
        }),
      ).rejects.toThrow(/timeoutMs must be a positive safe integer/);

      await expect(
        runPartnerBriefingPipeline({
          events: [createEvent(0, 0)],
          sources: [{ ordinal: 0, recordId: 'rec-0' }],
          days: [{ dayOrdinal: 0, date: '2026-08-26' }],
          provider,
          timeoutMs: -500,
        }),
      ).rejects.toThrow(/timeoutMs must be a positive safe integer/);
    });

    it('processes 1 record on-device with single item (N=1 singleton group)', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, {
          text: '오늘 아침 점호 완료했습니다. 밥 먹으러 갑니다.',
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

      expect(briefing.version).toBe(1);
      expect(briefing.sourceCount).toBe(1);
      expect(briefing.generation).toBe('on_device');
      expect(briefing.rangeLabel).toBe('8월 26일');
      expect(briefing.overview.text).toBe('총 1개의 기록이 있습니다.');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0']);

      expect(briefing.days).toHaveLength(1);
      expect(briefing.days[0].date).toBe('2026-08-26');
      expect(briefing.days[0].sections).toHaveLength(1);
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[0].items).toHaveLength(1);
      expect(briefing.days[0].sections[0].items[0]).toEqual({
        parts: [
          {
            text: '“오늘 아침 점호 완료했습니다.”라고 기록했어요.',
            sourceRecordId: 'rec-0',
          },
        ],
      });

      expect(provider.getCallHistory()).toHaveLength(1);
    });

    it('processes 2 records on-device and compresses into 1 grouped item with 2 parts', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'morning', text: '오전 훈련 시작' }),
        createEvent(1, 0, { period: 'morning', text: '오전 훈련 복귀' }),
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

      expect(briefing.generation).toBe('on_device');
      expect(briefing.sourceCount).toBe(2);
      expect(briefing.days[0].sections[0].items).toHaveLength(1);
      expect(briefing.days[0].sections[0].items[0].parts).toHaveLength(2);
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
      expect(briefing.days[0].sections[0].items[0].parts[1].sourceRecordId).toBe('rec-1');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-0', 'rec-1']);
    });

    it('processes 5 records on-device and compresses into 2 grouped items (sizes 3 and 2)', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'morning', text: '기록 0' }),
        createEvent(1, 0, { period: 'morning', text: '기록 1' }),
        createEvent(2, 0, { period: 'morning', text: '기록 2' }),
        createEvent(3, 0, { period: 'morning', text: '기록 3' }),
        createEvent(4, 0, { period: 'morning', text: '기록 4' }),
      ];
      const sources = events.map((e) => ({ ordinal: e.ordinal, recordId: `rec-${e.ordinal}` }));
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.sourceCount).toBe(5);
      const items = briefing.days[0].sections[0].items;
      expect(items).toHaveLength(2);
      expect(items[0].parts).toHaveLength(3);
      expect(items[1].parts).toHaveLength(2);

      const allPartIds = items.flatMap((it) => it.parts.map((p) => p.sourceRecordId));
      expect(allPartIds).toEqual(sources.map((s) => s.recordId));
    });

    it('processes 8 records on-device across envelope-safe batches with real compression', async () => {
      const provider = new FakeBriefingProvider();
      const events = Array.from({ length: 8 }, (_, i) =>
        createEvent(i, 0, { period: 'morning', text: `기록 ${i}` }),
      );
      const sources = events.map((e) => ({ ordinal: e.ordinal, recordId: `rec-${e.ordinal}` }));
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.sourceCount).toBe(8);
      const items = briefing.days[0].sections[0].items;
      expect(provider.getCallHistory().length).toBeGreaterThan(1);
      expect(items.length).toBeLessThan(8);

      const allPartIds = items.flatMap((it) => it.parts.map((p) => p.sourceRecordId));
      expect(allPartIds).toHaveLength(8);
      expect(allPartIds).toEqual(sources.map((s) => s.recordId));
    });

    it('processes multi-day and multi-period events in strict chronological order with day/period request isolation', async () => {
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'morning', text: '1일차 아침' }),
        createEvent(1, 0, { period: 'morning', text: '1일차 아침 두번째' }),
        createEvent(2, 0, { period: 'evening', text: '1일차 저녁' }),
        createEvent(3, 0, { period: 'evening', text: '1일차 저녁 두번째' }),
        createEvent(4, 1, { period: 'afternoon', text: '2일차 오후' }),
        createEvent(5, 1, { period: 'afternoon', text: '2일차 오후 두번째' }),
      ];
      const sources = events.map((e) => ({ ordinal: e.ordinal, recordId: `rec-${e.ordinal}` }));
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
      });

      expect(briefing.generation).toBe('on_device');
      expect(briefing.days).toHaveLength(2);
      expect(briefing.days[0].date).toBe('2026-08-26');
      expect(briefing.days[0].sections).toHaveLength(2);
      expect(briefing.days[1].date).toBe('2026-08-27');
      expect(briefing.days[1].sections).toHaveLength(1);

      // Verify request isolation: 3 batches (day0 morning, day0 evening, day1 afternoon)
      const callHistory = provider.getCallHistory();
      expect(callHistory).toHaveLength(3);
    });
  });

  describe('Forced Small-Envelope Stress Scaling (30, 100, 300 records)', () => {
    const stressCounts = [30, 100, 300];

    for (const count of stressCounts) {
      it(`correctly batches and verifies ${count} records with small envelope without Top-N loss`, async () => {
        const smallEnvelope = {
          maxContextUtf8Bytes: 1024,
          promptOverheadUtf8Bytes: 128,
          responseReserveUtf8Bytes: 256,
          maxInputTextGraphemes: 500,
          maxItems: 64,
          maxCandidatesPerItem: 32,
        };

        const provider = new FakeBriefingProvider({
          capability: { envelope: smallEnvelope },
        });

        const periods = ['morning', 'afternoon', 'evening', 'night'] as const;
        const dayCount = Math.max(1, Math.ceil(count / 10));
        const eventsPerDay = Math.ceil(count / dayCount);

        const events: BriefingModelSafeEvent[] = [];
        const sources: BriefingSourceMapping[] = [];
        const days: BriefingDayMapping[] = [];

        for (let d = 0; d < dayCount; d += 1) {
          const dayNum = String(d + 1).padStart(2, '0');
          days.push({
            dayOrdinal: d,
            date: `2026-08-${dayNum}`,
          });
        }

        for (let i = 0; i < count; i += 1) {
          const dayOrdinal = Math.floor(i / eventsPerDay);
          const withinDayIdx = i % eventsPerDay;
          const period = periods[Math.min(periods.length - 1, Math.floor((withinDayIdx / eventsPerDay) * periods.length))];
          const recId = `rec-${i}`;

          events.push({
            ordinal: i,
            dayOrdinal,
            period,
            text: `스트레스 기록 ${i}번 내용입니다.`,
            mediaKinds: [],
          });
          sources.push({
            ordinal: i,
            recordId: recId,
          });
        }

        const briefing = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 5000,
        });

        expect(provider.getCallHistory().length).toBeGreaterThan(1);
        expect(briefing.generation).toBe('on_device');
        expect(briefing.sourceCount).toBe(count);
        expect(briefing.overview.sourceRecordIds).toHaveLength(count);
        expect(briefing.overview.sourceRecordIds).toEqual(sources.map((s) => s.recordId));

        const allResultItems = briefing.days
          .flatMap((d) => d.sections)
          .flatMap((s) => s.items);
        const allResultParts = allResultItems.flatMap((it) => it.parts);

        expect(allResultItems.length).toBeLessThan(count);
        expect(allResultParts).toHaveLength(count);
        expect(allResultParts.map((p) => p.sourceRecordId)).toEqual(sources.map((s) => s.recordId));
      });
    }
  });

  describe('Privacy Boundary Invariants', () => {
    it('ensures no recordId, userId, coupleId, exact dates, mediaKinds, URLs, paths, or keys cross model boundary', async () => {
      const provider = new FakeBriefingProvider();

      const events = [
        createEvent(0, 0, { text: '개인정보 보호 테스트' }),
        createEvent(1, 0, { text: '두 번째 개인정보 보호 테스트' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'sensitive-rec-001' },
        { ordinal: 1, recordId: 'sensitive-rec-002' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

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
        const json = JSON.stringify(call);
        expect(json).not.toContain('sensitive-rec-001');
        expect(json).not.toContain('sensitive-rec-002');
        expect(json).not.toContain('2026-08-26');
        expect(json).not.toContain('mediaKinds');
        expect(json).not.toContain('coupleId');
        expect(json).not.toContain('userId');
        expect(json).not.toContain('http');
      }
    });
  });

  describe('Closed Candidate Selection & Attributed Rendering (P1 Safety)', () => {
    it('custom provider selects nonzero candidate and renders exact extract only through fixed template', async () => {
      const provider = new FakeBriefingProvider({
        defaultExtractGenerator: (req) => ({
          version: 2,
          groups: [
            {
              groupOrdinal: 0,
              choices: req.items.map((it) => ({
                itemOrdinal: it.itemOrdinal,
                candidateOrdinal: Math.min(1, it.candidates.length - 1),
              })),
            },
          ],
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
      expect(briefing.days[0].sections[0].items[0].parts[0].text).toBe(
        '“두 번째 문장입니다.”라고 기록했어요.',
      );
    });

    it('rejects provider output with arbitrary text/claim and never displays hallucinated strings', async () => {
      const provider = new FakeBriefingProvider({
        defaultExtractGenerator: (req) =>
          ({
            version: 2,
            groups: [
              {
                groupOrdinal: 0,
                choices: req.items.map((it) => ({
                  itemOrdinal: it.itemOrdinal,
                  candidateOrdinal: 0,
                })),
                hallucinatedSummary: '상대는 이별을 원한다. 불안과 갈등이 있다.',
              },
            ],
          } as unknown as UntrustedBriefingGroupPlan),
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
      const itemText = briefing.days[0].sections[0].items[0].parts[0].text;
      expect(itemText).not.toContain('상대는 이별을 원한다');
      expect(itemText).not.toContain('불안과 갈등');
      expect(itemText).toBe('“오늘 훈련 힘들었다.”라고 기록했어요.');
    });
  });

  describe('Partial Failure & Hybrid Fallback', () => {
    it('falls back to hybrid when one batch fails, preserving verified sibling batch', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: (_req, callIndex) => {
          if (callIndex === 0) {
            return {
              type: 'failure',
              code: 'native_error',
            };
          }
          return undefined; // default success for subsequent calls
        },
      });

      // Two periods: morning (batch 0, will fail) and evening (batch 1, will succeed)
      const events = [
        createEvent(0, 0, { period: 'morning', text: '오전 훈련 내용 1' }),
        createEvent(1, 0, { period: 'morning', text: '오전 훈련 내용 2' }),
        createEvent(2, 0, { period: 'evening', text: '저녁 점호 내용 1' }),
        createEvent(3, 0, { period: 'evening', text: '저녁 점호 내용 2' }),
      ];
      const sources = events.map((e) => ({ ordinal: e.ordinal, recordId: `rec-${e.ordinal}` }));
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

      // Morning section fell back to deterministic (2 individual items)
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[0].items).toHaveLength(2);

      // Evening section succeeded on_device (1 grouped item with 2 parts)
      expect(briefing.days[0].sections[1].period).toBe('evening');
      expect(briefing.days[0].sections[1].items).toHaveLength(1);
      expect(briefing.days[0].sections[1].items[0].parts).toHaveLength(2);
    });
  });

  describe('Intl.Segmenter Missing Fallback', () => {
    it('gracefully falls back all records without truncation or drop when Intl.Segmenter is absent', async () => {
      await withoutSegmenter(async () => {
        const provider = new FakeBriefingProvider();

        const events = [
          createEvent(0, 0, {
            text: '세그멘터 없는 환경 첫 번째',
          }),
          createEvent(1, 0, {
            text: '세그멘터 없는 환경 두 번째',
          }),
        ];
        const sources = [
          { ordinal: 0, recordId: 'rec-no-seg-0' },
          { ordinal: 1, recordId: 'rec-no-seg-1' },
        ];
        const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

        const result = await runPartnerBriefingPipeline({
          events,
          sources,
          days,
          provider,
          timeoutMs: 1000,
        });

        expect(result.sourceCount).toBe(2);
        expect(result.overview.sourceRecordIds).toEqual(['rec-no-seg-0', 'rec-no-seg-1']);
        expect(result.days[0].sections[0].items[0].parts[0].text).toBe(
          '“세그멘터 없는 환경 첫 번째”라고 기록했어요.',
        );
      });
    });
  });

  describe('Long Single Record Singleton', () => {
    it('forces long single record that exceeds grapheme limit to stay a deterministic singleton', async () => {
      const smallEnvelope = {
        maxContextUtf8Bytes: 500,
        promptOverheadUtf8Bytes: 50,
        responseReserveUtf8Bytes: 150,
        maxInputTextGraphemes: 15,
        maxItems: 64,
        maxCandidatesPerItem: 32,
      };

      const provider = new FakeBriefingProvider({
        capability: { envelope: smallEnvelope },
      });

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

      expect(briefing.days[0].sections[0].items).toHaveLength(1);
      const item = briefing.days[0].sections[0].items[0];
      expect(item.parts[0].sourceRecordId).toBe('rec-long-single');
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-long-single']);
      expect(item.parts[0].text).toContain('“첫 번째 분할 문장입니다.”라고 기록했어요.');
    });
  });

  describe('Media-Only and Empty Record Handling', () => {
    it('never groups eligible records across a media-only original gap', async () => {
      const provider = new FakeBriefingProvider();

      const events = [
        createEvent(0, 0, {
          period: 'morning',
          text: '텍스트 기록입니다.',
          mediaKinds: [],
        }),
        createEvent(1, 0, {
          period: 'morning',
          text: '',
          mediaKinds: ['photo'],
        }),
        createEvent(2, 0, {
          period: 'morning',
          text: '간격 뒤 텍스트 기록입니다.',
          mediaKinds: [],
        }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-text' },
        { ordinal: 1, recordId: 'rec-media' },
        { ordinal: 2, recordId: 'rec-text-after-gap' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 1000,
      });

      expect(briefing.generation).toBe('on_device');
      const items = briefing.days[0].sections[0].items;
      expect(items).toHaveLength(3);
      expect(items[0].parts[0].text).toBe(
        '“텍스트 기록입니다.”라고 기록했어요.',
      );
      expect(items[1].parts[0].text).toBe(
        '사진 1장을 남겼어요.',
      );
      expect(items[2].parts[0].text).toBe(
        '“간격 뒤 텍스트 기록입니다.”라고 기록했어요.',
      );

      const sourceIds = items.flatMap((item) =>
        item.parts.map((part) => part.sourceRecordId),
      );
      expect(sourceIds).toEqual(['rec-text', 'rec-media', 'rec-text-after-gap']);
      expect(briefing.overview.sourceRecordIds).toEqual(sourceIds);

      const calls = provider.getCallHistory();
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => call.items.length === 1)).toBe(true);
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

  describe('Total Run Deadline & Concurrency Controller', () => {
    it('bounds total execution across multiple delayed calls under single deadline', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 80,
      });

      // 4 periods -> 4 sequential batches. With 120ms total timeout, batch 0 succeeds (~80ms), batch 1 times out / expires, remaining fallback instantly.
      const events = [
        createEvent(0, 0, { period: 'morning', text: '아침 1' }),
        createEvent(1, 0, { period: 'afternoon', text: '오후 1' }),
        createEvent(2, 0, { period: 'evening', text: '저녁 1' }),
        createEvent(3, 0, { period: 'night', text: '밤 1' }),
      ];
      const sources = events.map((e) => ({ ordinal: e.ordinal, recordId: `rec-${e.ordinal}` }));
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const start = Date.now();
      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 120,
      });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(350); // Proves no per-batch 120ms * 4 multiplication!
      expect(briefing.sourceCount).toBe(4);
      expect(briefing.overview.sourceRecordIds).toHaveLength(4);
    });

    it('supersedes older run with newer run and returns null for stale run', async () => {
      const runner = new PartnerBriefingRunner();
      const slowProvider = new FakeBriefingProvider({ delayMs: 100 });
      const fastProvider = new FakeBriefingProvider({ delayMs: 10 });

      const eventsA = [createEvent(0, 0, { text: 'A' })];
      const sourcesA = [{ ordinal: 0, recordId: 'rec-A' }];
      const daysA = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const eventsB = [createEvent(0, 0, { text: 'B' })];
      const sourcesB = [{ ordinal: 0, recordId: 'rec-B' }];
      const daysB = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const promiseA = runner.run({
        events: eventsA,
        sources: sourcesA,
        days: daysA,
        provider: slowProvider,
        timeoutMs: 1000,
      });

      const promiseB = runner.run({
        events: eventsB,
        sources: sourcesB,
        days: daysB,
        provider: fastProvider,
        timeoutMs: 1000,
      });

      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

      expect(resultA).toBeNull();
      expect(resultB).not.toBeNull();
      expect(resultB?.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-B');
    });

    it('immediately returns null on external AbortSignal without waiting for provider delay', async () => {
      const runner = new PartnerBriefingRunner();
      const slowProvider = new FakeBriefingProvider({ delayMs: 1000 });
      const controller = new AbortController();

      const events = [createEvent(0, 0, { text: '취소 테스트' })];
      const sources = [{ ordinal: 0, recordId: 'rec-0' }];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const start = Date.now();
      const runPromise = runner.run({
        events,
        sources,
        days,
        provider: slowProvider,
        timeoutMs: 5000,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 20);
      const result = await runPromise;
      const elapsed = Date.now() - start;

      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(200);
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
        timeoutMs: 2000,
      });

      expect(runner.isRunning()).toBe(true);
      runner.cancel();
      expect(runner.isRunning()).toBe(false);

      const result = await runPromise;
      expect(result).toBeNull();
    });
  });

  describe('Provider Availability States and Rejection Scenarios', () => {
    const unavailableStates: BriefingProviderAvailability[] = [
      'unsupported',
      'model_unavailable',
      'preparing',
      'locale_unsupported',
    ];

    for (const state of unavailableStates) {
      it(`falls back to deterministic when availability is '${state}'`, async () => {
        const provider = new FakeBriefingProvider({
          availability: state,
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
        expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
        expect(provider.getCallHistory()).toHaveLength(0);
      });
    }

    /*
      One malformed batch must not take the whole run down with it.

      The verifier walked `currentExpectedItemOrdinal` forward with each consumed choice,
      so a plan carrying more choices than were requested pushed it past the end of
      `requestedItems` and indexed off the array. That threw a TypeError out of
      `verifyBriefingExtractResult`, and the pipeline's batch loop has no try/catch around
      it -- so a single hostile batch destroyed every sibling batch that had already
      verified cleanly, and the user got nothing.
    */
    it('keeps sibling batches when one batch returns an over-long plan', async () => {
      const seen: number[] = [];

      /*
        The hostile batch must carry at least TWO items. With a single-item request the
        verifier's group-size rule ("requestCount === 1 -> exactly one group of one
        choice") rejects an extra choice before it is ever used as an index, so a
        one-item batch cannot reach the crash and a test built on one proves nothing.
        Batching is per (day, period), so two records in each of two periods gives two
        batches of two.
      */
      const provider: BriefingProvider = {
        async getAvailability() {
          return 'ready' as BriefingProviderAvailability;
        },
        getCapability() {
          return { envelope: DEFAULT_FAKE_PROVIDER_ENVELOPE };
        },
        async selectExtracts(request: BriefingExtractRequest) {
          const callIndex = seen.length;
          seen.push(request.items.length);

          if (callIndex === 0) {
            // Hostile: one more choice than there are items, landing exactly on the
            // ordinal the verifier expects next.
            return {
              ok: true as const,
              requestId: request.requestId,
              output: {
                version: 2,
                groups: [
                  {
                    groupOrdinal: 0,
                    choices: [
                      ...request.items.map((item, idx) => ({
                        itemOrdinal: idx,
                        candidateOrdinal: Math.max(0, item.candidates.length - 1),
                      })),
                      { itemOrdinal: request.items.length, candidateOrdinal: 0 },
                    ],
                  },
                ],
              },
            };
          }

          // A well-formed plan: with requestCount >= 2 every group must carry 2..4
          // choices, so all items go into one group in request order.
          return {
            ok: true as const,
            requestId: request.requestId,
            output: {
              version: 2,
              groups: [
                {
                  groupOrdinal: 0,
                  choices: request.items.map((item, idx) => ({
                    itemOrdinal: idx,
                    candidateOrdinal: Math.max(0, item.candidates.length - 1),
                  })),
                },
              ],
            },
          };
        },
        async cancel() {},
      };

      const events = [
        createEvent(0, 0, { period: 'morning', text: '오전 훈련을 시작했습니다.' }),
        createEvent(1, 0, { period: 'morning', text: '오전 훈련에서 복귀했습니다.' }),
        createEvent(2, 0, { period: 'afternoon', text: '오후 정비를 시작했습니다.' }),
        createEvent(3, 0, { period: 'afternoon', text: '오후 정비를 마무리했습니다.' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
        { ordinal: 2, recordId: 'rec-2' },
        { ordinal: 3, recordId: 'rec-3' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 2000,
      });

      // Non-vacuity: the hostile request really did carry >= 2 items, so its extra
      // choice reached the ordinal that used to index off the end.
      expect(seen[0]).toBeGreaterThanOrEqual(2);
      // The hostile batch did not abort the run: later batches were still requested.
      expect(seen.length).toBeGreaterThan(1);

      // Source coverage is total, and every source is still bound to its exact record.
      const boundIds = briefing.days
        .flatMap((day) => day.sections)
        .flatMap((section) => section.items)
        .flatMap((item) => item.parts.map((part) => part.sourceRecordId));
      expect([...new Set(boundIds)].sort()).toEqual(['rec-0', 'rec-1', 'rec-2', 'rec-3']);
      expect(briefing.sourceCount).toBe(4);
      expect(briefing.overview.sourceRecordIds).toEqual([
        'rec-0',
        'rec-1',
        'rec-2',
        'rec-3',
      ]);

      // Mixed outcome: the hostile batch was rejected, the clean one still verified.
      expect(briefing.generation).toBe('hybrid');
    });

    it('후보 33개짜리 기록도 최종 브리핑에서 사라지지 않는다', async () => {
      // 실제 재현: 문장 33개로 쪼개지는 기록 하나. native 한도는 32라 요청 전체가
      // 거부되고, JS는 그 사실을 몰라 그대로 보내고 있었다.
      const thirtyThree = Array.from({ length: 33 }, (_, i) => `문장 ${i} 입니다.`).join(' ');
      expect(buildBriefingExtractCandidates(thirtyThree, 'ko')).toHaveLength(33);

      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'morning', text: thirtyThree }),
        createEvent(1, 0, { period: 'morning', text: '짧은 기록 하나.' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-33' },
        { ordinal: 1, recordId: 'rec-ok' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 2000,
      });

      // 두 source 모두 최종 결과에 정확한 recordId로 남는다.
      const rendered = briefing.days
        .flatMap((day) => day.sections)
        .flatMap((section) => section.items)
        .flatMap((item) => item.parts.map((part) => part.sourceRecordId));
      expect([...new Set(rendered)].sort()).toEqual(['rec-33', 'rec-ok']);
      expect(briefing.sourceCount).toBe(2);
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-33', 'rec-ok']);

      // 그리고 33개짜리는 native로 보내지지 않았다: 어떤 요청도 32개를 넘지 않는다.
      for (const call of provider.getCallHistory()) {
        for (const item of call.items) {
          expect(item.candidates.length).toBeLessThanOrEqual(32);
        }
      }
    });

    it('keeps a midnight-spanning night as two runs on the AI path too', async () => {
      // Same defect as the deterministic path, one layer up: batching keyed on
      // `${day}_${period}`, so a group could join a 00:30 record to a 22:30 one with the
      // whole day in between and still believe it was period-isolated.
      const provider = new FakeBriefingProvider();
      const events = [
        createEvent(0, 0, { period: 'night', text: '새벽 근무 교대했습니다.' }),
        createEvent(1, 0, { period: 'morning', text: '오전 점호를 마쳤습니다.' }),
        createEvent(2, 0, { period: 'night', text: '늦은 밤 점검했습니다.' }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-0030' },
        { ordinal: 1, recordId: 'rec-0900' },
        { ordinal: 2, recordId: 'rec-2230' },
      ];
      const days = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = await runPartnerBriefingPipeline({
        events,
        sources,
        days,
        provider,
        timeoutMs: 2000,
      });

      const sections = briefing.days[0].sections;
      expect(sections.map((sec) => sec.period)).toEqual(['night', 'morning', 'night']);

      // No group may fuse the two nights: every item's parts stay inside one run.
      const perSection = sections.map((sec) =>
        sec.items.flatMap((item) => item.parts.map((part) => part.sourceRecordId)),
      );
      expect(perSection).toEqual([['rec-0030'], ['rec-0900'], ['rec-2230']]);

      // Total source coverage and chronological order are unchanged.
      expect(perSection.flat()).toEqual(['rec-0030', 'rec-0900', 'rec-2230']);
      expect(briefing.overview.sourceRecordIds).toEqual([
        'rec-0030',
        'rec-0900',
        'rec-2230',
      ]);
      expect(briefing.sourceCount).toBe(3);

      // Every provider request stays within a single contiguous run.
      for (const call of provider.getCallHistory()) {
        expect(call.items.length).toBeLessThanOrEqual(1);
      }
    });

    it('falls back to deterministic when provider returns wrong correlation requestId', async () => {
      const provider = new FakeBriefingProvider({
        scenarioSelector: () => ({
          type: 'wrong_correlation',
          wrongRequestId: 'completely-wrong-uuid',
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
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
    });

    it('falls back to deterministic on provider timeout and late response cannot overwrite fallback', async () => {
      const provider = new FakeBriefingProvider({
        delayMs: 300,
      });

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
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-0');
    });
  });

  describe('Locale Support (Gate L3b)', () => {
    it('maintains exact Korean strings and generation when locale is unspecified (default)', async () => {
      const provider = new FakeBriefingProvider();

      const events = [createEvent(0, 0, { text: '기본 로케일 한국어 테스트' })];
      const sources = [{ ordinal: 0, recordId: 'rec-ko-0' }];
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
      expect(briefing.days[0].sections[0].items[0].parts[0].text).toBe(
        '“기본 로케일 한국어 테스트”라고 기록했어요.',
      );
    });

    it('renders English templates in deterministic fallback path when locale is "en"', async () => {
      const provider = new FakeBriefingProvider({
        availability: 'unsupported',
      });

      const events = [
        createEvent(0, 0, {
          period: 'morning',
          text: '훈련 다녀왔어',
          mediaKinds: ['photo'],
        }),
        createEvent(1, 0, {
          period: 'evening',
          text: '',
          mediaKinds: ['video', 'voice'],
        }),
      ];
      const sources = [
        { ordinal: 0, recordId: 'rec-en-0' },
        { ordinal: 1, recordId: 'rec-en-1' },
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

      expect(briefing.generation).toBe('deterministic');
      expect(briefing.rangeLabel).toBe('August 26');
      expect(briefing.overview.text).toBe(
        '2 records (1 photo, 1 video, 1 voice note) in total.',
      );

      expect(briefing.days[0].sections[0].items[0].parts[0].text).toBe('They wrote: “훈련 다녀왔어”');
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-en-0');

      expect(briefing.days[0].sections[1].items[0].parts[0].text).toBe(
        'Shared 1 video, 1 voice note.',
      );
      expect(briefing.days[0].sections[1].items[0].parts[0].sourceRecordId).toBe('rec-en-1');
    });

    it('renders English attributed wrapper on on-device success when locale is "en"', async () => {
      const provider = new FakeBriefingProvider();

      const events = [
        createEvent(0, 0, {
          text: 'First sentence. Second sentence.',
        }),
      ];
      const sources = [{ ordinal: 0, recordId: 'rec-en-single' }];
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
      expect(briefing.days[0].sections[0].items[0].parts[0].text).toBe(
        'They wrote: “First sentence.”',
      );
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
              maxItems: 64,
              maxCandidatesPerItem: 32,
            },
          };
        },
        async selectExtracts(req, optionsOrSignal) {
          capturedSelectExtractsOptions = optionsOrSignal;
          return {
            ok: true,
            requestId: req.requestId,
            output: {
              version: 2,
              groups: [
                {
                  groupOrdinal: 0,
                  choices: req.items.map((it) => ({
                    itemOrdinal: it.itemOrdinal,
                    candidateOrdinal: 0,
                  })),
                },
              ],
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

      expect(capturedAvailabilityOptions).toEqual(
        expect.objectContaining({ locale: 'en' }),
      );

      expect(capturedSelectExtractsOptions).toEqual(
        expect.objectContaining({ locale: 'en' }),
      );
    });
  });
});
