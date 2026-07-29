import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import { Settings, Plus, Bell } from 'lucide-react';
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
import { WIDGET_REGISTRY } from '@/lib/widgets';
import { AddWidgetBottomSheet } from '@/components/widgets/AddWidgetBottomSheet';

export function WidgetDashboard() {
  const { state, setWidgetLayout } = useStore();
  const navigate = useNavigate();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddWidgetOpen, setIsAddWidgetOpen] = useState(false);

  // Filter out any invalid widgets that might be in layout but not in registry
  const activeWidgets = state.widgetLayout?.length > 0 
    ? state.widgetLayout.filter(id => WIDGET_REGISTRY[id])
    : ['today_briefing', 'today_word', 'contact_time', 'dday'];

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
      setWidgetLayout(newLayout);
    }
  };

  const handleRemoveWidget = (id: string) => {
    setWidgetLayout(activeWidgets.filter((w) => w !== id));
  };

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
          <span className="text-xs font-semibold tracking-wide text-coral mb-1">
            ♡ 곰신로그
          </span>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground flex items-center gap-1">
            안녕 {state.profile.myName} <span className="text-coral text-2xl">♡</span>
          </h1>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-5 mt-1">
          {isEditMode ? (
            <button
              onClick={() => setIsEditMode(false)}
              className="bg-primary text-primary-foreground text-xs font-bold px-4 py-2 rounded-full active:scale-95 transition-all shadow-sm"
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
              
              {/* Notification Button */}
              <button
                className="w-11 h-11 flex items-center justify-center text-foreground hover:bg-muted/20 rounded-full active:scale-95 transition-all relative"
                aria-label="알림 센터"
              >
                <Bell size={24} strokeWidth={1.5} />
                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-coral rounded-full shadow-[0_0_0_2px_var(--background)]" />
              </button>

              {/* Settings Button */}
              <button
                onClick={() => navigate('/my')}
                className="w-11 h-11 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 rounded-full active:scale-95 transition-all"
                aria-label="설정"
              >
                <Settings size={22} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      </header>

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
                  isEditMode={isEditMode} 
                  onRemove={handleRemoveWidget}
                >
                  <WidgetComponent />
                </WidgetWrapper>
              );
            })}
          </SortableContext>
        </DndContext>

        {isEditMode && activeWidgets.length < Object.keys(WIDGET_REGISTRY).length && (
          <button
            onClick={() => setIsAddWidgetOpen(true)}
            className="w-full py-4 rounded-3xl border-2 border-dashed border-gray-300 text-gray-500 font-bold flex flex-col items-center gap-1 hover:bg-gray-50 hover:border-coral hover:text-coral transition-colors"
          >
            <Plus size={24} />
            위젯 추가
          </button>
        )}
      </div>
      
      {!isEditMode && (
        <div className="text-center mt-6 text-xs text-gray-400">
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
