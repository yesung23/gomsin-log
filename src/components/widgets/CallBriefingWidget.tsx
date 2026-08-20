import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { localToday, toLocalDateString } from '@/lib/utils';
import {
  buildCallBriefing,
  readCallBriefingCheckpoint,
  writeCallBriefingCheckpoint,
} from '@/lib/callBriefing';
import {
  PartnerEmotionFlowWidget,
  PartnerEmotionSummaryWidget,
} from '@/components/widgets/PartnerEmotionWidgets';
import { CareHintWidget } from '@/components/widgets/CareHintWidget';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function CallBriefingWidget() {
  const { state, setHighlightedRecordId, sharedSyncStatus } = useStore();
  const navigate = useNavigate();
  const userId = state.authenticatedUser?.id || state.profile.id || '';
  const coupleId = state.profile.couple.coupleId || '';
  const todayStr = toLocalDateString(localToday());
  const [checkpoint, setCheckpoint] = useState(() => readCallBriefingCheckpoint(userId, coupleId));
  const [showRecent, setShowRecent] = useState(false);
  /** The descriptions of the day, collapsed so they cannot delay the button. */
  const [showMore, setShowMore] = useState(false);

  const partnerRecords = useMemo(() => {
    const viewer = { userId: state.profile.id, role: state.profile.role };
    return visibleRecordsForViewer(state.records, viewer).filter(
      (record) => !isOwnRecord(record, viewer) && !record.isPrivate,
    );
  }, [state.profile.id, state.profile.role, state.records]);

  const briefing = useMemo(
    () => buildCallBriefing(partnerRecords, todayStr, showRecent ? null : checkpoint),
    [checkpoint, partnerRecords, showRecent, todayStr],
  );
  const partnerName = state.profile.couple.partnerName || '연인';

  const openRecord = (recordId: string) => {
    setHighlightedRecordId(recordId);
    navigate(`/record?record=${recordId}`);
  };

  const markCallComplete = () => {
    if (!briefing.newestCreatedAt) return;
    const nextCheckpoint = {
      confirmedRecordIds: Array.from(new Set([
        ...(checkpoint?.confirmedRecordIds ?? []),
        ...briefing.includedRecordIds,
      ])),
      confirmedAt: briefing.newestCreatedAt,
    };
    if (writeCallBriefingCheckpoint(userId, coupleId, nextCheckpoint)) {
      setCheckpoint(nextCheckpoint);
      setShowRecent(false);
    }
  };

  return (
    <Card
      rail
      aria-labelledby="call-briefing-title"
      data-testid="call-briefing"
    >
      {/* Compact header: title + badge on one line */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 id="call-briefing-title" className="text-heading text-foreground">
          통화 전 60초
        </h2>
        <Badge tone="neutral">
          {showRecent || !checkpoint ? '최근 7일' : `새 ${briefing.totalNewMoments}개`}
        </Badge>
      </div>

      {sharedSyncStatus === 'unavailable' ? (
        <Skeleton
          label="공유 기록을 확인하고 있어요."
          description="연결이 확인되면 통화 전 맥락을 정확하게 보여드릴게요."
        />
      ) : briefing.totalNewMoments === 0 ? (
        <EmptyState
          icon={<Check size={20} className="text-success" aria-hidden="true" />}
          title="지난 통화 이후 새로 공유된 맥락이 없어요."
          description="바로 안부를 묻고 서로의 목소리에 집중해도 좋아요."
          action={(
            <Button onClick={() => setShowRecent(true)}>
              <RotateCcw size={14} aria-hidden="true" /> 최근 7일 다시 보기
            </Button>
          )}
        />
      ) : (
        <>
          {sharedSyncStatus === 'delayed' && (
            <p className="text-caption text-muted-foreground mb-2" role="status">
              방금 남긴 기록은 아직 보이지 않을 수 있어요.
            </p>
          )}
          {briefing.mood && (
            <p className="text-caption text-muted-foreground mb-2 break-keep">
              <span className="font-semibold text-foreground">먼저 알아둘 마음</span>{' '}
              {briefing.mood}
            </p>
          )}

          {/* Priority items as a terse list — time + badge + excerpt in 1–2 lines */}
          <ol className="divide-y divide-border" aria-label={`${partnerName}의 통화 전 핵심 맥락`}>
            {briefing.topics.map((topic) => (
              <li key={topic.recordId}>
                <button
                  type="button"
                  onClick={() => openRecord(topic.recordId)}
                  className="press-response-row w-full min-h-11 flex items-start gap-2 text-left py-2 active:bg-muted/40 rounded-control"
                >
                  <span className="shrink-0 text-caption text-muted-foreground tabular-nums pt-0.5 w-10">
                    {shortDate(topic.date)} {topic.time || ''}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-emphasis text-foreground break-keep line-clamp-2">{topic.text}</span>
                    {topic.talkAbout && (
                      <span className="text-caption font-semibold text-coral-strong">꼭 얘기</span>
                    )}
                  </span>
                  <ChevronRight size={14} className="mt-1 text-muted-foreground shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>

          {/*
            The confirm action comes IMMEDIATELY after the three topics, before
            anything optional.

            The north-star metric is the time from opening this card to pressing
            this button, so anything between the two is measured as comprehension
            time that the user did not spend comprehending. At 320x568 the opener
            pushed the button below the fold entirely.

            It is the one `primary` on this screen (DESIGN_V2 §3.2).
          */}
          {!showRecent && briefing.newestCreatedAt && (
            <Button variant="primary" size="lg" full onClick={markCallComplete} className="mt-3">
              통화했어요 · 여기까지 확인
            </Button>
          )}
          {showRecent && (
            <Button full onClick={() => setShowRecent(false)} className="mt-3">
              새 소식만 보기
            </Button>
          )}

          {/*
            Everything that DESCRIBES the day rather than being it.

            The 군화 home used to carry 상대방 마음 흐름, 오늘의 요약 and 다정한 한마디
            as separate default widgets alongside this card, so the same context was
            read four times in four wrappers. They are not deleted -- they are the
            same components, one tap away here, and still addable back to the home
            from 위젯 추가.

            Collapsed by default: a soldier with three minutes opens it, and a
            soldier with forty seconds never scrolls past it to reach the button
            above.
          */}
          <div className="mt-3 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setShowMore((open) => !open)}
              aria-expanded={showMore}
              aria-controls="call-briefing-more"
              className="press-response-row w-full min-h-11 flex items-center justify-center gap-1 text-caption text-muted-foreground"
            >
              {showMore ? '접기' : '첫마디와 마음 흐름 더 보기'}
              {showMore
                ? <ChevronUp size={14} aria-hidden="true" />
                : <ChevronDown size={14} aria-hidden="true" />
              }
            </button>

            {showMore && (
              <div id="call-briefing-more" className="mt-2 space-y-3">
                {briefing.opener && (
                  <div className="flex items-start gap-2 bg-info-surface border border-info/20 rounded-control px-3 py-2">
                    <p className="text-body text-foreground break-keep">
                      <span className="text-caption font-semibold text-info">첫마디</span>{' '}
                      {briefing.opener}
                    </p>
                  </div>
                )}
                <PartnerEmotionFlowWidget />
                <PartnerEmotionSummaryWidget />
                <CareHintWidget />
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
