import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Film, Image as ImageIcon, Mic } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { localToday, toLocalDateString } from '@/lib/utils';
import { AttachmentMedia } from '@/components/AttachmentMedia';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Attachment, DailyRecord } from '@/types';

/**
 * 상대방의 오늘 — the partner's day, in the order it happened.
 *
 * README section 1.4 states the point of the 군화 home in one sentence: "폰을
 * 받거나 접속했을 때 상대방의 오늘 순간들을 시간순(사진, 영상, 음성, 텍스트)으로 있는
 * 그대로 감상합니다."
 *
 * Nothing on that home did it. `partner_emotion_flow` shows emotion labels,
 * `partner_emotion_summary` a one-line headline, `care_hint` a suggested opener,
 * and `today_word` is the composer plus the viewer's OWN entries. Every one of
 * them is a description of the day. The day itself was only reachable by leaving
 * home for the 기록 tab.
 *
 * So this widget shows the moments, not a summary of them: each entry in time
 * order with its text and its media playable in place, through the same
 * `AttachmentMedia` the 기록 screen uses -- which means a voice note can be heard
 * without leaving home, and an expired signed URL re-signs itself here too.
 *
 * Reads ONLY what the viewer is entitled to see. `visibleRecordsForViewer` is
 * applied here as well as in the store, and a private entry cannot reach it.
 */

const REACTION_LABELS: Record<string, string> = {
  good: '😊 좋았어',
  event: '💬 이런 일이 있었어',
  hard: '🥹 힘들었어',
  thought_of_you: '💌 네 생각났어',
};

const KIND_ICON = {
  photo: ImageIcon,
  video: Film,
  voice: Mic,
} as const;

/**
 * How many moments the card shows before deferring to the 기록 tab.
 *
 * A home widget has to stay glanceable, and this one is a list that grows with
 * however much the partner shared. Five is the judgement call: enough that an
 * ordinary day is complete on the home screen, few enough that a heavy day does
 * not push every other widget off it. The rest are not hidden -- the footer says
 * how many there are and goes to them.
 */
export const PARTNER_DAY_VISIBLE_LIMIT = 5;

/** Media kinds present on a record, in a stable order, for the badge row. */
function mediaKinds(attachments: Attachment[] | undefined): Attachment['type'][] {
  const present = new Set((attachments ?? []).map((attachment) => attachment.type));
  return (['photo', 'video', 'voice'] as const).filter((kind) => present.has(kind));
}

export function PartnerDayTimelineWidget() {
  const { state, sharedSyncStatus, setHighlightedRecordId } = useStore();
  const navigate = useNavigate();
  const { profile } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  const todayStr = toLocalDateString(localToday());

  const todays = useMemo(() => {
    const viewer = { userId: profile.id, role: profile.role };
    return visibleRecordsForViewer(state.records, viewer)
      .filter((record) => record.date === todayStr
        && !isOwnRecord(record, viewer)
        && !record.isPrivate)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }, [state.records, profile.id, profile.role, todayStr]);

  const visible = todays.slice(0, PARTNER_DAY_VISIBLE_LIMIT);
  const hiddenCount = todays.length - visible.length;

  const openRecord = (record: DailyRecord) => {
    setHighlightedRecordId(record.id);
    navigate('/record');
  };

  const header = (
    <h3 className="text-heading text-foreground mb-2 flex items-center gap-1.5">
      <Clock size={14} className="text-coral-strong" aria-hidden="true" />
      {partnerName}의 오늘
    </h3>
  );

  /*
    The workspace being unconfirmed OUTRANKS an empty list. During that window --
    a couple of seconds on every cold load with no realtime socket -- `records`
    is empty for a reason that is NOT "she shared nothing today", and saying so
    would be a false statement about the user's own data. The same rule
    `EmotionFlowSummarySection` follows.
  */
  if (sharedSyncStatus === 'unavailable') {
    return (
      <div data-testid="widget-partner-day" data-state="unconfirmed">
        {header}
        <Skeleton
          label="기록을 확인하는 중이에요."
          description={`확인되면 ${partnerName}의 오늘을 시간순으로 보여드려요.`}
          lines={3}
        />
      </div>
    );
  }

  if (todays.length === 0) {
    return (
      <div data-testid="widget-partner-day" data-state="empty">
        {header}
        <EmptyState
          title="오늘 공유된 순간이 아직 없어요."
          description={`${partnerName}이 남기면 시간순으로 이 자리에 쌓여요.`}
        />
      </div>
    );
  }

  return (
    <div data-testid="widget-partner-day" data-state="ready">
      {header}
      <p className="text-caption text-muted-foreground mb-2">
        순간 {todays.length}개 · 시간순
        {sharedSyncStatus === 'delayed' && ' · 방금 것이 아직 안 보일 수 있어요'}
      </p>

      <ol className="space-y-3">
        {visible.map((record) => (
          <li key={record.id} data-testid="partner-day-entry" className="border-l-2 border-coral/30 pl-3">
            {/*
              The whole entry is the control, so the tap target is the moment
              rather than a small chevron. It carries the record id, so 기록 opens
              on THIS moment -- including on another date, though today's entries
              never are.
            */}
            <button
              type="button"
              onClick={() => openRecord(record)}
              aria-label={`${record.time || ''} ${partnerName}의 기록 자세히 보기`}
              className="w-full text-left min-h-[44px]"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Tabular, so a column of times does not shift character to character. */}
                <span className="text-caption font-bold text-foreground tabular-nums">{record.time}</span>
                {mediaKinds(record.attachments).map((kind) => {
                  const Icon = KIND_ICON[kind];
                  return <Icon key={kind} size={12} className="text-muted-foreground" aria-hidden="true" />;
                })}
                {record.reaction && (
                  <Badge tone="neutral">
                    {REACTION_LABELS[record.reaction] || record.reaction}
                  </Badge>
                )}
              </div>
              {record.log && (
                /*
                  The partner's own sentence, at `body`. This is the destination
                  the briefing points at, so it is never smaller than the summary
                  that sent the reader here (DESIGN_V2 §3.3).
                */
                <p className="text-body text-foreground break-keep line-clamp-3 mt-1">
                  {record.log}
                </p>
              )}
            </button>

            {/*
              Outside the button on purpose: a player nested inside a button would
              make its own controls unreachable, and pressing play would navigate
              away instead.
            */}
            {record.attachments && record.attachments.length > 0 && (
              <div className="mt-1.5 space-y-1.5">
                {record.attachments.map((attachment, index) => (
                  <AttachmentMedia
                    key={index}
                    attachment={attachment}
                    coupleId={profile.couple.coupleId}
                    recordId={record.id}
                    variant="compact"
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      {hiddenCount > 0 && (
        <Button
          variant="outline"
          full
          onClick={() => openRecord(todays[PARTNER_DAY_VISIBLE_LIMIT])}
          className="mt-3"
        >
          나머지 {hiddenCount}개 보기 →
        </Button>
      )}
    </div>
  );
}
