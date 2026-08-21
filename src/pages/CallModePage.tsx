import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildTalkAboutTopics } from '@/lib/talkAboutList';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { recordProductEvent } from '@/lib/productEvents';

/**
 * 통화 모드 — the last arrow of the daily loop.
 *
 * The loop is 기록 → push → 브리핑 → 원본 → 이따 이야기하기 → 통화 → 이야기했어요, and
 * the final step was the one that broke. Marking a topic costs one tap during the
 * day; clearing it cost opening the app AFTER the call, finding the list and
 * working down it. Nobody does that, so the 보관함 filled up and the marks stopped
 * meaning "we will talk about this" and started meaning "we did, months ago".
 *
 * So this screen sits beside the call instead of after it: one topic at a time,
 * large enough to read while holding a phone to your ear, with the completion
 * where the conversation is.
 *
 * ## What this screen must never do (PRODUCT_V3 §8, 2026-08-21 revision)
 *
 * 1. **It does not place calls.** No `tel:` anywhere. The call is the user's to
 *    make, on whatever they already use; this screen only keeps them company.
 * 2. **It records nothing about the call** -- not when, not how long, not how
 *    many. §19 allows event kinds and opaque ids and forbids precise timestamps,
 *    and a "call history" is exactly the surveillance surface §16 rules out.
 *    Completing a topic writes the same thing the list writes, and nothing else.
 * 3. **`다음` is a skip, not a completion.** Passing over a topic must leave it
 *    exactly as it was.
 *
 * ## Why each completion is its own write
 *
 * A call ends when it ends -- someone hangs up, the signal drops, a sergeant
 * walks in. Batching the completions into one save at the end would mean the
 * common exit throws the whole session away. Each 이야기했어요 goes to the server
 * on its own, so leaving after three topics keeps three.
 */
export function CallModePage() {
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

  /**
   * Which remaining topic is on screen.
   *
   * Not an id: completing a topic removes it from `topics`, so the same index
   * then addresses the NEXT one and the screen advances without being told to.
   * Skipping moves the index instead and leaves the list alone, which is the
   * whole difference between the two controls.
   */
  const [position, setPosition] = useState(0);
  const [pending, setPending] = useState(false);

  /*
    Opening the call screen, once per visit. This is the step the strategy needs
    to distinguish "marked something" from "actually got on a call about it" --
    the two numbers together are what say whether the loop closes.

    Nothing about the call is recorded: not when it started, not how long it
    lasted, not whether one happened at all. §8 forbids that and this event does
    not imply it -- it says a screen was opened.
  */
  useEffect(() => {
    void recordProductEvent({ kind: 'call_mode_opened', screen: 'call' });
  }, []);

  const current = topics[position];
  /** Skipped past the end with topics still unfinished -- not the same as done. */
  const wrapped = !current && topics.length > 0;

  const leave = () => navigate('/');

  const complete = async () => {
    if (!current || pending) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    setPending(true);
    try {
      const result = await resolveTalkAbout(current.recordId);
      if (!result.ok) {
        // Left in place on failure. Telling someone a topic is handled when the
        // server refused the write would lose it silently at the next reload.
        toast.error(result.error || '처리하지 못했어요.');
        return;
      }
      /*
        The index is NOT advanced here. `topics` just got shorter, so this same
        position already points at the next one. Advancing as well would step over
        a topic nobody saw.
      */
      /*
        The loop's last arrow, measured. §19 permits the event kind and an opaque
        id; the record's text is not read here and has no field to travel in.
      */
      void recordProductEvent({
        kind: 'talk_about_resolved',
        screen: 'call',
        subjectId: current.recordId,
      });
      toast.success('이야기한 걸로 정리했어요.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/*
        No MobileShell, so no tab bar. This screen is used one-handed while a
        phone is against an ear, and a row of navigation targets along the bottom
        edge is the wrong thing to have under a thumb that is aiming for
        이야기했어요.
      */}
      <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h1 className="text-title text-foreground">통화하면서</h1>
        <button
          type="button"
          onClick={leave}
          aria-label="통화 모드 끝내기"
          className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-full text-muted-foreground"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {topics.length === 0 ? (
        <section
          data-testid="call-mode-done"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <p className="text-heading text-foreground break-keep">이야기거리를 다 정리했어요</p>
          <p className="text-body text-muted-foreground break-keep">
            남은 게 없어요. 통화는 계속하셔도 돼요.
          </p>
          <button
            type="button"
            onClick={leave}
            className="press-response mt-2 min-h-12 px-6 rounded-control bg-muted text-label font-bold text-foreground"
          >
            홈으로
          </button>
        </section>
      ) : wrapped ? (
        <section
          data-testid="call-mode-wrapped"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          {/*
            Deliberately not a completion screen. Saying "다 봤어요" while topics
            are still open would be the app claiming something untrue about the
            conversation -- §3.2, the app states facts and does not interpret.
          */}
          <p className="text-heading text-foreground break-keep">건너뛴 이야기거리가 남았어요</p>
          <p className="text-body text-muted-foreground break-keep">
            아직 {topics.length}개가 그대로 있어요.
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
            <button
              type="button"
              onClick={() => setPosition(0)}
              className="press-response min-h-12 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold"
            >
              처음부터 다시 보기
            </button>
            <button
              type="button"
              onClick={leave}
              className="press-response min-h-12 rounded-control bg-muted text-label font-bold text-foreground"
            >
              끝내기
            </button>
          </div>
        </section>
      ) : (
        <>
          <section
            data-testid="call-mode-topic"
            className="flex-1 flex flex-col justify-center gap-4 px-6 py-4"
          >
            {/*
              Progress, not debt. `3 / 7` says where you are in a list you chose to
              open; it is not a count of what is owed, and it disappears with the
              last topic.
            */}
            <p className="text-caption text-muted-foreground tabular-nums">
              {position + 1} / {topics.length}
            </p>

            <p className="text-heading text-foreground break-keep leading-relaxed">
              {current.record
                ? (current.record.log
                  || (current.record.attachments?.length ? '사진으로 남긴 순간' : '남긴 순간'))
                : '이 기록은 더 이상 볼 수 없어요'}
            </p>

            <p className="text-caption text-muted-foreground break-keep">
              {current.record
                ? `${current.record.userId === profile.id ? profile.myName : profile.couple.partnerName || '상대방'} · ${current.record.date}`
                : '원본을 확인할 수 없어요'}
            </p>

            {/*
              Reading the exact original is still one tap away, but it leaves this
              screen, so it is drawn as the quiet option. During a call the text
              above is usually enough to remember what this was.
            */}
            {current.record && (
              <button
                type="button"
                onClick={() => {
                  setHighlightedRecordId(current.recordId);
                  navigate(`/record?record=${current.recordId}`);
                }}
                className="press-response-row self-start min-h-11 -mx-1 px-1 rounded-control text-caption text-coral"
              >
                원본 보기
              </button>
            )}
          </section>

          <footer className="px-6 pb-8 pt-2 flex flex-col gap-2">
            <button
              type="button"
              data-testid="call-mode-complete"
              onClick={() => void complete()}
              disabled={pending || isOffline}
              title={isOffline ? OFFLINE_READONLY_MESSAGE : undefined}
              className="press-response min-h-14 w-full rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check size={18} aria-hidden="true" />
              {pending ? '정리하는 중...' : '이야기했어요'}
            </button>

            <button
              type="button"
              data-testid="call-mode-skip"
              onClick={() => setPosition((at) => at + 1)}
              className="press-response min-h-12 w-full rounded-control bg-muted text-label font-bold text-muted-foreground flex items-center justify-center gap-1"
            >
              다음
              <ChevronRight size={16} aria-hidden="true" />
            </button>

            {isOffline && (
              <p className="text-caption text-muted-foreground text-center">
                {OFFLINE_READONLY_MESSAGE}
              </p>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
