import { useCallback, useState } from 'react';

export const HOME_READING_MODE_STORAGE_KEY = 'gomsin.home.readingMode.v1';

export type HomeReadingMode = 'horizontal' | 'vertical';

type ReadingModeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ReadingModeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readHomeReadingMode(
  storage: ReadingModeStorage | null = browserStorage(),
): HomeReadingMode {
  if (!storage) return 'horizontal';
  try {
    return storage.getItem(HOME_READING_MODE_STORAGE_KEY) === 'vertical'
      ? 'vertical'
      : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

function persistHomeReadingMode(mode: HomeReadingMode, storage: ReadingModeStorage | null) {
  if (!storage) return;
  try {
    storage.setItem(HOME_READING_MODE_STORAGE_KEY, mode);
  } catch {
    // A blocked or full localStorage must never make Home unreadable.
  }
}

export function useHomeReadingMode(storage: ReadingModeStorage | null = browserStorage()) {
  const [mode, setModeState] = useState<HomeReadingMode>(() => readHomeReadingMode(storage));

  const setMode = useCallback((nextMode: HomeReadingMode) => {
    if (nextMode !== 'horizontal' && nextMode !== 'vertical') return;
    setModeState(nextMode);
    persistHomeReadingMode(nextMode, storage);
  }, [storage]);

  return { mode, setMode } as const;
}
