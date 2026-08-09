import { useRef, useState, type ReactNode } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  clearAvatar,
  DEMO_OWNER,
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
   *
   * Demo mode has neither `authenticatedUser.id` nor `profile.id` -- both are empty
   * until a real sign-in -- so callers may pass `undefined` and still expect the
   * feature to work: the demo space is exactly where someone tries this before
   * committing to an account. `DEMO_OWNER` covers that case, and because it is a
   * distinct key it cannot collide with a real account on the same device.
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
  const owner = userId || DEMO_OWNER;
  const [dataUrl, setDataUrl] = useState<string | null>(() => readAvatar(owner, slot));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    toast.success('사진을 바꿨어요. 이 기기에서만 보여요.');
  };

  const handleRemove = () => {
    clearAvatar(owner, slot);
    setDataUrl(null);
    toast.success('기본 그림으로 돌아갔어요.');
  };

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={dataUrl ? `${label} 다시 고르기` : `${label} 고르기`}
        className={cn(
          'group relative block w-full h-full rounded-full overflow-hidden',
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

        {/*
          The affordance. Without it a photo looks like fixed artwork again, and the
          feature is undiscoverable -- which is how the original illustration was
          experienced. Kept small and low-contrast so it reads as a hint.
        */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 inset-x-0 flex items-center justify-center bg-foreground/45 py-0.5"
        >
          <Camera size={Math.max(10, Math.round(size * 0.18))} className="text-background" />
        </span>
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

      {dataUrl ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleRemove();
          }}
          aria-label={`${label} 지우고 기본 그림으로`}
          className={cn(
            'absolute -top-1 -right-1 rounded-full bg-card border border-border',
            'text-muted-foreground hover:text-destructive',
            'flex items-center justify-center w-6 h-6 active:scale-95 transition',
            // Visible 24px, hit target 44px. Same trick the Button primitive uses.
            "before:absolute before:-inset-2.5 before:content-['']",
          )}
        >
          <Trash2 size={12} />
        </button>
      ) : null}
    </div>
  );
}
