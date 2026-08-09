import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/useStore';
import {
  Camera, Image as ImageIcon, Send, Lock, Unlock, ShieldCheck,
  Mic, Square, X, Film, Music,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { toLocalDateString, localToday } from '@/lib/utils';
import { EmotionChipEditor } from '@/components/EmotionChipEditor';
import { useEmotionCandidatesForText } from '@/lib/useEmotionCandidates';
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from '@/lib/composerDraft';
import { classifyMediaFile, MEDIA_ACCEPT } from '@/lib/records';
import { isNativePlatform } from '@/lib/platform';
import {
  MICROPHONE_RATIONALE,
  microphoneDeniedMessage,
  microphoneUnsupportedMessage,
} from '@/lib/nativePermissions';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import type { ReactionType, EmotionFlowItem } from '@/types';

export function TodayLogWidget() {
  const { state, addRecordWithMedia, queueRecordForLater } = useStore();
  const partnerName = state.profile.couple.partnerName || '파트너';
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
  /** Files chosen but not yet uploaded; upload happens on save. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Reopen the card when there is something waiting, so a restored draft is not
  // invisible behind a collapsed composer.
  const [showInputCard, setShowInputCard] = useState(!!restoredDraft);
  const [isSaving, setIsSaving] = useState(false);
  const isOffline = !useOnlineStatus();
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // State for rule-suggested confirmed IDs


  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recordedChunksRef = React.useRef<Blob[]>([]);
  const recordTimerRef = React.useRef<number | null>(null);
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

  const [debouncedLog, setDebouncedLog] = useState('');

  // Debounce typing by 300ms to eliminate input lag on older mobile devices
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLog(log);
    }, 300);
    return () => clearTimeout(timer);
  }, [log]);

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
   * Feelings read out of the text, included by default and removable.
   *
   * Replaces the opt-in chip list. Nothing was recorded before unless the user
   * tapped a chip, so the ordinary path -- write, save -- stored no feeling and
   * the partner's flow stayed empty. Now the app commits to a reading, shows the
   * phrase it came from, and lets the user delete or correct it.
   */
  const review = useEmotionCandidatesForText(debouncedLog);

  // The exact array that will be persisted. The preview card below reads this
  // same value, so what the user sees can never disagree with what is saved.
  //
  // The rule engine marks sensitive emotion groups as `author_only` by default.
  // That default only applies to *suggestions*: tapping a chip on a record the
  // author is sharing is explicit consent to share that tag. On a private
  // record everything stays author-only. This keeps author-only items out of
  // shared rows (see lib/privacy.ts) without silently discarding a selection.
  /**
   * The exact array that will be persisted. The preview card below reads this
   * same value, so what the user sees can never disagree with what is saved.
   *
   * `candidatesToFlowItems` drops the `evidence` phrase, which is the single point
   * where the display-only text taken from the diary body is stopped from reaching
   * the database -- the same guarantee `matchedText` always had.
   */
  const userConfirmedFlow: EmotionFlowItem[] = useMemo(
    () => review.toFlowItems(isPrivate),
    [review, isPrivate],
  );

  const MAX_ATTACHMENTS = 4;

  /**
   * Native builds surface the microphone rationale in-app.
   *
   * `RECORD_AUDIO` / `NSMicrophoneUsageDescription` are declared because this
   * widget records voice notes, and a store reviewer -- and more importantly the
   * user -- should be able to read why before the OS prompt appears. It hides
   * once a voice note is attached, so it is a first-use explanation rather than
   * permanent furniture. On the web the browser's own permission chip already
   * names the origin, so nothing extra is shown.
   */
  const isNative = useMemo(() => isNativePlatform(), []);
  const hasVoiceAttachment = pendingFiles.some((file) => {
    const classified = classifyMediaFile(file);
    return !('error' in classified) && classified.type === 'voice';
  });
  const hasVisualAttachment = pendingFiles.some((file) => {
    const classified = classifyMediaFile(file);
    return !('error' in classified)
      && (classified.type === 'photo' || classified.type === 'video');
  });

  const handleOpenInput = (type: 'text' | 'photo' | 'instant') => {
    setShowInputCard(true);
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
    // flushes the `setShowInputCard(true)` above after this handler returns, so
    // the render-then-open ordering the UI wants is unchanged.
    const input = fileInputRef.current;
    if (!input) {
      // The old code returned silently here, so a missing input looked like a
      // user who changed their mind. Say something instead.
      toast.error('첨부 창을 열지 못했어요. 화면을 새로 고친 뒤 다시 시도해 주세요.');
      return;
    }

    // 'instant' captures a new photo; 'photo' opens the picker for existing
    // photos, videos and audio.
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
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /** Pick a recording MIME type this browser actually supports. */
  const pickAudioMimeType = (): string | undefined => {
    if (typeof MediaRecorder === 'undefined') return undefined;
    const candidates = ['audio/webm', 'audio/mp4', 'audio/ogg'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
  };

  const stopRecordingTimer = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    if (isRecording) return;
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      toast.error(microphoneUnsupportedMessage());
      return;
    }

    const mimeType = pickAudioMimeType();
    if (!mimeType) {
      toast.error(microphoneUnsupportedMessage());
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      console.error('[gomsinlog] Microphone permission denied:', error);
      // Native builds have no "browser settings" to open. See
      // lib/nativePermissions.ts.
      toast.error(microphoneDeniedMessage());
      return;
    }

    recordedChunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      stopRecordingTimer();
      // Always release the microphone, even if the blob turns out unusable.
      stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);

      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      recordedChunksRef.current = [];
      if (blob.size === 0) {
        toast.error('녹음된 소리가 없어요. 다시 시도해 주세요.');
        return;
      }

      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `음성기록-${Date.now()}.${ext}`, { type: mimeType });
      const classified = classifyMediaFile(file);
      if ('error' in classified) {
        toast.error(classified.error);
        return;
      }
      // The success toast used to fire unconditionally, so a recording dropped
      // for hitting the attachment cap was announced as added. Report what
      // actually happened, matching the file-select path's overflow behaviour.
      if (pendingFilesRef.current.length >= MAX_ATTACHMENTS) {
        toast.info(`첨부는 한 번에 ${MAX_ATTACHMENTS}개까지 가능해요.`);
        return;
      }
      setPendingFiles((prev) => [...prev, file]);
      toast.success('음성 기록이 추가되었어요.');
    };

    recorder.start();
    setIsRecording(true);
    setRecordSeconds(0);
    setShowInputCard(true);
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => {
        // Hard stop at 3 minutes so a forgotten recording cannot grow unbounded.
        if (s + 1 >= 180) {
          if (recorder.state !== 'inactive') recorder.stop();
          return 180;
        }
        return s + 1;
      });
    }, 1000);
  };

  const handleStopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };

  // Release the microphone and timer if the widget unmounts mid-recording.
  React.useEffect(() => {
    return () => {
      stopRecordingTimer();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    };
  }, []);

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

  const runPost = async () => {
    if (isSaving) return;
    if (isRecording) {
      toast.info('녹음을 먼저 마쳐주세요.');
      return;
    }
    if (!log.trim() && pendingFiles.length === 0 && !reaction) {
      toast.error('내용, 첨부파일, 또는 리액션을 선택해주세요.');
      return;
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const draft = {
      date: todayStr,
      time: timeStr,
      authorRole: state.profile.role,
      log,
      reaction,
      isPrivate,
      talkAbout: !isPrivate && talkAbout,
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
      setIsSaving(true);
      let queueResult: { queued: boolean; error?: string };
      try {
        queueResult = await queueRecordForLater(draft, pendingFiles);
      } finally {
        setIsSaving(false);
      }
      if (!queueResult.queued) {
        // Could not even store it. Say so, and keep everything in the composer.
        toast.error(queueResult.error || OFFLINE_READONLY_MESSAGE);
        return;
      }
      clearComposer();
      setPendingFiles([]);
      setShowInputCard(false);
      toast.success('오프라인이라 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    setIsSaving(true);
    let result: { ok: boolean; failedFiles: string[]; error?: string; queued?: boolean };
    try {
      result = await addRecordWithMedia(draft, pendingFiles);
    } finally {
      setIsSaving(false);
    }

    if (result.queued) {
      // The attempt failed on a connection the OS called usable, and the store
      // stored it rather than discarding it. This is the case the old code lost
      // silently: `navigator.onLine === true` skipped the offline refusal, the
      // write failed, and the text went with the toast.
      clearComposer();
      setPendingFiles([]);
      setShowInputCard(false);
      toast.success('지금은 보내지 못해 저장해 뒀어요. 연결되면 자동으로 보낼게요.');
      return;
    }

    if (!result.ok) {
      // No fallback copy: the store now ALWAYS supplies a cause-specific message
      // (see serverErrors.ts). The old fallback blamed the internet connection for
      // permission and membership failures, which sent users into an endless retry
      // loop instead of telling them what to fix.
      toast.error(result.error || '기록을 저장하지 못했어요.');
      return;
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
    toast.success(isPrivate ? '나에게만 남겼어요.' : `${partnerName}에게 전했어요.`);
  };

  // Filter today's records
  const todayRecords = state.records
    .filter((r) => r.date === todayStr)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
    
  return (
    <div className="flex flex-col">
      <h2 className="text-heading text-foreground mb-2">오늘의 기록</h2>

      {/*
        Compact capture launcher — one row, four type controls.
        Design v2.1 §5.3: "Replace the four big tiles with one compact row of type
        controls." Visual footprint is 36px per control, hit target 44px via padding.
        Progressive disclosure: no text area on first paint.
      */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleOpenInput('instant')}
          className="relative flex items-center gap-1 px-3 rounded-control bg-coral/10 border border-coral/20 text-coral-strong text-label font-semibold h-9 active:scale-95 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <Camera size={16} aria-hidden="true" />
          <span>지금찍기</span>
        </button>

        <button
          onClick={() => handleOpenInput('photo')}
          className="relative flex items-center gap-1 px-3 rounded-control bg-muted border border-border text-foreground text-label font-semibold h-9 active:scale-95 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <ImageIcon size={16} className="text-muted-foreground" aria-hidden="true" />
          <span>사진·영상</span>
        </button>

        <button
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          aria-pressed={isRecording}
          className={`relative flex items-center gap-1 px-3 rounded-control border text-label font-semibold h-9 active:scale-95 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${
            isRecording
              ? 'bg-destructive/10 border-destructive/30 text-destructive'
              : 'bg-muted border-border text-foreground'
          }`}
        >
          {isRecording ? <Square size={16} aria-hidden="true" /> : <Mic size={16} className="text-muted-foreground" aria-hidden="true" />}
          <span>
            {isRecording
              ? `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(recordSeconds % 60).padStart(2, '0')}`
              : '음성'}
          </span>
        </button>

        <button
          onClick={() => handleOpenInput('text')}
          className="relative flex items-center gap-1 px-3 rounded-control bg-muted border border-border text-foreground text-label font-semibold h-9 active:scale-95 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          <Send size={16} className="text-muted-foreground" aria-hidden="true" />
          <span>한줄</span>
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept={MEDIA_ACCEPT}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Draft continuation prompt — only when there IS a draft */}
      {!showInputCard && restoredDraft && restoredDraft.log && (
        <button
          type="button"
          onClick={() => setShowInputCard(true)}
          className="mt-2 w-full text-left text-caption text-muted-foreground min-h-11 flex items-center"
        >
          이어 쓰던 글이 있어요 <span className="ml-auto text-coral-strong font-semibold">이어쓰기 ›</span>
        </button>
      )}

      {/* Input Composer — progressive disclosure: only after a type is chosen */}
      {showInputCard && (
        <div className="mt-3 p-3 rounded-surface bg-card border border-border animate-fade-in space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-caption font-semibold text-muted-foreground">순간 남기기</span>
            <button
              onClick={() => setShowInputCard(false)}
              className="min-h-11 min-w-11 flex items-center justify-center text-caption text-muted-foreground"
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
            onChange={(e) => setLog(e.target.value)}
            aria-label="오늘의 기록"
            placeholder="지금 이 순간, 어떤 생각을 하고 있나요?"
            className="w-full h-20 bg-muted rounded-control p-3 text-body text-foreground outline-none resize-none placeholder:text-muted-foreground"
          />

          {isNative && !hasVoiceAttachment && (
            <p className="flex items-start gap-1.5 text-caption text-muted-foreground leading-tight break-keep">
              <Mic size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{MICROPHONE_RATIONALE}</span>
            </p>
          )}

          {isRecording && (
            <div className="flex items-center gap-2 text-caption font-bold text-destructive bg-destructive/10 border border-destructive/30 rounded-control px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span>
                녹음 중 {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:
                {String(recordSeconds % 60).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={handleStopRecording}
                className="ml-auto px-2 py-1 rounded-control bg-destructive text-destructive-foreground font-bold"
              >
                녹음 종료
              </button>
            </div>
          )}

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
                      className="flex items-center gap-1.5 max-w-full px-2 py-1 rounded-control bg-muted border border-border text-caption font-semibold text-foreground"
                    >
                      {kind === 'photo' && <ImageIcon size={13} className="text-coral shrink-0" />}
                      {kind === 'video' && <Film size={13} className="text-info shrink-0" />}
                      {kind === 'voice' && <Music size={13} className="text-coral shrink-0" />}
                      <span className="truncate max-w-[130px]">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(index)}
                        aria-label={`${file.name} 첨부 제거`}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X size={13} />
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

          {/* Opt-out review: included by default, ✕ to remove, ▲▼ to correct. */}
          <EmotionChipEditor
            candidates={review.candidates}
            removed={review.removed}
            onRemove={review.remove}
            onRestore={review.restore}
            onChangeEmotion={review.changeEmotion}
            visibilityNote={
              isPrivate
                ? '🔒 나만 보기 기록이라 이 마음도 나만 볼 수 있어요.'
                : `이 마음은 ${partnerName}에게도 함께 보여요.`
            }
            className="animate-fade-in"
          />

          {/* Preview of the flow that is about to be saved. Derived only, never
              persisted, and computed from the same array as the save payload. */}
          <EmotionFlowInsightCard items={userConfirmedFlow} variant="composer" />

          <div className="pt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => setIsPrivate(!isPrivate)}
              className={`min-h-11 px-3 rounded-control text-label font-semibold flex items-center gap-1 ${
                isPrivate ? 'bg-warning-surface text-warning-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
              {isPrivate ? '나만 보기' : '공유하기'}
            </button>

            {!isPrivate && (
              <label className="min-h-11 px-3 rounded-control bg-coral/10 text-coral-strong text-label font-semibold flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={talkAbout} onChange={(event) => setTalkAbout(event.target.checked)} className="accent-coral" />
                통화 때 꼭 얘기
              </label>
            )}

            <button
              onClick={handlePost}
              disabled={isSaving || (!isRecording && !hasContentToSave)}
              className="min-h-11 px-4 rounded-control bg-coral-strong text-coral-strong-foreground font-bold text-label active:scale-95 transition disabled:opacity-50"
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
            아직 남겨진 기록이 없어요. 소중한 순간을 남겨보세요.
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
                            {i > 0 && ' → '}{f.displayLabel}
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
