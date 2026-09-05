import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DECODED_PHOTO_PIXELS,
  SANITIZED_PHOTO_MAX_EDGE,
  SANITIZED_PHOTO_MIME,
  calculateSanitizedPhotoSize,
  sanitizePhotoForUpload,
  sanitizedPhotoName,
  type PhotoSanitizerRuntime,
} from '@/lib/imageSanitization';

function runtimeFor(
  width: number,
  height: number,
  output: Blob | null = new Blob(['jpeg pixels'], { type: SANITIZED_PHOTO_MIME }),
) {
  const release = vi.fn();
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ fillStyle: '', fillRect, drawImage })),
    toBlob: vi.fn((callback: BlobCallback) => callback(output)),
  };
  const runtime: PhotoSanitizerRuntime = {
    decode: vi.fn(async () => ({
      source: {} as CanvasImageSource,
      width,
      height,
      release,
    })),
    createCanvas: vi.fn(() => canvas),
  };
  return { runtime, canvas, release, drawImage, fillRect };
}

describe('privacy-preserving photo sanitization', () => {
  it('fits photos inside the maximum edge without enlarging', () => {
    expect(calculateSanitizedPhotoSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(calculateSanitizedPhotoSize(1000, 3000)).toEqual({ width: 683, height: 2048 });
    expect(calculateSanitizedPhotoSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(SANITIZED_PHOTO_MAX_EDGE).toBe(2048);
  });

  it('always uses a neutral jpg filename regardless of source basename', () => {
    expect(sanitizedPhotoName('vacation.HEIC')).toBe('photo.jpg');
    expect(sanitizedPhotoName('')).toBe('photo.jpg');
    expect(sanitizedPhotoName('camera.heic')).toBe('photo.jpg');
  });

  it('draws decoded pixels into a fresh JPEG instead of returning the source file', async () => {
    const source = new File(['source bytes with EXIF'], 'vacation.HEIC', { type: 'image/heic' });
    const { runtime, canvas, release, drawImage, fillRect } = runtimeFor(4032, 3024);

    const result = await sanitizePhotoForUpload(source, runtime);

    expect(result).not.toHaveProperty('error');
    const sanitized = result as { file: File; ext: string };
    expect(sanitized.file).not.toBe(source);
    expect(sanitized.file.type).toBe(SANITIZED_PHOTO_MIME);
    expect(sanitized.file.name).toBe('photo.jpg');
    expect(sanitized.file.name).not.toContain('vacation');
    expect(sanitized.file.name).not.toContain('HEIC');
    expect(sanitized.file.name).not.toContain('heic');
    expect(sanitized.ext).toBe('jpg');
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1536);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2048, 1536);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed when decoding is unavailable instead of uploading the original', async () => {
    const runtime: PhotoSanitizerRuntime = {
      decode: vi.fn(async () => { throw new Error('unsupported codec'); }),
      createCanvas: vi.fn(),
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sanitizePhotoForUpload(
      new File(['raw'], 'camera.heic', { type: 'image/heic' }),
      runtime,
    );

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('안전하게 처리');
    expect(runtime.createCanvas).not.toHaveBeenCalled();
  });

  it('rejects an excessive decoded pixel count and still releases the decoder', async () => {
    const edge = Math.ceil(Math.sqrt(MAX_DECODED_PHOTO_PIXELS + 1));
    const { runtime, release, drawImage } = runtimeFor(edge, edge);

    const result = await sanitizePhotoForUpload(
      new File(['raw'], 'huge.jpg', { type: 'image/jpeg' }),
      runtime,
    );

    expect(result).toHaveProperty('error');
    expect(drawImage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails closed when the browser cannot encode a non-empty JPEG', async () => {
    const { runtime, release } = runtimeFor(800, 600, null);
    const result = await sanitizePhotoForUpload(
      new File(['raw'], 'photo.png', { type: 'image/png' }),
      runtime,
    );

    expect(result).toHaveProperty('error');
    expect(release).toHaveBeenCalledOnce();
  });

  it('bounds decoding and releases an image that arrives after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, release } = runtimeFor(4032, 3024);
      let resolve!: (value: Awaited<ReturnType<PhotoSanitizerRuntime['decode']>>) => void;
      runtime.decode = () => new Promise((done) => { resolve = done; });
      const settled = vi.fn();
      void sanitizePhotoForUpload(new File(['raw'], 'photo.jpg'), runtime).then(settled);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(runtime.createCanvas).not.toHaveBeenCalled();
      resolve({ source: {} as CanvasImageSource, width: 4032, height: 3024, release });
      await vi.advanceTimersByTimeAsync(0);
      expect(release).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('bounds a stuck encoder and releases the decoded pixels', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, canvas, release } = runtimeFor(800, 600);
      canvas.toBlob.mockImplementation(() => {});
      const settled = vi.fn();
      void sanitizePhotoForUpload(new File(['raw'], 'photo.jpg'), runtime).then(settled);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(release).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('does not relabel a browser PNG fallback as a JPEG', async () => {
    const { runtime, release } = runtimeFor(800, 600, new Blob(['png'], { type: 'image/png' }));
    const result = await sanitizePhotoForUpload(new File(['raw'], 'photo.jpg'), runtime);
    expect(result).toHaveProperty('error');
    expect(release).toHaveBeenCalledOnce();
  });
});
