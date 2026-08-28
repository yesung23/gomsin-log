import { describe, expect, it } from 'vitest';
import type {
  BriefingModelSafeEvent,
  BriefingSourceMapping,
} from './contract';
import type { BriefingDayMapping } from './normalize';
import {
  formatDateKorean,
  formatFallbackOverviewText,
  formatFallbackPeriodText,
  formatMediaCounts,
  formatRangeLabelFromDates,
  generateDeterministicPartnerBriefing,
  validateBriefingMappings,
} from './fallback';

describe('Partner Briefing Deterministic Fallback (Gate A7)', () => {
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
        { ordinal: 2, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] }, // Gap!
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
        { ordinal: 1, dayOrdinal: 0, period: 'morning', text: 'b', mediaKinds: [] }, // Decreasing dayOrdinal
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
        { ordinal: 1, recordId: 'rec-same-id' }, // Duplicate recordId
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
        { dayOrdinal: 1, date: '2026-08-26' }, // Same date for different dayOrdinals
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
        { dayOrdinal: 1, date: '2026-08-26' }, // Descending date
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

  describe('generateDeterministicPartnerBriefing', () => {
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

    it('generates multi-day, multi-period deterministic briefing with exact sourceRecordIds', () => {
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
      expect(briefing.days[0].sections[0]).toEqual({
        period: 'morning',
        text: '기록 1개 (사진 1장)',
        sourceRecordIds: ['rec-day1-morning'],
      });
      expect(briefing.days[0].sections[1]).toEqual({
        period: 'evening',
        text: '기록 1개',
        sourceRecordIds: ['rec-day1-evening'],
      });

      expect(briefing.days[1].date).toBe('2026-08-27');
      expect(briefing.days[1].sections).toHaveLength(1);
      expect(briefing.days[1].sections[0]).toEqual({
        period: 'afternoon',
        text: '기록 1개 (음성 1개)',
        sourceRecordIds: ['rec-day2-afternoon'],
      });
    });
  });
});
