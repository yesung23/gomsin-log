import paperPairAsset from '@/assets/characters/paper-pair-v1.webp';
import type { GardenAccessory } from '@/lib/companionGardenLocalState';
import { cn } from '@/lib/utils';
import { isSourceAccessory, SOURCE_ACCESSORY_CROPS } from './gardenAccessoryCrops';

interface GardenAccessoryArtProps {
  accessory: GardenAccessory;
  className?: string;
  testId?: string;
}

export function GardenAccessoryArt({ accessory, className, testId }: GardenAccessoryArtProps) {
  if (!isSourceAccessory(accessory)) return null;
  const crop = SOURCE_ACCESSORY_CROPS[accessory];

  return (
    <svg
      data-testid={testId}
      viewBox={crop.viewBox}
      className={cn('inline-block shrink-0', className)}
      style={{ aspectRatio: crop.aspectRatio }}
      aria-hidden="true"
    >
      <image
        href={paperPairAsset}
        width="1254"
        height="1254"
        pointerEvents="none"
        style={{ imageRendering: 'auto' }}
      />
    </svg>
  );
}
