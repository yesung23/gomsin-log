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
export function purgeDiaryLocalStateForUser(
  userId: string,
  storage?: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>,
): boolean {
  if (!userId || (!storage && typeof localStorage === 'undefined')) return false;
  const target = storage ?? localStorage;
  try {
    const removals: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (!key) continue;
      if (ACCOUNT_SCOPED_PREFIXES.some((prefix) => {
        const accountKey = `${prefix}${userId}`;
        return key === accountKey || key.startsWith(`${accountKey}.`);
      })) {
        removals.push(key);
      }
    }
    for (const key of removals) target.removeItem(key);
    return removals.every((key) => target.getItem(key) === null);
  } catch {
    return false;
  }
}
