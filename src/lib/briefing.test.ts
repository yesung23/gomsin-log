import { describe, it, expect } from 'vitest';
import { generateDailySummary } from './briefing';
import { DailyRecord } from '@/types';

describe('briefing.ts', () => {
  it('generateDailySummary returns empty summary when no records', () => {
    const summary = generateDailySummary([], 'TestUser');
    expect(summary.items).toHaveLength(0);
    expect(summary.opener).toBeUndefined();
  });

  it('generateDailySummary creates summary items based on text logs', () => {
    const records: DailyRecord[] = [
      {
        id: '1',
        date: '2024-01-01',
        time: '10:00',
        authorRole: 'soldier',
        log: '오늘 아침 구보 뛰었는데 정말 힘들었다.',
        isPrivate: false,
        createdAt: '2024-01-01T10:00:00Z'
      }
    ];

    const summary = generateDailySummary(records, '철수');
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].text).toContain('철수'); // "철수이가 ~" 
    expect(summary.opener).toBeDefined();
  });
});
