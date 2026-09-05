import type { CollectibleGardenAccessory } from './companionShopLocalState';

export type StarterAccessoryId = 'boots' | 'sneakers' | 'letter' | 'dogtag' | 'plane';

export interface StarterAccessoryOption {
  id: StarterAccessoryId;
  label: string;
}

export const STARTER_ACCESSORY_OPTIONS: readonly StarterAccessoryOption[] = [
  { id: 'boots', label: '검정 부츠' },
  { id: 'sneakers', label: '운동화' },
  { id: 'letter', label: '하트 편지' },
  { id: 'dogtag', label: '메탈 펜던트' },
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
