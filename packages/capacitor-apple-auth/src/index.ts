import { registerPlugin } from '@capacitor/core';
import type { AppleAuthPlugin } from './definitions';

/** iOS-only by design: web and Android must fail closed before invoking this proxy. */
export const GomsinlogAppleAuth = registerPlugin<AppleAuthPlugin>('GomsinlogAppleAuth');

export type * from './definitions';
export default GomsinlogAppleAuth;
