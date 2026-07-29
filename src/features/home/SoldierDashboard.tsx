import React from 'react';
import { useStore } from '@/lib/store';
import { Phone, Battery, BatteryFull, BatteryMedium, BatteryLow, Sparkles, Heart, ChevronRight, MessageCircleHeart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatLocalDate } from '@/lib/utils';

export function SoldierDashboard() {
  const { state } = useStore();
  const navigate = useNavigate();
  const { profile } = state;

  // Mock data for AI Briefing since we don't have the real AI engine connected yet
  const todayBriefing = {
    energyLevel: 85, // 0-100
    energyLabel: '조금 피곤하지만 기분 좋은 상태',
    summary: '오늘 과제가 많아서 조금 지쳤지만, 저녁에 맛있는 걸 먹고 기분이 좋아졌어요.',
    careHint: '많이 피곤했을 텐데 고생했다고 칭찬과 격려를 해주세요!',
    keywords: ['과제', '피곤', '저녁 메뉴', '행복']
  };

  const getBatteryIcon = (level: number) => {
    if (level >= 80) return <BatteryFull className="w-5 h-5 text-emerald-500" />;
    if (level >= 40) return <BatteryMedium className="w-5 h-5 text-amber-500" />;
    return <BatteryLow className="w-5 h-5 text-rose-500" />;
  };

  return (
    <div className="pb-8">
      {/* Header */}
      <header className="px-5 pt-10 pb-6 flex items-start justify-between sticky top-0 bg-background/90 backdrop-blur-xl z-40">
        <div className="flex flex-col">
          <span className="text-xs font-semibold tracking-wide text-navy mb-1">
            🪖 곰신로그
          </span>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center">
            충성 {profile.myName} 님
          </h1>
        </div>
      </header>

      <div className="px-5 space-y-4 min-h-[500px]">
        {/* 오늘 통화 전 이것만 알아두세요! */}
        <section className="bg-navy text-white rounded-3xl p-5 shadow-sm space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Phone size={80} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span className="text-xs font-bold text-amber-300">오늘 통화 전 이것만 알아두세요!</span>
            </div>
            <h2 className="text-xl font-extrabold leading-tight">
              {profile.couple.partnerName}님의 오늘 하루,<br />
              이렇게 요약해 드릴게요.
            </h2>
          </div>
          
          <div className="flex flex-wrap gap-2 pt-2 relative z-10">
            {todayBriefing.keywords.map(kw => (
              <span key={kw} className="bg-white/20 px-3 py-1.5 rounded-xl text-xs font-bold">
                #{kw}
              </span>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4">
          {/* 곰신의 에너지 */}
          <section className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-3">
            <div className="flex items-center gap-1.5 border-b border-border/40 pb-2">
              <Battery className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-extrabold text-muted-foreground">곰신의 에너지</h3>
            </div>
            <div className="flex flex-col items-center justify-center py-2 space-y-2">
              <div className="relative w-16 h-16 flex items-center justify-center bg-muted/40 rounded-full border-[3px] border-emerald-500">
                <span className="text-xl font-bold text-foreground">{todayBriefing.energyLevel}%</span>
              </div>
              <p className="text-[10px] font-bold text-center text-foreground leading-tight break-keep">
                {todayBriefing.energyLabel}
              </p>
            </div>
          </section>

          {/* 오늘의 배려 힌트 */}
          <section className="bg-card rounded-3xl p-4 shadow-sm border border-border space-y-3">
            <div className="flex items-center gap-1.5 border-b border-border/40 pb-2">
              <Heart className="w-4 h-4 text-coral" />
              <h3 className="text-xs font-extrabold text-muted-foreground">오늘의 배려 힌트</h3>
            </div>
            <div className="flex flex-col justify-center h-full pb-2">
              <p className="text-xs font-bold leading-relaxed text-foreground break-keep">
                "{todayBriefing.careHint}"
              </p>
            </div>
          </section>
        </div>

        {/* 오늘의 한 줄 요약 */}
        <section 
          onClick={() => navigate('/record')}
          className="bg-card rounded-3xl p-5 shadow-sm border border-border space-y-3 active:scale-95 transition cursor-pointer"
        >
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5">
              <MessageCircleHeart className="w-4 h-4 text-navy" />
              <h3 className="text-xs font-extrabold text-muted-foreground">오늘의 한 줄 요약</h3>
            </div>
            <div className="flex items-center text-[10px] font-bold text-navy bg-navy/10 px-2 py-0.5 rounded-full">
              근거로 이동 <ChevronRight className="w-3 h-3" />
            </div>
          </div>
          <p className="text-sm font-semibold leading-relaxed text-foreground break-keep">
            {todayBriefing.summary}
          </p>
        </section>
      </div>
    </div>
  );
}
