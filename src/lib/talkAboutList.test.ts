import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTalkAboutTopics, isMarkedByViewer } from '@/lib/talkAboutList';
import { isTalkAboutMarkActive } from '@/lib/talkAbout';
import type { DailyRecord, TalkAboutMark } from '@/types';

const ME = 'user-me';
const PARTNER = 'user-partner';
const COUPLE = 'couple-1';
const NOW = new Date('2026-08-13T12:00:00.000Z');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: ME,
    date: '2026-08-13',
    time: '10:00',
    authorRole: 'gomsin',
    log: '오늘 있었던 일',
    isPrivate: false,
    createdAt: '2026-08-13T10:00:00.000Z',
    ...overrides,
  };
}

function mark(overrides: Partial<TalkAboutMark> = {}): TalkAboutMark {
  return {
    id: 'mark-1',
    recordId: 'rec-1',
    coupleId: COUPLE,
    actorUserId: PARTNER,
    createdAt: '2026-08-13T11:00:00.000Z',
    isCompleted: false,
    ...overrides,
  };
}

const viewer = { userId: ME, role: 'gomsin' as const };

describe('buildTalkAboutTopics: the list is a join, not a copy', () => {
  it('renders a topic from the record, using the mark only as an id', () => {
    const topics = buildTalkAboutTopics([mark()], [record()], viewer, NOW);
    expect(topics).toHaveLength(1);
    // Everything a person reads comes from the record...
    expect(topics[0].record?.log).toBe('오늘 있었던 일');
    // ...and the mark contributed only attribution and time.
    expect(topics[0].markedBy).toEqual([PARTNER]);
    expect(topics[0].markedByViewer).toBe(false);
  });

  it('collapses both partners marking the same record into one topic', () => {
    const topics = buildTalkAboutTopics(
      [
        mark({ id: 'm1', actorUserId: PARTNER, createdAt: '2026-08-13T11:00:00.000Z' }),
        mark({ id: 'm2', actorUserId: ME, createdAt: '2026-08-13T11:30:00.000Z' }),
      ],
      [record()],
      viewer,
      NOW,
    );
    expect(topics).toHaveLength(1);
    expect(topics[0].markedBy).toHaveLength(2);
    expect(topics[0].markedByViewer).toBe(true);
    // Ordered by the newest mark on the topic.
    expect(topics[0].latestAt).toBe('2026-08-13T11:30:00.000Z');
  });

  it('orders topics by their most recent mark', () => {
    const topics = buildTalkAboutTopics(
      [
        mark({ id: 'm1', recordId: 'rec-old', createdAt: '2026-08-13T08:00:00.000Z' }),
        mark({ id: 'm2', recordId: 'rec-new', createdAt: '2026-08-13T11:00:00.000Z' }),
      ],
      [record({ id: 'rec-old' }), record({ id: 'rec-new' })],
      viewer,
      NOW,
    );
    expect(topics.map((topic) => topic.recordId)).toEqual(['rec-new', 'rec-old']);
  });
});

describe('buildTalkAboutTopics: nothing the viewer may not see', () => {
  /**
   * The important one. A stale mark pointing at a record this client cannot
   * resolve must produce a generic unavailable entry only. It must not use a
   * different record or expose source-derived content.
   */
  it('keeps an unavailable topic without fabricating source content', () => {
    const topics = buildTalkAboutTopics([mark({ recordId: 'rec-gone' })], [], viewer, NOW);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ recordId: 'rec-gone', unavailable: true, record: undefined });
  });

  it("keeps a generic unavailable topic for a partner's private record", () => {
    const privateRecord = record({ id: 'rec-1', userId: PARTNER, isPrivate: true });
    const topics = buildTalkAboutTopics([mark()], [privateRecord], viewer, NOW);
    expect(topics[0]).toMatchObject({ unavailable: true, record: undefined });
  });

  it("still shows the viewer's OWN private record when they marked it themselves", () => {
    const ownPrivate = record({ id: 'rec-1', userId: ME, isPrivate: true });
    const topics = buildTalkAboutTopics([mark({ actorUserId: ME })], [ownPrivate], viewer, NOW);
    expect(topics).toHaveLength(1);
  });

  it('keeps a pending mark regardless of its age', () => {
    const stale = mark({ createdAt: '2026-07-01T00:00:00.000Z' });
    expect(buildTalkAboutTopics([stale], [record()], viewer, NOW)).toHaveLength(1);
  });
});

describe('completion state', () => {
  it('hides only completed marks, not old or malformed dates', () => {
    expect(isTalkAboutMarkActive(mark({ createdAt: '2020-01-01T00:00:00.000Z' }), NOW)).toBe(true);
    expect(isTalkAboutMarkActive(mark({ createdAt: 'not-a-date' }), NOW)).toBe(true);
    expect(isTalkAboutMarkActive(mark({ isCompleted: true }), NOW)).toBe(false);
  });
});

describe('isMarkedByViewer', () => {
  it('is true only for the viewer\'s own mark on that record', () => {
    const marks = [mark({ actorUserId: PARTNER })];
    expect(isMarkedByViewer(marks, 'rec-1', ME)).toBe(false);
    expect(isMarkedByViewer([...marks, mark({ id: 'm2', actorUserId: ME })], 'rec-1', ME)).toBe(true);
    expect(isMarkedByViewer(marks, 'rec-other', PARTNER)).toBe(false);
  });

  it('is false with no viewer identity rather than throwing', () => {
    expect(isMarkedByViewer([mark()], 'rec-1', undefined)).toBe(false);
  });
});

describe('the coordination payload carries no record content', () => {
  /**
   * Structural, not behavioural: the write path must have nowhere to put a
   * topic string even if a future caller wanted to. Asserted against the
   * migration and the client module together, because either one growing a
   * text column would break the privacy claim.
   */
  it('the table has no free-text column at all', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/038_bilateral_talk_about_marks.sql'),
      'utf8',
    );
    const createTable = /CREATE TABLE IF NOT EXISTS public\.talk_about_marks \(([\s\S]*?)\n\);/
      .exec(migration);
    expect(createTable, 'the CREATE TABLE must be findable').not.toBeNull();
    const body = createTable![1];
    expect(body).not.toMatch(/\bTEXT\b/);
    expect(body).not.toMatch(/\bJSONB?\b/);
    expect(body).not.toMatch(/\bVARCHAR\b/);
    // Exactly the five columns the design allows.
    for (const column of ['id', 'record_id', 'couple_id', 'actor_user_id', 'created_at']) {
      expect(body).toContain(column);
    }
  });

  it('the client never sends anything but the three grantable columns', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/talkAbout.ts'), 'utf8');
    const insert = source.slice(source.indexOf('.upsert('), source.indexOf('if (error) {', source.indexOf('.upsert(')));
    expect(insert).toContain('record_id');
    expect(insert).toContain('couple_id');
    expect(insert).toContain('actor_user_id');
    // created_at is the server's; the column grant would reject it anyway.
    expect(insert).not.toContain('created_at');
    for (const forbidden of ['log', 'text', 'topic', 'note', 'summary', 'emotion', 'title']) {
      expect(insert.toLowerCase()).not.toContain(forbidden);
    }
  });
});
