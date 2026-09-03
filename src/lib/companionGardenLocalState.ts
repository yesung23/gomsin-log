export type GardenCompanionId = 'peach' | 'sage';
export type GardenAccessory =
  | 'none'
  | 'cap'
  | 'bow'
  | 'scarf'
  | 'flower'
  | 'boots'
  | 'sneakers'
  | 'letter'
  | 'dogtag'
  | 'plane';

export interface GardenAccessoryState {
  version: 1;
  peach: GardenAccessory;
  sage: GardenAccessory;
}

export const GARDEN_ACCESSORY_OPTIONS: readonly { id: GardenAccessory; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'cap', label: '모자' },
  { id: 'bow', label: '리본' },
  { id: 'scarf', label: '목도리' },
  { id: 'flower', label: '꽃' },
  { id: 'boots', label: '군화' },
  { id: 'sneakers', label: '운동화' },
  { id: 'letter', label: '하트 편지' },
  { id: 'dogtag', label: '군번줄' },
  { id: 'plane', label: '종이비행기' },
] as const;

export const DEFAULT_GARDEN_ACCESSORIES: GardenAccessoryState = {
  version: 1,
  peach: 'none',
  sage: 'none',
};

const VALID_ACCESSORIES = new Set<GardenAccessory>(GARDEN_ACCESSORY_OPTIONS.map(({ id }) => id));
const KEY_PREFIX = 'gomsin.diary.garden.';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function validAccessory(value: unknown): GardenAccessory {
  return typeof value === 'string' && VALID_ACCESSORIES.has(value as GardenAccessory)
    ? value as GardenAccessory
    : 'none';
}

function freshDefault(): GardenAccessoryState {
  return { ...DEFAULT_GARDEN_ACCESSORIES };
}

export function loadGardenAccessories(userId: string): GardenAccessoryState {
  if (!userId || typeof localStorage === 'undefined') return freshDefault();
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return freshDefault();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return freshDefault();
    return {
      version: 1,
      peach: validAccessory(parsed.peach),
      sage: validAccessory(parsed.sage),
    };
  } catch {
    return freshDefault();
  }
}

export function saveGardenAccessory(
  userId: string,
  companion: GardenCompanionId,
  accessory: GardenAccessory,
): GardenAccessoryState {
  if (!userId || typeof localStorage === 'undefined') return freshDefault();
  const current = loadGardenAccessories(userId);
  const next: GardenAccessoryState = {
    ...current,
    [companion]: validAccessory(accessory),
  };
  try {
    const serialized = JSON.stringify(next);
    localStorage.setItem(key(userId), serialized);
    if (localStorage.getItem(key(userId)) !== serialized) return current;
  } catch {
    // Decoration persistence is deliberately best-effort. It never blocks the garden itself.
    return current;
  }
  return next;
}
