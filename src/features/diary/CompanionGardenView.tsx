import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Palette, Sprout } from 'lucide-react';
import { AppBar } from '@/components/ui/AppBar';
import { cn } from '@/lib/utils';
import {
  DEFAULT_GARDEN_ACCESSORIES,
  GARDEN_ACCESSORY_OPTIONS,
  type GardenAccessory,
  type GardenAccessoryState,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import type { CompanionGardenStageLevel, CompanionGardenState } from './companionGarden';
import {
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
  onAccessoryChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => void;
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
  tone,
  accessory,
  moving,
  lifted,
}: {
  companion: GardenCompanionId;
  tone: 'peach' | 'sage';
  accessory: GardenAccessory;
  moving: boolean;
  lifted: boolean;
}) {
  const fill = tone === 'peach' ? 'var(--coral-fill)' : 'var(--color-background-green)';
  return (
    <svg
      viewBox="0 0 72 82"
      className={cn('h-[72px] w-[64px] drop-shadow-sm', moving && !lifted && 'garden-companion-walking')}
      aria-hidden="true"
    >
      <path d="M17 69 Q13 51 18 30 Q21 13 36 12 Q52 13 55 31 Q58 52 53 69 Q44 77 35 77 Q25 77 17 69Z" fill={fill} stroke="var(--ink)" strokeWidth="2" />
      <circle cx="29" cy="40" r="2.2" fill="var(--ink)" />
      <circle cx="44" cy="40" r="2.2" fill="var(--ink)" />
      <path d="M31 50 Q36 54 41 50" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <path d="M22 66 Q17 75 13 70" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M50 66 Q55 75 59 70" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <GardenAccessoryGlyph companion={companion} accessory={accessory} />
    </svg>
  );
}

function GardenCompanion({
  id,
  label,
  tone,
  motion,
  accessory,
  lifted,
  onLift,
}: {
  id: GardenCompanionId;
  label: string;
  tone: 'peach' | 'sage';
  motion: CompanionMotion;
  accessory: GardenAccessory;
  lifted: boolean;
  onLift: (id: GardenCompanionId) => void;
}) {
  return (
    <div
      className="garden-companion-position absolute z-10"
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
        onClick={() => onLift(id)}
        aria-label={`${label} 친구 들어올리기`}
        data-testid={`garden-companion-${id}`}
        data-companion={id}
        data-accessory={accessory}
        data-x={motion.x.toFixed(2)}
        data-y={motion.y.toFixed(2)}
        data-move-count={motion.moveCount}
        data-wandering={String(motion.moving)}
        data-lifted={String(lifted)}
        className={cn(
          'press-response inline-flex min-h-11 min-w-11 items-end justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          lifted && 'garden-companion-lifted',
        )}
      >
        <CompanionGlyph companion={id} tone={tone} accessory={accessory} moving={motion.moving} lifted={lifted} />
      </button>
    </div>
  );
}

function AccessoryGroup({
  companion,
  label,
  value,
  onChange,
}: {
  companion: GardenCompanionId;
  label: string;
  value: GardenAccessory;
  onChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => void;
}) {
  return (
    <div role="radiogroup" aria-label={`${label} 친구 액세서리`} className="space-y-2">
      <p className="text-caption font-semibold text-foreground">{label} 친구</p>
      <div className="flex flex-wrap gap-2">
        {GARDEN_ACCESSORY_OPTIONS.map((option) => (
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
  onAccessoryChange,
  onBack,
}: CompanionGardenViewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [motion, setMotion] = useState<MotionMap>(INITIAL_MOTION);
  const motionRef = useRef<MotionMap>(INITIAL_MOTION);
  const [lifted, setLifted] = useState<Record<GardenCompanionId, boolean>>({ peach: false, sage: false });
  const liftTimers = useRef<Partial<Record<GardenCompanionId, ReturnType<typeof setTimeout>>>>({});
  const [decorating, setDecorating] = useState(false);

  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

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
        const otherId: GardenCompanionId = id === 'peach' ? 'sage' : 'peach';
        const current = motionRef.current[id];
        const other = motionRef.current[otherId];
        const destination = pickGardenDestination(current, other);
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
    for (const timer of Object.values(liftTimers.current)) {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const liftCompanion = useCallback((id: GardenCompanionId) => {
    const previous = liftTimers.current[id];
    if (previous) clearTimeout(previous);
    setLifted((current) => ({ ...current, [id]: true }));
    liftTimers.current[id] = setTimeout(() => {
      setLifted((current) => ({ ...current, [id]: false }));
      delete liftTimers.current[id];
    }, 900);
  }, []);

  const unavailableCopy = unavailableReason === 'shared_unavailable'
    ? '공유 정보를 확인하는 중이에요. 확인되면 정원을 다시 보여드려요.'
    : unavailableReason === 'inactive_couple'
      ? '커플 연결이 확인되면 정원이 자라기 시작해요.'
      : '함께한 날을 설정하면 정원이 자라기 시작해요.';

  return (
    <div className="min-h-full pb-24">
      <AppBar title="우리 정원" onBack={onBack} backLabel="이전 화면으로" />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-4">
        {state.isAvailable ? (
          <section className="space-y-4" aria-label="정원 현황">
            <div className="space-y-1.5">
              <p className="text-caption font-medium text-muted-foreground">함께한 {state.togetherDays}일</p>
              <h2 className="text-title font-bold text-foreground">{state.stage.name}</h2>
              <p className="text-body leading-relaxed text-muted-foreground">{state.stage.copy}</p>
            </div>

            <div
              data-testid="garden-scene"
              className="relative aspect-[4/3] w-full overflow-hidden rounded-surface border border-border bg-card"
            >
              <div className="absolute inset-x-[28%] bottom-[22%] top-[8%]">
                <GardenPlant level={state.stage.level} />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-[32%] border-t border-border bg-secondary/40" aria-hidden="true" />
              <GardenCompanion
                id="peach"
                label="분홍"
                tone="peach"
                motion={motion.peach}
                accessory={accessories.peach}
                lifted={lifted.peach}
                onLift={liftCompanion}
              />
              <GardenCompanion
                id="sage"
                label="초록"
                tone="sage"
                motion={motion.sage}
                accessory={accessories.sage}
                lifted={lifted.sage}
                onLift={liftCompanion}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-caption text-muted-foreground">두 친구를 눌러 보면 들어 올려져 버둥대요.</p>
              <button
                type="button"
                onClick={() => setDecorating((value) => !value)}
                aria-expanded={decorating}
                aria-controls="garden-decoration-panel"
                className="press-response inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control border border-border bg-card px-3 text-caption font-semibold text-foreground"
              >
                <Palette size={15} aria-hidden="true" />
                정원 꾸미기
                <ChevronDown size={15} className={cn('transition-transform', decorating && 'rotate-180')} aria-hidden="true" />
              </button>
            </div>

            {decorating ? (
              <div
                id="garden-decoration-panel"
                role="region"
                aria-label="정원 꾸미기"
                className="space-y-4 rounded-surface border border-border bg-card p-4"
              >
                <p className="text-caption text-muted-foreground">무료 장식이에요. 선택은 이 계정의 이 기기에만 저장돼요.</p>
                <AccessoryGroup companion="peach" label="분홍" value={accessories.peach} onChange={onAccessoryChange} />
                <AccessoryGroup companion="sage" label="초록" value={accessories.sage} onChange={onAccessoryChange} />
              </div>
            ) : null}

            <p className="text-caption text-muted-foreground">정원은 점수나 미션 없이 함께한 시간만 따라 자라요.</p>
          </section>
        ) : (
          <section
            className="my-auto rounded-surface border border-border bg-card p-8 text-center"
            aria-label={unavailableReason === 'shared_unavailable' ? '정원 확인 중' : '정원 준비 안내'}
          >
            <Sprout size={32} className="mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="mt-4 text-body font-semibold text-foreground">{unavailableCopy}</p>
          </section>
        )}
      </div>
    </div>
  );
}
