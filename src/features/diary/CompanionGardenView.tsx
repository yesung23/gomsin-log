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
import { Sprout } from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { cn } from '@/lib/utils';
import paperPairAsset from '@/assets/characters/paper-pair-v1.webp';
import {
  DEFAULT_GARDEN_ACCESSORIES,
  type GardenAccessory,
  type GardenAccessoryState,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import type { CompanionGardenState } from './companionGarden';
import {
  GARDEN_BOUNDS,
  constrainCompanionPoint,
  getPhysicalGardenBounds,
  gardenFirstMoveDelay,
  gardenMoveDuration,
  gardenPauseDuration,
  pickGardenDestination,
  type GardenPoint,
} from './companionGardenMotion';

export interface CompanionGardenViewProps {
  state: CompanionGardenState;
  unavailableReason?: 'missing_date' | 'shared_unavailable' | 'inactive_couple';
  accessories?: GardenAccessoryState;
  onBack?: () => void;
}

type CompanionMotion = GardenPoint & {
  moving: boolean;
  moveCount: number;
  transitionMs: number;
};

type MotionMap = Record<GardenCompanionId, CompanionMotion>;

const INITIAL_MOTION: MotionMap = {
  peach: { x: 26, y: 78, moving: false, moveCount: 0, transitionMs: 0 },
  sage: { x: 74, y: 74, moving: false, moveCount: 0, transitionMs: 0 },
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;
const KEYBOARD_PICKUP_MS = 900;

const CHARACTER_POSE_CROPS: Record<GardenCompanionId, Record<'idle' | 'walk' | 'lift', string>> = {
  peach: {
    idle: '20 515 136 155',
    walk: '20 688 136 170',
    lift: '300 688 140 170',
  },
  sage: {
    idle: '156 514 138 155',
    walk: '156 688 138 170',
    lift: '460 688 140 170',
  },
};

/** Original-sheet poses with a visible object/accessory; cap has no matching source pose. */
const ACCESSORY_POSE_CROPS: Partial<Record<GardenAccessory, string>> = {
  scarf: '460 688 140 170',
  flower: '930 688 150 170',
};

type PressSession = {
  pointerId: number;
  startX: number;
  startY: number;
  activated: boolean;
  token: number;
  timer?: ReturnType<typeof setTimeout>;
};

type FinitePickupSession = {
  token: number;
  timer: ReturnType<typeof setTimeout>;
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
  scene: DOMRect,
): GardenPoint | null {
  if (scene.width <= 0 || scene.height <= 0 || position.width <= 0 || position.height <= 0) return null;
  return {
    x: ((position.left + position.width / 2 - scene.left) / scene.width) * 100,
    y: ((position.bottom - scene.top) / scene.height) * 100,
  };
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
  const accessoryIdleCrop = accessory === 'none'
    ? null
    : ACCESSORY_POSE_CROPS[accessory] ?? null;
  const renderFrame = (phase: 'idle' | 'walk' | 'lift', className: string, testId: string) => (
    <svg
      data-testid={phase === 'idle' ? `garden-exact-character-${companion}` : testId}
      data-garden-pose={phase}
      viewBox={phase === 'idle' && accessoryIdleCrop ? accessoryIdleCrop : CHARACTER_POSE_CROPS[companion][phase]}
      className={cn('garden-character-frame', className)}
      aria-hidden="true"
    >
      <image href={paperPairAsset} width="1254" height="1254" pointerEvents="none" />
    </svg>
  );
  return (
    <span className={cn('relative block h-[56px] w-[49px] drop-shadow-sm', moving && !lifted && 'garden-companion-walking')}>
      {renderFrame('idle', 'garden-exact-character', `garden-character-${companion}-idle`)}
      {renderFrame('walk', 'garden-character-frame--walk', `garden-character-${companion}-walk`)}
      {renderFrame('lift', 'garden-character-frame--lift', `garden-character-${companion}-lift`)}
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
}) {
  return (
    <div
      ref={positionRef}
      className="garden-companion-position absolute z-10"
      data-testid={`garden-companion-position-${id}`}
      style={{
        left: `${motion.x}%`,
        top: `${motion.y}%`,
        transform: 'translate(-50%, -100%)',
        transitionProperty: 'left, top',
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
        aria-label={`${label} 친구 길게 눌러 잡기`}
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
          'garden-companion-control inline-flex min-h-11 min-w-11 touch-none select-none items-end justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          pressed && 'garden-companion-pressed',
          lifted && 'garden-companion-lifted',
        )}
      >
        <CompanionGlyph companion={id} accessory={accessory} moving={motion.moving} lifted={lifted} />
      </button>
    </div>
  );
}

export function CompanionGardenView({
  state,
  unavailableReason = 'missing_date',
  accessories = DEFAULT_GARDEN_ACCESSORIES,
  onBack,
}: CompanionGardenViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [motion, setMotion] = useState<MotionMap>(INITIAL_MOTION);
  const motionRef = useRef<MotionMap>(INITIAL_MOTION);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const companionPositionRefs = useRef<Partial<Record<GardenCompanionId, HTMLDivElement>>>({});
  const [pressed, setPressed] = useState<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const pressedRef = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const [lifted, setLifted] = useState<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const liftedRef = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const pressSessions = useRef<Partial<Record<GardenCompanionId, PressSession>>>({});
  const keyboardTimers = useRef<Partial<Record<GardenCompanionId, FinitePickupSession>>>({});
  const interactionTokens = useRef<Record<GardenCompanionId, number>>({ peach: 0, sage: 0 });
  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useLayoutEffect(() => {
    if (!state.isAvailable) return;
    const scene = sceneRef.current?.getBoundingClientRect();
    if (!scene || scene.width <= 0 || scene.height <= 0) return;
    const bounds = getPhysicalGardenBounds(scene.width, scene.height, GARDEN_BOUNDS);
    setMotion((current) => {
      let changed = false;
      const next = { ...current };
      for (const id of ['peach', 'sage'] as const) {
        const x = Math.max(bounds.minX, Math.min(bounds.maxX, current[id].x));
        const y = Math.max(bounds.minY, Math.min(bounds.maxY, current[id].y));
        if (x !== current[id].x || y !== current[id].y) {
          next[id] = { ...current[id], x, y };
          changed = true;
        }
      }
      if (changed) motionRef.current = next;
      return changed ? next : current;
    });
  }, [state.isAvailable]);

  useEffect(() => {
    if (!state.isAvailable || reducedMotion) {
      setMotion((current) => ({
        peach: { ...current.peach, moving: false, transitionMs: 0 },
        sage: { ...current.sage, moving: false, transitionMs: 0 },
      }));
      return;
    }

    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const register = (callback: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
    };

    const schedule = (id: GardenCompanionId, delay: number) => {
      register(() => {
        if (cancelled) return;
        if (pressedRef.current[id] || liftedRef.current[id]) {
          schedule(id, 300);
          return;
        }
        const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
        const current = motionRef.current[id];
        const other = motionRef.current[otherId];
        const scene = sceneRef.current?.getBoundingClientRect();
        const destination = pickGardenDestination(
          current,
          other,
          Math.random,
          scene ? { width: scene.width, height: scene.height } : undefined,
        );
        const duration = gardenMoveDuration();
        const nextMotion: CompanionMotion = {
          ...destination,
          moving: true,
          moveCount: current.moveCount + 1,
          transitionMs: duration,
        };
        motionRef.current = { ...motionRef.current, [id]: nextMotion };
        setMotion((previous) => ({ ...previous, [id]: nextMotion }));

        register(() => {
          if (cancelled) return;
          const stopped = { ...motionRef.current[id], moving: false };
          motionRef.current = { ...motionRef.current, [id]: stopped };
          setMotion((previous) => ({ ...previous, [id]: stopped }));
          schedule(id, gardenPauseDuration());
        }, duration);
      }, delay);
    };

    schedule('peach', gardenFirstMoveDelay());
    schedule('sage', gardenFirstMoveDelay());

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [reducedMotion, state.isAvailable]);

  useEffect(() => () => {
    for (const session of Object.values(pressSessions.current)) {
      if (session?.timer) clearTimeout(session.timer);
    }
    for (const session of Object.values(keyboardTimers.current)) {
      if (session) clearTimeout(session.timer);
    }
  }, []);

  const setCompanionPressed = useCallback((id: GardenCompanionId, value: boolean) => {
    pressedRef.current = { ...pressedRef.current, [id]: value };
    setPressed((current) => ({ ...current, [id]: value }));
  }, []);

  const setCompanionLifted = useCallback((id: GardenCompanionId, value: boolean) => {
    liftedRef.current = { ...liftedRef.current, [id]: value };
    setLifted((current) => ({ ...current, [id]: value }));
  }, []);

  const stopCompanionMotion = useCallback((id: GardenCompanionId) => {
    const current = motionRef.current[id];
    const scene = sceneRef.current?.getBoundingClientRect();
    const position = companionPositionRefs.current[id]?.getBoundingClientRect();
    const rendered = scene && position ? renderedGardenPoint(position, scene) : null;
    const bounds = scene ? getPhysicalGardenBounds(scene.width, scene.height) : null;
    const stopped = {
      ...current,
      ...(rendered && bounds ? {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, rendered.x)),
        y: Math.max(bounds.minY, Math.min(bounds.maxY, rendered.y)),
      } : {}),
      moving: false,
      transitionMs: 0,
    };
    motionRef.current = { ...motionRef.current, [id]: stopped };
    setMotion((current) => ({ ...current, [id]: stopped }));
  }, []);

  const cancelInteraction = useCallback((
    id: GardenCompanionId,
    event?: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const session = pressSessions.current[id];
    if (session?.timer) clearTimeout(session.timer);
    delete pressSessions.current[id];
    const finiteSession = keyboardTimers.current[id];
    if (finiteSession) clearTimeout(finiteSession.timer);
    delete keyboardTimers.current[id];
    interactionTokens.current[id] += 1;
    setCompanionPressed(id, false);
    setCompanionLifted(id, false);
    if (event && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, [setCompanionLifted, setCompanionPressed]);

  const startFinitePickup = useCallback((id: GardenCompanionId) => {
    cancelInteraction(id);
    stopCompanionMotion(id);
    setCompanionPressed(id, true);
    setCompanionLifted(id, true);
    const token = interactionTokens.current[id];
    const timer = setTimeout(() => {
      if (interactionTokens.current[id] !== token || keyboardTimers.current[id]?.token !== token) return;
      delete keyboardTimers.current[id];
      setCompanionPressed(id, false);
      setCompanionLifted(id, false);
    }, KEYBOARD_PICKUP_MS);
    keyboardTimers.current[id] = { token, timer };
  }, [cancelInteraction, setCompanionLifted, setCompanionPressed, stopCompanionMotion]);

  const beginPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelInteraction(id);
    stopCompanionMotion(id);
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
    }, LONG_PRESS_MS);
    pressSessions.current[id] = session;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [cancelInteraction, setCompanionLifted, setCompanionPressed, stopCompanionMotion]);

  const movePointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pressSessions.current[id];
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.activated) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance > LONG_PRESS_MOVE_TOLERANCE) cancelInteraction(id, event);
      return;
    }

    const bounds = sceneRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    const sceneSize = { width: bounds.width, height: bounds.height };
    const physicalBounds = getPhysicalGardenBounds(bounds.width, bounds.height);
    const point = {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    };
    const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
    const otherRendered = companionPositionRefs.current[otherId]?.getBoundingClientRect();
    const other = (otherRendered ? renderedGardenPoint(otherRendered, bounds) : null) ?? motionRef.current[otherId];
    const constrained = constrainCompanionPoint(point, other, sceneSize, physicalBounds);
    const dragged = { ...motionRef.current[id], ...constrained, moving: false, transitionMs: 0 };
    motionRef.current = { ...motionRef.current, [id]: dragged };
    setMotion((current) => ({ ...current, [id]: dragged }));
  }, [cancelInteraction]);

  const endPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelInteraction(id, event);
  }, [cancelInteraction]);

  const keyboardPickup = useCallback((id: GardenCompanionId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.repeat) return;
    startFinitePickup(id);
  }, [startFinitePickup]);

  const semanticPickup = useCallback((id: GardenCompanionId, event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return;
    startFinitePickup(id);
  }, [startFinitePickup]);

  useEffect(() => {
    if (state.isAvailable) return;
    cancelInteraction('peach');
    cancelInteraction('sage');
  }, [cancelInteraction, state.isAvailable]);

  const unavailableCopy = unavailableReason === 'shared_unavailable'
    ? '공유 정보를 확인하는 중이에요. 확인되면 정원을 다시 보여드려요.'
    : unavailableReason === 'inactive_couple'
      ? '커플 연결이 확인되면 정원이 자라기 시작해요.'
      : '함께한 날을 설정하면 정원이 자라기 시작해요.';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AppBar
        title={<span className="sr-only">정원</span>}
        onBack={onBack}
        backLabel="이전 화면으로"
      />

      {state.isAvailable ? (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="정원 현황">
          <div className="garden-landscape-summary px-4 pb-3 pt-4">
            <p className="text-caption font-medium text-muted-foreground">함께한 {state.togetherDays}일</p>
          </div>

          <div
            ref={sceneRef}
            data-testid="garden-scene"
            className="garden-landscape-scene relative min-h-0 flex-1 overflow-hidden border-y border-border bg-card"
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
              onPointerCancel={endPointerPickup}
              onLostPointerCapture={endPointerPickup}
              onKeyDown={keyboardPickup}
              onClick={semanticPickup}
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
              onPointerCancel={endPointerPickup}
              onLostPointerCapture={endPointerPickup}
              onKeyDown={keyboardPickup}
              onClick={semanticPickup}
              positionRef={(node) => {
                if (node) companionPositionRefs.current.sage = node;
                else delete companionPositionRefs.current.sage;
              }}
            />
          </div>
        </section>
      ) : (
        <section
          className="m-4 my-auto rounded-surface border border-border bg-card p-8 text-center"
          aria-label={unavailableReason === 'shared_unavailable' ? '정원 확인 중' : '정원 준비 안내'}
        >
          <Sprout size={32} className="mx-auto text-muted-foreground" aria-hidden="true" />
          <p className="mt-4 text-body font-semibold text-foreground">{unavailableCopy}</p>
        </section>
      )}
    </div>
  );
}
