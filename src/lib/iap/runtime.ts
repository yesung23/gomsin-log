import { Capacitor } from '@capacitor/core';
import { GomsinlogStoreKit } from '@gomsinlog/capacitor-storekit';

import { supabase } from '@/lib/supabase';
import { createAppleIapCoordinator } from './coordinator';
import { createAppleIapServerPort, createStoreKitNativePort } from './adapters';
import { appleIapWebSaleFlag, canOpenAppleIapSale } from './saleGate';

const client = supabase;
const coordinator = client
  ? createAppleIapCoordinator({
    native: createStoreKitNativePort(GomsinlogStoreKit),
    server: createAppleIapServerPort({
      invoke: (name, options) => client.functions.invoke(name, options),
    }),
  })
  : null;

function isIosNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

function environment(value: 'xcode' | 'sandbox' | 'production' | 'unknown') {
  return value === 'xcode' ? 'Xcode' as const
    : value === 'sandbox' ? 'Sandbox' as const
      : value === 'production' ? 'Production' as const : null;
}

export async function bindAppleIapAccount(accountId: string): Promise<void> {
  if (!coordinator || !isIosNative()) return;
  const currentEnvironment = environment((await GomsinlogStoreKit.availability()).environment);
  if (!currentEnvironment) throw new Error('E_IAP_ENVIRONMENT_UNKNOWN');
  await coordinator.bindAccount(accountId, currentEnvironment);
}

export function clearAppleIapAccount(): void {
  coordinator?.dispose();
}

export async function restoreApplePurchases(accountId: string): Promise<void> {
  if (!coordinator || !isIosNative()) throw new Error('E_IAP_UNAVAILABLE');
  await coordinator.restorePurchases(accountId);
}

export async function purchaseAppleProduct(accountId: string, productId: string) {
  if (!coordinator || !isIosNative()) return { status: 'sale_closed' as const };
  const availability = await GomsinlogStoreKit.availability();
  const saleOpen = canOpenAppleIapSale({
    webSaleEnabled: appleIapWebSaleFlag(),
    platform: Capacitor.getPlatform(),
    native: availability,
  });
  const currentEnvironment = environment(availability.environment);
  if (!currentEnvironment) return { status: 'sale_closed' as const };
  return coordinator.purchase(accountId, productId, currentEnvironment, saleOpen);
}

export function appleIapSnapshot() {
  return coordinator?.snapshot() ?? {
    accountId: null,
    phase: 'idle' as const,
    entitlements: [],
    exportCredits: 0,
  };
}
