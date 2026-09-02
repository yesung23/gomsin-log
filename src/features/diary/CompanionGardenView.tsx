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

const INITIAL_MOTION: MotionMap = {
  peach: { x: 26, y: 78, moving: false, moveCount: 0, transitionMs: 0 },
  sage: { x: 74, y: 74, moving: false, moveCount: 0, transitionMs: 0 },
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;
const BUTTON_MOVE_STEP = 8;
// A compatibility click can arrive after pointer capture has already been released.
// Keep the guard alive long enough for delayed touch/mouse synthesis; a fresh
// pointerdown explicitly clears it so the user's next deliberate tap is never lost.
const SUPPRESSED_CLICK_FALLBACK_MS = 1_000;

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

type PressSession = {
  pointerId: number;
  startX: number;
  startY: number;
  activated: boolean;
  token: number;
  timer?: ReturnType<typeof setTimeout>;
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
  const renderFrame = (phase: 'idle' | 'walk' | 'lift', className: string, testId: string) => (
    <svg
      data-testid={phase === 'idle' ? `garden-exact-character-${companion}` : testId}
      data-garden-pose={phase}
      viewBox={CHARACTER_POSE_CROPS[companion][phase]}
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
      <svg viewBox="0 0 72 82" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <GardenAccessoryGlyph companion={companion} accessory={accessory} />
      </svg>
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
        aria-label={`${label} 친구와 함께 놀기. 길게 눌러 직접 이동`}
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
  ownedAccessories = [],
  onAccessoryChange,
  onBack,
  onOpenShop,
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
  const interactionTokens = useRef<Record<GardenCompanionId, number>>({ peach: 0, sage: 0 });
  const suppressedClicks = useRef<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const suppressedClickTimers = useRef<Partial<Record<GardenCompanionId, ReturnType<typeof setTimeout>>>>({});
  const actionSheetTriggerRef = useRef<HTMLElement | null>(null);
  const [actionSheetCompanion, setActionSheetCompanion] = useState<GardenCompanionId | null>(null);
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
    if (!state.isAvailable || reducedMotion || actionSheetCompanion) {
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
  }, [actionSheetCompanion, reducedMotion, state.isAvailable]);

  useEffect(() => () => {
    for (const session of Object.values(pressSessions.current)) {
      if (session?.timer) clearTimeout(session.timer);
    }
    for (const timer of Object.values(suppressedClickTimers.current)) {
      if (timer) clearTimeout(timer);
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
    interactionTokens.current[id] += 1;
    setCompanionPressed(id, false);
    setCompanionLifted(id, false);
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
    cancelInteraction(id);
    stopCompanionMotion('peach');
    stopCompanionMotion('sage');
    actionSheetTriggerRef.current = trigger;
    setActionSheetCompanion(id);
  }, [cancelInteraction, stopCompanionMotion]);

  const beginPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearSuppressedClick(id);
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
  }, [cancelInteraction, clearSuppressedClick, setCompanionLifted, setCompanionPressed, stopCompanionMotion]);

  const movePointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = pressSessions.current[id];
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.activated) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance > LONG_PRESS_MOVE_TOLERANCE) {
        suppressNextClick(id);
        cancelInteraction(id, event);
      }
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
  }, [cancelInteraction, suppressNextClick]);

  const endPointerPickup = useCallback((id: GardenCompanionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pressSessions.current[id]?.activated) suppressNextClick(id);
    cancelInteraction(id, event);
  }, [cancelInteraction, suppressNextClick]);

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
    stopCompanionMotion(id);
    const sceneBounds = sceneRef.current?.getBoundingClientRect();
    const sceneSize = sceneBounds && sceneBounds.width > 0 && sceneBounds.height > 0
      ? { width: sceneBounds.width, height: sceneBounds.height }
      : { width: 320, height: 600 };
    const bounds = getPhysicalGardenBounds(sceneSize.width, sceneSize.height);
    const current = motionRef.current[id];
    const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
    const delta = {
      up: { x: 0, y: -BUTTON_MOVE_STEP },
      down: { x: 0, y: BUTTON_MOVE_STEP },
      left: { x: -BUTTON_MOVE_STEP, y: 0 },
      right: { x: BUTTON_MOVE_STEP, y: 0 },
    }[direction];
    const nextPoint = constrainCompanionPoint(
      { x: current.x + delta.x, y: current.y + delta.y },
      motionRef.current[otherId],
      sceneSize,
      bounds,
    );
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
  }, [reducedMotion, stopCompanionMotion]);

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AppBar
        title={<span className="sr-only">정원</span>}
        onBack={onBack}
        backLabel="이전 화면으로"
        actions={state.isAvailable ? (
          <button
            type="button"
            onClick={(event) => openActionSheet('peach', event.currentTarget)}
            aria-label="꾸미기와 함께 놀기"
            className="press-response inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-caption font-semibold text-foreground"
          >
            <Palette size={17} aria-hidden="true" />
            함께 놀기
          </button>
        ) : undefined}
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
              onKeyDown={keyboardAction}
              onClick={clickAction}
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
              onKeyDown={keyboardAction}
              onClick={clickAction}
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
