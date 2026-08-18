import type { DailyRecord, TalkAboutMark } from '@/types';
import { isTalkAboutMarkActive } from '@/lib/talkAbout';
import { isVisibleToViewer, type Viewer } from '@/lib/privacy';

/**
 * Build "오늘 이야기할 것" from marks plus the records the viewer already has.
 *
 * The join happens HERE, on the client, against already-authorized record
 * data -- which is the reason `talk_about_marks` can be metadata-only. A mark
 * contributes an id; the record contributes everything a person actually
 * reads. Nothing is fetched or derived from the mark itself.
 *
 * A mark whose record the viewer cannot resolve is dropped silently. That
 * covers a deleted record (the row cascades away server-side, but a client
 * holding a stale mark list must not render a ghost), and a record that is
 * simply not in this client's slice. Dropping is the safe direction: the
 * alternative is an entry that announces "something exists here" without
 * being able to say what, which is exactly the hidden-record-existence leak
 * PRODUCT_V3 §6.4 rules out.
 */
export interface TalkAboutTopic {
  /** Exact original id. Never substitute a different record for this id. */
  recordId: string;
  /** Present only when the viewer may still read this exact original. */
  record?: DailyRecord;
  /** An unavailable source never exposes record-derived content. */
  unavailable: boolean;
  /** Distinct users who marked this record, newest mark first. */
  markedBy: string[];
  /** Whether the viewer is one of them -- drives 표시 해제 vs 나도 표시. */
  markedByViewer: boolean;
  /** The newest mark's timestamp, for ordering. */
  latestAt: string;
}

export function buildTalkAboutTopics(
  marks: TalkAboutMark[],
  records: DailyRecord[],
  viewer: Viewer,
  now: Date = new Date(),
): TalkAboutTopic[] {
  const byId = new Map(records.map((record) => [record.id, record] as const));
  const grouped = new Map<string, TalkAboutMark[]>();

  for (const mark of marks) {
    if (!isTalkAboutMarkActive(mark, now)) continue;
    const bucket = grouped.get(mark.recordId);
    if (bucket) bucket.push(mark);
    else grouped.set(mark.recordId, [mark]);
  }

  const topics: TalkAboutTopic[] = [];
  for (const [recordId, recordMarks] of grouped) {
    const record = byId.get(recordId);
    const visibleRecord = record && isVisibleToViewer(record, viewer) ? record : undefined;
    const sorted = [...recordMarks].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    topics.push({
      recordId,
      record: visibleRecord,
      unavailable: !visibleRecord,
      markedBy: [...new Set(sorted.map((mark) => mark.actorUserId))],
      markedByViewer: viewer.userId
        ? sorted.some((mark) => mark.actorUserId === viewer.userId)
        : false,
      latestAt: sorted[0].createdAt,
    });
  }

  return topics.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

/** Whether the viewer has personally marked this record. */
export function isMarkedByViewer(
  marks: TalkAboutMark[],
  recordId: string,
  viewerUserId: string | undefined,
): boolean {
  if (!viewerUserId) return false;
  return marks.some(
    (mark) => mark.recordId === recordId && mark.actorUserId === viewerUserId,
  );
}
