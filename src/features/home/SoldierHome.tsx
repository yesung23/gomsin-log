import React, { useMemo, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { Sparkles, MessageCircle, Clock, Image as ImageIcon, Mic, Film, ChevronRight } from 'lucide-react';
import { toLocalDateString, localToday } from '@/lib/utils';
import { generateDailySummary } from '@/lib/briefing';
import { toast } from 'sonner';

export function SoldierHome() {
  const { state, setHighlightedRecordId } = useStore();
  const { myName } = state.profile;
  const partnerName = state.profile.couple.partnerName || '춘향';
  const connected = state.profile.couple.connected;
  const todayStr = toLocalDateString(localToday());

  // Filter partner's shared records for today in chronological order
  const partnerSharedRecords = useMemo(() => {
    return state.records
      .filter((r) => r.date === todayStr && r.authorRole !== state.profile.role && !r.isPrivate)
      .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());
  }, [state.records, todayStr, state.profile.role]);

  const hasSharedRecords = partnerSharedRecords.length > 0;

  // Counts summary stats
  const photoCount = partnerSharedRecords.filter((r) => r.attachments?.some((a) => a.type === 'photo')).length;
  const voiceCount = partnerSharedRecords.filter((r) => r.attachments?.some((a) => a.type === 'voice')).length;
  const textCount = partnerSharedRecords.filter((r) => r.log && r.log.trim()).length;
  const lastRecordTime = hasSharedRecords ? partnerSharedRecords[partnerSharedRecords.length - 1].time : undefined;

  // Generate structured automatic summary
  const summary = useMemo(() => {
    return generateDailySummary(partnerSharedRecords, partnerName);
  }, [partnerSharedRecords, partnerName]);

  // Handle clicking a summary sentence/item -> Scroll to source record & highlight it
  const handleSummaryItemClick = (recordId?: string) => {
    if (!recordId) return;

    setHighlightedRecordId(recordId);

    const el = document.getElementById(`record-${recordId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast.info('해당 순간으로 이동합니다.');
    } else {
      toast('기록 위치를 찾을 수 없습니다.');
    }
  };

  // Auto clear highlight after 2 seconds
  useEffect(() => {
    if (state.highlightedRecordId) {
      const timer = setTimeout(() => {
        setHighlightedRecordId(undefined);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.highlightedRecordId, setHighlightedRecordId]);

  if (!connected) {
    return (
      <div className="px-5 pt-16 pb-6 flex flex-col items-center text-center">
        <CoupleAvatar size={96} />
        <h1 className="mt-6 text-xl font-bold">{partnerName}을 초대하면,</h1>
        <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
          답장이 늦는 연락 시간 전에도<br />
          서로의 하루를 더 편하게 볼 수 있어요.
        </p>
        <button className="mt-6 w-full h-12 rounded-2xl bg-coral text-white font-semibold text-sm min-h-[48px]">
          초대 코드 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <header className="px-5 pt-10 pb-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            안녕, {myName}아 <span className="text-coral">♡</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasSharedRecords
              ? `${partnerName}이가 오늘 남긴 ${partnerSharedRecords.length}개의 순간이 있어요.`
              : `아직 ${partnerName}이가 오늘 공유한 기록이 없어요.`}
          </p>
        </div>
        <CoupleAvatar size={64} />
      </header>

      {/* Log Stats Badge (NO "브리핑 수신 18:00") */}
      <div className="mx-5 mb-3 flex items-center justify-between text-[11px] text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-xl border border-border/40">
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-coral" />
          <span className="font-semibold text-foreground">오늘의 로그</span>
          {lastRecordTime && <span>· 마지막 기록 {lastRecordTime}</span>}
        </div>
        {hasSharedRecords && (
          <span className="font-medium">
            {[
              photoCount > 0 ? `사진 ${photoCount}장` : '',
              textCount > 0 ? `한 줄 ${textCount}개` : '',
              voiceCount > 0 ? `음성 ${voiceCount}개` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      <div className="mx-5 space-y-4">
        {/* 1. 오늘의 빠른 정리 (Auxiliary Automatic Summary Card) */}
        {summary.items.length > 0 && (
          <section className="rounded-2xl bg-lilac/40 border border-lilac/60 p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-navy mb-1">
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-coral" />
                <span>오늘의 빠른 정리</span>
              </div>
              <span className="text-[10px] text-navy/60 font-normal">문장을 누르면 원문으로 이동</span>
            </div>
            <div className="space-y-1.5">
              {summary.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSummaryItemClick(item.recordIds[0])}
                  className="w-full text-left p-2 rounded-xl bg-white/70 hover:bg-white transition flex items-center justify-between text-xs font-medium text-navy group active:scale-[0.99]"
                >
                  <span className="leading-snug flex-1 pr-2">• {item.text}</span>
                  <ChevronRight size={14} className="text-navy/40 group-hover:text-navy shrink-0" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 2. 통화 첫마디 추천 Card */}
        {summary.opener && (
          <section 
            onClick={() => handleSummaryItemClick(summary.opener?.recordIds[0])}
            className="rounded-2xl bg-mint p-4 border border-mint-foreground/10 cursor-pointer active:scale-[0.99] transition"
          >
            <div className="flex items-center justify-between text-xs font-bold text-navy mb-1">
              <div className="flex items-center gap-1.5">
                <MessageCircle size={14} className="text-navy" />
                <span>통화 첫마디 추천</span>
              </div>
              <span className="text-[10px] text-navy/60 font-normal">눌러서 원문 보기</span>
            </div>
            <p className="text-sm font-semibold text-navy leading-snug mt-1">
              "{summary.opener.text}"
            </p>
          </section>
        )}

        {/* Primary Content: Chronological Timeline */}
        <section id="partner-timeline" className="pt-2 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-foreground">{partnerName}의 오늘 타임라인</h2>
            <span className="text-xs text-muted-foreground">시간순 보기</span>
          </div>

          {!hasSharedRecords ? (
            <div className="rounded-2xl bg-card border border-border/60 p-8 text-center text-muted-foreground">
              <div className="text-3xl mb-2">📬</div>
              <p className="text-sm font-semibold">오늘의 첫 순간을 기다리고 있어요.</p>
              <p className="text-xs mt-1">{partnerName}이가 남긴 하루는 여기에서 시간순으로 볼 수 있어요.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {partnerSharedRecords.map((r) => {
                const isHighlighted = state.highlightedRecordId === r.id;
                return (
                  <div
                    id={`record-${r.id}`}
                    key={r.id}
                    className={`rounded-2xl bg-card border p-4 shadow-sm space-y-2 transition-all duration-500 ${
                      isHighlighted
                        ? 'border-coral ring-4 ring-coral/30 bg-coral/5 scale-[1.02] record-highlighted'
                        : 'border-border/60'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-bold text-foreground">{r.time}</span>
                      {r.reaction && (
                        <span className="px-2.5 py-0.5 rounded-full bg-coral/15 text-coral font-semibold text-[11px]">
                          {r.reaction === 'good' && '😊 좋았어'}
                          {r.reaction === 'event' && '💬 이런 일이 있었어'}
                          {r.reaction === 'hard' && '🥹 힘들었어'}
                          {r.reaction === 'thought_of_you' && '💌 네 생각났어'}
                        </span>
                      )}
                    </div>

                    {/* Log text */}
                    {r.log && <p className="text-sm font-medium text-foreground leading-relaxed">{r.log}</p>}

                    {/* Original Media (Photos, Video, Voice) */}
                    {r.attachments && r.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {r.attachments.map((att, i) => (
                          <div key={i} className="w-full rounded-xl overflow-hidden bg-muted border border-border">
                            {att.type === 'photo' && att.url ? (
                              <img src={att.url} alt={att.name} className="w-full h-48 object-cover rounded-xl" />
                            ) : (
                              <div className="p-3 text-xs flex items-center gap-2 font-semibold">
                                {att.type === 'photo' && <ImageIcon size={18} className="text-coral" />}
                                {att.type === 'video' && <Film size={18} className="text-blue-500" />}
                                {att.type === 'voice' && <Mic size={18} className="text-purple-500" />}
                                <span>{att.name}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
