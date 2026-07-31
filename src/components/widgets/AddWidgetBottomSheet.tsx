import React from 'react';
import { useStore } from '@/lib/useStore';
import { WIDGET_REGISTRY } from '@/lib/widgets';
import { X, PlusCircle } from 'lucide-react';

interface AddWidgetBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddWidgetBottomSheet({ isOpen, onClose }: AddWidgetBottomSheetProps) {
  const { state, setWidgetLayout } = useStore();
  const { widgetLayout } = state;

  if (!isOpen) return null;

  const allWidgetIds = Object.keys(WIDGET_REGISTRY);
  const availableWidgets = allWidgetIds.filter((id) => !widgetLayout.includes(id));

  const handleAddWidget = (id: string) => {
    // Only allow max 6 by default? The prompt says "기본 상태에서 최대 6개까지만 노출하고, 나머지는 사용자가 직접 추가하도록" 
    // This implies the default layout has 4, and the user CAN add more. Wait, does it mean they can only have 6 total? 
    // "최대 6개까지만 노출하고, 나머지는 사용자가 직접 추가하도록" -> Maybe means default layout is max 6, user can add more.
    // Let's just append it.
    const newLayout = [...widgetLayout, id];
    setWidgetLayout(newLayout);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 transition-opacity animate-in fade-in"
        onClick={onClose}
      />
      {/* Bottom Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl p-5 pb-10 shadow-2xl animate-in slide-in-from-bottom-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">홈 위젯 추가</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted text-muted-foreground">
            <X size={24} />
          </button>
        </div>
        
        {availableWidgets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-10 text-muted-foreground">
            <p>모든 위젯이 이미 홈 화면에 추가되어 있습니다.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pb-safe scrollbar-hide">
            {availableWidgets.map((id) => {
              const widget = WIDGET_REGISTRY[id];
              return (
                <div 
                  key={id}
                  onClick={() => handleAddWidget(id)}
                  className="flex items-center justify-between p-4 rounded-2xl border border-border hover:border-coral/50 hover:bg-coral/5 cursor-pointer transition-all active:scale-95"
                >
                  <div>
                    <div className="font-bold text-foreground text-sm">{widget.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{widget.description}</div>
                  </div>
                  <PlusCircle className="text-coral" size={24} strokeWidth={1.5} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
