import {
  SANITIZED_PHOTO_MAX_EDGE,
  SANITIZED_PHOTO_MIME,
  SANITIZED_PHOTO_THUMBNAIL_MAX_EDGE,
  sanitizePhotoRenditionsForUpload,
} from '@/lib/imageSanitization';

const MASTER_MAX_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES = 1024 * 1024;

export type PreparedRecordPhotoRendition = {
  file: File;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  sha256: string;
};

export type PreparedRecordPhotoRenditions = {
  screenMaster: PreparedRecordPhotoRendition;
  thumbnail: PreparedRecordPhotoRendition;
};

export type PrepareRecordPhotoRenditionsResult =
  | PreparedRecordPhotoRenditions
  | { error: string };

// Only this preparation path can mint upload inputs. A caller cannot relabel an
// original JPEG as sanitized, or replace the measured file after hashing it.
const preparedRenditions = new WeakMap<PreparedRecordPhotoRendition, 'screen_master' | 'thumbnail'>();

export function isPreparedRecordPhotoRendition(
  value: PreparedRecordPhotoRendition,
  kind: 'screen_master' | 'thumbnail',
): boolean {
  return preparedRenditions.get(value) === kind;
}

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read sanitized photo'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Sanitized photo did not produce bytes'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function sha256(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      reject(new Error('Photo checksum cancelled or timed out'));
    };
    const timer = setTimeout(stop, 10_000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) { stop(); return; }
    void (async () => {
      const bytes = await blobBytes(blob);
      if (signal.aborted) throw new Error('Photo checksum cancelled');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    })().then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    });
  });
}

function validRendition(
  candidate: { file: File; width: number; height: number },
  maxEdge: number,
  maxBytes: number,
): boolean {
  return candidate.file.type === SANITIZED_PHOTO_MIME
    && candidate.file.size > 0
    && candidate.file.size <= maxBytes
    && Number.isSafeInteger(candidate.width)
    && Number.isSafeInteger(candidate.height)
    && candidate.width > 0
    && candidate.height > 0
    && candidate.width <= maxEdge
    && candidate.height <= maxEdge;
}

/** Build 090 descriptors from the same exact sanitized Files later sent to Storage. */
export async function prepareRecordPhotoRenditions(
  original: File,
  isCurrent?: () => boolean,
): Promise<PrepareRecordPhotoRenditionsResult> {
  const controller = new AbortController();
  const checkScope = () => { if (isCurrent && !isCurrent()) controller.abort(); };
  // Store's existing generation check is the authority. No new actor/session
  // lookup is introduced; polling only cancels otherwise uninterruptible codecs.
  const scopeTimer = isCurrent ? setInterval(checkScope, 100) : undefined;
  try {
  checkScope();
  const sanitized = await sanitizePhotoRenditionsForUpload(original, undefined, controller.signal);
  if ('error' in sanitized) return sanitized;
  const { screenMaster, thumbnail } = sanitized;
  if (
    !validRendition(screenMaster, SANITIZED_PHOTO_MAX_EDGE, MASTER_MAX_BYTES)
    || !validRendition(thumbnail, SANITIZED_PHOTO_THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_BYTES)
    || thumbnail.width > screenMaster.width
    || thumbnail.height > screenMaster.height
  ) {
    return { error: '사진 변환 결과를 확인하지 못해 업로드하지 않았어요.' };
  }

    const masterHash = await sha256(screenMaster.file, controller.signal);
    const thumbnailHash = await sha256(thumbnail.file, controller.signal);
    checkScope();
    if (controller.signal.aborted) return { error: '사진 준비가 취소되었어요.' };
    const result = {
      screenMaster: Object.freeze({
        file: screenMaster.file,
        widthPx: screenMaster.width,
        heightPx: screenMaster.height,
        byteSize: screenMaster.file.size,
        sha256: masterHash,
      }),
      thumbnail: Object.freeze({
        file: thumbnail.file,
        widthPx: thumbnail.width,
        heightPx: thumbnail.height,
        byteSize: thumbnail.file.size,
        sha256: thumbnailHash,
      }),
    };
    preparedRenditions.set(result.screenMaster, 'screen_master');
    preparedRenditions.set(result.thumbnail, 'thumbnail');
    return result;
  } catch {
    return { error: '사진 무결성 정보를 만들지 못해 업로드하지 않았어요.' };
  } finally {
    if (scopeTimer !== undefined) clearInterval(scopeTimer);
    controller.abort();
  }
}
