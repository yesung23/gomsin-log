import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * C-2: a permission denial has a different remedy in a browser and in an app.
 *
 * Voice capture is parked until P6, but these strings remain ready for the Web
 * `getUserMedia` / `MediaRecorder` path that will be re-admitted then. The old
 * failure copy said
 *
 *   '마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.'
 *
 * unconditionally. Inside a native app there is no browser and no browser
 * settings screen, so that sentence points the user at something that does not
 * exist, and a recoverable denial becomes an abandoned feature.
 */

const isNativePlatformMock = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatformMock(),
  },
}));

const { MICROPHONE_RATIONALE, microphoneDeniedMessage, microphoneUnsupportedMessage } =
  await import('@/lib/nativePermissions');

describe('microphoneDeniedMessage', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
  });

  it('never tells a native user to open browser settings', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(microphoneDeniedMessage()).not.toContain('브라우저');
  });

  it('names the phone settings and the app instead, so the remedy is findable', () => {
    isNativePlatformMock.mockReturnValue(true);
    const message = microphoneDeniedMessage();
    expect(message).toContain('설정');
    expect(message).toContain('곰신로그');
    expect(message).toContain('마이크');
  });

  it('still says what is wrong, not only where to go', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(microphoneDeniedMessage()).toContain('마이크 권한이 필요해요');
  });

  it('PRESERVATION: on the web it keeps the browser-settings wording', () => {
    expect(microphoneDeniedMessage()).toBe('마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.');
  });

  it('the two platforms really differ, so the branch is not decoration', () => {
    const web = microphoneDeniedMessage();
    isNativePlatformMock.mockReturnValue(true);
    expect(microphoneDeniedMessage()).not.toBe(web);
  });
});

describe('microphoneUnsupportedMessage', () => {
  beforeEach(() => {
    isNativePlatformMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
  });

  it('blames the device on native, where "this browser" is meaningless', () => {
    isNativePlatformMock.mockReturnValue(true);
    expect(microphoneUnsupportedMessage()).toBe('이 기기에서는 음성 녹음을 지원하지 않아요.');
    expect(microphoneUnsupportedMessage()).not.toContain('브라우저');
  });

  it('PRESERVATION: on the web it still blames the browser', () => {
    expect(microphoneUnsupportedMessage()).toBe('이 브라우저에서는 음성 녹음을 지원하지 않아요.');
  });
});

describe('MICROPHONE_RATIONALE', () => {
  it('remains the parked in-app justification for the mic permissions P6 will re-declare', () => {
    expect(MICROPHONE_RATIONALE).toContain('마이크');
    expect(MICROPHONE_RATIONALE).toContain('음성');
  });

  it('answers the two questions a private-diary user actually has', () => {
    // What is it for, and who can hear it.
    expect(MICROPHONE_RATIONALE).toMatch(/기록/);
    expect(MICROPHONE_RATIONALE).toMatch(/공유/);
  });

  it('does not promise anything the app cannot keep', () => {
    // When P6 re-admits voice it will upload to Supabase Storage, so the parked
    // rationale must not claim that audio stays only on-device.
    expect(MICROPHONE_RATIONALE).not.toContain('저장하지 않');
    expect(MICROPHONE_RATIONALE).not.toContain('업로드하지 않');
  });

  it('is short enough to sit inline in the composer', () => {
    expect(MICROPHONE_RATIONALE.length).toBeLessThan(120);
  });

  it('is platform-independent copy, since the rationale is the same everywhere', () => {
    const web = MICROPHONE_RATIONALE;
    isNativePlatformMock.mockReturnValue(true);
    expect(MICROPHONE_RATIONALE).toBe(web);
  });
});
