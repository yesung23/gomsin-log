import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/useStore';
import {
  Camera, Image as ImageIcon, Send, Lock, Unlock, Check, Heart,
  Mic, Square, X, Film, Music,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { toLocalDateString, localToday } from '@/lib/utils';
import { recommendEmotionFlow } from '@/lib/emotionRuleEngine';
import { classifyMediaFile, MEDIA_ACCEPT } from '@/lib/records';
import { EmotionFlowInsightCard } from '@/components/EmotionFlowInsightCard';
import type { ReactionType, EmotionFlowItem } from '@/types';

export function TodayLogWidget() {
  const { state, addRecordWithMedia } = useStore();
  const partnerName = state.profile.couple.partnerName || '파트너';
  const todayStr = toLocalDateString(localToday());

  const [log, setLog] = useState('');
  const [reaction, setReaction] = useState<ReactionType | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  /** Files chosen but not yet uploaded; upload happens on save. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showInputCard, setShowInputCard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isOffline = !useOnlineStatus();
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  // State for rule-suggested confirmed IDs
  const [confirmedItemIds, setConfirmedItemIds] = useState<string[]>([]);

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

  // Compute rule-based emotion suggestions dynamically from debounced log text
  const suggestions = useMemo(() => {
    return recommendEmotionFlow(debouncedLog, undefined, { isPrivate });
  }, [debouncedLog, isPrivate]);

  // The exact array that will be persisted. The preview card below reads this
  // same value, so what the user sees can never disagree with what is saved.
  //
  // The rule engine marks sensitive emotion groups as `author_only` by default.
  // That default only applies to *suggestions*: tapping a chip on a record the
  // author is sharing is explicit consent to share that tag. On a private
  // record everything stays author-only. This keeps author-only items out of
  // shared rows (see lib/privacy.ts) without silently discarding a selection.
  const userConfirmedFlow: EmotionFlowItem[] = useMemo(
    () =>
      suggestions
        .filter((s) => confirmedItemIds.includes(s.id || ''))
        .map((s, idx) => {
          // Defense-in-depth: never let matchedText leave the composer, even if
          // downstream storage stripping were bypassed.
          const { matchedText: _discard, ...safeFields } = s;
          return {
            ...safeFields,
            sequence: idx + 1,
            source: 'user_confirmed' as const,
            visibility: isPrivate ? ('author_only' as const) : ('shared' as const),
          };
        }),
    [suggestions, confirmedItemIds, isPrivate],
  );

  const MAX_ATTACHMENTS = 4;

  const handleOpenInput = (type: 'text' | 'photo' | 'instant') => {
    setShowInputCard(true);
    if (type === 'text') return;

    setTimeout(() => {
      const input = fileInputRef.current;
      if (!input) return;
      // 'instant' opens the camera directly; 'photo' opens the gallery and also
      // allows videos.
      input.accept = type === 'instant' ? 'image/*,video/*' : MEDIA_ACCEPT;
      if (type === 'instant') input.setAttribute('capture', 'environment');
      else input.removeAttribute('capture');
      input.click();
    }, 50);
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
      toast.error('이 기기에서는 음성 녹음을 지원하지 않아요.');
      return;
    }

    const mimeType = pickAudioMimeType();
    if (!mimeType) {
      toast.error('이 브라우저에서는 음성 녹음을 지원하지 않아요.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      console.error('[gomsinlog] Microphone permission denied:', error);
      toast.error('마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.');
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

  const toggleConfirmSuggestion = (itemId: string) => {
    if (confirmedItemIds.includes(itemId)) {
      setConfirmedItemIds(prev => prev.filter(id => id !== itemId));
    } else {
      if (confirmedItemIds.length >= 3) {
        toast.info('오늘의 마음은 세 가지까지 남길 수 있어요.');
        return;
      }
      setConfirmedItemIds(prev => [...prev, itemId]);
    }
  };

  const handlePost = async () => {
    if (isSaving) return;
    // Read-only while offline: firing this write would fail and then be explained
    // with a message that could not name the real cause.
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
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

    setIsSaving(true);
    let result: { ok: boolean; failedFiles: string[]; error?: string };
    try {
      result = await addRecordWithMedia(
        {
          date: todayStr,
          time: timeStr,
          authorRole: state.profile.role,
          log,
          reaction,
          isPrivate,
          emotionFlow: userConfirmedFlow,
          emotionUpdatedAt: userConfirmedFlow.length > 0 ? now.toISOString() : null,
        },
        pendingFiles,
      );
    } finally {
      setIsSaving(false);
    }

    if (!result.ok) {
      // No fallback copy: the store now ALWAYS supplies a cause-specific message
      // (see serverErrors.ts). The old fallback blamed the internet connection for
      // permission and membership failures, which sent users into an endless retry
      // loop instead of telling them what to fix.
      toast.error(result.error || '기록을 저장하지 못했어요.');
      return;
    }

    setLog('');
    setReaction(undefined);
    setPendingFiles([]);
    setConfirmedItemIds([]);
    setIsPrivate(false);
    setShowInputCard(false);

    if (result.failedFiles.length > 0) {
      // Be explicit: the text was saved, the files were not.
      toast.warning(
        `기록은 저장했지만 첨부 ${result.failedFiles.length}개를 올리지 못했어요. 잠시 후 다시 첨부해 주세요.`,
      );
      return;
    }
    toast.success(isPrivate ? '나에게만 남겼어요 🔒' : `${partnerName}에게 전해졌어요! 💕`);
  };

  // Filter today's records
  const todayRecords = state.records
    .filter((r) => r.date === todayStr)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
    
  return (
    <div className="flex flex-col">
      <h2 className="text-lg font-bold text-foreground mb-4">오늘의 기록</h2>
      
      {/* Main actions: 지금찍기, 사진·영상, 음성, 한줄남기기 */}
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => handleOpenInput('instant')}
          className="flex flex-col items-center justify-center py-4 px-1 rounded-2xl bg-coral/15 border border-coral/30 text-coral font-bold text-xs active:scale-95 transition min-h-[60px]"
        >
          <Camera size={20} className="mb-1" />
          <span>지금찍기</span>
        </button>

        <button
          onClick={() => handleOpenInput('photo')}
          className="flex flex-col items-center justify-center py-4 px-1 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-xs active:scale-95 transition min-h-[60px]"
        >
          <ImageIcon size={20} className="mb-1 text-muted-foreground" />
          <span>사진·영상</span>
        </button>

        <button
          onClick={isRecording ? handleStopRecording : handleStartRecording}
          aria-pressed={isRecording}
          className={`flex flex-col items-center justify-center py-4 px-1 rounded-2xl border font-semibold text-xs active:scale-95 transition min-h-[60px] ${
            isRecording
              ? 'bg-destructive/15 border-destructive/40 text-destructive'
              : 'bg-muted/60 border-border text-foreground'
          }`}
        >
          {isRecording ? <Square size={20} className="mb-1" /> : <Mic size={20} className="mb-1 text-muted-foreground" />}
          <span>
            {isRecording
              ? `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(recordSeconds % 60).padStart(2, '0')}`
              : '음성'}
          </span>
        </button>

        <button
          onClick={() => handleOpenInput('text')}
          className="flex flex-col items-center justify-center py-4 px-1 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-xs active:scale-95 transition min-h-[60px]"
        >
          <Send size={20} className="mb-1 text-muted-foreground" />
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

      {/* Input Composer */}
      {showInputCard && (
        <div className="mt-4 p-4 rounded-2xl bg-card border border-border shadow-sm animate-fade-in space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
              <Heart size={14} className="text-coral fill-coral" /> 순간 남기기
            </span>
            <button
              onClick={() => setShowInputCard(false)}
              className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-md"
            >
              닫기
            </button>
          </div>
          
          <textarea
            value={log}
            onChange={(e) => setLog(e.target.value)}
            placeholder="지금 이 순간, 어떤 생각을 하고 있나요?"
            className="w-full h-24 bg-muted rounded-xl p-3 text-sm text-foreground outline-none resize-none placeholder:text-muted-foreground"
          />

          {isRecording && (
            <div className="flex items-center gap-2 text-xs font-bold text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span>
                녹음 중 {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:
                {String(recordSeconds % 60).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={handleStopRecording}
                className="ml-auto px-2 py-1 rounded-lg bg-destructive text-destructive-foreground font-bold"
              >
                녹음 종료
              </button>
            </div>
          )}

          {pendingFiles.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-muted-foreground">
                첨부 {pendingFiles.length}개 (저장할 때 업로드돼요)
              </span>
              <div className="flex flex-wrap gap-2">
                {pendingFiles.map((file, index) => {
                  const classified = classifyMediaFile(file);
                  const kind = 'error' in classified ? 'photo' : classified.type;
                  return (
                    <span
                      key={`${file.name}-${index}`}
                      className="flex items-center gap-1.5 max-w-full px-2.5 py-1.5 rounded-xl bg-muted border border-border text-[11px] font-semibold text-foreground"
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
            </div>
          )}

          {/* Rule-Based Emotion Flow Suggestion Card (Appears when text >= 10 chars) */}
          {suggestions.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-coral/5 border border-coral/20 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-foreground flex items-center gap-1">
                  <Heart size={13} className="text-coral fill-coral" /> 기록 속 마음을 골라볼까요?
                </h4>
              </div>
              <p className="text-[11px] text-muted-foreground leading-tight">
                글의 흐름에 맞춰 제안했어요. 원하지 않으면 누르지 않아도 괜찮아요.
              </p>
              {/* Be explicit about who will be able to see the chosen tags. */}
              <p className="text-[11px] font-semibold leading-tight text-muted-foreground">
                {isPrivate
                  ? '🔒 나만 보기 기록이라 선택한 마음도 나만 볼 수 있어요.'
                  : `선택한 마음은 ${partnerName}에게도 함께 보여요.`}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestions.map((item) => {
                  const itemId = item.id || `item-${item.sequence}`;
                  const isSelected = confirmedItemIds.includes(itemId);
                  return (
                    <button
                      key={itemId}
                      type="button"
                      onClick={() => toggleConfirmSuggestion(itemId)}
                      aria-pressed={isSelected}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95 ${
                        isSelected
                          ? 'bg-coral text-white border border-coral shadow-sm'
                          : 'bg-card text-foreground border border-border hover:border-coral/40'
                      }`}
                    >
                      <span>{item.sequence}. {item.displayLabel}</span>
                      {isSelected && <Check size={14} aria-hidden="true" />}
                      <span className="sr-only">{isSelected ? '선택됨' : '선택 안 됨'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview of the flow that is about to be saved. Derived only, never
              persisted, and computed from the same array as the save payload. */}
          <EmotionFlowInsightCard items={userConfirmedFlow} variant="composer" />

          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={() => setIsPrivate(!isPrivate)}
              // 44px minimum: measured at 32px in a real browser, which is below
              // the tap-target floor for the control that decides whether a record
              // is shared with the partner.
              className={`min-h-[44px] px-3 rounded-lg text-xs font-bold flex items-center gap-1 ${
                isPrivate ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
              }`}
            >
              {isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
              {isPrivate ? '나만 보기' : '공유하기'}
            </button>

            <button
              onClick={handlePost}
              disabled={isSaving || isOffline}
              // 44px minimum: measured at 32px in a real browser. This is the
              // primary save action of the whole app.
              className="min-h-[44px] px-4 rounded-lg bg-coral text-white font-bold text-sm shadow-sm active:scale-95 transition disabled:opacity-50"
            >
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* Timeline Preview */}
      <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center justify-between">
          <span>오늘의 타임라인</span>
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
            {todayRecords.length}
          </span>
        </h3>
        
        {todayRecords.length === 0 ? (
          <div className="text-center py-6 bg-muted/50 rounded-2xl border border-dashed border-border">
            <p className="text-xs text-muted-foreground">아직 남겨진 기록이 없어요. 소중한 순간을 남겨보세요!</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {todayRecords.slice(-3).map(r => {
              // Only show user_confirmed items
              const confirmedFlow = r.emotionFlow?.filter(f => f.source === 'user_confirmed') || [];
              return (
                <div key={r.id} className="bg-muted/60 rounded-xl p-3.5 flex flex-col gap-1.5 border border-border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground">{r.time}</span>
                    {confirmedFlow.length > 0 && (
                      <div className="flex items-center gap-1 text-[11px] font-bold text-coral bg-coral/10 px-2 py-0.5 rounded-full border border-coral/20">
                        {confirmedFlow.map((f, i) => (
                          <span key={f.id || i}>
                            {i > 0 && ' → '}{f.displayLabel}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-foreground">{r.log || (r.attachments ? '📷 사진 기록' : '리액션')}</div>
                </div>
              );
            })}
            {todayRecords.length > 3 && (
              <div className="text-center text-xs text-muted-foreground pt-2">
                ... 외 {todayRecords.length - 3}개의 기록이 더 있습니다.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
