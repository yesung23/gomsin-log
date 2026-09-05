import type { GardenCompanionId } from '@/lib/companionGardenLocalState';

export type GardenCharacterSourceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The two upright, visually distinct companions from the approved historical
 * paper-pair sheet. The coral satchel maps to 살구 and the green backpack maps
 * to 초록 so identity is visible in the art instead of relying on text alone.
 */
export const GARDEN_CHARACTER_SOURCE_CROPS: Record<GardenCompanionId, GardenCharacterSourceCrop> = {
  peach: { x: 440, y: 675, width: 175, height: 185 },
  sage: { x: 285, y: 675, width: 175, height: 185 },
};

export function gardenCharacterSourceViewBox(companion: GardenCompanionId): string {
  const { x, y, width, height } = GARDEN_CHARACTER_SOURCE_CROPS[companion];
  return `${x} ${y} ${width} ${height}`;
}
