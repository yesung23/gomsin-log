import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Flag, Pause, Play, RefreshCw, Shield, Sparkles } from 'lucide-react';
import type { MilitaryInfo } from '@/types';
import { effectiveDischargeDate } from '@/lib/milestones';
import { formatLocalDate } from '@/lib/utils';
import { formatExpNumber } from '@/lib/serviceLevel';
import { computeServiceJourney } from './serviceJourneyModel';
import './serviceJourney.css';

function formatLevelWait(seconds: number | null) {
  if (seconds === null) return null;
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(wholeSeconds / 60)}분 ${wholeSeconds % 60}초`;
}

/** Local clock only: no polling, profile writes, earned-point ledger or analytics. */
export function ServiceJourney({ military, name, compact = false }: {
  military: MilitaryInfo | undefined;
  name: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [onScreen, setOnScreen] = useState(true);
  const [levelEvent, setLevelEvent] = useState<{ id: number; level: number; gained: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const progress = computeServiceJourney(military, now);
  const scope = `${military?.branch}:${military?.enlistmentDate}:${effectiveDischargeDate(military)}`;
  const progressRef = useRef(progress);
  const scopeRef = useRef(scope);
  const highestLevelRef = useRef(progress?.level ?? 0);
  const lastNowRef = useRef(now);
  const eventIdRef = useRef(0);
  // Keep the clock through pre-enlistment so midnight can start the journey.
  const active = progress !== null && !progress.isDischarged;

  useEffect(() => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      highestLevelRef.current = progress?.level ?? 0;
      setLevelEvent(null);
    } else if (progress) {
      highestLevelRef.current = Math.max(highestLevelRef.current, progress.level);
    }
    progressRef.current = progress;
    lastNowRef.current = now;
  }, [now, progress, scope]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(entries => setOnScreen(entries[0]?.isIntersecting ?? false));
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  const updateClock = useCallback((allowLevelEvent: boolean) => {
    const nextNow = Date.now();
    const previous = progressRef.current;
    const next = computeServiceJourney(military, nextNow);
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (
      allowLevelEvent
      && scopeRef.current === scope
      && visible
      && onScreen
      && !paused
      && !reduced
      && previous
      && next
      && !previous.isBeforeEnlistment
      && nextNow >= lastNowRef.current
      && next.level > highestLevelRef.current
    ) {
      const gained = next.level - highestLevelRef.current;
      eventIdRef.current += 1;
      setLevelEvent({ id: eventIdRef.current, level: next.level, gained });
    }
    if (next) highestLevelRef.current = Math.max(highestLevelRef.current, next.level);
    progressRef.current = next;
    lastNowRef.current = nextNow;
    setNow(nextNow);
  }, [military, onScreen, paused, reduced, scope]);

  useEffect(() => {
    if (!active || paused || reduced || !onScreen) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const reconcile = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === 'hidden') {
        setLevelEvent(null);
        return;
      }
      updateClock(false);
      timer = setInterval(() => updateClock(true), 1000);
    };
    reconcile();
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [active, onScreen, paused, reduced, updateClock]);

  useEffect(() => {
    if (!levelEvent) return;
    const timer = setTimeout(() => setLevelEvent(null), 1800);
    return () => clearTimeout(timer);
  }, [levelEvent]);

  useEffect(() => {
    if (paused || reduced || !onScreen) setLevelEvent(null);
  }, [onScreen, paused, reduced]);

  if (!progress) return military?.enlistmentDate && effectiveDischargeDate(military)
    ? <p className="text-label text-muted-foreground" role="status">복무 날짜를 확인해 주세요</p> : null;
  const waiting = progress.isBeforeEnlistment;
  const complete = progress.isDischarged;
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const live = !paused && !reduced && onScreen && visible;
  const percent = complete ? 100 : Math.min(99.9, Number(progress.totalPercent.toFixed(1)));
  const nextLevelWait = formatLevelWait(progress.nextLevelInSec);

  return (
    <section
      ref={container}
      className={`service-journey ${compact ? 'service-journey--compact' : 'ink-box p-5'}`}
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
      aria-labelledby={compact ? titleId : 'service-progress-title'}
      data-testid="service-journey"
      data-live={active && live}
    >
      {levelEvent && live && (
        <div
          key={levelEvent.id}
          className="service-journey-level-event"
          data-testid="service-level-event"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          Lv.{levelEvent.level} 달성{levelEvent.gained > 1 ? ` · ${levelEvent.gained}레벨 성장` : ''}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="service-journey-emblem" aria-hidden="true">
            <Shield strokeWidth={1.3} />
            <div className="service-journey-insignia">
              {complete ? <Check size={24} /> : progress.bars > 0
                ? Array.from({ length: progress.bars }, (_, index) => <i key={index} />)
                : <Sparkles size={21} strokeWidth={1.5} />}
            </div>
          </div>
          <div className="min-w-0">
            {progress.estimatedRanks ? (
              <p className="text-caption text-muted-foreground" data-testid="service-rank-estimate">
                {waiting ? '예상 계급 · 입대 대기' : complete ? '복무 상태 · 전역' : `예상 계급 · ${progress.estimatedRankLabel}`}
              </p>
            ) : (
              <p className="text-caption text-muted-foreground">{waiting ? '복무 준비' : '복무 여정'}</p>
            )}
            <p className="service-journey-level service-journey-level--hero tabular-nums" data-testid="service-level">
              {waiting ? 'Lv.0' : `Lv.${progress.level}`}{complete ? ' · MAX' : ''}
            </p>
            <h2 id={compact ? titleId : 'service-progress-title'} className="service-journey-nickname text-title break-keep">
              {progress.stageLabel}
            </h2>
          </div>
        </div>
        <div className="text-right">
          <p className="text-caption text-muted-foreground">{progress.branchName}</p>
          <p className="text-heading tabular-nums">{complete ? 'D-Day' : waiting ? `${progress.estimatedRanks ? '입대' : '시작'} D-${progress.daysUntilEnlistment}` : `D-${progress.remainingDays}`}</p>
          <p className="text-caption text-muted-foreground" data-testid="service-status">
            {complete ? (progress.estimatedRanks ? '전역했어요' : '복무 완료') : waiting ? (progress.estimatedRanks ? '입대 예정' : '시작 예정') : '복무 중'}
          </p>
        </div>
      </div>

      {waiting && (reduced || paused) && (
        <button type="button" className="service-journey-control press-response mt-3"
          aria-label="현재 복무 현황 확인" title="현재 복무 현황 확인" onClick={() => updateClock(false)}>
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      )}

      {!waiting && !complete && (
        <div className="mt-4 space-y-2" aria-live="off">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">다음 레벨까지 {nextLevelWait}</p>
              <p className="service-journey-exp tabular-nums" data-testid="service-exp-readout">
                <strong>{formatExpNumber(progress.levelExp)}</strong>
                <span className="text-caption text-muted-foreground"> / {formatExpNumber(progress.expPerLevel)} EXP</span>
              </p>
            </div>
            <button
              type="button"
              className="service-journey-control press-response"
              aria-label={reduced ? '현재 EXP 확인' : paused ? 'EXP 실시간 표시 켜기' : 'EXP 실시간 표시 멈추기'}
              title={reduced ? '현재 EXP 확인' : paused ? '실시간 표시 켜기' : '실시간 표시 멈추기'}
              onClick={() => { updateClock(false); if (!reduced) setPaused(value => !value); }}
            >
              {reduced ? <RefreshCw size={16} aria-hidden="true" /> : paused
                ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            </button>
          </div>
          <div className="service-journey-track" role="progressbar" aria-label="다음 레벨 경험치"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(progress.levelExpPercent.toFixed(2))}
            aria-valuetext={`레벨 ${progress.level + 1}까지 ${progress.levelExpPercent.toFixed(1)}%`}>
            <div style={{ width: `${progress.levelExpPercent}%` }} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-caption text-muted-foreground">
            <span>{reduced ? '현재 시각 기준' : paused ? '표시 멈춤' : '1초에 +10 EXP'}</span>
            <span>한 시간에 한 레벨</span>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap justify-between gap-2 text-caption" data-testid="service-progress-summary">
          <span>복무율 {percent}%</span>
          <span>{waiting ? `${progress.estimatedRanks ? '입대' : '시작'}까지 ${progress.daysUntilEnlistment}일` : `${progress.elapsedDays}일 경과 · ${progress.remainingDays}일 남음`}</span>
        </div>
        <div className="service-journey-track service-journey-track--total" role="progressbar"
          aria-label={compact ? '개인 복무 진행률' : `${name} 복무 진행률`} aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={percent} aria-valuetext={`복무율 ${percent}%`}>
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-caption text-muted-foreground">
          <span>{progress.estimatedRanks ? '입대' : '시작'} {formatLocalDate(military!.enlistmentDate!)}</span>
          <span>{progress.estimatedRanks ? '전역' : '완료'} {formatLocalDate(effectiveDischargeDate(military)!)}</span>
        </div>
      </div>

      <details className="service-journey-details mt-3">
        <summary className="min-h-11 cursor-pointer content-center text-caption font-semibold">성장 여정</summary>
        <ol className="service-journey-stages" aria-label="복무 성장 단계">
          {progress.stages.map(stage => (
            <li key={stage.label} aria-current={stage.current ? 'step' : undefined}>
              <span className="service-journey-stop" aria-hidden="true">{stage.past ? <Check size={14} /> : <Flag size={14} />}</span>
              <span className="service-journey-stage-label">
                <span>{stage.label}</span>
                {stage.estimatedRankLabel && <span className="text-caption text-muted-foreground">예상 {stage.estimatedRankLabel}</span>}
              </span>
              <span className="text-caption text-muted-foreground">
                {stage.current ? '현재' : stage.past ? '지나온 단계' : `${Number(stage.percent.toFixed(1))}%`}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-caption text-muted-foreground leading-relaxed">
          한 시간에 한 레벨. 앱을 닫아도 자라요. 칭호/계급은 날짜로 계산한 앱 여정이며 실제 진급·선임 관계와 다를 수 있어요.
        </p>
        {military?.dischargeDateSource === 'manual' && <p className="mt-1 text-caption text-muted-foreground">직접 입력한 전역일 기준</p>}
        {military?.dischargeDateSource === 'calculated' && <p className="mt-1 text-caption text-muted-foreground">자동 계산한 전역일 기준</p>}
      </details>
    </section>
  );
}
