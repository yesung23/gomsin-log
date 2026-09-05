import { registerPlugin } from '@capacitor/core';
import type { StoreKitPlugin } from './definitions';

export const GomsinlogStoreKit = registerPlugin<StoreKitPlugin>('GomsinlogStoreKit');
export type * from './definitions';

export * from './definitions';
export default GomsinlogStoreKit;
