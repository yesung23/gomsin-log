import type { Branch, MilitaryInfo } from '@/types';
import { effectiveDischargeDate, type ServiceProgress } from '@/lib/milestones';

/**
 * 곰신로그 복무 EXP 및 은어 기반 복무 레벨 시스템.
 *
 * 핵심 규칙:
 * 1. 1초 = 1 EXP. 총 EXP = 복무 전체 초수. 전역 = 만렙 Lv.200.
 * 2. EXP는 절대 감소하지 않는다 (사망 페널티, HP, 과금, 랭킹 없음).
 * 3. 관계 점수/애정 점수가 아닌 개인 복무 시간의 시각화이다.
 * 4. branch별 참고 복무기간/훈련기간을 사용하되, 사용자가 입력한 실제 전역일을 덮어쓰지 않는다.
 * 5. 군사 행정상 실제 진급일이 아니며 입력 날짜 기반 복무 레벨임을 분명히 한다.
 */

export const SECONDS_PER_DAY = 86400;
export const SERVICE_TIME_ZONE = 'Asia/Seoul';
const SERVICE_TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ServiceTierKey = 'recruit' | 'ilcho' | 'ilkkak' | 'ilmal' | 'sangcho' | 'sangkkak' | 'wanggo';

export interface ServiceTier {
  key: ServiceTierKey;
  level: number;
  label: string;
  description: string;
  minPercent: number;
  isBent: boolean;
  isMax: boolean;
}

/**
 * 사용자가 보는 대표 복무 레벨.
 * 경계는 실제 진급일이 아니라 전체 입력 복무기간을 나눈 진행 구간이다.
 */
export const SERVICE_TIERS: readonly ServiceTier[] = [
  { key: 'recruit', level: 1, label: '신병', description: '복무를 시작한 첫 단계예요.', minPercent: 0, isBent: false, isMax: false },
  { key: 'ilcho', level: 2, label: '일초', description: '첫 고비를 넘기고 흐름을 익히는 단계예요.', minPercent: 10, isBent: false, isMax: false },
  { key: 'ilkkak', level: 3, label: '일꺾', description: '복무 여정의 중간을 향해 달려가는 단계예요.', minPercent: 25, isBent: true, isMax: false },
  { key: 'ilmal', level: 4, label: '일말', description: '초반 복무를 지나 숙련자로 넘어가는 단계예요.', minPercent: 40, isBent: false, isMax: false },
  { key: 'sangcho', level: 5, label: '상초', description: '복무 흐름을 잘 알고 있는 숙련 단계예요.', minPercent: 55, isBent: false, isMax: false },
  { key: 'sangkkak', level: 6, label: '상꺾', description: '전역을 향해 힘차게 꺾어 올라가는 단계예요.', minPercent: 70, isBent: true, isMax: false },
  { key: 'wanggo', level: 7, label: '왕고', description: '복무 여정의 마지막 구간에 도착한 단계예요.', minPercent: 85, isBent: false, isMax: true },
] as const;

export type RankKey = 'trainee' | 'pvt' | 'pfc' | 'cpl' | 'sgt' | 'vet';

export interface ServiceRank {
  key: RankKey;
  label: string;
  en: string;
  bars: number;
}

export const SERVICE_RANKS: readonly ServiceRank[] = [
  { key: 'trainee', label: '훈련병', en: 'TRAINEE', bars: 0 },
  { key: 'pvt', label: '이등병', en: 'PRIVATE', bars: 1 },
  { key: 'pfc', label: '일병', en: 'PFC', bars: 2 },
  { key: 'cpl', label: '상병', en: 'CORPORAL', bars: 3 },
  { key: 'sgt', label: '병장', en: 'SERGEANT', bars: 4 },
  { key: 'vet', label: '예비역', en: 'VETERAN', bars: 4 },
] as const;

export interface BranchSpec {
  name: string;
  totalDays: number;
  trainingDays: number;
}

export const BRANCH_SPECS: Record<Branch, BranchSpec> = {
  army: { name: '육군', totalDays: 547, trainingDays: 35 },
  marine: { name: '해병대', totalDays: 547, trainingDays: 49 },
  navy: { name: '해군', totalDays: 608, trainingDays: 42 },
  airforce: { name: '공군', totalDays: 639, trainingDays: 49 },
  reserve: { name: '상근예비역', totalDays: 547, trainingDays: 35 },
  social_service: { name: '사회복무요원', totalDays: 639, trainingDays: 21 },
  other: { name: '기타', totalDays: 547, trainingDays: 35 },
};

export const PROMO_DAYS = { pfc: 61, cpl: 243, sgt: 425 } as const;

export interface ServicePhase {
  rank: RankKey;
  tag: string;
  d0: number;
  d1: number;
  lv0: number;
  lv1: number;
}

export interface RankRailStop {
  key: RankKey;
  label: string;
  bars: number;
  day: number;
  thresholdPercent: number;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
}

export interface ServiceTierStop {
  key: ServiceTierKey;
  level: number;
  label: string;
  minPercent: number;
  isBent: boolean;
  isMax: boolean;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
}

export interface ServiceExpResult {
  branch: Branch;
  branchName: string;
  totalSec: number;
  totalDays: number;
  elapsedSec: number;
  elapsedDays: number;
  remainingDays: number;
  daysUntilEnlistment: number;
  isDischarged: boolean;
  isBeforeEnlistment: boolean;
  isPreEnlistment: boolean;
  level: number;
  levelBadge: string;
  rank: ServiceRank;
  nextRank: ServiceRank | null;
  tier: ServiceTier;
  nextTier: ServiceTier | null;
  tierExpPercent: number;
  remainingPercentToNextTier: number | null;
  remainingDaysToNextTier: number | null;
  phaseTag: string;
  totalPercent: number; // 0 ~ 100
  rankExpPercent: number; // 0 ~ 100
  levelExpPercent: number; // 0 ~ 100
  intoLevelSec: number;
  secPerLevel: number;
  toNextLevelSec: number;
  toPromoSec: number;
  remainingDaysToNextPromo: number | null;
  todayExp: number; // 0 ~ 86400
  stages: readonly RankRailStop[];
  tierStops: readonly ServiceTierStop[];
  // Backward-compatibility properties
  label: string;
  nextLevel: number | null;
  nextLabel: string | null;
  nextPercent: number | null;
  remainingPercent: number | null;
  remainingDaysToNext: number | null;
}

export type ServiceLevel = ServiceExpResult;

function scaleServiceDay(day: number, totalDays: number, referenceTotalDays: number): number {
  if (totalDays <= 0) return 0;
  const reference = referenceTotalDays > 0 ? referenceTotalDays : totalDays;
  return Math.min(totalDays, (day / reference) * totalDays);
}

interface ServiceCalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseValidServiceDate(dateString: string | undefined): ServiceCalendarDate | null {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** Convert an input calendar date to the fixed Asia/Seoul service timeline. */
export function serviceDateAtMs(dateString: string): number | null {
  const date = parseValidServiceDate(dateString);
  return date
    ? Date.UTC(date.year, date.month - 1, date.day) - SERVICE_TIME_ZONE_OFFSET_MS
    : null;
}

function addServiceDays(dateString: string, days: number): string {
  const date = parseValidServiceDate(dateString);
  if (!date) return dateString;
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return [
    String(result.getUTCFullYear()).padStart(4, '0'),
    String(result.getUTCMonth() + 1).padStart(2, '0'),
    String(result.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function buildPhases(
  trainingDays: number,
  totalDays: number,
  referenceTotalDays: number = totalDays,
): ServicePhase[] {
  const t0 = 0;
  const t1 = scaleServiceDay(1, totalDays, referenceTotalDays);
  const t2 = scaleServiceDay(7, totalDays, referenceTotalDays);
  const t3 = scaleServiceDay(trainingDays, totalDays, referenceTotalDays);
  const t4 = scaleServiceDay(PROMO_DAYS.pfc, totalDays, referenceTotalDays);
  const t5 = scaleServiceDay(PROMO_DAYS.cpl, totalDays, referenceTotalDays);
  const t6 = scaleServiceDay(PROMO_DAYS.sgt, totalDays, referenceTotalDays);
  const t7 = totalDays;

  const phases: ServicePhase[] = [
    { rank: 'trainee', tag: '입영 첫날', d0: t0, d1: t1, lv0: 1, lv1: 10 },
    { rank: 'trainee', tag: '훈련 1주차', d0: t1, d1: Math.max(t1, t2), lv0: 10, lv1: 25 },
    { rank: 'trainee', tag: '수료 준비', d0: Math.max(t1, t2), d1: Math.max(t2, t3), lv0: 25, lv1: 45 },
    { rank: 'pvt', tag: '자대 적응', d0: Math.max(t2, t3), d1: Math.max(t3, t4), lv0: 45, lv1: 60 },
    { rank: 'pfc', tag: '일병 구간', d0: Math.max(t3, t4), d1: Math.max(t4, t5), lv0: 60, lv1: 115 },
    { rank: 'cpl', tag: '상병 구간', d0: Math.max(t4, t5), d1: Math.max(t5, t6), lv0: 115, lv1: 165 },
    { rank: 'sgt', tag: '말년', d0: Math.max(t5, t6), d1: Math.max(t6, t7), lv0: 165, lv1: 200 },
  ];
  return phases.filter((p) => p.d1 > p.d0);
}

export function buildRankRailStops(
  trainingDays: number,
  totalDays: number,
  currentRankKey: RankKey,
  isDischarged: boolean,
  isPreEnlistment: boolean,
  referenceTotalDays: number = totalDays,
): RankRailStop[] {
  const rawStops: Array<{ key: RankKey; label: string; bars: number; day: number }> = [
    { key: 'trainee', label: '훈련병', bars: 0, day: 0 },
    { key: 'pvt', label: '이등병', bars: 1, day: scaleServiceDay(trainingDays, totalDays, referenceTotalDays) },
    { key: 'pfc', label: '일병', bars: 2, day: scaleServiceDay(PROMO_DAYS.pfc, totalDays, referenceTotalDays) },
    { key: 'cpl', label: '상병', bars: 3, day: scaleServiceDay(PROMO_DAYS.cpl, totalDays, referenceTotalDays) },
    { key: 'sgt', label: '병장', bars: 4, day: scaleServiceDay(PROMO_DAYS.sgt, totalDays, referenceTotalDays) },
    { key: 'vet', label: '예비역', bars: 4, day: totalDays },
  ];

  const currentRankIdx = isDischarged
    ? 5
    : isPreEnlistment
    ? -1
    : rawStops.findIndex((s) => s.key === currentRankKey);

  return rawStops.map((stop, idx) => {
    const thresholdPercent = totalDays > 0 ? Math.round((stop.day / totalDays) * 1000) / 10 : 0;
    const isCurrent = idx === currentRankIdx;
    const isPast = isDischarged ? idx < 5 : idx < currentRankIdx;
    const isFuture = !isCurrent && !isPast;
    return {
      key: stop.key,
      label: stop.label,
      bars: stop.bars,
      day: stop.day,
      thresholdPercent,
      isCurrent,
      isPast,
      isFuture,
    };
  });
}

function serviceTierIndex(totalPercent: number): number {
  let index = 0;
  for (let i = 0; i < SERVICE_TIERS.length; i += 1) {
    if (totalPercent >= SERVICE_TIERS[i].minPercent) index = i;
  }
  return index;
}

export function buildServiceTierStops(
  totalPercent: number,
  isDischarged: boolean,
  isPreEnlistment: boolean,
): ServiceTierStop[] {
  const currentIndex = isDischarged ? SERVICE_TIERS.length - 1 : isPreEnlistment ? -1 : serviceTierIndex(totalPercent);

  return SERVICE_TIERS.map((tier, index) => ({
    key: tier.key,
    level: tier.level,
    label: tier.label,
    minPercent: tier.minPercent,
    isBent: tier.isBent,
    isMax: tier.isMax,
    isCurrent: index === currentIndex,
    isPast: index < currentIndex,
    isFuture: index > currentIndex,
  }));
}

/**
 * 순수하고 테스트 가능한 복무 EXP 및 은어 기반 복무 레벨 계산.
 * @param military 복무 정보
 * @param nowMs 주입 가능한 현재 밀리초 타임스탬프 (기본값: Date.now())
 */
export function computeServiceExp(
  military: MilitaryInfo | undefined,
  nowMs: number = Date.now(),
): ServiceExpResult | null {
  if (!military || military.militaryStatus === 'unknown') return null;
  const enlistment = military.enlistmentDate;
  const discharge = effectiveDischargeDate(military);
  if (!enlistment || !discharge) return null;

  const branch = military.branch || 'army';
  const branchSpec = BRANCH_SPECS[branch] ?? BRANCH_SPECS.army;

  const startMs = serviceDateAtMs(enlistment);
  const endMs = serviceDateAtMs(discharge);
  if (startMs === null || endMs === null) return null;

  const totalDays = (endMs - startMs) / (SECONDS_PER_DAY * 1000);
  if (totalDays <= 0) return null;

  const totalSec = totalDays * SECONDS_PER_DAY;
  const elapsedSecRaw = (nowMs - startMs) / 1000;
  const isDischarged = military.militaryStatus === 'discharged' || elapsedSecRaw >= totalSec;
  const isBeforeEnlistment = !isDischarged && elapsedSecRaw < 0;

  const trainingDays = branchSpec.trainingDays;
  const phases = buildPhases(trainingDays, totalDays, branchSpec.totalDays);

  if (isBeforeEnlistment) {
    const daysUntilEnlistment = Math.max(1, Math.ceil(-elapsedSecRaw / SECONDS_PER_DAY));
    const nextRank = SERVICE_RANKS[1]; // 이등병
    const stages = buildRankRailStops(trainingDays, totalDays, 'trainee', false, true, branchSpec.totalDays);
    const tier = SERVICE_TIERS[0];
    const tierStops = buildServiceTierStops(0, false, true);

    return {
      branch,
      branchName: branchSpec.name,
      totalSec,
      totalDays,
      elapsedSec: 0,
      elapsedDays: 0,
      remainingDays: totalDays,
      daysUntilEnlistment,
      isDischarged: false,
      isBeforeEnlistment: true,
      isPreEnlistment: true,
      level: 0,
      levelBadge: '대기',
      rank: { key: 'trainee', label: '입대 대기', en: 'READY', bars: 0 },
      nextRank,
      tier,
      nextTier: tier,
      tierExpPercent: 0,
      remainingPercentToNextTier: 0,
      remainingDaysToNextTier: daysUntilEnlistment,
      phaseTag: '입대 대기',
      totalPercent: 0,
      rankExpPercent: 0,
      levelExpPercent: 0,
      intoLevelSec: 0,
      secPerLevel: 0,
      toNextLevelSec: 0,
      toPromoSec: 0,
      remainingDaysToNextPromo: daysUntilEnlistment,
      todayExp: 0,
      stages,
      tierStops,
      label: '입대 대기',
      nextLevel: 1,
      nextLabel: nextRank.label,
      nextPercent: stages[1]?.thresholdPercent ?? 0,
      remainingPercent: 0,
      remainingDaysToNext: daysUntilEnlistment,
    };
  }

  if (isDischarged) {
    const rank = SERVICE_RANKS[5]; // 예비역
    const stages = buildRankRailStops(trainingDays, totalDays, 'vet', true, false, branchSpec.totalDays);
    const tier = SERVICE_TIERS[SERVICE_TIERS.length - 1];
    const tierStops = buildServiceTierStops(100, true, false);

    return {
      branch,
      branchName: branchSpec.name,
      totalSec,
      totalDays,
      elapsedSec: totalSec,
      elapsedDays: totalDays,
      remainingDays: 0,
      daysUntilEnlistment: 0,
      isDischarged: true,
      isBeforeEnlistment: false,
      isPreEnlistment: false,
      level: 200,
      levelBadge: 'MAX',
      rank,
      nextRank: null,
      tier,
      nextTier: null,
      tierExpPercent: 100,
      remainingPercentToNextTier: null,
      remainingDaysToNextTier: null,
      phaseTag: '복무 완료',
      totalPercent: 100,
      rankExpPercent: 100,
      levelExpPercent: 100,
      intoLevelSec: 0,
      secPerLevel: 0,
      toNextLevelSec: 0,
      toPromoSec: 0,
      remainingDaysToNextPromo: null,
      todayExp: 0,
      stages,
      tierStops,
      label: '전역',
      nextLevel: null,
      nextLabel: null,
      nextPercent: null,
      remainingPercent: null,
      remainingDaysToNext: null,
    };
  }

  // 복무 중 (0 <= elapsedSec < totalSec)
  const elapsedSec = Math.min(Math.max(0, elapsedSecRaw), totalSec);
  const elapsedDays = Math.floor(elapsedSec / SECONDS_PER_DAY);
  const remainingDays = Math.max(0, Math.ceil((totalSec - elapsedSec) / SECONDS_PER_DAY));

  let phase = phases[phases.length - 1];
  for (const p of phases) {
    if (elapsedSec < p.d1 * SECONDS_PER_DAY) {
      phase = p;
      break;
    }
  }

  const pStart = phase.d0 * SECONDS_PER_DAY;
  const pSec = (phase.d1 - phase.d0) * SECONDS_PER_DAY;
  const pLevels = Math.max(1, phase.lv1 - phase.lv0);
  const secPerLevel = pSec / pLevels;

  const exactLevel = phase.lv0 + (elapsedSec - pStart) / secPerLevel;
  const level = Math.min(199, Math.floor(exactLevel));
  const levelBadge = 'Lv.' + level;

  const intoLevelSec = (elapsedSec - pStart) - (level - phase.lv0) * secPerLevel;
  const toNextLevelSec = Math.max(0, secPerLevel - intoLevelSec);
  const levelExpPercent = Math.min(100, Math.max(0, (intoLevelSec / secPerLevel) * 100));

  const rankKey = phase.rank;
  const rank = SERVICE_RANKS.find((r) => r.key === rankKey) ?? SERVICE_RANKS[0];
  const stages = buildRankRailStops(trainingDays, totalDays, rankKey, false, false, branchSpec.totalDays);

  const currentStageIdx = stages.findIndex((s) => s.key === rankKey);
  const nextStage = currentStageIdx >= 0 && currentStageIdx < stages.length - 1 ? stages[currentStageIdx + 1] : null;
  const nextRank = nextStage ? (SERVICE_RANKS.find((r) => r.key === nextStage.key) ?? null) : null;

  // 계급 내 경험치 진행률
  const currentStageDay = stages[currentStageIdx]?.day ?? 0;
  const nextStageDay = nextStage?.day ?? totalDays;
  const rankStartSec = currentStageDay * SECONDS_PER_DAY;
  const rankEndSec = nextStageDay * SECONDS_PER_DAY;
  const rankSpanSec = Math.max(1, rankEndSec - rankStartSec);
  const rankElapsedSec = Math.max(0, elapsedSec - rankStartSec);
  const rankExpPercent = Math.min(100, Math.max(0, (rankElapsedSec / rankSpanSec) * 100));

  const toPromoSec = Math.max(0, rankEndSec - elapsedSec);
  const remainingDaysToNextPromo = nextStage ? Math.max(0, Math.ceil(toPromoSec / SECONDS_PER_DAY)) : null;
  const totalPercent = (elapsedSec / totalSec) * 100;
  const todayExp = elapsedSec % SECONDS_PER_DAY;

  const nextPercent = nextStage?.thresholdPercent ?? null;
  const remainingPercent = nextPercent !== null ? Math.max(0, nextPercent - totalPercent) : null;
  const tierIndex = serviceTierIndex(totalPercent);
  const tier = SERVICE_TIERS[tierIndex];
  const nextTier = SERVICE_TIERS[tierIndex + 1] ?? null;
  const tierStartSec = (tier.minPercent / 100) * totalSec;
  const tierEndSec = nextTier ? (nextTier.minPercent / 100) * totalSec : totalSec;
  const tierSpanSec = Math.max(1, tierEndSec - tierStartSec);
  const tierElapsedSec = Math.max(0, elapsedSec - tierStartSec);
  const tierExpPercent = Math.min(100, Math.max(0, (tierElapsedSec / tierSpanSec) * 100));
  const remainingPercentToNextTier = nextTier ? Math.max(0, nextTier.minPercent - totalPercent) : null;
  const remainingDaysToNextTier = nextTier
    ? Math.max(0, Math.ceil((tierEndSec - elapsedSec) / SECONDS_PER_DAY))
    : null;
  const tierStops = buildServiceTierStops(totalPercent, false, false);

  return {
    branch,
    branchName: branchSpec.name,
    totalSec,
    totalDays,
    elapsedSec,
    elapsedDays,
    remainingDays,
    daysUntilEnlistment: 0,
    isDischarged: false,
    isBeforeEnlistment: false,
    isPreEnlistment: false,
    level,
    levelBadge,
    rank,
    nextRank,
    tier,
    nextTier,
    tierExpPercent,
    remainingPercentToNextTier,
    remainingDaysToNextTier,
    phaseTag: phase.tag,
    totalPercent,
    rankExpPercent,
    levelExpPercent,
    intoLevelSec,
    secPerLevel,
    toNextLevelSec,
    toPromoSec,
    remainingDaysToNextPromo,
    todayExp,
    stages,
    tierStops,
    label: rank.label,
    nextLevel: nextRank ? level + 1 : null,
    nextLabel: nextRank?.label ?? null,
    nextPercent,
    remainingPercent,
    remainingDaysToNext: remainingDaysToNextPromo,
  };
}

/**
 * 기존 computeServiceLevel 호출과의 호환성 래퍼.
 */
export function computeServiceLevel(
  input: MilitaryInfo | ServiceProgress | null | undefined,
  nowMs?: number,
): ServiceLevel | null {
  if (!input) return null;

  if ('enlistmentDate' in input || 'militaryStatus' in input) {
    return computeServiceExp(input as MilitaryInfo, nowMs);
  }

  const progress = input as ServiceProgress;
  const totalDays = progress.totalDays || 547;
  const syntheticMilitary: MilitaryInfo = {
    branch: 'army',
    militaryStatus: progress.isDischarged ? 'discharged' : progress.isBeforeEnlistment ? 'planned' : 'serving',
    enlistmentDate: '2025-01-01',
    expectedDischargeDate: addServiceDays('2025-01-01', totalDays),
    dischargeDateSource: 'calculated',
  };

  const startMs = serviceDateAtMs(syntheticMilitary.enlistmentDate!)!;
  const elapsedSec = (progress.percent / 100) * totalDays * SECONDS_PER_DAY;
  const targetNowMs = progress.isBeforeEnlistment
    ? startMs - (progress.daysUntilEnlistment ?? 1) * SECONDS_PER_DAY * 1000
    : startMs + elapsedSec * 1000;

  return computeServiceExp(syntheticMilitary, targetNowMs);
}

export function formatExpNumber(num: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.floor(num));
}

export function formatExpPercent(pct: number, decimals: number = 4): string {
  return pct.toFixed(decimals) + '%';
}

export function formatShortSpan(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / SECONDS_PER_DAY);
  const h = String(Math.floor((s % SECONDS_PER_DAY) / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const seconds = String(s % 60).padStart(2, '0');
  if (d > 0) return d + '일 ' + h + ':' + m + ':' + seconds;
  return h + ':' + m + ':' + seconds;
}
