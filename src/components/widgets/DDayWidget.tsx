import React from 'react';
import { useStore } from '@/lib/store';
import { Heart, Clock, Shield } from 'lucide-react';
import { daysBetweenLocal, localToday, toLocalDateString } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export function DDayWidget() {
  const { state } = useStore();
  const navigate = useNavigate();
  const { profile } = state;
  const anniversaryDate = profile.couple.anniversaryDate;
  const todayStr = toLocalDateString(localToday());
  
  const daysConnected = anniversaryDate ? daysBetweenLocal(anniversaryDate, todayStr) + 1 : 0;
  
  // Milestone calculation
  const nextMilestoneDays = Math.ceil((daysConnected + 1) / 100) * 100;
  const daysToNextMilestone = nextMilestoneDays - daysConnected;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">우리의 디데이</h2>
      </div>

      {/* Connection Days Card */}
      <div 
        className="bg-gradient-to-br from-lilac to-coral/20 p-5 rounded-2xl border border-border relative overflow-hidden flex flex-col justify-center cursor-pointer"
        onClick={() => {
          if (!anniversaryDate) navigate('/my');
        }}
      >
        <Heart className="w-24 h-24 text-white/40 absolute -right-4 -bottom-4 rotate-12" />
        <p className="text-foreground font-medium mb-1 text-xs">우리가 함께한 지</p>
        <div className="text-3xl font-black text-coral tracking-tight mb-1">
          {anniversaryDate ? `연결 ${daysConnected}일째` : '기념일 미설정'}
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          {anniversaryDate ? `${anniversaryDate}부터 시작된 우리 로그` : '여기를 눌러 사귄 날짜를 추가해보세요'}
        </p>
        {anniversaryDate && (
          <div className="pt-3 border-t border-border/60 text-[11px] text-foreground flex items-center gap-1.5 font-bold">
            <Clock className="w-3.5 h-3.5 text-coral" />
            <span>다음 기념일 {nextMilestoneDays}일까지 D-{daysToNextMilestone}</span>
          </div>
        )}
      </div>

      {/* Military Service Quick Status */}
      <div 
        onClick={() => navigate('/service')}
        className="bg-muted/60 rounded-2xl border border-border p-4 flex items-center justify-between active:bg-muted transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-navy rounded-full flex items-center justify-center text-white">
            <Shield className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="font-bold text-foreground text-sm">복무 현황 · D-Day</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">전역일과 복무율 확인</div>
          </div>
        </div>
      </div>
    </div>
  );
}
