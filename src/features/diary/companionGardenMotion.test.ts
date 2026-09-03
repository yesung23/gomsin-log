import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GARDEN_FOOTPRINT,
  GARDEN_AUTONOMOUS_DISTANCE_PX,
  GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND,
  GARDEN_BOUNDS,
  GARDEN_CLOSE_ENCOUNTER_DISTANCE_PX,
  GARDEN_COMPANION_SIZE,
  GARDEN_DESTINATION_MEMORY_RADIUS_PX,
  GARDEN_IDLE_DURATION_MS,
  GARDEN_MOVE_DURATION_MS,
  chooseGardenMover,
  companionsOverlap,
  constrainCompanionMove,
  gardenDistancePx,
  gardenFirstMoveDelay,
  gardenMoveDuration,
  gardenPauseDuration,
  getPhysicalGardenBounds,
  isCompanionMoveSafe,
  isGardenGeometryReady,
  pickGardenDestination,
  reconcileGardenPair,
  type GardenCompanionKey,
  type GardenPoint,
} from './companionGardenMotion';

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function expectPointInside(point: GardenPoint, width: number, height: number) {
  const bounds = getPhysicalGardenBounds(width, height, GARDEN_BOUNDS);
  expect(bounds).not.toBeNull();
  expect(point.x).toBeGreaterThanOrEqual(bounds!.minX);
  expect(point.x).toBeLessThanOrEqual(bounds!.maxX);
  expect(point.y).toBeGreaterThanOrEqual(bounds!.minY);
  expect(point.y).toBeLessThanOrEqual(bounds!.maxY);
}

describe('companion garden pair geometry', () => {
  it('keeps the full rendered companion body inside the scene', () => {
    expect(GARDEN_COMPANION_SIZE).toEqual({ width: 72, height: 76, gap: 4 });
    const bounds = getPhysicalGardenBounds(320, 141, GARDEN_BOUNDS);
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBeGreaterThanOrEqual(GARDEN_BOUNDS.minX);
    expect(bounds!.maxX).toBeLessThanOrEqual(GARDEN_BOUNDS.maxX);
    expect(bounds!.minY).toBeLessThanOrEqual(bounds!.maxY);
  });

  it('only treats an actual near-touch as a shy encounter', () => {
    expect(GARDEN_CLOSE_ENCOUNTER_DISTANCE_PX).toBe(88);
    expect(GARDEN_CLOSE_ENCOUNTER_DISTANCE_PX).toBeLessThan(96);
  });

  it('detects overlap using the supplied rendered footprints', () => {
    const scene = { width: 375, height: 600 };
    expect(companionsOverlap(
      { x: 50, y: 70 },
      { x: 50, y: 70 },
      scene,
      4,
      { width: 46, height: 54 },
      { width: 52, height: 58 },
    )).toBe(true);
    expect(companionsOverlap(
      { x: 16, y: 70 },
      { x: 84, y: 70 },
      scene,
      4,
      { width: 46, height: 54 },
      { width: 52, height: 58 },
    )).toBe(false);
  });

  it('rejects a clear endpoint whose swept path crosses the other companion', () => {
    const scene = { width: 320, height: 600 };
    const current = { x: 20, y: 64 };
    const other = { x: 50, y: 64 };
    const destination = { x: 80, y: 64 };

    expect(companionsOverlap(destination, other, scene)).toBe(false);
    expect(isCompanionMoveSafe(current, destination, other, scene)).toBe(false);
  });

  it('rejects a sampled autonomous destination whose swept path crosses the pair', () => {
    const current = { x: 20, y: 64 };
    const other = { x: 50, y: 64 };
    const random = sequence([
      // Long move directly through the other friend.
      0.8, 0,
      // Shorter move back toward the safe left side.
      0.2, 0.5,
    ]);

    const point = pickGardenDestination(current, other, {
      random,
      sceneSize: { width: 320, height: 600 },
    });

    expect(point).not.toBeNull();
    expect(point?.x).toBeLessThan(other.x);
    expect(isCompanionMoveSafe(current, point!, other, { width: 320, height: 600 })).toBe(true);
  });

  it('clips a direct crossing request before collision instead of teleporting through', () => {
    const scene = { width: 320, height: 600 };
    const current = { x: 20, y: 64 };
    const other = { x: 50, y: 64 };
    const next = constrainCompanionMove(current, { x: 80, y: 64 }, other, scene);

    expect(next.x).toBeGreaterThan(current.x);
    expect(next.x).toBeLessThan(other.x);
    expect(companionsOverlap(next, other, scene)).toBe(false);
    expect(isCompanionMoveSafe(current, next, other, scene)).toBe(true);
  });

  it.each([
    { width: 320, height: 600 },
    { width: 430, height: 180 },
    { width: 812, height: 141 },
  ])('atomically reconciles an overlapping pair after resize in $width×$height', (scene) => {
    const pair = reconcileGardenPair(
      { peach: { x: 50, y: 72 }, sage: { x: 50, y: 72 } },
      scene,
      {
        peach: { width: 47, height: 55 },
        sage: { width: 51, height: 57 },
      },
    );

    expect(pair).not.toBeNull();
    expect(companionsOverlap(
      pair!.peach,
      pair!.sage,
      scene,
      GARDEN_COMPANION_SIZE.gap,
      { width: 47, height: 55 },
      { width: 51, height: 57 },
    )).toBe(false);
    expectPointInside(pair!.peach, scene.width, scene.height);
    expectPointInside(pair!.sage, scene.width, scene.height);
  });

  it.each([
    { label: 'zero scene', scene: { width: 0, height: 600 }, footprints: { peach: DEFAULT_GARDEN_FOOTPRINT, sage: DEFAULT_GARDEN_FOOTPRINT } },
    { label: 'non-finite scene', scene: { width: Number.NaN, height: 600 }, footprints: { peach: DEFAULT_GARDEN_FOOTPRINT, sage: DEFAULT_GARDEN_FOOTPRINT } },
    { label: '40x40 impossible scene', scene: { width: 40, height: 40 }, footprints: { peach: DEFAULT_GARDEN_FOOTPRINT, sage: DEFAULT_GARDEN_FOOTPRINT } },
    { label: 'invalid footprint', scene: { width: 375, height: 600 }, footprints: { peach: { width: Number.NaN, height: 56 }, sage: DEFAULT_GARDEN_FOOTPRINT } },
  ])('fails closed when $label cannot hold a safe pair', ({ scene, footprints }) => {
    expect(isGardenGeometryReady(scene, footprints)).toBe(false);
    expect(reconcileGardenPair(
      { peach: { x: 26, y: 78 }, sage: { x: 74, y: 74 } },
      scene,
      footprints,
    )).toBeNull();
    expect(pickGardenDestination(
      { x: 26, y: 78 },
      { x: 74, y: 74 },
      { sceneSize: scene, movingFootprint: footprints.peach, otherFootprint: footprints.sage },
    )).toBeNull();
  });

  it('rejects non-finite pair coordinates instead of treating them as separated', () => {
    const scene = { width: 375, height: 600 };
    const invalid = { x: Number.NaN, y: 78 };

    expect(reconcileGardenPair(
      { peach: invalid, sage: { x: 74, y: 74 } },
      scene,
    )).toBeNull();
    expect(companionsOverlap(invalid, { x: 74, y: 74 }, scene)).toBe(true);
    expect(isCompanionMoveSafe(invalid, { x: 40, y: 70 }, { x: 74, y: 74 }, scene)).toBe(false);
    expect(constrainCompanionMove(invalid, { x: 40, y: 70 }, { x: 74, y: 74 }, scene)).toBeNull();
  });

  it('reports readiness again when a valid rendered geometry replaces an invalid one', () => {
    expect(isGardenGeometryReady(
      { width: 375, height: 600 },
      { peach: DEFAULT_GARDEN_FOOTPRINT, sage: DEFAULT_GARDEN_FOOTPRINT },
    )).toBe(true);
  });

  it.each([0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, -2, 5])(
    'keeps autonomous destinations safe for pathological random=%s',
    (randomValue) => {
      const scene = { width: 320, height: 600 };
      const current = { x: 26, y: 76 };
      const other = { x: 74, y: 72 };
      const point = pickGardenDestination(current, other, {
        random: () => randomValue,
        sceneSize: scene,
      });
      expect(point).not.toBeNull();
      expectPointInside(point!, scene.width, scene.height);
      expect(isCompanionMoveSafe(current, point!, other, scene)).toBe(true);
    },
  );

  it('avoids both of the two most recent destination neighborhoods', () => {
    const scene = { width: 375, height: 600 };
    const current = { x: 26, y: 76 };
    const other = { x: 74, y: 72 };
    const recentDestinations = [{ x: 43, y: 76 }, { x: 26, y: 65 }];
    const point = pickGardenDestination(current, other, {
      random: seededRandom(91),
      sceneSize: scene,
      recentDestinations,
    });

    expect(point).not.toBeNull();
    for (const recent of recentDestinations) {
      expect(gardenDistancePx(point!, recent, scene)).toBeGreaterThanOrEqual(GARDEN_DESTINATION_MEMORY_RADIUS_PX);
    }
  });

  it('returns no destination rather than forcing an unsafe fallback', () => {
    const huge = { width: 96, height: 96 };
    const point = pickGardenDestination(
      { x: 50, y: 96 },
      { x: 50, y: 96 },
      {
        random: () => 0,
        sceneSize: { width: 100, height: 100 },
        movingFootprint: huge,
        otherFootprint: huge,
      },
    );

    expect(point).toBeNull();
  });
});

describe('companion garden low-duty cadence', () => {
  it.each([
    { distance: GARDEN_AUTONOMOUS_DISTANCE_PX.min, random: 0 },
    { distance: 96, random: 0.5 },
    { distance: GARDEN_AUTONOMOUS_DISTANCE_PX.max, random: 0.999999 },
  ])('derives a natural duration and speed for $distance px', ({ distance, random }) => {
    const duration = gardenMoveDuration(distance, () => random);
    const speed = distance / (duration / 1_000);
    expect(duration).toBeGreaterThanOrEqual(GARDEN_MOVE_DURATION_MS.min);
    expect(duration).toBeLessThanOrEqual(GARDEN_MOVE_DURATION_MS.max);
    expect(speed).toBeGreaterThanOrEqual(GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND.min - 0.1);
    expect(speed).toBeLessThanOrEqual(GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND.max + 0.1);
  });

  it('uses mostly 2–5s idle periods with about fifteen percent 6–9s rests', () => {
    const random = seededRandom(2_026_09_03);
    const pauses = Array.from({ length: 10_000 }, () => gardenPauseDuration(random));
    const longRests = pauses.filter((pause) => pause >= GARDEN_IDLE_DURATION_MS.longMin);

    expect(pauses.every((pause) => (
      (pause >= GARDEN_IDLE_DURATION_MS.min && pause <= GARDEN_IDLE_DURATION_MS.max)
      || (pause >= GARDEN_IDLE_DURATION_MS.longMin && pause <= GARDEN_IDLE_DURATION_MS.longMax)
    ))).toBe(true);
    expect(longRests.length / pauses.length).toBeGreaterThanOrEqual(0.14);
    expect(longRests.length / pauses.length).toBeLessThanOrEqual(0.16);
  });

  it('starts with a complete idle period instead of moving immediately', () => {
    for (const value of [0, 0.5, 0.999999]) {
      const delay = gardenFirstMoveDelay(() => value);
      expect(delay).toBeGreaterThanOrEqual(GARDEN_IDLE_DURATION_MS.min);
      expect(delay).toBeLessThanOrEqual(GARDEN_IDLE_DURATION_MS.longMax);
    }
  });

  it('never selects the same companion more than twice in succession', () => {
    const counts = { peach: 0, sage: 0 };
    let lastMover: GardenCompanionKey | null = null;
    let consecutiveMoves = 0;
    const selected: GardenCompanionKey[] = [];

    for (let index = 0; index < 12; index += 1) {
      const mover = chooseGardenMover(lastMover, consecutiveMoves, counts, () => 0);
      consecutiveMoves = mover === lastMover ? consecutiveMoves + 1 : 1;
      lastMover = mover;
      counts[mover] += 1;
      selected.push(mover);
    }

    expect(selected.join(',')).not.toMatch(/(peach,){2}peach|(sage,){2}sage/);
    expect(counts.peach).toBeGreaterThan(0);
    expect(counts.sage).toBeGreaterThan(0);
  });

  it('keeps a seeded 60s pair simulation fair, sparse, safe, and below 45% moving duty', () => {
    const random = seededRandom(0xd2c0ffee);
    const scene = { width: 375, height: 600 };
    const positions = { peach: { x: 26, y: 78 }, sage: { x: 74, y: 74 } };
    const counts = { peach: 0, sage: 0 };
    const recentDestinations: GardenPoint[] = [];
    const movers: GardenCompanionKey[] = [];
    let lastMover: GardenCompanionKey | null = null;
    let consecutiveMoves = 0;
    let elapsed = 0;
    let movingMs = 0;

    while (elapsed < 60_000) {
      elapsed += gardenPauseDuration(random);
      if (elapsed >= 60_000) break;
      const mover = chooseGardenMover(lastMover, consecutiveMoves, counts, random);
      const other: GardenCompanionKey = mover === 'peach' ? 'sage' : 'peach';
      const destination = pickGardenDestination(positions[mover], positions[other], {
        random,
        sceneSize: scene,
        recentDestinations,
      });
      if (!destination) continue;

      const distance = gardenDistancePx(positions[mover], destination, scene);
      const duration = gardenMoveDuration(distance, random);
      expect(distance).toBeGreaterThanOrEqual(GARDEN_AUTONOMOUS_DISTANCE_PX.min - 0.1);
      expect(distance).toBeLessThanOrEqual(GARDEN_AUTONOMOUS_DISTANCE_PX.max + 0.1);
      expect(isCompanionMoveSafe(positions[mover], destination, positions[other], scene)).toBe(true);

      movingMs += Math.min(duration, 60_000 - elapsed);
      elapsed += duration;
      positions[mover] = destination;
      recentDestinations.unshift(destination);
      recentDestinations.splice(2);
      consecutiveMoves = mover === lastMover ? consecutiveMoves + 1 : 1;
      lastMover = mover;
      counts[mover] += 1;
      movers.push(mover);
    }

    expect(movers.length).toBeLessThanOrEqual(12);
    expect(counts.peach).toBeGreaterThanOrEqual(1);
    expect(counts.sage).toBeGreaterThanOrEqual(1);
    expect(movingMs / 60_000).toBeLessThanOrEqual(0.45);
    expect(companionsOverlap(
      positions.peach,
      positions.sage,
      scene,
      GARDEN_COMPANION_SIZE.gap,
      DEFAULT_GARDEN_FOOTPRINT,
      DEFAULT_GARDEN_FOOTPRINT,
    )).toBe(false);
  });
});
