import { useStore } from '@/lib/useStore';
import { Clock, Shield } from 'lucide-react';
import { daysBetweenLocal, localToday, toLocalDateString } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

/**
 * Compact D-Day widget — supporting information, never the largest thing.
 *
 * Design v2.1: "D-Day stays as compact supporting information, never the largest
 * thing on the screen." This is a single inline row showing the connection day
 * count and a link to the service detail, not a tall card with a decorative heart.
 */
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
    <div className="flex flex-col gap-3">
      {/* Connection Days — compact inline */}
      {anniversaryDate ? (
        <div data-testid="dday-connection-card" className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-coral-strong shrink-0" aria-hidden="true" />
            <span className="text-label font-semibold text-foreground tabular-nums">
              연결 {daysConnected}일째
            </span>
          </div>
          <span className="text-caption text-muted-foreground tabular-nums">
            다음 기념일 {nextMilestoneDays}일까지 D-{daysToNextMilestone}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/settings')}
          aria-label="사귄 날짜 설정하기"
          data-testid="dday-connection-card"
          className="w-full text-left min-h-11 flex items-center gap-2 py-2 active:bg-muted/40 rounded-control transition"
        >
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          {/*
            `기념일 미설정` is the exact wording UsPage uses for the same fact, and
            both anniversaryProvenance.test.tsx and keyboardOperableCards.test.tsx
            assert this literal. The two surfaces have to agree: M-1 exists because
            one of them used to invent a day count from a fabricated date.
          */}
          <span className="text-label text-muted-foreground">
            기념일 미설정
          </span>
          <span className="ml-auto text-caption text-muted-foreground">
            날짜 추가
          </span>
        </button>
      )}

      {/* Military Service Quick Status — compact row */}
      <button
        type="button"
        onClick={() => navigate('/service')}
        aria-label="복무 현황과 전역 D-Day 보기"
        className="w-full text-left min-h-11 flex items-center gap-3 py-2 active:bg-muted/40 rounded-control transition"
      >
        <div className="w-8 h-8 bg-navy rounded-full flex items-center justify-center text-primary-foreground shrink-0">
          <Shield className="w-4 h-4" />
        </div>
        <span className="text-label font-semibold text-foreground">복무 현황 · D-Day</span>
        <span className="ml-auto text-caption text-muted-foreground">전역일 확인 ›</span>
      </button>
    </div>
  );
}
