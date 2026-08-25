import { registerPlugin } from '@capacitor/core';
import type { OnDeviceSummaryPlugin } from './definitions';

/**
 * The iOS-only on-device summary plugin, registered and TYPED.
 *
 * `registerPlugin` is generic for the same reason as in
 * `@gomsinlog/capacitor-device-keys`: an untyped registration makes every bridge
 * call `any`, so a renamed native method compiles cleanly and fails at runtime
 * on a device.
 *
 * There is deliberately no `web:` implementation. A web fallback here would be a
 * DIFFERENT engine wearing the same name, and the whole point of this feature is
 * that the caller can answer "did the on-device model run, or did the
 * deterministic rules?" The selection happens explicitly in
 * `src/lib/dailySummary/nativeOnDeviceSummary.ts`, which requires
 * `getPlatform() === 'ios'` and otherwise reports `not_ios`.
 */
export const GomsinlogOnDeviceSummary = registerPlugin<OnDeviceSummaryPlugin>(
  'GomsinlogOnDeviceSummary',
);

export * from './definitions';
export default GomsinlogOnDeviceSummary;
