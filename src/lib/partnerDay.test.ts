import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DailyRecord } from '@/types';
import type { Viewer } from '@/lib/privacy';
import { toLocalDateString } from '@/lib/utils';
import {
  advancePartnerDayCheckpoint,
  missedPartnerRecords,
  partnerDayCheckpointKey,
  partnerDayDateLabel,
  partnerDayWindow,
  readPartnerDayCheckpoint,
  spansBeforeToday,
  writePartnerDayCheckpoint,
  type PartnerDayCheckpoint,
} from '@/lib/partnerDay';

/**
 * The contract under test is one sentence of PRODUCT_V3 §6.5:
 *
 *   구간: 마지막 확인점 이후, 없으면 최근 7일, 상한 오늘.
 *
 * Two failure directions are NOT symmetric. Showing a record twice costs the
 * viewer a second glance; hiding one they never saw defeats the reason the
 * product exists ("놓친 하루의 맥락을 복구", §1.11). Every ambiguous case below is
 * therefore asserted to resolve towards showing more, never towards hiding.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const TODAY = '2026-08-19';
const VIEWER: Viewer = { userId: ME, role: 'soldier' };

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function checkpoint(overrides: Partial<PartnerDayCheckpoint> = {}): PartnerDayCheckpoint {
  return {
    confirmedRecordIds: [],
    confirmedThrough: TODAY,
    confirmedAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

const ids = (records: DailyRecord[]) => records.map((r) => r.id);

describe('partnerDayWindow: 마지막 확인점 이후, 없으면 최근 7일, 상한 오늘', () => {
  it('falls back to a seven-day window including today when there is no checkpoint', () => {
    expect(partnerDayWindow(null, TODAY)).toEqual({ since: '2026-08-13', until: TODAY });
  });

  it('uses the checkpoint date as an inclusive lower bound', () => {
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2026-08-17' }), TODAY))
      .toEqual({ since: '2026-08-17', until: TODAY });
  });

  it('caps the upper bound at today regardless of the checkpoint', () => {
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2026-07-01' }), TODAY).until)
      .toBe(TODAY);
  });

  it('never lets a future-dated checkpoint swallow the window', () => {
    // A restored backup or a wrong device clock could write tomorrow's date.
    // Clamping to today keeps today's records visible instead of hiding them all.
    expect(partnerDayWindow(checkpoint({ confirmedThrough: '2099-01-01' }), TODAY))
      .toEqual({ since: TODAY, until: TODAY });
  });
});

describe('missedPartnerRecords: which records are in the missed window', () => {
  it('no checkpoint: returns the last seven days and nothing older', () => {
    const inside = record({ id: 'inside', date: '2026-08-13' });
    const outside = record({ id: 'outside', date: '2026-08-12' });
    expect(ids(missedPartnerRecords([inside, outside], VIEWER, TODAY, null)))
      .toEqual(['inside']);
  });

  it('today checkpoint: still shows a later record from the same day', () => {
    // The bound is a DATE, so an afternoon record must survive a morning receipt.
    const later = record({ id: 'later', time: '18:00' });
    expect(ids(missedPartnerRecords([later], VIEWER, TODAY, checkpoint())))
      .toEqual(['later']);
  });

  it('yesterday checkpoint: recovers yesterday and today', () => {
    const window = [
      record({ id: 'older', date: '2026-08-17' }),
      record({ id: 'yesterday', date: '2026-08-18' }),
      record({ id: 'today', date: TODAY }),
    ];
    expect(ids(missedPartnerRecords(window, VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-08-18' }))))
      .toEqual(['yesterday', 'today']);
  });

  it('three-day-old checkpoint: recovers every day since, oldest first', () => {
    const window = [
      record({ id: 'd3', date: '2026-08-19' }),
      record({ id: 'd1', date: '2026-08-16' }),
      record({ id: 'd2', date: '2026-08-17' }),
    ];
    expect(ids(missedPartnerRecords(window, VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-08-16' }))))
      .toEqual(['d1', 'd2', 'd3']);
  });

  it('checkpoint older than seven days: honours the checkpoint, not the fallback', () => {
    // §6.5 caps the FALLBACK at seven days. An explicit checkpoint is the real
    // lower bound, so a three-week absence still recovers three weeks.
    const old = record({ id: 'old', date: '2026-07-30' });
    expect(ids(missedPartnerRecords([old], VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-07-29' }))))
      .toEqual(['old']);
    expect(ids(missedPartnerRecords([old], VIEWER, TODAY, null))).toEqual([]);
  });

  it('drops records already acknowledged by id, keeping the rest of that day', () => {
    const seen = record({ id: 'seen', time: '09:00' });
    const unseen = record({ id: 'unseen', time: '10:00' });
    const cp = checkpoint({ confirmedRecordIds: ['seen'] });
    expect(ids(missedPartnerRecords([seen, unseen], VIEWER, TODAY, cp))).toEqual(['unseen']);
  });

  it('excludes a future-dated record instead of pinning it to the window', () => {
    // `record.date >= since` alone admitted it. It is not missed context, and it
    // would sort to the end of the timeline claiming to be the latest news.
    const future = record({ id: 'future', date: '2026-08-20' });
    const today = record({ id: 'today' });
    expect(ids(missedPartnerRecords([future, today], VIEWER, TODAY, null))).toEqual(['today']);
    expect(ids(missedPartnerRecords([future, today], VIEWER, TODAY, checkpoint())))
      .toEqual(['today']);
  });

  it('orders by date then time so a multi-day window reads chronologically', () => {
    const window = [
      record({ id: 'today-early', date: TODAY, time: '08:00' }),
      record({ id: 'yesterday-late', date: '2026-08-18', time: '23:00' }),
      record({ id: 'yesterday-early', date: '2026-08-18', time: '07:00' }),
    ];
    expect(ids(missedPartnerRecords(window, VIEWER, TODAY, null)))
      .toEqual(['yesterday-early', 'yesterday-late', 'today-early']);
  });

  describe('widening time must not widen authorization (§6.3)', () => {
    it("never returns the partner's private record, on any day of the window", () => {
      const privateToday = record({ id: 'p-today', isPrivate: true });
      const privateOlder = record({ id: 'p-older', date: '2026-08-15', isPrivate: true });
      expect(missedPartnerRecords([privateToday, privateOlder], VIEWER, TODAY, null)).toEqual([]);
    });

    it("never returns the viewer's own records", () => {
      const mine = record({ id: 'mine', userId: ME, authorRole: 'soldier' });
      expect(missedPartnerRecords([mine], VIEWER, TODAY, null)).toEqual([]);
    });

    it('a private record does not affect the count of what is missed', () => {
      const shared = record({ id: 'shared' });
      const secret = record({ id: 'secret', date: '2026-08-16', isPrivate: true });
      const withSecret = missedPartnerRecords([shared, secret], VIEWER, TODAY, null);
      const withoutSecret = missedPartnerRecords([shared], VIEWER, TODAY, null);
      expect(withSecret.length).toBe(withoutSecret.length);
      expect(ids(withSecret)).toEqual(['shared']);
    });
  });
});

describe('advancePartnerDayCheckpoint: only an explicit acknowledgement moves it', () => {
  it('acknowledging nothing produces no checkpoint at all', () => {
    expect(advancePartnerDayCheckpoint(null, [])).toBeNull();
  });

  it('records the acknowledged ids and the newest acknowledged date', () => {
    const next = advancePartnerDayCheckpoint(null, [
      record({ id: 'a', date: '2026-08-17' }),
      record({ id: 'b', date: '2026-08-18' }),
    ], [], new Date('2026-08-19T10:00:00.000Z'));
    expect(next).toEqual({
      confirmedRecordIds: ['a', 'b'],
      confirmedThrough: '2026-08-18',
      confirmedAt: '2026-08-19T10:00:00.000Z',
    });
  });

  it('accumulates ids across acknowledgements', () => {
    const first = advancePartnerDayCheckpoint(null, [record({ id: 'a' })])!;
    const second = advancePartnerDayCheckpoint(first, [record({ id: 'b' })])!;
    expect(second.confirmedRecordIds.sort()).toEqual(['a', 'b']);
  });

  it('lets the bound move back for a late older record, because that direction is safe', () => {
    // This used to be floored at the previous bound to avoid "reopening a settled
    // window". That flooring is what could strand unseen records: the days between
    // the older acknowledgement and the old bound may hold things nobody saw.
    // Reopening them is harmless -- everything actually acknowledged is held out by
    // id -- so what comes back is exactly what was never confirmed.
    const first = advancePartnerDayCheckpoint(null, [record({ id: 'a', date: '2026-08-18' })])!;
    const second = advancePartnerDayCheckpoint(first, [record({ id: 'late', date: '2026-08-15' })])!;
    expect(second.confirmedThrough).toBe('2026-08-15');
    expect(second.confirmedRecordIds.sort()).toEqual(['a', 'late']);

    // The reopened span surfaces the unseen record and NOT the acknowledged ones.
    const seen = record({ id: 'a', date: '2026-08-18' });
    const neverSeen = record({ id: 'unseen', date: '2026-08-16' });
    expect(ids(missedPartnerRecords([seen, neverSeen], VIEWER, TODAY, second)))
      .toEqual(['unseen']);
  });

  it('stops the bound at the earliest record still outstanding', () => {
    const acknowledged = [record({ id: 'r2', date: '2026-08-16' }), record({ id: 'r3', date: '2026-08-17' })];
    const window = [record({ id: 'locked', date: '2026-08-15' }), ...acknowledged];
    const next = advancePartnerDayCheckpoint(null, acknowledged, window)!;
    expect(next.confirmedThrough).toBe('2026-08-15');
  });

  it('advances to the newest acknowledged date when nothing is outstanding', () => {
    const acknowledged = [record({ id: 'r1', date: '2026-08-16' }), record({ id: 'r2', date: '2026-08-17' })];
    const next = advancePartnerDayCheckpoint(null, acknowledged, acknowledged)!;
    expect(next.confirmedThrough).toBe('2026-08-17');
  });

  /**
   * The regression that matters most: acknowledging the visible prefix of a long
   * window must not consume the part the viewer never saw.
   */
  it('acknowledging the visible five of twenty keeps the other fifteen', () => {
    const all = Array.from({ length: 20 }, (_, i) => record({
      id: `rec-${String(i).padStart(2, '0')}`,
      date: '2026-08-17',
      time: `${String(i).padStart(2, '0')}:00`,
    }));
    const window = missedPartnerRecords(all, VIEWER, TODAY, checkpoint({ confirmedThrough: '2026-08-17' }));
    expect(window).toHaveLength(20);

    const visible = window.slice(0, 5);
    const next = advancePartnerDayCheckpoint(checkpoint({ confirmedThrough: '2026-08-17' }), visible)!;
    const remaining = missedPartnerRecords(all, VIEWER, TODAY, next);

    expect(remaining).toHaveLength(15);
    expect(ids(remaining)[0]).toBe('rec-05');
    // Nothing the viewer had not reached was consumed.
    expect(ids(remaining)).not.toContain('rec-04');
  });
});

describe('checkpoint storage is scoped to one viewer and one couple', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('keys by viewer and couple', () => {
    expect(partnerDayCheckpointKey('user-a', 'couple-a'))
      .toBe('gomsinlog.partner-day.v1:user-a:couple-a');
  });

  it('round-trips a checkpoint', () => {
    expect(writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint({ confirmedRecordIds: ['x'] })))
      .toBe(true);
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toEqual({
      confirmedRecordIds: ['x'],
      confirmedThrough: TODAY,
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    });
  });

  it("account A's receipt does not suppress account B on the same device", () => {
    writePartnerDayCheckpoint('user-a', 'couple-a', checkpoint({ confirmedRecordIds: ['x'] }));
    expect(readPartnerDayCheckpoint('user-b', 'couple-a')).toBeNull();
  });

  it("a previous couple's receipt does not suppress a new couple", () => {
    writePartnerDayCheckpoint('user-a', 'couple-old', checkpoint({ confirmedRecordIds: ['x'] }));
    expect(readPartnerDayCheckpoint('user-a', 'couple-new')).toBeNull();
  });

  it('an unlinked viewer with no couple id neither reads nor writes a receipt', () => {
    expect(writePartnerDayCheckpoint('user-a', '', checkpoint())).toBe(false);
    expect(readPartnerDayCheckpoint('user-a', '')).toBeNull();
  });

  it('a corrupt receipt degrades to showing more, not less', () => {
    localStorage.setItem(partnerDayCheckpointKey('user-a', 'couple-a'), 'not json');
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toBeNull();
  });

  it('rejects a stored receipt whose bound is not a real date', () => {
    localStorage.setItem(
      partnerDayCheckpointKey('user-a', 'couple-a'),
      JSON.stringify({ confirmedRecordIds: [], confirmedThrough: 'yesterday', confirmedAt: TODAY }),
    );
    expect(readPartnerDayCheckpoint('user-a', 'couple-a')).toBeNull();
  });
});

describe('copy inputs: what the window is allowed to claim', () => {
  it('reports a window that reaches before today', () => {
    expect(spansBeforeToday([record({ date: '2026-08-18' })], TODAY)).toBe(true);
  });

  it('reports a today-only window as today-only even though the window is 7 days wide', () => {
    expect(spansBeforeToday([record({ date: TODAY })], TODAY)).toBe(false);
    expect(spansBeforeToday([], TODAY)).toBe(false);
  });

  it('labels today with no date, yesterday as 어제, and older by date', () => {
    expect(partnerDayDateLabel(TODAY, TODAY)).toBeNull();
    expect(partnerDayDateLabel('2026-08-18', TODAY)).toBe('어제');
    expect(partnerDayDateLabel('2026-08-15', TODAY)).toBe('8월 15일');
  });

  it('labels across a month boundary without arithmetic on the string', () => {
    vi.useFakeTimers();
    expect(partnerDayDateLabel('2026-07-31', '2026-08-01')).toBe('어제');
    vi.useRealTimers();
  });
});

describe('local date semantics', () => {
  it('derives the fallback window from the local date, not a UTC instant', () => {
    // Late evening in +09:00 is still the previous UTC day. A UTC-based bound
    // would move the whole window a day and drop the oldest day of it.
    const localDate = toLocalDateString(new Date(2026, 7, 19, 23, 30));
    expect(localDate).toBe('2026-08-19');
    expect(partnerDayWindow(null, localDate).since).toBe('2026-08-13');
  });
});

describe('a record this device cannot read yet is not consumed by acknowledging around it', () => {
  it('still shows a locked older record once its key arrives', () => {
    // The soldier's new device cannot decrypt the 15th yet, so only the 16th and
    // 17th are drawn and only those can be acknowledged. If the bound advanced to
    // the 17th, the 15th would be gone for good the moment provisioning completed.
    const unreadable = record({ id: 'locked', date: '2026-08-15', contentUnavailable: true });
    const r2 = record({ id: 'r2', date: '2026-08-16' });
    const r3 = record({ id: 'r3', date: '2026-08-17' });

    // Exactly what the widget passes: the readable prefix, plus the whole window.
    const next = advancePartnerDayCheckpoint(null, [r2, r3], [unreadable, r2, r3])!;
    expect(next.confirmedThrough).toBe('2026-08-15');

    const afterProvisioning = [{ ...unreadable, contentUnavailable: false }, r2, r3];
    const remaining = missedPartnerRecords(afterProvisioning, VIEWER, TODAY, next);

    expect(ids(remaining)).toEqual(['locked']);
  });

  it('a record arriving later on the confirmed date is still shown', () => {
    // The late-sync case: an offline record uploaded after the acknowledgement,
    // dated the same day the bound sits on. The bound is inclusive for this reason.
    const acked = record({ id: 'acked', date: '2026-08-18', time: '09:00' });
    const next = advancePartnerDayCheckpoint(null, [acked], [acked])!;
    const late = record({ id: 'late', date: '2026-08-18', time: '23:00' });
    expect(ids(missedPartnerRecords([acked, late], VIEWER, TODAY, next))).toEqual(['late']);
  });
});

describe('the id cap can only ever reveal more, never less', () => {
  it('keeps the newest 500 confirmations and drops the oldest', () => {
    const many = Array.from({ length: 520 }, (_, i) => record({ id: `r-${String(i).padStart(4, '0')}` }));
    const next = advancePartnerDayCheckpoint(null, many, many)!;
    expect(next.confirmedRecordIds).toHaveLength(520);

    // The cap is applied by the storage layer, which is where the quota lives.
    writePartnerDayCheckpoint('user-a', 'couple-a', next);
    const stored = readPartnerDayCheckpoint('user-a', 'couple-a')!;
    expect(stored.confirmedRecordIds).toHaveLength(500);
    expect(stored.confirmedRecordIds).toContain('r-0519');
    expect(stored.confirmedRecordIds).not.toContain('r-0000');
    localStorage.clear();
  });

  it('an evicted id resurfaces its record rather than hiding it', () => {
    // Eviction removes an EXCLUSION, so the only possible effect is showing a
    // record a second time. There is no arrangement of the cap that hides one.
    const evicted = record({ id: 'evicted' });
    const cp = checkpoint({ confirmedRecordIds: [], confirmedThrough: TODAY });
    expect(ids(missedPartnerRecords([evicted], VIEWER, TODAY, cp))).toEqual(['evicted']);
  });
});
