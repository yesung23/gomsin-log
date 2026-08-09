import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  clearAvatar,
  prepareAvatarFile,
  readAvatar,
  writeAvatar,
  type AvatarSlot,
} from '@/lib/avatarImage';

/**
 * Wraps a decorative avatar so a photo can replace it.
 *
 * Two call sites: the couple illustration on 우리 and the role glyph on 마이. Both
 * were fixed artwork, and both are the first thing on their screen, so "that is not
 * us" was the first thing the screen said.
 *
 * The fallback stays as `children`. This component never draws the default itself,
 * because the two defaults are different (an SVG illustration and an emoji in a
 * tinted circle) and neither belongs here.
 *
 * Accessibility notes that are easy to get wrong:
 *   - the whole thing is ONE button, so there is one tab stop, and the label says
 *     what it does rather than what it shows
 *   - the image is `aria-hidden`: it is decoration, and the button's own name
 *     already carries the meaning
 *   - remove is a separate 44px control that only exists once a photo is set, and
 *     it stops propagation so it cannot open the file picker on the way out
 */
export function AvatarPicker({
  userId,
  slot,
  size,
  label,
  children,
  className,
}: {
  /**
   * Owner of the photo. Pass the authenticated id when there is one.
   * Without an authenticated owner the picker stays disabled and never writes to a
   * shared fallback key, so one visitor cannot surface another visitor's photo.
   */
  userId: string | undefined;
  slot: AvatarSlot;
  /** Rendered size in px. The stored image is capped at 256px regardless. */
  size: number;
  /** Accessible name for the picker button, e.g. `커플 사진`. */
  label: string;
  /** The default artwork, shown when no photo is set. */
  children: ReactNode;
  className?: string;
}) {
  const owner = userId;
  const [dataUrl, setDataUrl] = useState<string | null>(() => readAvatar(owner, slot));
  const [busy, setBusy] = useState(false);
  /**
   * Whether the edit controls are showing.
   *
   * Only meaningful once a photo is set. A photo is content, so it is shown clean;
   * a permanent camera badge sat on top of someone's face and made the screen look
   * like an editor rather than a profile. The default artwork keeps its badge,
   * because without one the feature is undiscoverable -- which is exactly how the
   * original fixed illustration was experienced.
   */
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Auto-hide, because there is no `mouseleave` on a phone.
   *
   * Without it the controls stay up until the next tap somewhere else, which on a
   * screen that is mostly a calendar means they stay up indefinitely.
   */
  useEffect(() => {
    if (!revealed) return;
    hideTimer.current = setTimeout(() => setRevealed(false), 3200);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [revealed]);

  /** A tap anywhere else dismisses, the way a popover should. */
  useEffect(() => {
    if (!revealed) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setRevealed(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [revealed]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const prepared = await prepareAvatarFile(file);
    setBusy(false);
    if ('error' in prepared) {
      toast.error(prepared.error);
      return;
    }
    if (!writeAvatar(owner, slot, prepared.dataUrl)) {
      // The realistic cause is a full quota, and the honest message says so rather
      // than blaming the photo the user just picked.
      toast.error('사진을 저장할 공간이 부족해요. 기기 저장 공간을 확인해 주세요.');
      return;
    }
    setDataUrl(prepared.dataUrl);
    setRevealed(false);
    toast.success('사진을 바꿨어요. 이 기기에서만 보여요.');
  };

  const handleRemove = () => {
    clearAvatar(owner, slot);
    setDataUrl(null);
    setRevealed(false);
    toast.success('기본 그림으로 돌아갔어요.');
  };

  return (
    <div
      ref={containerRef}
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      onBlur={(event) => {
        // Keyboard users leave by tabbing out, which no pointer listener sees.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setRevealed(false);
      }}
    >
      {/*
        One control, two jobs depending on state:
          - no photo  -> opens the file picker straight away, and carries a camera
                         badge so the feature can be found at all
          - photo set -> reveals the edit controls, because the photo is content and
                         should be shown without anything painted over it
        `aria-expanded` is only set in the second case, since only then does the
        button control the visibility of something else.
      */}
      <button
        type="button"
        onClick={() => {
          if (dataUrl) setRevealed((v) => !v);
          else inputRef.current?.click();
        }}
        onFocus={() => {
          if (dataUrl) setRevealed(true);
        }}
        disabled={busy || !owner}
        aria-label={dataUrl ? `${label} 바꾸기 또는 지우기` : `${label} 고르기`}
        aria-expanded={dataUrl ? revealed : undefined}
        className={cn(
          'relative block w-full h-full rounded-full overflow-hidden',
          'border border-border bg-muted',
          'active:scale-95 transition disabled:opacity-60',
        )}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="" aria-hidden="true" className="w-full h-full object-cover" />
        ) : (
          <span className="flex w-full h-full items-center justify-center" aria-hidden="true">
            {children}
          </span>
        )}

        {/* Discoverability hint, shown only while there is no photo to obscure. */}
        {!dataUrl ? (
          <span
            aria-hidden="true"
            className="absolute bottom-0 inset-x-0 flex items-center justify-center bg-foreground/45 py-0.5"
          >
            <Camera size={Math.max(10, Math.round(size * 0.18))} className="text-background" />
          </span>
        ) : null}

        {/* Revealed state: a scrim so the two icons stay legible on any photo. */}
        {dataUrl && revealed ? (
          <span aria-hidden="true" className="absolute inset-0 bg-foreground/45" />
        ) : null}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          // Reset so choosing the same file twice fires `change` again.
          event.target.value = '';
        }}
      />

      {dataUrl && revealed ? (
        <>
          {/*
            Change and remove, mounted only while revealed so they are not in the tab
            order of a screen that is showing a finished profile. Both sit ON the
            avatar rather than beside it, so a 44px hit target has to come from a
            `::before` overlay instead of from visible size -- the same separation of
            visible footprint and hit area the Button primitive uses.
          */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={`${label} 다시 고르기`}
            className={cn(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              'flex items-center justify-center text-background',
              'active:scale-90 transition',
              "before:absolute before:-inset-3 before:content-['']",
            )}
          >
            <Camera size={Math.max(14, Math.round(size * 0.34))} />
          </button>

          <button
            type="button"
            onClick={handleRemove}
            aria-label={`${label} 지우고 기본 그림으로`}
            className={cn(
              'absolute -top-1 -right-1 rounded-full bg-card border border-border',
              'text-muted-foreground hover:text-destructive',
              'flex items-center justify-center w-6 h-6 active:scale-95 transition',
              "before:absolute before:-inset-2.5 before:content-['']",
            )}
          >
            <Trash2 size={12} />
          </button>
        </>
      ) : null}
    </div>
  );
}
