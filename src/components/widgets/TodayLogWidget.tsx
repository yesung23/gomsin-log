import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Camera, Image as ImageIcon, Send, Lock, Unlock, Check, Heart, X, Film, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { toLocalDateString, localToday } from '@/lib/utils';
import { recommendEmotionFlow } from '@/lib/emotionRuleEngine';
import { MAX_MEDIA_BYTES, attachmentTypeFromFile, isSupportedMedia } from '@/lib/records';
import { MAX_ATTACHMENTS_PER_RECORD, type AddRecordResult } from '@/lib/recordPipeline';
import { selectTodayTimeline } from '@/lib/insights';
import type { ReactionType, EmotionFlowItem, Attachment } from '@/types';

/** 저장 전 화면에 미리 보여줄 첨부 후보 */
interface PendingMedia {
  id: string;
  file: File;
  previewUrl: string;
  type: Attachment['type'];
}

const MAX_ATTACHMENTS = MAX_ATTACHMENTS_PER_RECORD;

export function TodayLogWidget() {
  const { state, addRecord } = useStore();
  const partnerName = state.profile.couple.partnerName || '파트너';
  const todayStr = toLocalDateString(localToday());

  const [log, setLog] = useState('');
  const [reaction, setReaction] = useState<ReactionType | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [showInputCard, setShowInputCard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // State for rule-suggested confirmed IDs
  const [confirmedItemIds, setConfirmedItemIds] = useState<string[]>([]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  // 미리보기용 objectURL 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      pendingMedia.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenInput = (type: 'text' | 'photo' | 'instant') => {
    setShowInputCard(true);
    if (type !== 'text') {
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.accept = type === 'instant' ? 'image/*' : 'image/*,video/*';
          if (type === 'instant') {
            fileInputRef.current.setAttribute('capture', 'environment');
          } else {
            fileInputRef.current.removeAttribute('capture');
          }
          fileInputRef.current.click();
        }
      }, 50);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const accepted: PendingMedia[] = [];
    for (const file of files) {
      if (pendingMedia.length + accepted.length >= MAX_ATTACHMENTS) {
        toast.info(`첨부는 한 기록에 최대 ${MAX_ATTACHMENTS}개까지 가능해요.`);
        break;
      }
      if (!isSupportedMedia(file)) {
        toast.error(`${file.name}은 지원하지 않는 형식이에요. (JPG, PNG, WEBP, MP4 등)`);
        continue;
      }
      if (file.size > MAX_MEDIA_BYTES) {
        toast.error(`${file.name}은 25MB를 초과해서 첨부할 수 없어요.`);
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        type: attachmentTypeFromFile(file),
      });
    }

    if (accepted.length > 0) setPendingMedia((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingMedia = (id: string) => {
    setPendingMedia((prev) => {
      const target = prev.find((m) => m.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((m) => m.id !== id);
    });
  };

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

  // React state(isSaving)는 같은 tick 안의 연속 클릭을 막지 못하므로
  // 서버 변경 게이트는 동기적으로 갱신되는 ref로 잠급니다.
  const isSavingRef = React.useRef(false);

  const handlePost = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      await runPost();
    } finally {
      isSavingRef.current = false;
    }
  };

  const runPost = async () => {
    if (!log.trim() && pendingMedia.length === 0 && !reaction) {
      toast.error('내용, 사진, 또는 리액션을 선택해주세요.');
      return;
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Filter confirmed flow items
    const userConfirmedFlow: EmotionFlowItem[] = suggestions
      .filter((s) => confirmedItemIds.includes(s.id || ''))
      .map((s, idx) => ({
        ...s,
        sequence: idx + 1,
        source: 'user_confirmed',
        visibility: isPrivate ? 'author_only' : s.visibility,
      }));

    setIsSaving(true);
    let result: AddRecordResult;
    try {
      result = await addRecord(
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
        pendingMedia.map((m) => m.file),
      );
    } finally {
      setIsSaving(false);
    }

    // 서버를 건드리기 전에 거부된 파일 → 입력 내용을 그대로 남겨 수정/재시도 가능
    if (!result.ok && result.reason === 'invalid_media') {
      const first = result.rejectedFiles[0];
      toast.error(
        first?.reason === 'too_large'
          ? `${first.name}은 25MB를 넘어 첨부할 수 없어요. 파일을 지우고 다시 시도해 주세요.`
          : first?.reason === 'too_many'
          ? `첨부는 최대 ${MAX_ATTACHMENTS_PER_RECORD}개까지 가능해요.`
          : `${first?.name ?? '선택한 파일'}은 지원하지 않는 형식이에요.`,
      );
      return;
    }

    if (!result.ok) {
      toast.error('기록을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      return;
    }

    // 첨부가 반영되지 않았으면 실패한 파일만 남겨 재시도할 수 있게 합니다.
    if (!result.attachmentsPersisted && result.failedFiles.length > 0) {
      const failed = new Set(result.failedFiles);
      setPendingMedia((prev) => {
        prev.filter((m) => !failed.has(m.file.name)).forEach((m) => URL.revokeObjectURL(m.previewUrl));
        return prev.filter((m) => failed.has(m.file.name));
      });
      setLog('');
      setReaction(undefined);
      setConfirmedItemIds([]);
      // 컴포저를 닫지 않고 열어둔 채로 재시도를 유도합니다.
      toast.error(
        `기록은 저장했지만 첨부 ${result.failedFiles.length}개를 올리지 못했어요. 파일은 그대로 남겨두었어요 — '저장'을 다시 누르면 새 기록으로 올라갑니다.`,
      );
      return;
    }

    pendingMedia.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    setLog('');
    setReaction(undefined);
    setPendingMedia([]);
    setConfirmedItemIds([]);
    setIsPrivate(false);
    setShowInputCard(false);
    toast.success(isPrivate ? '나에게만 남겼어요 🔒' : `${partnerName}에게 전해졌어요! 💕`);
  };

  // 오늘 타임라인: 내 기록 + 상대의 공유 기록만 (상대의 비공개 기록은 절대 노출하지 않음)
  const todayRecords = selectTodayTimeline(state.records, state.profile.role, todayStr);
    
  return (
    <div className="flex flex-col">
      <h2 className="text-lg font-bold text-foreground mb-4">오늘의 기록</h2>
      
      {/* Gomshin 3 Main Actions: 지금찍기, 사진올리기, 한줄남기기 */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => handleOpenInput('instant')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-coral/15 border border-coral/30 text-coral font-bold text-sm active:scale-95 transition min-h-[60px]"
        >
          <Camera size={22} className="mb-1" />
          <span>지금찍기</span>
        </button>

        <button
          onClick={() => handleOpenInput('photo')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-sm active:scale-95 transition min-h-[60px]"
        >
          <ImageIcon size={22} className="mb-1 text-muted-foreground" />
          <span>사진올리기</span>
        </button>

        <button
          onClick={() => handleOpenInput('text')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-sm active:scale-95 transition min-h-[60px]"
        >
          <Send size={22} className="mb-1 text-muted-foreground" />
          <span>한줄남기기</span>
        </button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        multiple
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

          {/* 첨부 미리보기 */}
          {pendingMedia.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pendingMedia.map((m) => (
                <div
                  key={m.id}
                  className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border bg-muted"
                >
                  {m.type === 'photo' ? (
                    <img src={m.previewUrl} alt={m.file.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                      {m.type === 'video' ? <Film size={18} /> : <Mic size={18} />}
                      <span className="text-[9px] px-1 truncate w-full text-center">{m.file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingMedia(m.id)}
                    aria-label={`${m.file.name} 첨부 제거`}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendingMedia.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {isPrivate
                ? '나에게만 보이는 기록으로 저장돼요.'
                : '저장하면 우리 둘만 볼 수 있는 저장소에 업로드돼요.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => handleOpenInput('photo')}
            className="text-[11px] font-bold text-coral flex items-center gap-1"
          >
            <ImageIcon size={13} /> 사진 · 영상 추가
          </button>

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

          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={() => setIsPrivate(!isPrivate)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${
                isPrivate ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
              }`}
            >
              {isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
              {isPrivate ? '나만 보기' : '공유하기'}
            </button>

            <button
              onClick={handlePost}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-coral text-white font-bold text-sm shadow-sm active:scale-95 transition"
            >
              {isSaving
                ? pendingMedia.length > 0
                  ? '업로드 중...'
                  : '저장 중...'
                : '저장'}
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
