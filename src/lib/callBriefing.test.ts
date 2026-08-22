import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildCallBriefing,
  callBriefingCheckpointKey,
  readCallBriefingCheckpoint,
  writeCallBriefingCheckpoint,
} from '@/lib/callBriefing';
import type { DailyRecord } from '@/types';

function record(overrides: Partial<DailyRecord> & Pick<DailyRecord, 'id' | 'date' | 'createdAt'>): DailyRecord {
  return {
    time: '18:00',
    authorRole: 'gomsin',
    log: '평범한 하루를 보냈어',
    isPrivate: false,
    ...overrides,
  };
}

describe('buildCallBriefing', () => {
  it('keeps only the last seven days and quotes at most three grounded topics', () => {
    const records = [
      record({ id: 'old', date: '2026-07-31', createdAt: '2026-07-31T09:00:00Z' }),
      record({ id: 'a', date: '2026-08-01', createdAt: '2026-08-01T09:00:00Z', reaction: 'good', log: '산책해서 기뻤어' }),
      record({ id: 'b', date: '2026-08-03', createdAt: '2026-08-03T09:00:00Z', reaction: 'event', log: '새 프로젝트가 시작됐어' }),
      record({ id: 'c', date: '2026-08-06', createdAt: '2026-08-06T09:00:00Z', reaction: 'thought_of_you', log: '네 생각이 났어' }),
      record({ id: 'd', date: '2026-08-07', createdAt: '2026-08-07T09:00:00Z', reaction: 'hard', log: '오늘 일이 정말 힘들었어' }),
    ];

    const result = buildCallBriefing(records, '2026-08-07');
    expect(result.totalNewMoments).toBe(4);
    expect(result.topics).toHaveLength(3);
    expect(result.topics.map((topic) => topic.recordId)).toEqual(['b', 'c', 'd']);
    expect(result.opener).toContain('오늘 일이 정말 힘들었어');
    expect(result.rangeStart).toBe('2026-08-01');
  });

  it('excludes private and already-confirmed moments', () => {
    const result = buildCallBriefing([
      record({ id: 'seen', date: '2026-08-06', createdAt: '2026-08-06T10:00:00Z' }),
      record({ id: 'private', date: '2026-08-07', createdAt: '2026-08-07T10:00:00Z', isPrivate: true, log: '비공개' }),
      record({ id: 'new', date: '2026-08-07', createdAt: '2026-08-07T11:00:00Z', log: '새로운 이야기' }),
    ], '2026-08-07', {
      confirmedRecordIds: ['seen'],
      confirmedAt: '2026-08-07T10:30:00Z',
    });

    expect(result.totalNewMoments).toBe(1);
    expect(result.topics[0].recordId).toBe('new');
    expect(JSON.stringify(result)).not.toContain('비공개');
  });
});

describe('call briefing checkpoint', () => {
  beforeEach(() => localStorage.clear());

  it('is scoped to the viewer and couple and rejects malformed values', () => {
    const value = { confirmedRecordIds: ['record-a'], confirmedAt: '2026-08-07T10:00:00Z' };
    expect(writeCallBriefingCheckpoint('soldier-a', 'couple-a', value)).toBe(true);
    expect(readCallBriefingCheckpoint('soldier-a', 'couple-a')).toEqual(value);
    expect(readCallBriefingCheckpoint('soldier-b', 'couple-a')).toBeNull();

    localStorage.setItem(callBriefingCheckpointKey('soldier-a', 'couple-a'), 'broken');
    expect(readCallBriefingCheckpoint('soldier-a', 'couple-a')).toBeNull();
  });
});
