import { describe, it, expect } from 'vitest';
import { generateDailySummary, generateEmotionFlowBriefing } from './briefing';
import { DailyRecord } from '@/types';

describe('briefing.ts', () => {
  it('generateDailySummary returns empty summary when no records', () => {
    const summary = generateDailySummary([], 'TestUser');
    expect(summary.items).toHaveLength(0);
    expect(summary.opener).toBeUndefined();
  });

  it('skips the summary card when there is only one shared record', () => {
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
    expect(summary.items).toHaveLength(0);
    expect(summary.opener).toBeUndefined();
    expect(summary.totalSharedCount).toBe(1);
  });

  it('creates a grounded summary when there are at least two shared records', () => {
    const records: DailyRecord[] = [
      {
        id: '1',
        date: '2024-01-01',
        time: '10:00',
        authorRole: 'gomsin',
        log: '오늘 아침 일이 많아서 정말 힘들었다.',
        reaction: 'hard',
        isPrivate: false,
        createdAt: '2024-01-01T10:00:00Z',
      },
      {
        id: '2',
        date: '2024-01-01',
        time: '12:00',
        authorRole: 'gomsin',
        log: '점심을 먹고 조금 나아졌다.',
        isPrivate: false,
        createdAt: '2024-01-01T12:00:00Z',
      },
    ];

    const summary = generateDailySummary(records, '철수');
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].text).toContain('철수');
    expect(summary.items[0].recordIds).toEqual(['1']);
    expect(summary.opener).toBeDefined();
    expect(summary.opener?.recordIds).toEqual(['1']);
  });

  it('never uses private records in a daily summary', () => {
    const records: DailyRecord[] = [
      {
        id: 'private-1',
        date: '2024-01-01',
        time: '09:00',
        authorRole: 'gomsin',
        log: '상대에게 보이면 안 되는 비공개 기록',
        reaction: 'hard',
        isPrivate: true,
        createdAt: '2024-01-01T09:00:00Z',
      },
      {
        id: 'shared-1',
        date: '2024-01-01',
        time: '10:00',
        authorRole: 'gomsin',
        log: '공유 기록 하나',
        isPrivate: false,
        createdAt: '2024-01-01T10:00:00Z',
      },
    ];

    const summary = generateDailySummary(records, '철수');
    expect(summary.totalSharedCount).toBe(1);
    expect(summary.items).toHaveLength(0);
    expect(summary.opener).toBeUndefined();
  });

  it('uses only user-confirmed shared emotions in the soldier briefing', () => {
    const records: DailyRecord[] = [
      {
        id: 'private-emotion',
        date: '2024-01-01',
        time: '09:00',
        authorRole: 'gomsin',
        log: '비공개 감정',
        isPrivate: true,
        emotionFlow: [
          {
            sequence: 1,
            group: 'sadness',
            displayLabel: '속상함',
            source: 'user_confirmed',
            visibility: 'shared',
          },
        ],
        createdAt: '2024-01-01T09:00:00Z',
      },
      {
        id: 'shared-emotion',
        date: '2024-01-01',
        time: '10:00',
        authorRole: 'gomsin',
        log: '공유 감정',
        isPrivate: false,
        emotionFlow: [
          {
            sequence: 1,
            group: 'concern',
            displayLabel: '걱정',
            source: 'rule_suggested',
            visibility: 'shared',
          },
          {
            sequence: 2,
            group: 'joy',
            displayLabel: '행복',
            source: 'user_confirmed',
            visibility: 'shared',
          },
          {
            sequence: 3,
            group: 'love',
            displayLabel: '그리움',
            source: 'user_confirmed',
            visibility: 'author_only',
          },
        ],
        createdAt: '2024-01-01T10:00:00Z',
      },
    ];

    expect(generateEmotionFlowBriefing(records)).toEqual({
      recordId: 'shared-emotion',
      flowText: '오늘의 마음: 행복',
      labels: ['행복'],
    });
  });
});
