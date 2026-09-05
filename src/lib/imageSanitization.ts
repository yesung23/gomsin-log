/**
 * Privacy-preserving photo preparation.
 *
 * Camera files can contain EXIF metadata such as GPS coordinates, device model
 * and capture time. Re-encoding only the decoded pixels into a fresh canvas
 * removes that source metadata before anything reaches Storage. The resize also
 * keeps mobile uploads and downloads reasonably small.
 */

export const SANITIZED_PHOTO_MIME = 'image/jpeg';
export const SANITIZED_PHOTO_EXTENSION = 'jpg';
export const SANITIZED_PHOTO_MAX_EDGE = 2048;
export const SANITIZED_PHOTO_THUMBNAIL_MAX_EDGE = 640;
export const SANITIZED_PHOTO_QUALITY = 0.84;

/** Refuse unusually large decoded images before drawing them into another buffer. */
export const MAX_DECODED_PHOTO_PIXELS = 40_000_000;
const DECODE_TIMEOUT_MS = 15_000;
const ENCODE_TIMEOUT_MS = 10_000;

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

type Canvas2DLike = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  drawImage: (
    source: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ) => void;
};

type CanvasLike = {
  width: number;
  height: number;
  getContext: (contextId: '2d', options?: CanvasRenderingContext2DSettings) => Canvas2DLike | null;
  toBlob: (callback: BlobCallback, type?: string, quality?: number) => void;
};

export type PhotoSanitizerRuntime = {
  decode: (file: File) => Promise<DecodedPhoto>;
  createCanvas: () => CanvasLike;
};

export type SanitizedPhotoResult =
  | { file: File; ext: typeof SANITIZED_PHOTO_EXTENSION }
  | { error: string };

export type SanitizedPhotoRendition = {
  file: File;
  ext: typeof SANITIZED_PHOTO_EXTENSION;
  width: number;
  height: number;
};

export type SanitizedPhotoRenditionsResult =
  | {
      screenMaster: SanitizedPhotoRendition;
      thumbnail: SanitizedPhotoRendition;
    }
  | { error: string };

export function calculateSanitizedPhotoSize(
  width: number,
  height: number,
  maxEdge = SANITIZED_PHOTO_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function sanitizedPhotoName(_originalName?: string): string {
  return `photo.${SANITIZED_PHOTO_EXTENSION}`;
}

async function decodeWithImageElement(file: File): Promise<DecodedPhoto> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  const release = () => {
    image.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
  };
  image.decoding = 'async';
  image.src = objectUrl;

  try {
    await image.decode();
  } catch (error) {
    release();
    throw error;
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release,
  };
}

async function decodeBrowserPhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Modern browsers apply EXIF orientation while decoding. Only the resulting
      // upright pixels are drawn; the orientation tag itself is not copied.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Safari/WebView support differs for HEIC. The image element can decode
      // formats the ImageBitmap path cannot, so make one safe fallback attempt.
    }
  }
  return decodeWithImageElement(file);
}

const BROWSER_RUNTIME: PhotoSanitizerRuntime = {
  decode: decodeBrowserPhoto,
  createCanvas: () => document.createElement('canvas'),
};

function canvasBlob(canvas: CanvasLike, signal?: AbortSignal): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const finish = (blob: Blob | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(blob);
    };
    const abort = () => finish(null);
    const timer = setTimeout(abort, ENCODE_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try {
      canvas.toBlob(finish, SANITIZED_PHOTO_MIME, SANITIZED_PHOTO_QUALITY);
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

async function renderSanitizedRendition(
  decoded: DecodedPhoto,
  maxEdge: number,
  originalName: string,
  runtime: PhotoSanitizerRuntime,
  signal?: AbortSignal,
): Promise<SanitizedPhotoRendition | null> {
  if (signal?.aborted) return null;
  const size = calculateSanitizedPhotoSize(decoded.width, decoded.height, maxEdge);
  if (size.width === 0 || size.height === 0) return null;

  const canvas = runtime.createCanvas();
  try {
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;

    // JPEG has no transparency. A white background avoids transparent PNG areas
    // becoming black on some WebViews.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(decoded.source, 0, 0, size.width, size.height);

    const blob = await canvasBlob(canvas, signal);
    if (signal?.aborted || !blob || blob.size <= 0 || blob.type !== SANITIZED_PHOTO_MIME) return null;
    return {
      file: new File([blob], sanitizedPhotoName(originalName), {
        type: SANITIZED_PHOTO_MIME,
        lastModified: Date.now(),
      }),
      ext: SANITIZED_PHOTO_EXTENSION,
      width: size.width,
      height: size.height,
    };
  } finally {
    // Resetting both dimensions releases the canvas backing store in browsers.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Decoders cannot always be cancelled. Stop waiting, then release late pixels
 * instead of letting them reach a subsequent upload or retaining the bitmap. */
function boundedDecode(runtime: PhotoSanitizerRuntime, original: File, signal?: AbortSignal): Promise<DecodedPhoto> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const abort = () => {
      timedOut = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('Photo decoding cancelled or timed out'));
    };
    const timer = setTimeout(abort, DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    Promise.resolve().then(() => {
      if (timedOut) throw new Error('Photo decoding cancelled');
      return runtime.decode(original);
    }).then((decoded) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (timedOut) {
        try { decoded.release(); } catch { /* Best-effort decoder cleanup. */ }
      } else resolve(decoded);
    }, (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

function decodedPhotoIsBounded(decoded: DecodedPhoto): boolean {
  const pixelCount = decoded.width * decoded.height;
  return Number.isSafeInteger(pixelCount)
    && pixelCount > 0
    && pixelCount <= MAX_DECODED_PHOTO_PIXELS;
}

/** Decode once, then derive the exact screen master and list thumbnail JPEGs. */
export async function sanitizePhotoRenditionsForUpload(
  original: File,
  runtime: PhotoSanitizerRuntime = BROWSER_RUNTIME,
  signal?: AbortSignal,
): Promise<SanitizedPhotoRenditionsResult> {
  let decoded: DecodedPhoto | null = null;
  try {
    decoded = await boundedDecode(runtime, original, signal);
    if (!decodedPhotoIsBounded(decoded)) {
      return { error: '사진 해상도가 너무 커요. 더 작은 사진을 선택해 주세요.' };
    }

    const screenMaster = await renderSanitizedRendition(
      decoded,
      SANITIZED_PHOTO_MAX_EDGE,
      original.name,
      runtime,
      signal,
    );
    if (!screenMaster) {
      return { error: '사진을 안전하게 변환하지 못했어요. 다른 사진을 선택해 주세요.' };
    }
    const thumbnail = await renderSanitizedRendition(
      decoded,
      SANITIZED_PHOTO_THUMBNAIL_MAX_EDGE,
      original.name,
      runtime,
      signal,
    );
    if (!thumbnail) {
      return { error: '사진을 안전하게 변환하지 못했어요. 다른 사진을 선택해 주세요.' };
    }
    return { screenMaster, thumbnail };
  } catch {
    console.error('[gomsinlog] Photo sanitization failed.');
    return {
      error: '이 사진 형식은 이 기기에서 안전하게 처리하지 못했어요. JPG, PNG 또는 WebP 사진으로 다시 선택해 주세요.',
    };
  } finally {
    decoded?.release();
  }
}

/**
 * Re-encode a photo before upload, stripping EXIF/GPS and limiting dimensions.
 *
 * Failure is intentionally fail-closed: uploading the untouched original would
 * silently reintroduce the location leak this boundary exists to prevent.
 */
export async function sanitizePhotoForUpload(
  original: File,
  runtime: PhotoSanitizerRuntime = BROWSER_RUNTIME,
): Promise<SanitizedPhotoResult> {
  let decoded: DecodedPhoto | null = null;

  try {
    decoded = await boundedDecode(runtime, original);
    if (!decodedPhotoIsBounded(decoded)) {
      return { error: '사진 해상도가 너무 커요. 더 작은 사진을 선택해 주세요.' };
    }
    const rendition = await renderSanitizedRendition(
      decoded,
      SANITIZED_PHOTO_MAX_EDGE,
      original.name,
      runtime,
    );
    if (!rendition) {
      return { error: '사진을 안전하게 변환하지 못했어요. 다른 사진을 선택해 주세요.' };
    }
    return { file: rendition.file, ext: rendition.ext };
  } catch (error) {
    console.error('[gomsinlog] Photo sanitization failed.');
    return {
      error: '이 사진 형식은 이 기기에서 안전하게 처리하지 못했어요. JPG, PNG 또는 WebP 사진으로 다시 선택해 주세요.',
    };
  } finally {
    decoded?.release();
  }
}
