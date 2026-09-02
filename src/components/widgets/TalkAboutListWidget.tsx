import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Check, ChevronDown, ChevronUp, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildTalkAboutTopics } from '@/lib/talkAboutList';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { recordProductEvent } from '@/lib/productEvents';
import { TALK_ABOUT_SYNC_PENDING_MESSAGE } from '@/lib/talkAbout';

/**
 * "오늘 이야기할 것" — the short list the marks add up to.
 *
 * Every usable preview is rendered from the RECORD, which this client already
 * holds and is already authorized for. If that exact source later disappears
 * or becomes inaccessible, the mark renders only a generic unavailable state;
 * it never falls back to a different record or shows source-derived content.
 *
 * Deliberately not a task manager (PRODUCT_V3 §8): no due date, no assignee,
 * no priority, no completion history. One line per topic, tap to read the
 * original, and one way to say the conversation happened.
 */
const VISIBLE_LIMIT = 5;

export function TalkAboutListWidget() {
  const {
    state,
    sharedSyncStatus,
    talkAboutSyncStatus,
    resolveTalkAbout,
    setHighlightedRecordId,
  } = useStore();
  /*
    Quarantine empties `records` -- one's OWN records included (`store.tsx`, the
    `nextState` that assigns `records: []`). A surface that reads only the length
    therefore says "nothing here" when the truth is "we could not confirm what is
    here", and §4.2 forbids exactly that. `PartnerDayTimelineWidget` already drew
    the distinction; this one did not.

    Written HERE and not beside the JSX, because the first attempt put it inside
    the element and JSX renders a bare block comment as TEXT. It shipped to CI
    with the explanation printed on screen, backticks and all -- caught by the
    literal-backtick test that exists because this exact thing happened once
    before.
  */

  const navigate = useNavigate();
  const isOffline = !useOnlineStatus();
  const { profile } = state;
  /**
   * §8 says the count opens the 보관함 목록. It had nowhere to open TO: the sixth
   * topic onwards was reported as inert text ("외 N개") with no control on it and
   * no route to a fuller list, so a couple who marked more than five records
   * could not reach the rest until they had completed their way down to them.
   * Expanding in place is the smallest thing that satisfies the contract without
   * adding the separate tab §8 explicitly rules out.
   */
  const [expanded, setExpanded] = useState(false);
  const pendingRef = useRef<string | null>(null);
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);

  const topics = useMemo(
    () => buildTalkAboutTopics(
      state.talkAboutMarks ?? [],
      state.records,
      { userId: profile.id, role: profile.role },
    ),
    [state.talkAboutMarks, state.records, profile.id, profile.role],
  );

  const visible = expanded ? topics : topics.slice(0, VISIBLE_LIMIT);
  const hiddenCount = topics.length - visible.length;
  const coordinationUnavailable =
    sharedSyncStatus === 'unavailable' || talkAboutSyncStatus === 'unavailable';

  return (
    <div data-testid="widget-talk-about-list">
      <h3 className="text-heading text-foreground mb-2 flex items-center gap-1.5">
        <MessageCircle size={14} className="text-coral" aria-hidden="true" />
        오늘 이야기할 것{coordinationUnavailable ? null : <> · {topics.length}</>}
      </h3>

      {coordinationUnavailable ? (
        <p className="text-caption text-muted-foreground py-2 break-keep">
          {sharedSyncStatus === 'unavailable'
            ? '공유 기록을 확인하는 중이에요.'
            : '책갈피를 확인하는 중이에요. 확인되면 다시 보여드려요.'}
        </p>
      ) : topics.length === 0 ? (
        <p className="text-caption text-muted-foreground py-2 break-keep">
          아직 표시한 기록이 없어요. 기록에서 &apos;이따 이야기하기&apos;를 눌러두면 여기 모여요.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((topic) => (
            <li
              key={topic.recordId}
              aria-busy={pendingRecordId === topic.recordId || undefined}
              className="py-2 flex items-start gap-2"
            >
              <button
                type="button"
                onClick={() => {
                  setHighlightedRecordId(topic.recordId);
                  // Durable addressing from P2, so a reload still lands here.
                  navigate(`/record?record=${encodeURIComponent(topic.recordId)}`);
                }}
                /* The row that opens 정확한 원본. Tinted, not scaled -- it shares a line
                   with the 이야기했어요 control and the two must not move apart. */
                className="press-response-row flex-1 min-w-0 text-left min-h-11 rounded-control px-1 -mx-1"
              >
                <span className="block text-body text-foreground break-keep line-clamp-2">
                  {topic.record.log
                    || (topic.record.attachments?.length ? '사진·음성으로 남긴 순간' : '남긴 순간')}
                </span>
                <span className="block text-caption text-muted-foreground mt-0.5">
                  {`${topic.record.userId === profile.id ? profile.myName : profile.couple.partnerName || '상대방'} · ${topic.record.date}`}
                  {topic.actorState === 'both'
                    ? ' · 함께 표시'
                    : topic.markedByViewer
                      ? ' · 내가 표시'
                      : ` · ${profile.couple.partnerName || '상대방'}가 표시`}
                </span>
                <span className="block text-caption text-coral mt-0.5">원본 보기</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (pendingRef.current) return;
                  if (isOffline) {
                    toast.error(OFFLINE_READONLY_MESSAGE);
                    return;
                  }
                  pendingRef.current = topic.recordId;
                  setPendingRecordId(topic.recordId);
                  try {
                    const result = await resolveTalkAbout(topic.recordId);
                    if (!result.ok) {
                      toast.error(result.error || '처리하지 못했어요.');
                      return;
                    }
                    if (result.syncPending) {
                      toast.warning(TALK_ABOUT_SYNC_PENDING_MESSAGE);
                      return;
                    }
                    if (result.changed === false) {
                      toast.info('이미 목록에서 정리된 이야기거리예요.');
                    } else {
                      void recordProductEvent({
                        kind: 'talk_about_resolved',
                        screen: 'home',
                        subjectId: topic.recordId,
                      });
                      toast.success('이야기한 걸로 정리했어요.');
                    }
                  } catch {
                    toast.error('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
                  } finally {
                    pendingRef.current = null;
                    setPendingRecordId(null);
                  }
                }}
                disabled={pendingRecordId !== null || isOffline}
                aria-label="이야기했어요"
                /* Square and small, so this one scales. 0.95 was a flinch at 44px. */
                className="press-response shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground disabled:opacity-50"
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        The way into 통화 모드.

        Hidden at zero, per §8: an entry point to a screen that would open on
        "nothing to talk about" is worse than no entry point, and this widget
        already says the list is empty right above it.

        It sits below the list rather than in the heading because the list is
        what someone came here to read; this is what they do next, and only
        sometimes.
      */}
      {!coordinationUnavailable && topics.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('/call')}
          data-testid="talk-about-call-mode"
          className="press-response-row w-full min-h-11 mt-1 flex items-center justify-center gap-1.5 rounded-control border border-coral/30 bg-coral/5 text-label font-bold text-coral-strong"
        >
          <Phone size={14} aria-hidden="true" />
          통화하면서 보기
        </button>
      )}

      {!coordinationUnavailable && (hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-testid="talk-about-expand"
          /* The overflow control. It is the ONLY route to the topics past the fifth
             (§8 rules out a separate tab), so of everything in this widget it is the
             one that must visibly take the press. */
          className="press-response-row w-full min-h-11 flex items-center justify-center gap-1 text-caption text-muted-foreground rounded-control"
        >
          {expanded ? '접기' : `외 ${hiddenCount}개 모두 보기`}
          {expanded
            ? <ChevronUp size={14} aria-hidden="true" />
            : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
