import { Film, Image as ImageIcon, Mic } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { serverErrorMessage } from '@/lib/serverErrors';
import type { Attachment, ServerErrorKind } from '@/types';

/**
 * Why an attachment will not open.
 *
 * The record itself loaded, so this is deliberately scoped to the file rather
 * than presented as a failure of the entry. The cause comes from the classifier,
 * so an RLS refusal, an expired session and a dead network read differently
 * instead of all showing an unexplained filename.
 *
 * Not exported: nothing outside this file ever used it, and exporting a
 * non-component from a component module breaks Fast Refresh for the whole module
 * (react-refresh/only-export-components). If another screen needs this copy, it
 * belongs in `lib/serverErrors.ts` with the rest of the failure vocabulary, not
 * re-exported from here.
 */
function attachmentUnavailableCopy(reason: ServerErrorKind): string {
  return `이 파일을 열 수 없어요. ${serverErrorMessage(reason)}`;
}

const KIND_ICON = {
  photo: ImageIcon,
  video: Film,
  voice: Mic,
} as const;

const KIND_ICON_CLASS = {
  photo: 'text-coral',
  video: 'text-info',
  voice: 'text-info',
} as const;

const KIND_MEDIA_LABEL = {
  photo: '사진',
  video: '동영상',
  voice: '음성 기록',
} as const;

type Props = {
  attachment: Attachment;
  /** Needed to re-sign an expired URL; absent before a couple space exists. */
  coupleId?: string;
  recordId: string;
  /**
   * How much room the media gets.
   *
   * `timeline` is the day view on 기록, `detail` the record sheet, `compact` the
   * home widget, where several entries share one card and each has to stay
   * glanceable.
   */
  variant: 'timeline' | 'detail' | 'compact';
  /** Owner-only controls, rendered inside the same card as the media. */
  footer?: ReactNode;
};

/**
 * Render one attachment so it can actually be consumed.
 *
 * NOT ON A PRODUCTION PATH as of the 2026-08-20 Astryx/Instagram visual pass.
 * Every screen that used to render this -- the 기록 timeline, the record detail
 * sheet, and 상대방의 오늘 -- now renders `components/media/RecordMediaGallery`,
 * which gives media the full content width, swipes a multi-photo record, and
 * opens a fullscreen viewer. This file is kept rather than deleted because it is
 * still the only single-attachment renderer with the three size variants, and
 * because `AttachmentMedia.test.tsx` and `lib/lintGateStrictness.test.ts` pin
 * behaviour that is worth keeping provable. Deleting it is a separate decision
 * from the redesign, and is recorded as such in `docs/WORK_LOG.md`.
 *
 * Bug condition this closes: a voice or video attachment rendered as a filename
 * chip with no player. The app records audio with `MediaRecorder`, accepts video
 * files, uploads both to Storage and signs URLs for them -- and then offered no
 * way to hear or watch any of it. `git grep -E "<(audio|video)[ >]" src` returned
 * nothing on the whole tree.
 *
 * The shipped CSP already permits this: `media-src 'self' data: blob:
 * <supabase-origin>` in `public/_headers`, so no policy change is needed to play
 * an attachment from Storage.
 */
export function AttachmentMedia({ attachment, coupleId, recordId, variant, footer }: Props) {
  const { url, unavailable, refreshing, reportLoadFailure } = useMediaAttachment(
    attachment,
    coupleId,
    recordId,
  );
  const Icon = KIND_ICON[attachment.type];
  /*
   * `timeline` is a 68px column (76px at >=360px), set by the editorial row in
   * RecordPage: time 44px, gap 8px, then the media. It used to paint at `h-36`
   * (144px), which is nearly twice the column width, so a photo or a video
   * overflowed its own cell and pushed into the prose beside it.
   *
   * `aspect-square` instead of a fixed height: the width is what the row controls,
   * so the height has to follow it rather than be declared independently. That also
   * keeps the thumbnail square at both 68px and 76px without a second breakpoint.
   *
   * `detail` and `compact` are unchanged -- they sit in full-width containers where
   * a fixed height is the right call.
   */
  const boxHeight = variant === 'detail' ? 'h-48' : variant === 'timeline' ? 'aspect-square h-auto' : 'h-24';
  const mediaLabel = `${attachment.name} ${KIND_MEDIA_LABEL[attachment.type]}`;

  return (
    <div
      className="rounded-xl overflow-hidden bg-muted border border-border"
      data-testid="record-attachment"
      data-attachment-type={attachment.type}
    >
      {url && attachment.type === 'photo' && (
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          onError={reportLoadFailure}
          className={`w-full ${boxHeight} object-cover rounded-xl`}
        />
      )}

      {url && attachment.type === 'video' && (
        // `playsInline` is load-bearing on iOS: without it Safari hijacks the tap
        // into a fullscreen player, which is not what "browse the day" means.
        // `preload="metadata"` keeps a timeline of clips off the data plan while
        // still giving the controls a duration.
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          aria-label={mediaLabel}
          onError={reportLoadFailure}
          className={`w-full ${boxHeight} bg-black rounded-xl`}
        />
      )}

      {url && attachment.type === 'voice' && (
        /*
         * On the timeline the cell is 68-76px wide. A native <audio> control needs
         * roughly 200px before its buttons start clipping, and the file name above
         * it made the cell taller than the row, so the whole block spilled out.
         *
         * So the timeline drops the name -- the row already states the time and the
         * author, and the icon says it is a voice note -- and lets the control use
         * the full cell width. `detail` and `compact` keep the name, because they
         * have the room and the name is the only way to tell two clips apart there.
         */
        <div className={variant === 'timeline' ? 'p-1.5' : 'p-3 space-y-2'}>
          {variant !== 'timeline' && (
            <div className="flex items-center gap-2 text-label font-medium">
              <Icon size={16} className={KIND_ICON_CLASS.voice} />
              <span className="truncate">{attachment.name}</span>
            </div>
          )}
          {variant === 'timeline' && (
            <Icon size={14} className={`${KIND_ICON_CLASS.voice} mx-auto mb-1`} aria-hidden="true" />
          )}
          <audio
            src={url}
            controls
            preload="metadata"
            aria-label={mediaLabel}
            onError={reportLoadFailure}
            className="w-full max-w-full"
          />
        </div>
      )}

      {!url && (
        <div className="p-3 text-label flex items-center gap-2 font-medium">
          <Icon size={16} className={KIND_ICON_CLASS[attachment.type]} />
          <span>{attachment.name}</span>
        </div>
      )}

      {refreshing && (
        <p className="px-3 pb-2 text-caption text-muted-foreground font-medium break-keep">
          파일을 다시 불러오는 중이에요…
        </p>
      )}

      {!refreshing && unavailable && (
        <p className="px-3 pb-2 text-caption text-destructive font-medium break-keep">
          {attachmentUnavailableCopy(unavailable)}
        </p>
      )}

      {footer}
    </div>
  );
}
