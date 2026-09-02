import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { Check, X } from 'lucide-react';
import { useEscapeKey } from '@/lib/hooks';
import { useSheetDrag } from '@/lib/useSheetDrag';
import {
  applyPaperTextureAttribute,
  PAPER_TEXTURE_OPTIONS,
  reconcileOwnedPaperTexture,
  savePaperTexture,
  type PaperTexture,
} from '@/lib/paperTexturePreference';
import { loadCompanionShopState } from '@/lib/companionShopLocalState';

interface ProfilePaperMenuProps {
  isOpen: boolean;
  userId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenSettings: () => void;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ProfilePaperMenu({
  isOpen,
  userId,
  triggerRef,
  onClose,
  onOpenSettings,
}: ProfilePaperMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const paperOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selected, setSelected] = useState<PaperTexture>(() => {
    const initialShopState = loadCompanionShopState(userId);
    return reconcileOwnedPaperTexture(userId, initialShopState.ownedPapers);
  });
  const { sheetRef, handleProps } = useSheetDrag({ onDismiss: onClose, enabled: isOpen });

  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    sheetRef.current = node;
  }, [sheetRef]);

  const ownedPapers = new Set(loadCompanionShopState(userId).ownedPapers);
  const availablePapers = PAPER_TEXTURE_OPTIONS.filter((paper) => ownedPapers.has(paper.id));

  useEscapeKey(onClose, isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const shopState = loadCompanionShopState(userId);
    const nextPaper = reconcileOwnedPaperTexture(userId, shopState.ownedPapers);
    setSelected(nextPaper);
    applyPaperTextureAttribute(nextPaper);
    restoreFocusRef.current = triggerRef.current || document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    return () => {
      restoreFocusRef.current?.focus();
    };
  }, [isOpen, triggerRef, userId]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const choosePaper = (texture: PaperTexture) => {
    setSelected(texture);
    savePaperTexture(userId, texture);
    applyPaperTextureAttribute(texture);
  };

  const movePaperSelection = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % availablePapers.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + availablePapers.length) % availablePapers.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = availablePapers.length - 1;
    }
    if (nextIndex === null || !availablePapers[nextIndex]) return;

    event.preventDefault();
    choosePaper(availablePapers[nextIndex].id);
    paperOptionRefs.current[nextIndex]?.focus();
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        data-testid="profile-paper-menu-backdrop"
        className="fixed inset-0 z-[60] bg-black/40 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={attachPanel}
        id="profile-paper-menu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-paper-menu-title"
        className="fixed bottom-0 left-0 right-0 z-[60] max-h-[85vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-4 pb-6 shadow-2xl animate-in slide-in-from-bottom-full"
      >
        <div {...handleProps} aria-hidden="true" className="-mt-1 mb-2 flex justify-center pb-1 pt-2 cursor-grab active:cursor-grabbing">
          <span aria-hidden="true" className="block h-1 w-9 rounded-full bg-border" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 id="profile-paper-menu-title" className="text-heading font-semibold text-foreground">마이 메뉴</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="마이 메뉴 닫기"
            className="press-response flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <section className="mt-3" aria-labelledby="profile-paper-menu-paper-title">
          <h3 id="profile-paper-menu-paper-title" className="text-label font-semibold text-foreground">앱 종이</h3>
          <p className="mt-1 text-caption leading-relaxed text-muted-foreground">내가 가진 종이를 골라 앱 전체 바탕에 적용해요.</p>
          <div role="radiogroup" aria-label="앱 종이" aria-orientation="vertical" className="mt-3 space-y-2">
            {availablePapers.map((paper, index) => {
              const active = selected === paper.id;
              return (
                <button
                  ref={(node) => { paperOptionRefs.current[index] = node; }}
                  key={paper.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={paper.label}
                  tabIndex={active ? 0 : -1}
                  data-testid={`profile-paper-option-${paper.id}`}
                  onClick={() => choosePaper(paper.id)}
                  onKeyDown={(event) => movePaperSelection(event, index)}
                  className="press-response-row flex min-h-16 w-full items-center gap-3 rounded-control border border-border px-3 py-2 text-left"
                  style={{ borderColor: active ? 'var(--ink)' : 'var(--ink-faint)' }}
                >
                  <span
                    aria-hidden="true"
                    data-paper={paper.id}
                    data-testid={`paper-texture-preview-${paper.id}`}
                    className="paper-texture-preview h-11 w-11 shrink-0 rounded-control border border-border"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold text-foreground">{paper.label}</span>
                    <span className="mt-0.5 block text-caption leading-relaxed text-muted-foreground">{paper.description}</span>
                  </span>
                  {active ? <Check size={18} className="shrink-0" color="var(--ink)" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
          className="press-response-row mt-4 flex min-h-11 w-full items-center rounded-control border border-border px-3 text-left text-label font-semibold text-foreground"
        >
          설정 및 계정 관리
        </button>
      </div>
    </>
  );
}
