/**
 * 우리 정원의 성장은 로그인 횟수나 미션이 아니라 실제 함께한 시간만 읽는다.
 * 화면은 이 결과를 장식으로 사용할 뿐 관계를 점수화하지 않는다.
 */
export type CompanionGardenStageLevel = 1 | 2 | 3 | 4;

export interface CompanionGardenStageInfo {
  level: CompanionGardenStageLevel;
  name: string;
  copy: string;
  minDays: number;
  maxDays: number | null;
}

export interface AvailableCompanionGardenState {
  isAvailable: true;
  togetherDays: number;
  stage: CompanionGardenStageInfo;
}

export interface UnavailableCompanionGardenState {
  isAvailable: false;
  togetherDays: null;
  stage: null;
}

export type CompanionGardenState = AvailableCompanionGardenState | UnavailableCompanionGardenState;

export const COMPANION_GARDEN_STAGES: readonly CompanionGardenStageInfo[] = [
  {
    level: 1,
    name: '작은 싹',
    copy: '두 사람이 함께 심은 작은 싹이 자라나고 있어요.',
    minDays: 1,
    maxDays: 29,
  },
  {
    level: 2,
    name: '어린 나무',
    copy: '서로의 걸음에 맞추어 푸른 잎이 돋아나고 있어요.',
    minDays: 30,
    maxDays: 99,
  },
  {
    level: 3,
    name: '든든한 나무',
    copy: '함께 보낸 계절만큼 단단한 그늘이 생겨났어요.',
    minDays: 100,
    maxDays: 364,
  },
  {
    level: 4,
    name: '꽃 피는 나무',
    copy: '사계절을 온전히 함께하며 꽃과 열매를 맺었어요.',
    minDays: 365,
    maxDays: null,
  },
] as const;

function interpolateTreeHeight(
  days: number,
  startDay: number,
  endDay: number,
  startHeight: number,
  endHeight: number,
): number {
  const progress = Math.max(0, Math.min(1, (days - startDay) / (endDay - startDay)));
  return Math.round(startHeight + (endHeight - startHeight) * progress);
}

/**
 * The illustration changes at four meaningful milestones, while its visual
 * height grows a little every day inside each stage. Height, rather than width,
 * is the contract because the four original assets have different aspect
 * ratios; a width-only scale could make the one-year tree look shorter.
 */
export function getCompanionGardenTreeHeightPx(togetherDays: number): number {
  const days = Number.isFinite(togetherDays) ? Math.max(1, Math.floor(togetherDays)) : 1;
  if (days <= 29) return interpolateTreeHeight(days, 1, 29, 85, 100);
  if (days <= 99) return interpolateTreeHeight(days, 30, 99, 185, 227);
  if (days <= 364) return interpolateTreeHeight(days, 100, 364, 237, 281);
  return interpolateTreeHeight(days, 365, 730, 284, 304);
}

export function deriveCompanionGardenState(
  togetherDays: number | null | undefined,
): CompanionGardenState {
  if (typeof togetherDays !== 'number' || !Number.isFinite(togetherDays) || togetherDays < 1) {
    return { isAvailable: false, togetherDays: null, stage: null };
  }

  const validDays = Math.floor(togetherDays);
  if (validDays < 1) return { isAvailable: false, togetherDays: null, stage: null };

  const stage = validDays <= 29
    ? COMPANION_GARDEN_STAGES[0]
    : validDays <= 99
      ? COMPANION_GARDEN_STAGES[1]
      : validDays <= 364
        ? COMPANION_GARDEN_STAGES[2]
        : COMPANION_GARDEN_STAGES[3];

  return { isAvailable: true, togetherDays: validDays, stage };
}
