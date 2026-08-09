import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Image as ImageIcon, Mic } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { localToday, toLocalDateString } from '@/lib/utils';
import { AttachmentMedia } from '@/components/AttachmentMedia';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader, RowGroup } from '@/components/ui/List';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Attachment, DailyRecord } from '@/types';

/**
 * 상대방의 오늘 — the partner's day, in the order it happened.
 *
 * README section 1.4 states the point of the 군화 home in one sentence: "폰을
 * 받거나 접속했을 때 상대방의 오늘 순간들을 시간순(사진, 영상, 음성, 텍스트)으로 있는
 * 그대로 감상합니다."
 *
 * Renders as an editorial timeline: time → media → prose.
 * No wrapper card — surface economy. Structure comes from the time rail and
 * dividers, not from a border per entry.
 */

const REACTION_LABELS: Record<string, string> = {
  good: '좋았어',
  event: '이런 일이',
  hard: '힘들었어',
  thought_of_you: '네 생각났어',
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
        <SectionHeader title={`${partnerName}의 오늘`} />
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
        <SectionHeader title={`${partnerName}의 오늘`} />
        <EmptyState
          title="오늘 공유된 순간이 아직 없어요."
          description={`${partnerName}이 남기면 시간순으로 이 자리에 쌓여요.`}
        />
      </div>
    );
  }

  return (
    <div data-testid="widget-partner-day" data-state="ready">
      <SectionHeader
        title={`${partnerName}의 오늘`}
        caption={`순간 ${todays.length}개${sharedSyncStatus === 'delayed' ? ' · 방금 것이 아직 안 보일 수 있어요' : ''}`}
        action={
          hiddenCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openRecord(todays[PARTNER_DAY_VISIBLE_LIMIT])}
            >
              전체 보기
            </Button>
          ) : undefined
        }
      />

      {/* Editorial timeline: time rail → media → prose. No card per entry. */}
      <RowGroup>
        {visible.map((record) => (
          <li key={record.id} data-testid="partner-day-entry" className="list-none">
            <button
              type="button"
              onClick={() => openRecord(record)}
              aria-label={`${record.time || ''} ${partnerName}의 기록 자세히 보기`}
              className="w-full text-left min-h-11 flex items-start gap-2 py-2"
            >
              {/* Time rail */}
              <span className="shrink-0 w-11 text-caption text-muted-foreground tabular-nums pt-0.5">
                {record.time}
              </span>

              {/* Content */}
              <span className="flex-1 min-w-0">
                {/* Media type indicators */}
                {mediaKinds(record.attachments).length > 0 && (
                  <span className="flex items-center gap-1 mb-0.5">
                    {mediaKinds(record.attachments).map((kind) => {
                      const Icon = KIND_ICON[kind];
                      return <Icon key={kind} size={12} className="text-muted-foreground" aria-hidden="true" />;
                    })}
                  </span>
                )}

                {/* Partner's own words — body size, the destination the briefing points at */}
                {record.log && (
                  <span className="block text-body text-foreground break-keep line-clamp-2">
                    {record.log}
                  </span>
                )}

                {/* Reaction as a neutral chip — no fixed colour per emotion */}
                {record.reaction && (
                  <Badge tone="neutral" className="mt-1">
                    {REACTION_LABELS[record.reaction] || record.reaction}
                  </Badge>
                )}
              </span>
            </button>

            {/*
              Outside the button on purpose: a player nested inside a button would
              make its own controls unreachable, and pressing play would navigate
              away instead.
            */}
            {record.attachments && record.attachments.length > 0 && (
              <div className="ml-[52px] pb-2 space-y-1.5">
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
      </RowGroup>

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
