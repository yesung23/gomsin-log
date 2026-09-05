import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/useStore';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Image as ImageIcon, Send, Lock, Unlock, ShieldCheck,
  X, Film, Music,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { recordProductEvent } from '@/lib/productEvents';
import { toLocalDateString, localToday } from '@/lib/utils';
import { isOwnRecord } from '@/lib/privacy';
import { EmotionSuggestionReview } from '@/components/emotion/EmotionSuggestionReview';
import { useEmotionCandidatesAtBoundary } from '@/lib/useEmotionCandidates';
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from '@/lib/composerDraft';
import { classifyMediaFile, MEDIA_ACCEPT } from '@/lib/records';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import type { ReactionType, EmotionFlowItem } from '@/types';
import type { RecordMutationReason } from '@/lib/storeContext';
import { basicEmotionLabelOf } from '@/lib/basicEmotions';
import { isDeviceProtectionEnabled } from '@/app/e2ee/featureFlag';

/**
 * The author's own one-tap description of their day.
 *
 * This is distinct from the machine-suggested emotion chips above: a tag is
 * something the author actively picks about THEIR OWN record, never inferred.
 * It is also distinct from a partner reaction -- nobody but the author can set
 * this. Kept to the same four values every reading surface already expects
 * (PartnerDayTimelineWidget, CallBriefingWidget, briefing.ts, callBriefing.ts),
 * so this is the write side of a value five screens already read.
 */
const AUTHOR_TAGS: { value: ReactionType; emoji: string; label: string }[] = [
  { value: 'good', emoji: '😊', label: '좋았어' },
  { value: 'event', emoji: '💬', label: '이런 일이' },
  { value: 'hard', emoji: '🥹', label: '힘들었어' },
  { value: 'thought_of_you', emoji: '💌', label: '네 생각났어' },
];

export interface TodayLogWidgetProps {
  /**
   * Fires after a record is actually gone from the composer -- delivered,
   * queued offline, or queued after a failed online attempt. Optional so the
   * Home widget usage (`WIDGET_REGISTRY`, no props passed) is unaffected; the
   * 기록 tab's always-available composer sheet uses it to close itself.
   */
  onSaved?: () => void;
  /**
   * Reports the real composer write boundary to a containing sheet. A parent
   * must not dismiss the sheet while an in-memory photo is being admitted to
   * the record or the offline outbox.
   */
  onBusyChange?: (busy: boolean) => void;
}

export function TodayLogWidget({ onSaved, onBusyChange }: TodayLogWidgetProps = {}) {
  const { state, sharedSyncStatus, addRecordWithMedia, queueRecordForLater } = useStore();
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
  const partnerName = state.profile.couple.partnerName || '파트너';
  /**
   * Whether there is anyone on the other side yet.
   *
   * During the waiting period a couple space exists -- an invite code has been
   * created -- but nobody has joined it. PRODUCT_V3 §7.6: a record left before
   * the connection is NOT shared automatically when the partner arrives.
   * Exposure is an explicit act, never a default, and "I ticked 공유하기 on a day
   * when nobody could read it" is not that act.
   */
  const hasPartner = Boolean(
    state.profile.couple.connected && state.profile.couple.status === 'active',
  );
  const todayStr = toLocalDateString(localToday());

  /**
   * Restore an unsent draft.
   *
   * Switching tabs unmounts this widget, so the text used to be thrown away
   * silently -- and a five-tab bar invites exactly that glance at 기록 or 일정.
   * The stash is in-memory and per-user (see lib/composerDraft.ts): it survives
   * navigation, never touches storage, and cannot cross accounts.
   */
  const draftUserId = state.authenticatedUser?.id || state.profile.id;
  // Read once per identity: re-reading on every render would fight the user's own
  // edits, since this component is the thing that writes the stash.
  const restoredDraft = React.useMemo(() => readComposerDraft(draftUserId), [draftUserId]);

  const [log, setLog] = useState(restoredDraft?.log ?? '');
  const [reaction, setReaction] = useState<ReactionType | undefined>(restoredDraft?.reaction);
  const [isPrivate, setIsPrivate] = useState(restoredDraft?.isPrivate ?? false);
  const [talkAbout, setTalkAbout] = useState(false);
  /**
   * Explicit, opt-IN sharing of machine-suggested emotion (PRODUCT_V3 §13).
   * Defaults false: leaving suggested chips untouched is not the same as
   * choosing to share them, so a shared record's emotion stays author-only
   * until this is turned on.
   */
  const [shareEmotion, setShareEmotion] = useState(false);
  /** Files chosen but not yet uploaded; upload happens on save. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Reopen the card when there is something waiting, so a restored draft is not
  // invisible behind a collapsed composer.
  const [showInputCard, setShowInputCard] = useState(!!restoredDraft);
  /**
   * When the composer opened, for the one duration §19 permits us to measure.
   *
   * The strategy's target is a 30-second entry, and there is no way to know
   * whether that holds without timing it. A ref rather than state: this must not
   * cause a render, and it must not reset when the text changes.
   *
   * An ELAPSED time, never a wall-clock one. §19 allows the former and forbids
   * the latter, and only the difference between two of these ever leaves the
   * device.
   */
  const composerOpenedAt = React.useRef<number | null>(restoredDraft ? Date.now() : null);
  const [isSaving, setIsSaving] = useState(false);
  const setSaving = React.useCallback((busy: boolean) => {
    setIsSaving(busy);
    onBusyChange?.(busy);
  }, [onBusyChange]);
  const isOffline = !useOnlineStatus();

  // State for rule-suggested confirmed IDs


  const fileInputRef = React.useRef<HTMLInputElement>(null);
  /**
   * Live mirror of `pendingFiles`.
   *
   * `recorder.onstop` is a closure created when recording STARTS, so it cannot
   * read `pendingFiles` directly -- the user may have attached a photo while
   * recording. The overflow decision has to be made against the current count,
   * and it has to be made outside the state updater so the toast is not a side
   * effect of a reducer.
   */
  const pendingFilesRef = React.useRef<File[]>([]);
  /** Synchronous save gate. See `handlePost`. */
  const saveInFlightRef = React.useRef(false);
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  /**
   * Keep the in-memory stash in step with the composer.
   *
   * Written on every change rather than on unmount, because an unmount caused by a
   * route change is not guaranteed to run before the new route tears this tree
   * down, and losing the draft is the exact failure being fixed.
   */
  React.useEffect(() => {
    writeComposerDraft(draftUserId, { log, isPrivate, reaction });
  }, [draftUserId, log, isPrivate, reaction]);

  /**
   * Feelings read out of the text, offered as a question rather than as a verdict.
   *
   * The analyser runs only when `analyse` is called, and it is called at exactly
   * two moments: the text field loses focus, and save is pressed. It used to run
   * 300 ms after every pause in typing, which re-scanned the whole body dozens of
   * times per entry, read unfinished sentences, and narrated the writer's mood
   * back at them mid-sentence. See `lib/onDeviceInference.ts`.
   */
  const review = useEmotionCandidatesAtBoundary();
  const analyseLog = review.analyse;
  const settleComposition = React.useCallback(() => {
    if (saveInFlightRef.current) return;
    analyseLog(log);
  }, [analyseLog, log]);

  /**
   * The emotion array handed to save.
   *
   * Carries both answered and unanswered readings, each tagged with what it
   * actually is. `emotionFlowForStorage` then keeps only `user_confirmed` items,
   * so an unanswered guess reaches neither the row nor the partner -- the filter
   * is real now that the writer no longer stamps everything as confirmed.
   *
   * `candidatesToFlowItems` drops the `evidence` phrase, which is the single point
   * where the display-only text taken from the diary body is stopped from reaching
   * the database -- the same guarantee `matchedText` always had.
   */
  const reviewedFlow: EmotionFlowItem[] = useMemo(
    () => review.toFlowItems(isPrivate, shareEmotion),
    [review, isPrivate, shareEmotion],
  );

  /** What will actually survive the save, which is what the preview must show. */
  const userConfirmedFlow: EmotionFlowItem[] = useMemo(
    () => reviewedFlow.filter((item) => item.source === 'user_confirmed'),
    [reviewedFlow],
  );

  const MAX_ATTACHMENTS = 4;

  const hasVisualAttachment = pendingFiles.some((file) => {
    const classified = classifyMediaFile(file);
    return !('error' in classified)
      && (classified.type === 'photo' || classified.type === 'video');
  });

  const handleOpenInput = (type: 'text' | 'photo' | 'instant') => {
    if (saveInFlightRef.current) return;
    openComposer();
    if (type === 'text') return;

    // `input.click()` MUST run in the same task as the tap that triggered it.
    //
    // This used to sit inside `setTimeout(..., 50)`, which moves the click into a
    // later macrotask and therefore outside the transient user activation the
    // originating gesture created. Chrome on the desktop tolerates that; Android
    // WebView and WKWebView are stricter about gesture-gated file choosers, and
    // there the picker simply never appeared. The delay was never necessary: the
    // file input is rendered unconditionally, OUTSIDE the `showInputCard` block,
    // so `fileInputRef.current` is already attached when this runs. React
    // flushes the `openComposer()` above after this handler returns, so
    // the render-then-open ordering the UI wants is unchanged.
    const input = fileInputRef.current;
    if (!input) {
      // The old code returned silently here, so a missing input looked like a
      // user who changed their mind. Say something instead.
      toast.error('첨부 창을 열지 못했어요. 화면을 새로 고친 뒤 다시 시도해 주세요.');
      return;
    }

    // 'instant' captures a new photo; 'photo' opens the picker for existing
    // photos. (Video/audio are refused by the §12.4 upload gate in
    // `classifyMediaFile`, and MEDIA_ACCEPT no longer offers them.)
    //
    // `image/*` only, deliberately. Capacitor's BridgeWebChromeClient reads the
    // accept list to decide WHICH capture intent to launch: with `video/*` also
    // present and `capture` set it prefers ACTION_VIDEO_CAPTURE, so the button
    // labelled 지금찍기 opened a camcorder. See onShowFileChooser in
    // node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java.
    input.accept = type === 'instant' ? 'image/*' : MEDIA_ACCEPT;
    if (type === 'instant') input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    // Reset immediately so picking the same file twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (saveInFlightRef.current) return;
    if (selected.length === 0) return;

    const accepted: File[] = [];
    for (const file of selected) {
      if (pendingFiles.length + accepted.length >= MAX_ATTACHMENTS) {
        toast.info(`첨부는 한 번에 ${MAX_ATTACHMENTS}개까지 가능해요.`);
        break;
      }
      const classified = classifyMediaFile(file);
      if ('error' in classified) {
        toast.error(`${file.name}: ${classified.error}`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) {
      setPendingFiles((prev) => [...prev, ...accepted]);
    }
  };

  const removePendingFile = (index: number) => {
    if (saveInFlightRef.current) return;
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Is there anything a save could actually persist?
   *
   * The same three-part condition `handlePost` enforces, so the affordance and
   * the validation cannot drift apart.
   */
  const hasContentToSave = log.trim().length > 0 || pendingFiles.length > 0 || !!reaction;

  const handlePost = async () => {
    /**
     * `isSaving` and the button's `disabled` are both React state, so they only
     * take effect on the next render. Two activations inside one frame -- a
     * double tap on a full-width primary CTA -- therefore both read `false` and
     * both reach the server, producing a duplicate record and a duplicate
     * upload. The gate has to be synchronous to hold.
     */
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      await runPost();
    } finally {
      // Released even on failure, so a deliberate retry still works.
      saveInFlightRef.current = false;
    }
  };

  /** Opening the composer starts the one timer §19 permits. */
  const openComposer = () => {
    if (saveInFlightRef.current) return;
    if (composerOpenedAt.current === null) composerOpenedAt.current = Date.now();
    setShowInputCard(true);
  };

  const runPost = async () => {
    if (isSaving) return;
    if (!log.trim() && pendingFiles.length === 0 && !reaction) {
      toast.error('내용, 첨부파일, 또는 리액션을 선택해주세요.');
      return;
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    /*
      §7.6 enforced on the WRITE, not only in the UI.

      Hiding the toggle is copy; this is the contract. Without a partner the
      record is stored private regardless of what any restored draft, stale state
      or future caller says -- a draft written while connected and saved after an
      unlink would otherwise carry `isPrivate: false` into a space where the
      person it was meant for is gone.

      When the partner arrives, §7.6's question is what turns any of this shared.
      Nothing does it automatically.
    */
    const effectivePrivate = hasPartner ? isPrivate : true;
    const draft = {
      date: todayStr,
      time: timeStr,
      authorRole: state.profile.role,
      log,
      reaction,
      isPrivate: effectivePrivate,
      talkAbout: !effectivePrivate && talkAbout,
      emotionFlow: userConfirmedFlow,
      emotionUpdatedAt: userConfirmedFlow.length > 0 ? now.toISOString() : null,
    };

    /**
     * Everything that has to happen once the record is no longer unsent work.
     *
     * Shared between a delivered write and a queued one, because from the
     * composer's point of view they are the same event: the text has left the
     * composer and must not be offered for editing as if it were still a draft.
     */
    const clearComposer = () => {
      setLog('');
      setReaction(undefined);
      review.reset();
      setIsPrivate(false);
      setTalkAbout(false);
      setShareEmotion(false);
      clearComposerDraft(draftUserId);
    };

    /*
      Offline is the one connectivity fact the OS is trusted about, so the write is
      not attempted -- it is stored.
      This REPLACES a pre-emptive refusal that returned `OFFLINE_READONLY_MESSAGE`.
      That refusal was honest about the network and wrong about the record: the
      typed text, and any voice memo synthesised into an in-memory File, existed
      nowhere on disk, so closing the app lost them. Queueing keeps them and
      delivers them when the connection returns.
    */
    if (isOffline) {
      setSaving(true);
      let queueResult: { queued: boolean; error?: string };
      try {
        queueResult = await queueRecordForLater(draft, pendingFiles);
      } finally {
        setSaving(false);
      }
      if (!queueResult.queued) {
        // Could not even store it. Say so, and keep everything in the composer.
        toast.error(queueResult.error || OFFLINE_READONLY_MESSAGE);
        return;
      }
      clearComposer();
      setPendingFiles([]);
      setShowInputCard(false);
      onSaved?.();
      toast.success('오프라인이라 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    setSaving(true);
    let result: {
      ok: boolean;
      failedFiles: string[];
      error?: string;
      queued?: boolean;
      reason?: RecordMutationReason;
    };
    try {
      result = await addRecordWithMedia(draft, pendingFiles);
    } finally {
      setSaving(false);
    }

    if (result.queued) {
      // The attempt failed on a connection the OS called usable, and the store
      // stored it rather than discarding it. This is the case the old code lost
      // silently: `navigator.onLine === true` skipped the offline refusal, the
      // write failed, and the text went with the toast.
      clearComposer();
      setPendingFiles([]);
      setShowInputCard(false);
      onSaved?.();
      toast.success('지금은 보내지 못해 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    if (!result.ok) {
      // No fallback copy: the store now ALWAYS supplies a cause-specific message
      // (see serverErrors.ts). The old fallback blamed the internet connection for
      // permission and membership failures, which sent users into an endless retry
      // loop instead of telling them what to fix.
      if (result.reason === 'protection_required') {
        toast.error(result.error || '지금은 이 기록을 안전하게 저장할 수 없어요.', {
          action: {
            label: isDeviceProtectionEnabled() ? '설정 열기' : '다시 시도',
            onClick: isDeviceProtectionEnabled()
              ? () => navigate('/settings')
              : () => { void handlePost(); },
          },
        });
      } else {
        toast.error(result.error || '기록을 저장하지 못했어요.');
      }
      return;
    }

    /*
      §19 measurement, on the one path that actually completed.

      Emitted AFTER the save succeeded, so a failed write is not counted as an
      entry. The value is an elapsed duration and nothing else -- no text, no
      length, no visibility, no emotion. The strategy wants to know whether a
      30-second entry is real; that question needs a number and no more of one
      than this.

      Fire-and-forget: the emitter swallows its own failures, so an offline
      analytics insert cannot make a successful save look unsuccessful.
    */
    if (composerOpenedAt.current !== null && draftUserId) {
      void recordProductEvent({
        kind: 'record_composed',
        screen: 'home',
        durationMs: Date.now() - composerOpenedAt.current,
      }, { expectedUserId: draftUserId });
      composerOpenedAt.current = null;
    }

    clearComposer();

    if (result.failedFiles.length > 0) {
      // Be explicit: the text was saved, the files were not.
      //
      // The failed files are KEPT in the composer and it stays open. Clearing
      // them here used to destroy the only copy of a voice memo: the recording is
      // synthesised into an in-memory File (see `stopRecording`) and exists
      // nowhere on disk, so "다시 첨부해 주세요" was an instruction the user could
      // not follow. Photos were merely annoying to re-pick; audio was gone.
      const failed = new Set(result.failedFiles);
      setPendingFiles((current) => current.filter((file) => failed.has(file.name)));
      toast.warning(
        `기록은 저장했지만 첨부 ${result.failedFiles.length}개를 올리지 못했어요. 아래에 그대로 두었으니 다시 시도해 주세요.`,
      );
      return;
    }

    setPendingFiles([]);
    setShowInputCard(false);
    onSaved?.();
    // Says what actually happened. Telling someone their words were delivered to
    // a partner who has not joined would be the app reporting a fact it made up.
    toast.success(
      !hasPartner
        ? '나에게만 남겼어요. 연결되면 보여줄지 물어볼게요.'
        : isPrivate ? '나에게만 남겼어요.' : `${partnerName}에게 전했어요.`,
    );
  };

  /**
   * What I have left today. Mine only.
   *
   * This filtered by DATE alone, so it listed both people's records -- and once
   * the composer became a pinned home surface for both roles, that made it repeat
   * the partner-day timeline sitting directly above it on the receiver's home.
   * PRODUCT_V3 §6 is explicit that two surfaces must not say the same thing.
   *
   * Own-only is also what this list is FOR. It is the answer to "did that land?",
   * which is the question the person writing all day actually has, and the one
   * the app answers without a read receipt (§5.1 -- no surveillance).
   *
   * `state.records` is already narrowed by `visibleRecordsForViewer` at every sync
   * boundary, so this is a product filter rather than a privacy one.
   */
  const todayRecords = state.records
    .filter((r) => r.date === todayStr
      && isOwnRecord(r, { userId: state.profile.id, role: state.profile.role }))
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
    
  return (
    <div className="flex flex-col">
      <h2 className="text-heading text-foreground mb-2">오늘의 기록</h2>

      {/*
        Compact capture launcher — one row, three type controls.
        Design v2.1 §5.3: "Replace the four big tiles with one compact row of type
        controls." Visual footprint is 36px per control, hit target 44px via padding.
        Progressive disclosure: no text area on first paint.

        Three, not four: the 음성 recorder left with the §12.4 upload gate
        (photo-only until the P6 encrypted media foundation), and 사진·영상 became
        사진 for the same reason. `whitespace-nowrap` on each label because the
        audited failure mode was chips wrapping mid-word (「사진·영/상」) at 390px —
        a label may never break inside itself; the row wraps whole chips instead.
      */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          disabled={isSaving}
          onClick={() => handleOpenInput('instant')}
          className="press-response relative flex items-center gap-1 px-3 rounded-control bg-coral/10 border border-coral/20 text-coral-strong text-label font-semibold h-9 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <Camera size={16} aria-hidden="true" />
          <span className="whitespace-nowrap">지금찍기</span>
        </button>

        <button
          disabled={isSaving}
          onClick={() => handleOpenInput('photo')}
          className="press-response relative flex items-center gap-1 px-3 rounded-control bg-muted border border-border text-foreground text-label font-semibold h-9 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <ImageIcon size={16} className="text-muted-foreground" aria-hidden="true" />
          <span className="whitespace-nowrap">사진</span>
        </button>

        <button
          disabled={isSaving}
          onClick={() => handleOpenInput('text')}
          className="press-response relative flex items-center gap-1 px-3 rounded-control bg-muted border border-border text-foreground text-label font-semibold h-9 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <Send size={16} className="text-muted-foreground" aria-hidden="true" />
          <span className="whitespace-nowrap">한줄</span>
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        multiple
        disabled={isSaving}
        accept={MEDIA_ACCEPT}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Draft continuation prompt — only when there IS a draft */}
      {!showInputCard && restoredDraft && restoredDraft.log && (
        <button
          type="button"
          disabled={isSaving}
          onClick={() => openComposer()}
          className="press-response-row mt-2 w-full text-left text-caption text-muted-foreground min-h-11 flex items-center"
        >
          이어 쓰던 글이 있어요 <span className="ml-auto text-coral-strong font-semibold">이어쓰기 ›</span>
        </button>
      )}

      {/* Input Composer — progressive disclosure: only after a type is chosen */}
      {/*
        컴포저가 공책 지면이 됐다 (2026-08-23).

        로직은 하나도 바뀌지 않았다 -- 오프라인 큐, 보호 설정 안내, §19 계측, 실패한
        파일 처리까지 그대로다. 바뀐 것은 **표현**뿐이다: 채운 카드가 아니라 종이 위에
        직접 쓰고, 글은 손글씨로 그려진다.
      */}
      {showInputCard && (
        <div className="mt-3 animate-fade-in space-y-3">
          <div className="flex items-center gap-2">
            {/* 일기의 날짜 도장. 노트 상단에 찍는 그것. */}
            <span
              className="px-2.5 py-1 text-caption tabular-nums"
              style={{
                color: 'var(--ink-soft)',
                border: 'var(--stroke-thin) solid var(--ink-faint)',
                borderRadius: '80px 6px 90px 6px / 6px 90px 6px 80px',
              }}
            >
              {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
            </span>
            <span className="flex-1" />
            <button
              disabled={isSaving}
              onClick={() => {
                if (!saveInFlightRef.current) setShowInputCard(false);
              }}
              className="press-response min-h-11 min-w-11 flex items-center justify-center text-caption"
              style={{ color: 'var(--ink-soft)' }}
            >
              닫기
            </button>
          </div>
          
          {/*
            A placeholder is not a label: it disappears on the first keystroke and
            support for reading it varies between screen readers. This is the main
            composer of the whole app, so it gets a real name. WCAG 2.1 SC 1.3.1.
          */}
          <textarea
            value={log}
            readOnly={isSaving}
            onChange={(e) => {
              if (!saveInFlightRef.current) setLog(e.target.value);
            }}
            /*
              Leaving the field is the composition boundary the analyser waits for.
              A blur means a thought is finished, which a 300 ms pause does not --
              and it is the difference between reading `무서운` and `무서운 영화 봤어`.
            */
            onBlur={settleComposition}
            aria-label="오늘의 기록"
            placeholder="오늘 어땠어?"
            rows={6}
            className="hand-text w-full resize-none bg-transparent text-heading placeholder:opacity-40"
            style={{ color: 'var(--ink)', lineHeight: '30px' }}
          />

          {/*
            One-tap self-description. Optional: `hasContentToSave` already
            counts `reaction` on its own, so a tag alone is a valid record, and
            leaving all four unselected is equally valid -- this never blocks
            save.
          */}
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="오늘 하루 태그">
            {AUTHOR_TAGS.map((tag) => {
              const selected = reaction === tag.value;
              return (
                <button
                  key={tag.value}
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    if (!saveInFlightRef.current) setReaction(selected ? undefined : tag.value);
                  }}
                  aria-pressed={selected}
                  className={`press-response min-h-11 px-3 rounded-control text-label font-semibold flex items-center gap-1 border ${ selected ? 'bg-coral/10 border-coral/30 text-coral-strong' : 'bg-muted border-border text-muted-foreground' }`}
                >
                  <span aria-hidden="true">{tag.emoji}</span>
                  {tag.label}
                </button>
              );
            })}
          </div>

          {pendingFiles.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-caption font-semibold text-muted-foreground">
                첨부 {pendingFiles.length}개
              </span>
              <div className="flex flex-wrap gap-2">
                {pendingFiles.map((file, index) => {
                  const classified = classifyMediaFile(file);
                  const kind = 'error' in classified ? 'photo' : classified.type;
                  return (
                    <span
                      key={`${file.name}-${index}`}
                      className="flex min-h-11 items-center gap-1.5 max-w-full pl-2 rounded-control bg-muted border border-border text-caption font-semibold text-foreground"
                    >
                      {kind === 'photo' && <ImageIcon size={13} className="text-coral shrink-0" />}
                      {kind === 'video' && <Film size={13} className="text-info shrink-0" />}
                      {kind === 'voice' && <Music size={13} className="press-response text-coral shrink-0" />}
                      <span className="truncate max-w-[130px]">{file.name}</span>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => removePendingFile(index)}
                        aria-label={`${file.name} 첨부 제거`}
                        className="press-response inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:text-destructive"
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
              </div>
              {hasVisualAttachment && (
                <p className="flex items-start gap-1.5 text-caption text-muted-foreground leading-tight break-keep pt-1">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0 text-coral-strong" aria-hidden="true" />
                  <span>사진 위치정보는 자동으로 지워요. 영상 메타데이터와 화면 속 정보는 남을 수 있으니 부대 위치·훈련·작전 자료는 첨부하지 마세요.</span>
                </p>
              )}
            </div>
          )}

          {/*
            Suggestions, not decisions. Every reading here is unanswered until it
            is pressed, and only an answered one is stored or shared.
          */}
          <EmotionSuggestionReview
            candidates={review.candidates}
            removed={review.removed}
            confirmedIds={review.confirmedIds}
            onConfirm={(id) => {
              if (!saveInFlightRef.current) review.confirm(id);
            }}
            onConfirmAll={() => {
              if (!saveInFlightRef.current) review.confirmAll();
            }}
            onChangeEmotion={(id, basic) => {
              if (!saveInFlightRef.current) review.changeEmotion(id, basic);
            }}
            onRemove={(id) => {
              if (!saveInFlightRef.current) review.remove(id);
            }}
            onRestore={(id) => {
              if (!saveInFlightRef.current) review.restore(id);
            }}
            visibilityNote={
              isPrivate
                ? '🔒 나만 보기 기록이라 확인한 마음도 나만 볼 수 있어요.'
                : shareEmotion
                  ? `확인한 마음은 ${partnerName}에게도 함께 보여요. 확인하지 않은 건 보이지 않아요.`
                  : `기록은 공유해도 이 마음은 나만 볼 수 있어요. ${partnerName}에게도 보여주려면 아래에서 켜주세요.`
            }
            shareWithPartner={isPrivate ? undefined : shareEmotion}
            onToggleShareWithPartner={isPrivate ? undefined : (value) => {
              if (!saveInFlightRef.current) setShareEmotion(value);
            }}
            disabled={isSaving}
            className="animate-fade-in"
          />

          {/* Preview of the flow that is about to be saved. Derived only, never
              persisted, and computed from the same array as the save payload. */}
          <EmotionFlowInsightCard items={userConfirmedFlow} variant="composer" />

          {/*
            §7.6, before the partner exists.

            A visibility toggle here would be offering a choice the app cannot
            honour: there is nobody to share with, and a record ticked 공유하기
            today would become readable the instant someone joins -- which is the
            automatic exposure §7.6 forbids by name.

            So the control is replaced by a statement of fact. Writing alone is
            the point of the waiting period, not a degraded mode.
          */}
          {!hasPartner && (
            <p
              data-testid="composer-waiting-notice"
              className="pt-2 text-caption text-muted-foreground break-keep leading-relaxed"
            >
              아직 연결된 상대가 없어요. 지금 남기는 기록은 나만 볼 수 있고,
              연결되면 어떤 걸 보여줄지 그때 물어볼게요.
            </p>
          )}

          <div className="pt-2 flex items-center justify-between gap-2">
            {hasPartner && (
            <button
              disabled={isSaving}
              onClick={() => {
                if (!saveInFlightRef.current) setIsPrivate(!isPrivate);
              }}
              className={`press-response min-h-11 px-3 rounded-control text-label font-semibold flex items-center gap-1 ${ isPrivate ? 'bg-warning-surface text-warning-foreground' : 'bg-muted text-muted-foreground' }`}
            >
              {isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
              {isPrivate ? '나만 보기' : '공유하기'}
            </button>
            )}

            {hasPartner && !isPrivate && (
              <label className="min-h-11 px-3 rounded-control bg-coral/10 text-coral-strong text-label font-semibold flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isSaving}
                  checked={talkAbout}
                  onChange={(event) => {
                    if (!saveInFlightRef.current) setTalkAbout(event.target.checked);
                  }}
                  className="accent-coral"
                />
                통화 때 꼭 얘기
              </label>
            )}

            <button
              onClick={handlePost}
              /*
                Do not let pressing 저장 blur the textarea.

                The textarea settles the composition on blur, and settling renders
                `EmotionSuggestionReview` directly above this row. So the first tap
                on 저장 blurred the field, the review appeared, this button moved
                out from under the finger, and the click was never delivered --
                silently, with no toast and no request. A second tap worked,
                because by then the review was already on screen.

                Measured in a real browser: with the field blurred first, one tap
                saves; without, the first tap does nothing
                (`e2e/coupleMatrix.spec.ts` D-05 is the regression).

                `preventDefault` on mousedown suppresses the focus change and
                therefore the reflow, while still delivering the click. Keyboard
                users are unaffected -- they arrive by Tab, and Enter/Space do not
                go through mousedown. Skipping the analysis on this path costs
                nothing: only CONFIRMED readings are ever saved, and an unanswered
                suggestion contributes nothing to the payload.
              */
              onMouseDown={(event) => event.preventDefault()}
              disabled={isSaving || !hasContentToSave}
              className="press-response min-h-11 px-4 rounded-control bg-coral-strong text-coral-strong-foreground font-bold text-label disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* Today's real records preview — immediately below the launcher */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-label font-semibold text-foreground">
            오늘의 타임라인
          </h3>
          <span className="text-caption text-muted-foreground tabular-nums">
            {todayRecords.length}개
          </span>
        </div>
        
        {todayRecords.length === 0 ? (
          <p className="text-caption text-muted-foreground py-3">
            {sharedSyncStatus === 'unavailable'
              ? '기록을 확인하는 중이에요.'
              : '아직 남겨진 기록이 없어요. 소중한 순간을 남겨보세요.'}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {todayRecords.slice(-3).map(r => {
              const confirmedFlow = r.emotionFlow?.filter(f => f.source === 'user_confirmed') || [];
              return (
                <div key={r.id} className="flex items-start gap-2 py-2 min-h-11">
                  <span className="shrink-0 text-caption text-muted-foreground tabular-nums w-10 pt-0.5">{r.time}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-foreground break-keep line-clamp-2">
                      {r.log || (r.attachments ? '사진 기록' : '리액션')}
                    </p>
                    {confirmedFlow.length > 0 && (
                      <span className="text-caption text-muted-foreground mt-0.5 inline-block">
                        {confirmedFlow.map((f, i) => (
                          <span key={f.id || i}>
                            {i > 0 && ' → '}{basicEmotionLabelOf(f)}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {todayRecords.length > 3 && (
              <p className="text-caption text-muted-foreground pt-2">
                외 {todayRecords.length - 3}개의 기록
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
