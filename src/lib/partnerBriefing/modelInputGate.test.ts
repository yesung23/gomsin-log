import { describe, expect, it } from 'vitest';
import {
  findBriefingModelInputRisk,
  findBriefingRequestItemsRisk,
  isBriefingModelInputSafe,
} from './modelInputGate';

/**
 * Sentinels are shaped like the real values this app produces, so a detector that only
 * matched a test-specific string would not pass here:
 * - the UUIDs are canonical 8-4-4-4-12, like every `daily_records.id` / `auth.users.id`.
 * - the object path is exactly `{coupleId}/{recordId}/{file}`, the layout
 *   `buildMediaPath` writes and the storage RLS policies in migration 007 enforce.
 * - the signed URL is the `/storage/v1/object/sign/{bucket}/...?token=` form
 *   `createSignedUrls` returns for the private `couple-media` bucket.
 */
const RECORD_UUID = 'deadbeef-1111-2222-3333-444455556666';
const USER_UUID = 'facefeed-9999-8888-7777-666655554444';
const COUPLE_UUID = 'c0ffee11-2233-4455-6677-8899aabbccdd';
const STORAGE_PATH = `${COUPLE_UUID}/${RECORD_UUID}/9f8e7d6c.jpg`;
const SIGNED_URL = `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/couple-media/${STORAGE_PATH}?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sentinel.signature`;

describe('Partner Briefing model-input value gate (P1-1)', () => {
  describe('withholds values that must never reach a model', () => {
    it('detects a record UUID written into the body', () => {
      expect(findBriefingModelInputRisk(`기록 아이디는 ${RECORD_UUID} 야.`)).toBe('uuid');
    });

    it('detects a user UUID written into the body', () => {
      expect(findBriefingModelInputRisk(`내 계정 ${USER_UUID} 로 로그인했어.`)).toBe('uuid');
    });

    it('detects a couple UUID written into the body', () => {
      expect(findBriefingModelInputRisk(`커플 아이디 ${COUPLE_UUID} 확인했어.`)).toBe('uuid');
    });

    it('detects a canonical storage object path even without a scheme', () => {
      // The UUID detector fires first here, which is correct: the path is built FROM ids.
      // The point of the assertion is that the value is refused, not which reason wins.
      expect(isBriefingModelInputSafe(`경로는 ${STORAGE_PATH} 에 있어.`)).toBe(false);
    });

    it('detects a bucket-relative storage path with no UUID in it', () => {
      expect(
        findBriefingModelInputRisk('couple-media/photos/today.jpg 에 올려뒀어.'),
      ).toBe('storage_path');
    });

    it('detects a Storage signed URL', () => {
      expect(isBriefingModelInputSafe(`링크는 ${SIGNED_URL} 이야.`)).toBe(false);
    });

    it('detects a signed-URL query token split away from its host', () => {
      // fallback.ts segments sentences, so a URL can arrive as fragments. Each fragment must
      // fail on its own; this is the fragment that carries the actual secret.
      expect(
        findBriefingModelInputRisk('token=eyJhbGciOiJIUzI1NiJ9.sentinel.sig 이야.'),
      ).toBe('credential');
    });

    it('detects a bare host fragment with no scheme', () => {
      expect(
        findBriefingModelInputRisk('abcdefghijklmnopqrst.supabase.co 에서 받았어.'),
      ).toBe('url');
    });

    it('detects any url scheme, not only https', () => {
      expect(
        findBriefingModelInputRisk('blob:http://localhost:5173/preview 열었어'),
      ).toBe('url');
      expect(findBriefingModelInputRisk('capacitor://localhost 에서 확인')).toBe('url');
      expect(findBriefingModelInputRisk('file:///var/mobile/x.jpg 저장함')).toBe('url');
    });

    it('detects a base64 data url', () => {
      expect(
        findBriefingModelInputRisk('data:image/jpeg;base64,QUJDRA== 로 붙였어'),
      ).toBe('url');
    });

    it('detects GLE1 envelope and key markers', () => {
      expect(findBriefingModelInputRisk('봉투 헤더에 GLE1 매직이 박혀있어')).toBe('key_material');
      expect(findBriefingModelInputRisk('GLK2 봉투를 열었어')).toBe('key_material');
      expect(findBriefingModelInputRisk('wrappedDek 값을 적어뒀어')).toBe('key_material');
      expect(findBriefingModelInputRisk('contentNonce 도 메모함')).toBe('key_material');
      expect(findBriefingModelInputRisk('-----BEGIN PRIVATE KEY----- 붙여둠')).toBe(
        'key_material',
      );
    });

    it('detects a bearer token and api key markers', () => {
      expect(findBriefingModelInputRisk('Authorization: Bearer abc.def 라고 적음')).toBe(
        'credential',
      );
      expect(findBriefingModelInputRisk('apikey 는 따로 저장했어')).toBe('credential');
    });

    it('detects a raw hex key or unhyphenated uuid', () => {
      expect(
        findBriefingModelInputRisk('키는 0123456789abcdef0123456789abcdef 야'),
      ).toBe('opaque_token');
    });

    it('detects a long opaque base64url run', () => {
      expect(
        findBriefingModelInputRisk('토큰 aGVsbG8xd29ybGQyc2VjcmV0M3ZhbHVlNGFiYw 저장'),
      ).toBe('opaque_token');
    });

    it('fails closed on a non-string', () => {
      expect(findBriefingModelInputRisk(undefined)).toBe('invalid_text');
      expect(findBriefingModelInputRisk(null)).toBe('invalid_text');
      expect(findBriefingModelInputRisk(42)).toBe('invalid_text');
      expect(findBriefingModelInputRisk({ text: 'ok' })).toBe('invalid_text');
    });
  });

  describe('leaves ordinary partner writing alone', () => {
    it('accepts everyday Korean records', () => {
      const ordinary = [
        '오늘 훈련 진짜 힘들었어. 그래도 네 생각하니까 버텼다.',
        '점심에 부대 앞 국밥집 갔어. 다음에 같이 가자!',
        '내일 9시에 통화할 수 있을 것 같아. 12월 25일에 휴가 나와.',
        '사진 세 장 올렸어 ㅎㅎ 오늘 하늘 진짜 예뻤음',
        '보고싶다... 010-1234-5678 로 전화해도 되지?',
        '몸무게 68.5kg 찍었다. 운동 30분 했어.',
        '가족 이모지 👨‍👩‍👧‍👦 랑 하트 💕 넣어봤어',
      ];
      for (const text of ordinary) {
        expect(findBriefingModelInputRisk(text)).toBeNull();
      }
    });

    it('accepts long Korean prose without flagging it as opaque', () => {
      expect(isBriefingModelInputSafe('가나다라마바사 '.repeat(200).trim())).toBe(true);
    });

    it('accepts the repeated-character fixtures the envelope tests rely on', () => {
      // pipeline.test.ts builds oversized candidates from 'A'.repeat(500) and '가'.repeat(2000).
      // Flagging those would silently convert envelope tests into gate tests.
      expect(isBriefingModelInputSafe('A'.repeat(500))).toBe(true);
      expect(isBriefingModelInputSafe('가'.repeat(2000))).toBe(true);
      expect(isBriefingModelInputSafe('x'.repeat(64))).toBe(true);
    });

    it('accepts ordinary English sentences and dates', () => {
      expect(
        findBriefingModelInputRisk('Training was hard today but I thought of you.'),
      ).toBeNull();
      expect(findBriefingModelInputRisk('See you on 2026-08-26 at 09:00.')).toBeNull();
    });

    it('accepts an empty string', () => {
      expect(findBriefingModelInputRisk('')).toBeNull();
    });
  });

  describe('request-level boundary assertion', () => {
    it('passes a request whose candidates are all safe', () => {
      expect(
        findBriefingRequestItemsRisk([
          { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: '오늘 힘들었어.' }] },
        ]),
      ).toBeNull();
    });

    it('flags a request carrying a risky candidate', () => {
      expect(
        findBriefingRequestItemsRisk([
          { itemOrdinal: 0, candidates: [{ candidateOrdinal: 0, text: '안녕' }] },
          {
            itemOrdinal: 1,
            candidates: [{ candidateOrdinal: 0, text: `아이디 ${RECORD_UUID}` }],
          },
        ]),
      ).toBe('uuid');
    });

    it('fails closed on malformed request shapes', () => {
      expect(findBriefingRequestItemsRisk(null)).toBe('invalid_text');
      expect(findBriefingRequestItemsRisk([null])).toBe('invalid_text');
      expect(findBriefingRequestItemsRisk([{ candidates: 'nope' }])).toBe('invalid_text');
      expect(findBriefingRequestItemsRisk([{ candidates: [null] }])).toBe('invalid_text');
      expect(findBriefingRequestItemsRisk([{ candidates: [{ text: 7 }] }])).toBe(
        'invalid_text',
      );
    });
  });
});
