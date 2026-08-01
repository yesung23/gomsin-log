import { describe, it, expect } from 'vitest';
import {
  isAuthorOnly,
  isOwnRecord,
  splitEmotionFlow,
  emotionFlowForStorage,
  stripTransientFields,
  isVisibleToViewer,
  sanitizeRecordForViewer,
  visibleRecordsForViewer,
} from '@/lib/privacy';
import type { DailyRecord, EmotionFlowItem } from '@/types';

const ME = 'user-me';
const PARTNER = 'user-partner';

function item(overrides: Partial<EmotionFlowItem> = {}): EmotionFlowItem {
  return {
    id: overrides.id ?? 'flow-1',
    group: overrides.group ?? 'joy',
    displayLabel: overrides.displayLabel ?? '기쁨',
    sequence: overrides.sequence ?? 1,
    source: overrides.source ?? 'user_confirmed',
    visibility: overrides.visibility ?? 'shared',
    ...overrides,
  } as EmotionFlowItem;
}

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: overrides.id ?? 'rec-1',
    userId: overrides.userId,
    date: overrides.date ?? '2026-07-31',
    time: overrides.time ?? '10:00',
    authorRole: overrides.authorRole ?? 'gomsin',
    log: overrides.log ?? '오늘의 기록',
    isPrivate: overrides.isPrivate ?? false,
    attachments: overrides.attachments,
    emotionFlow: overrides.emotionFlow,
    createdAt: overrides.createdAt ?? '2026-07-31T10:00:00.000Z',
    ...overrides,
  } as DailyRecord;
}

describe('isAuthorOnly', () => {
  it('treats author_only and hidden as not shareable', () => {
    expect(isAuthorOnly(item({ visibility: 'author_only' }))).toBe(true);
    expect(isAuthorOnly(item({ visibility: 'hidden' }))).toBe(true);
  });

  it('treats shared and legacy undefined as shareable', () => {
    expect(isAuthorOnly(item({ visibility: 'shared' }))).toBe(false);
    expect(isAuthorOnly(item({ visibility: undefined }))).toBe(false);
  });
});

describe('isOwnRecord', () => {
  it('prefers userId when both sides have one', () => {
    expect(isOwnRecord(record({ userId: ME }), { userId: ME, role: 'gomsin' })).toBe(true);
    expect(isOwnRecord(record({ userId: PARTNER }), { userId: ME, role: 'gomsin' })).toBe(false);
  });

  it('does not confuse two accounts that happen to share a role', () => {
    // Role alone is ambiguous after a role switch; userId must win.
    expect(
      isOwnRecord(record({ userId: PARTNER, authorRole: 'gomsin' }), { userId: ME, role: 'gomsin' }),
    ).toBe(false);
  });

  it('falls back to authorRole for local/demo records without a userId', () => {
    expect(isOwnRecord(record({ userId: undefined, authorRole: 'gomsin' }), { role: 'gomsin' })).toBe(true);
    expect(isOwnRecord(record({ userId: undefined, authorRole: 'soldier' }), { role: 'gomsin' })).toBe(false);
  });

  it('is not own when the viewer has no identity at all', () => {
    expect(isOwnRecord(record({ userId: ME }), {})).toBe(false);
  });
});

describe('splitEmotionFlow', () => {
  it('separates author-only items out of a shared record', () => {
    const result = splitEmotionFlow({
      isPrivate: false,
      emotionFlow: [
        item({ id: 'a', visibility: 'shared' }),
        item({ id: 'b', visibility: 'author_only' }),
        item({ id: 'c', visibility: 'hidden' }),
      ],
    });
    expect(result.shareable.map((i) => i.id)).toEqual(['a']);
    expect(result.authorOnly.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('keeps everything on a private record, which the partner cannot read anyway', () => {
    const flow = [item({ id: 'a', visibility: 'shared' }), item({ id: 'b', visibility: 'author_only' })];
    const result = splitEmotionFlow({ isPrivate: true, emotionFlow: flow });
    expect(result.shareable).toHaveLength(2);
    expect(result.authorOnly).toHaveLength(0);
  });

  it('handles a missing emotion flow', () => {
    expect(splitEmotionFlow({ isPrivate: false, emotionFlow: undefined })).toEqual({
      shareable: [],
      authorOnly: [],
    });
  });
});

describe('emotionFlowForStorage', () => {
  it('never lets an author-only item into a shared row', () => {
    const stored = emotionFlowForStorage({
      isPrivate: false,
      emotionFlow: [item({ id: 'a', visibility: 'shared' }), item({ id: 'b', visibility: 'author_only' })],
    });
    expect(stored.map((i) => i.id)).toEqual(['a']);
    expect(stored.some(isAuthorOnly)).toBe(false);
  });

  it('preserves author-only items on a private row', () => {
    const stored = emotionFlowForStorage({
      isPrivate: true,
      emotionFlow: [item({ id: 'b', visibility: 'author_only' })],
    });
    expect(stored.map((i) => i.id)).toEqual(['b']);
  });
});

describe('stripTransientFields', () => {
  it('removes matchedText from items that have it', () => {
    const items = [item({ id: 'a', matchedText: '보고 싶다' })];
    const result = stripTransientFields(items);
    expect(result[0]).not.toHaveProperty('matchedText');
    expect(result[0].id).toBe('a');
    expect(result[0].displayLabel).toBe('기쁨');
  });

  it('passes through items without matchedText unchanged', () => {
    const items = [item({ id: 'b' })];
    const result = stripTransientFields(items);
    expect(result[0]).not.toHaveProperty('matchedText');
    expect(result[0].id).toBe('b');
  });

  it('handles nested arrays with mixed items', () => {
    const items = [
      item({ id: 'a', matchedText: '슬퍼' }),
      item({ id: 'b' }),
      item({ id: 'c', matchedText: '힘들어' }),
    ];
    const result = stripTransientFields(items);
    expect(result).toHaveLength(3);
    expect(result.every((i) => !('matchedText' in i))).toBe(true);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(stripTransientFields([])).toEqual([]);
  });
});

describe('emotionFlowForStorage strips matchedText', () => {
  it('removes matchedText from the persisted flow', () => {
    const stored = emotionFlowForStorage({
      isPrivate: false,
      emotionFlow: [
        item({ id: 'a', visibility: 'shared', matchedText: '기뻐' }),
        item({ id: 'b', visibility: 'shared' }),
      ],
    });
    expect(stored.every((i) => !('matchedText' in i))).toBe(true);
    expect(stored.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('isVisibleToViewer', () => {
  const viewer = { userId: ME, role: 'gomsin' as const };

  it('shows my own records, private or not', () => {
    expect(isVisibleToViewer(record({ userId: ME, isPrivate: true }), viewer)).toBe(true);
    expect(isVisibleToViewer(record({ userId: ME, isPrivate: false }), viewer)).toBe(true);
  });

  it("shows the partner's shared records but hides their private ones", () => {
    expect(isVisibleToViewer(record({ userId: PARTNER, isPrivate: false }), viewer)).toBe(true);
    expect(isVisibleToViewer(record({ userId: PARTNER, isPrivate: true }), viewer)).toBe(false);
  });
});

describe('sanitizeRecordForViewer', () => {
  const viewer = { userId: ME, role: 'gomsin' as const };

  it('returns my own record untouched, including author-only items', () => {
    const mine = record({
      userId: ME,
      emotionFlow: [item({ id: 'a', visibility: 'author_only' })],
    });
    expect(sanitizeRecordForViewer(mine, viewer)).toBe(mine);
  });

  it("removes author-only items from the partner's shared record", () => {
    const theirs = record({
      userId: PARTNER,
      isPrivate: false,
      emotionFlow: [
        item({ id: 'a', visibility: 'shared' }),
        item({ id: 'b', visibility: 'author_only' }),
      ],
    });
    const sanitized = sanitizeRecordForViewer(theirs, viewer);
    expect(sanitized.emotionFlow?.map((i) => i.id)).toEqual(['a']);
    // The rest of the record is preserved.
    expect(sanitized.log).toBe(theirs.log);
  });

  it("reduces the partner's private record to a skeleton if it ever leaks through", () => {
    const leaked = record({
      userId: PARTNER,
      isPrivate: true,
      log: '아무에게도 말하지 않은 이야기',
      attachments: [{ type: 'photo', name: 'secret.jpg', path: 'c/r/secret.jpg' }],
      emotionFlow: [item({ id: 'a', visibility: 'author_only' })],
    });
    const sanitized = sanitizeRecordForViewer(leaked, viewer);
    expect(sanitized.log).toBe('');
    expect(sanitized.attachments).toEqual([]);
    expect(sanitized.emotionFlow).toEqual([]);
    // Identity/timestamps are kept so the timeline can still show "비공개 기록".
    expect(sanitized.isPrivate).toBe(true);
    expect(sanitized.id).toBe(leaked.id);
  });

  it('leaves a fully shareable record as-is', () => {
    const clean = record({ userId: PARTNER, emotionFlow: [item({ visibility: 'shared' })] });
    expect(sanitizeRecordForViewer(clean, viewer)).toBe(clean);
  });
});

describe('visibleRecordsForViewer', () => {
  it('filters and sanitizes in one pass', () => {
    const viewer = { userId: ME, role: 'gomsin' as const };
    const feed = visibleRecordsForViewer(
      [
        record({ id: 'mine-private', userId: ME, isPrivate: true }),
        record({ id: 'mine-shared', userId: ME, isPrivate: false }),
        record({ id: 'theirs-shared', userId: PARTNER, isPrivate: false, emotionFlow: [item({ id: 'x', visibility: 'author_only' })] }),
        record({ id: 'theirs-private', userId: PARTNER, isPrivate: true }),
      ],
      viewer,
    );

    expect(feed.map((r) => r.id)).toEqual(['mine-private', 'mine-shared', 'theirs-shared']);
    const partnerRecord = feed.find((r) => r.id === 'theirs-shared');
    expect(partnerRecord?.emotionFlow).toEqual([]);
  });

  it('works for demo records that have no userId', () => {
    const feed = visibleRecordsForViewer(
      [
        record({ id: 'mine', userId: undefined, authorRole: 'gomsin', isPrivate: true }),
        record({ id: 'theirs', userId: undefined, authorRole: 'soldier', isPrivate: true }),
      ],
      { role: 'gomsin' },
    );
    // My own private demo record stays; the partner's private one is filtered out.
    expect(feed.map((r) => r.id)).toEqual(['mine']);
  });
});
