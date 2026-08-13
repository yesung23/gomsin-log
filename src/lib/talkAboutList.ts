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
  record: DailyRecord;
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
    const record = byId.get(mark.recordId);
    // Unresolvable, or resolvable but not something this viewer may see.
    // `isVisibleToViewer` is the same helper every record surface uses, so a
    // private record can never reach this list through a stale mark.
    if (!record || !isVisibleToViewer(record, viewer)) continue;
    const bucket = grouped.get(mark.recordId);
    if (bucket) bucket.push(mark);
    else grouped.set(mark.recordId, [mark]);
  }

  const topics: TalkAboutTopic[] = [];
  for (const [recordId, recordMarks] of grouped) {
    const record = byId.get(recordId)!;
    const sorted = [...recordMarks].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    topics.push({
      record,
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
