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
import { ChevronDown, Palette, ShoppingBag, Sprout } from 'lucide-react';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { cn } from '@/lib/utils';
import paperPairAsset from '@/assets/characters/paper-pair-v1.webp';
import {
  DEFAULT_GARDEN_ACCESSORIES,
  GARDEN_ACCESSORY_OPTIONS,
  type GardenAccessory,
  type GardenAccessoryState,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import type { CollectibleGardenAccessory } from '@/lib/companionShopLocalState';
import type { CompanionGardenStageLevel, CompanionGardenState } from './companionGarden';
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
  onAccessoryChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => void;
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
const KEYBOARD_PICKUP_MS = 900;

const CHARACTER_CROPS: Record<GardenCompanionId, string> = {
  peach: '20 515 136 155',
  sage: '156 514 138 155',
};

export const GARDEN_OBJECT_REGISTRY = [
  { id: 'growth-tree', kind: 'tree', interaction: 'growth-stage' },
] as const;

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

function GardenPlant({ level }: { level: CompanionGardenStageLevel }) {
  const canopy = level === 1 ? 18 : level === 2 ? 30 : level === 3 ? 42 : 48;
  const trunkHeight = level === 1 ? 20 : level === 2 ? 34 : level === 3 ? 50 : 58;
  return (
    <svg viewBox="0 0 120 150" className="h-full w-full" aria-hidden="true">
      <path d="M12 127 Q60 112 108 127" stroke="var(--ink-faint)" strokeWidth="2" fill="none" />
      <path d={`M60 126 V${126 - trunkHeight}`} stroke="var(--ink)" strokeWidth={level === 1 ? 4 : 8} strokeLinecap="round" />
      {level === 1 ? (
        <>
          <path d="M60 106 Q48 96 40 104 Q50 113 60 111" fill="var(--coral-fill)" stroke="var(--ink)" strokeWidth="1.5" />
          <path d="M60 102 Q72 93 81 101 Q72 110 60 109" fill="var(--color-background-green)" stroke="var(--ink)" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <circle cx="60" cy={68 - level * 4} r={canopy} fill="var(--color-background-green)" stroke="var(--ink)" strokeWidth="2" />
          <circle cx="42" cy={70 - level * 3} r={Math.max(15, canopy * 0.62)} fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx="79" cy={70 - level * 3} r={Math.max(15, canopy * 0.62)} fill="var(--color-background-green)" stroke="var(--ink)" strokeWidth="1.5" />
          {level === 4 ? [36, 52, 70, 84].map((x, index) => (
            <circle key={x} cx={x} cy={45 + (index % 2) * 18} r="4" fill="var(--coral)" />
          )) : null}
        </>
      )}
    </svg>
  );
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
        return <circle key={petal} cx={51 + Math.cos(angle) * 5} cy={25 + Math.sin(angle) * 5} r="3.3" fill="var(--coral-fill)" stroke="var(--ink)" strokeWidth="0.8" />;
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
    <span className={cn('relative block h-[112px] w-[98px] drop-shadow-sm', moving && !lifted && 'garden-companion-walking')}>
      <svg
        data-testid={`garden-exact-character-${companion}`}
        viewBox={CHARACTER_CROPS[companion]}
        className="garden-exact-character h-full w-full"
        aria-hidden="true"
      >
        <image href={paperPairAsset} width="1254" height="1254" pointerEvents="none" />
      </svg>
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

function AccessoryGroup({
  companion,
  label,
  value,
  ownedAccessories,
  onChange,
}: {
  companion: GardenCompanionId;
  label: string;
  value: GardenAccessory;
  ownedAccessories: readonly CollectibleGardenAccessory[];
  onChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => void;
}) {
  return (
    <div role="radiogroup" aria-label={`${label} 친구 액세서리`} className="space-y-2">
      <p className="text-caption font-semibold text-foreground">{label} 친구</p>
      <div className="flex flex-wrap gap-2">
        {GARDEN_ACCESSORY_OPTIONS
          .filter(({ id }) => id === 'none' || ownedAccessories.includes(id))
          .map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            aria-label={`${label} 친구 ${option.label}`}
            onClick={() => onChange?.(companion, option.id)}
            className={cn(
              'press-response inline-flex min-h-11 cursor-pointer items-center rounded-control border px-3 text-caption font-semibold',
              value === option.id
                ? 'border-coral-strong bg-coral-fill text-coral-fill-foreground'
                : 'border-border bg-card text-foreground',
            )}
          >
            {option.label}
          </button>
          ))}
      </div>
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
  const keyboardTimers = useRef<Partial<Record<GardenCompanionId, FinitePickupSession>>>({});
  const interactionTokens = useRef<Record<GardenCompanionId, number>>({ peach: 0, sage: 0 });
  const [decorating, setDecorating] = useState(false);

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
        title="우리 정원"
        onBack={onBack}
        backLabel="이전 화면으로"
        actions={onOpenShop ? (
          <AppBarAction aria-label="상점 열기" onClick={onOpenShop}>
            <ShoppingBag size={20} aria-hidden="true" />
          </AppBarAction>
        ) : undefined}
      />

      {state.isAvailable ? (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="정원 현황">
          <div className="garden-landscape-summary px-4 pb-3 pt-4">
            <p className="text-caption font-medium text-muted-foreground">함께한 {state.togetherDays}일</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-title font-bold text-foreground">{state.stage.name}</h2>
                <p className="garden-landscape-stage-copy mt-1 text-body leading-relaxed text-muted-foreground">{state.stage.copy}</p>
              </div>
              <button
                type="button"
                onClick={() => setDecorating((value) => !value)}
                aria-expanded={decorating}
                aria-controls="garden-decoration-panel"
                className="press-response inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control px-3 text-caption font-semibold text-foreground"
              >
                <Palette size={15} aria-hidden="true" />
                정원 꾸미기
                <ChevronDown size={15} className={cn('transition-transform', decorating && 'rotate-180')} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            ref={sceneRef}
            data-testid="garden-scene"
            className="garden-landscape-scene relative min-h-0 flex-1 overflow-hidden border-y border-border bg-card"
          >
            <div className="absolute inset-x-[28%] bottom-[20%] top-[7%]" data-scene-object={GARDEN_OBJECT_REGISTRY[0].id}>
              <GardenPlant level={state.stage.level} />
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[34%] border-t border-border bg-secondary/40" aria-hidden="true" />
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
            <p className="pointer-events-none absolute inset-x-4 bottom-3 text-center text-caption text-muted-foreground">
              길게 누르면 친구를 들어 올려 움직일 수 있어요.
            </p>
          </div>

          {decorating ? (
            <div
              id="garden-decoration-panel"
              role="region"
              aria-label="정원 꾸미기"
              className="space-y-4 border-b border-border bg-background px-4 py-4"
            >
              <p className="text-caption text-muted-foreground">가지고 있는 무료 장식만 보여요. 선택은 이 계정의 이 기기에 저장돼요.</p>
              <AccessoryGroup companion="peach" label="첫째" value={accessories.peach} ownedAccessories={ownedAccessories} onChange={onAccessoryChange} />
              <AccessoryGroup companion="sage" label="둘째" value={accessories.sage} ownedAccessories={ownedAccessories} onChange={onAccessoryChange} />
              {onOpenShop ? (
                <button
                  type="button"
                  onClick={onOpenShop}
                  className="press-response inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-caption font-semibold text-foreground"
                >
                  <ShoppingBag size={16} aria-hidden="true" />
                  장식 더 받으러 가기
                </button>
              ) : null}
            </div>
          ) : null}

          <p className="garden-landscape-footer px-4 py-3 text-caption text-muted-foreground">정원은 점수나 미션 없이 함께한 시간만 따라 자라요.</p>
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
