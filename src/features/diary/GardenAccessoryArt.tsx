import type { GardenAccessory } from '@/lib/companionGardenLocalState';
import { cn } from '@/lib/utils';
import { isSourceAccessory, SOURCE_ACCESSORY_CROPS } from './gardenAccessoryCrops';
import { GARDEN_ACCESSORY_DISPLAY_ASSETS } from './gardenDisplayAssets';

interface GardenAccessoryArtProps {
  accessory: GardenAccessory;
  className?: string;
  testId?: string;
}

export function GardenAccessoryArt({ accessory, className, testId }: GardenAccessoryArtProps) {
  if (!isSourceAccessory(accessory)) return null;
  const crop = SOURCE_ACCESSORY_CROPS[accessory];
  const displayAsset = GARDEN_ACCESSORY_DISPLAY_ASSETS[accessory];

  return (
    <svg
      data-testid={testId}
      viewBox={`0 0 ${crop.width} ${crop.height}`}
      className={cn('inline-block shrink-0', className)}
      style={{ aspectRatio: crop.aspectRatio }}
      aria-hidden="true"
    >
      <image
        href={displayAsset}
        width={crop.width}
        height={crop.height}
        pointerEvents="none"
        style={{ imageRendering: 'auto' }}
      />
    </svg>
  );
}
