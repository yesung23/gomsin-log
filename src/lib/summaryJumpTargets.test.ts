import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { summaryTargetRecordId } from '@/lib/briefing';
import type { DailySummary, SummaryItem } from '@/types';

/**
 * The home-screen half of the jump-to-record promise.
 *
 * `recordJumpToHighlighted.test.tsx` proves the destination works. This proves the
 * three widgets that display a summary actually name a destination, which none of
 * them did: all called `navigate('/record')` and nothing else.
 */

function read(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function item(id: string, recordIds: string[]): SummaryItem {
  return { id, text: `요약 ${id}`, recordIds, kind: 'moment' };
}

function summary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    date: '2026-07-31',
    items: [],
    totalSharedCount: 0,
    ...overrides,
  };
}

describe('summaryTargetRecordId picks what the widget is actually showing', () => {
  it('prefers the opener, because that is the headline on screen', () => {
    expect(summaryTargetRecordId(summary({
      opener: item('open', ['rec-opener']),
      items: [item('a', ['rec-item'])],
    }))).toBe('rec-opener');
  });

  it('falls back to the first item, which is what the widget falls back to', () => {
    expect(summaryTargetRecordId(summary({
      items: [item('a', ['rec-item']), item('b', ['rec-other'])],
    }))).toBe('rec-item');
  });

  it('returns undefined rather than guessing when the summary names no record', () => {
    expect(summaryTargetRecordId(summary())).toBeUndefined();
    expect(summaryTargetRecordId(summary({ items: [item('a', [])] }))).toBeUndefined();
  });
});

describe('every home summary hands the record page a destination', () => {
  it('오늘의 브리핑 targets the record it summarises', () => {
    const source = read('src/lib/widgetComponents.tsx');
    expect(source).toContain('const target = summaryTargetRecordId(summary) ?? partnerShared[0]?.id;');
    expect(source).toContain('if (target) setHighlightedRecordId(target);');
  });

  it('오늘의 요약 targets the record it summarises', () => {
    const source = read('src/components/widgets/PartnerEmotionWidgets.tsx');
    expect(source).toContain('const target = summaryTargetRecordId(summary) ?? todays[0]?.id;');
    expect(source).toContain('if (target) setHighlightedRecordId(target);');
  });

  it('마음 흐름 targets the start of the day it describes', () => {
    // A flow is about the whole day rather than one entry, so the first record is
    // the honest target: it is where reading the day chronologically begins.
    const source = read('src/components/widgets/PartnerEmotionWidgets.tsx');
    expect(source).toContain('firstRecordId: todays[0]?.id');
    expect(source).toContain('if (firstRecordId) setHighlightedRecordId(firstRecordId);');
  });

  it('PRESERVATION: 추억 다시보기 still targets the memory it found', () => {
    // This one always called the store action; what was missing was a page that
    // acted on it.
    expect(read('src/lib/widgetComponents.tsx')).toContain('setHighlightedRecordId(first.id);');
  });

  it('PRESERVATION: 기록 모아보기 stays a plain shortcut with no target', () => {
    // It summarises nothing, so inventing a destination would be a guess.
    const source = read('src/lib/widgetComponents.tsx');
    const shortcut = source.slice(
      source.indexOf('export const RecordShortcutWidget'),
      source.indexOf('export const ServiceProgressWidget'),
    );
    expect(shortcut).toContain("navigate('/record')");
    expect(shortcut).not.toContain('setHighlightedRecordId');
  });
});
