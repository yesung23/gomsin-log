import { describe, expect, it } from 'vitest';
import type { CoupleStatus, DailyRecord } from '@/types';
import {
  isPersistedRecord,
  selectPartnerBriefingCorpus,
  type PartnerBriefingCorpusInput,
  type PartnerBriefingRecordRejection,
} from './corpus';

function makeValidRecord(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec_default_1',
    userId: 'partner_user_456',
    date: '2026-08-28',
    time: '14:30',
    authorRole: 'soldier',
    log: '오늘 훈련 무사히 마쳤어!',
    isPrivate: false,
    createdAt: '2026-08-28T05:30:00.000Z',
    ...overrides,
  };
}

function makeDefaultInput(
  overrides: Partial<PartnerBriefingCorpusInput> = {},
): PartnerBriefingCorpusInput {
  return {
    surface: [makeValidRecord()],
    viewerUserId: 'viewer_user_123',
    partnerUserId: 'partner_user_456',
    coupleConnected: true,
    coupleStatus: 'active',
    ...overrides,
  };
}

describe('Partner Briefing Corpus (Phase A2)', () => {
  describe('Global Preconditions (Fail-Closed)', () => {
    it('fails closed when coupleConnected is false', () => {
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ coupleConnected: false }),
      );
      expect(result).toEqual({ ok: false, rejection: 'couple_not_active' });
    });

    it.each<CoupleStatus | undefined | null>([
      'pending',
      'disconnected',
      undefined,
      null,
    ])('fails closed when coupleStatus is %s', (status) => {
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ coupleStatus: status }),
      );
      expect(result).toEqual({ ok: false, rejection: 'couple_not_active' });
    });

    it.each([undefined, null, '', '   '])(
      'fails closed when viewerUserId is %j',
      (viewerId) => {
        const result = selectPartnerBriefingCorpus(
          makeDefaultInput({ viewerUserId: viewerId }),
        );
        expect(result).toEqual({ ok: false, rejection: 'identity_unresolved' });
      },
    );

    it.each([undefined, null, '', '   '])(
      'fails closed when partnerUserId is %j',
      (partnerId) => {
        const result = selectPartnerBriefingCorpus(
          makeDefaultInput({ partnerUserId: partnerId }),
        );
        expect(result).toEqual({ ok: false, rejection: 'identity_unresolved' });
      },
    );

    it('fails closed when viewerUserId equals partnerUserId', () => {
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({
          viewerUserId: 'same_user_id',
          partnerUserId: 'same_user_id',
        }),
      );
      expect(result).toEqual({ ok: false, rejection: 'identity_unresolved' });
    });
  });

  describe('isPersistedRecord helper', () => {
    it('accepts records with non-empty id, userId, and createdAt', () => {
      expect(
        isPersistedRecord({
          id: 'rec_1',
          userId: 'user_1',
          createdAt: '2026-08-28T00:00:00.000Z',
        }),
      ).toBe(true);
    });

    it('rejects records missing id, userId, or createdAt or having blank strings', () => {
      expect(
        isPersistedRecord({
          id: '',
          userId: 'user_1',
          createdAt: '2026-08-28T00:00:00.000Z',
        }),
      ).toBe(false);

      expect(
        isPersistedRecord({
          id: '   ',
          userId: 'user_1',
          createdAt: '2026-08-28T00:00:00.000Z',
        }),
      ).toBe(false);

      expect(
        isPersistedRecord({
          id: 'rec_1',
          userId: '',
          createdAt: '2026-08-28T00:00:00.000Z',
        }),
      ).toBe(false);

      expect(
        isPersistedRecord({
          id: 'rec_1',
          userId: 'user_1',
          createdAt: '   ',
        }),
      ).toBe(false);

      expect(
        isPersistedRecord({
          id: 'rec_1',
          userId: undefined as unknown as string,
          createdAt: '2026-08-28T00:00:00.000Z',
        }),
      ).toBe(false);
    });
  });

  describe('Corpus Sizes and Dates (No Top-N, No Date Restriction, No Min-Count)', () => {
    it('accepts an empty surface (0 records)', () => {
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [] }),
      );
      expect(result).toEqual({
        ok: true,
        records: [],
        rejections: [],
      });
    });

    it('accepts exactly 1 valid record without requiring a minimum count', () => {
      const record = makeValidRecord({ id: 'rec_single' });
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [record] }),
      );
      expect(result).toEqual({
        ok: true,
        records: [record],
        rejections: [],
      });
    });

    it('accepts multiple same-day records', () => {
      const rec1 = makeValidRecord({ id: 'rec_1', time: '09:00', date: '2026-08-28' });
      const rec2 = makeValidRecord({ id: 'rec_2', time: '13:00', date: '2026-08-28' });
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [rec1, rec2] }),
      );
      expect(result).toEqual({
        ok: true,
        records: [rec1, rec2],
        rejections: [],
      });
    });

    it('preserves multi-day records across multiple dates', () => {
      const recDay1 = makeValidRecord({ id: 'rec_d1', date: '2026-08-26' });
      const recDay2 = makeValidRecord({ id: 'rec_d2', date: '2026-08-27' });
      const recDay3 = makeValidRecord({ id: 'rec_d3', date: '2026-08-28' });
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [recDay1, recDay2, recDay3] }),
      );
      expect(result).toEqual({
        ok: true,
        records: [recDay1, recDay2, recDay3],
        rejections: [],
      });
    });

    it('retains 100+ valid records without slicing or capping', () => {
      const count = 120;
      const surface: DailyRecord[] = Array.from({ length: count }, (_, i) =>
        makeValidRecord({
          id: `rec_${i}`,
          time: `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
          log: `기록 내용 ${i}`,
        }),
      );

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.records).toHaveLength(count);
        expect(result.records).toEqual(surface);
        expect(result.rejections).toHaveLength(0);
      }
    });
  });

  describe('Per-Record Fail-Closed Acceptance and Rejections', () => {
    it('excludes private records (isPrivate === true or not false)', () => {
      const privateRec = makeValidRecord({ id: 'rec_priv', isPrivate: true });
      const nonPrivateRec = makeValidRecord({ id: 'rec_pub', isPrivate: false });
      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [privateRec, nonPrivateRec] }),
      );
      expect(result).toEqual({
        ok: true,
        records: [nonPrivateRec],
        rejections: [{ index: 0, reason: 'private' }],
      });
    });

    it('excludes unreadable records with key_unavailable and undecryptable', () => {
      const keyUnavailRec = makeValidRecord({
        id: 'rec_key_unavail',
        contentUnavailable: 'key_unavailable',
      });
      const undecryptableRec = makeValidRecord({
        id: 'rec_undecryptable',
        contentUnavailable: 'undecryptable',
      });
      const readableRec = makeValidRecord({ id: 'rec_readable' });

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({
          surface: [keyUnavailRec, readableRec, undecryptableRec],
        }),
      );

      expect(result).toEqual({
        ok: true,
        records: [readableRec],
        rejections: [
          { index: 0, reason: 'unreadable' },
          { index: 2, reason: 'unreadable' },
        ],
      });
    });

    it('excludes records authored by viewer (own record), former partner, or stranger', () => {
      const ownRec = makeValidRecord({ id: 'rec_own', userId: 'viewer_user_123' });
      const strangerRec = makeValidRecord({ id: 'rec_stranger', userId: 'unrelated_user_999' });
      const partnerRec = makeValidRecord({ id: 'rec_partner', userId: 'partner_user_456' });

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: [ownRec, partnerRec, strangerRec] }),
      );

      expect(result).toEqual({
        ok: true,
        records: [partnerRec],
        rejections: [
          { index: 0, reason: 'wrong_partner' },
          { index: 2, reason: 'wrong_partner' },
        ],
      });
    });

    it('excludes unpersisted records (missing or blank id, userId, or createdAt)', () => {
      const missingId = makeValidRecord({ id: '' });
      const missingUserId = makeValidRecord({ userId: '' });
      const missingCreatedAt = makeValidRecord({ createdAt: '   ' });
      const persisted = makeValidRecord({ id: 'rec_persisted' });

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({
          surface: [missingId, persisted, missingUserId, missingCreatedAt],
        }),
      );

      expect(result).toEqual({
        ok: true,
        records: [persisted],
        rejections: [
          { index: 0, reason: 'unpersisted' },
          { index: 2, reason: 'unpersisted' },
          { index: 3, reason: 'unpersisted' },
        ],
      });
    });
  });

  describe('Mixed Surface, Order Preservation, and Rejection Metadata Hygiene', () => {
    it('preserves exact surface order without sorting (including reverse chronological or identical timestamps)', () => {
      const recLate = makeValidRecord({ id: 'rec_b', time: '20:00' });
      const recEarly = makeValidRecord({ id: 'rec_a', time: '08:00' });
      const recSameTime1 = makeValidRecord({ id: 'rec_z', time: '12:00' });
      const recSameTime2 = makeValidRecord({ id: 'rec_m', time: '12:00' });

      const inputSurface = [recLate, recEarly, recSameTime1, recSameTime2];

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface: inputSurface }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.records[0]).toBe(recLate);
        expect(result.records[1]).toBe(recEarly);
        expect(result.records[2]).toBe(recSameTime1);
        expect(result.records[3]).toBe(recSameTime2);
      }
    });

    it('keeps valid records and reports bounded rejection metadata without sensitive content', () => {
      const unpersisted = makeValidRecord({
        id: '',
        log: '민감한 일기 본문 1',
        attachments: [{ type: 'photo', url: 'https://secret.supabase.co/p1.jpg' }],
      });
      const valid1 = makeValidRecord({ id: 'rec_1', log: '정상 기록 1' });
      const wrongPartner = makeValidRecord({
        id: 'rec_wrong',
        userId: 'viewer_user_123',
        log: '내 비밀 메모',
      });
      const privateRec = makeValidRecord({
        id: 'rec_priv',
        isPrivate: true,
        log: '상대방의 나에게만 메모',
      });
      const unreadable = makeValidRecord({
        id: 'rec_unreadable',
        contentUnavailable: 'undecryptable',
      });
      const valid2 = makeValidRecord({ id: 'rec_2', log: '정상 기록 2' });

      const surface = [unpersisted, valid1, wrongPartner, privateRec, unreadable, valid2];

      const result = selectPartnerBriefingCorpus(
        makeDefaultInput({ surface }),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.records).toEqual([valid1, valid2]);

        expect(result.rejections).toEqual([
          { index: 0, reason: 'unpersisted' },
          { index: 2, reason: 'wrong_partner' },
          { index: 3, reason: 'private' },
          { index: 4, reason: 'unreadable' },
        ]);

        // Verify that rejection metadata contains strictly { index, reason } and nothing else
        for (const rej of result.rejections) {
          const keys = Object.keys(rej);
          expect(keys.sort()).toEqual(['index', 'reason']);
        }
      }
    });
  });
});
