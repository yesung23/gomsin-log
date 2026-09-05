/**
 * Avatar image preparation and legacy device-local storage.
 * Fresh `me` choices now sync through profileAvatars.ts and migration 089, not
 * these storage helpers. Legacy choices are never uploaded without a new choice.
 * The `couple` illustration still does not sync. All local keys are cleared at
 * sign-out/account deletion and are kept out of the main AppState cache.
 *
 * Avatars never enter `couple-media`: that bucket requires an owned
 * `daily_records` path. Sharing a profile photo must not weaken record RLS.
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
export const MAX_AVATAR_BYTES = 65_536;

/** JPEG rather than PNG; the actual byte limit is checked after encoding. */
const OUTPUT_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.82;

/** Only formats a browser can decode into a canvas. HEIC is excluded deliberately. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Refuse before decoding. A 40 MB original would stall the main thread first. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_DECODED_PIXELS = 64_000_000;
const DECODE_TIMEOUT_MS = 15_000;

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
    if (!Number.isSafeInteger(image.naturalWidth) || !Number.isSafeInteger(image.naturalHeight)
      || image.naturalWidth * image.naturalHeight > MAX_DECODED_PIXELS) {
      return { error: '사진 크기가 너무 커요. 작은 사진으로 골라주세요.' };
    }
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) return { error: '사진을 읽을 수 없어요. 다른 사진을 골라주세요.' };

    const target = Math.min(edge, MAX_EDGE_PX);
    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext('2d');
    if (!context) return { error: '사진을 변환할 수 없어요.' };

    // Centre crop: take the largest square from the middle of the original.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target, target);
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

    let dataUrl = canvas.toDataURL(OUTPUT_TYPE, OUTPUT_QUALITY);
    const maxDataUrlLength = 'data:image/jpeg;base64,'.length + Math.ceil(MAX_AVATAR_BYTES / 3) * 4;
    if (dataUrl.length > maxDataUrlLength) dataUrl = canvas.toDataURL(OUTPUT_TYPE, 0.65);
    if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > maxDataUrlLength) {
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
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (ok) resolve(image);
      else reject(new Error('decode failed'));
    };
    const timer = setTimeout(() => finish(false), DECODE_TIMEOUT_MS);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = src;
  });
}
