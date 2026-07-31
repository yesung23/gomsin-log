import { describe, expect, it } from 'vitest';
import {
  activeCycleSupportSignal,
  buildCycleSupportPayload,
  buildMonthCalendarCells,
  calculateExpectedStartDate,
  cycleEntryOccursOnDate,
  cycleRangesOnDate,
  mapCycleSupportSignalRow,
  shiftCalendarMonth,
  validateCycleEntryDraft,
  validateCycleSettings,
} from '@/lib/cycle';
import type { CycleEntry, CycleSupportSignal } from '@/types';

function entry(overrides: Partial<CycleEntry> = {}): CycleEntry {
  return {
    id: 'entry-1',
    userId: 'owner-1',
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    symptoms: [],
    ...overrides,
  };
}

function signal(overrides: Partial<CycleSupportSignal> = {}): CycleSupportSignal {
  return {
    id: 'signal-1',
    coupleId: 'couple-1',
    ownerId: 'owner-1',
    kind: 'resting',
    sharedForDate: '2026-08-10',
    expiresAt: '2026-08-11T12:00:00.000Z',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('private cycle calendar helpers', () => {
  it('adds correct weekday leading cells and complete calendar rows', () => {
    const january = buildMonthCalendarCells(2026, 0);

    expect(january.slice(0, 4)).toEqual(Array(4).fill({ date: null, day: null }));
    expect(january[4]).toEqual({ date: '2026-01-01', day: 1 });
    expect(january.find((cell) => cell.day === 31)?.date).toBe('2026-01-31');
    expect(january.length % 7).toBe(0);
  });

  it('moves across years in both directions', () => {
    expect(shiftCalendarMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftCalendarMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it('detects every date in an inclusive period range', () => {
    const period = entry();

    expect(cycleEntryOccursOnDate(period, '2026-08-09')).toBe(false);
    expect(cycleEntryOccursOnDate(period, '2026-08-10')).toBe(true);
    expect(cycleEntryOccursOnDate(period, '2026-08-11')).toBe(true);
    expect(cycleEntryOccursOnDate(period, '2026-08-12')).toBe(true);
    expect(cycleEntryOccursOnDate(period, '2026-08-13')).toBe(false);
    expect(cycleRangesOnDate([period], '2026-08-10')[0]).toMatchObject({
      isStart: true,
      isEnd: false,
    });
  });

  it('calculates a simple expected start from the latest start only', () => {
    const startsOnly = [
      { startDate: '2026-07-01' },
      { startDate: '2026-08-10' },
    ];

    expect(calculateExpectedStartDate(startsOnly, 28)).toBe('2026-09-07');
    expect(calculateExpectedStartDate([
      entry({ startDate: '2026-08-10', endDate: '2026-08-11' }),
    ], 28)).toBe(calculateExpectedStartDate([
      entry({ startDate: '2026-08-10', endDate: '2026-08-25' }),
    ], 28));
  });

  it('validates required dates, date order, allowed symptoms, and SQL bounds', () => {
    expect(validateCycleEntryDraft({ startDate: '', symptoms: [] })).toContain('시작일');
    expect(validateCycleEntryDraft({
      startDate: '2026-08-10',
      endDate: '2026-08-09',
      symptoms: [],
    })).toContain('종료일');
    expect(validateCycleEntryDraft({
      startDate: '2026-08-10',
      symptoms: ['fatigue'],
    })).toBeNull();
    expect(validateCycleSettings(14, 5)).not.toBeNull();
    expect(validateCycleSettings(61, 5)).not.toBeNull();
    expect(validateCycleSettings(28, 0)).not.toBeNull();
    expect(validateCycleSettings(28, 16)).not.toBeNull();
    expect(validateCycleSettings(28, 5)).toBeNull();
  });
});

describe('sanitized support signal boundary', () => {
  it('builds an exact payload that cannot carry raw cycle fields', () => {
    const input = {
      coupleId: 'couple-1',
      kind: 'would_like_support' as const,
      sharedForDate: '2026-08-10',
      message: '잠깐 응원해 주세요',
      startDate: 'private-start',
      endDate: 'private-end',
      symptoms: ['private-symptom'],
      notes: 'private-notes',
      prediction: 'private-prediction',
      cycleEntryId: 'private-entry',
    };
    const payload = buildCycleSupportPayload(
      input,
      'owner-1',
      new Date('2026-08-10T00:00:00.000Z'),
    );

    expect(payload).toEqual({
      couple_id: 'couple-1',
      owner_id: 'owner-1',
      kind: 'would_like_support',
      message: '잠깐 응원해 주세요',
      shared_for_date: '2026-08-10',
      expires_at: '2026-08-11T00:00:00.000Z',
    });
    expect(Object.keys(payload || {})).not.toEqual(expect.arrayContaining([
      'startDate',
      'endDate',
      'symptoms',
      'notes',
      'prediction',
      'cycleEntryId',
    ]));
    expect(buildCycleSupportPayload({
      coupleId: 'couple-1',
      kind: 'resting',
      sharedForDate: '2026-08-10',
      expiresAt: '2026-08-12T00:00:00.000Z',
    }, 'owner-1', new Date('2026-08-10T00:00:00.000Z'))).toBeNull();
  });

  it('maps the support UI model without raw fields even if a row contains extras', () => {
    const mapped = mapCycleSupportSignalRow({
      id: 'signal-1',
      couple_id: 'couple-1',
      owner_id: 'owner-1',
      kind: 'resting',
      message: null,
      shared_for_date: '2026-08-10',
      expires_at: '2026-08-11T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z',
      start_date: 'private-start',
      end_date: 'private-end',
      symptoms: ['private-symptom'],
      notes: 'private-notes',
      prediction: 'private-prediction',
      cycle_entry_id: 'private-entry',
    });

    expect(Object.keys(mapped).sort()).toEqual([
      'coupleId',
      'createdAt',
      'expiresAt',
      'id',
      'kind',
      'message',
      'ownerId',
      'revokedAt',
      'sharedForDate',
      'updatedAt',
    ]);
  });

  it('shows only active, non-revoked signals for today', () => {
    expect(activeCycleSupportSignal(
      [signal()],
      '2026-08-10',
      '2026-08-10T12:00:00.000Z',
    )?.id).toBe('signal-1');
    expect(activeCycleSupportSignal(
      [signal({ revokedAt: '2026-08-10T10:00:00.000Z' })],
      '2026-08-10',
      '2026-08-10T12:00:00.000Z',
    )).toBeNull();
    expect(activeCycleSupportSignal(
      [signal()],
      '2026-08-11',
      '2026-08-10T12:00:00.000Z',
    )).toBeNull();
  });
});
