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

export interface GardenFootprint {
  width: number;
  height: number;
}

export type GardenCompanionKey = 'peach' | 'sage';
export type GardenPairPoints = Record<GardenCompanionKey, GardenPoint>;
export type GardenPairFootprints = Record<GardenCompanionKey, GardenFootprint>;

export interface GardenDestinationOptions {
  random?: () => number;
  sceneSize?: GardenSceneSize;
  recentDestinations?: readonly GardenPoint[];
  movingFootprint?: GardenFootprint;
  otherFootprint?: GardenFootprint;
}

/** The visible sprite footprint, kept beside the geometry that constrains it. */
export const GARDEN_COMPANION_SIZE = {
  width: 49,
  height: 56,
  gap: 4,
} as const;

export const DEFAULT_GARDEN_FOOTPRINT: GardenFootprint = {
  width: GARDEN_COMPANION_SIZE.width,
  height: GARDEN_COMPANION_SIZE.height,
};

/** Percent coordinates within the garden scene. Characters are anchored at their feet. */
export const GARDEN_BOUNDS = {
  minX: 16,
  maxX: 84,
  minY: 48,
  maxY: 80,
} as const;

export const GARDEN_DIRECT_Y_BOUNDS = { minY: 28, maxY: 94 } as const;
export const GARDEN_AUTONOMOUS_DISTANCE_PX = { min: 52, max: 140 } as const;
export const GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND = { min: 42, max: 58 } as const;
export const GARDEN_MOVE_DURATION_MS = { min: 1_200, max: 3_800 } as const;
export const GARDEN_IDLE_DURATION_MS = {
  min: 2_000,
  max: 5_000,
  longMin: 6_000,
  longMax: 9_000,
  longChance: 0.15,
} as const;
export const GARDEN_DESTINATION_MEMORY_RADIUS_PX = 28;

const DEFAULT_SCENE_SIZE: GardenSceneSize = { width: 320, height: 600 };
const GARDEN_SEPARATION_EPSILON_PX = 0.1;
const GARDEN_PATH_CLIP_CLEARANCE_PX = 0.25;
const FALLBACK_MOVE_DISTANCES_PX = [96, 64, 128, 52, 140] as const;
const FALLBACK_MOVE_ANGLES = [
  0,
  Math.PI,
  -Math.PI / 2,
  Math.PI / 2,
  -Math.PI / 4,
  Math.PI / 4,
  -3 * Math.PI / 4,
  3 * Math.PI / 4,
] as const;

function safeRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function between(min: number, max: number, random: () => number): number {
  return min + (max - min) * safeRandom(random);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFinitePoint(point: GardenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteScene(scene: GardenSceneSize): boolean {
  return isFinitePositive(scene.width) && isFinitePositive(scene.height);
}

function isFiniteFootprint(footprint: GardenFootprint): boolean {
  return isFinitePositive(footprint.width) && isFinitePositive(footprint.height);
}

function isFiniteBounds(bounds: GardenBounds): boolean {
  return Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxY)
    && bounds.minX <= bounds.maxX
    && bounds.minY <= bounds.maxY;
}

function isFiniteYBounds(yBounds: { minY: number; maxY: number }): boolean {
  return Number.isFinite(yBounds.minY)
    && Number.isFinite(yBounds.maxY)
    && yBounds.minY >= 0
    && yBounds.maxY <= 100
    && yBounds.minY <= yBounds.maxY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPoint(point: GardenPoint, bounds: GardenBounds): GardenPoint {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

function toScenePixels(point: GardenPoint, scene: GardenSceneSize): GardenPoint {
  return {
    x: (point.x / 100) * scene.width,
    y: (point.y / 100) * scene.height,
  };
}

export function gardenDistancePx(
  a: GardenPoint,
  b: GardenPoint,
  sceneSize: GardenSceneSize,
): number {
  if (!isFiniteScene(sceneSize) || !isFinitePoint(a) || !isFinitePoint(b)) {
    return Number.POSITIVE_INFINITY;
  }
  const aPx = toScenePixels(a, sceneSize);
  const bPx = toScenePixels(b, sceneSize);
  return Math.hypot(aPx.x - bPx.x, aPx.y - bPx.y);
}

/** Keep the complete rendered footprint inside the scene and the design's usable floor. */
export function getPhysicalGardenBounds(
  sceneWidth: number,
  sceneHeight: number,
  yBounds: { minY: number; maxY: number } = GARDEN_DIRECT_Y_BOUNDS,
  footprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
): GardenBounds | null {
  const scene = { width: sceneWidth, height: sceneHeight };
  if (!isFiniteScene(scene) || !isFiniteFootprint(footprint) || !isFiniteYBounds(yBounds)) {
    return null;
  }
  const horizontalInset = ((footprint.width / 2 + GARDEN_COMPANION_SIZE.gap / 2) / scene.width) * 100;
  const verticalInset = (footprint.height / scene.height) * 100;
  if (!Number.isFinite(horizontalInset) || !Number.isFinite(verticalInset) || verticalInset > 100) {
    return null;
  }
  const minX = Math.max(GARDEN_BOUNDS.minX, horizontalInset);
  const maxX = Math.min(GARDEN_BOUNDS.maxX, 100 - horizontalInset);
  const minY = Math.max(yBounds.minY, verticalInset);
  // In short landscape scenes the sprite height is authoritative over the visual floor.
  const maxY = Math.max(Math.min(yBounds.maxY, 100), verticalInset);
  const bounds = { minX, maxX, minY, maxY: Math.min(maxY, 100) };
  return isFiniteBounds(bounds) ? bounds : null;
}

export function companionsOverlap(
  a: GardenPoint,
  b: GardenPoint,
  sceneSize: GardenSceneSize,
  gap = GARDEN_COMPANION_SIZE.gap,
  aFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
  bFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
): boolean {
  if (!isFiniteScene(sceneSize)
    || !isFinitePoint(a)
    || !isFinitePoint(b)
    || !isFiniteFootprint(aFootprint)
    || !isFiniteFootprint(bFootprint)
    || !Number.isFinite(gap)
    || gap < 0) return true;
  const aAnchor = toScenePixels(a, sceneSize);
  const bAnchor = toScenePixels(b, sceneSize);
  const aLeft = aAnchor.x - aFootprint.width / 2;
  const aRight = aAnchor.x + aFootprint.width / 2;
  const bLeft = bAnchor.x - bFootprint.width / 2;
  const bRight = bAnchor.x + bFootprint.width / 2;
  const aTop = aAnchor.y - aFootprint.height;
  const bTop = bAnchor.y - bFootprint.height;
  return aLeft < bRight + gap
    && aRight > bLeft - gap
    && aTop < bAnchor.y + gap
    && aAnchor.y > bTop - gap;
}

/** True only when finite rendered geometry can contain both complete, separated companions. */
export function isGardenGeometryReady(
  sceneSize: GardenSceneSize,
  footprints: GardenPairFootprints = {
    peach: DEFAULT_GARDEN_FOOTPRINT,
    sage: DEFAULT_GARDEN_FOOTPRINT,
  },
  yBounds: { minY: number; maxY: number } = GARDEN_DIRECT_Y_BOUNDS,
): boolean {
  if (!isFiniteScene(sceneSize)
    || !isFiniteFootprint(footprints.peach)
    || !isFiniteFootprint(footprints.sage)
    || !isFiniteYBounds(yBounds)) return false;
  const peachBounds = getPhysicalGardenBounds(
    sceneSize.width,
    sceneSize.height,
    yBounds,
    footprints.peach,
  );
  const sageBounds = getPhysicalGardenBounds(
    sceneSize.width,
    sceneSize.height,
    yBounds,
    footprints.sage,
  );
  if (!peachBounds || !sageBounds) return false;
  const corners = (bounds: GardenBounds): GardenPoint[] => [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
  ];
  return corners(peachBounds).some((peach) => corners(sageBounds).some((sage) => (
    !companionsOverlap(
      peach,
      sage,
      sceneSize,
      GARDEN_COMPANION_SIZE.gap,
      footprints.peach,
      footprints.sage,
    )
  )));
}

interface SegmentIntersection {
  entry: number;
  exit: number;
}

function sweptPathIntersection(
  start: GardenPoint,
  end: GardenPoint,
  other: GardenPoint,
  sceneSize: GardenSceneSize,
  movingFootprint: GardenFootprint,
  otherFootprint: GardenFootprint,
  gap: number,
): SegmentIntersection | null {
  const scene = sceneSize;
  const movingSize = movingFootprint;
  const otherSize = otherFootprint;
  const from = toScenePixels(start, scene);
  const to = toScenePixels(end, scene);
  const obstacle = toScenePixels(other, scene);
  const clearance = gap + GARDEN_SEPARATION_EPSILON_PX;
  const minX = obstacle.x - (movingSize.width + otherSize.width) / 2 - clearance;
  const maxX = obstacle.x + (movingSize.width + otherSize.width) / 2 + clearance;
  const minY = obstacle.y - otherSize.height - clearance;
  const maxY = obstacle.y + movingSize.height + clearance;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let entry = 0;
  let exit = 1;

  for (const [origin, delta, min, max] of [
    [from.x, dx, minX, maxX],
    [from.y, dy, minY, maxY],
  ] as const) {
    if (Math.abs(delta) < Number.EPSILON) {
      if (origin <= min || origin >= max) return null;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry >= exit) return null;
  }

  if (exit <= 0 || entry >= 1) return null;
  const clippedEntry = Math.max(0, entry);
  const clippedExit = Math.min(1, exit);
  return clippedEntry < clippedExit ? { entry: clippedEntry, exit: clippedExit } : null;
}

export function isCompanionMoveSafe(
  start: GardenPoint,
  end: GardenPoint,
  other: GardenPoint,
  sceneSize: GardenSceneSize,
  movingFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
  otherFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
  gap = GARDEN_COMPANION_SIZE.gap,
): boolean {
  if (!isFiniteScene(sceneSize)
    || !isFinitePoint(start)
    || !isFinitePoint(end)
    || !isFinitePoint(other)
    || !isFiniteFootprint(movingFootprint)
    || !isFiniteFootprint(otherFootprint)
    || !Number.isFinite(gap)
    || gap < 0) return false;
  return !companionsOverlap(end, other, sceneSize, gap, movingFootprint, otherFootprint)
    && sweptPathIntersection(
      start,
      end,
      other,
      sceneSize,
      movingFootprint,
      otherFootprint,
      gap,
    ) === null;
}

function separationCandidates(
  requested: GardenPoint,
  other: GardenPoint,
  sceneSize: GardenSceneSize,
  bounds: GardenBounds,
  movingFootprint: GardenFootprint,
  otherFootprint: GardenFootprint,
): GardenPoint[] {
  const scene = sceneSize;
  const movingSize = movingFootprint;
  const otherSize = otherFootprint;
  const xOffset = (((movingSize.width + otherSize.width) / 2
    + GARDEN_COMPANION_SIZE.gap + GARDEN_SEPARATION_EPSILON_PX) / scene.width) * 100;
  const aboveOffset = ((otherSize.height
    + GARDEN_COMPANION_SIZE.gap + GARDEN_SEPARATION_EPSILON_PX) / scene.height) * 100;
  const belowOffset = ((movingSize.height
    + GARDEN_COMPANION_SIZE.gap + GARDEN_SEPARATION_EPSILON_PX) / scene.height) * 100;
  const xs = [other.x - xOffset, other.x + xOffset];
  const ys = [other.y - aboveOffset, other.y + belowOffset];
  const candidates = [
    ...xs.map((x) => ({ x, y: requested.y })),
    ...ys.map((y) => ({ x: requested.x, y })),
    ...xs.flatMap((x) => ys.map((y) => ({ x, y }))),
  ].map((point) => clampPoint(point, bounds));

  return candidates
    .filter((point, index) => candidates.findIndex((candidate) => (
      Math.abs(candidate.x - point.x) < 0.0001 && Math.abs(candidate.y - point.y) < 0.0001
    )) === index)
    .filter((point) => !companionsOverlap(
      point,
      other,
      scene,
      GARDEN_COMPANION_SIZE.gap,
      movingSize,
      otherSize,
    ))
    .sort((a, b) => gardenDistancePx(a, requested, scene) - gardenDistancePx(b, requested, scene));
}

/**
 * Clip direct input at the first collision. A single large pointer delta therefore cannot teleport
 * through the other companion; callers may either use the clipped point or treat no movement as a
 * rejected action.
 */
export function constrainCompanionMove(
  current: GardenPoint,
  requested: GardenPoint,
  other: GardenPoint,
  sceneSize: GardenSceneSize,
  bounds: GardenBounds | null = getPhysicalGardenBounds(sceneSize.width, sceneSize.height),
  movingFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
  otherFootprint: GardenFootprint = DEFAULT_GARDEN_FOOTPRINT,
): GardenPoint | null {
  if (!isFiniteScene(sceneSize)
    || !isFinitePoint(current)
    || !isFinitePoint(requested)
    || !isFinitePoint(other)
    || !isFiniteFootprint(movingFootprint)
    || !isFiniteFootprint(otherFootprint)
    || !bounds
    || !isFiniteBounds(bounds)) return null;
  const scene = sceneSize;
  const start = clampPoint(current, bounds);
  const target = clampPoint(requested, bounds);
  if (isCompanionMoveSafe(start, target, other, scene, movingFootprint, otherFootprint)) return target;

  const intersection = sweptPathIntersection(
    start,
    target,
    other,
    scene,
    movingFootprint,
    otherFootprint,
    GARDEN_COMPANION_SIZE.gap,
  );
  if (!intersection || intersection.entry <= 0) return start;
  const pathLength = gardenDistancePx(start, target, scene);
  if (pathLength <= GARDEN_PATH_CLIP_CLEARANCE_PX) return start;
  const safeProgress = Math.max(0, intersection.entry - GARDEN_PATH_CLIP_CLEARANCE_PX / pathLength);
  const clipped = clampPoint({
    x: start.x + (target.x - start.x) * safeProgress,
    y: start.y + (target.y - start.y) * safeProgress,
  }, bounds);
  return isCompanionMoveSafe(start, clipped, other, scene, movingFootprint, otherFootprint)
    ? clipped
    : start;
}

/** Clamp and separate both companions as one state update after live geometry changes. */
export function reconcileGardenPair(
  pair: GardenPairPoints,
  sceneSize: GardenSceneSize,
  footprints: GardenPairFootprints = {
    peach: DEFAULT_GARDEN_FOOTPRINT,
    sage: DEFAULT_GARDEN_FOOTPRINT,
  },
  yBounds: { minY: number; maxY: number } = GARDEN_BOUNDS,
): GardenPairPoints | null {
  if (!isFinitePoint(pair.peach)
    || !isFinitePoint(pair.sage)
    || !isGardenGeometryReady(sceneSize, footprints, yBounds)) return null;
  const scene = sceneSize;
  const sizes = footprints;
  const bounds = {
    peach: getPhysicalGardenBounds(scene.width, scene.height, yBounds, sizes.peach),
    sage: getPhysicalGardenBounds(scene.width, scene.height, yBounds, sizes.sage),
  };
  if (!bounds.peach || !bounds.sage) return null;
  const clamped: GardenPairPoints = {
    peach: clampPoint(pair.peach, bounds.peach),
    sage: clampPoint(pair.sage, bounds.sage),
  };
  if (!companionsOverlap(
    clamped.peach,
    clamped.sage,
    scene,
    GARDEN_COMPANION_SIZE.gap,
    sizes.peach,
    sizes.sage,
  )) return clamped;

  const candidates: Array<{ pair: GardenPairPoints; displacement: number }> = [];
  for (const peach of separationCandidates(
    clamped.peach,
    clamped.sage,
    scene,
    bounds.peach,
    sizes.peach,
    sizes.sage,
  )) {
    candidates.push({
      pair: { peach, sage: clamped.sage },
      displacement: gardenDistancePx(peach, clamped.peach, scene),
    });
  }
  for (const sage of separationCandidates(
    clamped.sage,
    clamped.peach,
    scene,
    bounds.sage,
    sizes.sage,
    sizes.peach,
  )) {
    candidates.push({
      pair: { peach: clamped.peach, sage },
      displacement: gardenDistancePx(sage, clamped.sage, scene),
    });
  }

  const grid = (value: GardenBounds): GardenPoint[] => {
    const xs = [value.minX, (value.minX + value.maxX) / 2, value.maxX];
    const ys = [value.minY, (value.minY + value.maxY) / 2, value.maxY];
    return xs.flatMap((x) => ys.map((y) => ({ x, y })));
  };
  for (const peach of grid(bounds.peach)) {
    for (const sage of grid(bounds.sage)) {
      if (companionsOverlap(
        peach,
        sage,
        scene,
        GARDEN_COMPANION_SIZE.gap,
        sizes.peach,
        sizes.sage,
      )) continue;
      candidates.push({
        pair: { peach, sage },
        displacement: gardenDistancePx(peach, clamped.peach, scene)
          + gardenDistancePx(sage, clamped.sage, scene),
      });
    }
  }

  candidates.sort((a, b) => a.displacement - b.displacement);
  return candidates[0]?.pair ?? null;
}

function destinationIsUseful(
  point: GardenPoint,
  current: GardenPoint,
  other: GardenPoint,
  scene: GardenSceneSize,
  recentDestinations: readonly GardenPoint[],
  movingFootprint: GardenFootprint,
  otherFootprint: GardenFootprint,
): boolean {
  const moveDistance = gardenDistancePx(point, current, scene);
  return moveDistance >= GARDEN_AUTONOMOUS_DISTANCE_PX.min - GARDEN_SEPARATION_EPSILON_PX
    && moveDistance <= GARDEN_AUTONOMOUS_DISTANCE_PX.max + GARDEN_SEPARATION_EPSILON_PX
    && recentDestinations.slice(0, 2).every((recent) => (
      gardenDistancePx(point, recent, scene) >= GARDEN_DESTINATION_MEMORY_RADIUS_PX
    ))
    && isCompanionMoveSafe(
      current,
      point,
      other,
      scene,
      movingFootprint,
      otherFootprint,
    );
}

function polarDestination(
  current: GardenPoint,
  distancePx: number,
  angle: number,
  scene: GardenSceneSize,
  bounds: GardenBounds,
): GardenPoint {
  const currentPx = toScenePixels(current, scene);
  return clampPoint({
    x: ((currentPx.x + Math.cos(angle) * distancePx) / scene.width) * 100,
    y: ((currentPx.y + Math.sin(angle) * distancePx) / scene.height) * 100,
  }, bounds);
}

/** Pick a bounded, non-repeating destination whose complete swept path is pair-safe. */
export function pickGardenDestination(
  current: GardenPoint,
  other: GardenPoint,
  options: GardenDestinationOptions = {},
): GardenPoint | null {
  const random = options.random ?? Math.random;
  const scene = options.sceneSize ?? DEFAULT_SCENE_SIZE;
  const recent = options.recentDestinations ?? [];
  const movingSize = options.movingFootprint ?? DEFAULT_GARDEN_FOOTPRINT;
  const otherSize = options.otherFootprint ?? DEFAULT_GARDEN_FOOTPRINT;
  if (!isFinitePoint(current)
    || !isFinitePoint(other)
    || recent.some((point) => !isFinitePoint(point))
    || !isGardenGeometryReady(
      scene,
      { peach: movingSize, sage: otherSize },
      GARDEN_BOUNDS,
    )) return null;
  const bounds = getPhysicalGardenBounds(scene.width, scene.height, GARDEN_BOUNDS, movingSize);
  if (!bounds) return null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const distancePx = between(
      GARDEN_AUTONOMOUS_DISTANCE_PX.min,
      GARDEN_AUTONOMOUS_DISTANCE_PX.max,
      random,
    );
    const angle = between(0, Math.PI * 2, random);
    const candidate = polarDestination(current, distancePx, angle, scene, bounds);
    if (destinationIsUseful(candidate, current, other, scene, recent, movingSize, otherSize)) {
      return candidate;
    }
  }

  for (const distancePx of FALLBACK_MOVE_DISTANCES_PX) {
    for (const angle of FALLBACK_MOVE_ANGLES) {
      const candidate = polarDestination(current, distancePx, angle, scene, bounds);
      if (destinationIsUseful(candidate, current, other, scene, recent, movingSize, otherSize)) {
        return candidate;
      }
    }
  }

  return null;
}

export function gardenMoveDuration(
  distancePx: number,
  random: () => number = Math.random,
): number {
  const safeDistance = Number.isFinite(distancePx) && distancePx > 0 ? distancePx : 96;
  const speed = between(
    GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND.min,
    GARDEN_AUTONOMOUS_SPEED_PX_PER_SECOND.max,
    random,
  );
  return Math.round(clamp(
    (safeDistance / speed) * 1_000,
    GARDEN_MOVE_DURATION_MS.min,
    GARDEN_MOVE_DURATION_MS.max,
  ));
}

export function gardenPauseDuration(random: () => number = Math.random): number {
  const value = safeRandom(random);
  if (value < GARDEN_IDLE_DURATION_MS.longChance) {
    const longProgress = value / GARDEN_IDLE_DURATION_MS.longChance;
    return Math.round(GARDEN_IDLE_DURATION_MS.longMin
      + (GARDEN_IDLE_DURATION_MS.longMax - GARDEN_IDLE_DURATION_MS.longMin) * longProgress);
  }
  const normalProgress = (value - GARDEN_IDLE_DURATION_MS.longChance)
    / (1 - GARDEN_IDLE_DURATION_MS.longChance);
  return Math.round(GARDEN_IDLE_DURATION_MS.min
    + (GARDEN_IDLE_DURATION_MS.max - GARDEN_IDLE_DURATION_MS.min) * normalProgress);
}

export function gardenFirstMoveDelay(random: () => number = Math.random): number {
  return gardenPauseDuration(random);
}

export function chooseGardenMover(
  lastMover: GardenCompanionKey | null,
  consecutiveMoves: number,
  moveCounts: Record<GardenCompanionKey, number>,
  random: () => number = Math.random,
): GardenCompanionKey {
  if (lastMover && consecutiveMoves >= 2) return lastMover === 'peach' ? 'sage' : 'peach';
  if (moveCounts.peach + 2 <= moveCounts.sage) return 'peach';
  if (moveCounts.sage + 2 <= moveCounts.peach) return 'sage';
  return safeRandom(random) < 0.5 ? 'peach' : 'sage';
}
