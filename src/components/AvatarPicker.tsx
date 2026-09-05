import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useProfileAvatar } from '@/lib/useProfileAvatar';
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
  const shared = useProfileAvatar(slot === 'me' ? owner : undefined);
  const [localPhoto, setLocalPhoto] = useState(() => ({ owner, slot, dataUrl: readAvatar(owner, slot) }));
  const localDataUrl = localPhoto.owner === owner && localPhoto.slot === slot ? localPhoto.dataUrl : readAvatar(owner, slot);
  // Old, device-only choices are never uploaded implicitly. A tombstone from
  // another device also suppresses a legacy local photo after remote removal.
  const dataUrl = slot === 'me'
    ? shared.allowed ? shared.dataUrl ?? (shared.ready && shared.version === null ? localDataUrl : null) : null
    : localDataUrl;
  const [busy, setBusy] = useState(false);
  const preparing = useRef(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  /**
   * Whether the edit controls are showing.
   *
   * Only meaningful once a photo is set. A photo is content, so it is shown clean;
   * a permanent edit badge sat on top of someone's face and made the screen look
   * like an editor rather than a profile. The profile action row and accessible
   * button label keep the edit action discoverable without painting an icon over it.
   */
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOwner = useRef(owner);
  useEffect(() => { currentOwner.current = owner; return () => { currentOwner.current = undefined; }; }, [owner]);

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
    if (!file || preparing.current || busy || shared.busy || !owner) return;
    preparing.current = true;
    const expectedOwner = owner;
    setBusy(true);
    try {
      const prepared = await prepareAvatarFile(file);
      if (currentOwner.current !== expectedOwner) return;
      if ('error' in prepared) {
        toast.error(prepared.error);
        return;
      }
      if (slot === 'me') {
        const result = await shared.save(prepared.dataUrl);
        if (currentOwner.current !== expectedOwner) return;
        if (!result.ok) {
          toast.error(result.reason === 'conflict'
            ? '다른 기기에서 사진이 바뀌었어요. 확인 후 다시 골라주세요.'
            : '사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
          return;
        }
        clearAvatar(owner, slot);
        setLocalPhoto({ owner, slot, dataUrl: null });
        setRevealed(false);
        toast.success('프로필 사진을 바꿨어요.');
        return;
      }
      if (!writeAvatar(owner, slot, prepared.dataUrl)) {
        toast.error('사진을 저장할 공간이 부족해요. 기기 저장 공간을 확인해 주세요.');
        return;
      }
      setLocalPhoto({ owner, slot, dataUrl: prepared.dataUrl });
      setRevealed(false);
      toast.success('사진을 바꿨어요. 이 기기에서만 보여요.');
    } catch {
      if (currentOwner.current === expectedOwner) toast.error('사진을 처리하지 못했어요. 다시 골라주세요.');
    } finally { preparing.current = false; setBusy(false); }
  };

  const handleRemove = async () => {
    if (busy || shared.busy || !owner) return;
    const expectedOwner = owner;
    if (slot === 'me') {
      const result = await shared.save(null);
      if (currentOwner.current !== expectedOwner) return;
      if (!result.ok) {
        toast.error('사진을 지우지 못했어요. 다시 시도해 주세요.');
        return;
      }
    }
    clearAvatar(owner, slot);
    setLocalPhoto({ owner, slot, dataUrl: null });
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
          - no photo  -> opens the file picker straight away
          - photo set -> reveals the edit controls, because the photo is content and
                         should be shown without anything painted over it
        `aria-expanded` is only set in the second case, since only then does the
        button control the visibility of something else.
      */}
      <button
        type="button"
        onClick={() => {
          if (dataUrl) setRevealed(true);
          else inputRef.current?.click();
        }}
        onFocus={() => {
          if (dataUrl) setRevealed(true);
        }}
        disabled={busy || shared.busy || !owner}
        aria-busy={busy || shared.busy}
        aria-label={dataUrl ? `${label} 바꾸기 또는 지우기` : `${label} 고르기`}
        aria-description={slot === 'me' ? '새로 고른 사진은 나와 연결된 상대방의 스토리에 보여요.' : undefined}
        aria-expanded={dataUrl ? revealed : undefined}
        className={cn(
          'press-response-row relative block w-full h-full rounded-full overflow-hidden',
          'border border-border bg-muted',
          'active:scale-95 transition disabled:opacity-60',
        )}
      >
        {dataUrl && dataUrl !== failedUrl ? (
          <img src={dataUrl} alt="" aria-hidden="true" className="w-full h-full object-cover" onError={() => setFailedUrl(dataUrl)} />
        ) : (
          <span className="flex w-full h-full items-center justify-center" aria-hidden="true">
            {children}
          </span>
        )}

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
            disabled={busy || shared.busy}
            aria-label={`${label} 다시 고르기`}
            className={cn(
              'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              'flex items-center justify-center text-background',
              'active:scale-90 transition',
              "before:absolute before:-inset-3 before:content-['']",
            )}
          >
            <Pencil size={Math.max(14, Math.round(size * 0.34))} />
          </button>

          <button
            type="button"
            onClick={() => { void handleRemove(); }}
            disabled={busy || shared.busy}
            aria-label={`${label} 지우고 기본 그림으로`}
            className={cn(
              'press-response absolute -top-1 -right-1 rounded-full bg-card border border-border',
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
