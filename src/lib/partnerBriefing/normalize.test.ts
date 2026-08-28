import { describe, expect, it } from 'vitest';
import type { Attachment, DailyRecord } from '@/types';
import type { BriefingModelSafeEvent, BriefingPeriod } from './contract';
import {
  getBriefingPeriod,
  isValidDateString,
  isValidRecordId,
  isValidTimeString,
  normalizeBriefingText,
  normalizePartnerBriefingCorpus,
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

    it('rejects invalid or out-of-range times', () => {
      expect(isValidTimeString('24:00')).toBe(false);
      expect(isValidTimeString('12:60')).toBe(false);
      expect(isValidTimeString('9:00')).toBe(false);
      expect(isValidTimeString('12:00:00')).toBe(false);
      expect(isValidTimeString('12:0')).toBe(false);
      expect(isValidTimeString('12')).toBe(false);
      expect(isValidTimeString('')).toBe(false);
      expect(isValidTimeString('   ')).toBe(false);
      expect(isValidTimeString(null)).toBe(false);
      expect(isValidTimeString(undefined)).toBe(false);
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
    ];

    it.each(periodBoundaries)(
      'correctly maps time $time to period $expected',
      ({ time, expected }) => {
        expect(getBriefingPeriod(time)).toBe(expected);
      },
    );
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
});
