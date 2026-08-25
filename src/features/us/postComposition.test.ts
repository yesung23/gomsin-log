import { describe, it, expect } from 'vitest';
import {
  MAX_POST_PHOTOS,
  containsAttachment,
  movePostItem,
  remainingPostSlots,
  removePostItem,
  selectablePhotos,
  tripDateSet,
  type PostDraftItem,
} from '@/features/us/postComposition';
import type { Attachment, DailyRecord } from '@/types';

/**
 * 게시물 구성의 계약.
 *
 * 여기서 세는 것은 **사용자가 고른 사진이 사라지지 않는다**는 것이다. 순서 편집은 장식이
 * 아니라 첫 칸이 프로필 격자의 대표 사진을 결정하므로, 드래그가 배열을 망가뜨리면 사용자가
 * 의도한 게시물과 실제 저장되는 게시물이 달라진다.
 */

function photo(over: Partial<Attachment> = {}): Attachment {
  return { type: 'photo', name: 'a.jpg', path: 'couple-1/rec-1/a.jpg', ...over } as Attachment;
}

function existing(id: string, path: string, recordId = 'rec-1'): PostDraftItem {
  return { kind: 'existing', id, sourceRecordId: recordId, attachment: photo({ path }) };
}

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: 'me',
    date: '2026-08-25',
    time: '09:00',
    authorRole: 'gomsin',
    log: '',
    isPrivate: false,
    createdAt: '2026-08-25T00:00:00.000Z',
    attachments: [photo()],
    ...over,
  } as DailyRecord;
}

describe('장수 상한', () => {
  it('10장이다 -- 영상 경로가 없고 파일별 실패를 다뤄야 하므로 인스타의 20장을 그대로 쓰지 않는다', () => {
    expect(MAX_POST_PHOTOS).toBe(10);
  });

  it('남은 자리는 음수가 되지 않는다', () => {
    const full = Array.from({ length: 12 }, (_, i) => existing(`e${i}`, `p/${i}.jpg`));
    expect(remainingPostSlots(full)).toBe(0);
    expect(remainingPostSlots([])).toBe(10);
    expect(remainingPostSlots([existing('a', 'p/a.jpg')])).toBe(9);
  });
});

describe('순서 편집은 사진을 잃지 않는다', () => {
  const items = [existing('a', 'p/a.jpg'), existing('b', 'p/b.jpg'), existing('c', 'p/c.jpg')];

  it('앞에서 뒤로 옮긴다', () => {
    expect(movePostItem(items, 0, 2).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('뒤에서 앞으로 옮긴다 -- 대표 사진을 바꾸는 동작', () => {
    expect(movePostItem(items, 2, 0).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('제자리면 그대로다', () => {
    expect(movePostItem(items, 1, 1).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('범위를 벗어난 드래그는 목록을 망가뜨리지 않는다', () => {
    // 드래그가 화면 밖에서 끝나는 것은 정상적인 사용자 동작이다.
    for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [9, 9]] as const) {
      expect(movePostItem(items, from, to).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    }
  });

  it('원본 배열을 변형하지 않는다', () => {
    movePostItem(items, 0, 2);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('개별 제거', () => {
  it('id로 하나만 뺀다', () => {
    const items = [existing('a', 'p/a.jpg'), existing('b', 'p/b.jpg')];
    expect(removePostItem(items, 'a').map((i) => i.id)).toEqual(['b']);
  });

  it('없는 id는 아무것도 바꾸지 않는다', () => {
    const items = [existing('a', 'p/a.jpg')];
    expect(removePostItem(items, 'zz')).toHaveLength(1);
  });
});

describe('같은 사진을 두 번 담지 않는다', () => {
  it('path로 판정한다 -- 서명 URL은 매번 달라지므로 URL로 비교할 수 없다', () => {
    const items = [existing('a', 'couple-1/rec-1/x.jpg')];
    expect(containsAttachment(items, photo({ path: 'couple-1/rec-1/x.jpg', url: 'https://a' }))).toBe(true);
    expect(containsAttachment(items, photo({ path: 'couple-1/rec-2/y.jpg' }))).toBe(false);
  });

  it('path가 없는 첨부는 중복으로 보지 않는다', () => {
    const items = [existing('a', 'couple-1/rec-1/x.jpg')];
    expect(containsAttachment(items, { type: 'photo', name: 'legacy.jpg' } as Attachment)).toBe(false);
  });
});

describe('기존 사진 고르기 목록', () => {
  it('비공개 기록은 고를 수 없다', () => {
    const rows = selectablePhotos([
      record({ id: 'shared' }),
      record({ id: 'secret', isPrivate: true }),
    ]);
    expect(rows.map((r) => r.recordId)).toEqual(['shared']);
  });

  it('열 수 없는 기록은 고를 수 없다', () => {
    const rows = selectablePhotos([
      record({ id: 'ok' }),
      record({ id: 'locked', contentUnavailable: 'key_unavailable' } as Partial<DailyRecord>),
    ]);
    expect(rows.map((r) => r.recordId)).toEqual(['ok']);
  });

  it('사진이 없는 기록은 칸이 되지 않는다', () => {
    const rows = selectablePhotos([record({ id: 'text-only', attachments: [] })]);
    expect(rows).toEqual([]);
  });

  it('저장 경로가 없는 첨부는 제외한다 -- 다시 서명할 수 없다', () => {
    const rows = selectablePhotos([
      record({ id: 'legacy', attachments: [{ type: 'photo', name: 'old.jpg' } as Attachment] }),
    ]);
    expect(rows).toEqual([]);
  });

  it('최근이 먼저다', () => {
    const rows = selectablePhotos([
      record({ id: 'old', date: '2026-08-20', time: '09:00' }),
      record({ id: 'new', date: '2026-08-25', time: '09:00' }),
      record({ id: 'today-late', date: '2026-08-25', time: '20:00' }),
    ]);
    expect(rows.map((r) => r.recordId)).toEqual(['today-late', 'new', 'old']);
  });

  it('한 기록의 사진 여러 장이 각각 칸이 된다', () => {
    const rows = selectablePhotos([record({
      id: 'multi',
      attachments: [photo({ path: 'p/1.jpg' }), photo({ path: 'p/2.jpg' })],
    })]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.recordId === 'multi')).toBe(true);
  });

  it('날짜 필터를 주면 그 날짜만 남는다 -- 여행에서 고르기', () => {
    const rows = selectablePhotos([
      record({ id: 'in', date: '2026-08-25' }),
      record({ id: 'out', date: '2026-07-01' }),
    ], { dates: new Set(['2026-08-25']) });
    expect(rows.map((r) => r.recordId)).toEqual(['in']);
  });
});

describe('여행 날짜 집합', () => {
  it('시작과 끝을 포함한 모든 날을 담는다', () => {
    const dates = tripDateSet([{ startDate: '2026-08-24', endDate: '2026-08-26' }]);
    expect([...dates].sort()).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  it('종료일이 없으면 하루다', () => {
    expect([...tripDateSet([{ startDate: '2026-08-24' }])]).toEqual(['2026-08-24']);
  });

  it('잘못된 날짜는 무시하고 무한 루프에 빠지지 않는다', () => {
    expect(tripDateSet([{ startDate: 'not-a-date', endDate: '2026-08-25' }]).size).toBe(0);
    // 종료일이 시작일보다 앞이면 아무 날도 담기지 않는다.
    expect(tripDateSet([{ startDate: '2026-08-25', endDate: '2026-08-20' }]).size).toBe(0);
  });

  it('여러 여행의 날짜가 합쳐진다', () => {
    const dates = tripDateSet([
      { startDate: '2026-08-01', endDate: '2026-08-02' },
      { startDate: '2026-09-10' },
    ]);
    expect([...dates].sort()).toEqual(['2026-08-01', '2026-08-02', '2026-09-10']);
  });
});
