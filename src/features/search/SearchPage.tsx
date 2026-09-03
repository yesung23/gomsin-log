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
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { resolveRelationshipContext } from '@/lib/relationshipContext';

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
 *   3. **관계 맥락별 기본 surface와 검색 결과를 섞지 않는다.** 검색어가 없을 때 군 복무
 *      커플은 역할에 맞는 복무/컨디션 정보를 보고, 일반 커플은 역할과 무관하게 컨디션
 *      도구를 본다. 찾는 동안에는 검색 결과만 보여준다.
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
  const [showDetails, setShowDetails] = useState(false);
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
    <section
      aria-labelledby="service-summary-heading"
      className="ink-box relative space-y-3.5 overflow-hidden p-4"
      data-testid="soldier-service-info"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="service-summary-heading"
            className="text-heading break-keep [overflow-wrap:anywhere]"
            style={{ color: 'var(--ink)' }}
          >
            {title}
          </h2>
          <div
            className="text-label font-semibold text-card-foreground"
            data-testid="service-progress-summary"
          >
            복무율 {formatExpPercent(expState.totalPercent, 4)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-heading font-bold text-card-foreground tabular-nums">
              {expState.isDischarged
                ? '전역'
                : expState.isBeforeEnlistment
                  ? `입대 D-${daysUntilEnlistment}`
                  : `D-${expState.remainingDays}`}
          </span>
          <button
            type="button"
            aria-expanded={showDetails}
            aria-controls="service-details"
            onClick={() => setShowDetails((open) => !open)}
            className="press-response inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-caption font-bold text-coral-strong"
          >
            복무 상세
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={cn('motion-safe:transition-transform', showDetails && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      {/* 상태 변화 알림은 상세가 접혀 있어도 놓치지 않게 한다. */}
      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex items-center gap-1.5 rounded-control border border-coral-strong/30 bg-coral/15 px-3 py-1.5 text-caption font-bold text-coral-strong',
            feedback.isBent && 'ring-2 ring-coral/20',
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

      <div id="service-details" hidden={!showDetails}>
        {showDetails ? (
          <div className="space-y-3.5">
          <div className="flex items-start gap-2.5">
            <div className="ink-chip flex h-10 w-10 shrink-0 items-center justify-center p-1 text-coral-strong">
              <RankInsignia bars={expState.rank.bars} size={32} />
            </div>
            <div className="min-w-0 text-caption text-muted-foreground">
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

          <div className="space-y-2">
            <div
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-label font-semibold text-card-foreground"
              data-testid="service-progress-details"
            >
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
              className="h-2 overflow-hidden rounded-full border"
              style={{ background: 'var(--paper)', borderColor: 'var(--ink-faint)' }}
            >
              <div
                className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
                style={{ width: `${expState.totalPercent}%`, background: 'var(--ink-accent)' }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <span>입대 {formatLocalDate(military.enlistmentDate!)}</span>
              <span>전역 {formatLocalDate(effectiveDischargeDate(military)!)}</span>
            </div>
          </div>

          {/* Service tier, real-time EXP and connected roadmap track */}
          <div className="ink-rule" aria-hidden="true" />
          <div className="space-y-3 pt-0.5">
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
            <p className="text-caption text-muted-foreground" data-testid="service-tier-description">
              {currentTier.description} 입력한 복무 날짜 기준이며 실제 행정 진급·관계 점수가 아니에요.
            </p>

            {/* Real-time EXP Readout */}
            <div className="space-y-1.5" data-testid="service-exp-readout">
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
                className="h-1.5 overflow-hidden rounded-full border"
                style={{ background: 'var(--paper)', borderColor: 'var(--ink-faint)' }}
              >
                <div
                  className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out"
                  style={{ width: `${expState.levelExpPercent}%`, background: 'var(--ink-accent)' }}
                />
              </div>
              <div
                className="grid gap-0.5 text-caption text-muted-foreground tabular-nums min-[375px]:grid-cols-2"
                data-testid="service-level-progress-copy"
              >
                <span>{expState.levelBadge} 진행 {formatExpPercent(expState.levelExpPercent, 1)}</span>
                <span className="min-[375px]:text-right">{`다음 Lv.${expState.level + 1}까지 ${formatRemainingDuration(expState.toNextLevelSec)}`}</span>
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

              {/* The full tier map stays secondary to the compact summary. */}
              <div className="relative pt-2 pb-1" data-testid="service-tier-rail">
              {/* Background track */}
              <div className="absolute top-[26px] left-[7.14%] right-[7.14%] h-0.5 -translate-y-1/2 bg-border" />
              {/* Active progress rail */}
              <div
                className="absolute top-[26px] left-[7.14%] h-0.5 -translate-y-1/2 bg-coral-strong motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
                style={{
                  width: expState.isDischarged
                    ? '85.72%'
                    : `${Math.min(85.72, Math.max(0, (expState.totalPercent / 100) * 85.72))}%`,
                }}
              />

              <ol aria-label="복무 레벨 성장 단계" className="relative grid list-none grid-cols-7 gap-0.5">
                {expState.tierStops.map((stage: ServiceTierStop, idx: number) => {
                  return (
                    <li
                      key={stage.key}
                      data-testid={`service-tier-step-${idx + 1}`}
                      data-tier-key={stage.key}
                      aria-current={stage.isCurrent ? 'step' : undefined}
                      className={cn(
                        'flex flex-col items-center justify-center px-0.5 text-center motion-safe:transition-all',
                        stage.isCurrent && 'scale-105',
                      )}
                    >
                      <div
                        className={cn(
                          'mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-caption font-bold motion-safe:transition-all',
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
                          'w-full text-caption leading-tight break-keep',
                          stage.isCurrent ? 'font-bold text-coral-strong' : stage.isPast ? 'font-semibold text-card-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {stage.label}
                      </span>
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {stage.minPercent}%
                      </span>
                    </li>
                  );
                })}
              </ol>
              </div>
            </div>

          {contact?.enabled ? (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
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
          </div>
        ) : null}
      </div>
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
          className="press-response ink-box min-h-11 w-full p-4 text-left"
          style={{ background: 'var(--paper)' }}
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
          className="press-response ink-box min-h-11 w-full p-4 text-left"
          style={{ background: 'var(--paper)' }}
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
        <section aria-labelledby="next-leave-heading" className="pt-1" data-testid="soldier-next-leave">
          <div className="ink-rule" aria-hidden="true" />
          <div className="flex min-h-11 items-start gap-3 py-3">
            <Calendar size={16} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="next-leave-heading" className="text-label font-bold text-card-foreground">
                  {nextLeave.eventType === 'vacation' ? '다음 휴가' : '다음 면회'}
                </h2>
                <span className="shrink-0 text-label font-bold text-coral-strong tabular-nums">
                  {nextLeave.startDate === today ? 'D-Day' : `D-${daysBetweenLocal(today, nextLeave.startDate)}`}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 text-label font-semibold text-card-foreground break-keep [overflow-wrap:anywhere]">
                  {nextLeave.title || (nextLeave.eventType === 'vacation' ? '휴가' : '면회')}
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {formatLocalDate(nextLeave.startDate)}
                </span>
              </div>
            </div>
          </div>
        </section>
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
  showPartnerService = true,
  surfaceTestId = 'gomsin-search-surface',
  recipientLabel = '군화',
}: {
  authenticated: boolean;
  userId?: string;
  coupleId?: string;
  connected: boolean;
  partnerName: string;
  partnerMilitary?: MilitaryInfo;
  showPartnerService?: boolean;
  surfaceTestId?: string;
  recipientLabel?: string;
}) {
  const hasPartnerService = showPartnerService
    && connected
    && computeServiceProgress(partnerMilitary, localToday()) !== null;
  return (
    <div className="space-y-4" data-testid={surfaceTestId}>
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
        recipientLabel={recipientLabel}
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
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const isMilitaryRelationship = resolveRelationshipContext(
    state.profile.couple.relationshipContext,
  ) === 'military';

  const openRecord = (record: DailyRecord) => {
    // §7.5 -- 근사치가 아니라 정확히 그 기록. `?record=` 는 새로고침과 딥링크에도 남는다.
    navigate(`/record?record=${encodeURIComponent(record.id)}`);
  };

  return (
    <div className="min-h-full pb-24">
      <AppBar
        title="찾기"
        actions={(
          <AppBarAction
            aria-label="기록 남기기"
            onClick={() => navigate('/compose')}
            className="h-11 w-11"
          >
            <SquarePen size={20} className="pen-icon" color="var(--ink)" aria-hidden="true" />
          </AppBarAction>
        )}
      />
      <div className="px-4 pt-3 pb-2">
        <form
          role="search"
          aria-label="기록 찾기"
          onSubmit={(event) => event.preventDefault()}
          className="flex items-center"
        >
          <div
            className="ink-chip flex min-w-0 flex-1 items-center gap-2 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring)]"
            data-testid="record-search-field"
            style={{ background: 'var(--paper)' }}
          >
            <Search size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="쓴 말이나 날짜로 찾기"
              aria-label="쓴 말이나 날짜로 찾기"
              aria-describedby="record-search-help"
              aria-controls="record-search-results"
              enterKeyHint="search"
              type="text"
              role="searchbox"
              className="min-h-11 min-w-0 w-full flex-1 bg-transparent text-body outline-none placeholder:text-[var(--ink-soft)] placeholder:opacity-100"
              style={{ color: 'var(--ink)' }}
            />
            {query ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                className="press-response flex h-11 w-11 items-center justify-center"
              >
                <X size={16} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
              </button>
            ) : null}
          </div>

        </form>

        <p id="record-search-help" className="pt-1.5 text-caption leading-relaxed break-keep" style={{ color: 'var(--ink-soft)' }}>
          {/* 왜 기기 안인지 말한다. 제약처럼 보이는 것이 실은 이 구조가 준 것이다. */}
          기기 안에서만 검색해요 · 날짜도 가능
        </p>
      </div>

      <div id="record-search-results">
        {result.kind === 'empty' ? (
          <div className="px-4 py-3">
            {!isMilitaryRelationship ? (
              <GomsinSearchSurface
                authenticated={Boolean(state.authenticatedUser?.id)}
                userId={state.authenticatedUser?.id}
                coupleId={state.profile.couple?.coupleId}
                connected={Boolean(state.profile.couple?.connected)}
                partnerName={state.profile.couple?.partnerName || ''}
                showPartnerService={false}
                surfaceTestId="general-search-surface"
                recipientLabel="상대방"
              />
            ) : isSoldier ? (
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
      <p role="status" className="px-4 pt-8 text-center text-label" style={{ color: 'var(--ink-soft)' }}>
        {result.kind === 'date' ? '그날은 남긴 것이 없어요' : '그 말이 들어간 기록이 없어요'}
      </p>
    );
  }

  return (
    <div>
      {result.kind === 'date' ? (
        <div role="status" className="flex items-center gap-1.5 px-4 pb-2">
          <CalendarDays size={14} className="pen-icon" color="var(--ink-soft)" aria-hidden="true" />
          <span className="text-caption" style={{ color: 'var(--ink-soft)' }}>
            {result.date} · {result.matches.length}개
          </span>
        </div>
      ) : (
        <p role="status" className="px-4 pb-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
          {result.matches.length}개 찾았어요
        </p>
      )}

      <ul aria-label="검색 결과" className="px-4">
        {result.matches.map((match) => {
          const { before, hit, after } = excerptAround(match);
          const [, month, day] = match.record.date.split('-');
          return (
            <li key={match.record.id}>
              <button
                type="button"
                onClick={() => onOpen(match.record)}
                className="press-response-row flex min-h-11 min-w-0 w-full flex-col items-start gap-1 py-3 text-left"
              >
                <span className="text-caption tabular-nums" style={{ color: 'var(--ink-soft)' }}>
                  {Number(month)}월 {Number(day)}일 {match.record.time}
                </span>
                {/*
                  발췌는 원문 그대로다. 앱이 문장을 만들지 않고(§6.2), 찾던 말만 다른 색으로
                  표시해 사용자가 맞는 것을 찾았는지 바로 알게 한다.
                */}
                <span className="hand-text w-full text-body break-keep [overflow-wrap:anywhere]" style={{ color: 'var(--ink)' }}>
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
