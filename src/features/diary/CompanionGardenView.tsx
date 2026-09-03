import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Palette, Sprout } from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { cn } from '@/lib/utils';
import paperPairAsset from '@/assets/characters/paper-pair-v1.webp';
import {
  DEFAULT_GARDEN_ACCESSORIES,
  type GardenAccessory,
  type GardenAccessoryState,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import type { CollectibleGardenAccessory } from '@/lib/companionShopLocalState';
import type { CompanionGardenState } from './companionGarden';
import {
  CompanionGardenActionSheet,
  type GardenMoveDirection,
} from './CompanionGardenActionSheet';
import {
  DEFAULT_GARDEN_FOOTPRINT,
  GARDEN_DIRECT_Y_BOUNDS,
  chooseGardenMover,
  constrainCompanionMove,
  gardenDistancePx,
  getPhysicalGardenBounds,
  gardenFirstMoveDelay,
  gardenMoveDuration,
  gardenPauseDuration,
  isGardenGeometryReady,
  pickGardenDestination,
  reconcileGardenPair,
  type GardenPairFootprints,
  type GardenPoint,
  type GardenSceneSize,
} from './companionGardenMotion';

export interface CompanionGardenViewProps {
  state: CompanionGardenState;
  unavailableReason?: 'missing_date' | 'shared_unavailable' | 'inactive_couple';
  accessories?: GardenAccessoryState;
  ownedAccessories?: readonly CollectibleGardenAccessory[];
  onAccessoryChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => boolean;
  onBack?: () => void;
  onOpenShop?: () => void;
}

type CompanionMotion = GardenPoint & {
  moving: boolean;
  moveCount: number;
  transitionMs: number;
};

type MotionMap = Record<GardenCompanionId, CompanionMotion>;

type MeasuredGardenPair = {
  sceneSize: GardenSceneSize;
  footprints: GardenPairFootprints;
};

const INITIAL_MOTION: MotionMap = {
  peach: { x: 26, y: 78, moving: false, moveCount: 0, transitionMs: 0 },
  sage: { x: 74, y: 74, moving: false, moveCount: 0, transitionMs: 0 },
};

const FALLBACK_SCENE_SIZE: GardenSceneSize = { width: 320, height: 600 };
const DEFAULT_PAIR_FOOTPRINTS: GardenPairFootprints = {
  peach: DEFAULT_GARDEN_FOOTPRINT,
  sage: DEFAULT_GARDEN_FOOTPRINT,
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;
const BUTTON_MOVE_STEP = 8;
// A compatibility click can arrive after pointer capture has already been released.
// Keep the guard alive long enough for delayed touch/mouse synthesis; a fresh
// pointerdown explicitly clears it so the user's next deliberate tap is never lost.
const SUPPRESSED_CLICK_FALLBACK_MS = 1_000;

const CHARACTER_POSE_CROPS: Record<GardenCompanionId, Record<'idle', string>> = {
  peach: {
    idle: '20 515 136 155',
  },
  sage: {
    idle: '156 514 138 155',
  },
};

type PressSession = {
  pointerId: number;
  startX: number;
  startY: number;
  activated: boolean;
  token: number;
  timer?: ReturnType<typeof setTimeout>;
};

type ActivePointer = {
  companion: GardenCompanionId;
  pointerId: number;
};

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return reduced;
}

function renderedGardenPoint(
  position: DOMRect,
  sceneLeft: number,
  sceneTop: number,
  sceneSize: GardenSceneSize,
): GardenPoint | null {
  if (!isFiniteRenderedRect(position)
    || !Number.isFinite(sceneLeft)
    || !Number.isFinite(sceneTop)
    || !Number.isFinite(sceneSize.width)
    || !Number.isFinite(sceneSize.height)
    || sceneSize.width <= 0
    || sceneSize.height <= 0) return null;
  const point = {
    x: ((position.left + position.width / 2 - sceneLeft) / sceneSize.width) * 100,
    y: ((position.bottom - sceneTop) / sceneSize.height) * 100,
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function isFiniteRenderedRect(value: DOMRect): boolean {
  return Number.isFinite(value.left)
    && Number.isFinite(value.top)
    && Number.isFinite(value.right)
    && Number.isFinite(value.bottom)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

function measuredSceneClientBox(sceneNode: HTMLElement): {
  left: number;
  top: number;
  size: GardenSceneSize;
} | null {
  const sceneRect = sceneNode.getBoundingClientRect();
  const left = sceneRect.left + sceneNode.clientLeft;
  const top = sceneRect.top + sceneNode.clientTop;
  const size = { width: sceneNode.clientWidth, height: sceneNode.clientHeight };
  if (!isFiniteRenderedRect(sceneRect)
    || !Number.isFinite(left)
    || !Number.isFinite(top)
    || !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0) return null;
  return { left, top, size };
}

function GardenAccessoryGlyph({
  companion,
  accessory,
}: {
  companion: GardenCompanionId;
  accessory: GardenAccessory;
}) {
  if (accessory === 'none') return null;
  const testId = `garden-accessory-${companion}-${accessory}`;
  if (accessory === 'cap') {
    return (
      <g data-testid={testId}>
        <path d="M21 23 Q36 9 51 23 L49 29 L23 29Z" fill="var(--ink-accent)" stroke="var(--ink)" strokeWidth="1.5" />
        <path d="M35 28 Q50 28 57 32" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      </g>
    );
  }
  if (accessory === 'bow') {
    return (
      <g data-testid={testId}>
        <path d="M18 29 Q9 21 10 34 Q12 42 22 34Z" fill="var(--coral)" stroke="var(--ink)" strokeWidth="1.5" />
        <path d="M22 30 Q31 21 30 35 Q27 42 20 35Z" fill="var(--coral-fill)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle cx="21" cy="32" r="3.5" fill="var(--card)" stroke="var(--ink)" strokeWidth="1" />
      </g>
    );
  }
  if (accessory === 'scarf') {
    return (
      <g data-testid={testId}>
        <path d="M19 56 Q36 63 53 56 L52 63 Q36 69 20 63Z" fill="var(--coral)" stroke="var(--ink)" strokeWidth="1.5" />
        <path d="M48 62 L54 76 L47 73 L44 64Z" fill="var(--coral)" stroke="var(--ink)" strokeWidth="1.5" />
      </g>
    );
  }
  return (
    <g data-testid={testId}>
      {[0, 1, 2, 3, 4].map((petal) => {
        const angle = (Math.PI * 2 * petal) / 5;
        return (
          <circle
            key={petal}
            cx={51 + Math.cos(angle) * 5}
            cy={25 + Math.sin(angle) * 5}
            r="3.3"
            fill="var(--coral-fill)"
            stroke="var(--ink)"
            strokeWidth="0.8"
          />
        );
      })}
      <circle cx="51" cy="25" r="3" fill="var(--coral)" stroke="var(--ink)" strokeWidth="0.8" />
    </g>
  );
}

function CompanionGlyph({
  companion,
  accessory,
  moving,
  lifted,
}: {
  companion: GardenCompanionId;
  accessory: GardenAccessory;
  moving: boolean;
  lifted: boolean;
}) {
  return (
    <span
      data-testid={`garden-companion-art-${companion}`}
      className={cn(
        'garden-companion-art relative block h-[28px] w-[25px] shrink-0 drop-shadow-sm',
        moving && !lifted && 'garden-companion-walking',
      )}
    >
      <span className="garden-companion-limbs pointer-events-none absolute inset-0 block" aria-hidden="true">
        <span
          data-testid={`garden-limb-${companion}-arm-left`}
          className="garden-limb garden-limb-arm-left"
        />
        <span
          data-testid={`garden-limb-${companion}-arm-right`}
          className="garden-limb garden-limb-arm-right"
        />
        <span
          data-testid={`garden-limb-${companion}-leg-left`}
          className="garden-limb garden-limb-leg-left"
        />
        <span
          data-testid={`garden-limb-${companion}-leg-right`}
          className="garden-limb garden-limb-leg-right"
        />
      </span>

      <span className="garden-companion-body pointer-events-none relative block h-full w-full">
        <svg
          data-testid={`garden-exact-character-${companion}`}
          data-garden-pose="idle"
          viewBox={CHARACTER_POSE_CROPS[companion].idle}
          className="garden-character-frame garden-exact-character"
          aria-hidden="true"
        >
          <image href={paperPairAsset} width="1254" height="1254" pointerEvents="none" />
        </svg>
        <svg viewBox="0 0 72 82" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <GardenAccessoryGlyph companion={companion} accessory={accessory} />
        </svg>
      </span>
    </span>
  );
}

function GardenCompanion({
  id,
  label,
  motion,
  accessory,
  pressed,
  lifted,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onClick,
  positionRef,
  sceneSize,
}: {
  id: GardenCompanionId;
  label: string;
  motion: CompanionMotion;
  accessory: GardenAccessory;
  pressed: boolean;
  lifted: boolean;
  onPointerDown: (id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (id: GardenCompanionId, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onClick: (id: GardenCompanionId, event: ReactMouseEvent<HTMLButtonElement>) => void;
  positionRef: (node: HTMLDivElement | null) => void;
  sceneSize: GardenSceneSize;
}) {
  const xPx = (motion.x / 100) * sceneSize.width;
  const yPx = (motion.y / 100) * sceneSize.height;
  const descId = `garden-companion-${id}-desc`;
  return (
    <div
      ref={positionRef}
      className="garden-companion-position absolute z-10"
      data-testid={`garden-companion-position-${id}`}
      style={{
        left: 0,
        top: 0,
        transform: `translate3d(${xPx}px, ${yPx}px, 0) translate(-50%, -100%)`,
        transitionProperty: 'transform',
        transitionDuration: `${motion.transitionMs}ms`,
        transitionTimingFunction: 'ease-in-out',
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => onPointerDown(id, event)}
        onPointerMove={(event) => onPointerMove(id, event)}
        onPointerUp={(event) => onPointerUp(id, event)}
        onPointerCancel={(event) => onPointerCancel(id, event)}
        onLostPointerCapture={(event) => onLostPointerCapture(id, event)}
        onKeyDown={(event) => onKeyDown(id, event)}
        onClick={(event) => onClick(id, event)}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={`${label} 친구와 함께 놀기. 길게 눌러 직접 이동`}
        aria-describedby={descId}
        data-testid={`garden-companion-${id}`}
        data-companion={id}
        data-accessory={accessory}
        data-x={motion.x.toFixed(2)}
        data-y={motion.y.toFixed(2)}
        data-move-count={motion.moveCount}
        data-wandering={String(motion.moving)}
        data-pressed={String(pressed)}
        data-lifted={String(lifted)}
        className={cn(
          'garden-companion-control inline-flex min-h-11 min-w-11 touch-none select-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          pressed && 'garden-companion-pressed',
          lifted && 'garden-companion-lifted',
        )}
      >
        <CompanionGlyph companion={id} accessory={accessory} moving={motion.moving} lifted={lifted} />
      </button>
      <span id={descId} className="sr-only">
        길게 눌러 정원 안을 직접 이동할 수 있어요. 탭하면 함께 놀기 메뉴가 열려요.
      </span>
    </div>
  );
}

export function CompanionGardenView({
  state,
  unavailableReason = 'missing_date',
  accessories = DEFAULT_GARDEN_ACCESSORIES,
  ownedAccessories = [],
  onAccessoryChange,
  onBack,
  onOpenShop,
}: CompanionGardenViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [motion, setMotion] = useState<MotionMap>(INITIAL_MOTION);
  const motionRef = useRef<MotionMap>(INITIAL_MOTION);
  const [sceneSize, setSceneSize] = useState<GardenSceneSize>(FALLBACK_SCENE_SIZE);
  const sceneSizeRef = useRef<GardenSceneSize>(FALLBACK_SCENE_SIZE);
  const footprintsRef = useRef<GardenPairFootprints>(DEFAULT_PAIR_FOOTPRINTS);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const companionPositionRefs = useRef<Partial<Record<GardenCompanionId, HTMLDivElement>>>({});
  const [pressed, setPressed] = useState<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const pressedRef = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const [lifted, setLifted] = useState<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const liftedRef = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const pressSessions = useRef<Partial<Record<GardenCompanionId, PressSession>>>({});
  const activePointerRef = useRef<ActivePointer | null>(null);
  const ignoredPointersRef = useRef<Map<number, GardenCompanionId>>(new Map());
  const [pointerInteractionActive, setPointerInteractionActive] = useState(false);
  const interactionTokens = useRef<Record<GardenCompanionId, number>>({ peach: 0, sage: 0 });
  const suppressedClicks = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const suppressedClickTimers = useRef<Partial<Record<GardenCompanionId, ReturnType<typeof setTimeout>>>>({});
  const actionSheetTriggerRef = useRef<HTMLElement | null>(null);
  const [actionSheetCompanion, setActionSheetCompanion] = useState<GardenCompanionId | null>(null);
  const schedulerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulerGenerationRef = useRef(0);
  const geometryReadyRef = useRef(false);
  const cadenceRef = useRef<{
    lastMover: GardenCompanionId | null;
    consecutiveMoves: number;
    recentDestinations: GardenPoint[];
  }>({ lastMover: null, consecutiveMoves: 0, recentDestinations: [] });
  const [schedulerEpoch, setSchedulerEpoch] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ));
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const announce = useCallback((message: string) => {
    setLiveAnnouncement(message);
  }, []);

  const commitMotion = useCallback((next: MotionMap) => {
    motionRef.current = next;
    setMotion(next);
  }, []);

  const invalidateScheduler = useCallback(() => {
    schedulerGenerationRef.current += 1;
    if (schedulerTimerRef.current) clearTimeout(schedulerTimerRef.current);
    schedulerTimerRef.current = null;
  }, []);

  const freezeAndReconcilePair = useCallback((useRenderedPositions: boolean): MeasuredGardenPair | null => {
    const sceneNode = sceneRef.current;
    const markGeometryUnavailable = () => {
      geometryReadyRef.current = false;
      const current = motionRef.current;
      if (current.peach.moving
        || current.sage.moving
        || current.peach.transitionMs !== 0
        || current.sage.transitionMs !== 0) {
        commitMotion({
          peach: { ...current.peach, moving: false, transitionMs: 0 },
          sage: { ...current.sage, moving: false, transitionMs: 0 },
        });
      }
      return null;
    };
    if (!sceneNode) return markGeometryUnavailable();
    const sceneClientBox = measuredSceneClientBox(sceneNode);
    if (!sceneClientBox) return markGeometryUnavailable();
    const { left: sceneLeft, top: sceneTop, size: measuredScene } = sceneClientBox;
    const measuredFootprints = { ...footprintsRef.current };
    const renderedPoints: Record<GardenCompanionId, GardenPoint> = {
      peach: motionRef.current.peach,
      sage: motionRef.current.sage,
    };

    for (const id of ['peach', 'sage'] as const) {
      const position = companionPositionRefs.current[id]?.getBoundingClientRect();
      if (!position || !isFiniteRenderedRect(position)) return markGeometryUnavailable();
      measuredFootprints[id] = { width: position.width, height: position.height };
      if (useRenderedPositions) {
        const rendered = renderedGardenPoint(position, sceneLeft, sceneTop, measuredScene);
        if (!rendered) return markGeometryUnavailable();
        renderedPoints[id] = rendered;
      }
    }

    const reconciled = reconcileGardenPair(
      renderedPoints,
      measuredScene,
      measuredFootprints,
      GARDEN_DIRECT_Y_BOUNDS,
    );
    if (!reconciled) return markGeometryUnavailable();
    const current = motionRef.current;
    const next: MotionMap = {
      peach: { ...current.peach, ...reconciled.peach, moving: false, transitionMs: 0 },
      sage: { ...current.sage, ...reconciled.sage, moving: false, transitionMs: 0 },
    };
    geometryReadyRef.current = isGardenGeometryReady(measuredScene, measuredFootprints);
    footprintsRef.current = measuredFootprints;
    sceneSizeRef.current = measuredScene;
    setSceneSize((previous) => (
      previous.width === measuredScene.width && previous.height === measuredScene.height
        ? previous
        : measuredScene
    ));
    commitMotion(next);
    return { sceneSize: measuredScene, footprints: measuredFootprints };
  }, [commitMotion]);

  useLayoutEffect(() => {
    if (!state.isAvailable) return;
    freezeAndReconcilePair(false);

    const geometryChanged = () => {
      invalidateScheduler();
      freezeAndReconcilePair(true);
      setSchedulerEpoch((value) => value + 1);
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(geometryChanged);
    if (sceneRef.current) observer?.observe(sceneRef.current);
    for (const node of Object.values(companionPositionRefs.current)) {
      if (node) observer?.observe(node);
    }
    window.addEventListener('resize', geometryChanged);
    window.addEventListener('orientationchange', geometryChanged);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', geometryChanged);
      window.removeEventListener('orientationchange', geometryChanged);
    };
  }, [freezeAndReconcilePair, invalidateScheduler, state.isAvailable]);

  useEffect(() => {
    const visibilityChanged = () => {
      const visible = document.visibilityState !== 'hidden';
      invalidateScheduler();
      if (state.isAvailable) freezeAndReconcilePair(true);
      setDocumentVisible(visible);
      setSchedulerEpoch((value) => value + 1);
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => document.removeEventListener('visibilitychange', visibilityChanged);
  }, [freezeAndReconcilePair, invalidateScheduler, state.isAvailable]);

  const previousReducedMotion = useRef(reducedMotion);
  useLayoutEffect(() => {
    if (previousReducedMotion.current === reducedMotion) return;
    previousReducedMotion.current = reducedMotion;
    invalidateScheduler();
    if (state.isAvailable) freezeAndReconcilePair(true);
    setSchedulerEpoch((value) => value + 1);
  }, [freezeAndReconcilePair, invalidateScheduler, reducedMotion, state.isAvailable]);

  useEffect(() => {
    invalidateScheduler();
    if (!state.isAvailable
      || reducedMotion
      || actionSheetCompanion
      || !documentVisible
      || pointerInteractionActive
      || !geometryReadyRef.current) return;

    const generation = schedulerGenerationRef.current;
    const register = (callback: () => void, delay: number) => {
      if (schedulerTimerRef.current) clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = setTimeout(() => {
        schedulerTimerRef.current = null;
        if (schedulerGenerationRef.current !== generation) return;
        callback();
      }, delay);
    };

    const scheduleIdle = (first = false) => {
      register(startMove, first ? gardenFirstMoveDelay() : gardenPauseDuration());
    };

    const startMove = () => {
      if (!geometryReadyRef.current) return;
      const currentMap = motionRef.current;
      const cadence = cadenceRef.current;
      const mover = chooseGardenMover(
        cadence.lastMover,
        cadence.consecutiveMoves,
        {
          peach: currentMap.peach.moveCount,
          sage: currentMap.sage.moveCount,
        },
      );
      const other: GardenCompanionId = mover === 'peach' ? 'sage' : 'peach';
      const destination = pickGardenDestination(currentMap[mover], currentMap[other], {
        sceneSize: sceneSizeRef.current,
        recentDestinations: cadence.recentDestinations,
        movingFootprint: footprintsRef.current[mover],
        otherFootprint: footprintsRef.current[other],
      });
      if (!destination) {
        scheduleIdle();
        return;
      }

      const duration = gardenMoveDuration(
        gardenDistancePx(currentMap[mover], destination, sceneSizeRef.current),
      );
      const nextMover: CompanionMotion = {
        ...currentMap[mover],
        ...destination,
        moving: true,
        moveCount: currentMap[mover].moveCount + 1,
        transitionMs: duration,
      };
      const nextMap: MotionMap = {
        peach: { ...currentMap.peach, moving: false, transitionMs: 0 },
        sage: { ...currentMap.sage, moving: false, transitionMs: 0 },
        [mover]: nextMover,
      };
      cadence.consecutiveMoves = cadence.lastMover === mover ? cadence.consecutiveMoves + 1 : 1;
      cadence.lastMover = mover;
      cadence.recentDestinations = [destination, ...cadence.recentDestinations].slice(0, 2);
      commitMotion(nextMap);

      register(() => {
        const latest = motionRef.current;
        const stopped: MotionMap = {
          ...latest,
          [mover]: { ...latest[mover], moving: false, transitionMs: 0 },
        };
        commitMotion(stopped);
        scheduleIdle();
      }, duration);
    };

    scheduleIdle(true);
    return invalidateScheduler;
  }, [
    actionSheetCompanion,
    commitMotion,
    documentVisible,
    invalidateScheduler,
    pointerInteractionActive,
    reducedMotion,
    schedulerEpoch,
    state.isAvailable,
  ]);

  useEffect(() => () => {
    invalidateScheduler();
    for (const session of Object.values(pressSessions.current)) {
      if (session?.timer) clearTimeout(session.timer);
    }
    for (const timer of Object.values(suppressedClickTimers.current)) {
      if (timer) clearTimeout(timer);
    }
    ignoredPointersRef.current.clear();
  }, [invalidateScheduler]);

  const setCompanionPressed = useCallback((id: GardenCompanionId, value: boolean) => {
    pressedRef.current = { ...pressedRef.current, [id]: value };
    setPressed((current) => ({ ...current, [id]: value }));
  }, []);

  const setCompanionLifted = useCallback((id: GardenCompanionId, value: boolean) => {
    liftedRef.current = { ...liftedRef.current, [id]: value };
    setLifted((current) => ({ ...current, [id]: value }));
  }, []);

  const pauseAutonomy = useCallback(() => {
    invalidateScheduler();
    freezeAndReconcilePair(true);
  }, [freezeAndReconcilePair, invalidateScheduler]);

  const cancelInteraction = useCallback((
    id: GardenCompanionId,
    event?: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const session = pressSessions.current[id];
    if (session?.timer) clearTimeout(session.timer);
    delete pressSessions.current[id];
    interactionTokens.current[id] += 1;
    setCompanionPressed(id, false);
    setCompanionLifted(id, false);
    const activePointer = activePointerRef.current;
    if (activePointer?.companion === id
      && (!event || activePointer.pointerId === event.pointerId)) {
      activePointerRef.current = null;
      setPointerInteractionActive(false);
    }
    if (event && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, [setCompanionLifted, setCompanionPressed]);

  const clearSuppressedClick = useCallback((id: GardenCompanionId) => {
    suppressedClicks.current[id] = false;
    const previousTimer = suppressedClickTimers.current[id];
    if (previousTimer) clearTimeout(previousTimer);
    delete suppressedClickTimers.current[id];
  }, []);

  const suppressNextClick = useCallback((id: GardenCompanionId) => {
    clearSuppressedClick(id);
    suppressedClicks.current[id] = true;
    suppressedClickTimers.current[id] = setTimeout(() => {
      suppressedClicks.current[id] = false;
      delete suppressedClickTimers.current[id];
    }, SUPPRESSED_CLICK_FALLBACK_MS);
  }, [clearSuppressedClick]);

  const openActionSheet = useCallback((id: GardenCompanionId, trigger: HTMLElement) => {
    if (activePointerRef.current) return;
    cancelInteraction(id);
    pauseAutonomy();
    actionSheetTriggerRef.current = trigger;
    setActionSheetCompanion(id);
  }, [cancelInteraction, pauseAutonomy]);

  const beginPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointerRef.current) {
      ignoredPointersRef.current.set(event.pointerId, id);
      return;
    }
    for (const [pointerId, companion] of ignoredPointersRef.current) {
      if (companion === id) ignoredPointersRef.current.delete(pointerId);
    }
    clearSuppressedClick(id);
    cancelInteraction(id);
    pauseAutonomy();
    activePointerRef.current = { companion: id, pointerId: event.pointerId };
    setPointerInteractionActive(true);
    setCompanionPressed(id, true);
    const session: PressSession = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      token: interactionTokens.current[id],
    };
    session.timer = setTimeout(() => {
      if (pressSessions.current[id] !== session || interactionTokens.current[id] !== session.token) return;
      session.activated = true;
      setCompanionLifted(id, true);
      const label = id === 'peach' ? '첫째' : '둘째';
      announce(`${label} 친구를 들어 올렸어요.`);
    }, LONG_PRESS_MS);
    pressSessions.current[id] = session;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [announce, cancelInteraction, clearSuppressedClick, pauseAutonomy, setCompanionLifted, setCompanionPressed]);

  const movePointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pressSessions.current[id];
    const activePointer = activePointerRef.current;
    if (!session
      || session.pointerId !== event.pointerId
      || activePointer?.companion !== id
      || activePointer.pointerId !== event.pointerId) return;
    if (!session.activated) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance > LONG_PRESS_MOVE_TOLERANCE) {
        suppressNextClick(id);
        cancelInteraction(id, event);
        const label = id === 'peach' ? '첫째' : '둘째';
        announce(`${label} 친구 들어 올리기가 취소되었어요.`);
      }
      return;
    }

    const sceneNode = sceneRef.current;
    if (!sceneNode) return;
    const sceneClientBox = measuredSceneClientBox(sceneNode);
    if (!sceneClientBox) return;
    event.preventDefault();
    const { left, top, size: sceneSize } = sceneClientBox;
    sceneSizeRef.current = sceneSize;
    const movingFootprint = footprintsRef.current[id];
    const physicalBounds = getPhysicalGardenBounds(
      sceneSize.width,
      sceneSize.height,
      GARDEN_DIRECT_Y_BOUNDS,
      movingFootprint,
    );
    if (!physicalBounds) return;
    const point = {
      x: ((event.clientX - left) / sceneSize.width) * 100,
      y: ((event.clientY - top) / sceneSize.height) * 100,
    };
    const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
    const current = motionRef.current[id];
    const other = motionRef.current[otherId];
    const constrained = constrainCompanionMove(
      current,
      point,
      other,
      sceneSize,
      physicalBounds,
      movingFootprint,
      footprintsRef.current[otherId],
    );
    if (!constrained) return;
    const dragged = { ...motionRef.current[id], ...constrained, moving: false, transitionMs: 0 };
    motionRef.current = { ...motionRef.current, [id]: dragged };
    setMotion((current) => ({ ...current, [id]: dragged }));
  }, [announce, cancelInteraction, suppressNextClick]);

  const endPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (ignoredPointersRef.current.get(event.pointerId) === id) {
      ignoredPointersRef.current.delete(event.pointerId);
      suppressNextClick(id);
      return;
    }
    const session = pressSessions.current[id];
    if (!session || session.pointerId !== event.pointerId) return;
    const wasLifted = session.activated;
    if (wasLifted) {
      suppressNextClick(id);
      const label = id === 'peach' ? '첫째' : '둘째';
      announce(`${label} 친구를 내려놓았어요.`);
    }
    cancelInteraction(id, event);
  }, [announce, cancelInteraction, suppressNextClick]);

  const cancelPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (ignoredPointersRef.current.get(event.pointerId) === id) {
      ignoredPointersRef.current.delete(event.pointerId);
      suppressNextClick(id);
      return;
    }
    const session = pressSessions.current[id];
    if (!session || session.pointerId !== event.pointerId) return;
    const label = id === 'peach' ? '첫째' : '둘째';
    if (session.activated) {
      suppressNextClick(id);
      announce(`${label} 친구를 내려놓았어요.`);
    } else {
      announce(`${label} 친구 들어 올리기가 취소되었어요.`);
    }
    cancelInteraction(id, event);
  }, [announce, cancelInteraction, suppressNextClick]);

  const lostPointerCapturePickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pressSessions.current[id];
    if (session && session.pointerId === event.pointerId) {
      const label = id === 'peach' ? '첫째' : '둘째';
      if (session.activated) {
        suppressNextClick(id);
        announce(`${label} 친구를 내려놓았어요.`);
      } else {
        announce(`${label} 친구 들어 올리기가 취소되었어요.`);
      }
    }
    cancelInteraction(id, event);
  }, [announce, cancelInteraction, suppressNextClick]);

  const keyboardAction = useCallback((id: GardenCompanionId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat) return;
    openActionSheet(id, event.currentTarget);
  }, [openActionSheet]);

  const clickAction = useCallback((id: GardenCompanionId, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressedClicks.current[id] && event.detail > 0) {
      clearSuppressedClick(id);
      return;
    }
    clearSuppressedClick(id);
    openActionSheet(id, event.currentTarget);
  }, [clearSuppressedClick, openActionSheet]);

  const moveCompanion = useCallback((id: GardenCompanionId, direction: GardenMoveDirection): boolean => {
    const measured = freezeAndReconcilePair(true);
    if (!measured) return false;
    const { sceneSize, footprints } = measured;
    const movingFootprint = footprints[id];
    const bounds = getPhysicalGardenBounds(
      sceneSize.width,
      sceneSize.height,
      GARDEN_DIRECT_Y_BOUNDS,
      movingFootprint,
    );
    if (!bounds) return false;
    const current = motionRef.current[id];
    const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
    const delta = {
      up: { x: 0, y: -BUTTON_MOVE_STEP },
      down: { x: 0, y: BUTTON_MOVE_STEP },
      left: { x: -BUTTON_MOVE_STEP, y: 0 },
      right: { x: BUTTON_MOVE_STEP, y: 0 },
    }[direction];
    const nextPoint = constrainCompanionMove(
      current,
      { x: current.x + delta.x, y: current.y + delta.y },
      motionRef.current[otherId],
      sceneSize,
      bounds,
      movingFootprint,
      footprints[otherId],
    );
    if (!nextPoint) return false;
    const moved = Math.abs(nextPoint.x - current.x) > 0.01 || Math.abs(nextPoint.y - current.y) > 0.01;
    if (!moved) return false;
    const next = {
      ...current,
      ...nextPoint,
      moving: false,
      transitionMs: reducedMotion ? 0 : 180,
    };
    motionRef.current = { ...motionRef.current, [id]: next };
    setMotion((value) => ({ ...value, [id]: next }));
    return true;
  }, [freezeAndReconcilePair, reducedMotion]);

  useEffect(() => {
    if (state.isAvailable) return;
    cancelInteraction('peach');
    cancelInteraction('sage');
    setActionSheetCompanion(null);
  }, [cancelInteraction, state.isAvailable]);

  const unavailableCopy = unavailableReason === 'shared_unavailable'
    ? '공유 정보를 확인하는 중이에요. 확인되면 정원을 다시 보여드려요.'
    : unavailableReason === 'inactive_couple'
      ? '커플 연결이 확인되면 정원이 자라기 시작해요.'
      : '함께한 날을 설정하면 정원이 자라기 시작해요.';

  return (
    <div className={cn('flex h-full min-h-0 flex-col', state.isAvailable ? 'garden-surface bg-white text-foreground' : 'bg-background')}>
      <AppBar
        title={<span className="sr-only">정원</span>}
        onBack={onBack}
        backLabel="이전 화면으로"
        className={state.isAvailable ? 'garden-surface bg-white shadow-none [&_.ink-rule]:hidden' : undefined}
        actions={state.isAvailable ? (
          <button
            type="button"
            onClick={(event) => openActionSheet('peach', event.currentTarget)}
            aria-label="꾸미기와 함께 놀기"
            className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-foreground"
          >
            <Palette size={20} aria-hidden="true" />
          </button>
        ) : undefined}
      />

      {state.isAvailable ? (
        <section className="garden-surface flex min-h-0 flex-1 flex-col bg-white" aria-label="정원 현황">
          <div className="garden-landscape-summary px-4 pb-3 pt-4">
            <p className="text-caption font-medium text-muted-foreground">함께한 {state.togetherDays}일</p>
          </div>

          <div
            ref={sceneRef}
            data-testid="garden-scene"
            className="garden-landscape-scene garden-surface relative min-h-0 flex-1 overflow-hidden bg-white"
          >
            <GardenCompanion
              id="peach"
              label="첫째"
              motion={motion.peach}
              accessory={accessories.peach}
              pressed={pressed.peach}
              lifted={lifted.peach}
              onPointerDown={beginPointerPickup}
              onPointerMove={movePointerPickup}
              onPointerUp={endPointerPickup}
              onPointerCancel={cancelPointerPickup}
              onLostPointerCapture={lostPointerCapturePickup}
              onKeyDown={keyboardAction}
              onClick={clickAction}
              sceneSize={sceneSize}
              positionRef={(node) => {
                if (node) companionPositionRefs.current.peach = node;
                else delete companionPositionRefs.current.peach;
              }}
            />
            <GardenCompanion
              id="sage"
              label="둘째"
              motion={motion.sage}
              accessory={accessories.sage}
              pressed={pressed.sage}
              lifted={lifted.sage}
              onPointerDown={beginPointerPickup}
              onPointerMove={movePointerPickup}
              onPointerUp={endPointerPickup}
              onPointerCancel={cancelPointerPickup}
              onLostPointerCapture={lostPointerCapturePickup}
              onKeyDown={keyboardAction}
              onClick={clickAction}
              sceneSize={sceneSize}
              positionRef={(node) => {
                if (node) companionPositionRefs.current.sage = node;
                else delete companionPositionRefs.current.sage;
              }}
            />
          </div>

          <div
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
            data-testid="garden-live-region"
          >
            {liveAnnouncement}
          </div>
        </section>
      ) : (
        <section
          className="m-4 my-auto rounded-surface border border-border bg-card p-8 text-center"
          aria-label={unavailableReason === 'shared_unavailable' ? '정원 확인 중' : '정원 준비 안내'}
        >
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <Sprout size={32} className="mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-body font-semibold text-foreground">{unavailableCopy}</p>
          </div>
        </section>
      )}

      {state.isAvailable && actionSheetCompanion ? (
        <CompanionGardenActionSheet
          companion={actionSheetCompanion}
          triggerRef={actionSheetTriggerRef}
          accessories={accessories}
          ownedAccessories={ownedAccessories}
          onSelectCompanion={setActionSheetCompanion}
          onAccessoryChange={onAccessoryChange}
          onMove={(direction) => moveCompanion(actionSheetCompanion, direction)}
          onClose={() => setActionSheetCompanion(null)}
          onOpenShop={onOpenShop}
        />
      ) : null}
    </div>
  );
}
