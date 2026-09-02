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
interface TalkAboutTopicBase {
  /** Exact original id. Never substitute a different record for this id. */
  recordId: string;
  /** Distinct users who marked this record, newest mark first. */
  markedBy: string[];
  /** Whether the viewer is one of them -- drives 표시 해제 vs 나도 표시. */
  markedByViewer: boolean;
  /** Whose active intention exists for this exact source record. */
  actorState: TalkAboutActorState;
  /** The newest mark's timestamp, for ordering. */
  latestAt: string;
}

export type TalkAboutTopic = TalkAboutTopicBase & (
  | {
    /** Exact readable original. */
    record: DailyRecord;
    unavailable: false;
  }
  | {
    /** A deleted original keeps only its opaque id so the couple can clear the stranded mark. */
    record?: undefined;
    unavailable: true;
  }
);

export type TalkAboutActorState = 'none' | 'mine' | 'partner_only' | 'both';

function actorStateFromMarks(
  marks: TalkAboutMark[],
  viewerUserId: string | undefined,
): TalkAboutActorState {
  const mine = Boolean(viewerUserId)
    && marks.some((mark) => mark.actorUserId === viewerUserId);
  const partner = marks.some((mark) => mark.actorUserId !== viewerUserId);
  if (mine && partner) return 'both';
  if (mine) return 'mine';
  if (partner) return 'partner_only';
  return 'none';
}

/** Actor state for one exact source, considering pending marks only. */
export function getTalkAboutActorState(
  marks: TalkAboutMark[],
  recordId: string,
  viewerUserId: string | undefined,
  now: Date = new Date(),
): TalkAboutActorState {
  return actorStateFromMarks(
    marks.filter((mark) => mark.recordId === recordId && isTalkAboutMarkActive(mark, now)),
    viewerUserId,
  );
}

function compareTimestampDesc(a: string, b: string): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(bTime) ? 1 : -1;
  return b.localeCompare(a);
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
    const sorted = [...recordMarks].sort(
      (a, b) => compareTimestampDesc(a.createdAt, b.createdAt)
        || a.actorUserId.localeCompare(b.actorUserId)
        || a.id.localeCompare(b.id),
    );
    const actorState = actorStateFromMarks(sorted, viewer.userId);
    const base: TalkAboutTopicBase = {
      recordId,
      markedBy: [...new Set(sorted.map((mark) => mark.actorUserId))],
      markedByViewer: actorState === 'mine' || actorState === 'both',
      actorState,
      latestAt: sorted[0].createdAt,
    };

    if (!record) {
      topics.push({ ...base, record: undefined, unavailable: true });
      continue;
    }
    if (record.isPrivate || record.contentUnavailable || !isVisibleToViewer(record, viewer)) {
      continue;
    }
    topics.push({ ...base, record, unavailable: false });
  }

  return topics.sort((a, b) => compareTimestampDesc(a.latestAt, b.latestAt)
    || a.recordId.localeCompare(b.recordId));
}

/** Whether the viewer has personally marked this record. */
export function isMarkedByViewer(
  marks: TalkAboutMark[],
  recordId: string,
  viewerUserId: string | undefined,
): boolean {
  const state = getTalkAboutActorState(marks, recordId, viewerUserId);
  return state === 'mine' || state === 'both';
}
