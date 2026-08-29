import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPlaceFromOcr, inferPlaceCategory } from '@/lib/placeOcr';

/**
 * The three fixtures below are the REAL tesseract.js output for three Naver Map
 * place captures taken on a phone (도토리가든 안국점 / 신라제면 안국점 /
 * BBQ치킨 신길대방점), produced by the same engine and `kor` traineddata the app
 * ships in `public/ocr`. Only the recognised text is committed -- never the
 * screenshots, which are user content.
 *
 * They exist because the hand-written sample this suite started with was far
 * cleaner than anything a real capture produces. On real input the map area
 * ABOVE the place panel recognises as noise ("나 고 릴|랄2 (기 |",
 * "라시 00아호락 82"), and that noise sits earlier in the text than the place
 * name, so a first-usable-line reader picked the garbage every time: 0 of 3
 * titles and 0 of 3 addresses were right before this change.
 */
const fixture = (name: string): string =>
  readFileSync(resolve(process.cwd(), `src/lib/__fixtures__/${name}.txt`), 'utf8');

const CAPTURES = {
  dotori: fixture('naver-place-dotori-garden'),
  shilla: fixture('naver-place-shilla-noodle'),
  bbq: fixture('naver-place-bbq-chicken'),
};

describe('extractPlaceFromOcr on real Naver Map captures', () => {
  it('reads 도토리가든 안국점 (cafe/dessert) past the noisy map area', () => {
    const place = extractPlaceFromOcr(CAPTURES.dotori);
    expect(place.title).toBe('도토리가든 안국점');
    expect(place.address).toBe('서울 종로구');
    expect(place.businessHours).toContain('08:00에 영업 시작');
    expect(place.categoryHint).toBe('카페,디저트');
    expect(place.category).toBe('food');
  });

  it('reads 신라제면 안국점 without mistaking 게스트하우스 for the place', () => {
    const place = extractPlaceFromOcr(CAPTURES.shilla);
    expect(place.title).toBe('신라제면 안국점');
    expect(place.address).toBe('서울 종로구');
    expect(place.businessHours).toContain('10:30에 영업 시작');
    expect(place.categoryHint).toBe('국수');
    expect(place.category).toBe('food');
    // A neighbouring map label ('게스트하우스') is what the whole-capture read
    // used to classify this noodle shop as lodging. The panel hint is scoped to
    // this place, so the map cannot vote on it.
    expect(inferPlaceCategory(place.rawText)).toBe('lodging');
  });

  it('reads BBQ치킨 신길대방점 even when OCR mangles the brand to digits', () => {
    const place = extractPlaceFromOcr(CAPTURES.bbq);
    // Tesseract reads the BBQ logo as '8680'/'880'; the branch name is the part
    // that survives, and it is what the user needs to recognise the row.
    expect(place.title).toContain('신길대방점');
    expect(place.address).toBe('서울 영등포구');
    expect(place.businessHours).toContain('02:30에 라스트오더');
    expect(place.categoryHint).toBe('치킨,닭강정');
    expect(place.category).toBe('food');
  });

  it('never returns a Naver UI control or a rating/review/distance token as the title', () => {
    for (const [name, text] of Object.entries(CAPTURES)) {
      const { title, address } = extractPlaceFromOcr(text);
      expect(title, name).not.toMatch(/알림받기|줄서기|테이블링|현장대기|배달|주문|쿠폰|리뷰|출발|도착/);
      expect(title, name).not.toMatch(/^\d/);
      expect(address, name).not.toMatch(/알림받기|줄서기|테이블링|현장대기|배달|주문|리뷰|식약처/);
    }
  });

  /**
   * Partial recognition, built from the real BBQ panel with the two lines OCR is
   * most likely to lose (the name and the review anchor) removed. What is left is
   * verbatim fixture text: an hours line, a distance+region line, a certification
   * badge and the action row `출발 때주문. 배달 . [옥공유 . '`.
   *
   * Without the action-row and badge filters this returns `출발 때주문. 배달 ...`
   * or `랬 식약처 지정 식품안심업소` as the place name -- both measured. An empty
   * title is the honest answer here, and it is what routes the user to the
   * editor with the fields that WERE read preserved.
   */
  it('reports no title rather than a button row when the name and anchor are lost', () => {
    const lines = CAPTURES.bbq.split('\n');
    const anchorIndex = lines.findIndex((line) => /리뷰/.test(line));
    const degraded = lines.slice(anchorIndex - 1, anchorIndex + 5)
      .filter((line) => !/리뷰/.test(line) && !/신길대방점/.test(line))
      .join('\n');
    const place = extractPlaceFromOcr(degraded);
    expect(place.title).toBe('');
    expect(place.title).not.toMatch(/출발|주문|배달|공유|전화|식약처|식품안심업소/);
    // The hours and region still made it through, so the editor opens pre-filled.
    expect(place.address).toContain('서울 영등포구');
    expect(place.businessHours).toContain('02:30에 라스트오더');
  });
});

describe('extractPlaceFromOcr', () => {
  it('extracts a place name, Korean address and business hours from a map capture', () => {
    const place = extractPlaceFromOcr(`
      네이버 지도
      연남토마
      서울 마포구 연남로 42
      매일 11:30 - 21:00
      라스트 오더 20:00
      저장 공유
    `);
    expect(place.title).toBe('연남토마');
    expect(place.address).toBe('서울 마포구 연남로 42');
    expect(place.businessHours).toContain('11:30 - 21:00');
    expect(place.businessHours).toContain('라스트 오더 20:00');
  });

  it('returns editable empty fields when the capture has no usable text', () => {
    expect(extractPlaceFromOcr('지도\n저장\n공유')).toEqual({
      title: '', address: '', businessHours: '', categoryHint: '',
      category: 'activity', rawText: '지도\n저장\n공유',
    });
  });

  it('infers a useful category while keeping unknown places as activities', () => {
    expect(inferPlaceCategory('연남동 카페 메뉴')).toBe('food');
    expect(inferPlaceCategory('인천공항 제1여객터미널')).toBe('transport');
    expect(inferPlaceCategory('오션뷰 호텔 체크인')).toBe('lodging');
    expect(inferPlaceCategory('서울숲')).toBe('activity');
  });

  it('classifies the food words real Naver panels actually print', () => {
    for (const hint of ['국수', '치킨,닭강정', '카페,디저트', '분식', '초밥']) {
      expect(inferPlaceCategory(hint), hint).toBe('food');
    }
  });
});
