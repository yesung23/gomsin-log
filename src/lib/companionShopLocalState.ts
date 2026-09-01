import {
  GARDEN_ACCESSORY_OPTIONS,
  loadGardenAccessories,
  type GardenAccessory,
} from './companionGardenLocalState';
import type { PaperTexture } from './paperTexturePreference';

export type CollectibleGardenAccessory = Exclude<GardenAccessory, 'none'>;

export interface CompanionShopState {
  version: 1;
  ownedAccessories: CollectibleGardenAccessory[];
  ownedPapers: PaperTexture[];
  lastFreeDrawDate: string | null;
}

export type DailyAccessoryDrawResult = {
  status: 'drawn' | 'used_today' | 'complete';
  accessory: CollectibleGardenAccessory | null;
  state: CompanionShopState;
};

const KEY_PREFIX = 'gomsin.diary.shop.';
const DEFAULT_PAPERS: readonly PaperTexture[] = ['plain', 'ruled'];
const PAPER_ORDER: readonly PaperTexture[] = ['plain', 'ruled', 'grid', 'dot', 'cream'];
const ACCESSORY_ORDER = GARDEN_ACCESSORY_OPTIONS
  .map(({ id }) => id)
  .filter((id): id is CollectibleGardenAccessory => id !== 'none');
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function uniqueInOrder<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const selected = new Set(values);
  return order.filter((value) => selected.has(value));
}

function normalizePapers(value: unknown): PaperTexture[] {
  const supplied = Array.isArray(value)
    ? value.filter((item): item is PaperTexture => typeof item === 'string' && PAPER_ORDER.includes(item as PaperTexture))
    : [];
  return uniqueInOrder([...DEFAULT_PAPERS, ...supplied], PAPER_ORDER);
}

function normalizeAccessories(value: unknown): CollectibleGardenAccessory[] {
  const supplied = Array.isArray(value)
    ? value.filter((item): item is CollectibleGardenAccessory => (
      typeof item === 'string' && ACCESSORY_ORDER.includes(item as CollectibleGardenAccessory)
    ))
    : [];
  return uniqueInOrder(supplied, ACCESSORY_ORDER);
}

function legacyOwnedAccessories(userId: string): CollectibleGardenAccessory[] {
  const equipped = loadGardenAccessories(userId);
  return normalizeAccessories([equipped.peach, equipped.sage]);
}

function normalizeState(userId: string, value: unknown): CompanionShopState {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const ownedAccessories = uniqueInOrder(
    [
      ...normalizeAccessories(stored.ownedAccessories),
      ...legacyOwnedAccessories(userId),
    ],
    ACCESSORY_ORDER,
  );
  return {
    version: 1,
    ownedAccessories,
    ownedPapers: normalizePapers(stored.ownedPapers),
    lastFreeDrawDate: typeof stored.lastFreeDrawDate === 'string' && DATE_PATTERN.test(stored.lastFreeDrawDate)
      ? stored.lastFreeDrawDate
      : null,
  };
}

export function loadCompanionShopState(userId: string): CompanionShopState {
  if (!userId || typeof localStorage === 'undefined') return normalizeState('', null);
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return normalizeState(userId, null);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>).version !== 1) {
      return normalizeState(userId, null);
    }
    return normalizeState(userId, parsed);
  } catch {
    return normalizeState(userId, null);
  }
}

export function saveCompanionShopState(userId: string, state: CompanionShopState): CompanionShopState {
  const normalized = normalizeState(userId, state);
  if (!userId || typeof localStorage === 'undefined') return normalized;
  try {
    localStorage.setItem(key(userId), JSON.stringify(normalized));
  } catch {
    // Optional local collection state must never block the rest of the app.
  }
  return normalized;
}

export function collectCompanionPaper(userId: string, paper: PaperTexture): CompanionShopState {
  const current = loadCompanionShopState(userId);
  return saveCompanionShopState(userId, {
    ...current,
    ownedPapers: [...current.ownedPapers, paper],
  });
}

export function drawDailyAccessory(
  userId: string,
  localDate: string,
  random: () => number = Math.random,
): DailyAccessoryDrawResult {
  const current = loadCompanionShopState(userId);
  const remaining = ACCESSORY_ORDER.filter((accessory) => !current.ownedAccessories.includes(accessory));
  if (remaining.length === 0) {
    return { status: 'complete', accessory: null, state: current };
  }
  if (current.lastFreeDrawDate === localDate) {
    return { status: 'used_today', accessory: null, state: current };
  }
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999) : 0;
  const accessory = remaining[Math.floor(bounded * remaining.length)];
  const state = saveCompanionShopState(userId, {
    ...current,
    ownedAccessories: [...current.ownedAccessories, accessory],
    lastFreeDrawDate: DATE_PATTERN.test(localDate) ? localDate : current.lastFreeDrawDate,
  });
  return { status: 'drawn', accessory, state };
}

