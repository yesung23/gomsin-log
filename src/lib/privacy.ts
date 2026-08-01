import type { DailyRecord, EmotionFlowItem, Role } from '@/types';

/**
 * Privacy rules for records that cross the couple boundary.
 *
 * Two independent levels of privacy exist:
 *
 * 1. Record level -- `isPrivate`. Enforced server-side by RLS: the partner's
 *    "read shared records" policy requires `is_private = false`.
 *
 * 2. Emotion-item level -- `EmotionFlowItem.visibility`. The rule engine marks
 *    sensitive emotion groups (shame, guilt, ...) as `author_only` EVEN FOR A
 *    SHARED RECORD (emotionRuleEngine.ts). Nothing enforced this, so such items
 *    were written into the shared row's `emotion_flow` JSON and downloaded by
 *    the partner's client.
 *
 * The helpers below keep author-only items out of shared rows on write, and
 * defensively drop them on read for records the viewer did not author.
 */

/**
 * Who is looking at a record.
 *
 * `userId` is authoritative when both sides have one. Demo and offline records
 * are created locally and have no `userId`, so `role` acts as the fallback
 * identity for those.
 */
export interface Viewer {
  userId?: string;
  role?: Role;
}

export function isAuthorOnly(item: EmotionFlowItem): boolean {
  // Anything not explicitly shared is treated as not shareable. `undefined` is
  // treated as shared only because legacy rows predate the field.
  return item.visibility === 'author_only' || item.visibility === 'hidden';
}

/** Whether `record` was written by `viewer`. */
export function isOwnRecord(
  record: Pick<DailyRecord, 'userId' | 'authorRole'>,
  viewer: Viewer,
): boolean {
  if (viewer.userId && record.userId) return record.userId === viewer.userId;
  // No server identity available (demo / offline): fall back to the author role.
  return !!viewer.role && record.authorRole === viewer.role;
}

/**
 * Split a record's emotion flow into the part that may live in the shared row
 * and the part that must stay author-only.
 */
export function splitEmotionFlow(record: Pick<DailyRecord, 'isPrivate' | 'emotionFlow'>): {
  shareable: EmotionFlowItem[];
  authorOnly: EmotionFlowItem[];
} {
  const items = record.emotionFlow || [];

  // A private record is already invisible to the partner, so nothing needs to
  // be split out of it.
  if (record.isPrivate) return { shareable: items, authorOnly: [] };

  return {
    shareable: items.filter((item) => !isAuthorOnly(item)),
    authorOnly: items.filter(isAuthorOnly),
  };
}

/**
 * Remove transient analysis fields that must never be persisted.
 *
 * `matchedText` is the substring of user input that triggered an emotion rule.
 * It is useful for UI highlighting during composition but storing it would leak
 * the raw input fragment into an otherwise aggregated emotion row.
 */
export function stripTransientFields(items: EmotionFlowItem[]): EmotionFlowItem[] {
  return items.map(({ matchedText: _discarded, ...rest }) => rest);
}

/**
 * What actually gets written into `daily_records.emotion_flow`.
 * For a shared record this excludes author-only items, and transient analysis
 * fields (like matchedText) are always stripped regardless of privacy level.
 */
export function emotionFlowForStorage(
  record: Pick<DailyRecord, 'isPrivate' | 'emotionFlow'>,
): EmotionFlowItem[] {
  return stripTransientFields(splitEmotionFlow(record).shareable);
}

/**
 * Whether a record may appear in the viewer's feed at all.
 * Own records are always visible; the partner's are only visible when shared.
 */
export function isVisibleToViewer(record: DailyRecord, viewer: Viewer): boolean {
  return isOwnRecord(record, viewer) || !record.isPrivate;
}

/**
 * Strip anything the viewer is not entitled to see from a single record.
 *
 * Defence in depth: even if a server row still carries author-only items
 * (legacy data written before this fix), the partner's UI never renders them.
 */
export function sanitizeRecordForViewer(record: DailyRecord, viewer: Viewer): DailyRecord {
  if (isOwnRecord(record, viewer)) return record;

  // A private record belonging to someone else should never have reached this
  // client. Reduce it to a skeleton instead of rendering another person's
  // private content.
  if (record.isPrivate) {
    return {
      id: record.id,
      userId: record.userId,
      date: record.date,
      time: record.time,
      authorRole: record.authorRole,
      log: '',
      isPrivate: true,
      attachments: [],
      emotionFlow: [],
      createdAt: record.createdAt,
    };
  }

  if (!record.emotionFlow?.length) return record;
  const shareable = record.emotionFlow.filter((item) => !isAuthorOnly(item));
  if (shareable.length === record.emotionFlow.length) return record;
  return { ...record, emotionFlow: shareable };
}

/** Apply {@link sanitizeRecordForViewer} to a list of records. */
export function sanitizeRecordsForViewer(records: DailyRecord[], viewer: Viewer): DailyRecord[] {
  return records.map((record) => sanitizeRecordForViewer(record, viewer));
}

/**
 * The feed a viewer is allowed to see: their own records plus the partner's
 * shared ones, with author-only fragments removed.
 */
export function visibleRecordsForViewer(records: DailyRecord[], viewer: Viewer): DailyRecord[] {
  return records
    .filter((record) => isVisibleToViewer(record, viewer))
    .map((record) => sanitizeRecordForViewer(record, viewer));
}
