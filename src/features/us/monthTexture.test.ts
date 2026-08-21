import { describe, it, expect } from 'vitest';
import { buildMonthTexture, monthsWithContent } from '@/features/us/monthTexture';
import type { CoupleEvent, DailyRecord, Trip } from '@/types';

/**
 * The month texture.
 *
 * Two things are under test and only one is arithmetic. The other is a privacy
 * rule with no UI of its own: a `나만 보기` photo must never become the picture on
 * a day in 우리. It is the most glanceable thing on a screen someone might hold up
 * across a room, and the author marked it private.
 */

function record(partial: Partial<DailyRecord> & { id: string; date: string }): DailyRecord {
  return {
    time: '09:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  };
}

const photo = { type: 'photo' as const, name: 'p.jpg', path: 'x/p.jpg', url: 'https://x/p.jpg' };
const voice = { type: 'voice' as const, name: 'v.m4a', path: 'x/v.m4a', url: 'https://x/v.m4a' };

const build = (records: DailyRecord[], extra?: { events?: CoupleEvent[]; trips?: Trip[] }) =>
  buildMonthTexture({
    year: 2026,
    month: 8,
    records,
    events: extra?.events ?? [],
    trips: extra?.trips ?? [],
    today: '2026-08-20',
  });

const cellOn = (texture: ReturnType<typeof build>, date: string) =>
  texture.cells.find((cell) => cell.date === date)!;

describe('a month is always whole', () => {
  it('has one cell for every day, so an empty day is quiet rather than missing', () => {
    const texture = build([]);
    expect(texture.cells).toHaveLength(31);
    expect(texture.cells[0].date).toBe('2026-08-01');
    expect(texture.cells[30].date).toBe('2026-08-31');
    // This is the whole reason the unit is a day. A photo-unit grid would have
    // rendered nothing here, and "nothing" is the opposite of what 우리 says.
    expect(texture.cells.every((cell) => !cell.hasRecord)).toBe(true);
  });

  it('knows how long February is', () => {
    const feb = buildMonthTexture({
      year: 2026, month: 2, records: [], events: [], trips: [], today: '2026-08-20',
    });
    expect(feb.cells).toHaveLength(28);
  });

  it('ignores records from other months', () => {
    const texture = build([
      record({ id: 'a', date: '2026-07-31' }),
      record({ id: 'b', date: '2026-09-01' }),
      record({ id: 'c', date: '2026-08-15' }),
    ]);
    expect(texture.recordCount).toBe(1);
    expect(cellOn(texture, '2026-08-15').hasRecord).toBe(true);
  });
});

describe('a private photo never becomes the picture of a day', () => {
  it('uses a shared photo', () => {
    const texture = build([
      record({ id: 'a', date: '2026-08-05', attachments: [photo] }),
    ]);
    expect(cellOn(texture, '2026-08-05').photo?.recordId).toBe('a');
  });

  it('refuses a private one, while still counting the day as lived', () => {
    const texture = build([
      record({ id: 'a', date: '2026-08-05', isPrivate: true, attachments: [photo] }),
    ]);
    const cell = cellOn(texture, '2026-08-05');
    expect(cell.photo).toBeNull();
    // The day is still marked. Withholding the picture is not erasing the day.
    expect(cell.hasRecord).toBe(true);
  });

  it('prefers the shared photo when the same day has both', () => {
    const texture = build([
      record({ id: 'priv', date: '2026-08-05', isPrivate: true, attachments: [photo] }),
      record({ id: 'shared', date: '2026-08-05', attachments: [photo] }),
    ]);
    expect(cellOn(texture, '2026-08-05').photo?.recordId).toBe('shared');
  });

  it('does not try to put a voice note in a square', () => {
    const texture = build([
      record({ id: 'a', date: '2026-08-05', attachments: [voice] }),
    ]);
    expect(cellOn(texture, '2026-08-05').photo).toBeNull();
    expect(texture.photoCount).toBe(0);
  });
});

describe('days both of them wrote', () => {
  it('needs two distinct authors, not two records', () => {
    const one = build([
      record({ id: 'a', date: '2026-08-10', userId: 'me' }),
      record({ id: 'b', date: '2026-08-10', userId: 'me' }),
    ]);
    expect(cellOn(one, '2026-08-10').bothWrote).toBe(false);
    expect(one.togetherCount).toBe(0);

    const two = build([
      record({ id: 'a', date: '2026-08-10', userId: 'me' }),
      record({ id: 'b', date: '2026-08-10', userId: 'them', authorRole: 'soldier' }),
    ]);
    expect(cellOn(two, '2026-08-10').bothWrote).toBe(true);
    expect(two.togetherCount).toBe(1);
  });

  it('falls back to author role when a queued record has no user id yet', () => {
    const texture = build([
      record({ id: 'a', date: '2026-08-10', authorRole: 'gomsin' }),
      record({ id: 'b', date: '2026-08-10', authorRole: 'soldier' }),
    ]);
    expect(cellOn(texture, '2026-08-10').bothWrote).toBe(true);
  });
});

describe('events and trips mark a day as special', () => {
  it('marks every day a multi-day event covers, not only its first', () => {
    const texture = build([], {
      events: [{
        id: 'e', coupleId: 'c', createdBy: 'me', title: '휴가', eventType: 'vacation',
        startDate: '2026-08-10', endDate: '2026-08-12', isPrivate: false,
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    });
    expect(cellOn(texture, '2026-08-10').special).toBe(true);
    expect(cellOn(texture, '2026-08-11').special).toBe(true);
    expect(cellOn(texture, '2026-08-12').special).toBe(true);
    expect(cellOn(texture, '2026-08-13').special).toBe(false);
  });

  it('marks the day they started', () => {
    // Included as a special DAY rather than by forcing its month into the list:
    // a month that holds only "the anniversary is somewhere in here" renders as
    // thirty-one grey cells, and the day itself is genuinely special anyway.
    const texture = buildMonthTexture({
      year: 2026, month: 8, records: [], events: [], trips: [],
      today: '2026-08-20', anniversary: '2026-08-03',
    });
    expect(cellOn(texture, '2026-08-03').special).toBe(true);
    expect(cellOn(texture, '2026-08-04').special).toBe(false);
  });

  it('treats a single-day event with no end date as covering that day', () => {
    const texture = build([], {
      events: [{
        id: 'e', coupleId: 'c', createdBy: 'me', title: '기념일', eventType: 'anniversary',
        startDate: '2026-08-14', isPrivate: false, createdAt: '2026-08-01T00:00:00.000Z',
      }],
    });
    expect(cellOn(texture, '2026-08-14').special).toBe(true);
  });
});

describe('which months exist', () => {
  const base = { events: [], trips: [], today: '2026-08-20' };

  it('always includes the month in progress, so day one is not an empty screen', () => {
    expect(monthsWithContent({ ...base, records: [] })).toEqual([{ year: 2026, month: 8 }]);
  });

  /**
   * An empty month is skipped, and that reversed an earlier decision.
   *
   * The first version returned a contiguous range, reasoning that a day-unit grid
   * has no holes. Rendering it showed two empty months as sixty identical grey
   * squares, which reads as "this relationship had nothing for two months" -- the
   * one thing 우리 must never say. Contiguity is genuinely lost; a wall of grey
   * cost more.
   */
  it('skips a month that holds nothing', () => {
    const months = monthsWithContent({
      ...base,
      records: [record({ id: 'a', date: '2026-06-11' })],
    });
    expect(months).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 6 },
    ]);
  });

  it('crosses a year boundary', () => {
    const months = monthsWithContent({
      ...base, today: '2026-01-15', records: [record({ id: 'a', date: '2025-11-02' })],
    });
    expect(months).toEqual([
      { year: 2026, month: 1 },
      { year: 2025, month: 11 },
    ]);
  });

  it('counts a month with only an event or a trip as holding something', () => {
    const months = monthsWithContent({
      ...base,
      records: [],
      events: [{
        id: 'e', coupleId: 'c', createdBy: 'me', title: '면회', eventType: 'visit',
        startDate: '2026-05-04', isPrivate: false, createdAt: '2026-05-01T00:00:00.000Z',
      }],
    });
    expect(months).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 5 },
    ]);
  });

  it('includes the anniversary month even before anything was written', () => {
    const months = monthsWithContent({ ...base, records: [], anniversary: '2026-06-01' });
    expect(months).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 6 },
    ]);
  });

  it('ignores a future date, because 우리 is the past and 일정 owns the rest', () => {
    const months = monthsWithContent({
      ...base,
      records: [],
      trips: [{
        id: 't', coupleId: 'c', createdBy: 'me', title: '제주',
        startDate: '2026-12-01', endDate: '2026-12-03', status: 'planned',
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    });
    expect(months).toEqual([{ year: 2026, month: 8 }]);
  });

  it('stays bounded for a very long relationship', () => {
    const months = monthsWithContent({ ...base, records: [record({ id: 'a', date: '2010-01-01' })] });
    expect(months.length).toBeLessThanOrEqual(60);
  });
});
