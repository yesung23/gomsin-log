import type { DailyRecord, ReactionType } from '@/types';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';

export const CALL_BRIEFING_LOOKBACK_DAYS = 7;
export const CALL_BRIEFING_TOPIC_LIMIT = 3;

export interface CallBriefingTopic {
  recordId: string;
  date: string;
  time: string;
  text: string;
  reaction?: ReactionType;
  talkAbout?: boolean;
}

export interface CallBriefing {
  topics: CallBriefingTopic[];
  totalNewMoments: number;
  includedRecordIds: string[];
  mood: string | null;
  opener: string | null;
  newestCreatedAt?: string;
  rangeStart: string;
  rangeEnd: string;
}

export interface CallBriefingCheckpoint {
  confirmedRecordIds: string[];
  confirmedAt: string;
  /** Read-only compatibility with the first timestamp-only local format. */
  legacyCutoff?: string;
}

function compactText(value: string, maxLength = 82): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function fallbackText(record: DailyRecord): string {
  const kinds = new Set((record.attachments ?? []).map((attachment) => attachment.type));
  if (kinds.has('voice')) return '목소리로 남긴 이야기가 있어요.';
  if (kinds.has('video')) return '영상으로 남긴 순간이 있어요.';
  if (kinds.has('photo')) return '사진으로 남긴 순간이 있어요.';
  return '함께 확인할 순간을 남겼어요.';
}

function priority(record: DailyRecord): number {
  const reactionScore: Record<ReactionType, number> = {
    hard: 40,
    thought_of_you: 30,
    event: 20,
    good: 10,
  };
  return (record.talkAbout ? 100 : 0)
    + (record.reaction ? reactionScore[record.reaction] : 0)
    + (record.log.trim().includes('?') ? 8 : 0)
    + (record.attachments?.some((attachment) => attachment.type === 'voice') ? 4 : 0);
}

function timestamp(record: DailyRecord): number {
  const created = Date.parse(record.createdAt);
  if (Number.isFinite(created)) return created;
  return Date.parse(`${record.date}T${record.time || '00:00'}:00`);
}

function moodFor(records: DailyRecord[]): string | null {
  if (records.some((record) => record.reaction === 'hard')) {
    return '힘든 순간이 있었어요. 해결책보다 먼저 상태를 물어봐 주세요.';
  }
  if (records.some((record) => record.reaction === 'thought_of_you')) {
    return '서로를 떠올린 순간이 있었어요.';
  }
  if (records.some((record) => record.reaction === 'event')) {
    return '평소와 다른 일이 있었어요. 그 뒤 이야기를 이어가 보세요.';
  }
  if (records.some((record) => record.reaction === 'good')) {
    return '기분 좋은 순간이 있었어요. 무엇이 좋았는지 들어보세요.';
  }
  return records.length > 0 ? '최근에 나눈 순간을 차분히 이어가 보세요.' : null;
}

function openerFor(topic: CallBriefingTopic | undefined): string | null {
  if (!topic) return null;
  if (topic.reaction === 'hard') return `“${topic.text}” 이 일, 지금은 좀 괜찮아?`;
  if (topic.reaction === 'thought_of_you') return '나를 생각했던 순간부터 천천히 들려줄래?';
  if (topic.reaction === 'event') return `“${topic.text}” 그 뒤에는 어떻게 됐어?`;
  if (topic.reaction === 'good') return `“${topic.text}” 무엇이 제일 좋았어?`;
  return `“${topic.text}” 이 이야기부터 들려줄래?`;
}

/**
 * Compress the partner's shared moments into a one-minute, source-grounded call prep.
 *
 * This is deliberately deterministic and free: it quotes the author's own text,
 * never sends it to an AI service, and keeps every topic linked to its source row.
 * The caller can therefore understand context quickly without receiving an
 * invented interpretation of the partner's day.
 */
export function buildCallBriefing(
  records: DailyRecord[],
  todayStr: string,
  checkpoint?: CallBriefingCheckpoint | string | null,
): CallBriefing {
  const start = parseLocalDate(todayStr);
  start.setDate(start.getDate() - (CALL_BRIEFING_LOOKBACK_DAYS - 1));
  const rangeStart = toLocalDateString(start);
  const confirmedIds = new Set(
    typeof checkpoint === 'object' && checkpoint ? checkpoint.confirmedRecordIds : [],
  );
  const legacyCutoff = typeof checkpoint === 'string' ? checkpoint : checkpoint?.legacyCutoff;
  const checkpointTime = legacyCutoff ? Date.parse(legacyCutoff) : Number.NaN;

  const eligible = records
    .filter((record) => !record.isPrivate)
    .filter((record) => record.date >= rangeStart && record.date <= todayStr)
    .filter((record) => !confirmedIds.has(record.id))
    .filter((record) => !Number.isFinite(checkpointTime) || timestamp(record) > checkpointTime)
    .sort((a, b) => timestamp(a) - timestamp(b));

  const selected = [...eligible]
    .sort((a, b) => priority(b) - priority(a) || timestamp(b) - timestamp(a))
    .slice(0, CALL_BRIEFING_TOPIC_LIMIT)
    .sort((a, b) => timestamp(a) - timestamp(b));

  const topics = selected.map((record) => ({
    recordId: record.id,
    date: record.date,
    time: record.time,
    text: compactText(record.log) || fallbackText(record),
    reaction: record.reaction,
    talkAbout: record.talkAbout === true,
  }));
  const openerTarget = [...topics].reverse().find((topic) => topic.reaction === 'hard')
    ?? topics[topics.length - 1];
  const newest = eligible[eligible.length - 1];

  return {
    topics,
    totalNewMoments: eligible.length,
    includedRecordIds: eligible.map((record) => record.id),
    mood: moodFor(eligible),
    opener: openerFor(openerTarget),
    newestCreatedAt: newest?.createdAt,
    rangeStart,
    rangeEnd: todayStr,
  };
}

export function callBriefingCheckpointKey(userId: string, coupleId: string): string {
  return `gomsinlog.call-briefing.v1:${userId}:${coupleId}`;
}

export function readCallBriefingCheckpoint(userId: string, coupleId: string): CallBriefingCheckpoint | null {
  if (typeof localStorage === 'undefined' || !userId || !coupleId) return null;
  try {
    const value = localStorage.getItem(callBriefingCheckpointKey(userId, coupleId));
    if (!value) return null;
    // Compatibility with the first implementation. New writes use record IDs so
    // an offline record uploaded late is not hidden merely because its createdAt
    // predates the call.
    if (Number.isFinite(Date.parse(value))) {
      return { confirmedRecordIds: [], confirmedAt: value, legacyCutoff: value };
    }
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.confirmedRecordIds)
      || !candidate.confirmedRecordIds.every((id) => typeof id === 'string')
      || typeof candidate.confirmedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.confirmedAt))) return null;
    return {
      confirmedRecordIds: Array.from(new Set(candidate.confirmedRecordIds)).slice(-500),
      confirmedAt: candidate.confirmedAt,
    };
  } catch {
    return null;
  }
}

export function writeCallBriefingCheckpoint(
  userId: string,
  coupleId: string,
  checkpoint: CallBriefingCheckpoint,
): boolean {
  if (typeof localStorage === 'undefined'
    || !userId
    || !coupleId
    || !Number.isFinite(Date.parse(checkpoint.confirmedAt))) return false;
  try {
    localStorage.setItem(callBriefingCheckpointKey(userId, coupleId), JSON.stringify({
      confirmedRecordIds: Array.from(new Set(checkpoint.confirmedRecordIds)).slice(-500),
      confirmedAt: checkpoint.confirmedAt,
    }));
    return true;
  } catch {
    return false;
  }
}
