import { describe, expect, it } from 'vitest';

import {
  APPLE_IAP_CATALOG,
  isAssetSaleEligible,
  type GardenAssetManifest,
} from './catalog';

const manifest: GardenAssetManifest = {
  schemaVersion: 1,
  id: 'spring-bench',
  version: 1,
  kind: 'building',
  art: { src: '/assets/spring-bench.webp', width: 400, height: 250, anchorX: 0.5, anchorY: 0.92 },
  placement: { cols: 4, rows: 3, collision: 'interaction' },
  interaction: {
    action: 'sit_pair',
    slots: [
      { x: 0.4, y: 0.72, facing: 'right' },
      { x: 0.6, y: 0.72, facing: 'left' },
    ],
  },
  accessibility: { label: '봄날 벤치', reducedMotionLabel: '두 친구가 앉을 수 있는 봄날 벤치' },
  provenance: {
    rightsRecordId: '40000000-0000-4000-8000-000000000001',
    sha256: 'a'.repeat(64),
  },
};

describe('Apple IAP catalog and rights gate', () => {
  it('contains no price and never models physical book payment as IAP', () => {
    const serialized = JSON.stringify(APPLE_IAP_CATALOG);
    expect(serialized).not.toMatch(/price|physical|shipping|실물|배송/i);
    expect(APPLE_IAP_CATALOG.some((item) => item.type === 'consumable')).toBe(true);
    expect(APPLE_IAP_CATALOG.some((item) => item.type === 'non_consumable')).toBe(true);
    expect(APPLE_IAP_CATALOG.some((item) => item.type === 'auto_renewable')).toBe(true);
  });

  it('keeps every repository product disabled until server catalog and rights review both allow it', () => {
    expect(APPLE_IAP_CATALOG.every((item) => item.repositorySaleState === 'off')).toBe(true);
    expect(isAssetSaleEligible(manifest, { serverSaleState: 'off', rightsState: 'verified' })).toBe(false);
    expect(isAssetSaleEligible(manifest, { serverSaleState: 'on', rightsState: 'rights_hold' })).toBe(false);
    expect(isAssetSaleEligible(manifest, { serverSaleState: 'on', rightsState: 'unknown' })).toBe(false);
    expect(isAssetSaleEligible(manifest, { serverSaleState: 'on', rightsState: 'verified' })).toBe(true);
  });

  it('rejects a manifest with incomplete provenance even when external flags claim it is ready', () => {
    expect(isAssetSaleEligible({
      ...manifest,
      provenance: { rightsRecordId: '', sha256: 'not-a-digest' },
    }, { serverSaleState: 'on', rightsState: 'verified' })).toBe(false);
  });
});
