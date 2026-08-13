import { describe, expect, it } from 'vitest';

import { buildCallBriefing } from '@/lib/callBriefing';
import { generateDailySummary } from '@/lib/briefing';
import { isRecordContentAvailable, withReadableContent } from '@/lib/recordAvailability';
import type { DailyRecord } from '@/types';

const TODAY = '2026-08-14';

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: overrides.id ?? 'r1',
    date: TODAY,
    time: '10:00',
    authorRole: 'soldier',
    log: '오늘 훈련이 힘들었어',
    isPrivate: false,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

describe('content availability', () => {
  it('treats a normal record as readable', () => {
    expect(isRecordContentAvailable(record())).toBe(true);
  });

  it('treats an undecryptable record as unreadable', () => {
    expect(isRecordContentAvailable(record({ contentUnavailable: 'undecryptable' }))).toBe(false);
    expect(isRecordContentAvailable(record({ contentUnavailable: 'key_unavailable' }))).toBe(false);
  });

  it('filters while preserving order', () => {
    const records = [
      record({ id: 'a' }),
      record({ id: 'b', contentUnavailable: 'key_unavailable' }),
      record({ id: 'c' }),
    ];
    expect(withReadableContent(records).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('the daily summary never speaks for a record it cannot read', () => {
  it('produces no item for an undecryptable record', () => {
    const summary = generateDailySummary(
      [record({ id: 'locked', log: '', contentUnavailable: 'key_unavailable' })],
      '수빈',
    );
    expect(summary.items).toEqual([]);
    expect(summary.totalSharedCount).toBe(0);
  });

  it('does not let an undecryptable record become a mood claim', () => {
    // `reaction` is a plaintext column for a legacy row, but an encrypted row's
    // reaction lives inside the envelope. A row that failed to decrypt must not
    // contribute a mood item from whatever happens to be on the row.
    const summary = generateDailySummary(
      [record({ id: 'locked', log: '', reaction: 'hard', contentUnavailable: 'undecryptable' })],
      '수빈',
    );
    expect(summary.items).toEqual([]);
  });

  it('still summarises the readable records alongside an unreadable one', () => {
    const summary = generateDailySummary([
      record({ id: 'open', log: '보고 싶어', reaction: 'thought_of_you' }),
      record({ id: 'locked', log: '', contentUnavailable: 'key_unavailable' }),
    ], '수빈');
    expect(summary.totalSharedCount).toBe(1);
    expect(JSON.stringify(summary.items)).not.toContain('locked');
  });
});

describe('the call briefing never invents a topic for an unreadable record', () => {
  it('omits an undecryptable record instead of using the media fallback text', () => {
    const briefing = buildCallBriefing(
      [record({ id: 'locked', log: '', contentUnavailable: 'undecryptable' })],
      TODAY,
    );
    expect(briefing.topics).toEqual([]);
    expect(briefing.totalNewMoments).toBe(0);
  });

  it('does not claim a photo moment for a record whose attachments never decrypted', () => {
    const briefing = buildCallBriefing([
      record({
        id: 'locked',
        log: '',
        attachments: [{ type: 'photo', name: 'x.jpg', path: 'c/r/x.jpg' }],
        contentUnavailable: 'key_unavailable',
      }),
    ], TODAY);
    expect(briefing.topics).toEqual([]);
    expect(JSON.stringify(briefing)).not.toContain('사진으로 남긴 순간이 있어요');
  });

  it('keeps the readable topics', () => {
    const briefing = buildCallBriefing([
      record({ id: 'open', log: '오늘 눈이 왔어' }),
      record({ id: 'locked', log: '', contentUnavailable: 'undecryptable' }),
    ], TODAY);
    expect(briefing.topics.map((topic) => topic.recordId)).toEqual(['open']);
  });
});
