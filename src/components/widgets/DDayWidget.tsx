import React from 'react';
import { useStore } from '@/lib/useStore';
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

  /*
    The card body, rendered inside a <button> only while there is something to
    press.

    It used to be a `<div onClick>` that navigated to /settings when the
    anniversary was unset. Two defects in one element: with no role and no
    tabIndex the only way to set the anniversary from 우리 was a pointer, and once
    the date WAS set the div kept `cursor-pointer` and kept swallowing taps while
    doing nothing at all. So the affordance now exists exactly when the action
    does.
  */
  const connectionCardBody = (
    <>
      <Heart className="w-24 h-24 text-white/40 absolute -right-4 -bottom-4 rotate-12" aria-hidden="true" />
      <p className="text-foreground font-medium mb-1 text-xs">우리가 함께한 지</p>
      <div className="text-3xl font-black text-coral tracking-tight mb-1">
        {anniversaryDate ? `연결 ${daysConnected}일째` : '기념일 미설정'}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {anniversaryDate ? `${anniversaryDate}부터 시작된 우리 로그` : '여기를 눌러 사귄 날짜를 추가해보세요'}
      </p>
      {anniversaryDate && (
        <div className="pt-3 border-t border-border/60 text-[11px] text-foreground flex items-center gap-1.5 font-bold">
          <Clock className="w-3.5 h-3.5 text-coral" aria-hidden="true" />
          <span>다음 기념일 {nextMilestoneDays}일까지 D-{daysToNextMilestone}</span>
        </div>
      )}
    </>
  );

  const connectionCardClass =
    'bg-gradient-to-br from-lilac to-coral/20 p-5 rounded-2xl border border-border relative overflow-hidden flex flex-col justify-center';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">우리의 디데이</h2>
      </div>

      {/* Connection Days Card */}
      {anniversaryDate ? (
        <div className={connectionCardClass}>{connectionCardBody}</div>
      ) : (
        <button
          type="button"
          // The anniversary is edited from the profile section in settings.
          onClick={() => navigate('/settings')}
          aria-label="사귄 날짜 설정하기"
          className={`${connectionCardClass} w-full text-left min-h-[44px] cursor-pointer active:scale-[0.98] transition`}
        >
          {connectionCardBody}
        </button>
      )}

      {/* Military Service Quick Status.
          A real <button>, not a clickable <div>: as a div it was invisible to the
          keyboard and to assistive tech, and it declared no tap target at all. */}
      <button
        type="button"
        onClick={() => navigate('/service')}
        aria-label="복무 현황과 전역 D-Day 보기"
        className="w-full text-left bg-muted/60 rounded-2xl border border-border p-4 min-h-[44px] min-w-[44px] flex items-center justify-between active:bg-muted transition-colors"
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
      </button>
    </div>
  );
}
