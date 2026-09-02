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

function isValidLocalDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
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
    lastFreeDrawDate: typeof stored.lastFreeDrawDate === 'string' && isValidLocalDate(stored.lastFreeDrawDate)
      ? stored.lastFreeDrawDate
      : null,
  };
}

function persistState(userId: string, state: CompanionShopState): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(state));
  } catch {
    // Optional local collection state must never block the rest of the app.
  }
}

export function loadCompanionShopState(userId: string): CompanionShopState {
  if (!userId || typeof localStorage === 'undefined') return normalizeState('', null);
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) {
      const state = normalizeState(userId, null);
      if (state.ownedAccessories.length > 0) persistState(userId, state);
      return state;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>).version !== 1) {
      const state = normalizeState(userId, null);
      if (state.ownedAccessories.length > 0) persistState(userId, state);
      return state;
    }
    const state = normalizeState(userId, parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(state)) persistState(userId, state);
    return state;
  } catch {
    const state = normalizeState(userId, null);
    if (state.ownedAccessories.length > 0) persistState(userId, state);
    return state;
  }
}

export function saveCompanionShopState(userId: string, state: CompanionShopState): CompanionShopState {
  const normalized = normalizeState(userId, state);
  if (!userId || typeof localStorage === 'undefined') return normalized;
  persistState(userId, normalized);
  return normalized;
}

export function collectCompanionPaper(userId: string, paper: PaperTexture): CompanionShopState {
  const current = loadCompanionShopState(userId);
  if (!userId) return current;
  return saveCompanionShopState(userId, {
    ...current,
    ownedPapers: [...current.ownedPapers, paper],
  });
}

export function collectCompanionAccessory(
  userId: string,
  accessory: CollectibleGardenAccessory,
): CompanionShopState {
  const current = loadCompanionShopState(userId);
  if (!userId || !ACCESSORY_ORDER.includes(accessory) || current.ownedAccessories.includes(accessory)) {
    return current;
  }
  return saveCompanionShopState(userId, {
    ...current,
    ownedAccessories: [...current.ownedAccessories, accessory],
  });
}
