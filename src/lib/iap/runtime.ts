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
let bindingGeneration = 0;

function isIosNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

function environment(value: 'xcode' | 'sandbox' | 'production' | 'unknown') {
  return value === 'xcode' ? 'Xcode' as const
    : value === 'sandbox' ? 'Sandbox' as const
      : value === 'production' ? 'Production' as const : null;
}

export async function bindAppleIapAccount(accountId: string): Promise<void> {
  const expectedGeneration = ++bindingGeneration;
  // Account changes close the old listener immediately. Waiting for StoreKit
  // availability first leaves a window where account A can still emit while B
  // is already the authenticated Supabase session.
  coordinator?.dispose();
  if (!coordinator || !isIosNative()) return;
  const availability = await GomsinlogStoreKit.availability();
  // This await sits outside the coordinator's own generation boundary. Guard
  // it here so an older account cannot bind after a newer request or logout.
  if (bindingGeneration !== expectedGeneration) return;
  const currentEnvironment = environment(availability.environment);
  if (!currentEnvironment) throw new Error('E_IAP_ENVIRONMENT_UNKNOWN');
  await coordinator.bindAccount(accountId, currentEnvironment);
}

export function clearAppleIapAccount(): void {
  bindingGeneration += 1;
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
