import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { Camera, Image as ImageIcon, Mic, Send, Lock, Unlock, Film, MoreHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { toLocalDateString, localToday } from '@/lib/utils';
import { MAX_MEDIA_BYTES, attachmentTypeFromFile, isSupportedMedia } from '@/lib/records';
import { MAX_ATTACHMENTS_PER_RECORD, type AddRecordResult } from '@/lib/recordPipeline';
import type { ReactionType, Attachment } from '@/types';

interface PendingMedia {
  id: string;
  file: File;
  previewUrl: string;
  type: Attachment['type'];
}

const MAX_ATTACHMENTS = MAX_ATTACHMENTS_PER_RECORD;

const REACTIONS: { key: ReactionType; label: string; emoji: string }[] = [
  { key: 'good', label: '좋았어', emoji: '😊' },
  { key: 'event', label: '이런 일이 있었어', emoji: '💬' },
  { key: 'hard', label: '힘들었어', emoji: '🥹' },
  { key: 'thought_of_you', label: '네 생각났어', emoji: '💌' },
];

export function GomshinHome() {
  const navigate = useNavigate();
  const { state, addRecord } = useStore();
  const { myName } = state.profile;
  const partnerName = state.profile.couple.partnerName || '상대방';

  const todayStr = toLocalDateString(localToday());

  // Input states
  const [log, setLog] = useState('');
  const [reaction, setReaction] = useState<ReactionType | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [showInputCard, setShowInputCard] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => {
      pendingMedia.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter today's records by gomshin
  const todayRecords = state.records
    .filter((r) => r.date === todayStr && r.authorRole === state.profile.role)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());

  const openFilePicker = (type: 'photo' | 'video' | 'voice') => {
    if (fileInputRef.current) {
      fileInputRef.current.accept =
        type === 'photo' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*';
      fileInputRef.current.click();
    }
  };

  const handleOpenInput = (type: 'text' | 'photo' | 'voice' | 'video') => {
    setShowInputCard(true);
    if (type !== 'text') {
      setTimeout(() => openFilePicker(type), 50);
    }
  };

  const handleAddAttachment = (type: 'photo' | 'video' | 'voice') => openFilePicker(type);

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
        toast.error(`${file.name}은 지원하지 않는 형식이에요.`);
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

  // 같은 tick 연속 클릭으로 중복 저장되지 않도록 동기 ref로 잠급니다.
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
      toast.error('내용, 사진, 음성, 또는 리액션을 선택해주세요.');
      return;
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
        },
        pendingMedia.map((m) => m.file),
      );
    } finally {
      setIsSaving(false);
    }

    if (!result.ok && result.reason === 'invalid_media') {
      const first = result.rejectedFiles[0];
      toast.error(
        first?.reason === 'too_large'
          ? `${first.name}은 25MB를 넘어 첨부할 수 없어요.`
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

    if (!result.attachmentsPersisted && result.failedFiles.length > 0) {
      const failed = new Set(result.failedFiles);
      setPendingMedia((prev) => {
        prev.filter((m) => !failed.has(m.file.name)).forEach((m) => URL.revokeObjectURL(m.previewUrl));
        return prev.filter((m) => failed.has(m.file.name));
      });
      setLog('');
      setReaction(undefined);
      toast.error(
        `기록은 저장했지만 첨부 ${result.failedFiles.length}개를 올리지 못했어요. 파일은 그대로 남겨두었어요 — '기록 남기기'를 다시 누르면 새 기록으로 올라갑니다.`,
      );
      return;
    }

    // Reset input
    pendingMedia.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    setLog('');
    setReaction(undefined);
    setPendingMedia([]);
    setIsPrivate(false);
    setShowInputCard(false);
    toast.success(isPrivate ? '나에게만 남겼어요 🔒' : `${partnerName}에게 전해졌어요! 💕`);
  };

  const headerGreeting = partnerName ? `안녕, ${partnerName} ♡` : '안녕, 우리 ♡';

  return (
    <div className="pb-24">
      {/* Header */}
      <header className="px-5 pt-8 pb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {headerGreeting}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {partnerName}에게 전할 오늘 하루를 자유롭게 남겨보세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-xl text-muted-foreground hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95 transition"
            aria-label="설정"
          >
            <MoreHorizontal size={20} />
          </button>
          <button
            onClick={() => navigate('/us')}
            className="rounded-full focus:outline-none focus:ring-2 focus:ring-coral/40 active:scale-95 transition"
            aria-label="우리 정보 보기"
          >
            <CoupleAvatar size={52} />
          </button>
        </div>
      </header>

      {/* Main Top Action Buttons (3 CTAs) */}
      <div className="mx-5 grid grid-cols-3 gap-2 mt-2">
        <button
          onClick={() => handleOpenInput('photo')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-coral/15 border border-coral/30 text-coral font-bold text-sm active:scale-95 transition min-h-[56px]"
        >
          <Camera size={22} className="mb-1" />
          <span>지금 찍기</span>
        </button>

        <button
          onClick={() => handleOpenInput('photo')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-sm active:scale-95 transition min-h-[56px]"
        >
          <ImageIcon size={22} className="mb-1 text-muted-foreground" />
          <span>사진 올리기</span>
        </button>

        <button
          onClick={() => handleOpenInput('text')}
          className="flex flex-col items-center justify-center py-4 px-2 rounded-2xl bg-muted/60 border border-border text-foreground font-semibold text-sm active:scale-95 transition min-h-[56px]"
        >
          <Send size={22} className="mb-1 text-muted-foreground" />
          <span>한 줄 남기기</span>
        </button>
      </div>

      <input type="file" ref={fileInputRef} multiple className="hidden" onChange={handleFileSelect} />

      {/* Interactive Quick Composer Card */}
      {showInputCard && (
        <div className="mx-5 mt-4 p-4 rounded-2xl bg-card border border-border shadow-md animate-in fade-in slide-in-from-top-3">
          <div className="flex items-center justify-between pb-3 border-b border-border/40">
            <span className="text-xs font-bold text-muted-foreground">오늘의 순간 기록하기</span>
            <button
              onClick={() => setShowInputCard(false)}
              className="text-xs text-muted-foreground px-2.5 py-1.5 hover:bg-muted rounded-lg min-h-[36px] flex items-center justify-center active:scale-95 transition"
            >
              닫기
            </button>
          </div>

          {/* Attachments preview */}
          {pendingMedia.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {pendingMedia.map((m) => (
                <div
                  key={m.id}
                  className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border bg-muted"
                >
                  {m.type === 'photo' ? (
                    <img src={m.previewUrl} alt={m.file.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground">
                      {m.type === 'video' ? <Film size={16} /> : <Mic size={16} />}
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

          {/* Quick text input */}
          <textarea
            value={log}
            onChange={(e) => setLog(e.target.value)}
            placeholder="어떤 순간인가요? 편하게 남겨보세요."
            className="mt-3 w-full h-20 bg-muted/40 rounded-xl p-3 text-sm outline-none resize-none placeholder:text-muted-foreground/70"
          />

          {/* Media Attach Controls */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1.5">
              <button
                onClick={() => handleAddAttachment('photo')}
                className="p-2 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted text-xs flex items-center gap-1 min-h-[36px]"
              >
                <ImageIcon size={14} /> 사진
              </button>
              <button
                onClick={() => handleAddAttachment('video')}
                className="p-2 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted text-xs flex items-center gap-1 min-h-[36px]"
              >
                <Film size={14} /> 영상
              </button>
              <button
                onClick={() => handleAddAttachment('voice')}
                className="p-2 rounded-lg bg-muted/60 text-muted-foreground hover:bg-muted text-xs flex items-center gap-1 min-h-[36px]"
              >
                <Mic size={14} /> 음성
              </button>
            </div>

            {/* Privacy toggle: Default shared, toggle for Private */}
            <button
              onClick={() => setIsPrivate(!isPrivate)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition min-h-[36px] ${
                isPrivate
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              {isPrivate ? <Lock size={13} /> : <Unlock size={13} />}
              {isPrivate ? '나에게만' : '우리 둘에게 공유'}
            </button>
          </div>

          {/* Optional Reaction Buttons */}
          <div className="mt-4 pt-3 border-t border-border/40">
            <div className="text-[11px] text-muted-foreground mb-2">지금 느낌 (선택)</div>
            <div className="grid grid-cols-2 gap-1.5">
              {REACTIONS.map((r) => {
                const active = reaction === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setReaction(active ? undefined : r.key)}
                    className={`py-2 px-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition min-h-[40px] ${
                      active
                        ? 'bg-coral text-white shadow-sm'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{r.emoji}</span>
                    <span>{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit Button */}
          <button
            onClick={handlePost}
            disabled={isSaving}
            className="mt-4 w-full py-3.5 rounded-xl bg-coral text-white font-bold text-sm shadow-sm active:scale-[0.99] transition min-h-[44px] disabled:opacity-50"
          >
            {isSaving ? '저장 중...' : '기록 남기기'}
          </button>
        </div>
      )}

      {/* Today's Timeline View */}
      <section className="mx-5 mt-6 space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-foreground">오늘 남긴 타임라인</h2>
          <span className="text-xs text-muted-foreground">{todayRecords.length}개의 순간</span>
        </div>

        {todayRecords.length === 0 ? (
          <div className="rounded-2xl bg-card border border-border/60 p-6 text-center text-muted-foreground">
            <p className="text-sm">아직 오늘 남긴 기록이 없어요.</p>
            <p className="text-xs mt-1">상단의 버튼으로 자유롭게 순간을 남겨보세요!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayRecords.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl bg-card border border-border/60 p-4 shadow-sm space-y-2 relative"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{r.time}</span>
                  <div className="flex items-center gap-2">
                    {r.reaction && (
                      <span className="px-2 py-0.5 rounded-full bg-coral/15 text-coral font-medium text-[11px]">
                        {REACTIONS.find((rc) => rc.key === r.reaction)?.label}
                      </span>
                    )}
                    {r.isPrivate ? (
                      <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-medium text-[11px]">
                        <Lock size={11} /> 나에게만
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70 text-[11px]">우리 공유</span>
                    )}
                  </div>
                </div>

                {r.log && <p className="text-sm text-foreground leading-relaxed">{r.log}</p>}

                {/* Attachments preview in timeline */}
                {r.attachments && r.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.attachments.map((att, i) => (
                      <div key={i} className="rounded-xl overflow-hidden bg-muted border border-border">
                        {att.type === 'photo' && att.url ? (
                          <img src={att.url} alt={att.name} className="w-full h-36 object-cover rounded-xl" />
                        ) : (
                          <div className="p-3 text-xs flex items-center gap-2 font-medium">
                            {att.type === 'photo' && <ImageIcon size={16} className="text-coral" />}
                            {att.type === 'video' && <Film size={16} className="text-blue-500" />}
                            {att.type === 'voice' && <Mic size={16} className="text-purple-500" />}
                            <span>{att.name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
