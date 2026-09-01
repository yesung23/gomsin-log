/**
 * A user-chosen photo for the two decorative avatars: the couple illustration on
 * 우리 and the role glyph on 마이.
 *
 * ## Why this is device-local and not uploaded
 *
 * The `couple-media` bucket cannot hold it. Its storage policies (migration 007)
 * require `coupleId/recordId/...`, and INSERT additionally checks that
 * `daily_records` holds a row whose id is the second path segment and whose owner
 * is the caller. An avatar has no record to belong to, so uploading one would mean
 * widening a policy that exists to stop cross-couple reads. Not worth it for a
 * decoration.
 *
 * ## Why it is kept OUT of the main store
 *
 * `saveState` persists a strict device-preference whitelist for an authenticated
 * user -- `widgetLayout`, `soldierWidgetLayout`, `hasSeenInstallPrompt`, `theme` --
 * and a test asserts that list exactly, because anything else would survive an
 * account purge. Adding image data there would break that guarantee, so avatars get
 * their own key that the purge clears explicitly.
 *
 * ## Consequences the caller has to accept
 *
 * - It does not sync. A photo set on a phone is not visible on a laptop, and the
 *   partner never sees it. The UI says so rather than implying otherwise.
 * - It is cleared by account deletion and by sign-out, through `clearAllAvatars`.
 * - It is stored as a data URL, downscaled hard on the way in, because
 *   `localStorage` is a few MB in total and shared with the rest of the app.
 */

/** Keyed per user so an account switch cannot surface the other person's photo. */
const KEY_PREFIX = 'gomsinlog.avatar.';

export type AvatarSlot = 'couple' | 'me';

/**
 * The longest edge of the stored image, in CSS pixels.
 *
 * Both avatars render at 56px or less, so 256 covers a 3x display with room to
 * spare. The point is the storage budget: a 4000px phone photo as a data URL is
 * several MB on its own and would evict everything else in `localStorage`, or throw
 * `QuotaExceededError` and take the save with it.
 */
const MAX_EDGE_PX = 256;

/** JPEG rather than PNG: a photograph, and quality 0.82 keeps it well under 60 kB. */
const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.82;

/** Only formats a browser can decode into a canvas. HEIC is excluded deliberately. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Refuse before decoding. A 40 MB original would stall the main thread first. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function storageKey(userId: string, slot: AvatarSlot): string {
  return `${KEY_PREFIX}${slot}.${userId}`;
}

export function readAvatar(userId: string | undefined, slot: AvatarSlot): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(storageKey(userId, slot));
  } catch {
    // Private-mode Safari throws on read. An avatar is decoration; fail quiet.
    return null;
  }
}

export function writeAvatar(userId: string | undefined, slot: AvatarSlot, dataUrl: string): boolean {
  if (!userId) return false;
  try {
    localStorage.setItem(storageKey(userId, slot), dataUrl);
    return true;
  } catch (error) {
    console.error('[gomsinlog] Avatar save failed.');
    return false;
  }
}

export function clearAvatar(userId: string | undefined, slot: AvatarSlot): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId, slot));
  } catch {
    // Nothing to recover from: the value is already unreachable.
  }
}

/**
 * Drop every stored avatar, for every user on this device.
 *
 * Wired into the store's purge alongside `clearAllComposerDrafts`. Iterating the
 * whole keyspace rather than deleting two known keys is deliberate: a purge runs
 * when an account is deleted or signed out, and at that moment the id of a
 * PREVIOUS account may be the one still holding a photo.
 */
export function clearAllAvatars(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Storage unavailable; there is nothing persisted to clear.
  }
}

/**
 * Decode, downscale, centre-crop to a square and re-encode.
 *
 * Square because both call sites render inside a circle: letting a 3:4 photo
 * through would show a stretched face, and `object-cover` on the element cannot
 * help once the data URL itself is the wrong shape.
 */
export async function prepareAvatarFile(file: File): Promise<{ dataUrl: string } | { error: string }> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { error: '사진은 JPG, PNG, WebP 형식만 넣을 수 있어요.' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { error: '사진이 너무 커요. 12MB 이하로 골라주세요.' };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) return { error: '사진을 읽을 수 없어요. 다른 사진을 골라주세요.' };

    const target = Math.min(edge, MAX_EDGE_PX);
    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext('2d');
    if (!context) return { error: '사진을 변환할 수 없어요.' };

    // Centre crop: take the largest square from the middle of the original.
    context.drawImage(
      image,
      (image.naturalWidth - edge) / 2,
      (image.naturalHeight - edge) / 2,
      edge,
      edge,
      0,
      0,
      target,
      target,
    );

    const dataUrl = canvas.toDataURL(OUTPUT_TYPE, OUTPUT_QUALITY);
    if (!dataUrl.startsWith('data:image/')) {
      return { error: '사진을 변환할 수 없어요.' };
    }
    return { dataUrl };
  } catch {
    return { error: '사진을 읽을 수 없어요. 다른 사진을 골라주세요.' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode failed'));
    image.src = src;
  });
}
