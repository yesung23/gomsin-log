import React, { useMemo, useState } from 'react';
import { useStore } from '@/lib/useStore';
import { Settings, Plus, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  WIDGET_REGISTRY,
  isWidgetAllowedForRole,
  widgetsForRole,
} from '@/lib/widgets';
import type { Role } from '@/types';
import { AddWidgetBottomSheet } from '@/components/widgets/AddWidgetBottomSheet';
import { CoupleStatusBanner } from '@/components/CoupleStatusBanner';
import { CallBriefingWidget } from '@/components/widgets/CallBriefingWidget';

export function WidgetDashboard() {
  const { state, setWidgetLayout } = useStore();
  const navigate = useNavigate();
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

  // Drop ids that are unknown OR not meant for this role, so a role switch cannot
  // leave "상대방의 마음 흐름" on the screen of the person it describes.
  const activeWidgets = useMemo(() => {
    const filtered = (storedLayout ?? []).filter(
      (id: string) => WIDGET_REGISTRY[id] && isWidgetAllowedForRole(id, role),
    );
    return filtered.length > 0 ? filtered : DEFAULT_LAYOUT_BY_ROLE[role];
  }, [storedLayout, role]);

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
    <div className="pb-8">
      {/* Header */}
      <header className="px-5 pt-10 pb-6 flex items-start justify-between sticky top-0 bg-background/90 backdrop-blur-xl z-40">
        {/* Left: Titles */}
        <div className="flex flex-col">
          <span className="text-caption font-semibold tracking-wide text-coral-strong mb-1">
            ♡ 곰신로그
          </span>
          <h1 className="text-display tracking-tight text-foreground flex items-center gap-1">
            안녕 {state.profile.myName} <span className="text-coral-strong text-display">♡</span>
          </h1>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-5 mt-1">
          {isEditMode ? (
            <button
              onClick={() => setIsEditMode(false)}
              className="bg-primary text-primary-foreground text-label font-bold px-4 py-2 rounded-full active:scale-95 transition-all shadow-sm"
              aria-label="편집 완료"
            >
              완료
            </button>
          ) : (
            <>
              {/* Plus Button (Circle Outline) */}
              <button
                className="w-11 h-11 rounded-full border-[1.5px] border-muted-foreground/40 flex items-center justify-center text-foreground hover:bg-muted/20 active:scale-95 transition-all"
                aria-label="새 항목 추가"
                onClick={() => setIsAddWidgetOpen(true)}
              >
                <Plus size={22} strokeWidth={1.5} />
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
                className="w-11 h-11 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 rounded-full active:scale-95 transition-all"
                aria-label="위젯 편집"
              >
                <LayoutGrid size={22} strokeWidth={1.5} />
              </button>

              {/*
                A notification-centre button used to sit here with no onClick
                handler and a permanently lit unread dot. There is no
                notification system yet, so it has been removed rather than
                left as a dead control that implies unread activity.
              */}

              {/* Settings Button */}
              <button
                onClick={() => navigate('/settings')}
                className="w-11 h-11 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 rounded-full active:scale-95 transition-all"
                aria-label="설정"
              >
                <Settings size={22} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Couple lifecycle, above the widgets: a creator waiting for their partner
          must see their invitation code here, not only in Settings. Renders
          nothing at all once the couple is connected. */}
      <div className="px-5 pb-4">
        <CoupleStatusBanner />
      </div>

      {/* The soldier's scarce phone window has one non-removable job: regain the
          shared context before the call. Custom widgets remain below, but this
          call-prep surface cannot be accidentally deleted or buried. */}
      {role === 'soldier' && state.profile.couple.connected && (
        <div className="px-5 pb-4">
          <CallBriefingWidget key={`${state.authenticatedUser?.id ?? state.profile.id}:${state.profile.couple.coupleId}`} />
        </div>
      )}

      {/* Widget Container */}
      <div 
        className="px-5 space-y-4 min-h-[500px]"
        onTouchStart={!isEditMode ? handleTouchStart : undefined}
        onTouchEnd={!isEditMode ? handleTouchEnd : undefined}
        onTouchMove={!isEditMode ? handleTouchEnd : undefined}
        onMouseDown={!isEditMode ? handleTouchStart : undefined}
        onMouseUp={!isEditMode ? handleTouchEnd : undefined}
        onMouseLeave={!isEditMode ? handleTouchEnd : undefined}
      >
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
                  key={id}
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
            className="w-full py-4 rounded-3xl border-2 border-dashed border-border text-muted-foreground font-bold flex flex-col items-center gap-1 hover:bg-muted hover:border-coral hover:text-coral transition-colors"
          >
            <Plus size={24} />
            위젯 추가
          </button>
        )}
      </div>
      
      {!isEditMode && (
        <div className="text-center mt-6 text-caption text-muted-foreground">
          위젯을 길게 누르면 편집할 수 있어요
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
