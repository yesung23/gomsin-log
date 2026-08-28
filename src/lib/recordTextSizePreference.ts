export type RecordTextSize = 'small' | 'medium' | 'large';

const KEY_PREFIX = 'gomsin.display.recordTextSize.';

export const RECORD_TEXT_SIZE_DEFAULT: RecordTextSize = 'medium';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadRecordTextSize(userId: string): RecordTextSize {
  if (!userId || typeof localStorage === 'undefined') return RECORD_TEXT_SIZE_DEFAULT;
  try {
    const stored = localStorage.getItem(key(userId));
    return stored === 'small' || stored === 'large' ? stored : RECORD_TEXT_SIZE_DEFAULT;
  } catch {
    return RECORD_TEXT_SIZE_DEFAULT;
  }
}

export function saveRecordTextSize(userId: string, size: RecordTextSize): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(userId), size);
  } catch {
    /* The current session still applies the choice if persistence is unavailable. */
  }
}

export function applyRecordTextSizeAttribute(size: RecordTextSize): void {
  if (typeof document === 'undefined') return;
  if (size === RECORD_TEXT_SIZE_DEFAULT) {
    document.documentElement.removeAttribute('data-record-text-size');
  } else {
    document.documentElement.setAttribute('data-record-text-size', size);
  }
}
