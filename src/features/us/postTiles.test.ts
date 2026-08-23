import { describe, it, expect } from 'vitest';
import { buildPostTiles, isTravelRecord } from '@/features/us/postTiles';
import type { CoupleEvent, DailyRecord, Trip } from '@/types';

const record = (over: Partial<DailyRecord> & { id: string; date: string }): DailyRecord => ({
  authorRole: 'gomsin',
  log: '오늘도 보고 싶어',
  time: '09:00',
  isPrivate: false,
  talkAbout: false,
  ...over,
} as DailyRecord);

describe('게시물 격자는 하루가 아니라 기록을 센다', () => {
  /*
    하루 격자를 고른 원래 이유가 "사진 안 올리는 커플에게 구멍 난 격자가 되는 것을
    막으려고" 였다. 칸의 단위를 기록으로 바꾸면 그 문제가 **구조적으로** 사라진다 --
    남기지 않은 날은 칸이 생기지 않을 뿐 빈 칸으로 남지 않는다.
  */
  it('남기지 않은 날은 칸이 되지 않는다', () => {
    const tiles = buildPostTiles([record({ id: 'a', date: '2026-08-20' })]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].date).toBe('2026-08-20');
  });

  it('하루에 여럿 남기면 칸도 여럿이다', () => {
    const tiles = buildPostTiles([
      record({ id: 'a', date: '2026-08-20', time: '09:00' }),
      record({ id: 'b', date: '2026-08-20', time: '21:00' }),
    ]);
    expect(tiles.map((tile) => tile.recordId)).toEqual(['b', 'a']);
  });

  it('최근이 먼저다', () => {
    const tiles = buildPostTiles([
      record({ id: 'old', date: '2026-08-01' }),
      record({ id: 'new', date: '2026-08-22' }),
    ]);
    expect(tiles.map((tile) => tile.recordId)).toEqual(['new', 'old']);
  });

  /* 인스타에는 글만 있는 게시물이 없지만 이 앱에는 그것이 대부분이다. */
  it('글만 있는 기록도 칸이 된다', () => {
    const [tile] = buildPostTiles([record({ id: 'a', date: '2026-08-20', log: '글만' })]);
    expect(tile.photo).toBeUndefined();
    expect(tile.text).toBe('글만');
  });

  it('사진이 있으면 첫 장이 칸이 된다', () => {
    const [tile] = buildPostTiles([record({
      id: 'a',
      date: '2026-08-20',
      attachments: [
        { type: 'photo', name: '1.jpg', path: 'c/1.jpg' },
        { type: 'photo', name: '2.jpg', path: 'c/2.jpg' },
      ],
    })]);
    expect(tile.photo?.name).toBe('1.jpg');
    expect(tile.multiple).toBe(true);
  });

  it('한 장이면 겹친 장 표시를 달지 않는다', () => {
    const [tile] = buildPostTiles([record({
      id: 'a',
      date: '2026-08-20',
      attachments: [{ type: 'photo', name: '1.jpg', path: 'c/1.jpg' }],
    })]);
    expect(tile.multiple).toBe(false);
  });

  /*
    음성 같은 것은 격자가 보여줄 수 없다. 칸으로 만들면 무엇이 들었는지 알 수 없는
    회색 사각형이 되고, 사진이 있는 줄 알고 눌렀다가 아닌 것을 만나게 된다.
  */
  it('보여줄 수 없는 첨부는 사진 칸으로 만들지 않는다', () => {
    const [tile] = buildPostTiles([record({
      id: 'a',
      date: '2026-08-20',
      attachments: [{ type: 'audio', name: 'v.m4a', path: 'c/v.m4a' }],
    })]);
    expect(tile.photo).toBeUndefined();
    expect(tile.multiple).toBe(false);
  });

  /*
    못 여는 기록은 **없는 것이 아니라 못 여는 것**이다. 빼 버리면 기기를 바꿀 때마다
    프로필의 게시물 수가 줄어든 것처럼 보인다.
  */
  it('이 기기가 못 여는 기록도 칸으로 남는다', () => {
    const [tile] = buildPostTiles([record({
      id: 'a', date: '2026-08-20', contentUnavailable: 'key_unavailable',
    })]);
    expect(tile.unavailable).toBe(true);
  });

  it('글도 사진도 없으면 칸이 아니다', () => {
    expect(buildPostTiles([record({ id: 'a', date: '2026-08-20', log: '   ' })])).toEqual([]);
  });

  it('아무것도 없으면 격자도 없다', () => {
    expect(buildPostTiles([])).toEqual([]);
  });
});

describe('여행 기록 판별 (isTravelRecord)', () => {
  const trips: Trip[] = [
    {
      id: 'trip-jeju',
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: '제주도 여행',
      startDate: '2026-08-10',
      endDate: '2026-08-13',
      status: 'planned',
      createdAt: '2026-08-01T00:00:00Z',
    },
  ];

  const events: CoupleEvent[] = [
    {
      id: 'event-busan',
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: '부산 1박2일',
      eventType: 'trip',
      startDate: '2026-08-20',
      endDate: '2026-08-21',
      isPrivate: false,
      createdAt: '2026-08-01T00:00:00Z',
    },
    {
      id: 'event-date',
      coupleId: 'couple-1',
      createdBy: 'user-1',
      title: '영화 데이트',
      eventType: 'date',
      startDate: '2026-08-25',
      endDate: '2026-08-25',
      isPrivate: false,
      createdAt: '2026-08-01T00:00:00Z',
    },
  ];

  it('여행 기간 내의 기록은 여행 기록으로 판별된다', () => {
    expect(isTravelRecord({ date: '2026-08-10' }, trips, events)).toBe(true);
    expect(isTravelRecord({ date: '2026-08-12' }, trips, events)).toBe(true);
    expect(isTravelRecord({ date: '2026-08-13' }, trips, events)).toBe(true);
  });

  it('trip 타입의 이벤트 기간 내 기록도 여행 기록으로 판별된다', () => {
    expect(isTravelRecord({ date: '2026-08-20' }, trips, events)).toBe(true);
    expect(isTravelRecord({ date: '2026-08-21' }, trips, events)).toBe(true);
  });

  it('여행이나 trip 이벤트가 없는 일반 날짜의 기록은 제외된다', () => {
    expect(isTravelRecord({ date: '2026-08-09' }, trips, events)).toBe(false);
    expect(isTravelRecord({ date: '2026-08-14' }, trips, events)).toBe(false);
    expect(isTravelRecord({ date: '2026-08-25' }, trips, events)).toBe(false); // date 이벤트는 제외
  });
});
