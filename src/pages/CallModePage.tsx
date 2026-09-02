import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { buildTalkAboutTopics } from '@/lib/talkAboutList';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { recordProductEvent } from '@/lib/productEvents';
import { TALK_ABOUT_SYNC_PENDING_MESSAGE } from '@/lib/talkAbout';

interface CallSession {
  /** Stable exact ids left in this pass; index zero is always the visible topic. */
  remaining: string[];
  /** Exact ids skipped in this pass. They remain unresolved. */
  skipped: string[];
  /** Resolved mark generation, retained while realtime reconciliation catches up. */
  settled: Array<{ recordId: string; activeMarkIds: string[] }>;
  /** Sources that disappeared while current and were explicitly skipped, never resolved. */
  unavailable: string[];
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameSettled(
  left: Array<{ recordId: string; activeMarkIds: string[] }>,
  right: Array<{ recordId: string; activeMarkIds: string[] }>,
): boolean {
  return left.length === right.length && left.every((entry, index) => (
    entry.recordId === right[index]?.recordId
    && sameIds(entry.activeMarkIds, right[index].activeMarkIds)
  ));
}

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
  const {
    state,
    sharedSyncStatus,
    talkAboutSyncStatus,
    resolveTalkAbout,
    setHighlightedRecordId,
  } = useStore();
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

  /*
    Pin the call session to exact ids instead of a live array index. Realtime can
    prepend a new mark or reorder a record when the partner joins it. Neither is
    allowed to replace the topic the user is currently reading.
  */
  const [session, setSession] = useState<CallSession>(() => ({
    remaining: topics.map((topic) => topic.recordId),
    skipped: [],
    settled: [],
    unavailable: [],
  }));
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const contentHeadingRef = useRef<HTMLHeadingElement>(null);
  const coordinationUnavailable =
    sharedSyncStatus === 'unavailable' || talkAboutSyncStatus === 'unavailable';

  useEffect(() => {
    if (coordinationUnavailable) return;
    const activeIds = topics.map((topic) => topic.recordId);
    const active = new Set(activeIds);
    const activeById = new Map(topics.map((topic) => [topic.recordId, topic]));
    setSession((previous) => {
      // A server snapshot containing only rows that were active at completion
      // is reconciliation lag. Any new row id means someone explicitly marked
      // this exact source again, so it must become a topic again.
      const settled = previous.settled.filter((entry) => {
        const activeTopic = activeById.get(entry.recordId);
        return !activeTopic || activeTopic.activeMarkIds.every(
          (markId) => entry.activeMarkIds.includes(markId),
        );
      });
      const settledIds = new Set(settled.map((entry) => entry.recordId));
      const [pinnedCurrent, ...queued] = previous.remaining;
      const remaining = [
        ...(pinnedCurrent && !settledIds.has(pinnedCurrent) ? [pinnedCurrent] : []),
        ...queued.filter((id) => active.has(id) && !settledIds.has(id)),
      ];
      const skipped = previous.skipped.filter((id) => active.has(id) && !settledIds.has(id));
      const unavailable = previous.unavailable.filter((id) => !settledIds.has(id));
      const known = new Set([...remaining, ...skipped, ...unavailable, ...settledIds]);

      // New realtime topics wait behind the current session instead of jumping
      // in front of the sentence already on screen.
      for (const id of activeIds) {
        if (!known.has(id)) {
          remaining.push(id);
          known.add(id);
        }
      }

      if (
        sameIds(remaining, previous.remaining)
        && sameIds(skipped, previous.skipped)
        && sameIds(unavailable, previous.unavailable)
        && sameSettled(settled, previous.settled)
      ) {
        return previous;
      }
      return { ...previous, remaining, skipped, settled, unavailable };
    });
  }, [coordinationUnavailable, topics]);

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

  const topicsById = useMemo(
    () => new Map(topics.map((topic) => [topic.recordId, topic])),
    [topics],
  );
  const currentId = session.remaining[0];
  const current = currentId ? topicsById.get(currentId) : undefined;
  const currentUnavailable = Boolean(currentId) && !current;
  /** Skipped past the end with topics still unfinished -- not the same as done. */
  const wrapped = session.remaining.length === 0 && session.skipped.length > 0;
  const changedOnly = session.remaining.length === 0
    && session.skipped.length === 0
    && session.unavailable.length > 0;
  const done = session.remaining.length === 0
    && session.skipped.length === 0
    && session.unavailable.length === 0;

  const viewKey = coordinationUnavailable
    ? 'sync-unavailable'
    : currentUnavailable
      ? `unavailable:${currentId}`
      : current
        ? `topic:${current.recordId}`
        : wrapped
          ? 'wrapped'
          : changedOnly
            ? 'changed'
            : done
              ? 'done'
              : 'matching';
  const announcement = coordinationUnavailable
    ? '이야기거리 목록을 확인하고 있어요'
    : current
      ? `${session.skipped.length + 1}번째 이야기거리, ${current.record.log || '남긴 순간'}`
      : currentUnavailable
        ? '현재 보던 이야기거리를 더 이상 볼 수 없어요'
        : wrapped
          ? '건너뛴 이야기거리가 남았어요'
          : changedOnly
            ? '목록이 바뀐 이야기거리가 있어요'
            : done
              ? '남은 이야기거리가 없어요'
              : '이야기거리 목록을 맞추는 중이에요';

  useEffect(() => {
    contentHeadingRef.current?.focus();
  }, [viewKey]);

  const leave = () => navigate('/');

  const complete = async () => {
    if (!current || pendingRef.current) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const recordId = current.recordId;
    const activeMarkIds = [...current.activeMarkIds];
    try {
      const result = await resolveTalkAbout(recordId);
      if (!result.ok) {
        // Left in place on failure. Telling someone a topic is handled when the
        // server refused the write would lose it silently at the next reload.
        toast.error(result.error || '처리하지 못했어요.');
        return;
      }
      setSession((previous) => ({
        remaining: previous.remaining.filter((id) => id !== recordId),
        skipped: previous.skipped.filter((id) => id !== recordId),
        settled: [
          ...previous.settled.filter((entry) => entry.recordId !== recordId),
          { recordId, activeMarkIds },
        ],
        unavailable: previous.unavailable.filter((id) => id !== recordId),
      }));
      /*
        The loop's last arrow, measured. §19 permits the event kind and an opaque
        id; the record's text is not read here and has no field to travel in.
      */
      if (result.syncPending) {
        toast.warning(TALK_ABOUT_SYNC_PENDING_MESSAGE);
      } else if (result.changed === false) {
        toast.info('이미 목록에서 정리된 이야기거리예요.');
      } else {
        void recordProductEvent({
          kind: 'talk_about_resolved',
          screen: 'call',
          subjectId: recordId,
        });
        toast.success('이야기한 걸로 정리했어요.');
      }
    } catch {
      toast.error('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const skip = () => {
    if (pendingRef.current) return;
    setSession((previous) => {
      const [id, ...remaining] = previous.remaining;
      if (!id) return previous;
      return currentUnavailable
        ? {
            ...previous,
            remaining,
            unavailable: previous.unavailable.includes(id)
              ? previous.unavailable
              : [...previous.unavailable, id],
          }
        : { ...previous, remaining, skipped: [...previous.skipped, id] };
    });
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

      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

      {coordinationUnavailable ? (
        <section
          data-testid="call-mode-unavailable"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-heading text-foreground break-keep outline-none"
          >
            이야기거리를 확인하고 있어요
          </h2>
          <p className="text-body text-muted-foreground break-keep">
            {sharedSyncStatus === 'unavailable'
              ? '공유 정보를 아직 확인하지 못했어요. 확인되면 현재 목록을 다시 보여드려요.'
              : '책갈피 목록을 아직 확인하지 못했어요. 확인되면 현재 목록을 다시 보여드려요.'}
          </p>
          <button
            type="button"
            onClick={leave}
            className="press-response mt-2 min-h-12 px-6 rounded-control bg-muted text-label font-bold text-foreground"
          >
            홈으로
          </button>
        </section>
      ) : done ? (
        <section
          data-testid="call-mode-done"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-heading text-foreground break-keep outline-none"
          >
            이야기거리를 다 정리했어요
          </h2>
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
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-heading text-foreground break-keep outline-none"
          >
            건너뛴 이야기거리가 남았어요
          </h2>
          <p className="text-body text-muted-foreground break-keep">
              아직 {session.skipped.length}개가 그대로 있어요.
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
            <button
              type="button"
              onClick={() => setSession((previous) => ({
                ...previous,
                remaining: previous.skipped,
                skipped: [],
              }))}
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
      ) : changedOnly ? (
        <section
          data-testid="call-mode-changed"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-heading text-foreground break-keep outline-none"
          >
            현재 볼 수 있는 이야기거리는 여기까지예요
          </h2>
          <p className="text-body text-muted-foreground break-keep">
            목록이 바뀐 항목은 이야기했다고 표시하지 않았어요.
          </p>
          <button
            type="button"
            onClick={leave}
            className="press-response mt-2 min-h-12 px-6 rounded-control bg-muted text-label font-bold text-foreground"
          >
            홈으로
          </button>
        </section>
      ) : currentUnavailable ? (
        <section
          data-testid="call-mode-current-unavailable"
          className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-heading text-foreground break-keep outline-none"
          >
            현재 보던 이야기거리를 더 이상 볼 수 없어요
          </h2>
          <p className="text-body text-muted-foreground break-keep">
            다른 기록으로 바꾸지 않았어요. 다음 이야기거리로 직접 넘어갈 수 있어요.
          </p>
          <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
            <button
              type="button"
              data-testid="call-mode-skip"
              onClick={skip}
              className="press-response min-h-12 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold"
            >
              다음 이야기거리
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
      ) : !current ? (
        <section
          aria-live="polite"
          className="flex-1 flex items-center justify-center px-6 text-center"
        >
          <h2
            ref={contentHeadingRef}
            tabIndex={-1}
            className="text-body text-muted-foreground outline-none"
          >
            이야기거리 목록을 맞추는 중이에요.
          </h2>
        </section>
      ) : (
        <>
          <section
            data-testid="call-mode-topic"
            aria-busy={pending || undefined}
            className="flex-1 flex flex-col justify-center gap-4 px-6 py-4"
          >
            {/*
              Progress, not debt. `3 / 7` says where you are in a list you chose to
              open; it is not a count of what is owed, and it disappears with the
              last topic.
            */}
            <p className="text-caption text-muted-foreground tabular-nums">
              {session.skipped.length + 1} / {session.remaining.length + session.skipped.length}
            </p>

            <h2
              ref={contentHeadingRef}
              tabIndex={-1}
              className="text-heading text-foreground break-keep leading-relaxed outline-none"
            >
              {current.record.log
                || (current.record.attachments?.length ? '사진으로 남긴 순간' : '남긴 순간')}
            </h2>

            <p className="text-caption text-muted-foreground break-keep">
              {`${current.record.userId === profile.id ? profile.myName : profile.couple.partnerName || '상대방'} · ${current.record.date}`}
            </p>

            {/*
              Reading the exact original is still one tap away, but it leaves this
              screen, so it is drawn as the quiet option. During a call the text
              above is usually enough to remember what this was.
            */}
            <button
              type="button"
              onClick={() => {
                setHighlightedRecordId(current.recordId);
                navigate(`/record?record=${encodeURIComponent(current.recordId)}`);
              }}
              className="press-response-row self-start min-h-11 -mx-1 px-1 rounded-control text-caption text-coral"
            >
              원본 보기
            </button>
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
              onClick={skip}
              disabled={pending}
              className="press-response min-h-12 w-full rounded-control bg-muted text-label font-bold text-muted-foreground flex items-center justify-center gap-1 disabled:opacity-50"
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
