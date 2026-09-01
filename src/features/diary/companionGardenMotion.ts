export interface GardenPoint {
  x: number;
  y: number;
}

/** Percent coordinates within the garden scene. Characters are anchored at their feet. */
export const GARDEN_BOUNDS = {
  minX: 12,
  maxX: 88,
  minY: 48,
  maxY: 80,
} as const;

/** Prevent the visual fiction of "walking" by one or two pixels. */
export const GARDEN_MIN_MOVE_DISTANCE = 12;
/** Keep the two 64px companions from occupying the same visual spot on phone widths. */
export const GARDEN_MIN_COMPANION_DISTANCE = 16;

const FALLBACK_ANCHORS: readonly GardenPoint[] = [
  { x: 18, y: 56 },
  { x: 30, y: 77 },
  { x: 48, y: 56 },
  { x: 62, y: 78 },
  { x: 84, y: 57 },
  { x: 82, y: 78 },
] as const;

function safeRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function between(min: number, max: number, random: () => number): number {
  return min + (max - min) * safeRandom(random);
}

function distance(a: GardenPoint, b: GardenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isUsefulDestination(point: GardenPoint, current: GardenPoint, other: GardenPoint): boolean {
  return distance(point, current) >= GARDEN_MIN_MOVE_DISTANCE
    && distance(point, other) >= GARDEN_MIN_COMPANION_DISTANCE;
}

/**
 * Pick a new foot position without allowing either friend to leave the garden or stack on the other.
 * Random candidates get the first chance; a deterministic anchor fallback guarantees progress even if
 * an embedded webview supplies a pathological/repeating RNG sequence.
 */
export function pickGardenDestination(
  current: GardenPoint,
  other: GardenPoint,
  random: () => number = Math.random,
): GardenPoint {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = {
      x: between(GARDEN_BOUNDS.minX, GARDEN_BOUNDS.maxX, random),
      y: between(GARDEN_BOUNDS.minY, GARDEN_BOUNDS.maxY, random),
    };
    if (isUsefulDestination(candidate, current, other)) return candidate;
  }

  const ranked = [...FALLBACK_ANCHORS].sort((a, b) => {
    const scoreA = Math.min(distance(a, current), distance(a, other));
    const scoreB = Math.min(distance(b, current), distance(b, other));
    return scoreB - scoreA;
  });
  const safe = ranked.find((point) => isUsefulDestination(point, current, other));
  if (safe) return safe;

  // The normal garden geometry always has a safe anchor. This clamp is a final defensive boundary for
  // callers that pass impossible/out-of-range current positions.
  const fallback = ranked[0] ?? { x: 50, y: 64 };
  return {
    x: Math.max(GARDEN_BOUNDS.minX, Math.min(GARDEN_BOUNDS.maxX, fallback.x)),
    y: Math.max(GARDEN_BOUNDS.minY, Math.min(GARDEN_BOUNDS.maxY, fallback.y)),
  };
}

export function gardenMoveDuration(random: () => number = Math.random): number {
  return Math.round(between(1800, 3600, random));
}

export function gardenPauseDuration(random: () => number = Math.random): number {
  return Math.round(between(600, 1800, random));
}

export function gardenFirstMoveDelay(random: () => number = Math.random): number {
  return Math.round(between(250, 900, random));
}
