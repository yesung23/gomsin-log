import { describe, it, expect } from 'vitest';
import { buildPostTiles, getPhotoAttachments } from '@/features/us/postTiles';
import type { DailyRecord } from '@/types';

const record = (over: Partial<DailyRecord> & { id: string; date: string }): DailyRecord => ({
  authorRole: 'gomsin',
  log: '오늘도 보고 싶어',
  time: '09:00',
  isPrivate: false,
  talkAbout: false,
  ...over,
} as DailyRecord);

describe('게시물 격자는 사진 게시물을 센다', () => {
  /*
    글 중심 기록은 이 격자가 아니라 `사진` 탭의 기존 기록 목록이 맡는다. 이 함수가
    사진 없는 기록을 칸으로 만들지 않는지 순수 함수로 고정한다.
  */
  it('사진 없는 기록은 칸이 되지 않는다', () => {
    const tiles = buildPostTiles([record({ id: 'a', date: '2026-08-20' })]);
    expect(tiles).toEqual([]);
  });

  it('하루에 여럿 남기면 칸도 여럿이다', () => {
    const tiles = buildPostTiles([
      record({ id: 'a', date: '2026-08-20', time: '09:00', attachments: [{ type: 'photo', name: 'a.jpg' }] }),
      record({ id: 'b', date: '2026-08-20', time: '21:00', attachments: [{ type: 'photo', name: 'b.jpg' }] }),
    ]);
    expect(tiles.map((tile) => tile.recordId)).toEqual(['b', 'a']);
  });

  it('최근이 먼저다', () => {
    const tiles = buildPostTiles([
      record({ id: 'new', date: '2026-08-22', attachments: [{ type: 'photo', name: 'new.jpg' }] }),
      record({ id: 'old', date: '2026-08-01', attachments: [{ type: 'photo', name: 'old.jpg' }] }),
    ]);
    expect(tiles.map((tile) => tile.recordId)).toEqual(['new', 'old']);
  });

  it('글만 있는 기록은 게시물 격자에서 제외한다', () => {
    const [tile] = buildPostTiles([record({ id: 'a', date: '2026-08-20', log: '글만' })]);
    expect(tile).toBeUndefined();
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
  it('영상·음성만 있는 기록은 사진 게시물로 만들지 않는다', () => {
    expect(buildPostTiles([record({
      id: 'a',
      date: '2026-08-20',
      attachments: [{ type: 'video', name: 'v.mp4', path: 'c/v.mp4' }],
    })])).toEqual([]);
  });

  /*
    못 여는 기록은 **없는 것이 아니라 못 여는 것**이다. 빼 버리면 기기를 바꿀 때마다
    프로필의 게시물 수가 줄어든 것처럼 보인다.
  */
  it('이 기기가 못 여는 기록도 칸으로 남는다', () => {
    const [tile] = buildPostTiles([record({
      id: 'a',
      date: '2026-08-20',
      contentUnavailable: 'key_unavailable',
      attachments: [{ type: 'photo', name: '잠긴.jpg', path: 'c/잠긴.jpg' }],
    })]);
    expect(tile.unavailable).toBe(true);
  });

  it('글도 사진도 없으면 칸이 아니다', () => {
    expect(buildPostTiles([record({ id: 'a', date: '2026-08-20', log: '   ' })])).toEqual([]);
  });

  it('아무것도 없으면 격자도 없다', () => {
    expect(buildPostTiles([])).toEqual([]);
  });

  it('사진 첨부 추출도 영상·음성을 제외한다', () => {
    expect(getPhotoAttachments({
      attachments: [
        { type: 'photo', name: '사진.jpg' },
        { type: 'video', name: '영상.mp4' },
        { type: 'voice', name: '음성.m4a' },
      ],
    })).toEqual([{ type: 'photo', name: '사진.jpg' }]);
  });
});
