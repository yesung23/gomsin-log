import { isNativePlatform } from '@/lib/platform';

/**
 * Copy for the OS permissions the media paths need.
 *
 * The same bundle runs as a PWA and inside the two Capacitor shells, and the
 * remedy a user has to perform is different in each: a browser has a site
 * permission panel, a native app has an entry in the system settings app.
 * Telling an Android or iOS user to "check the browser settings" points them at
 * a screen that does not exist, which is how a recoverable permission denial
 * turns into an abandoned feature.
 *
 * The rationale strings are also the in-app justification for the declared
 * permission: `RECORD_AUDIO` in AndroidManifest.xml and
 * `NSMicrophoneUsageDescription` in Info.plist both promise the mic is used only
 * for voice records, and this is where the app keeps that promise visible.
 */

/**
 * Why the app wants the microphone, shown in the composer before recording.
 *
 * Kept short enough to sit inline under the action row, and specific about the
 * two things a user of a private diary actually wants to know: what it is for,
 * and who ends up able to hear it.
 */
export const MICROPHONE_RATIONALE =
  '음성 기록을 만들 때만 마이크를 사용해요. 녹음한 소리는 내 기록에 첨부되고, 공유하지 않으면 상대방에게 전달되지 않아요.';

/** Shown when `getUserMedia({ audio: true })` is rejected. */
export function microphoneDeniedMessage(): string {
  if (isNativePlatform()) {
    return '마이크 권한이 필요해요. 휴대폰 설정 > 곰신로그에서 마이크를 허용해 주세요.';
  }
  return '마이크 권한이 필요해요. 브라우저 설정에서 허용해 주세요.';
}

/** Shown when the platform has no microphone capture API at all. */
export function microphoneUnsupportedMessage(): string {
  if (isNativePlatform()) return '이 기기에서는 음성 녹음을 지원하지 않아요.';
  return '이 브라우저에서는 음성 녹음을 지원하지 않아요.';
}
