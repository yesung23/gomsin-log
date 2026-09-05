export type AppleIapNativeAvailability = {
  signedSaleEnabled: boolean;
  canMakePayments: boolean;
  environment: 'xcode' | 'sandbox' | 'production' | 'unknown';
};

export function appleIapWebSaleFlag(): boolean {
  return import.meta.env.VITE_APPLE_IAP_SALE_ENABLED === 'true';
}

export function canOpenAppleIapSale(input: {
  webSaleEnabled: boolean;
  platform: string;
  native: AppleIapNativeAvailability;
}): boolean {
  return input.webSaleEnabled
    && input.platform === 'ios'
    && input.native.signedSaleEnabled
    && input.native.canMakePayments
    && input.native.environment !== 'unknown';
}
