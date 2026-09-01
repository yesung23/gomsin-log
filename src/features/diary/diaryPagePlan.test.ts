import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types';
import {
  createDiaryPagePlan,
  loadDiaryPagePlan,
  moveDiaryRecord,
  resolveDiaryPageRecords,
  saveDiaryPagePlan,
  setRecordIncluded,
} from './diaryPagePlan';

function record(id: string, time: string, log = `content-${id}`): DailyRecord {
  return {
    id,
    userId: 'u1',
    date: '2026-09-01',
    time,
    authorRole: 'gomsin',
    log,
    isPrivate: false,
    createdAt: `2026-09-01T${time}:00.000Z`,
  } as DailyRecord;
}

beforeEach(() => localStorage.clear());

describe('diary page plan', () => {
  it('stores decoration metadata only, never record content fields', () => {
    const records = [record('r1', '09:00', 'VERY_PRIVATE_SENTENCE')];
    let plan = createDiaryPagePlan('grid');
    plan = { ...plan, order: records.map((item) => item.id), excluded: [] };
    saveDiaryPagePlan('u1', '2026-09-01', plan);

    const raw = localStorage.getItem('gomsin.diary.page.u1.2026-09-01');
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['excluded', 'layout', 'order', 'paperId', 'version']);
    expect(raw).not.toContain('VERY_PRIVATE_SENTENCE');
    expect(raw).not.toContain('createdAt');
    expect(raw).not.toContain('userId');
  });

  it('appends records created after a saved order instead of dropping them', () => {
    const a = record('a', '09:00');
    const b = record('b', '10:00');
    const plan = { ...createDiaryPagePlan(), order: ['a'] };
    expect(resolveDiaryPageRecords([a, b], plan).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('excludes and re-includes one record without deleting source data', () => {
    const a = record('a', '09:00');
    let plan = setRecordIncluded(createDiaryPagePlan(), 'a', false);
    expect(resolveDiaryPageRecords([a], plan)).toEqual([]);
    plan = setRecordIncluded(plan, 'a', true);
    expect(resolveDiaryPageRecords([a], plan).map((item) => item.id)).toEqual(['a']);
  });

  it('moves records deterministically and uses id as same-time tie break', () => {
    const a = record('a', '09:00');
    const b = record('b', '09:00');
    const initial = resolveDiaryPageRecords([b, a], createDiaryPagePlan());
    expect(initial.map((item) => item.id)).toEqual(['a', 'b']);
    const moved = moveDiaryRecord(createDiaryPagePlan(), initial, 'b', -1);
    expect(resolveDiaryPageRecords([a, b], moved).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('falls back safely from malformed local data', () => {
    localStorage.setItem('gomsin.diary.page.u1.2026-09-01', '{bad json');
    expect(loadDiaryPagePlan('u1', '2026-09-01', 'cream')).toMatchObject({
      paperId: 'cream', layout: 'journal', order: [], excluded: [],
    });
  });
});
