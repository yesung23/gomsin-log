import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Clock3, MessageCircleHeart, RotateCcw } from 'lucide-react';
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
import type { DailyRecord } from '@/types';

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
    navigate('/record');
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
    <section
      aria-labelledby="call-briefing-title"
      className="rounded-3xl bg-gradient-to-br from-coral/15 via-card to-indigo-500/10 border border-coral/25 p-5 shadow-sm"
      data-testid="call-briefing"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold text-coral mb-1">설명은 짧게, 대화는 깊게</p>
          <h2 id="call-briefing-title" className="text-lg font-extrabold text-foreground flex items-center gap-2">
            <Clock3 size={18} className="text-coral" aria-hidden="true" />
            통화 전 60초
          </h2>
        </div>
        <span className="shrink-0 px-2.5 py-1 rounded-full bg-card border border-border text-[11px] font-bold text-muted-foreground">
          {showRecent || !checkpoint ? '최근 7일' : `새 소식 ${briefing.totalNewMoments}개`}
        </span>
      </div>

      {sharedSyncStatus === 'unavailable' ? (
        <div className="py-5 text-center" aria-live="polite" aria-busy="true">
          <Clock3 size={24} className="mx-auto mb-2 text-coral" aria-hidden="true" />
          <p className="text-sm font-bold text-foreground">공유 기록을 확인하고 있어요.</p>
          <p className="text-xs text-muted-foreground mt-1">연결이 확인되면 통화 전 맥락을 정확하게 보여드릴게요.</p>
        </div>
      ) : briefing.totalNewMoments === 0 ? (
        <div className="py-5 text-center">
          <Check size={24} className="mx-auto mb-2 text-success" aria-hidden="true" />
          <p className="text-sm font-bold text-foreground">지난 통화 이후 새로 공유된 맥락이 없어요.</p>
          <p className="text-xs text-muted-foreground mt-1">바로 안부를 묻고 서로의 목소리에 집중해도 좋아요.</p>
          <button
            type="button"
            onClick={() => setShowRecent(true)}
            className="mt-3 min-h-[44px] px-4 rounded-xl bg-muted text-xs font-bold text-foreground inline-flex items-center gap-1.5"
          >
            <RotateCcw size={14} aria-hidden="true" /> 최근 7일 다시 보기
          </button>
        </div>
      ) : (
        <>
          {sharedSyncStatus === 'delayed' && (
            <p className="mt-3 text-[11px] text-muted-foreground" role="status">
              방금 남긴 기록은 아직 보이지 않을 수 있어요.
            </p>
          )}
          {briefing.mood && (
            <p className="mt-4 rounded-2xl bg-card/80 border border-border/70 px-3.5 py-3 text-xs leading-relaxed text-foreground">
              <strong className="block text-[11px] text-coral mb-1">먼저 알아둘 마음</strong>
              {briefing.mood}
            </p>
          )}

          <ol className="mt-3 space-y-1" aria-label={`${partnerName}의 통화 전 핵심 맥락`}>
            {briefing.topics.map((topic, index) => (
              <li key={topic.recordId}>
                <button
                  type="button"
                  onClick={() => openRecord(topic.recordId)}
                  className="w-full min-h-[52px] flex items-start gap-3 text-left rounded-2xl px-2 py-2 hover:bg-card/70 active:scale-[0.99] transition"
                >
                  <span className="mt-0.5 w-6 h-6 rounded-full bg-coral text-white text-[11px] font-bold grid place-items-center shrink-0">{index + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[10px] text-muted-foreground mb-0.5">{shortDate(topic.date)} {topic.time || '시간 미정'}</span>
                    <span className="block text-xs text-foreground leading-relaxed break-keep">{topic.text}</span>
                    {topic.talkAbout && <span className="mt-1 inline-block text-[10px] font-bold text-coral">♥ 통화 때 꼭 얘기</span>}
                  </span>
                  <ChevronRight size={15} className="mt-4 text-muted-foreground shrink-0" aria-hidden="true" />
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
          */}
          {!showRecent && briefing.newestCreatedAt && (
            <button
              type="button"
              onClick={markCallComplete}
              className="mt-4 w-full min-h-[44px] rounded-xl bg-foreground text-background text-xs font-bold"
            >
              통화했어요 · 여기까지 확인
            </button>
          )}
          {showRecent && (
            <button
              type="button"
              onClick={() => setShowRecent(false)}
              className="mt-3 w-full min-h-[44px] rounded-xl bg-muted text-xs font-bold text-foreground"
            >
              새 소식만 보기
            </button>
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
          <div className="mt-3 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setShowMore((open) => !open)}
              aria-expanded={showMore}
              aria-controls="call-briefing-more"
              className="w-full min-h-[44px] flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground"
            >
              {showMore ? '접기' : '첫마디와 마음 흐름 더 보기'}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={showMore ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
            </button>

            {showMore && (
              <div id="call-briefing-more" className="mt-2 space-y-3">
                {briefing.opener && (
                  <div className="flex items-start gap-2 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 px-3.5 py-3">
                    <MessageCircleHeart size={16} className="mt-0.5 text-indigo-500 shrink-0" aria-hidden="true" />
                    <p className="text-xs text-foreground leading-relaxed"><strong>첫마디</strong><br />{briefing.opener}</p>
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
    </section>
  );
}
