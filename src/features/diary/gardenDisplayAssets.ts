import accessoryBoots from '@/assets/characters/garden/paper-accessory-boots-v1.webp';
import accessoryDogtag from '@/assets/characters/garden/paper-accessory-dogtag-v1.webp';
import accessoryLetter from '@/assets/characters/garden/paper-accessory-letter-v1.webp';
import accessoryPlane from '@/assets/characters/garden/paper-accessory-plane-v1.webp';
import accessorySneakers from '@/assets/characters/garden/paper-accessory-sneakers-v1.webp';
import companionPeach from '@/assets/characters/garden/paper-companion-peach-v1.webp';
import companionSage from '@/assets/characters/garden/paper-companion-sage-v1.webp';
import type { GardenCompanionId } from '@/lib/companionGardenLocalState';
import type { SOURCE_ACCESSORY_CROPS } from './gardenAccessoryCrops';

/**
 * Transfer-sized display derivatives of the approved source sheet. Character
 * and accessory crops are lossless, while the byte-for-byte source remains in
 * the repository as provenance and is protected by its hash test.
 */
export const GARDEN_CHARACTER_DISPLAY_ASSETS: Record<GardenCompanionId, string> = {
  peach: companionPeach,
  sage: companionSage,
};

export const GARDEN_ACCESSORY_DISPLAY_ASSETS: Record<keyof typeof SOURCE_ACCESSORY_CROPS, string> = {
  boots: accessoryBoots,
  sneakers: accessorySneakers,
  letter: accessoryLetter,
  dogtag: accessoryDogtag,
  plane: accessoryPlane,
};
