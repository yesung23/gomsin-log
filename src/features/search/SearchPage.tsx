import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, CalendarDays, SquarePen, Shield, Calendar, Clock, ChevronRight, ChevronDown, Check, Sparkles, Zap, Crown } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { visibleRecordsForViewer } from '@/lib/privacy';
import { searchRecords, excerptAround, type SearchResult } from '@/lib/recordSearch';
import { localToday } from '@/lib/cycle';
import {
  computeServiceProgress,
  effectiveDischargeDate,
  nextUpcomingEvent,
  resolveEffectiveMilitary,
} from '@/lib/milestones';
import {
  computeServiceExp,
  formatExpNumber,
  formatExpPercent,
  type ServiceTierStop,
} from '@/lib/serviceLevel';
import { cn, daysBetweenLocal, formatLocalDate } from '@/lib/utils';
import { CycleTrackerSection } from '@/components/CycleTrackerSection';
import { CycleSupportSection } from '@/components/CycleSupportSection';
import type { DailyRecord, MilitaryInfo, ContactPreferences, CoupleEvent, Branch, MilitaryStatus } from '@/types';
import { MobileShell } from '@/components/MobileShell';

/**
 * 찾기 — `우리`의 색인.
 *
 * 탭이 아니다. 한 번 탭으로 짰다가 되돌렸다(§5.3): **인스타에 검색 탭이 있는 이유는
 * 거기에 남의 게시물이 있기 때문**이고, 이 앱에는 남이 없다. 그래서 탐색 격자에 넣을
 * 것이 우리 둘의 기록밖에 없었고 그것은 `우리` 탭의 게시물 격자와 같은 화면이었다. 격자를
 * 지우고 검색을 남겼다. 현재는 검색어가 없을 때 역할별 개인 정보 surface를 먼저 보여주고,
 * 입력하면 종이 일기장 뒤에 붙은 색인처럼 동작한다.
 *
 * ## 이 화면이 지키는 것 셋
 *
 *   1. **기기 안에서만 찾는다.** 서버 측 전문 검색은 E2EE 와 양립하지 않아 어떤 버전에서도
 *      약속하지 않는다(§17). 그런데 클라이언트는 이미 복호화된 기록을 들고 있으므로
 *      검색은 원래부터 기기의 일이다.
 *   2. **최근 검색을 저장하지 않는다.** 자기 일기에서 무엇을 찾았는지는 그 자체로 사적인
 *      사실이고, 폰을 옆에서 보는 사람에게 가장 먼저 읽히는 흔적이다.
 *   3. **역할별 기본 surface와 검색 결과를 섞지 않는다.** 검색어가 없을 때만 군화의
 *      복무 정보 또는 곰신의 주기 표면을 보여주고, 찾는 동안에는 검색 결과만 보여준다.
 *
 * 한 칸으로 둘을 받는다 -- `8/14` 같은 날짜면 그날을 열고, 아니면 쓴 말에서 찾는다.
 * 토글을 두면 사용자가 무엇을 고를지 먼저 정해야 하는데, 찾을 때 사람은 그냥 기억나는
 * 것을 친다.
 *
 * ## 왜 이 화면에 기록 진입점이 또 있는가
 *
 * §7.1 -- 작성 진입점은 이 탭에 상시 존재하며 제거할 수 없다. 탭바 가운데의 `남기기`가
 * 있는데도 여기 하나를 더 두는 것은 중복이 아니라, **그 계약이 탭바의 생김새에 기대지
 * 않게** 하기 위해서다. 둥근 부유 버튼이 아니라 줄 안의 작은 펜이라 탭바와 자리를 다투지
 * 않는다.
 */

interface SoldierSearchSurfaceProps {
  military: MilitaryInfo;
  contact: ContactPreferences;
  events: CoupleEvent[];
  today: string;
  onOpenService: () => void;
}

const BRANCH_LABELS: Record<Branch, string> = {
  army: '육군',
  marine: '해병대',
  reserve: '상근예비역',
  navy: '해군',
  airforce: '공군',
  social_service: '사회복무요원',
  other: '기타',
};

const STATUS_LABELS: Record<MilitaryStatus, string> = {
  planned: '입대 예정',
  serving: '복무 중',
  discharge_soon: '전역 예정',
  discharged: '전역',
  unknown: '미입력',
};

function formatRemainingDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}일 ${hours}시간 남음` : `${days}일 남음`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분 남음` : `${hours}시간 남음`;
  }
  if (minutes > 0) {
    return `${minutes}분 남음`;
  }
  return `${s}초 남음`;
}

function RankInsignia({ bars, size = 32 }: { bars: number; size?: number }) {
  const w = size;
  const h = size * 0.85;
  const barH = h / 6.2;
  const gap = barH * 0.55;
  const block = bars * barH + Math.max(0, bars - 1) * gap;
  const top = (h - block) / 2;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      {bars === 0 ? (
        <rect
          x={w * 0.16}
          y={h * 0.28}
          width={w * 0.68}
          height={h * 0.44}
          rx={2}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="3 3"
          className="text-muted-foreground opacity-60"
        />
      ) : (
        Array.from({ length: bars }).map((_, i) => {
          const y = top + i * (barH + gap);
          const inset = w * 0.14 + i * (w * 0.012);
          return (
            <polygon
              key={i}
              points={`${inset},${y} ${w - inset},${y} ${w - inset - w * 0.05},${y + barH} ${inset + w * 0.05},${y + barH}`}
              className="fill-coral-strong"
            />
          );
        })
      )}
    </svg>
  );
}

function InlineServiceInfo({
  military,
  contact,
  onOpenService,
  title = '내 복무',
}: {
  military: MilitaryInfo;
  contact?: ContactPreferences;
  onOpenService?: () => void;
  title?: string;
}) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'promo'; text: string; isBent: boolean } | null>(null);
  const prevRef = useRef<{ tierKey: string; ready: boolean }>({
    tierKey: '',
    ready: false,
  });

  useEffect(() => {
    let interval: number | undefined;
    const syncNow = () => setNowMs(Date.now());
    const stopInterval = () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const startInterval = () => {
      stopInterval();
      syncNow();
      interval = window.setInterval(syncNow, 1000);
    };
    const onVisibilityChange = () => {
      if (document.hidden) stopInterval();
      else startInterval();
    };

    if (document.hidden) stopInterval();
    else startInterval();
    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopInterval();
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const expState = useMemo(() => computeServiceExp(military, nowMs), [military, nowMs]);
  const expTierKey = expState?.tier.key;
  const expTierLabel = expState?.tier.label;
  const expIsBeforeEnlistment = expState?.isBeforeEnlistment;

  useEffect(() => {
    if (expTierKey === undefined || expTierLabel === undefined) {
      prevRef.current = { tierKey: '', ready: false };
      return;
    }
    const prev = prevRef.current;
    if (prev.ready && !expIsBeforeEnlistment) {
      if (expTierKey !== prev.tierKey && prev.tierKey) {
        const isBent = expTierKey === 'ilkkak' || expTierKey === 'sangkkak';
        setFeedback({
          kind: 'promo',
          text: `${expState?.levelBadge} ${expTierLabel} 달성! 복무 게이지가 이어지고 있어요.`,
          isBent,
        });
      }
    }
    prevRef.current = { tierKey: expTierKey, ready: true };
  }, [expTierKey, expTierLabel, expIsBeforeEnlistment, expState?.levelBadge]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (!expState) return null;

  const daysUntilEnlistment = expState.daysUntilEnlistment;
  const nextGuide = expState.isBeforeEnlistment
    ? `입대까지 ${daysUntilEnlistment}일`
    : expState.isDischarged
    ? '복무를 마쳤어요.'
    : `다음 Lv.${expState.level + 1}까지 ${formatRemainingDuration(expState.toNextLevelSec)}`;
  const currentTier = expState.tier;

  return (
    <section className="rounded-control border border-border bg-card p-4 space-y-3.5 relative overflow-hidden" data-testid="soldier-service-info">
      {/* Level-up / Promo Accessible Feedback */}
      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-coral-strong/30 bg-coral/15 px-3 py-1.5 text-caption font-bold text-coral-strong transition-all duration-300',
            feedback.isBent && 'ring-2 ring-coral/20 motion-safe:animate-pulse',
          )}
          data-testid="service-feedback"
          data-tier-effect={feedback.isBent ? 'bent' : 'none'}
        >
          {feedback.isBent ? (
            <Zap size={15} className="shrink-0" aria-hidden="true" />
          ) : (
            <Sparkles size={14} className="shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.text}</span>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral/10 text-coral-strong p-1">
            <RankInsignia bars={expState.rank.bars} size={32} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-label font-bold text-card-foreground">{title}</span>
            </div>
            <div className="text-caption text-muted-foreground">
              {BRANCH_LABELS[military.branch]} ·{' '}
              <span data-testid="service-status">
                {expState.isDischarged
                  ? '전역했어요'
                  : expState.isBeforeEnlistment
                    ? STATUS_LABELS[military.militaryStatus]
                    : '복무 중'}
              </span>{' '}
              · <span className="opacity-80">복무 레벨</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <span className="text-heading font-bold text-card-foreground tabular-nums">
            {expState.isDischarged
              ? '전역'
              : expState.isBeforeEnlistment
                ? `입대 D-${daysUntilEnlistment}`
                : `D-${expState.remainingDays}`}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-label font-semibold text-card-foreground"
          data-testid="service-progress-summary"
        >
          <span>복무율 {formatExpPercent(expState.totalPercent, 4)}</span>
          <span className="text-muted-foreground tabular-nums">
            {expState.isBeforeEnlistment
              ? `입대까지 ${daysUntilEnlistment}일`
              : `${expState.elapsedDays}일 경과 · ${expState.remainingDays}일 남음`}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="개인 복무 진행률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={expState.totalPercent}
          aria-valuetext={`복무율 ${formatExpPercent(expState.totalPercent, 4)}, 현재 복무 레벨 ${expState.levelBadge} ${currentTier.label}, ${nextGuide}`}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-coral-strong transition-[width] duration-700 ease-out"
            style={{ width: `${expState.totalPercent}%` }}
          />
        </div>
        <div className="flex justify-between gap-3 text-caption text-muted-foreground">
          <span>입대 {formatLocalDate(military.enlistmentDate!)}</span>
          <span>전역 {formatLocalDate(effectiveDischargeDate(military)!)}</span>
        </div>
      </div>

      {/* Service tier, real-time EXP and connected roadmap track */}
      <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5" data-testid="service-level">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded bg-coral/20 px-1.5 py-0.5 text-caption font-extrabold text-coral-strong tabular-nums',
                  expState.isDischarged && 'bg-coral-strong text-coral-strong-foreground',
                )}
                data-tier-key={currentTier.key}
              >
                {expState.isDischarged ? <Crown size={12} aria-hidden="true" /> : null}
                <span>{expState.levelBadge}</span>
              </span>
              {' '}
              <span className={cn('text-label font-bold text-card-foreground', expState.isDischarged && 'text-coral-strong')}>
                {expState.isPreEnlistment ? '입대 대기' : currentTier.label}
              </span>
            </div>
            <span className="block text-caption text-muted-foreground" data-testid="service-level-guide">
              {nextGuide}
            </span>
          </div>
          <button
            type="button"
            aria-expanded={showAllTiers}
            aria-controls="service-tier-rail"
            onClick={() => setShowAllTiers((open) => !open)}
            className="press-response inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-caption font-bold text-coral-strong"
          >
            {showAllTiers ? '단계 접기' : '전체 단계'}
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={cn('motion-safe:transition-transform', showAllTiers && 'rotate-180')}
            />
          </button>
        </div>
        <p className="text-caption text-muted-foreground" data-testid="service-tier-description">
          {currentTier.description} 입력한 복무 날짜 기준이며 실제 행정 진급·관계 점수가 아니에요.
        </p>

        {/* Real-time EXP Readout */}
        <div className="rounded-lg border border-border/60 bg-card/60 p-2.5 space-y-1.5" data-testid="service-exp-readout">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1 text-label font-bold text-card-foreground tabular-nums">
              <span className="font-extrabold text-coral-strong">{formatExpNumber(expState.intoLevelSec)}</span>
              <span className="text-caption font-normal text-muted-foreground">/ {formatExpNumber(expState.secPerLevel)} EXP</span>
            </div>
            <span className="text-label font-extrabold text-coral-strong tabular-nums">
              {formatExpPercent(expState.levelExpPercent, 4)}
            </span>
          </div>

          {!expState.isDischarged && !expState.isBeforeEnlistment ? (
            <div className="space-y-1">
              <div
                role="progressbar"
                aria-label="현재 복무 레벨 경험치 진행률"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={expState.levelExpPercent}
                aria-valuetext={`${expState.levelBadge} ${currentTier.label} 경험치 ${formatExpPercent(expState.levelExpPercent, 4)}`}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-coral-strong transition-[width] duration-300 ease-out"
                  style={{ width: `${expState.levelExpPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-caption text-muted-foreground tabular-nums">
                <span>{expState.levelBadge} 진행 {formatExpPercent(expState.levelExpPercent, 1)}</span>
                <span>{`다음 Lv.${expState.level + 1}까지 ${formatRemainingDuration(expState.toNextLevelSec)}`}</span>
              </div>
            </div>
          ) : null}

          {/* Daily Today EXP */}
          {!expState.isBeforeEnlistment && !expState.isDischarged ? (
            <div className="pt-1.5 border-t border-border/40 flex items-center justify-between text-caption text-muted-foreground tabular-nums" data-testid="service-today-exp">
              <span>오늘 획득</span>
              <span className="font-semibold text-card-foreground">{formatExpNumber(expState.todayExp)} / 86,400 EXP</span>
            </div>
          ) : null}
        </div>

        {/* The full tier map stays secondary; the live current level remains visible above. */}
        <div id="service-tier-rail">
          {showAllTiers ? (
            <div className="relative pt-2 pb-1" data-testid="service-tier-rail" aria-label="복무 레벨 성장 단계">
              {/* Background track */}
              <div className="absolute top-[26px] left-[7.14%] right-[7.14%] h-0.5 -translate-y-1/2 bg-border" />
              {/* Active progress rail */}
              <div
                className="absolute top-[26px] left-[7.14%] h-0.5 -translate-y-1/2 bg-coral-strong transition-[width] duration-700 ease-out"
                style={{
                  width: expState.isDischarged
                    ? '85.72%'
                    : `${Math.min(85.72, Math.max(0, (expState.totalPercent / 100) * 85.72))}%`,
                }}
              />

              <div className="relative grid grid-cols-7 gap-0.5">
                {expState.tierStops.map((stage: ServiceTierStop, idx: number) => {
                  return (
                    <div
                      key={stage.key}
                      data-testid={`service-tier-step-${idx + 1}`}
                      data-tier-key={stage.key}
                      className={cn(
                        'flex flex-col items-center justify-center text-center transition-all px-0.5',
                        stage.isCurrent && 'scale-105',
                      )}
                    >
                      <div
                        className={cn(
                          'mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-caption font-bold transition-all',
                          stage.isCurrent && 'bg-coral-strong text-coral-strong-foreground ring-4 ring-coral/20',
                          stage.isPast && 'bg-coral-strong text-coral-strong-foreground',
                          stage.isCurrent && stage.isMax && 'ring-coral/30',
                          stage.isFuture && 'bg-card border border-border text-muted-foreground',
                        )}
                      >
                        {stage.isCurrent && stage.isMax ? (
                          <Crown size={13} strokeWidth={2.5} aria-hidden="true" />
                        ) : stage.isPast ? (
                          <Check size={13} strokeWidth={3} aria-hidden="true" />
                        ) : (
                          <span>LV {stage.level}</span>
                        )}
                      </div>

                      <span
                        className={cn(
                          'text-caption leading-tight truncate w-full',
                          stage.isCurrent ? 'font-bold text-coral-strong' : stage.isPast ? 'font-semibold text-card-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {stage.label}
                      </span>
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {stage.minPercent}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {contact?.enabled ? (
        <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock size={13} aria-hidden="true" />
          평일 {contact.weekdayStart}–{contact.weekdayEnd} · 주말 {contact.weekendStart}–{contact.weekendEnd}
        </p>
      ) : null}

      {onOpenService ? (
        <button
          type="button"
          onClick={onOpenService}
          className="press-response min-h-11 text-caption font-semibold text-coral-strong"
        >
          복무 정보 수정
        </button>
      ) : null}
    </section>
  );
}

function SoldierSearchSurface({
  military,
  contact,
  events,
  today,
  onOpenService,
}: SoldierSearchSurfaceProps) {
  const progress = computeServiceProgress(military, today);
  const discharged = progress?.isDischarged === true || military?.militaryStatus === 'discharged';
  const hasRealProgress = progress !== null;

  const nextLeave = nextUpcomingEvent(events, today, ['vacation', 'visit']);

  return (
    <div className="space-y-4" data-testid="soldier-search-surface">
      {hasRealProgress ? (
        <InlineServiceInfo
          military={military}
          contact={contact}
          onOpenService={onOpenService}
        />
      ) : discharged ? (
        <button
          type="button"
          onClick={onOpenService}
          aria-label="내 복무 현황 열기"
          className="press-response w-full rounded-control border border-border bg-card p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-muted-foreground" aria-hidden="true" />
            <span className="text-label font-bold text-card-foreground">내 복무</span>
            <span className="ml-auto text-label font-bold text-card-foreground">전역했어요</span>
            <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-caption text-muted-foreground">
            복무 정보를 다시 확인하거나 수정할 수 있어요.
          </p>
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenService}
          aria-label="복무 정보 입력하기"
          className="press-response w-full rounded-control border border-border bg-card p-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-muted-foreground" aria-hidden="true" />
            <span className="text-label font-bold text-card-foreground">내 복무</span>
            <span className="ml-auto text-caption text-muted-foreground">입력하기</span>
            <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-caption text-muted-foreground">
            입대일과 예상 전역일을 입력하면 남은 복무일과 진척도를 확인할 수 있어요.
          </p>
        </button>
      )}

      {nextLeave ? (
        <div className="rounded-control border border-border bg-card p-4" data-testid="soldier-next-leave">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-muted-foreground" aria-hidden="true" />
            <span className="text-label font-bold text-card-foreground">
              {nextLeave.eventType === 'vacation' ? '다음 휴가' : '다음 면회'}
            </span>
            <span className="ml-auto text-label font-bold text-coral-strong tabular-nums">
              {nextLeave.startDate === today ? 'D-Day' : `D-${daysBetweenLocal(today, nextLeave.startDate)}`}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-label font-semibold text-card-foreground truncate">
              {nextLeave.title || (nextLeave.eventType === 'vacation' ? '휴가' : '면회')}
            </span>
            <span className="text-caption text-muted-foreground shrink-0 ml-2">
              {formatLocalDate(nextLeave.startDate)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GomsinSearchSurface({
  authenticated,
  userId,
  coupleId,
  connected,
  partnerName,
  partnerMilitary,
}: {
  authenticated: boolean;
  userId?: string;
  coupleId?: string;
  connected: boolean;
  partnerName: string;
  partnerMilitary?: MilitaryInfo;
}) {
  const hasPartnerService = connected && computeServiceProgress(partnerMilitary, localToday()) !== null;
  return (
    <div className="space-y-4" data-testid="gomsin-search-surface">
      {hasPartnerService ? (
        <InlineServiceInfo
          military={partnerMilitary!}
          title={partnerName ? `${partnerName}의 복무` : '상대 복무'}
        />
      ) : null}
      {/* 내 배려/컨디션 신호 */}
      <CycleSupportSection
        key={`mine:${userId || 'signed-out'}`}
        mine
        authenticated={authenticated}
        userId={userId}
        coupleId={coupleId}
        connected={connected}
      />
      {/* 상대방이 보낸 배려 신호 */}
      <CycleSupportSection
        key={`partner:${userId || 'signed-out'}`}
        mine={false}
        authenticated={authenticated}
        userId={userId}
        coupleId={coupleId}
        connected={connected}
      />
      {/* 생리 주기 트래커 */}
      <CycleTrackerSection
        key={userId || 'signed-out'}
        userId={userId}
      />
    </div>
  );
}

function SearchPageBody() {
  const navigate = useNavigate();
  const { state } = useStore();
  const [query, setQuery] = useState('');

  /*
    내 기록 + 상대가 공유한 것. `RecordPage` 와 같은 필터를 쓴다.

    이걸 빼먹으면 검색이 상대의 `나만 보기` 조각을 찾아 준다 -- 화면에는 어디에도 없는
    글이 검색에서만 나오는 것이고, 그것은 유출이다.
  */
  const records = useMemo(
    () => visibleRecordsForViewer(state.records, {
      userId: state.profile.id,
      role: state.profile.role,
    }),
    [state.records, state.profile.id, state.profile.role],
  );

  const [today, setToday] = useState(() => localToday());

  useEffect(() => {
    const updateToday = () => {
      const current = localToday();
      setToday((prev) => (prev !== current ? current : prev));
    };

    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      50,
    );
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

    const timer = window.setTimeout(updateToday, delay);
    const onFocus = () => updateToday();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [today]);

  const result = useMemo(() => searchRecords(records, query, today), [records, query, today]);
  const isSoldier = state.profile.role === 'soldier';

  const openRecord = (record: DailyRecord) => {
    // §7.5 -- 근사치가 아니라 정확히 그 기록. `?record=` 는 새로고침과 딥링크에도 남는다.
    navigate(`/record?record=${encodeURIComponent(record.id)}`);
  };

  return (
    <div className="min-h-full pb-24">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="ink-chip flex flex-1 items-center gap-2 px-3">
            <Search size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="쓴 말이나 날짜로 찾기"
              aria-label="쓴 말이나 날짜로 찾기"
              enterKeyHint="search"
              type="search"
              className="hand-text min-h-11 w-full flex-1 bg-transparent text-body outline-none placeholder:opacity-45"
              style={{ color: 'var(--ink)' }}
            />
            {query ? (
              <button
                type="button"
                aria-label="지우기"
                onClick={() => setQuery('')}
                className="press-response flex h-11 w-11 items-center justify-center"
              >
                <X size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {/* §7.1. 조건 없이 그린다 -- 이 버튼이 사라지는 상태는 존재하지 않는다. */}
          <button
            type="button"
            aria-label="기록 남기기"
            onClick={() => navigate('/compose')}
            className="press-response ink-chip flex h-11 w-11 items-center justify-center"
          >
            <SquarePen size={18} className="pen-icon" color="var(--ink)" aria-hidden="true" />
          </button>
        </div>

        <p className="pt-1.5 text-caption" style={{ color: 'var(--ink-soft)' }}>
          {/* 왜 기기 안인지 말한다. 제약처럼 보이는 것이 실은 이 구조가 준 것이다. */}
          이 기기 안에서만 찾아요 · 8/14 처럼 날짜로도 찾을 수 있어요
        </p>
      </div>

      {result.kind === 'empty' ? (
        <div className="px-4 py-3">
          {isSoldier ? (
            <SoldierSearchSurface
              military={state.profile.military}
              contact={state.profile.contact}
              events={state.events}
              today={today}
              onOpenService={() => navigate('/service')}
            />
          ) : (
            <GomsinSearchSurface
              authenticated={Boolean(state.authenticatedUser?.id)}
              userId={state.authenticatedUser?.id}
              coupleId={state.profile.couple?.coupleId}
              connected={Boolean(state.profile.couple?.connected)}
              partnerName={state.profile.couple?.partnerName || ''}
              partnerMilitary={resolveEffectiveMilitary(state.profile)}
            />
          )}
        </div>
      ) : (
        <Results result={result} onOpen={openRecord} />
      )}
    </div>
  );
}

function Results({
  result,
  onOpen,
}: {
  result: SearchResult;
  onOpen: (record: DailyRecord) => void;
}) {
  if (result.matches.length === 0) {
    return (
      <p className="px-4 pt-8 text-center text-label" style={{ color: 'var(--ink-soft)' }}>
        {result.kind === 'date' ? '그날은 남긴 것이 없어요' : '그 말이 들어간 기록이 없어요'}
      </p>
    );
  }

  return (
    <div>
      {result.kind === 'date' ? (
        <div className="flex items-center gap-1.5 px-4 pb-2">
          <CalendarDays size={14} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
          <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>
            {result.date} · {result.matches.length}개
          </span>
        </div>
      ) : (
        <p className="px-4 pb-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
          {result.matches.length}개 찾았어요
        </p>
      )}

      <ul className="px-4">
        {result.matches.map((match) => {
          const { before, hit, after } = excerptAround(match);
          const [, month, day] = match.record.date.split('-');
          return (
            <li key={match.record.id}>
              <button
                type="button"
                onClick={() => onOpen(match.record)}
                className="press-response-row flex min-h-11 w-full flex-col items-start gap-1 py-3 text-left"
              >
                <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                  {Number(month)}월 {Number(day)}일 {match.record.time}
                </span>
                {/*
                  발췌는 원문 그대로다. 앱이 문장을 만들지 않고(§6.2), 찾던 말만 다른 색으로
                  표시해 사용자가 맞는 것을 찾았는지 바로 알게 한다.
                */}
                <span className="hand-text text-body" style={{ color: 'var(--ink)' }}>
                  {result.kind === 'date' ? match.snippet : (
                    <>
                      {before}
                      <mark
                        style={{
                          background: 'transparent',
                          color: 'var(--ink-accent)',
                          fontWeight: 700,
                        }}
                      >
                        {hit}
                      </mark>
                      {after}
                    </>
                  )}
                </span>
              </button>
              <div className="ink-rule" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 탭은 셸 안에 있어야 한다.

 * 셸이 하단 탭바와 스킵 링크와 라우트 안내를 갖는다. 이것 없이 렌더하면 그 탭에 들어간
 * 사람은 탭바가 없어 **빠져나올 수 없다** -- 뒤로 가기 말고는.
 */
export function SearchPage() {
  return (
    <MobileShell>
      <SearchPageBody />
    </MobileShell>
  );
}
