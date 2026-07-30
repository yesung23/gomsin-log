import React, { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Camera, Image as ImageIcon, Send, Lock, Unlock, Check, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { toLocalDateString, localToday } from '@/lib/utils';
import { recommendEmotionFlow } from '@/lib/emotionRuleEngine';
import type { ReactionType, Attachment, EmotionFlowItem } from '@/types';

export function TodayLogWidget() {
  const { state, addRecord } = useStore();
  const partnerName = state.profile.couple.partnerName || '파트너';
  const todayStr = toLocalDateString(localToday());

  const [log, setLog] = useState('');
  const [reaction, setReaction] = useState<ReactionType | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showInputCard, setShowInputCard] = useState(false);
  const [inputType, setInputType] = useState<'text' | 'photo' | 'instant'>('text');
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

  const handleOpenInput = (type: 'text' | 'photo' | 'instant') => {
    setInputType(type);
    setShowInputCard(true);
    if (type !== 'text') {
      setTimeout(() => {
         if (fileInputRef.current) {
           fileInputRef.current.accept = 'image/*';
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
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (state.isDemoMode || !state.profile.couple.coupleId) {
       const url = URL.createObjectURL(file);
       setAttachments(prev => [...prev, { type: 'photo', name: file.name, url }]);
       toast.success('사진이 추가되었습니다 (데모).');
       return;
    }

    // Secured storage requires a persisted record ID before file upload.
    toast.info('사진 첨부는 안전한 저장 방식으로 준비 중이에요. 지금은 글 기록을 이용해 주세요.');
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const handlePost = async () => {
    if (isSaving) return;
    if (!log.trim() && attachments.length === 0 && !reaction) {
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
    let saved = false;
    try {
      saved = await addRecord({
        date: todayStr,
        time: timeStr,
        authorRole: state.profile.role,
        log,
        reaction,
        attachments: attachments.length > 0 ? attachments : undefined,
        isPrivate,
        emotionFlow: userConfirmedFlow,
        emotionUpdatedAt: userConfirmedFlow.length > 0 ? now.toISOString() : null,
      });
    } finally {
      setIsSaving(false);
    }

    if (!saved) {
      toast.error('기록을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      return;
    }

    setLog('');
    setReaction(undefined);
    setAttachments([]);
    setConfirmedItemIds([]);
    setIsPrivate(false);
    setShowInputCard(false);
    toast.success(isPrivate ? '나에게만 남겼어요 🔒' : `${partnerName}에게 전해졌어요! 💕`);
  };

  // Filter today's records
  const todayRecords = state.records
    .filter((r) => r.date === todayStr)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
    
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

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />

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

          {attachments.length > 0 && (
            <div className="text-xs text-coral font-bold">
              📷 {attachments.length}개의 사진 첨부됨
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
