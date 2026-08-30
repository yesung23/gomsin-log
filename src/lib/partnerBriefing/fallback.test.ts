import { describe, expect, it } from 'vitest';
import type {
  BriefingLocale,
  BriefingModelSafeEvent,
  BriefingSourceMapping,
  PartnerBriefingItem,
} from './contract';
import { DEFAULT_BRIEFING_LOCALE } from './contract';
import type { BriefingDayMapping } from './normalize';
import {
  buildBriefingExtractCandidates,
  formatAttributedBriefingItemText,
  formatDateEnglish,
  formatDateForLocale,
  formatDateKorean,
  formatDeterministicBriefingItemText,
  formatFallbackOverviewText,
  formatFallbackPeriodText,
  formatMediaCounts,
  formatMediaItemText,
  formatRangeLabelFromDates,
  generateDeterministicPartnerBriefing,
  groupEventsIntoChronologicalRuns,
  validateBriefingMappings,
} from './fallback';

describe('Partner Briefing Deterministic Fallback & Candidate Helpers (Gate A7.1)', () => {
  describe('buildBriefingExtractCandidates (exact substring candidate extraction)', () => {
    it('returns sequential 0..K-1 ordinals and exact substrings on normal sentence segmentation path', () => {
      const source = '오늘 아침 점호 끝났다. 밥 먹으러 가자! 날씨가 좋다.';
      const candidates = buildBriefingExtractCandidates(source);

      expect(candidates.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < candidates.length; i += 1) {
        expect(candidates[i].candidateOrdinal).toBe(i);
        expect(candidates[i].text.length).toBeGreaterThan(0);
        expect(source.includes(candidates[i].text)).toBe(true);
      }

      // Check keys: must only contain candidateOrdinal and text (zero IDs)
      for (const cand of candidates) {
        expect(Object.keys(cand).sort()).toEqual(['candidateOrdinal', 'text']);
      }
    });

    it('returns empty array for empty string, whitespace only, or non-string input', () => {
      expect(buildBriefingExtractCandidates('')).toEqual([]);
      expect(buildBriefingExtractCandidates('   ')).toEqual([]);
      expect(buildBriefingExtractCandidates('\t\n\r  ')).toEqual([]);
      // @ts-expect-error test non-string input
      expect(buildBriefingExtractCandidates(null)).toEqual([]);
      // @ts-expect-error test non-string input
      expect(buildBriefingExtractCandidates(undefined)).toEqual([]);
    });

    it('falls back to whole exact text without truncation when Intl.Segmenter is undefined', () => {
      const originalSegmenter = Intl.Segmenter;
      try {
        // @ts-expect-error test simulation
        Intl.Segmenter = undefined;

        const longText = '가'.repeat(500) + ' 나'.repeat(500);
        const candidates = buildBriefingExtractCandidates(longText);

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toEqual({
          candidateOrdinal: 0,
          text: longText,
        });
        expect(candidates[0].text.length).toBe(longText.length);
      } finally {
        Intl.Segmenter = originalSegmenter;
      }
    });

    it('falls back to whole exact text without truncation when Intl.Segmenter throws', () => {
      const originalSegmenter = Intl.Segmenter;
      try {
        // @ts-expect-error test simulation
        Intl.Segmenter = class {
          constructor() {
            throw new Error('Segmenter unsupported runtime error');
          }
        };

        const text = '첫 문장입니다. 두 번째 문장입니다.';
        const candidates = buildBriefingExtractCandidates(text);

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toEqual({
          candidateOrdinal: 0,
          text: text,
        });
        expect(text.includes(candidates[0].text)).toBe(true);
      } finally {
        Intl.Segmenter = originalSegmenter;
      }
    });

    it('contains zero IDs, dates, URLs, or external metadata in any candidate helper output', () => {
      const text = '산책하고 들어왔어요.';
      const candidates = buildBriefingExtractCandidates(text);
      for (const cand of candidates) {
        expect(cand).not.toHaveProperty('id');
        expect(cand).not.toHaveProperty('recordId');
        expect(cand).not.toHaveProperty('userId');
        expect(cand).not.toHaveProperty('coupleId');
        expect(cand).not.toHaveProperty('createdAt');
      }
    });
  });

  describe('formatAttributedBriefingItemText (attributed quote renderer)', () => {
    it('renders exact extract with fixed quote template', () => {
      expect(formatAttributedBriefingItemText('오늘 아침 점호 완료')).toBe(
        '“오늘 아침 점호 완료”라고 기록했어요.',
      );
    });

    it('renders sensitive/emotional author statements as attributed quotes, not app/AI inference', () => {
      const statement = '나는 이별하고 싶어';
      const rendered = formatAttributedBriefingItemText(statement);

      expect(rendered).toBe('“나는 이별하고 싶어”라고 기록했어요.');
      expect(rendered.startsWith('“')).toBe(true);
      expect(rendered.endsWith('”라고 기록했어요.')).toBe(true);
    });
  });

  describe('formatMediaItemText & formatDeterministicBriefingItemText', () => {
    it('formats media-only records accurately for photos, videos, voice, and combinations', () => {
      expect(formatMediaItemText(['photo'])).toBe('사진 1장을 남겼어요.');
      expect(formatMediaItemText(['photo', 'photo'])).toBe('사진 2장을 남겼어요.');
      expect(formatMediaItemText(['video'])).toBe('동영상 1개를 남겼어요.');
      expect(formatMediaItemText(['video', 'video'])).toBe('동영상 2개를 남겼어요.');
      expect(formatMediaItemText(['voice'])).toBe('음성 1개를 남겼어요.');
      expect(formatMediaItemText(['photo', 'video'])).toBe('사진 1장, 동영상 1개를 남겼어요.');
      expect(formatMediaItemText(['photo', 'voice'])).toBe('사진 1장, 음성 1개를 남겼어요.');
      expect(formatMediaItemText(['photo', 'video', 'voice'])).toBe(
        '사진 1장, 동영상 1개, 음성 1개를 남겼어요.',
      );
    });

    it('formats neutral "기록을 남겼어요." when neither text nor media is present', () => {
      expect(formatMediaItemText([])).toBe('기록을 남겼어요.');
      expect(formatDeterministicBriefingItemText({ text: '', mediaKinds: [] })).toBe(
        '기록을 남겼어요.',
      );
      expect(formatDeterministicBriefingItemText({ text: '   ', mediaKinds: [] })).toBe(
        '기록을 남겼어요.',
      );
    });

    it('prefers attributed text extract when non-empty text exists', () => {
      expect(
        formatDeterministicBriefingItemText({
          text: '점심 맛있게 먹었어.',
          mediaKinds: ['photo'],
        }),
      ).toBe('“점심 맛있게 먹었어.”라고 기록했어요.');
    });

    it('falls back to media description when text is empty but media exists', () => {
      expect(
        formatDeterministicBriefingItemText({
          text: '',
          mediaKinds: ['photo'],
        }),
      ).toBe('사진 1장을 남겼어요.');
    });
  });

  describe('validateBriefingMappings (exact fail-closed validation)', () => {
    it('accepts valid matching events, sources, and days', () => {
      const events: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '일어남',
          mediaKinds: ['photo'],
        },
        {
          ordinal: 1,
          dayOrdinal: 0,
          period: 'evening',
          text: '저녁 먹음',
          mediaKinds: [],
        },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-1' },
        { ordinal: 1, recordId: 'rec-2' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const validated = validateBriefingMappings(events, sources, days);
      expect(validated.sourceMap.get(0)).toBe('rec-1');
      expect(validated.sourceMap.get(1)).toBe('rec-2');
      expect(validated.dayMap.get(0)).toBe('2026-08-26');
    });

    it('fails closed on invalid model-safe event structure', () => {
      // @ts-expect-error invalid event
      const events: BriefingModelSafeEvent[] = [{ ordinal: 0, text: 123 }];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-1' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Invalid model-safe event at index 0/,
      );
    });

    it('fails closed on non-contiguous or gap event ordinals', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 2, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 2, recordId: 'rec-2' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Event ordinal mismatch: expected 1, received 2/,
      );
    });

    it('fails closed on non-monotonic event dayOrdinals', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 1, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-25' },
        { dayOrdinal: 1, date: '2026-08-26' },
      ];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Event dayOrdinal must be non-decreasing/,
      );
    });

    it('fails closed on sources count mismatch or missing source mapping', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Sources count mismatch/,
      );
    });

    it('fails closed on duplicate source mapping ordinal', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-1' },
        { ordinal: 0, recordId: 'rec-2' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Duplicate source mapping for ordinal 0/,
      );
    });

    it('fails closed on extra source mapping ordinal out of range', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [{ ordinal: 5, recordId: 'rec-5' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Extra source mapping ordinal 5 out of range/,
      );
    });

    it('fails closed on duplicate recordId mapped across multiple ordinals', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-same-id' },
        { ordinal: 1, recordId: 'rec-same-id' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Duplicate recordId "rec-same-id"/,
      );
    });

    it('fails closed on days count mismatch or missing day mapping', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-0' }];
      const days: BriefingDayMapping[] = [];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Days count mismatch/,
      );
    });

    it('fails closed on extra day mapping for unused dayOrdinal', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-0' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 3, date: '2026-08-26' }];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Extra day mapping for unused dayOrdinal 3/,
      );
    });

    it('fails closed on duplicate date mapped across multiple dayOrdinals', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 1, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-26' },
        { dayOrdinal: 1, date: '2026-08-26' },
      ];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Duplicate date "2026-08-26"/,
      );
    });

    it('fails closed on non-strictly ascending dates in day mappings', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 1, period: 'morning', text: 'b', mediaKinds: [] },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-0' },
        { ordinal: 1, recordId: 'rec-1' },
      ];
      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-27' },
        { dayOrdinal: 1, date: '2026-08-26' },
      ];

      expect(() => validateBriefingMappings(events, sources, days)).toThrow(
        /Day mapping dates must be strictly ascending/,
      );
    });
  });

  describe('Absence Phrase Prohibition & Formatting', () => {
    it('returns empty string for 0 events and never emits absence or debt phrases', () => {
      expect(formatFallbackPeriodText([])).toBe('');
      expect(formatFallbackOverviewText([], 0)).toBe('');

      const briefing = generateDeterministicPartnerBriefing({
        events: [],
        sources: [],
        days: [],
      });

      expect(briefing.overview.text).toBe('');
      expect(briefing.overview.text).not.toContain('없');
      expect(briefing.overview.text).not.toContain('밀');
      expect(briefing.overview.text).not.toContain('부재');
    });

    it('formats Korean dates and range labels correctly', () => {
      expect(formatDateKorean('2026-08-26')).toBe('8월 26일');
      expect(formatDateKorean('2026-01-05')).toBe('1월 5일');
      expect(formatRangeLabelFromDates([])).toBe('');
      expect(formatRangeLabelFromDates(['2026-08-26'])).toBe('8월 26일');
      expect(formatRangeLabelFromDates(['2026-08-26', '2026-08-27'])).toBe(
        '8월 26일 ~ 8월 27일',
      );
    });

    it('formats media counts accurately', () => {
      expect(formatMediaCounts([])).toEqual([]);
      expect(formatMediaCounts([['photo'], ['photo', 'voice'], ['video']])).toEqual([
        '사진 2장',
        '동영상 1개',
        '음성 1개',
      ]);
    });

    it('formats fallback period text with and without media', () => {
      const textEvents: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '아침',
          mediaKinds: [],
        },
      ];
      expect(formatFallbackPeriodText(textEvents)).toBe('기록 1개');

      const mediaEvents: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '사진 첨부',
          mediaKinds: ['photo'],
        },
        {
          ordinal: 1,
          dayOrdinal: 0,
          period: 'morning',
          text: '음성 첨부',
          mediaKinds: ['voice'],
        },
      ];
      expect(formatFallbackPeriodText(mediaEvents)).toBe('기록 2개 (사진 1장, 음성 1개)');
    });

    it('formats fallback overview text correctly for single day and multi-day', () => {
      const events: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '첫 기록',
          mediaKinds: ['photo'],
        },
      ];
      expect(formatFallbackOverviewText(events, 1)).toBe('총 1개의 기록 (사진 1장)이 있습니다.');
      expect(formatFallbackOverviewText(events, 3)).toBe(
        '3일 동안 총 1개의 기록 (사진 1장)이 있습니다.',
      );
    });
  });

  describe('generateDeterministicPartnerBriefing (item-level 1:1 representation)', () => {
    it('handles empty events (0 records) cleanly with empty string text', () => {
      const briefing = generateDeterministicPartnerBriefing({
        events: [],
        sources: [],
        days: [],
      });

      expect(briefing.version).toBe(1);
      expect(briefing.sourceCount).toBe(0);
      expect(briefing.generation).toBe('deterministic');
      expect(briefing.rangeLabel).toBe('');
      expect(briefing.overview).toEqual({
        text: '',
        sourceRecordIds: [],
      });
      expect(briefing.days).toEqual([]);
    });

    it('generates single day briefing with exact 1:1 items and overview union', () => {
      const events: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '기상 완료!',
          mediaKinds: [],
        },
        {
          ordinal: 1,
          dayOrdinal: 0,
          period: 'evening',
          text: '',
          mediaKinds: ['photo'],
        },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-1' },
        { ordinal: 1, recordId: 'rec-2' },
      ];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = generateDeterministicPartnerBriefing({ events, sources, days });

      expect(briefing.sourceCount).toBe(2);
      expect(briefing.days).toHaveLength(1);
      expect(briefing.days[0].sections).toHaveLength(2);

      const morningSec = briefing.days[0].sections[0];
      expect(morningSec.period).toBe('morning');
      expect(morningSec.items).toHaveLength(1);
      expect(morningSec.items[0]).toEqual({
        parts: [
          {
            text: '“기상 완료!”라고 기록했어요.',
            sourceRecordId: 'rec-1',
          },
        ],
      });

      const eveningSec = briefing.days[0].sections[1];
      expect(eveningSec.period).toBe('evening');
      expect(eveningSec.items).toHaveLength(1);
      expect(eveningSec.items[0]).toEqual({
        parts: [
          {
            text: '사진 1장을 남겼어요.',
            sourceRecordId: 'rec-2',
          },
        ],
      });

      expect(briefing.overview.sourceRecordIds).toEqual(['rec-1', 'rec-2']);
    });

    it('generates multi-day, multi-period deterministic briefing with exact sourceRecordIds and items', () => {
      const events: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '아침 점호',
          mediaKinds: ['photo'],
        },
        {
          ordinal: 1,
          dayOrdinal: 0,
          period: 'evening',
          text: '저녁 체력단련',
          mediaKinds: [],
        },
        {
          ordinal: 2,
          dayOrdinal: 1,
          period: 'afternoon',
          text: '오후 정비',
          mediaKinds: ['voice'],
        },
      ];
      const sources: BriefingSourceMapping[] = [
        { ordinal: 0, recordId: 'rec-day1-morning' },
        { ordinal: 1, recordId: 'rec-day1-evening' },
        { ordinal: 2, recordId: 'rec-day2-afternoon' },
      ];
      const days: BriefingDayMapping[] = [
        { dayOrdinal: 0, date: '2026-08-26' },
        { dayOrdinal: 1, date: '2026-08-27' },
      ];

      const briefing = generateDeterministicPartnerBriefing({ events, sources, days });

      expect(briefing.version).toBe(1);
      expect(briefing.sourceCount).toBe(3);
      expect(briefing.generation).toBe('deterministic');
      expect(briefing.rangeLabel).toBe('8월 26일 ~ 8월 27일');
      expect(briefing.overview.sourceRecordIds).toEqual([
        'rec-day1-morning',
        'rec-day1-evening',
        'rec-day2-afternoon',
      ]);
      expect(briefing.overview.text).toBe(
        '2일 동안 총 3개의 기록 (사진 1장, 음성 1개)이 있습니다.',
      );

      expect(briefing.days).toHaveLength(2);
      expect(briefing.days[0].date).toBe('2026-08-26');
      expect(briefing.days[0].sections).toHaveLength(2);
      expect(briefing.days[0].sections[0].period).toBe('morning');
      expect(briefing.days[0].sections[0].items).toEqual([
        {
          parts: [
            {
              text: '“아침 점호”라고 기록했어요.',
              sourceRecordId: 'rec-day1-morning',
            },
          ],
        },
      ]);
      expect(briefing.days[0].sections[1].period).toBe('evening');
      expect(briefing.days[0].sections[1].items).toEqual([
        {
          parts: [
            {
              text: '“저녁 체력단련”라고 기록했어요.',
              sourceRecordId: 'rec-day1-evening',
            },
          ],
        },
      ]);

      expect(briefing.days[1].date).toBe('2026-08-27');
      expect(briefing.days[1].sections).toHaveLength(1);
      expect(briefing.days[1].sections[0].period).toBe('afternoon');
      expect(briefing.days[1].sections[0].items).toEqual([
        {
          parts: [
            {
              text: '“오후 정비”라고 기록했어요.',
              sourceRecordId: 'rec-day2-afternoon',
            },
          ],
        },
      ]);
    });

    it('guarantees 1:1 item representation and exact overview union across 30, 100, and 300 events scale', () => {
      for (const count of [30, 100, 300]) {
        const periods: ('morning' | 'afternoon' | 'evening' | 'night')[] = [
          'morning',
          'afternoon',
          'evening',
          'night',
        ];
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
          const recId = `rec-scale-${count}-${i}`;

          events.push({
            ordinal: i,
            dayOrdinal,
            period,
            text: i % 3 === 0 ? `기록 번호 ${i}` : '',
            mediaKinds: i % 2 === 0 ? ['photo'] : [],
          });
          sources.push({
            ordinal: i,
            recordId: recId,
          });
        }

        const briefing = generateDeterministicPartnerBriefing({ events, sources, days });

        expect(briefing.sourceCount).toBe(count);
        expect(briefing.overview.sourceRecordIds).toHaveLength(count);

        const allEmittedItems: PartnerBriefingItem[] = [];
        for (const day of briefing.days) {
          for (const sec of day.sections) {
            expect(sec.items).toBeDefined();
            for (const item of sec.items) {
              allEmittedItems.push(item);
            }
          }
        }

        // Exactly one item per source event: zero loss, zero duplicates
        expect(allEmittedItems).toHaveLength(count);
        const itemRecordIds = allEmittedItems.flatMap((item) => item.parts.map((p) => p.sourceRecordId));
        const expectedRecordIds = sources.map((s) => s.recordId);

        expect(itemRecordIds).toEqual(expectedRecordIds);
        expect(briefing.overview.sourceRecordIds).toEqual(expectedRecordIds);
        expect(new Set(itemRecordIds).size).toBe(count);
      }
    });

    it('documents pure deterministic mapping without re-filtering or state-machine logic', () => {
      // Inputs to fallback are already filtered safe corpus (BriefingModelSafeEvent[])
      // Fallback does not accept raw DailyRecord or evaluate couple status / privacy flags.
      const safeEvents: BriefingModelSafeEvent[] = [
        {
          ordinal: 0,
          dayOrdinal: 0,
          period: 'morning',
          text: '안전한 코퍼스 기록',
          mediaKinds: [],
        },
      ];
      const sources: BriefingSourceMapping[] = [{ ordinal: 0, recordId: 'rec-safe' }];
      const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

      const briefing = generateDeterministicPartnerBriefing({
        events: safeEvents,
        sources,
        days,
      });

      expect(briefing.sourceCount).toBe(1);
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe('rec-safe');
    });
  });

  describe('English & Bilingual Locale Deterministic Fallback (Gate A7.1 Locale L2)', () => {
    describe('buildBriefingExtractCandidates with locale', () => {
      it('segments English source text with sequential 0..K-1 candidate ordinals and exact substrings', () => {
        const source = 'Finished morning workout. Heading to breakfast now! The weather is lovely.';
        const candidates = buildBriefingExtractCandidates(source, 'en');

        expect(candidates.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < candidates.length; i += 1) {
          expect(candidates[i].candidateOrdinal).toBe(i);
          expect(candidates[i].text.length).toBeGreaterThan(0);
          expect(source.includes(candidates[i].text)).toBe(true);
        }
      });

      it('falls back to whole exact text without truncation when Intl.Segmenter is undefined for en locale', () => {
        const originalSegmenter = Intl.Segmenter;
        try {
          // @ts-expect-error test simulation
          Intl.Segmenter = undefined;

          const longText = 'A'.repeat(500) + ' B'.repeat(500);
          const candidates = buildBriefingExtractCandidates(longText, 'en');

          expect(candidates).toHaveLength(1);
          expect(candidates[0]).toEqual({
            candidateOrdinal: 0,
            text: longText,
          });
          expect(candidates[0].text.length).toBe(longText.length);
        } finally {
          Intl.Segmenter = originalSegmenter;
        }
      });

      it('falls back to whole exact text without truncation when Intl.Segmenter throws for en locale', () => {
        const originalSegmenter = Intl.Segmenter;
        try {
          // @ts-expect-error test simulation
          Intl.Segmenter = class {
            constructor() {
              throw new Error('Segmenter unsupported for locale');
            }
          };

          const text = 'First sentence. Second sentence.';
          const candidates = buildBriefingExtractCandidates(text, 'en');

          expect(candidates).toHaveLength(1);
          expect(candidates[0]).toEqual({
            candidateOrdinal: 0,
            text: text,
          });
        } finally {
          Intl.Segmenter = originalSegmenter;
        }
      });
    });

    describe('formatAttributedBriefingItemText with locale', () => {
      it('formats English fixed attributed quote with original extract unchanged and no trailing period', () => {
        expect(formatAttributedBriefingItemText('Morning run finished', 'en')).toBe(
          'They wrote: “Morning run finished”',
        );
      });

      it('preserves Korean source text ending with punctuation verbatim without double punctuation', () => {
        const koreanSource = '오늘 하루도 힘내자!';
        const rendered = formatAttributedBriefingItemText(koreanSource, 'en');
        expect(rendered).toBe('They wrote: “오늘 하루도 힘내자!”');
        expect(rendered).toContain(koreanSource);
      });

      it('preserves English source text ending in period without producing double dots', () => {
        const englishSource = 'Had a great day.';
        const rendered = formatAttributedBriefingItemText(englishSource, 'en');
        expect(rendered).toBe('They wrote: “Had a great day.”');
      });

      it('preserves English source text verbatim inside Korean quote without translation or paraphrase', () => {
        const englishSource = 'Good morning, my love!';
        const rendered = formatAttributedBriefingItemText(englishSource, 'ko');
        expect(rendered).toBe('“Good morning, my love!”라고 기록했어요.');
        expect(rendered).toContain(englishSource);
      });
    });

    describe('formatMediaCounts & formatMediaItemText in English', () => {
      it('formats photo, video, voice singular and plural counts accurately in English', () => {
        expect(formatMediaCounts(['photo'], 'en')).toEqual(['1 photo']);
        expect(formatMediaCounts(['photo', 'photo'], 'en')).toEqual(['2 photos']);
        expect(formatMediaCounts(['video'], 'en')).toEqual(['1 video']);
        expect(formatMediaCounts(['video', 'video'], 'en')).toEqual(['2 videos']);
        expect(formatMediaCounts(['voice'], 'en')).toEqual(['1 voice note']);
        expect(formatMediaCounts(['voice', 'voice'], 'en')).toEqual(['2 voice notes']);
        expect(
          formatMediaCounts([['photo'], ['photo', 'voice'], ['video']], 'en'),
        ).toEqual(['2 photos', '1 video', '1 voice note']);
      });

      it('formats media item text for single and combined media in English', () => {
        expect(formatMediaItemText(['photo'], 'en')).toBe('Shared 1 photo.');
        expect(formatMediaItemText(['photo', 'photo'], 'en')).toBe('Shared 2 photos.');
        expect(formatMediaItemText(['video'], 'en')).toBe('Shared 1 video.');
        expect(formatMediaItemText(['video', 'video'], 'en')).toBe('Shared 2 videos.');
        expect(formatMediaItemText(['voice'], 'en')).toBe('Shared 1 voice note.');
        expect(formatMediaItemText(['voice', 'voice'], 'en')).toBe('Shared 2 voice notes.');
        expect(formatMediaItemText(['photo', 'video'], 'en')).toBe(
          'Shared 1 photo, 1 video.',
        );
        expect(formatMediaItemText(['photo', 'voice'], 'en')).toBe(
          'Shared 1 photo, 1 voice note.',
        );
        expect(formatMediaItemText(['photo', 'video', 'voice'], 'en')).toBe(
          'Shared 1 photo, 1 video, 1 voice note.',
        );
        expect(
          formatMediaItemText(['photo', 'photo', 'video', 'voice', 'voice'], 'en'),
        ).toBe('Shared 2 photos, 1 video, 2 voice notes.');
      });

      it('formats neutral "Shared a record." for empty media and text in English', () => {
        expect(formatMediaItemText([], 'en')).toBe('Shared a record.');
        expect(
          formatDeterministicBriefingItemText({ text: '', mediaKinds: [] }, 'en'),
        ).toBe('Shared a record.');
        expect(
          formatDeterministicBriefingItemText({ text: '   ', mediaKinds: [] }, 'en'),
        ).toBe('Shared a record.');
      });

      it('prefers attributed extract when text is present in English', () => {
        expect(
          formatDeterministicBriefingItemText(
            { text: 'Had lunch with friends.', mediaKinds: ['photo'] },
            'en',
          ),
        ).toBe('They wrote: “Had lunch with friends.”');
      });

      it('falls back to media item text when text is empty but media is present in English', () => {
        expect(
          formatDeterministicBriefingItemText(
            { text: '', mediaKinds: ['photo', 'voice'] },
            'en',
          ),
        ).toBe('Shared 1 photo, 1 voice note.');
      });
    });

    describe('Presentation vs Content Locale Separation Regression', () => {
      it('does not pass presentation locale or falsely default to Korean for sentence segmentation, allowing runtime negotiation while preserving exact extract', () => {
        const originalSegmenter = Intl.Segmenter;
        const segmenterCalls: (string | undefined)[] = [];
        try {
          // @ts-expect-error test spy
          Intl.Segmenter = class extends originalSegmenter {
            constructor(locale?: string, options?: Intl.SegmenterOptions) {
              super(locale, options);
              segmenterCalls.push(locale);
            }
          };

          const koreanEvent: BriefingModelSafeEvent = {
            ordinal: 0,
            dayOrdinal: 0,
            period: 'morning',
            text: '오늘 아침 점호 끝났다. 밥 먹으러 가자!',
            mediaKinds: [],
          };

          const formatted = formatDeterministicBriefingItemText(koreanEvent, 'en');

          // Segmenter must receive undefined (allowing runtime negotiation), NOT presentation locale 'en' and NOT hard-coded 'ko'
          expect(segmenterCalls).toContain(undefined);
          expect(segmenterCalls).not.toContain('ko');
          expect(segmenterCalls).not.toContain('en');
          // Exact extract is preserved inside English attributed template
          expect(formatted).toBe('They wrote: “오늘 아침 점호 끝났다.”');
        } finally {
          Intl.Segmenter = originalSegmenter;
        }
      });
    });

    describe('Date and Range Label Formatting in English', () => {
      it('formats English dates correctly with full month names', () => {
        expect(formatDateEnglish('2026-08-26')).toBe('August 26');
        expect(formatDateEnglish('2026-01-05')).toBe('January 5');
        expect(formatDateEnglish('2026-12-31')).toBe('December 31');
        expect(formatDateEnglish('invalid-date')).toBe('invalid-date');
      });

      it('formats date for locale correctly', () => {
        expect(formatDateForLocale('2026-08-26', 'ko')).toBe('8월 26일');
        expect(formatDateForLocale('2026-08-26', 'en')).toBe('August 26');
      });

      it('formats range labels in English for single and multi-day', () => {
        expect(formatRangeLabelFromDates([], 'en')).toBe('');
        expect(formatRangeLabelFromDates(['2026-08-26'], 'en')).toBe('August 26');
        expect(formatRangeLabelFromDates(['2026-08-26', '2026-08-27'], 'en')).toBe(
          'August 26 – August 27',
        );
        expect(
          formatRangeLabelFromDates(['2026-08-26', '2026-08-27', '2026-08-28'], 'en'),
        ).toBe('August 26 – August 28');
      });
    });

    describe('Fallback Period and Overview Text in English', () => {
      it('returns empty string for 0 events in English without debt or absence words', () => {
        expect(formatFallbackPeriodText([], 'en')).toBe('');
        expect(formatFallbackOverviewText([], 0, 'en')).toBe('');
      });

      it('formats period text correctly for singular, plural, and media in English', () => {
        const singleEvent: BriefingModelSafeEvent[] = [
          { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'hi', mediaKinds: [] },
        ];
        expect(formatFallbackPeriodText(singleEvent, 'en')).toBe('1 record');

        const pluralEvents: BriefingModelSafeEvent[] = [
          { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: ['photo'] },
          { ordinal: 1, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: ['voice'] },
        ];
        expect(formatFallbackPeriodText(pluralEvents, 'en')).toBe(
          '2 records (1 photo, 1 voice note)',
        );
      });

      it('formats overview text correctly for 1-day single record and multi-records in English', () => {
        const singleEvent: BriefingModelSafeEvent[] = [
          { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: ['photo'] },
        ];
        expect(formatFallbackOverviewText(singleEvent, 1, 'en')).toBe(
          '1 record (1 photo) in total.',
        );

        const multiEvents: BriefingModelSafeEvent[] = [
          { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: ['photo'] },
          { ordinal: 1, dayOrdinal: 0, period: 'evening', text: 'b', mediaKinds: ['video'] },
        ];
        expect(formatFallbackOverviewText(multiEvents, 1, 'en')).toBe(
          '2 records (1 photo, 1 video) in total.',
        );
      });

      it('formats overview text correctly for 2-day and multi-day in English', () => {
        const events: BriefingModelSafeEvent[] = [
          { ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'a', mediaKinds: ['photo'] },
          { ordinal: 1, dayOrdinal: 0, period: 'evening', text: 'b', mediaKinds: [] },
          { ordinal: 2, dayOrdinal: 1, period: 'afternoon', text: 'c', mediaKinds: ['voice'] },
        ];
        expect(formatFallbackOverviewText(events, 2, 'en')).toBe(
          'Over 2 days: 3 records (1 photo, 1 voice note) in total.',
        );
        expect(formatFallbackOverviewText(events, 5, 'en')).toBe(
          'Over 5 days: 3 records (1 photo, 1 voice note) in total.',
        );
      });
    });

    describe('generateDeterministicPartnerBriefing with English locale', () => {
      it('generates multi-day, multi-period English briefing with exact sourceRecordIds and items', () => {
        const events: BriefingModelSafeEvent[] = [
          {
            ordinal: 0,
            dayOrdinal: 0,
            period: 'morning',
            text: 'Morning walk',
            mediaKinds: ['photo'],
          },
          {
            ordinal: 1,
            dayOrdinal: 0,
            period: 'evening',
            text: '',
            mediaKinds: ['video'],
          },
          {
            ordinal: 2,
            dayOrdinal: 1,
            period: 'afternoon',
            text: 'Afternoon coffee',
            mediaKinds: ['voice'],
          },
        ];
        const sources: BriefingSourceMapping[] = [
          { ordinal: 0, recordId: 'rec-en-1' },
          { ordinal: 1, recordId: 'rec-en-2' },
          { ordinal: 2, recordId: 'rec-en-3' },
        ];
        const days: BriefingDayMapping[] = [
          { dayOrdinal: 0, date: '2026-08-26' },
          { dayOrdinal: 1, date: '2026-08-27' },
        ];

        const briefing = generateDeterministicPartnerBriefing({
          events,
          sources,
          days,
          locale: 'en',
        });

        expect(briefing.version).toBe(1);
        expect(briefing.sourceCount).toBe(3);
        expect(briefing.generation).toBe('deterministic');
        expect(briefing.rangeLabel).toBe('August 26 – August 27');
        expect(briefing.overview.text).toBe(
          'Over 2 days: 3 records (1 photo, 1 video, 1 voice note) in total.',
        );
        expect(briefing.overview.sourceRecordIds).toEqual([
          'rec-en-1',
          'rec-en-2',
          'rec-en-3',
        ]);

        expect(briefing.days).toHaveLength(2);
        expect(briefing.days[0].date).toBe('2026-08-26');
       expect(briefing.days[0].sections).toHaveLength(2);
       expect(briefing.days[0].sections[0].items).toEqual([
         {
            parts: [
              {
                text: 'They wrote: “Morning walk”',
                sourceRecordId: 'rec-en-1',
              },
            ],
         },
       ]);
       expect(briefing.days[0].sections[1].items).toEqual([
         {
            parts: [
              {
                text: 'Shared 1 video.',
                sourceRecordId: 'rec-en-2',
              },
            ],
         },
       ]);
       expect(briefing.days[1].date).toBe('2026-08-27');
       expect(briefing.days[1].sections[0].items).toEqual([
         {
            parts: [
              {
                text: 'They wrote: “Afternoon coffee”',
                sourceRecordId: 'rec-en-3',
              },
            ],
         },
       ]);
      });
    });

    describe('Absence of Military Terminology in English Templates', () => {
      it('ensures fixed English templates contain zero military-specific terminology', () => {
        const militaryForbiddenTerms = [
          'soldier',
          'military',
          'barracks',
          'enlistment',
          'discharge',
          'garrison',
          'cadet',
          'salute',
          'roll call',
          'taps',
          'battalion',
          'brigade',
          'regiment',
          'corps',
          'unit',
          'post',
          'duty',
          'service member',
        ];

        const sampleOutputs = [
          formatAttributedBriefingItemText('Test note', 'en'),
          formatMediaItemText([], 'en'),
          formatMediaItemText(['photo', 'video', 'voice'], 'en'),
          formatFallbackPeriodText(
            [{ ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'hi', mediaKinds: ['photo'] }],
            'en',
          ),
          formatFallbackOverviewText(
            [{ ordinal: 0, dayOrdinal: 0, period: 'morning', text: 'hi', mediaKinds: ['photo'] }],
            2,
            'en',
          ),
          formatRangeLabelFromDates(['2026-08-26', '2026-08-27'], 'en'),
        ];

        for (const output of sampleOutputs) {
          const lower = output.toLowerCase();
          for (const term of militaryForbiddenTerms) {
            expect(lower).not.toContain(term);
          }
        }
      });
    });
  });
  /*
    A day is a sequence, not a set of period buckets.

    Sections used to be keyed by period in a Map, so all of a day's `night` records
    collapsed into one section wherever they sat. `night` spans BOTH ends of the clock
    (00:00-04:59 and 22:00-23:59), so a day of 00:30 / 09:00 / 22:30 produced
    night(00:30 + 22:30) followed by morning(09:00) -- Map insertion order put the night
    section first, so a 22:30 record was displayed above the 09:00 one it came eight
    hours after, fused into the same section as a record from the previous night.
  */
  describe('chronological contiguous period runs', () => {
    function midnightSpanningEvents(): BriefingModelSafeEvent[] {
      return [
        { ordinal: 0, dayOrdinal: 0, period: 'night', text: '새벽 근무 교대', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 0, period: 'morning', text: '오전 점호 완료', mediaKinds: [] },
        { ordinal: 2, dayOrdinal: 0, period: 'night', text: '늦은 밤 점검', mediaKinds: [] },
      ];
    }

    const sources: BriefingSourceMapping[] = [
      { ordinal: 0, recordId: 'rec-0030' },
      { ordinal: 1, recordId: 'rec-0900' },
      { ordinal: 2, recordId: 'rec-2230' },
    ];
    const days: BriefingDayMapping[] = [{ dayOrdinal: 0, date: '2026-08-26' }];

    it('keeps 00:30 night, 09:00 morning and 22:30 night as three separate sections', () => {
      const briefing = generateDeterministicPartnerBriefing({
        events: midnightSpanningEvents(),
        sources,
        days,
      });

      const sections = briefing.days[0].sections;
      expect(sections.map((s) => s.period)).toEqual(['night', 'morning', 'night']);
      expect(sections.map((s) => s.items.length)).toEqual([1, 1, 1]);

      // Each run holds exactly its own record, in the order the day happened.
      expect(
        sections.map((s) => s.items.flatMap((i) => i.parts.map((p) => p.sourceRecordId))),
      ).toEqual([['rec-0030'], ['rec-0900'], ['rec-2230']]);
    });

    it('still merges genuinely adjacent same-period records into one run', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'night', text: '새벽 1', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 0, period: 'night', text: '새벽 2', mediaKinds: [] },
        { ordinal: 2, dayOrdinal: 0, period: 'morning', text: '오전', mediaKinds: [] },
      ];

      const briefing = generateDeterministicPartnerBriefing({
        events,
        sources,
        days,
      });

      const sections = briefing.days[0].sections;
      expect(sections.map((s) => s.period)).toEqual(['night', 'morning']);
      expect(sections[0].items).toHaveLength(2);
    });

    it('preserves total source coverage and order across the runs', () => {
      const briefing = generateDeterministicPartnerBriefing({
        events: midnightSpanningEvents(),
        sources,
        days,
      });

      const rendered = briefing.days
        .flatMap((day) => day.sections)
        .flatMap((section) => section.items)
        .flatMap((item) => item.parts.map((part) => part.sourceRecordId));

      expect(rendered).toEqual(['rec-0030', 'rec-0900', 'rec-2230']);
      expect(briefing.overview.sourceRecordIds).toEqual([
        'rec-0030',
        'rec-0900',
        'rec-2230',
      ]);
      expect(briefing.sourceCount).toBe(3);
    });

    it('cuts runs per day, so the same period on two days never fuses', () => {
      const events: BriefingModelSafeEvent[] = [
        { ordinal: 0, dayOrdinal: 0, period: 'night', text: '26일 밤', mediaKinds: [] },
        { ordinal: 1, dayOrdinal: 1, period: 'night', text: '27일 밤', mediaKinds: [] },
      ];

      const briefing = generateDeterministicPartnerBriefing({
        events,
        sources: [
          { ordinal: 0, recordId: 'rec-d0' },
          { ordinal: 1, recordId: 'rec-d1' },
        ],
        days: [
          { dayOrdinal: 0, date: '2026-08-26' },
          { dayOrdinal: 1, date: '2026-08-27' },
        ],
      });

      expect(briefing.days).toHaveLength(2);
      expect(briefing.days[0].sections.map((s) => s.period)).toEqual(['night']);
      expect(briefing.days[1].sections.map((s) => s.period)).toEqual(['night']);
    });

    it('exposes runs whose period value repeats, so period is not a unique key', () => {
      const runsByDay = groupEventsIntoChronologicalRuns(midnightSpanningEvents());
      const dayRuns = runsByDay.get(0)!;

      expect(dayRuns).toHaveLength(3);
      expect(dayRuns.map((r) => r.period)).toEqual(['night', 'morning', 'night']);
      // Explicitly: the period strings collide. Any consumer keying on them must add
      // position, which `PartnerBriefingCard` now does.
      expect(new Set(dayRuns.map((r) => r.period)).size).toBeLessThan(dayRuns.length);
    });
  });

});
