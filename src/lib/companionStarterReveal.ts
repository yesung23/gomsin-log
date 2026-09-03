import type { CollectibleGardenAccessory } from './companionShopLocalState';

export type StarterAccessoryId = 'boots' | 'sneakers' | 'letter' | 'dogtag' | 'plane';

export interface StarterAccessoryOption {
  id: StarterAccessoryId;
  label: string;
}

export const STARTER_ACCESSORY_OPTIONS: readonly StarterAccessoryOption[] = [
  { id: 'boots', label: '군화' },
  { id: 'sneakers', label: '운동화' },
  { id: 'letter', label: '하트 편지' },
  { id: 'dogtag', label: '군번줄' },
  { id: 'plane', label: '종이비행기' },
] as const;

export const STARTER_ACCESSORY_IDS: readonly StarterAccessoryId[] = STARTER_ACCESSORY_OPTIONS.map(
  (opt) => opt.id,
);

export function getAvailableStarterPool(
  ownedAccessories: readonly (CollectibleGardenAccessory | string)[],
): StarterAccessoryId[] {
  const ownedSet = new Set(ownedAccessories);
  return STARTER_ACCESSORY_IDS.filter((id) => !ownedSet.has(id));
}

export type StarterDrawResult =
  | {
      status: 'drawn';
      item: StarterAccessoryOption;
      remainingCount: number;
    }
  | {
      status: 'complete';
      remainingCount: 0;
    };

export function drawStarterAccessory(
  ownedAccessories: readonly (CollectibleGardenAccessory | string)[],
  random: () => number = Math.random,
): StarterDrawResult {
  const available = getAvailableStarterPool(ownedAccessories);
  if (available.length === 0) {
    return {
      status: 'complete',
      remainingCount: 0,
    };
  }

  let raw = random();
  if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw) || raw < 0) {
    raw = 0;
  }
  if (raw >= 1) {
    raw = 0.9999999999999999;
  }

  const index = Math.min(available.length - 1, Math.max(0, Math.floor(raw * available.length)));
  const chosenId = available[index];
  const item = STARTER_ACCESSORY_OPTIONS.find((opt) => opt.id === chosenId)!;

  return {
    status: 'drawn',
    item,
    remainingCount: available.length - 1,
  };
}
