import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildTalkAboutTopics } from '@/lib/talkAboutList';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

/**
 * "오늘 이야기할 것" — the short list the marks add up to.
 *
 * Every line is rendered from the RECORD, which this client already holds and
 * is already authorized for; the marks contribute only which records to show
 * and who flagged them (see `talkAboutList.ts`). A mark whose record cannot
 * be resolved is dropped by that helper rather than rendered as a placeholder,
 * so this surface can never announce that something exists without being able
 * to show it.
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

  const topics = useMemo(
    () => buildTalkAboutTopics(
      state.talkAboutMarks ?? [],
      state.records,
      { userId: profile.id, role: profile.role },
    ),
    [state.talkAboutMarks, state.records, profile.id, profile.role],
  );

  const visible = topics.slice(0, VISIBLE_LIMIT);
  const hiddenCount = topics.length - visible.length;

  return (
    <div data-testid="widget-talk-about-list">
      <h3 className="text-heading text-foreground mb-2 flex items-center gap-1.5">
        <MessageCircle size={14} className="text-coral" aria-hidden="true" />
        오늘 이야기할 것
      </h3>

      {topics.length === 0 ? (
        <p className="text-caption text-muted-foreground py-2 break-keep">
          아직 표시한 기록이 없어요. 기록에서 `이따 이야기하기`를 눌러두면 여기 모여요.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((topic) => (
            <li key={topic.record.id} className="py-2 flex items-start gap-2">
              <button
                type="button"
                onClick={() => {
                  setHighlightedRecordId(topic.record.id);
                  // Durable addressing from P2, so a reload still lands here.
                  navigate(`/record?record=${topic.record.id}`);
                }}
                className="flex-1 min-w-0 text-left min-h-11"
              >
                <span className="block text-body text-foreground break-keep line-clamp-2">
                  {topic.record.log
                    || (topic.record.attachments?.length ? '사진·음성으로 남긴 순간' : '남긴 순간')}
                </span>
                <span className="block text-caption text-muted-foreground mt-0.5">
                  {topic.record.date} {topic.record.time}
                  {topic.markedByViewer ? ' · 내가 표시' : ` · ${profile.couple.partnerName || '상대방'}가 표시`}
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (isOffline) {
                    toast.error(OFFLINE_READONLY_MESSAGE);
                    return;
                  }
                  const result = await resolveTalkAbout(topic.record.id);
                  if (!result.ok) {
                    toast.error(result.error || '처리하지 못했어요.');
                    return;
                  }
                  toast.success('이야기한 걸로 정리했어요.');
                }}
                aria-label={`${topic.record.time} 기록, 이야기했어요`}
                className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-control text-muted-foreground active:scale-95 transition"
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <p className="text-caption text-muted-foreground pt-1.5">
          외 {hiddenCount}개
        </p>
      )}
    </div>
  );
}
