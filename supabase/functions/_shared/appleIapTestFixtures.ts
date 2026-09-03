export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const TOKEN_A = '10000000-0000-4000-8000-00000000000a';
export const TOKEN_B = '10000000-0000-4000-8000-00000000000b';
export const JWS_A = 'header.payload.signature-a';

export const transactionFixture = (overrides: Record<string, unknown> = {}) => ({
  transactionId: '2000000000000001',
  originalTransactionId: '2000000000000001',
  productId: 'app.gomsinlog.paper.season.spring.v1',
  type: 'Non-Consumable',
  appAccountToken: TOKEN_A,
  bundleId: 'app.gomsinlog',
  environment: 'Sandbox',
  purchaseDate: 1_788_400_000_000,
  signedDate: 1_788_400_001_000,
  inAppOwnershipType: 'PURCHASED',
  ...overrides,
});

export const notificationFixture = (overrides: Record<string, unknown> = {}) => ({
  notificationUUID: '30000000-0000-4000-8000-000000000001',
  notificationType: 'REFUND',
  subtype: null,
  signedDate: 1_788_400_002_000,
  environment: 'Sandbox',
  data: { signedTransactionInfo: JWS_A },
  ...overrides,
});
