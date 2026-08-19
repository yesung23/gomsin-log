import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildTalkAboutTopics } from '@/lib/talkAboutList';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

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
  const { state, resolveTalkAbout, setHighlightedRecordId } = useStore();
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

  return (
    <div data-testid="widget-talk-about-list">
      <h3 className="text-heading text-foreground mb-2 flex items-center gap-1.5">
        <MessageCircle size={14} className="text-coral" aria-hidden="true" />
        오늘 이야기할 것 · {topics.length}
      </h3>

      {topics.length === 0 ? (
        <p className="text-caption text-muted-foreground py-2 break-keep">
          아직 표시한 기록이 없어요. 기록에서 &apos;이따 이야기하기&apos;를 눌러두면 여기 모여요.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((topic) => (
            <li key={topic.recordId} className="py-2 flex items-start gap-2">
              <button
                type="button"
                onClick={() => {
                  setHighlightedRecordId(topic.recordId);
                  // Durable addressing from P2, so a reload still lands here.
                  navigate(`/record?record=${topic.recordId}`);
                }}
                /* The row that opens 정확한 원본. Tinted, not scaled -- it shares a line
                   with the 이야기했어요 control and the two must not move apart. */
                className="press-response-row flex-1 min-w-0 text-left min-h-11 rounded-control px-1 -mx-1"
              >
                <span className="block text-body text-foreground break-keep line-clamp-2">
                  {topic.record
                    ? (topic.record.log
                      || (topic.record.attachments?.length ? '사진·음성으로 남긴 순간' : '남긴 순간'))
                    : '이 기록은 더 이상 볼 수 없어요'}
                </span>
                <span className="block text-caption text-muted-foreground mt-0.5">
                  {topic.record
                    ? `${topic.record.userId === profile.id ? profile.myName : profile.couple.partnerName || '상대방'} · ${topic.record.date}`
                    : '원본을 확인할 수 없어요'}
                  {topic.markedByViewer ? ' · 내가 표시' : ` · ${profile.couple.partnerName || '상대방'}가 표시`}
                </span>
                <span className="block text-caption text-coral mt-0.5">원본 보기</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (isOffline) {
                    toast.error(OFFLINE_READONLY_MESSAGE);
                    return;
                  }
                  const result = await resolveTalkAbout(topic.recordId);
                  if (!result.ok) {
                    toast.error(result.error || '처리하지 못했어요.');
                    return;
                  }
                  toast.success('이야기한 걸로 정리했어요.');
                }}
                aria-label="이야기했어요"
                /* Square and small, so this one scales. 0.95 was a flinch at 44px. */
                className="press-response shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground"
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(hiddenCount > 0 || expanded) && (
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
