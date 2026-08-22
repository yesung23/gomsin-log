import { useNavigate } from 'react-router-dom';
import { recordProductEvent } from '@/lib/productEvents';
import { Check, Film, Image as ImageIcon, Mic } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { withReadableContent } from '@/lib/recordAvailability';
import { partnerDayDateLabel, spansBeforeToday } from '@/lib/partnerDay';
import { usePartnerDay } from '@/lib/usePartnerDay';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader, RowGroup } from '@/components/ui/List';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Attachment, DailyRecord } from '@/types';

/**
 * 상대방의 오늘 / 놓친 하루 — the partner's day, in the order it happened.
 *
 * README section 1.4 states the point of the 군화 home in one sentence: "폰을
 * 받거나 접속했을 때 상대방의 오늘 순간들을 시간순(사진, 영상, 음성, 텍스트)으로 있는
 * 그대로 감상합니다."
 *
 * The subject is not always today. PRODUCT_V3 §6.1: "오래 접속하지 않았다면 (A)의
 * 대상은 '오늘'이 아니라 마지막 확인 이후 놓친 구간이다." A soldier who could not
 * reach a phone for three days needs those three days, and hard-filtering to the
 * calendar date silently threw them away. `partnerDay.ts` owns the window; this
 * widget owns how it reads, including saying "놓친 하루" instead of "오늘" when the
 * window really does reach back.
 *
 * Renders as an editorial timeline: date → time → media → prose.
 * No wrapper card — surface economy. Structure comes from the time rail and
 * dividers, not from a border per entry.
 */

const REACTION_LABELS: Record<string, string> = {
  good: '기뻤어',
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

  /**
   * `usePartnerDay` owns the identity triple, the eligibility date, the receipt and
   * the state machine. This widget owns how the result reads.
   *
   * `persist: true` makes this widget the single owner of the receipt. It is the
   * surface with the confirm button, so it is the one that must be able to record
   * that a record was put in front of the user.
   */
  const { surface: missed, todayStr, acknowledge } = usePartnerDay({ persist: true });

  const readableMissed = withReadableContent(missed);
  const unavailableCount = missed.length - readableMissed.length;
  const visible = readableMissed.slice(0, PARTNER_DAY_VISIBLE_LIMIT);
  const hiddenCount = readableMissed.length - visible.length;
  const multiDay = spansBeforeToday(missed, todayStr);
  const heading = multiDay ? `${partnerName}의 놓친 하루` : `${partnerName}의 오늘`;

  /**
   * The ONLY thing that writes CONFIRMED.
   *
   * Not mount, not a render, not "records finished loading", not a timer, and not
   * the passage of time. Opening the home screen is not evidence that anyone read
   * anything. Records leave the surface here and nowhere else.
   *
   * `visible` is the chronological prefix that is actually on screen, and that is
   * exactly what gets acknowledged: pressing this with fifteen more below keeps
   * those fifteen OUTSTANDING, on their own account and with no date involved.
   *
   * `visible` is also the READABLE prefix, so a record this device cannot decrypt
   * is never confirmed by a press it could not appear in -- it stays outstanding
   * until its key arrives and someone confirms it.
   */
  const acknowledgeVisible = () => {
    // A failed storage write returns false and advances nothing: the records stay
    // on screen rather than disappearing with nothing on disk to justify it.
    acknowledge(visible);
  };

  const openRecord = (record: DailyRecord) => {
    // The same measurement as the briefing widget: summary to exact original.
    void recordProductEvent({
      kind: 'briefing_to_original',
      screen: 'home',
      subjectId: record.id,
    });
    setHighlightedRecordId(record.id);
    navigate(`/record?record=${record.id}`);
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

  if (missed.length === 0) {
    return (
      <div data-testid="widget-partner-day" data-state="empty">
        <SectionHeader title={`${partnerName}의 오늘`} />
        <EmptyState
          title="새로 공유된 순간이 아직 없어요."
          description={`${partnerName}이 남기면 시간순으로 이 자리에 쌓여요.`}
        />
      </div>
    );
  }

  if (readableMissed.length === 0) {
    return (
      <div data-testid="widget-partner-day" data-state="unavailable">
        <SectionHeader title={heading} caption={`순간 ${missed.length}개`} />
        <EmptyState
          title="이 기기에서 아직 열 수 없는 기록이 있어요."
          description="키가 준비되면 내용을 확인할 수 있어요."
        />
      </div>
    );
  }

  return (
    <div data-testid="widget-partner-day" data-state="ready">
      <SectionHeader
        title={heading}
        caption={`순간 ${missed.length}개${sharedSyncStatus === 'delayed' ? ' · 방금 것이 아직 안 보일 수 있어요' : ''}`}
        action={
          hiddenCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openRecord(readableMissed[PARTNER_DAY_VISIBLE_LIMIT])}
            >
              전체 보기
            </Button>
          ) : undefined
        }
      />

      {unavailableCount > 0 && (
        <div
          data-testid="partner-day-unavailable"
          className="text-caption text-muted-foreground pb-2"
        >
          이 기기에서 아직 열 수 없는 기록이 {unavailableCount}개 있어요.
        </div>
      )}

      {/* Editorial timeline: time rail → media → prose. No card per entry. */}
      <RowGroup>
        {visible.map((record) => (
          <li key={record.id} data-testid="partner-day-entry" className="list-none">
            <button
              type="button"
              onClick={() => openRecord(record)}
              aria-label={`${partnerDayDateLabel(record.date, todayStr) ?? '오늘'} ${record.time || ''} ${partnerName}의 기록 자세히 보기`}
              /*
                A tint, not a scale. This row is the way into 정확한 원본 and it sits
                in a timeline: scaling one row pulls its time rail out of line with
                the rows above and below, and that column staying straight is what
                makes the entries read as one day rather than five separate cards.
              */
              className="press-response-row w-full text-left min-h-11 flex items-start gap-2 py-2 rounded-control"
            >
              {/*
                Time rail. Across a multi-day window `18:20` on its own is a false
                statement -- it reads as this evening whichever day it was -- so an
                older row carries its date above the clock. Today stays bare.
              */}
              <span className="shrink-0 w-11 text-caption text-muted-foreground tabular-nums pt-0.5">
                {partnerDayDateLabel(record.date, todayStr) && (
                  <span className="block font-semibold text-foreground">
                    {partnerDayDateLabel(record.date, todayStr)}
                  </span>
                )}
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
              /*
                Indented to the time rail (44px + 8px gap) so the photo starts
                where the partner's sentence starts, and the clock column stays
                straight down the whole day.
              */
              <div className="ml-[52px] pb-2">
                <RecordMediaGallery
                  attachments={record.attachments}
                  coupleId={profile.couple.coupleId}
                  recordId={record.id}
                />
              </div>
            )}
          </li>
        ))}
      </RowGroup>

      {hiddenCount > 0 && (
        <Button
          variant="outline"
          full
          onClick={() => openRecord(readableMissed[PARTNER_DAY_VISIBLE_LIMIT])}
          className="mt-3"
        >
          나머지 {hiddenCount}개 보기 →
        </Button>
      )}

      {/*
        The explicit end of the missed window. Deliberately a plain secondary
        action and not the screen's `primary` (DESIGN_V2 §3.2) -- the point of this
        surface is to read the partner's day, not to clear a list, and §8 already
        rules out making the product a task manager.
      */}
      <Button
        variant="ghost"
        full
        onClick={acknowledgeVisible}
        className="mt-2"
        data-testid="partner-day-acknowledge"
      >
        <Check size={14} aria-hidden="true" />
        {hiddenCount > 0 ? '여기까지 확인했어요' : '다 확인했어요'}
      </Button>
    </div>
  );
}
