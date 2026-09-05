import { describe, expect, it, vi } from 'vitest';
import { prepareRecordPhotoRenditions } from '@/lib/recordPhotoRenditions';
import * as sanitizer from '@/lib/imageSanitization';
import type { SanitizedPhotoRenditionsResult } from '@/lib/imageSanitization';

describe('record photo rendition descriptors', () => {
  it('hashes the exact sanitized master and thumbnail bytes without re-encoding', async () => {
    const sanitize = vi.fn(async (): Promise<SanitizedPhotoRenditionsResult> => ({
      screenMaster: {
        file: new File(['master bytes'], 'photo.jpg', { type: 'image/jpeg' }),
        ext: 'jpg',
        width: 2048,
        height: 1536,
      },
      thumbnail: {
        file: new File(['thumbnail bytes'], 'photo.jpg', { type: 'image/jpeg' }),
        ext: 'jpg',
        width: 640,
        height: 480,
      },
    }));
    const original = new File(['device original'], 'private-place.HEIC', { type: 'image/heic' });

    vi.spyOn(sanitizer, 'sanitizePhotoRenditionsForUpload').mockImplementation(sanitize);
    const result = await prepareRecordPhotoRenditions(original);

    expect(result).toEqual({
      screenMaster: {
        file: expect.any(File),
        widthPx: 2048,
        heightPx: 1536,
        byteSize: 12,
        sha256: '33818390754e7425958f424be2c6cdaf53a38b3bb2912350076b5199ca33dea5',
      },
      thumbnail: {
        file: expect.any(File),
        widthPx: 640,
        heightPx: 480,
        byteSize: 15,
        sha256: 'a16b688dbc3288e0902299c13c944a5f05fc3038c960a86ccf7f33502c903091',
      },
    });
    expect(sanitize).toHaveBeenCalledOnce();
    expect(sanitize).toHaveBeenCalledWith(original, undefined, expect.any(AbortSignal));
    expect((result as { screenMaster: { file: File } }).screenMaster.file.name).toBe('photo.jpg');
    expect(JSON.stringify(result)).not.toContain('private-place');
  });

  it('fails closed when either sanitized rendition violates the frozen bounds', async () => {
    const sanitize = vi.fn(async (): Promise<SanitizedPhotoRenditionsResult> => ({
      screenMaster: {
        file: new File(['master'], 'photo.jpg', { type: 'image/jpeg' }),
        ext: 'jpg',
        width: 2048,
        height: 1536,
      },
      thumbnail: {
        file: new File(['thumbnail'], 'photo.jpg', { type: 'image/jpeg' }),
        ext: 'jpg',
        width: 641,
        height: 480,
      },
    }));

    vi.spyOn(sanitizer, 'sanitizePhotoRenditionsForUpload').mockImplementation(sanitize);
    await expect(prepareRecordPhotoRenditions(
      new File(['source'], 'photo.png', { type: 'image/png' }),
    )).resolves.toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it('cancels a stale scope during the real decoder and closes a late bitmap', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    let finish!: (value: unknown) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    try {
      let current = true;
      const pending = prepareRecordPhotoRenditions(new File(['raw'], 'photo.jpg'), () => current);
      await vi.advanceTimersByTimeAsync(0);
      current = false;
      await vi.advanceTimersByTimeAsync(101);
      const settled = vi.fn();
      void pending.then(settled);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      finish({ width: 4032, height: 3024, close });
      await vi.advanceTimersByTimeAsync(0);
      expect(close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });

  it('bounds stuck checksum work and returns no partially prepared pair', async () => {
    vi.useFakeTimers();
    try {
      const master = new File(['master'], 'photo.jpg', { type: 'image/jpeg' });
      Object.defineProperty(master, 'arrayBuffer', { value: () => new Promise(() => {}) });
      vi.spyOn(sanitizer, 'sanitizePhotoRenditionsForUpload').mockResolvedValue({
        screenMaster: { file: master, ext: 'jpg', width: 800, height: 600 },
        thumbnail: { file: new File(['thumb'], 'photo.jpg', { type: 'image/jpeg' }), ext: 'jpg', width: 640, height: 480 },
      });
      const settled = vi.fn();
      void prepareRecordPhotoRenditions(new File(['raw'], 'photo.jpg')).then(settled);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
