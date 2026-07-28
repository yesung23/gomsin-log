import React, { useState } from 'react';
import { MobileShell } from '@/components/MobileShell';
import { useStore } from '@/lib/store';
import { Heart, Camera, MessageSquare, Mic, Calendar as CalendarIcon, Clock } from 'lucide-react';
import { daysBetweenLocal, localToday, toLocalDateString } from '@/lib/utils';
import { toast } from 'sonner';

export function UsPage() {
  const { state } = useStore();
  const { profile } = state;
  const [showBottomSheet, setShowBottomSheet] = useState(false);

  const anniversaryDate = profile.couple.anniversaryDate;
  const partnerName = profile.couple.partnerName || '상대방';
  const todayStr = toLocalDateString(localToday());
  const daysConnected = anniversaryDate ? daysBetweenLocal(anniversaryDate, todayStr) + 1 : 0;
  
  // Milestone calculation
  const nextMilestoneDays = Math.ceil((daysConnected + 1) / 100) * 100;
  const daysToNextMilestone = nextMilestoneDays - daysConnected;

  const handleAction = (label: string) => {
    toast(`${label} 추억 남기기 기능은 MVP에서 텍스트 및 로그로 지원돼요.`);
    setShowBottomSheet(false);
  };

  return (
    <MobileShell>
      <div className="p-4 space-y-6 pb-24">
        <h1 className="text-2xl font-bold px-1 pt-4">{profile.myName} ♡ {partnerName}</h1>

        {/* Connection Days Card */}
        <div className="bg-gradient-to-br from-lilac to-coral/20 p-6 rounded-3xl shadow-sm border border-white relative overflow-hidden text-center">
          <Heart className="w-24 h-24 text-white/40 absolute -right-4 -bottom-4 rotate-12" />
          <p className="text-navy font-medium mb-2 text-sm">우리가 함께한 지</p>
          <div className="text-4xl font-black text-coral tracking-tight mb-2">
            {anniversaryDate ? `연결 ${daysConnected}일째` : '기념일 미설정'}
          </div>
          <p className="text-xs text-muted-foreground">
            {anniversaryDate ? `${anniversaryDate}부터 시작된 우리 로그` : '마이 탭에서 사귄 날짜를 언제든 추가해보세요'}
          </p>
          {anniversaryDate && (
            <div className="mt-4 pt-4 border-t border-white/50 text-xs text-navy flex items-center justify-center gap-2">
              <Clock className="w-4 h-4 text-coral" />
              <span>다음 기념일 {nextMilestoneDays}일까지 <b>D-{daysToNextMilestone}</b></span>
            </div>
          )}
        </div>

        {/* Today's Care */}
        <div className="space-y-3">
          <h2 className="font-bold text-gray-900 px-1 text-sm">오늘의 1:1 연결</h2>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex gap-4">
            <div className="flex-1 bg-muted/40 rounded-xl p-3 text-center">
              <div className="text-xl mb-1">🌸</div>
              <div className="text-xs text-muted-foreground mb-1">{profile.myName}</div>
              <div className="text-xs font-bold">오늘의 순간</div>
            </div>
            <div className="flex items-center justify-center text-coral text-xl font-bold">
              ♡
            </div>
            <div className="flex-1 bg-muted/40 rounded-xl p-3 text-center">
              <div className="text-xl mb-1">🎖️</div>
              <div className="text-xs text-muted-foreground mb-1">{partnerName}</div>
              <div className="text-xs font-bold">오늘의 로그</div>
            </div>
          </div>
        </div>

        {/* Memories Carousel Demo */}
        <div className="space-y-3">
          <h2 className="font-bold text-gray-900 px-1 text-sm">다시 꺼내보고 싶은 순간</h2>
          <div className="flex overflow-x-auto gap-4 pb-2 scrollbar-hide">
            {[
              { title: '처음 함께한 봄', date: '2024.03.21' },
              { title: `${partnerName}의 첫 휴가`, date: '2024.08.07' },
              { title: `${profile.myName}의 생일`, date: '2025.05.12' },
            ].map((m, i) => (
              <div 
                key={i} 
                onClick={() => toast(`${m.title} · 준비 중인 추억 앨범입니다.`)}
                className="min-w-[140px] h-36 bg-gradient-to-br from-lilac/30 to-mint/30 rounded-2xl shrink-0 p-3 flex flex-col justify-between cursor-pointer border border-border/40"
              >
                <div className="text-[11px] text-muted-foreground">{m.date}</div>
                <div className="font-bold text-xs text-navy">{m.title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming */}
        {anniversaryDate && (
          <div className="space-y-3">
            <h2 className="font-bold text-gray-900 px-1 text-sm">곧 함께할 날</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-coral/10 text-coral flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-xs">{nextMilestoneDays}일 기념일</div>
                    <div className="text-[11px] text-gray-400">사귄 지 {nextMilestoneDays}일째 되는 날</div>
                  </div>
                </div>
                <span className="text-coral font-bold text-xs">D-{daysToNextMilestone}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2">
          <button 
            onClick={() => setShowBottomSheet(true)}
            className="w-full bg-coral text-white font-bold py-4 rounded-2xl shadow-sm active:scale-[0.98] transition-transform min-h-[44px] text-sm"
          >
            오늘의 추억 남기기
          </button>
        </div>
      </div>

      {/* Bottom Sheet */}
      {showBottomSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-[430px] rounded-t-3xl p-6 pb-12 animate-in slide-in-from-bottom-10">
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
            <h3 className="text-base font-bold text-gray-900 mb-6 text-center">어떤 추억을 남길까요?</h3>
            <div className="grid grid-cols-4 gap-4">
              <button onClick={() => handleAction('사진')} className="flex flex-col items-center gap-2 group min-h-[44px]">
                <div className="w-14 h-14 rounded-2xl bg-muted/60 group-active:bg-muted flex items-center justify-center text-navy">
                  <Camera className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-gray-600">사진</span>
              </button>
              <button onClick={() => handleAction('편지')} className="flex flex-col items-center gap-2 group min-h-[44px]">
                <div className="w-14 h-14 rounded-2xl bg-muted/60 group-active:bg-muted flex items-center justify-center text-navy">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-gray-600">편지</span>
              </button>
              <button onClick={() => handleAction('음성')} className="flex flex-col items-center gap-2 group min-h-[44px]">
                <div className="w-14 h-14 rounded-2xl bg-muted/60 group-active:bg-muted flex items-center justify-center text-navy">
                  <Mic className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-gray-600">음성</span>
              </button>
              <button onClick={() => handleAction('기억할 날')} className="flex flex-col items-center gap-2 group min-h-[44px]">
                <div className="w-14 h-14 rounded-2xl bg-muted/60 group-active:bg-muted flex items-center justify-center text-navy">
                  <CalendarIcon className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-gray-600">기억할 날</span>
              </button>
            </div>
            <button 
              onClick={() => setShowBottomSheet(false)}
              className="mt-8 w-full py-4 text-gray-500 font-medium active:bg-gray-50 rounded-xl min-h-[44px] text-xs"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
