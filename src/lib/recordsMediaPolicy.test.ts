import { describe, expect, it } from 'vitest';
import { MEDIA_ACCEPT, classifyMediaFile } from '@/lib/records';

/**
 * The §12.4 upload gate: photos only until the P6 encrypted media foundation.
 *
 * PRODUCT_V3 §12.3 places audio/video after P6, and §12.4 forbids a quiet
 * plaintext video path before Full User-Content E2EE. This gate is option C of
 * §12.4 (disable the upload path), approved 2026-08-21
 * (PRODUCT_STRATEGY_REDESIGN §1.4). It lives in `classifyMediaFile` because that
 * is the one classifier every accept path crosses — the composer picker, the
 * instant capture, the detail-edit add button, and outbox replay — so no surface
 * can accept what the app will not upload.
 */

describe('the §12.4 media upload gate', () => {
  it('accepts every photo type', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      const result = classifyMediaFile({ type, size: 1024 });
      expect('error' in result, type).toBe(false);
      if (!('error' in result)) expect(result.type).toBe('photo');
    }
  });

  it('refuses every video and audio type with the policy reason, not "unsupported"', () => {
    // A refused-by-policy file deserves a policy message. "지원하지 않는 파일
    // 형식" would read as a bug; this reads as what it is — a deliberate gate
    // that opens when encrypted media storage exists.
    for (const type of [
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav',
    ]) {
      const result = classifyMediaFile({ type, size: 1024 });
      expect('error' in result, type).toBe(true);
      if ('error' in result) {
        expect(result.error, type).toContain('암호화 보관이 준비된 뒤');
        expect(result.error, type).not.toContain('지원하지 않는');
      }
    }
  });

  it('still refuses unknown formats as unknown, not as policy', () => {
    const result = classifyMediaFile({ type: 'application/zip', size: 1024 });
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('지원하지 않는');
  });

  it('offers pickers nothing the classifier would refuse', () => {
    // MEDIA_ACCEPT feeds every <input type="file"> accept list. If it named a
    // video/audio MIME, the OS picker would offer files the very next step
    // rejects — a dead-end the user experiences as a bug.
    expect(MEDIA_ACCEPT).toContain('image/');
    expect(MEDIA_ACCEPT).not.toContain('video/');
    expect(MEDIA_ACCEPT).not.toContain('audio/');
  });
});
