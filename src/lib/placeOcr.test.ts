import { describe, expect, it } from 'vitest';
import { extractPlaceFromOcr } from '@/lib/placeOcr';

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
      title: '', address: '', businessHours: '', rawText: '지도\n저장\n공유',
    });
  });
});
