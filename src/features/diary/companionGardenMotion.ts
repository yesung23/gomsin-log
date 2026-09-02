export interface GardenPoint {
  x: number;
  y: number;
}

export interface GardenSceneSize {
  width: number;
  height: number;
}

export interface GardenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The reduced visible sprite footprint, kept beside the geometry that constrains it. */
export const GARDEN_COMPANION_SIZE = {
  width: 49,
  height: 56,
  gap: 4,
} as const;

/** Percent coordinates within the garden scene. Characters are anchored at their feet. */
export const GARDEN_BOUNDS = {
  minX: 16,
  maxX: 84,
  minY: 48,
  maxY: 80,
} as const;

const DEFAULT_SCENE_SIZE: GardenSceneSize = { width: 320, height: 600 };
const DRAG_Y_BOUNDS = { minY: 28, maxY: 94 } as const;
const GARDEN_SEPARATION_EPSILON_PX = 0.1;

/** Prevent the visual fiction of "walking" by one or two pixels. */
export const GARDEN_MIN_MOVE_DISTANCE = 12;
/** Keep the two companions from occupying the same visual spot on phone widths. */
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

function safeSceneSize(scene: GardenSceneSize): GardenSceneSize {
  return {
    width: Number.isFinite(scene.width) && scene.width > 0 ? scene.width : DEFAULT_SCENE_SIZE.width,
    height: Number.isFinite(scene.height) && scene.height > 0 ? scene.height : DEFAULT_SCENE_SIZE.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Return percentage coordinates that keep the complete rendered control inside the scene.
 * Horizontal bounds include the sprite's half-width; vertical bounds include its bottom-anchored
 * height. The design floor remains conservative so characters do not sit under the helper copy.
 */
export function getPhysicalGardenBounds(
  sceneWidth: number,
  sceneHeight: number,
  yBounds: { minY: number; maxY: number } = DRAG_Y_BOUNDS,
): GardenBounds {
  const scene = safeSceneSize({ width: sceneWidth, height: sceneHeight });
  const horizontalInset = ((GARDEN_COMPANION_SIZE.width / 2 + GARDEN_COMPANION_SIZE.gap / 2) / scene.width) * 100;
  const verticalInset = (GARDEN_COMPANION_SIZE.height / scene.height) * 100;
  const minX = Math.max(GARDEN_BOUNDS.minX, horizontalInset);
  const maxX = Math.min(GARDEN_BOUNDS.maxX, 100 - horizontalInset);
  const boundedMinX = minX <= maxX ? minX : 50;
  const boundedMaxX = minX <= maxX ? maxX : 50;
  const minY = Math.max(yBounds.minY, verticalInset);
  // On a short landscape scene the design floor may be smaller than one sprite.
  // Keep the physical bound authoritative so the body is never intentionally clipped.
  const maxY = Math.max(Math.min(yBounds.maxY, 100), verticalInset);
  return {
    minX: boundedMinX,
    maxX: boundedMaxX,
    minY: Math.min(minY, 100),
    maxY: Math.min(Math.max(maxY, minY), 100),
  };
}

export function companionsOverlap(
  a: GardenPoint,
  b: GardenPoint,
  sceneSize: GardenSceneSize,
  gap = GARDEN_COMPANION_SIZE.gap,
): boolean {
  const scene = safeSceneSize(sceneSize);
  const aCenterX = (a.x / 100) * scene.width;
  const bCenterX = (b.x / 100) * scene.width;
  const aBottom = (a.y / 100) * scene.height;
  const bBottom = (b.y / 100) * scene.height;
  const halfWidth = GARDEN_COMPANION_SIZE.width / 2;
  const aLeft = aCenterX - halfWidth;
  const aRight = aCenterX + halfWidth;
  const bLeft = bCenterX - halfWidth;
  const bRight = bCenterX + halfWidth;
  const aTop = aBottom - GARDEN_COMPANION_SIZE.height;
  const bTop = bBottom - GARDEN_COMPANION_SIZE.height;
  return aLeft < bRight + gap
    && aRight > bLeft - gap
    && aTop < bBottom + gap
    && aBottom > bTop - gap;
}

function isUsefulDestination(
  point: GardenPoint,
  current: GardenPoint,
  other: GardenPoint,
  scene: GardenSceneSize,
): boolean {
  return distance(point, current) >= GARDEN_MIN_MOVE_DISTANCE
    && distance(point, other) >= GARDEN_MIN_COMPANION_DISTANCE
    && !companionsOverlap(point, other, scene);
}

/** Choose the nearest bounded point that does not overlap the other rendered companion. */
export function constrainCompanionPoint(
  point: GardenPoint,
  other: GardenPoint,
  sceneSize: GardenSceneSize,
  bounds = getPhysicalGardenBounds(sceneSize.width, sceneSize.height),
): GardenPoint {
  const scene = safeSceneSize(sceneSize);
  const bounded = {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
  if (!companionsOverlap(bounded, other, scene)) return bounded;

  const horizontalSeparation = ((GARDEN_COMPANION_SIZE.width + GARDEN_COMPANION_SIZE.gap + GARDEN_SEPARATION_EPSILON_PX) / scene.width) * 100;
  const verticalSeparation = ((GARDEN_COMPANION_SIZE.height + GARDEN_COMPANION_SIZE.gap + GARDEN_SEPARATION_EPSILON_PX) / scene.height) * 100;
  const direction = bounded.x >= other.x ? 1 : -1;
  const candidates = [
    { x: other.x + direction * horizontalSeparation, y: bounded.y },
    { x: other.x - direction * horizontalSeparation, y: bounded.y },
    { x: bounded.x, y: other.y + verticalSeparation },
    { x: bounded.x, y: other.y - verticalSeparation },
  ].map((candidate) => ({
    x: clamp(candidate.x, bounds.minX, bounds.maxX),
    y: clamp(candidate.y, bounds.minY, bounds.maxY),
  }));
  const safeCandidate = candidates
    .filter((candidate) => !companionsOverlap(candidate, other, scene))
    .sort((a, b) => distance(a, bounded) - distance(b, bounded))[0];
  return safeCandidate ?? bounded;
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
  sceneSize: GardenSceneSize = DEFAULT_SCENE_SIZE,
): GardenPoint {
  const scene = safeSceneSize(sceneSize);
  const bounds = getPhysicalGardenBounds(scene.width, scene.height, GARDEN_BOUNDS);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = {
      x: between(bounds.minX, bounds.maxX, random),
      y: between(bounds.minY, bounds.maxY, random),
    };
    if (isUsefulDestination(candidate, current, other, scene)) return candidate;
  }

  const ranked = [...FALLBACK_ANCHORS].sort((a, b) => {
    const scoreA = Math.min(distance(a, current), distance(a, other));
    const scoreB = Math.min(distance(b, current), distance(b, other));
    return scoreB - scoreA;
  });
  const safe = ranked
    .map((point) => constrainCompanionPoint(point, other, scene, bounds))
    .find((point) => isUsefulDestination(point, current, other, scene));
  if (safe) return safe;

  // The normal garden geometry always has a safe anchor. This clamp is a final defensive boundary for
  // callers that pass impossible/out-of-range current positions.
  const fallback = ranked[0] ?? { x: 50, y: 64 };
  return {
    x: clamp(fallback.x, bounds.minX, bounds.maxX),
    y: clamp(fallback.y, bounds.minY, bounds.maxY),
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
