import type { DailyRecord } from '@/types';
import { DEFAULT_DIARY_PAPER, isDiaryPaperId, type DiaryPaperId } from './papers';

export type DiaryPageLayout = 'journal' | 'photo-first' | 'compact';

export interface DiaryPagePlan {
  version: 1;
  paperId: DiaryPaperId;
  layout: DiaryPageLayout;
  order: string[];
  excluded: string[];
}

const KEY_PREFIX = 'gomsin.diary.page.';
export const DEFAULT_DIARY_LAYOUT: DiaryPageLayout = 'journal';

function storageKey(userId: string, date: string): string {
  return `${KEY_PREFIX}${userId}.${date}`;
}

function isLayout(value: unknown): value is DiaryPageLayout {
  return value === 'journal' || value === 'photo-first' || value === 'compact';
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

export function createDiaryPagePlan(paperId: DiaryPaperId = DEFAULT_DIARY_PAPER): DiaryPagePlan {
  return { version: 1, paperId, layout: DEFAULT_DIARY_LAYOUT, order: [], excluded: [] };
}

export function loadDiaryPagePlan(
  userId: string,
  date: string,
  defaultPaper: DiaryPaperId = DEFAULT_DIARY_PAPER,
): DiaryPagePlan {
  const fallback = createDiaryPagePlan(defaultPaper);
  if (!userId || !date || typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(storageKey(userId, date));
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const candidate = parsed as Record<string, unknown>;
    return {
      version: 1,
      paperId: isDiaryPaperId(candidate.paperId) ? candidate.paperId : defaultPaper,
      layout: isLayout(candidate.layout) ? candidate.layout : DEFAULT_DIARY_LAYOUT,
      order: stringIds(candidate.order),
      excluded: stringIds(candidate.excluded),
    };
  } catch {
    return fallback;
  }
}

export function saveDiaryPagePlan(userId: string, date: string, plan: DiaryPagePlan): void {
  if (!userId || !date || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId, date), JSON.stringify({
      version: 1,
      paperId: plan.paperId,
      layout: plan.layout,
      order: stringIds(plan.order),
      excluded: stringIds(plan.excluded),
    }));
  } catch {
    // Original DailyRecord content remains the source of truth even when decoration persistence fails.
  }
}

function chronological(records: readonly DailyRecord[]): DailyRecord[] {
  return [...records].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const byTime = (a.time || '').localeCompare(b.time || '');
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

export function resolveDiaryPageRecords(records: readonly DailyRecord[], plan: DiaryPagePlan): DailyRecord[] {
  const source = chronological(records);
  const byId = new Map(source.map((record) => [record.id, record]));
  const excluded = new Set(plan.excluded);
  const used = new Set<string>();
  const result: DailyRecord[] = [];

  for (const id of plan.order) {
    const record = byId.get(id);
    if (!record || excluded.has(id) || used.has(id)) continue;
    result.push(record);
    used.add(id);
  }
  for (const record of source) {
    if (used.has(record.id) || excluded.has(record.id)) continue;
    result.push(record);
    used.add(record.id);
  }
  return result;
}

export function setRecordIncluded(plan: DiaryPagePlan, recordId: string, included: boolean): DiaryPagePlan {
  const excluded = new Set(plan.excluded);
  if (included) excluded.delete(recordId);
  else excluded.add(recordId);
  return { ...plan, excluded: [...excluded] };
}

export function moveDiaryRecord(
  plan: DiaryPagePlan,
  visibleRecords: readonly DailyRecord[],
  recordId: string,
  delta: -1 | 1,
): DiaryPagePlan {
  const next = [...visibleRecords];
  const from = next.findIndex((record) => record.id === recordId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= next.length) return { ...plan, order: next.map((record) => record.id) };
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...plan, order: next.map((record) => record.id) };
}
