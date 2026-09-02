const ACCOUNT_SCOPED_PREFIXES = [
  'gomsin.diary.page.',
  'gomsin.diary.paper.',
  'gomsin.diary.stickers.',
  'gomsin.diary.garden.',
  'gomsin.diary.shop.',
  'gomsin.display.paper.',
] as const;

/**
 * Remove device-local diary metadata that belongs to one authenticated account.
 *
 * This includes legacy sticker placements as well as the newer page/paper metadata.
 * It never touches DailyRecord content; the point is to ensure account-specific
 * decoration identifiers do not survive sign-out/account deletion on a shared device.
 */
export function purgeDiaryLocalStateForUser(userId: string): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    const removals: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (ACCOUNT_SCOPED_PREFIXES.some((prefix) => key.startsWith(`${prefix}${userId}`))) {
        removals.push(key);
      }
    }
    for (const key of removals) localStorage.removeItem(key);
  } catch {
    // Local purge is best-effort in storage-restricted environments; the main store purge still runs.
  }
}
