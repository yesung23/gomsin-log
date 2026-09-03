import type { GardenAccessory } from '@/lib/companionGardenLocalState';

export const SOURCE_ACCESSORY_CROPS: Record<
  'boots' | 'sneakers' | 'letter' | 'dogtag' | 'plane',
  { viewBox: string; width: number; height: number; aspectRatio: string }
> = {
  boots: {
    viewBox: '330 506 96 150',
    width: 96,
    height: 150,
    aspectRatio: '96 / 150',
  },
  sneakers: {
    viewBox: '474 506 92 156',
    width: 92,
    height: 156,
    aspectRatio: '92 / 156',
  },
  letter: {
    viewBox: '610 542 134 94',
    width: 134,
    height: 94,
    aspectRatio: '134 / 94',
  },
  dogtag: {
    viewBox: '790 516 72 135',
    width: 72,
    height: 135,
    aspectRatio: '72 / 135',
  },
  plane: {
    viewBox: '1100 530 108 127',
    width: 108,
    height: 127,
    aspectRatio: '108 / 127',
  },
};

export function isSourceAccessory(
  accessory: GardenAccessory,
): accessory is keyof typeof SOURCE_ACCESSORY_CROPS {
  return accessory in SOURCE_ACCESSORY_CROPS;
}
