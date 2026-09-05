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

export interface GardenLocalState {
  version: 2;
  planted: boolean;
  accessories: GardenAccessoryState;
}

export const GARDEN_ACCESSORY_OPTIONS: readonly { id: GardenAccessory; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'cap', label: '모자' },
  { id: 'bow', label: '리본' },
  { id: 'scarf', label: '목도리' },
  { id: 'flower', label: '꽃' },
  { id: 'boots', label: '검정 부츠' },
  { id: 'sneakers', label: '운동화' },
  { id: 'letter', label: '하트 편지' },
  { id: 'dogtag', label: '메탈 펜던트' },
  { id: 'plane', label: '종이비행기' },
] as const;

export const DEFAULT_GARDEN_ACCESSORIES: GardenAccessoryState = {
  version: 1,
  peach: 'none',
  sage: 'none',
};

export const DEFAULT_GARDEN_STATE: GardenLocalState = {
  version: 2,
  planted: false,
  accessories: DEFAULT_GARDEN_ACCESSORIES,
};

export const GARDEN_COMPANION_LABELS: Record<GardenCompanionId, string> = {
  peach: '살구',
  sage: '초록',
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

function freshGardenState(): GardenLocalState {
  return {
    version: 2,
    planted: false,
    accessories: freshDefault(),
  };
}

function parseAccessories(value: unknown): GardenAccessoryState {
  if (!value || typeof value !== 'object') return freshDefault();
  const parsed = value as Record<string, unknown>;
  return {
    version: 1,
    peach: validAccessory(parsed.peach),
    sage: validAccessory(parsed.sage),
  };
}

export function loadGardenState(userId: string): GardenLocalState {
  if (!userId || typeof localStorage === 'undefined') return freshGardenState();
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return freshGardenState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return freshGardenState();
    if (parsed.version === 1) {
      return {
        version: 2,
        planted: true,
        accessories: parseAccessories(parsed),
      };
    }
    if (parsed.version !== 2) return freshGardenState();
    return {
      version: 2,
      planted: parsed.planted === true,
      accessories: parseAccessories(parsed.accessories),
    };
  } catch {
    return freshGardenState();
  }
}

export function saveGardenPlanting(userId: string): GardenLocalState {
  if (!userId || typeof localStorage === 'undefined') return freshGardenState();
  const current = loadGardenState(userId);
  if (current.planted) return current;
  const next: GardenLocalState = { ...current, planted: true };
  try {
    const serialized = JSON.stringify(next);
    localStorage.setItem(key(userId), serialized);
    if (localStorage.getItem(key(userId)) !== serialized) return current;
  } catch {
    return current;
  }
  return next;
}

export function loadGardenAccessories(userId: string): GardenAccessoryState {
  return loadGardenState(userId).accessories;
}

export function saveGardenAccessory(
  userId: string,
  companion: GardenCompanionId,
  accessory: GardenAccessory,
): GardenAccessoryState {
  if (!userId || typeof localStorage === 'undefined') return freshDefault();
  const currentState = loadGardenState(userId);
  const next: GardenAccessoryState = {
    ...currentState.accessories,
    [companion]: validAccessory(accessory),
  };
  const nextState: GardenLocalState = {
    ...currentState,
    accessories: next,
  };
  try {
    const serialized = JSON.stringify(nextState);
    localStorage.setItem(key(userId), serialized);
    if (localStorage.getItem(key(userId)) !== serialized) return currentState.accessories;
  } catch {
    // Decoration persistence is deliberately best-effort. It never blocks the garden itself.
    return currentState.accessories;
  }
  return next;
}
