import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WidgetWrapperProps {
  id: string;
  isEditMode: boolean;
  onRemove: (id: string) => void;
  children: React.ReactNode;
}

export function WidgetWrapper({ id, isEditMode, onRemove, children }: WidgetWrapperProps) {
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
        "relative rounded-3xl bg-card shadow-sm border border-border p-5",
        isEditMode && "animate-wiggle",
        isDragging && "opacity-80 scale-105 shadow-xl rotate-2"
      )}
    >
      {/* Edit Mode Overlay & Controls */}
      {isEditMode && (
        <>
          <button
            onClick={() => onRemove(id)}
            className="absolute -top-3 -right-3 z-20 w-8 h-8 bg-muted hover:bg-red-500 hover:text-white text-muted-foreground rounded-full flex items-center justify-center shadow-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div 
            {...attributes} 
            {...listeners}
            className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 w-12 h-8 bg-card border border-border rounded-full flex items-center justify-center shadow-sm cursor-grab active:cursor-grabbing"
          >
            <GripHorizontal className="w-5 h-5 text-muted-foreground" />
          </div>
          {/* Prevent clicks on content during edit mode */}
          <div className="absolute inset-0 bg-card/20 z-10 rounded-3xl cursor-pointer" />
        </>
      )}
      
      {/* Widget Content */}
      <div className={cn("relative z-0", isEditMode && "pointer-events-none")}>
        {children}
      </div>
    </div>
  );
}
