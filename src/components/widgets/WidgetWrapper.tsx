import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WidgetWrapperProps {
  id: string;
  /**
   * Human name of the widget, for the edit controls.
   *
   * Passed in rather than looked up from `WIDGET_REGISTRY` here: the registry
   * imports every widget component, and this wrapper is rendered by the dashboard
   * that already has it, so importing it back would couple a presentational
   * wrapper to the whole widget graph.
   */
  label: string;
  isEditMode: boolean;
  onRemove: (id: string) => void;
  children: React.ReactNode;
}

/**
 * Widget container. In normal mode, NO elevated surface: surface economy says at
 * most three elevated surfaces per screen, and wrapping every widget in a card was
 * the "soft blob" reading. Structure comes from spacing, not from a border per item.
 *
 * In edit mode, a subtle border and background appear so the user can see the
 * drag-reorder boundaries.
 */
export function WidgetWrapper({ id, label, isEditMode, onRemove, children }: WidgetWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        isEditMode && "rounded-surface bg-card border border-border p-4 animate-wiggle",
        isDragging && "opacity-80 scale-105 shadow-xl rotate-2"
      )}
    >
      {/* Edit Mode Overlay & Controls */}
      {isEditMode && (
        <>
          {/*
            Both controls used to be unnamed: a screen reader announced "button"
            for the remove control, and the drag handle was a bare <div> with no
            name at all, so neither said WHICH widget it affected. The remove
            control was also 32x32, under the 44x44 minimum the rest of this app
            already meets.
          */}
          <button
            onClick={() => onRemove(id)}
            aria-label={`${label} 위젯 삭제`}
            className="absolute -top-3 -right-3 z-20 w-11 h-11 bg-muted hover:bg-destructive hover:text-destructive-foreground text-muted-foreground rounded-full flex items-center justify-center shadow-md transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`${label} 위젯 위치 변경`}
            className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 w-14 h-11 bg-card border border-border rounded-full flex items-center justify-center shadow-sm cursor-grab active:cursor-grabbing"
          >
            <GripHorizontal className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          </button>
          {/* Prevent clicks on content during edit mode */}
          <div className="absolute inset-0 bg-card/20 z-10 rounded-surface cursor-pointer" aria-hidden="true" />
        </>
      )}

      {/* Widget Content */}
      <div className={cn("relative z-0", isEditMode && "pointer-events-none")}>
        {children}
      </div>
    </div>
  );
}
