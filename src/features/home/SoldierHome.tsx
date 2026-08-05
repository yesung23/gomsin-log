import React, { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/store';
import { CoupleAvatar } from '@/components/CoupleAvatar';
import { Sparkles, MessageCircle, Clock, Image as ImageIcon, Mic, Film, ChevronRight, MoreHorizontal } from 'lucide-react';
import { toLocalDateString, localToday } from '@/lib/utils';
import { generateDailySummary, generateEmotionFlowBriefing } from '@/lib/briefing';
import { computeEnergy, selectPartnerSharedToday } from '@/lib/insights';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';

export function SoldierHome() {
  const navigate = useNavigate();
  const { state, setHighlightedRecordId } = useStore();
  const partnerName = state.profile.couple.partnerName || '상대방';
  const connected = state.profile.couple.connected;
  const todayStr = toLocalDateString(localToday());
  const headerGreeting = partnerName ? `안녕, ${partnerName} ♡` : '안녕, 우리 ♡';

  // Filter partner's shared records for today in chronological order
  const partnerSharedRecords = useMemo(
    () => selectPartnerSharedToday(state.records, state.profile.role, todayStr),
    [state.records, todayStr, state.profile.role],
  );

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

  // Generate emotion flow briefing
  const emotionFlowBriefing = useMemo(() => {
    return generateEmotionFlowBriefing(partnerSharedRecords);
  }, [partnerSharedRecords]);

  // 공유된 기록에서 계산한 에너지 (고정값 없음)
  const energy = useMemo(() => computeEnergy(partnerSharedRecords), [partnerSharedRecords]);

  // 리액션 기반 배려 힌트
  const careHint = useMemo(() => {
    if (partnerSharedRecords.some((r) => r.reaction === 'hard')) {
      return {
        title: '오늘은 해결책보다\n공감을 먼저 원해요',
        detail: `${partnerName}이는 지금, 마음을 알아주는 말이 필요해요.`,
      };
    }
    if (partnerSharedRecords.some((r) => r.reaction === 'thought_of_you')) {
      return {
        title: '보고 싶다는 마음을\n남겨두었어요',
        detail: '반갑게 먼저 인사를 건네보세요.',
      };
    }
    if (partnerSharedRecords.some((r) => r.reaction === 'good')) {
      return {
        title: '기분 좋은 일을\n나누고 싶어 해요',
        detail: '어떤 일이었는지 물어봐 주세요.',
      };
    }
    if (partnerSharedRecords.length > 0) {
      return {
        title: '오늘의 소소한 일상을\n들려주고 싶어 해요',
        detail: '타임라인을 먼저 보고 이야기를 시작해보세요.',
      };
    }
    return {
      title: '아직 오늘 공유된\n기록이 없어요',
      detail: '통화할 때 따뜻한 첫인사를 건네주세요.',
    };
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
      <header className="px-5 pt-8 pb-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {headerGreeting}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasSharedRecords
              ? `${partnerName}이가 오늘 남긴 ${partnerSharedRecords.length}개의 순간이 있어요.`
              : `아직 ${partnerName}이가 오늘 공유한 기록이 없어요.`}
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

      {/* Main Card: 오늘 통화 전, 이것만 알아두세요 */}
      <div className="mx-5 space-y-4">
        <section className="rounded-3xl bg-card border border-border/80 p-5 shadow-sm space-y-4">
          <div className="text-[11px] font-bold text-coral bg-coral/10 px-2.5 py-1 rounded-md inline-block">
            {partnerName}의 오늘 ♡
          </div>
          <h2 className="text-xl font-extrabold text-foreground tracking-tight leading-tight">
            오늘 통화 전,<br />이것만 알아두세요
          </h2>

          {/* 1. 곰신의 에너지 (Energy Gauge) - 공유된 기록 수/리액션에서 계산 */}
          <div className="space-y-1.5 bg-muted/30 p-3.5 rounded-2xl border border-border/40">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-foreground">{partnerName}의 에너지</span>
              <span className="text-coral font-extrabold text-sm">
                {energy.hasData ? `${energy.level}%` : '–'}
              </span>
            </div>
            <div className="w-full h-3.5 bg-muted rounded-full overflow-hidden p-0.5 border border-border/40">
              <div
                className="h-full bg-gradient-to-r from-coral to-pink-400 rounded-full transition-all duration-500"
                style={{ width: `${energy.level}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground pt-0.5">{energy.label}</p>
          </div>

          {/* 2. 오늘의 한 줄 요약 */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles size={14} className="text-coral" />
              <span>오늘의 한 줄 요약</span>
            </div>
            {summary.items.length > 0 ? (
              <div className="space-y-1.5">
                {summary.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSummaryItemClick(item.recordIds[0])}
                    className="w-full text-left p-2.5 rounded-xl bg-muted/40 hover:bg-muted/70 transition flex items-center justify-between text-xs font-medium text-foreground group active:scale-[0.99]"
                  >
                    <span className="leading-relaxed flex-1 pr-2">• {item.text}</span>
                    <ChevronRight size={14} className="text-muted-foreground group-hover:text-coral shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-xl leading-relaxed">
                {hasSharedRecords
                  ? '공유된 기록이 한 개뿐이라 요약 대신 원문을 그대로 보여드려요. 아래 타임라인을 확인해 주세요.'
                  : `${partnerName}이가 오늘 공유한 기록이 아직 없어요. 연락 시간 전에 다시 확인해 보세요.`}
              </p>
            )}
          </div>

          {/* 3. 오늘의 배려 힌트 Card */}
          <div className="rounded-2xl bg-lilac/30 border border-lilac/50 p-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-navy">
              <span className="text-[11px] text-navy/70">오늘의 배려 힌트</span>
              <span className="text-[16px]">👥</span>
            </div>
            <h3 className="text-base font-extrabold text-navy leading-snug whitespace-pre-line">
              {careHint.title}
            </h3>
            <p className="text-xs text-navy/70 leading-relaxed pt-0.5">{careHint.detail}</p>
          </div>

          {/* 4. 통화 첫마디 보기 CTA Button */}
          {summary.opener ? (
            <button
              onClick={() => handleSummaryItemClick(summary.opener?.recordIds[0])}
              className="w-full py-3.5 rounded-2xl bg-coral text-white font-bold text-sm shadow-md active:scale-[0.99] transition flex items-center justify-center gap-2"
            >
              <MessageCircle size={18} />
              <span>통화 첫마디 보기 💬</span>
            </button>
          ) : (
            <button
              onClick={() => {
                const el = document.getElementById('partner-timeline');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full py-3.5 rounded-2xl bg-coral text-white font-bold text-sm shadow-md active:scale-[0.99] transition flex items-center justify-center gap-2"
            >
              <MessageCircle size={18} />
              <span>통화 첫마디 보기 💬</span>
            </button>
          )}
        </section>

        {/* Emotion Flow Card if exists */}
        {emotionFlowBriefing && (
          <section 
            onClick={() => handleSummaryItemClick(emotionFlowBriefing.recordId)}
            className="rounded-2xl bg-coral/10 border border-coral/30 p-4 shadow-sm space-y-2 cursor-pointer active:scale-[0.99] transition"
          >
            <div className="flex items-center justify-between text-xs font-bold text-navy mb-1">
              <div className="flex items-center gap-1.5">
                <Heart size={14} className="text-coral fill-coral" />
                <span>오늘의 마음 흐름</span>
              </div>
              <span className="text-[10px] text-coral font-medium">눌러서 원문 보기</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {emotionFlowBriefing.labels.map((label, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-coral font-bold text-xs">→</span>}
                  <span className="px-2.5 py-1 rounded-xl bg-white text-coral font-bold text-xs border border-coral/20 shadow-xs">
                    {label}
                  </span>
                </React.Fragment>
              ))}
            </div>

            <p className="text-xs text-navy/80 pt-1 font-medium leading-relaxed">
              {emotionFlowBriefing.flowText}
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
              <p className="text-sm font-semibold">오늘의 기록을 남겨줘서 고마워요.</p>
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
