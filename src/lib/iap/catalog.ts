export type AppleIapProductType = 'non_consumable' | 'consumable' | 'auto_renewable';

export type AppleIapCatalogItem = {
  productId: string;
  type: AppleIapProductType;
  entitlementKey: string | null;
  creditUnits: number;
  repositorySaleState: 'off';
};

/**
 * Identity and grant semantics only. StoreKit is the sole runtime source for
 * display name, description, currency and localized display price.
 */
export const APPLE_IAP_CATALOG: readonly AppleIapCatalogItem[] = [
  {
    productId: 'app.gomsinlog.garden.accessory.starter.v1',
    type: 'non_consumable',
    entitlementKey: 'garden.accessory.starter.v1',
    creditUnits: 0,
    repositorySaleState: 'off',
  },
  {
    productId: 'app.gomsinlog.garden.building.starter.v1',
    type: 'non_consumable',
    entitlementKey: 'garden.building.starter.v1',
    creditUnits: 0,
    repositorySaleState: 'off',
  },
  {
    productId: 'app.gomsinlog.paper.season.spring.v1',
    type: 'non_consumable',
    entitlementKey: 'paper.season.spring.v1',
    creditUnits: 0,
    repositorySaleState: 'off',
  },
  {
    productId: 'app.gomsinlog.book.export.credit.1',
    type: 'consumable',
    entitlementKey: null,
    creditUnits: 1,
    repositorySaleState: 'off',
  },
  {
    productId: 'app.gomsinlog.plus.monthly',
    type: 'auto_renewable',
    entitlementKey: 'plus',
    creditUnits: 0,
    repositorySaleState: 'off',
  },
  {
    productId: 'app.gomsinlog.plus.annual',
    type: 'auto_renewable',
    entitlementKey: 'plus',
    creditUnits: 0,
    repositorySaleState: 'off',
  },
] as const;

export type GardenAssetManifest = {
  schemaVersion: 1;
  id: string;
  version: number;
  kind: 'paper' | 'accessory' | 'decoration' | 'building';
  art: { src: string; width: number; height: number; anchorX: number; anchorY: number };
  placement: { cols: number; rows: number; collision: 'none' | 'solid' | 'interaction' };
  interaction?: {
    action: 'sit_pair' | 'swim_pair' | 'picnic_pair' | 'tea_pair' | 'rest_pair';
    slots: Array<{ x: number; y: number; facing: 'left' | 'right' | 'front' | 'back' }>;
  };
  accessibility: { label: string; reducedMotionLabel: string };
  provenance: { rightsRecordId: string; sha256: string };
};

export function isAssetSaleEligible(
  manifest: GardenAssetManifest,
  state: {
    serverSaleState: 'on' | 'off';
    rightsState: 'verified' | 'rights_hold' | 'unknown';
  },
): boolean {
  return state.serverSaleState === 'on'
    && state.rightsState === 'verified'
    && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(manifest.provenance.rightsRecordId)
    && /^[0-9a-f]{64}$/i.test(manifest.provenance.sha256);
}
