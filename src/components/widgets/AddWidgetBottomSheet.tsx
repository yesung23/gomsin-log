import { useStore } from '@/lib/useStore';
import { useEscapeKey } from '@/lib/hooks';
import { useSheetDrag } from '@/lib/useSheetDrag';
import { WIDGET_REGISTRY, isWidgetAllowedForRole, widgetsForRole } from '@/lib/widgets';
import { X, PlusCircle } from 'lucide-react';

interface AddWidgetBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddWidgetBottomSheet({ isOpen, onClose }: AddWidgetBottomSheetProps) {
  const { state, setWidgetLayout } = useStore();
  const role = state.profile.role;
  const storedLayout = role === 'soldier' ? state.soldierWidgetLayout : state.widgetLayout;

  // Before the early return: a hook may not sit behind a conditional.
  useEscapeKey(onClose, isOpen);
  const { sheetRef, handleProps } = useSheetDrag({ onDismiss: onClose });

  if (!isOpen) return null;

  /**
   * Only widgets this role may use, and only ones not already placed.
   *
   * Filtering against the ROLE-CORRECT stored layout matters: appending to the
   * wrong list would silently move a widget onto the other person's home screen.
   * Ids that are unknown or not for this role are dropped on write rather than
   * carried forward, so a stale layout heals instead of accumulating.
   */
  const current = (storedLayout ?? []).filter(
    (id: string) => WIDGET_REGISTRY[id] && isWidgetAllowedForRole(id, role),
  );
  const availableWidgets = widgetsForRole(role)
    .map((widget) => widget.id)
    .filter((id) => !current.includes(id));

  const handleAddWidget = (id: string) => {
    setWidgetLayout([...current, id], role);
    onClose();
  };

  return (
    <>
      {/*
        Backdrop and sheet are z-[60], not z-50: MobileShell's tab bar is
        `fixed bottom-0 ... z-50` and comes after <main> in the DOM, so at an
        equal z-index it paints over this bottom-anchored sheet and swallows the
        taps on whichever widget row happens to land behind it.
      */}
      <div
        className="fixed inset-0 bg-black/40 z-[60] transition-opacity animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      {/*
        Bottom Sheet.
        It used to be a bare <div>: no `role="dialog"`, no `aria-modal`, no name,
        and no Escape handler, so a screen reader announced nothing about it and a
        keyboard user could not dismiss it at all. Every other overlay in this app
        (RecordPage, SchedulePage, ServicePage, SettingsPage) already carries these
        three attributes and calls `useEscapeKey`; this one was the exception.
      */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-widget-sheet-title"
        className="fixed bottom-0 left-0 right-0 z-[60] bg-card rounded-t-2xl p-4 pb-6 shadow-2xl animate-in slide-in-from-bottom-full max-h-[80vh] flex flex-col"
      >
        {/*
          Grab handle. Two jobs, and the visible one matters more.

          It is the drag surface, and it is the ONLY drag surface. Not the sheet,
          because a downward swipe inside the scrolling widget list below has to stay
          a scroll. Not the header either: the header holds the close button, and a
          pointer capture taken on an ancestor swallows the `click` that button needs.

          It is also the only reason anyone would guess the sheet can be dragged. A
          gesture with no affordance is not a feature. It stays `aria-hidden` because
          it is a shortcut on top of three routes out that already work: the close
          button, Escape, and the backdrop.
        */}
        <div {...handleProps} className="-mt-1 mb-2 pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing">
          <span aria-hidden="true" className="block w-9 h-1 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 id="add-widget-sheet-title" className="text-heading text-foreground">홈 위젯 추가</h2>
          <button
            onClick={onClose}
            aria-label="위젯 추가 닫기"
            className="press-response min-w-[44px] min-h-[44px] p-2 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center"
          >
            <X size={24} aria-hidden="true" />
          </button>
        </div>

        {availableWidgets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-muted-foreground">
            <p>모든 위젯이 이미 홈 화면에 추가되어 있습니다.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pb-safe scrollbar-hide">
            {availableWidgets.map((id) => {
              const widget = WIDGET_REGISTRY[id];
              return (
                /*
                  A `<div onClick>` here was not reachable by keyboard at all: no
                  role, no tabIndex, no key handler. Adding a widget was a
                  pointer-only action. A real <button> is focusable, operable with
                  Enter and Space, and announced as a button.
                */
                <button
                  key={id}
                  type="button"
                  onClick={() => handleAddWidget(id)}
                  /*
                    `press-response-row`, not the `transition-all active:scale-95`
                    this had. Two reasons. `transition-all` animates every property
                    including layout ones, so the browser cannot hand this to the
                    compositor. And a full-width row that scales visibly bows its own
                    edges away from the rows above and below it -- at this width the
                    honest press feedback is a tint, not a shrink.
                  */
                  className="press-response-row w-full text-left flex items-center justify-between p-3 rounded-control border border-border hover:border-coral/50 hover:bg-coral/5 cursor-pointer"
                >
                  <div>
                    <div className="text-label font-semibold text-foreground">{widget.label}</div>
                    <div className="text-caption text-muted-foreground mt-0.5">{widget.description}</div>
                  </div>
                  <PlusCircle className="text-coral" size={20} strokeWidth={1.5} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
