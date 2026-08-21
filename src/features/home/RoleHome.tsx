import { useMemo, useState } from 'react';
import { WaitingPeriodRevealCard } from '@/components/WaitingPeriodRevealCard';
import { useStore } from '@/lib/useStore';
import { Plus, LayoutGrid } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { WidgetWrapper } from '@/components/widgets/WidgetWrapper';
import {
  DEFAULT_LAYOUT_BY_ROLE,
  HOME_CORE_BY_ROLE,
  WIDGET_REGISTRY,
  isHomeCore,
  isWidgetAllowedForRole,
  widgetsForRole,
} from '@/lib/widgets';
import type { Role } from '@/types';
import { AddWidgetBottomSheet } from '@/components/widgets/AddWidgetBottomSheet';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { CallBriefingWidget } from '@/components/widgets/CallBriefingWidget';

/**
 * The home screen, shaped by what this person came here to do.
 *
 * ## Why two shapes and not one arrangeable board
 *
 * The two roles have opposite jobs. 곰신 has their phone all day and is CAPTURING;
 * 군화 gets a short window and is CATCHING UP, usually just before a call. One
 * dashboard with different default cards treated that as a preference. It is not
 * a preference -- it is what the screen is for, and PRODUCT_V3 §6 says so
 * directly: 홈을 무관한 카드의 대시보드로 만들지 않는다.
 *
 * So the surfaces that answer that question are PINNED (`HOME_CORE_BY_ROLE`):
 * above the widgets, in role order, without drag chrome, and not removable. The
 * widget layer is kept underneath, because being able to arrange the rest is
 * real and taking it away would be removing something people have.
 *
 * The lesson from `SoldierDashboard`'s removal was misread once already. It was
 * not "a home must be customisable" -- it was "that screen was bad". Two purposes
 * were then merged into one engine, which is how the person with the scarce phone
 * window ended up with no composer on their home at all (§5.1 requires one for
 * both roles; the soldier default simply omitted it).
 */
export function RoleHome() {
  const { state, setWidgetLayout } = useStore();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);

  /**
   * One dashboard, two roles.
   *
   * The 군화 home used to be a separate hardcoded component with no widget system
   * at all -- it could not be reordered, added to or trimmed, which is exactly what
   * was asked for. Both roles now run this same engine and differ only in their
   * default layout and in which widgets they are offered.
   */
  const role: Role = state.profile.role;
  const storedLayout = role === 'soldier' ? state.soldierWidgetLayout : state.widgetLayout;

  /**
   * Which person, in which relationship, is looking at this dashboard.
   *
   * This is REACT LIFECYCLE IDENTITY, not a widget id: it goes in the `key` only.
   * The `id` prop, the `SortableContext` items and the persisted layout all stay
   * the plain widget id, because those are what drag-and-drop and storage mean.
   *
   * Widgets that hold relationship-scoped state read it once on mount -- a
   * checkpoint, a read receipt, a briefing cutoff. The dashboard is NOT unmounted
   * by an identity change: `purgeSharedAccess` clears `profile.couple.coupleId`
   * through a state replacement, and signing into an existing account keeps
   * `setupComplete` true, so `App` never leaves the authenticated route branch. A
   * widget keyed by its id alone therefore survived
   *
   *     Account A / Couple A  ->  Account B / Couple B
   *
   * still holding A's checkpoint, and applied A's confirmed set and date bound to
   * B's records -- hiding context in the new relationship that nobody had seen,
   * and then persisting A-derived values under B's storage key on the next
   * acknowledgement. Scoping the STORAGE key by viewer and couple did not help,
   * because the stale value was already in React state.
   *
   * `CallBriefingWidget` below has carried this key since it gained its own
   * checkpoint. Extending it to every widget closes the same hole for
   * `partner_day` and `care_hint`, and for anything added later that caches
   * identity-scoped state on mount.
   */
  const viewerUserId = state.authenticatedUser?.id || state.profile.id || '';
  const coupleId = state.profile.couple.coupleId || '';
  const viewerIdentity = `${viewerUserId}:${coupleId}`;

  /**
   * The arrangeable layer.
   *
   * Drops ids that are unknown OR not meant for this role, so a role switch cannot
   * leave "상대방의 마음 흐름" on the screen of the person it describes -- and now
   * also drops anything the core already pins, so a layout saved before the core
   * existed does not render 상대방의 오늘 twice. Filtered rather than rewritten:
   * a layout is the user's arrangement, and quietly editing it to match a
   * structural change is not ours to do.
   */
  const activeWidgets = useMemo(() => {
    const usable = (storedLayout ?? []).filter(
      (id: string) => WIDGET_REGISTRY[id] && isWidgetAllowedForRole(id, role),
    );
    const base = usable.length > 0 ? usable : DEFAULT_LAYOUT_BY_ROLE[role];
    return base.filter((id: string) => !isHomeCore(id, role));
  }, [storedLayout, role]);

  /** The pinned surfaces, in the order this role reads them. */
  const coreSurfaces = useMemo(
    () => HOME_CORE_BY_ROLE[role]
      .map((id) => ({
        id,
        // `call_briefing` is deliberately outside the registry -- it was never
        // arrangeable, and giving it an entry would offer to remove it.
        Component: id === 'call_briefing'
          ? CallBriefingWidget
          : WIDGET_REGISTRY[id]?.component,
      }))
      .filter((entry): entry is { id: string; Component: NonNullable<typeof entry.Component> } =>
        Boolean(entry.Component)),
    [role],
  );

  const persist = (layout: string[]) => setWidgetLayout(layout, role);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = activeWidgets.indexOf(active.id as string);
      const newIndex = activeWidgets.indexOf(over.id as string);
      const newLayout = arrayMove(activeWidgets, oldIndex, newIndex);
      persist(newLayout);
    }
  };

  const handleRemoveWidget = (id: string) => {
    persist(activeWidgets.filter((w: string) => w !== id));
  };

  /**
   * What a screen reader hears while reordering widgets by keyboard.
   *
   * dnd-kit ships defaults, but they are English and they name the raw sortable
   * id, so a Korean user heard "Draggable item partner_emotion_flow was moved
   * over droppable area today_word". WCAG 2.1 SC 4.1.3.
   */
  const widgetName = (id: string | number) => WIDGET_REGISTRY[String(id)]?.label ?? String(id);
  const positionOf = (id: string | number) => activeWidgets.indexOf(String(id)) + 1;
  const announcements = useMemo(() => ({
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `${widgetName(active.id)} 위젯을 집었습니다. 방향키로 옮기고, 스페이스나 엔터로 놓으세요.`,
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `${widgetName(active.id)} 위젯을 ${positionOf(over.id)}번째 위치로 옮기는 중입니다.`
        : `${widgetName(active.id)} 위젯이 놓을 수 없는 위치에 있습니다.`,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `${widgetName(active.id)} 위젯을 ${positionOf(over.id)}번째에 놓았습니다.`
        : `${widgetName(active.id)} 위젯을 제자리에 두었습니다.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `${widgetName(active.id)} 위젯 이동을 취소했습니다.`,
  // `activeWidgets` is read through the closures above, so the announcements must
  // be rebuilt when the layout changes or they would report stale positions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeWidgets]);

  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null);

  const handleTouchStart = () => {
    const timer = setTimeout(() => {
      setIsEditMode(true);
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(50);
      }
    }, 500);
    setPressTimer(timer);
  };

  const handleTouchEnd = () => {
    if (pressTimer) clearTimeout(pressTimer);
  };

  return (
    <div className="pb-6">
      {/* Header — compact, low-chrome: app name + edit controls only */}
      <header className="px-4 pt-3 pb-3 flex items-center justify-between sticky top-0 bg-background/90 backdrop-blur-xl z-40">
        {/*
          The header carries the signed-in name next to the app name.

          The rebuild dropped `안녕 {myName} ♡` as an "app-generated sentimental
          greeting", which DESIGN_V2 does ask to keep off the top of the screen.
          It removed the name along with it, and the name is not generated copy --
          it is the user's own, and it is the only thing on the home screen that
          says which account is signed in. `e2e/smoke.spec.ts` reads it to tell an
          authenticated home from the onboarding wizard, and with it gone the
          production bundle had no visible proof of who was logged in.

          So the greeting stays gone and the name comes back, at `label` weight
          beside the app name rather than as a `display`-sized salutation above
          the content.
        */}
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-label font-semibold text-coral-strong">곰신로그</span>
          {state.profile.myName ? (
            <span className="text-caption text-muted-foreground truncate">
              {state.profile.myName}
            </span>
          ) : null}
        </span>

        <div className="flex items-center gap-2">
          {isEditMode ? (
            <button
              onClick={() => setIsEditMode(false)}
              className="press-response bg-coral-fill text-coral-fill-foreground text-label font-bold px-4 py-2 rounded-control"
              aria-label="편집 완료"
            >
              완료
            </button>
          ) : (
            <>
              {/*
                Accessible name is `새 항목 추가`, not `위젯 추가`. The 2026-08-08
                screen rebuild renamed it and broke the only hook
                `e2e/emotionRedesign.spec.ts` has for proving the 군화 home is
                editable at all -- a capability it did not have before the
                redesign, so the assertion is guarding a real regression, not a
                string. Nothing visible changes either way: the control is an
                icon-only `+`, so this name is read by assistive tech only.
              */}
              <button
                className="press-response w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted/40"
                aria-label="새 항목 추가"
                onClick={() => setIsAddWidgetOpen(true)}
              >
                <Plus size={20} strokeWidth={1.5} />
              </button>

              {/*
                Edit mode used to be reachable ONLY by holding a widget for 500ms
                (`onTouchStart` / `onMouseDown` below). A keyboard user could
                therefore never reorder or remove a widget at all: the drag handle
                and the delete button only exist inside edit mode, so dnd-kit's
                KeyboardSensor -- which IS wired -- was unreachable. WCAG 2.1
                SC 2.1.1. This button is the keyboard and screen-reader path in,
                and it also makes the feature discoverable for everyone, which the
                "위젯을 길게 누르면" hint at the bottom could not do for anyone who
                cannot long-press.
              */}
              <button
                onClick={() => setIsEditMode(true)}
                className="press-response w-11 h-11 flex items-center justify-center text-muted-foreground hover:bg-muted/40 rounded-full"
                aria-label="위젯 편집"
              >
                <LayoutGrid size={20} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Couple lifecycle, above the widgets: a creator waiting for their partner
          must see their invitation code here, not only in Settings. Renders
          nothing at all once the couple is connected. */}
      <div className="px-4">
        <CoupleStatusBanner />
      </div>

      {/*
        The core. What this role came here to do, in the order they do it.

        Rendered WITHOUT `WidgetWrapper`: no drag handle, no delete, no edit-mode
        wiggle. Outside edit mode the wrapper is a bare `<div>`, so this is the
        same picture it was -- what changed is that these surfaces can no longer
        be removed, reordered, or arrive in an order that contradicts the job.

        Keyed by `viewerIdentity` for the reason the widgets are: a surface that
        caches relationship-scoped state on mount must not survive an account or
        couple change holding the previous one.
      */}
      {/*
        §7.6's question, above the pinned core for the days it is offered.

        Placed here rather than inside the widget layer because it is not a
        widget: it cannot be reordered away, it appears only in the window after
        connecting, and it disappears on its own. `WaitingPeriodRevealCard`
        renders nothing when there is nothing to ask about, so this costs an
        empty component on every other day.
      */}
      <div className="px-4 pt-3">
        <WaitingPeriodRevealCard />
      </div>

      <div className="px-4 pt-3 space-y-5" data-testid="home-core">
        {coreSurfaces.map(({ id, Component }) => {
          // 통화 전 60초 has nothing to brief before there is a partner.
          if (id === 'call_briefing' && !state.profile.couple.connected) return null;
          return (
            <section key={`${id}:${viewerIdentity}`} data-core-surface={id}>
              <Component />
            </section>
          );
        })}
      </div>

      {/* Widget Container */}
      <div
        className="px-4 pt-6 space-y-5"
        onTouchStart={!isEditMode ? handleTouchStart : undefined}
        onTouchEnd={!isEditMode ? handleTouchEnd : undefined}
        onTouchMove={!isEditMode ? handleTouchEnd : undefined}
        onMouseDown={!isEditMode ? handleTouchStart : undefined}
        onMouseUp={!isEditMode ? handleTouchEnd : undefined}
        onMouseLeave={!isEditMode ? handleTouchEnd : undefined}
      >
        {/*
          A quiet line, so the boundary is legible.

          Without it the pinned surfaces and the arrangeable ones are one
          undifferentiated stack, and a person who long-presses to reorder finds
          that some of it moves and some of it will not, with nothing on screen
          having said which.
        */}
        {(activeWidgets.length > 0 || isEditMode) && (
          <p className="text-caption text-muted-foreground px-1">내가 고른 위젯</p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements }}
        >
          <SortableContext
            items={activeWidgets}
            strategy={verticalListSortingStrategy}
          >
            {activeWidgets.map((id) => {
              const WidgetComponent = WIDGET_REGISTRY[id]?.component;
              if (!WidgetComponent) return null;

              return (
                <WidgetWrapper
                  key={`${id}:${viewerIdentity}`}
                  id={id}
                  label={WIDGET_REGISTRY[id]?.label ?? id}
                  isEditMode={isEditMode}
                  onRemove={handleRemoveWidget}
                >
                  <WidgetComponent />
                </WidgetWrapper>
              );
            })}
          </SortableContext>
        </DndContext>

        {isEditMode && activeWidgets.length < widgetsForRole(role).length && (
          <button
            onClick={() => setIsAddWidgetOpen(true)}
            className="press-response-row w-full py-3 rounded-surface border-2 border-dashed border-border text-muted-foreground text-label font-bold flex flex-col items-center gap-1 hover:bg-muted hover:border-coral hover:text-coral"
          >
            <Plus size={20} />
            위젯 추가
          </button>
        )}
      </div>

      {/*
        The hint used to say the edit button changes "홈 순서". It no longer does --
        it changes the widget layer, and the core above it is fixed. Saying
        otherwise would send someone into edit mode to move something that will
        not move.
      */}
      {!isEditMode && (
        <div className="text-center mt-4 text-caption text-muted-foreground">
          오른쪽 위 편집 버튼에서 위젯을 더하거나 순서를 바꿀 수 있어요
        </div>
      )}

      {/* Bottom Sheet for Adding Widgets */}
      <AddWidgetBottomSheet
        isOpen={isAddWidgetOpen}
        onClose={() => setIsAddWidgetOpen(false)}
      />
    </div>
  );
}
