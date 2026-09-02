import { describe, expect, it } from 'vitest';
import {
  GARDEN_BOUNDS,
  GARDEN_MIN_MOVE_DISTANCE,
  GARDEN_MIN_COMPANION_DISTANCE,
  GARDEN_COMPANION_SIZE,
  companionsOverlap,
  constrainCompanionPoint,
  getPhysicalGardenBounds,
  gardenFirstMoveDelay,
  gardenMoveDuration,
  gardenPauseDuration,
  pickGardenDestination,
  type GardenPoint,
} from './companionGardenMotion';

function distance(a: GardenPoint, b: GardenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

describe('companion garden wandering geometry', () => {
  it('keeps the full companion body inside a 320px scene at both horizontal edges', () => {
    expect(GARDEN_BOUNDS.minX).toBe(16);
    expect(GARDEN_BOUNDS.maxX).toBe(84);
  });

  it('derives physical-safe bounds and detects rendered sprite overlap', () => {
    const bounds = getPhysicalGardenBounds(320, 141);
    expect(bounds.minX).toBeGreaterThanOrEqual(16);
    expect(bounds.maxX).toBeLessThanOrEqual(84);
    expect(bounds.minY).toBeLessThanOrEqual(bounds.maxY);
    expect(companionsOverlap({ x: 50, y: 80 }, { x: 50, y: 80 }, { width: 320, height: 141 }, GARDEN_COMPANION_SIZE.gap)).toBe(true);
    expect(companionsOverlap({ x: 16, y: 80 }, { x: 84, y: 80 }, { width: 320, height: 141 }, GARDEN_COMPANION_SIZE.gap)).toBe(false);
  });

  it('escapes an overlapping request in a short 430x180 scene', () => {
    const scene = { width: 430, height: 180 };
    const other = { x: 74, y: 74 };
    const point = constrainCompanionPoint({ x: 74, y: 74 }, other, scene);

    expect(point).not.toEqual(other);
    expect(companionsOverlap(point, other, scene, GARDEN_COMPANION_SIZE.gap)).toBe(false);
  });

  it.each([0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, -2, 5])(
    'keeps destinations inside the safe garden floor for random=%s',
    (randomValue) => {
      const current = { x: 26, y: 76 };
      const other = { x: 74, y: 72 };
      const point = pickGardenDestination(current, other, () => randomValue);
      expect(point.x).toBeGreaterThanOrEqual(GARDEN_BOUNDS.minX);
      expect(point.x).toBeLessThanOrEqual(GARDEN_BOUNDS.maxX);
      expect(point.y).toBeGreaterThanOrEqual(GARDEN_BOUNDS.minY);
      expect(point.y).toBeLessThanOrEqual(GARDEN_BOUNDS.maxY);
    },
  );

  it('rejects a random target that would stack on the other companion', () => {
    const current = { x: 20, y: 60 };
    const other = { x: 50, y: 65 };
    const random = sequence([
      // First candidate lands near the other companion and must be rejected.
      0.50, 0.53,
      // Second candidate is safely away.
      0.92, 0.15,
    ]);
    const point = pickGardenDestination(current, other, random);
    expect(distance(point, other)).toBeGreaterThanOrEqual(GARDEN_MIN_COMPANION_DISTANCE);
    expect(distance(point, current)).toBeGreaterThanOrEqual(GARDEN_MIN_MOVE_DISTANCE);
  });

  it('does not choose tiny fake steps when a useful destination is available', () => {
    const current = { x: 40, y: 66 };
    const other = { x: 76, y: 72 };
    const point = pickGardenDestination(current, other, sequence([0.40, 0.50, 0.10, 0.10]));
    expect(distance(point, current)).toBeGreaterThanOrEqual(GARDEN_MIN_MOVE_DISTANCE);
  });

  it('still returns a safe non-stacking fallback when the RNG repeats the same bad value', () => {
    const current = { x: GARDEN_BOUNDS.minX, y: GARDEN_BOUNDS.minY };
    const other = { x: GARDEN_BOUNDS.minX + 1, y: GARDEN_BOUNDS.minY + 1 };
    const point = pickGardenDestination(current, other, () => 0);
    expect(distance(point, other)).toBeGreaterThanOrEqual(GARDEN_MIN_COMPANION_DISTANCE);
    expect(distance(point, current)).toBeGreaterThanOrEqual(GARDEN_MIN_MOVE_DISTANCE);
    expect(point.x).toBeLessThanOrEqual(GARDEN_BOUNDS.maxX);
    expect(point.y).toBeLessThanOrEqual(GARDEN_BOUNDS.maxY);
  });
});

describe('companion garden wandering timing', () => {
  it.each([0, 0.5, 0.999999])('move duration stays between 1.8s and 3.6s (%s)', (value) => {
    expect(gardenMoveDuration(() => value)).toBeGreaterThanOrEqual(1800);
    expect(gardenMoveDuration(() => value)).toBeLessThanOrEqual(3600);
  });

  it.each([0, 0.5, 0.999999])('pause duration stays between 0.6s and 1.8s (%s)', (value) => {
    expect(gardenPauseDuration(() => value)).toBeGreaterThanOrEqual(600);
    expect(gardenPauseDuration(() => value)).toBeLessThanOrEqual(1800);
  });

  it.each([0, 0.5, 0.999999])('first move starts quickly enough to make the garden visibly alive (%s)', (value) => {
    expect(gardenFirstMoveDelay(() => value)).toBeGreaterThanOrEqual(250);
    expect(gardenFirstMoveDelay(() => value)).toBeLessThanOrEqual(900);
  });
});
