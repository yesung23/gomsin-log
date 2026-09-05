import type { PluginListenerHandle } from '@capacitor/core';

export type StoreEnvironment = 'xcode' | 'sandbox' | 'production' | 'unknown';

export type StoreKitAvailability = {
  signedSaleEnabled: boolean;
  canMakePayments: boolean;
  environment: StoreEnvironment;
};

export type StoreKitProduct = {
  id: string;
  displayName: string;
  description: string;
  displayPrice: string;
  type: 'consumable' | 'non_consumable' | 'auto_renewable' | 'non_renewing';
};

export type StoreKitTransaction = {
  transactionId: string;
  productId: string;
  signedTransactionJws: string;
};

export type StoreKitPurchaseResult =
  | { status: 'success'; transaction: StoreKitTransaction }
  | { status: 'pending' }
  | { status: 'cancelled' };

export interface StoreKitPlugin {
  availability(): Promise<StoreKitAvailability>;
  products(options: { productIds: string[] }): Promise<{ products: StoreKitProduct[] }>;
  purchase(options: { productId: string; appAccountToken: string }): Promise<StoreKitPurchaseResult>;
  sync(): Promise<void>;
  currentEntitlements(): Promise<{ transactions: StoreKitTransaction[] }>;
  finish(options: { transactionId: string }): Promise<{ finished: boolean }>;
  addListener(
    eventName: 'transactionUpdated',
    listener: (transaction: StoreKitTransaction) => void,
  ): Promise<PluginListenerHandle>;
}
