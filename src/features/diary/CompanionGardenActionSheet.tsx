import { useCallback, useRef, useState, type RefObject } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ShoppingBag, X } from 'lucide-react';
import { useDialogFocus } from '@/lib/useDialogFocus';
import { useSheetDrag } from '@/lib/useSheetDrag';
import { cn } from '@/lib/utils';
import {
  GARDEN_ACCESSORY_OPTIONS,
  type GardenAccessory,
  type GardenAccessoryState,
  type GardenCompanionId,
} from '@/lib/companionGardenLocalState';
import type { CollectibleGardenAccessory } from '@/lib/companionShopLocalState';

export type GardenMoveDirection = 'up' | 'down' | 'left' | 'right';

const COMPANION_LABELS: Record<GardenCompanionId, string> = {
  peach: '첫째',
  sage: '둘째',
};

const DIRECTION_LABELS: Record<GardenMoveDirection, string> = {
  up: '위쪽',
  down: '아래쪽',
  left: '왼쪽',
  right: '오른쪽',
};

interface CompanionGardenActionSheetProps {
  companion: GardenCompanionId;
  triggerRef: RefObject<HTMLElement | null>;
  accessories: GardenAccessoryState;
  ownedAccessories: readonly CollectibleGardenAccessory[];
  onSelectCompanion: (companion: GardenCompanionId) => void;
  onAccessoryChange?: (companion: GardenCompanionId, accessory: GardenAccessory) => boolean;
  onMove: (direction: GardenMoveDirection) => boolean;
  onClose: () => void;
  onOpenShop?: () => void;
}

type SheetFeedback = {
  kind: 'status' | 'alert';
  message: string;
};

export function CompanionGardenActionSheet({
  companion,
  triggerRef,
  accessories,
  ownedAccessories,
  onSelectCompanion,
  onAccessoryChange,
  onMove,
  onClose,
  onOpenShop,
}: CompanionGardenActionSheetProps) {
  const label = COMPANION_LABELS[companion];
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [feedback, setFeedback] = useState<SheetFeedback | null>(null);
  const { sheetRef, handleProps } = useSheetDrag({ onDismiss: onClose });

  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    sheetRef.current = node;
  }, [sheetRef]);

  useDialogFocus({
    active: true,
    panelRef,
    restoreFocusRef: triggerRef,
    onClose,
  });

  const move = (direction: GardenMoveDirection) => {
    const moved = onMove(direction);
    setFeedback({
      kind: 'status',
      message: moved
        ? `${label} 친구를 ${DIRECTION_LABELS[direction]}으로 옮겼어요.`
        : `${label} 친구는 ${DIRECTION_LABELS[direction]}으로 더 움직일 수 없어요.`,
    });
  };

  const chooseAccessory = (accessory: GardenAccessory) => {
    if (!onAccessoryChange) return;
    const persisted = onAccessoryChange(companion, accessory);
    setFeedback(persisted
      ? { kind: 'status', message: `${label} 친구 장식을 바꿨어요.` }
      : {
          kind: 'alert',
          message: '장식을 저장하지 못했어요. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요.',
        });
  };

  const directions: readonly {
    id: GardenMoveDirection;
    Icon: typeof ArrowUp;
    gridClass: string;
  }[] = [
    { id: 'up', Icon: ArrowUp, gridClass: 'col-start-2 row-start-1' },
    { id: 'left', Icon: ArrowLeft, gridClass: 'col-start-1 row-start-2' },
    { id: 'right', Icon: ArrowRight, gridClass: 'col-start-3 row-start-2' },
    { id: 'down', Icon: ArrowDown, gridClass: 'col-start-2 row-start-3' },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        aria-hidden="true"
        data-testid="garden-action-sheet-backdrop"
      />
      <div
        ref={attachPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="garden-action-sheet-title"
        className="fixed inset-x-0 bottom-0 z-[60] max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-2 shadow-2xl animate-in slide-in-from-bottom-full"
      >
        <div
          {...handleProps}
          aria-hidden="true"
          className="mb-1 flex justify-center pb-1 pt-2 cursor-grab active:cursor-grabbing"
        >
          <span aria-hidden="true" className="block h-1 w-9 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 id="garden-action-sheet-title" className="text-heading font-semibold text-foreground">
            {label} 친구와 함께 놀기
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`${label} 친구와 함께 놀기 닫기`}
            className="press-response flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div role="group" className="mt-3 grid grid-cols-2 gap-2" aria-label="함께 놀 친구 선택">
          {(['peach', 'sage'] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={companion === id}
              onClick={() => {
                setFeedback(null);
                onSelectCompanion(id);
              }}
              className={cn(
                'press-response min-h-11 rounded-control border px-3 text-label font-semibold',
                companion === id
                  ? 'border-coral-strong bg-coral-fill text-coral-fill-foreground'
                  : 'border-border text-foreground',
              )}
            >
              {COMPANION_LABELS[id]} 친구
            </button>
          ))}
        </div>

        <section className="mt-3" aria-labelledby="garden-move-title">
          <h3 id="garden-move-title" className="text-label font-semibold text-foreground">친구 움직이기</h3>
          <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
            방향을 골라 정원 안에서 한 칸씩 움직여요.
          </p>
          <div role="group" className="mx-auto mt-3 grid w-fit grid-cols-3 grid-rows-3 gap-2" aria-label={`${label} 친구 이동 방향`}>
            {directions.map(({ id, Icon, gridClass }) => (
              <button
                key={id}
                type="button"
                onClick={() => move(id)}
                aria-label={`${label} 친구 ${DIRECTION_LABELS[id]}으로 이동`}
                className={`press-response ${gridClass} flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border text-foreground`}
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4" aria-labelledby="garden-accessory-title">
          <h3 id="garden-accessory-title" className="text-label font-semibold text-foreground">친구 꾸미기</h3>
          <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
            상점에서 받은 무료 장식만 보여요. 선택은 이 계정의 이 기기에 저장돼요.
          </p>
          <div role="radiogroup" aria-label={`${label} 친구 액세서리`} className="mt-3 flex flex-wrap gap-2">
            {GARDEN_ACCESSORY_OPTIONS
              .filter(({ id }) => id === 'none' || ownedAccessories.includes(id))
              .map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    'press-response inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control border px-3 text-caption font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-ring',
                    accessories[companion] === option.id
                      ? 'border-coral-strong bg-coral-fill text-coral-fill-foreground'
                      : 'border-border text-foreground',
                  )}
                >
                  <input
                    type="radio"
                    name={`garden-accessory-${companion}`}
                    value={option.id}
                    checked={accessories[companion] === option.id}
                    onChange={() => chooseAccessory(option.id)}
                    aria-label={`${label} 친구 ${option.label}`}
                    className="sr-only"
                  />
                  <span aria-hidden="true">{option.label}</span>
                </label>
              ))}
          </div>
          {onOpenShop ? (
            <button
              type="button"
              onClick={onOpenShop}
              className="press-response mt-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-caption font-semibold text-foreground"
            >
              <ShoppingBag size={16} aria-hidden="true" />
              장식 더 받으러 가기
            </button>
          ) : null}
        </section>

        {feedback ? (
          <p
            role={feedback.kind}
            aria-live={feedback.kind === 'alert' ? 'assertive' : 'polite'}
            aria-atomic="true"
            className="mt-3 text-label text-foreground"
          >
            {feedback.message}
          </p>
        ) : null}
      </div>
    </>
  );
}
