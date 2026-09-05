import { describe, expect, it } from 'vitest';
import type { Attachment, DailyRecord } from '@/types';
import type { BriefingModelSafeEvent, BriefingPeriod } from './contract';
import {
  compareBriefingTime,
  getBriefingPeriod,
  isValidDateString,
  isValidRecordId,
  isValidTimeString,
  normalizeBriefingText,
  normalizePartnerBriefingCorpus,
  parseBriefingTime,
  projectBriefingMediaKinds,
  type BriefingDayMapping,
  type BriefingNormalizeRejectionReason,
  type BriefingNormalizeResult,
} from './normalize';

function makeValidRecord(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec_100',
    userId: 'partner_user_456',
    date: '2026-08-28',
    time: '14:30',
    authorRole: 'soldier',
    log: '오후 사격 훈련 마침',
    isPrivate: false,
    createdAt: '2026-08-28T05:30:00.000Z',
    ...overrides,
  };
}

describe('Partner Briefing Normalizer (Phase A3)', () => {
  describe('Type Invariants and Discriminated Union', () => {
    it('pins rejection reasons strictly to invalid_id | invalid_date | invalid_time', () => {
      type ExpectedReasons = 'invalid_id' | 'invalid_date' | 'invalid_time';
      type ReasonsCoversExpected = [ExpectedReasons] extends [BriefingNormalizeRejectionReason] ? true : false;
      type ReasonsHasNoExtra = [BriefingNormalizeRejectionReason] extends [ExpectedReasons] ? true : false;
      type ReasonsExact = ReasonsCoversExpected extends true
        ? ReasonsHasNoExtra extends true
          ? true
          : false
        : false;

      const isReasonsExact: ReasonsExact = true;
      expect(isReasonsExact).toBe(true);
    });

    it('pins BriefingDayMapping keys strictly to dayOrdinal and date', () => {
      type DayMappingKeys = keyof BriefingDayMapping;
      type ExpectedKeys = 'dayOrdinal' | 'date';
      type KeysExact = [ExpectedKeys] extends [DayMappingKeys]
        ? [DayMappingKeys] extends [ExpectedKeys]
          ? true
          : false
        : false;

      const isKeysExact: KeysExact = true;
      expect(isKeysExact).toBe(true);
    });
  });

  describe('Helper: isValidRecordId', () => {
    it('accepts valid non-empty string IDs', () => {
      expect(isValidRecordId('rec_123')).toBe(true);
      expect(isValidRecordId('1')).toBe(true);
      expect(isValidRecordId('uuid-v4-abcd-ef01')).toBe(true);
    });

    it('rejects empty, whitespace-only, or non-string IDs', () => {
      expect(isValidRecordId('')).toBe(false);
      expect(isValidRecordId('   ')).toBe(false);
      expect(isValidRecordId('\t\n')).toBe(false);
      expect(isValidRecordId(null)).toBe(false);
      expect(isValidRecordId(undefined)).toBe(false);
      expect(isValidRecordId(123)).toBe(false);
      expect(isValidRecordId({})).toBe(false);
    });
  });

  describe('Helper: isValidDateString', () => {
    it('accepts valid YYYY-MM-DD calendar dates', () => {
      expect(isValidDateString('2026-08-28')).toBe(true);
      expect(isValidDateString('2024-02-29')).toBe(true);
      expect(isValidDateString('2026-01-01')).toBe(true);
      expect(isValidDateString('2026-12-31')).toBe(true);
    });

    it('rejects malformed date formats', () => {
      expect(isValidDateString('2026-8-28')).toBe(false);
      expect(isValidDateString('2026/08/28')).toBe(false);
      expect(isValidDateString('2026-08-28T00:00:00.000Z')).toBe(false);
      expect(isValidDateString('20260828')).toBe(false);
      expect(isValidDateString('not-a-date')).toBe(false);
      expect(isValidDateString('')).toBe(false);
      expect(isValidDateString(null)).toBe(false);
      expect(isValidDateString(undefined)).toBe(false);
    });

    it('rejects impossible calendar dates fail-closed', () => {
      expect(isValidDateString('2026-02-30')).toBe(false);
      expect(isValidDateString('2025-02-29')).toBe(false);
      expect(isValidDateString('2026-04-31')).toBe(false);
      expect(isValidDateString('2026-06-31')).toBe(false);
      expect(isValidDateString('2026-09-31')).toBe(false);
      expect(isValidDateString('2026-11-31')).toBe(false);
      expect(isValidDateString('2026-00-15')).toBe(false);
      expect(isValidDateString('2026-13-01')).toBe(false);
      expect(isValidDateString('2026-05-00')).toBe(false);
      expect(isValidDateString('2026-05-32')).toBe(false);
    });
  });

  describe('Helper: isValidTimeString', () => {
    it('accepts valid HH:mm 24h time strings', () => {
      expect(isValidTimeString('00:00')).toBe(true);
      expect(isValidTimeString('04:59')).toBe(true);
      expect(isValidTimeString('05:00')).toBe(true);
      expect(isValidTimeString('11:59')).toBe(true);
      expect(isValidTimeString('12:00')).toBe(true);
      expect(isValidTimeString('17:59')).toBe(true);
      expect(isValidTimeString('18:00')).toBe(true);
      expect(isValidTimeString('21:59')).toBe(true);
      expect(isValidTimeString('22:00')).toBe(true);
      expect(isValidTimeString('23:59')).toBe(true);
    });

    // A `time` column read through PostgREST comes back as HH:mm:ss, and with a fraction
    // when the column has sub-second precision. Rejecting those failed the entire corpus
    // closed for any couple whose records were written before the client normalized to HH:mm.
    it('accepts PostgreSQL TIME HH:mm:ss and HH:mm:ss.fraction values', () => {
      expect(isValidTimeString('09:07:00')).toBe(true);
      expect(isValidTimeString('09:07:33')).toBe(true);
      expect(isValidTimeString('00:00:00')).toBe(true);
      expect(isValidTimeString('23:59:59')).toBe(true);
      expect(isValidTimeString('12:41:12.213424')).toBe(true);
      expect(isValidTimeString('12:41:12.5')).toBe(true);
      expect(isValidTimeString('12:41:12.000000')).toBe(true);
    });

    // PostgreSQL stores `time` as microseconds since midnight, so one to six digits is
    // the entire range a `time` column can emit. Seven is not a more precise reading of
    // the same column; it is a value from somewhere else, and it must not pass silently.
    it('accepts one to six fractional digits and rejects a seventh', () => {
      expect(isValidTimeString('12:41:12.1')).toBe(true);
      expect(isValidTimeString('12:41:12.12')).toBe(true);
      expect(isValidTimeString('12:41:12.123')).toBe(true);
      expect(isValidTimeString('12:41:12.1234')).toBe(true);
      expect(isValidTimeString('12:41:12.12345')).toBe(true);
      expect(isValidTimeString('12:41:12.123456')).toBe(true);

      expect(isValidTimeString('12:41:12.1234567')).toBe(false);
      expect(isValidTimeString('12:41:12.0000000')).toBe(false);
      // Previously accepted by an unbounded `\d+`; a `time` column cannot produce it.
      expect(isValidTimeString('12:41:12.123456789012')).toBe(false);
    });

    it('rejects invalid or out-of-range times', () => {
      expect(isValidTimeString('24:00')).toBe(false);
      expect(isValidTimeString('12:60')).toBe(false);
      expect(isValidTimeString('9:00')).toBe(false);
      expect(isValidTimeString('12:0')).toBe(false);
      expect(isValidTimeString('12')).toBe(false);
      expect(isValidTimeString('')).toBe(false);
      expect(isValidTimeString('   ')).toBe(false);
      expect(isValidTimeString(null)).toBe(false);
      expect(isValidTimeString(undefined)).toBe(false);
    });

    it('range-checks every component of the extended forms', () => {
      expect(isValidTimeString('24:00:00')).toBe(false);
      expect(isValidTimeString('9:00:00')).toBe(false);
      expect(isValidTimeString('12:60:00')).toBe(false);
      expect(isValidTimeString('12:00:60')).toBe(false);
      expect(isValidTimeString('12:00:99')).toBe(false);
      expect(isValidTimeString('99:99:99')).toBe(false);
    });

    it('rejects an empty or non-numeric fraction', () => {
      expect(isValidTimeString('12:00:00.')).toBe(false);
      expect(isValidTimeString('12:00:00.abc')).toBe(false);
      expect(isValidTimeString('12:00.500')).toBe(false);
      expect(isValidTimeString('12:00:00,500')).toBe(false);
    });

    // A `time with time zone` value has no single meaning on the client, so it must fail
    // closed rather than be silently reinterpreted as a local wall-clock time.
    it('rejects any timezone suffix', () => {
      expect(isValidTimeString('12:00:00Z')).toBe(false);
      expect(isValidTimeString('12:00:00+09')).toBe(false);
      expect(isValidTimeString('12:00:00+09:00')).toBe(false);
      expect(isValidTimeString('12:00:00-05:00')).toBe(false);
      expect(isValidTimeString('12:00:00.213424Z')).toBe(false);
      expect(isValidTimeString('12:00+09:00')).toBe(false);
      expect(isValidTimeString(' 12:00:00')).toBe(false);
      expect(isValidTimeString('12:00:00 ')).toBe(false);
    });
  });

  describe('Helper: parseBriefingTime canonicalization', () => {
    it('canonicalizes all three accepted forms to the same HH:mm', () => {
      expect(parseBriefingTime('09:07')?.canonical).toBe('09:07');
      expect(parseBriefingTime('09:07:00')?.canonical).toBe('09:07');
      expect(parseBriefingTime('09:07:33')?.canonical).toBe('09:07');
      expect(parseBriefingTime('12:41:12.213424')?.canonical).toBe('12:41');
    });

    it('parses components exactly and strips only trailing fraction zeros', () => {
      expect(parseBriefingTime('09:07')).toEqual({
        canonical: '09:07',
        hour: 9,
        minute: 7,
        second: 0,
        fraction: '',
      });
      expect(parseBriefingTime('09:07:33')).toEqual({
        canonical: '09:07',
        hour: 9,
        minute: 7,
        second: 33,
        fraction: '',
      });
      expect(parseBriefingTime('12:41:12.213424')).toEqual({
        canonical: '12:41',
        hour: 12,
        minute: 41,
        second: 12,
        fraction: '213424',
      });
      expect(parseBriefingTime('12:41:12.000000')?.fraction).toBe('');
      expect(parseBriefingTime('12:41:12.500000')?.fraction).toBe('5');
      expect(parseBriefingTime('12:41:12.010')?.fraction).toBe('01');
    });

    it('never truncates an over-precise fraction into a valid one', () => {
      // The danger of a cap is silent truncation: `.1234567` must not become `.123456`.
      expect(parseBriefingTime('12:41:12.1234567')).toBeNull();
      expect(parseBriefingTime('12:41:12.123456')?.fraction).toBe('123456');
    });

    it('returns null for every rejected form', () => {
      expect(parseBriefingTime('9:00')).toBeNull();
      expect(parseBriefingTime('24:00:00')).toBeNull();
      expect(parseBriefingTime('12:60:00')).toBeNull();
      expect(parseBriefingTime('12:00:60')).toBeNull();
      expect(parseBriefingTime('12:00:00+09:00')).toBeNull();
      expect(parseBriefingTime('12:00:00.')).toBeNull();
      expect(parseBriefingTime('12:00:00.1234567')).toBeNull();
      expect(parseBriefingTime(null)).toBeNull();
      expect(parseBriefingTime(undefined)).toBeNull();
      expect(parseBriefingTime(1430)).toBeNull();
    });
  });

  describe('Helper: compareBriefingTime instant ordering', () => {
    function at(time: string) {
      const parsed = parseBriefingTime(time);
      if (parsed === null) throw new Error(`unexpectedly invalid test time: ${time}`);
      return parsed;
    }

    it('treats HH:mm and HH:mm:00 as the same instant', () => {
      expect(compareBriefingTime(at('09:07'), at('09:07:00'))).toBe(0);
      expect(compareBriefingTime(at('09:07:00'), at('09:07'))).toBe(0);
      expect(compareBriefingTime(at('09:07'), at('09:07:00.000000'))).toBe(0);
    });

    it('orders by seconds and by fractional seconds', () => {
      expect(compareBriefingTime(at('09:07'), at('09:07:01'))).toBe(-1);
      expect(compareBriefingTime(at('09:07:01'), at('09:07'))).toBe(1);
      expect(compareBriefingTime(at('09:07:33'), at('09:07:34'))).toBe(-1);
      expect(compareBriefingTime(at('12:41:12.1'), at('12:41:12.2'))).toBe(-1);
    });

    it('compares fractions of differing precision without truncating', () => {
      expect(compareBriefingTime(at('12:41:12.09'), at('12:41:12.1'))).toBe(-1);
      expect(compareBriefingTime(at('12:41:12.5'), at('12:41:12.50'))).toBe(0);
      expect(compareBriefingTime(at('12:41:12.213424'), at('12:41:12.213425'))).toBe(-1);
      // Differing precision, both within the six-digit limit: '2135' padded to '213500'
      // sorts after '213424', which a raw length-first compare would get wrong.
      expect(compareBriefingTime(at('12:41:12.2135'), at('12:41:12.213424'))).toBe(1);
      expect(compareBriefingTime(at('12:41:12.213424'), at('12:41:12.2135'))).toBe(-1);
    });

    it('orders hours and minutes ahead of seconds', () => {
      expect(compareBriefingTime(at('09:07:59'), at('09:08'))).toBe(-1);
      expect(compareBriefingTime(at('09:59:59'), at('10:00'))).toBe(-1);
    });
  });

  describe('Helper: getBriefingPeriod and all period boundaries', () => {
    const periodBoundaries: Array<{ time: string; expected: BriefingPeriod }> = [
      { time: '00:00', expected: 'night' },
      { time: '02:30', expected: 'night' },
      { time: '04:59', expected: 'night' },
      { time: '05:00', expected: 'morning' },
      { time: '08:30', expected: 'morning' },
      { time: '11:59', expected: 'morning' },
      { time: '12:00', expected: 'afternoon' },
      { time: '15:45', expected: 'afternoon' },
      { time: '17:59', expected: 'afternoon' },
      { time: '18:00', expected: 'evening' },
      { time: '20:15', expected: 'evening' },
      { time: '21:59', expected: 'evening' },
      { time: '22:00', expected: 'night' },
      { time: '23:30', expected: 'night' },
      { time: '23:59', expected: 'night' },
      // Seconds and fractional seconds must never move a record across a period boundary.
      { time: '04:59:59', expected: 'night' },
      { time: '11:59:59.999999', expected: 'morning' },
      { time: '17:59:59', expected: 'afternoon' },
      { time: '21:59:59.5', expected: 'evening' },
      { time: '23:59:59.999999', expected: 'night' },
    ];

    it.each(periodBoundaries)(
      'correctly maps time $time to period $expected',
      ({ time, expected }) => {
        expect(getBriefingPeriod(time)).toBe(expected);
      },
    );

    // A prefix slice of the first two characters returns the correct hour for every VALID
    // time, so only invalid input distinguishes "parse, then read the hour" from "slice and
    // hope". These cases pin that the helper never invents an hour from a string it has not
    // validated -- 9:00 would slice to 9 and 12:00:00+09:00 to 12.
    it('does not derive a period from an unvalidated time string', () => {
      expect(getBriefingPeriod('9:00')).toBe('night');
      expect(getBriefingPeriod('9:00')).not.toBe('morning');
      expect(getBriefingPeriod('12:00:00+09:00')).toBe('night');
      expect(getBriefingPeriod('12:00:00+09:00')).not.toBe('afternoon');
      expect(getBriefingPeriod('24:00')).toBe('night');
      expect(getBriefingPeriod('19시 30분')).toBe('night');
      expect(getBriefingPeriod('19시 30분')).not.toBe('evening');
      expect(getBriefingPeriod('')).toBe('night');
    });

    it('buckets a record identically whatever precision its time arrives in', () => {
      for (const [minute, seconds] of [
        ['05:00', '05:00:00'],
        ['12:00', '12:00:00.000000'],
        ['18:00', '18:00:59'],
        ['22:00', '22:00:12.213424'],
      ] as const) {
        expect(getBriefingPeriod(seconds)).toBe(getBriefingPeriod(minute));
      }
    });
  });

  describe('Helper: normalizeBriefingText', () => {
    it('collapses control and separator whitespace to single spaces and trims', () => {
      const raw = '  오늘   \t\t 오전 훈련 \n\n  무사히   마침! \r\n  ';
      expect(normalizeBriefingText(raw)).toBe('오늘 오전 훈련 무사히 마침!');
    });

    it('handles empty, whitespace-only, or missing logs without adding fallback prose', () => {
      expect(normalizeBriefingText('')).toBe('');
      expect(normalizeBriefingText('   \n\t  ')).toBe('');
      expect(normalizeBriefingText(undefined)).toBe('');
      expect(normalizeBriefingText(null)).toBe('');
    });

    it('collapses U+200B zero-width space and U+200E/U+200F directional marks as separators while preserving U+200C ZWNJ and U+200D ZWJ', () => {
      // U+200B (ZERO WIDTH SPACE) -> separator collapsed to single space or trimmed
      expect(normalizeBriefingText('오늘​훈련​완료')).toBe('오늘 훈련 완료');
      expect(normalizeBriefingText('​​시작​​')).toBe('시작');

      // U+200E (LEFT-TO-RIGHT MARK) & U+200F (RIGHT-TO-LEFT MARK) -> separators collapsed to single space or trimmed
      expect(normalizeBriefingText('오전‎사격‏훈련')).toBe('오전 사격 훈련');
      expect(normalizeBriefingText('‎단어‏')).toBe('단어');

      // Mixed invisible separator sequences
      expect(normalizeBriefingText('단어1​‎‏단어2')).toBe('단어1 단어2');

      // U+200C (ZWNJ) -> preserved without space insertion
      const zwnjText = 'test‌value';
      expect(normalizeBriefingText(zwnjText)).toBe('test‌value');
      expect(normalizeBriefingText(zwnjText)).toContain('‌');

      // U+200D (ZWJ) -> preserved without space insertion (e.g. emoji ligature)
      const zwjText = '우리 가족 👨‍👩‍👧‍👦 모두 건강해';
      expect(normalizeBriefingText(zwjText)).toBe('우리 가족 👨‍👩‍👧‍👦 모두 건강해');
      expect(normalizeBriefingText(zwjText)).toContain('‍');
    });

    it('preserves complex grapheme sequences, ZWJ/ZWNJ emoji sequences, and NFD decomposed combining characters', () => {
      const zwjText = '우리 가족 👨‍👩‍👧‍👦 모두 건강해';
      expect(normalizeBriefingText(zwjText)).toBe('우리 가족 👨‍👩‍👧‍👦 모두 건강해');
      expect(normalizeBriefingText(zwjText)).toContain('\u200D');

      const zwnjText = 'test\u200Cvalue';
      expect(normalizeBriefingText(zwnjText)).toBe('test\u200Cvalue');
      expect(normalizeBriefingText(zwnjText)).toContain('\u200C');

      const nfdCombining = 'cafe\u0301 menu';
      expect(normalizeBriefingText(nfdCombining)).toBe('cafe\u0301 menu');
      expect(normalizeBriefingText(nfdCombining)).toContain('\u0301');

      const nfdHangul = '\u1100\u1161\u11A8\u1109\u1161\u11A8';
      expect(normalizeBriefingText(nfdHangul)).toBe('\u1100\u1161\u11A8\u1109\u1161\u11A8');
    });

    it('does NOT truncate or summarize long log strings', () => {
      const longLog = '가나다라마바사 '.repeat(500).trim();
      const normalized = normalizeBriefingText(longLog);
      expect(normalized).toHaveLength(longLog.length);
    });
  });

  describe('Helper: projectBriefingMediaKinds', () => {
    it('projects photo, video, and voice attachments', () => {
      const attachments: Attachment[] = [
        { type: 'photo', name: 'photo1.jpg', url: 'https://cdn.example.com/1.jpg' },
        { type: 'video', name: 'video1.mp4', path: 'storage/v1.mp4' },
        { type: 'voice', name: 'voice1.m4a' },
      ];

      expect(projectBriefingMediaKinds(attachments)).toEqual(['photo', 'video', 'voice']);
    });

    it('deduplicates media kinds while preserving first occurrence order', () => {
      const attachments: Attachment[] = [
        { type: 'photo', name: 'p1.jpg' },
        { type: 'video', name: 'v1.mp4' },
        { type: 'photo', name: 'p2.jpg' },
        { type: 'photo', name: 'p3.jpg' },
        { type: 'voice', name: 'a1.m4a' },
        { type: 'video', name: 'v2.mp4' },
      ];

      expect(projectBriefingMediaKinds(attachments)).toEqual(['photo', 'video', 'voice']);
    });

    it('ignores unknown attachment types and malformed objects without throwing', () => {
      const attachments = [
        { type: 'photo', name: 'p1.jpg' },
        { type: 'document', name: 'doc.pdf' },
        null,
        { type: 'voice', name: 'audio.m4a' },
        { type: 'unknown_kind', name: 'file.bin' },
      ] as unknown as Attachment[];

      expect(projectBriefingMediaKinds(attachments)).toEqual(['photo', 'voice']);
    });

    it('returns an empty array when attachments are empty, undefined, or null', () => {
      expect(projectBriefingMediaKinds([])).toEqual([]);
      expect(projectBriefingMediaKinds(undefined)).toEqual([]);
      expect(projectBriefingMediaKinds(null)).toEqual([]);
    });
  });

  describe('Corpus Normalization (Phase A3 Core)', () => {
    it('normalizes 0 records into empty events, sources, and days', () => {
      const result = normalizePartnerBriefingCorpus([]);
      expect(result).toEqual({
        ok: true,
        events: [],
        sources: [],
        days: [],
      });
    });

    it('normalizes exactly 1 valid record', () => {
      const record = makeValidRecord({
        id: 'rec_single',
        date: '2026-08-28',
        time: '08:30',
        log: '  단일 기록  로그  ',
        attachments: [{ type: 'photo', name: '1.jpg', url: 'https://cdn.example.com/p.jpg' }],
      });

      const result = normalizePartnerBriefingCorpus([record]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events).toEqual([
          {
            ordinal: 0,
            dayOrdinal: 0,
            period: 'morning',
            text: '단일 기록 로그',
            mediaKinds: ['photo'],
          },
        ]);
        expect(result.sources).toEqual([
          {
            ordinal: 0,
            recordId: 'rec_single',
          },
        ]);
        expect(result.days).toEqual([
          {
            dayOrdinal: 0,
            date: '2026-08-28',
          },
        ]);
      }
    });

    it('sorts chronologically ascending by date then time', () => {
      const recEvening = makeValidRecord({ id: 'rec_eve', date: '2026-08-28', time: '19:00', log: '저녁' });
      const recMorning = makeValidRecord({ id: 'rec_morn', date: '2026-08-28', time: '07:30', log: '아침' });
      const recAfternoon = makeValidRecord({ id: 'rec_aft', date: '2026-08-28', time: '13:15', log: '오후' });
      const recDayBefore = makeValidRecord({ id: 'rec_prev', date: '2026-08-27', time: '22:00', log: '어제 밤' });

      const input = [recEvening, recMorning, recAfternoon, recDayBefore];
      const result = normalizePartnerBriefingCorpus(input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources.map((s) => s.recordId)).toEqual([
          'rec_prev',
          'rec_morn',
          'rec_aft',
          'rec_eve',
        ]);
        expect(result.events.map((e) => e.period)).toEqual([
          'night',
          'morning',
          'afternoon',
          'evening',
        ]);
      }
    });

    it('stably tie-breaks same date and same time by record ID in ascending order', () => {
      const recZ = makeValidRecord({ id: 'rec_z', date: '2026-08-28', time: '10:00', log: 'Z' });
      const recA = makeValidRecord({ id: 'rec_a', date: '2026-08-28', time: '10:00', log: 'A' });
      const recM = makeValidRecord({ id: 'rec_m', date: '2026-08-28', time: '10:00', log: 'M' });

      const result = normalizePartnerBriefingCorpus([recZ, recA, recM]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources).toEqual([
          { ordinal: 0, recordId: 'rec_a' },
          { ordinal: 1, recordId: 'rec_m' },
          { ordinal: 2, recordId: 'rec_z' },
        ]);
        expect(result.events.map((e) => e.ordinal)).toEqual([0, 1, 2]);
        expect(result.events.map((e) => e.text)).toEqual(['A', 'M', 'Z']);
      }
    });

    it('assigns multi-day dayOrdinal ascending and constructs JS-only exact date mapping', () => {
      const r1 = makeValidRecord({ id: 'r1', date: '2026-08-26', time: '09:00' });
      const r2 = makeValidRecord({ id: 'r2', date: '2026-08-26', time: '20:00' });
      const r3 = makeValidRecord({ id: 'r3', date: '2026-08-27', time: '12:00' });
      const r4 = makeValidRecord({ id: 'r4', date: '2026-08-28', time: '06:00' });
      const r5 = makeValidRecord({ id: 'r5', date: '2026-08-28', time: '18:00' });

      const result = normalizePartnerBriefingCorpus([r4, r1, r5, r3, r2]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.days).toEqual([
          { dayOrdinal: 0, date: '2026-08-26' },
          { dayOrdinal: 1, date: '2026-08-27' },
          { dayOrdinal: 2, date: '2026-08-28' },
        ]);
        expect(result.events.map((e) => e.dayOrdinal)).toEqual([0, 0, 1, 2, 2]);
        expect(result.events.map((e) => e.ordinal)).toEqual([0, 1, 2, 3, 4]);
      }
    });

    it('retains empty text and empty media record without dropping it', () => {
      const emptyRecord = makeValidRecord({
        id: 'rec_empty',
        log: '   ',
        attachments: [],
      });

      const result = normalizePartnerBriefingCorpus([emptyRecord]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toEqual({
          ordinal: 0,
          dayOrdinal: 0,
          period: 'afternoon',
          text: '',
          mediaKinds: [],
        });
        expect(result.sources).toEqual([{ ordinal: 0, recordId: 'rec_empty' }]);
      }
    });

    it('retains 100+ valid records with exact 1-to-1 event and source coverage', () => {
      const totalCount = 120;
      const records: DailyRecord[] = Array.from({ length: totalCount }, (_, i) => {
        const day = 20 + Math.floor(i / 30);
        const hour = String(i % 24).padStart(2, '0');
        const minute = String((i * 7) % 60).padStart(2, '0');
        return makeValidRecord({
          id: 'rec_' + String(i).padStart(3, '0'),
          date: '2026-08-' + String(day),
          time: hour + ':' + minute,
          log: '기록 ' + String(i),
          attachments: i % 2 === 0 ? [{ type: 'photo', name: 'p.jpg' }] : [],
        });
      });

      const result = normalizePartnerBriefingCorpus(records);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events).toHaveLength(totalCount);
        expect(result.sources).toHaveLength(totalCount);

        for (let i = 0; i < totalCount; i += 1) {
          expect(result.events[i].ordinal).toBe(i);
          expect(result.sources[i].ordinal).toBe(i);
          expect(result.sources[i].recordId).toBeDefined();
        }
      }
    });
  });

  describe('Security and Serialization Hygiene (Zero Leaked Metadata)', () => {
    it('produces model events with exact allowlist keys { ordinal, dayOrdinal, period, text, mediaKinds }', () => {
      const record = makeValidRecord({
        id: 'rec_secret_123',
        userId: 'partner_user_456',
        date: '2026-08-28',
        time: '14:00',
        log: '보안 검증 로그',
        attachments: [{ type: 'photo', url: 'https://secret.supabase.co/img.jpg', name: 'secret.jpg' }],
      });

      const result = normalizePartnerBriefingCorpus([record]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const event = result.events[0];
        const keys = Object.keys(event).sort();
        expect(keys).toEqual(['dayOrdinal', 'mediaKinds', 'ordinal', 'period', 'text']);
      }
    });

    it('guarantees serialized model event payload contains no system IDs, dates, times, URLs, paths, or emotion data', () => {
      const fullRecord: DailyRecord = {
        id: 'record_id_secret_999',
        userId: 'user_id_partner_777',
        date: '2026-08-28',
        time: '15:30',
        authorRole: 'soldier',
        log: '오늘 훈련 후 휴식',
        reaction: 'good',
        isPrivate: false,
        isProfilePost: true,
        talkAbout: true,
        emotionFlow: [
          {
            id: 'ef_1',
            sequence: 1,
            group: 'joy',
            displayLabel: '기쁨',
            visibility: 'shared',
          },
        ],
        emotionAnalysis: {
          primaryEmotion: 'joy',
          confidence: 0.95,
          flowList: [],
          emotionPath: '기쁨',
          emotionSummary: '좋았음',
        },
        attachments: [
          {
            type: 'photo',
            name: 'sensitive_filename.jpg',
            url: 'https://supabase.co/storage/v1/object/authenticated/couple/photo.jpg',
            path: 'couples/couple_123/records/photo.jpg',
          },
          {
            type: 'voice',
            name: 'voice_memo.m4a',
            url: 'https://supabase.co/storage/voice.m4a',
          },
        ],
        createdAt: '2026-08-28T06:30:00.000Z',
      };

      const result = normalizePartnerBriefingCorpus([fullRecord]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const serialized = JSON.stringify(result.events);

        // Forbidden IDs and system fields
        expect(serialized).not.toContain('record_id_secret_999');
        expect(serialized).not.toContain('user_id_partner_777');
        expect(serialized).not.toContain('soldier');
        expect(serialized).not.toContain('isPrivate');
        expect(serialized).not.toContain('isProfilePost');
        expect(serialized).not.toContain('talkAbout');
        expect(serialized).not.toContain('reaction');

        // Forbidden exact dates and times
        expect(serialized).not.toContain('2026-08-28');
        expect(serialized).not.toContain('15:30');
        expect(serialized).not.toContain('createdAt');
        expect(serialized).not.toContain('2026-08-28T');

        // Forbidden attachment metadata, storage paths, and URLs
        expect(serialized).not.toContain('sensitive_filename');
        expect(serialized).not.toContain('voice_memo');
        expect(serialized).not.toContain('https://');
        expect(serialized).not.toContain('storage/v1');
        expect(serialized).not.toContain('couples/couple_123');

        // Forbidden emotion analysis
        expect(serialized).not.toContain('emotionFlow');
        expect(serialized).not.toContain('emotionAnalysis');
        expect(serialized).not.toContain('confidence');
      }
    });
  });

  describe('Fail-Closed Malformed Metadata Rejection', () => {
    it('fails closed on invalid / blank record ID with bounded rejection', () => {
      const rec1 = makeValidRecord({ id: 'rec_ok' });
      const rec2 = makeValidRecord({ id: '   ' });
      const result = normalizePartnerBriefingCorpus([rec1, rec2]);

      expect(result).toEqual({
        ok: false,
        rejection: {
          index: 1,
          reason: 'invalid_id',
        },
      });
    });

    it('fails closed on invalid date format with bounded rejection', () => {
      const rec1 = makeValidRecord({ id: 'r1', date: '2026-8-28' });
      const result = normalizePartnerBriefingCorpus([rec1]);

      expect(result).toEqual({
        ok: false,
        rejection: {
          index: 0,
          reason: 'invalid_date',
        },
      });
    });

    it('fails closed on impossible calendar date (e.g. Feb 30) with bounded rejection', () => {
      const rec1 = makeValidRecord({ id: 'r1', date: '2026-08-28' });
      const rec2 = makeValidRecord({ id: 'r2', date: '2026-02-30' });
      const result = normalizePartnerBriefingCorpus([rec1, rec2]);

      expect(result).toEqual({
        ok: false,
        rejection: {
          index: 1,
          reason: 'invalid_date',
        },
      });
    });

    it('fails closed on non-leap year Feb 29 with bounded rejection', () => {
      const rec = makeValidRecord({ id: 'r1', date: '2025-02-29' });
      const result = normalizePartnerBriefingCorpus([rec]);

      expect(result).toEqual({
        ok: false,
        rejection: {
          index: 0,
          reason: 'invalid_date',
        },
      });
    });

    it('fails closed on invalid time format with bounded rejection', () => {
      const rec1 = makeValidRecord({ id: 'r1', time: '14:30' });
      const rec2 = makeValidRecord({ id: 'r2', time: '24:00' });
      const result = normalizePartnerBriefingCorpus([rec1, rec2]);

      expect(result).toEqual({
        ok: false,
        rejection: {
          index: 1,
          reason: 'invalid_time',
        },
      });
    });

    it('guarantees rejection contains strictly index and reason with no leaked log or metadata', () => {
      const malformedRec = makeValidRecord({
        id: 'bad_rec',
        time: '99:99',
        log: '민감한 개인 일기 내용이 포함되어 있음',
        attachments: [{ type: 'photo', url: 'https://secret.url/1.jpg' }],
      });

      const result = normalizePartnerBriefingCorpus([malformedRec]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({
          index: 0,
          reason: 'invalid_time',
        });
        expect(Object.keys(result.rejection).sort()).toEqual(['index', 'reason']);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain('민감한');
        expect(serialized).not.toContain('secret.url');
      }
    });
  });

  describe('PostgreSQL TIME corpus tolerance', () => {
    it.each([
      { time: '09:07', label: 'HH:mm' },
      { time: '09:07:00', label: 'HH:mm:ss' },
      { time: '09:07:33', label: 'HH:mm:ss with seconds' },
      { time: '12:41:12.213424', label: 'HH:mm:ss.fraction' },
    ])('normalizes a $label record instead of failing the corpus closed', ({ time }) => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'rec_pg', time, log: '기록' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources).toEqual([{ ordinal: 0, recordId: 'rec_pg' }]);
        expect(result.events).toHaveLength(1);
      }
    });

    it('derives period from the canonical HH:mm regardless of precision', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'a', date: '2026-08-28', time: '09:07' }),
        makeValidRecord({ id: 'b', date: '2026-08-28', time: '09:07:33' }),
        makeValidRecord({ id: 'c', date: '2026-08-28', time: '12:41:12.213424' }),
        makeValidRecord({ id: 'd', date: '2026-08-28', time: '23:59:59.999999' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.events.map((e) => e.period)).toEqual([
          'morning',
          'morning',
          'afternoon',
          'night',
        ]);
      }
    });

    it('keeps every eligible source in a mixed-precision corpus', () => {
      const mixed = [
        makeValidRecord({ id: 'r_hhmm', date: '2026-08-28', time: '09:07', log: '분 단위' }),
        makeValidRecord({ id: 'r_secs', date: '2026-08-28', time: '14:05:21', log: '초 단위' }),
        makeValidRecord({ id: 'r_frac', date: '2026-08-28', time: '12:41:12.213424', log: '소수 단위' }),
        makeValidRecord({ id: 'r_zero', date: '2026-08-28', time: '20:00:00', log: '정각' }),
        makeValidRecord({ id: 'r_mid', date: '2026-08-28', time: '00:00:00.000000', log: '자정' }),
      ];

      const result = normalizePartnerBriefingCorpus(mixed);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // No eligible source may disappear, and ordering is by exact instant.
        expect(result.sources.map((s) => s.recordId)).toEqual([
          'r_mid',
          'r_hhmm',
          'r_frac',
          'r_secs',
          'r_zero',
        ]);
        expect(result.events).toHaveLength(mixed.length);
        expect(result.events.map((e) => e.ordinal)).toEqual([0, 1, 2, 3, 4]);
        expect(new Set(result.sources.map((s) => s.recordId)).size).toBe(mixed.length);
      }
    });

    it('treats 09:07 and 09:07:00 as one instant, tie-broken by record ID', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'rec_z', date: '2026-08-28', time: '09:07:00', log: 'Z' }),
        makeValidRecord({ id: 'rec_a', date: '2026-08-28', time: '09:07', log: 'A' }),
        makeValidRecord({ id: 'rec_m', date: '2026-08-28', time: '09:07:00.000000', log: 'M' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources).toEqual([
          { ordinal: 0, recordId: 'rec_a' },
          { ordinal: 1, recordId: 'rec_m' },
          { ordinal: 2, recordId: 'rec_z' },
        ]);
      }
    });

    it('orders 09:07:01 after every 09:07 same-minute record', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'rec_late', date: '2026-08-28', time: '09:07:01', log: 'late' }),
        makeValidRecord({ id: 'rec_z', date: '2026-08-28', time: '09:07:00', log: 'Z' }),
        makeValidRecord({ id: 'rec_a', date: '2026-08-28', time: '09:07', log: 'A' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 'rec_late' sorts last on seconds even though its ID sorts before 'rec_z'.
        expect(result.sources.map((s) => s.recordId)).toEqual([
          'rec_a',
          'rec_z',
          'rec_late',
        ]);
        expect(result.events.map((e) => e.period)).toEqual(['morning', 'morning', 'morning']);
      }
    });

    it('orders sub-second records within the same second', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'r3', date: '2026-08-28', time: '12:41:12.9' }),
        makeValidRecord({ id: 'r1', date: '2026-08-28', time: '12:41:12.09' }),
        makeValidRecord({ id: 'r2', date: '2026-08-28', time: '12:41:12.213424' }),
        makeValidRecord({ id: 'r0', date: '2026-08-28', time: '12:41:12' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources.map((s) => s.recordId)).toEqual(['r0', 'r1', 'r2', 'r3']);
      }
    });

    it('sorts a mixed-precision multi-day corpus by day then exact instant', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'd2_b', date: '2026-08-28', time: '06:00:00.5' }),
        makeValidRecord({ id: 'd0_a', date: '2026-08-26', time: '09:00' }),
        makeValidRecord({ id: 'd2_a', date: '2026-08-28', time: '06:00' }),
        makeValidRecord({ id: 'd1_a', date: '2026-08-27', time: '12:00:00' }),
        makeValidRecord({ id: 'd0_b', date: '2026-08-26', time: '20:00:30' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.days).toEqual([
          { dayOrdinal: 0, date: '2026-08-26' },
          { dayOrdinal: 1, date: '2026-08-27' },
          { dayOrdinal: 2, date: '2026-08-28' },
        ]);
        expect(result.sources.map((s) => s.recordId)).toEqual([
          'd0_a',
          'd0_b',
          'd1_a',
          'd2_a',
          'd2_b',
        ]);
        expect(result.events.map((e) => e.dayOrdinal)).toEqual([0, 0, 1, 2, 2]);
      }
    });

    it('never leaks seconds or fractional seconds into a model-safe event', () => {
      const result = normalizePartnerBriefingCorpus([
        makeValidRecord({ id: 'r_frac', date: '2026-08-28', time: '12:41:12.213424', log: '기록' }),
        makeValidRecord({ id: 'r_secs', date: '2026-08-28', time: '09:07:33', log: '기록' }),
      ]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const event of result.events) {
          expect(Object.keys(event).sort()).toEqual([
            'dayOrdinal',
            'mediaKinds',
            'ordinal',
            'period',
            'text',
          ]);
        }
        const serialized = JSON.stringify(result.events);
        expect(serialized).not.toContain('213424');
        expect(serialized).not.toContain('12:41');
        expect(serialized).not.toContain('09:07');
        expect(serialized).not.toContain(':33');
      }
    });

    it('keeps the fail-closed contract for extended forms that are out of range', () => {
      for (const [index, time] of [
        '24:00:00',
        '12:60:00',
        '12:00:60',
        '12:00:00.',
        '12:00:00.1234567',
        '12:00:00Z',
        '12:00:00+09:00',
        '9:00:00',
      ].entries()) {
        const result = normalizePartnerBriefingCorpus([
          makeValidRecord({ id: 'good', time: '09:07:33' }),
          makeValidRecord({ id: `bad_${index}`, time }),
        ]);

        expect(result).toEqual({
          ok: false,
          rejection: { index: 1, reason: 'invalid_time' },
        });
      }
    });

    it('does not mutate the input array or any record', () => {
      const records = [
        makeValidRecord({ id: 'r_b', date: '2026-08-28', time: '12:41:12.213424' }),
        makeValidRecord({ id: 'r_a', date: '2026-08-27', time: '09:07:00' }),
      ];
      const snapshot = JSON.parse(JSON.stringify(records)) as unknown;
      const orderBefore = records.map((r) => r.id);

      const result = normalizePartnerBriefingCorpus(records);

      expect(result.ok).toBe(true);
      // Original DailyRecord values, including the raw DB time strings, are untouched.
      expect(JSON.parse(JSON.stringify(records))).toEqual(snapshot);
      expect(records.map((r) => r.id)).toEqual(orderBefore);
      expect(records[0].time).toBe('12:41:12.213424');
      expect(records[1].time).toBe('09:07:00');
    });
  });
});
