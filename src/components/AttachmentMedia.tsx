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
  video: 'text-blue-500',
  voice: 'text-purple-500',
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
  const boxHeight = variant === 'detail' ? 'h-48' : variant === 'timeline' ? 'h-36' : 'h-24';
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
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-label font-medium">
            <Icon size={16} className={KIND_ICON_CLASS.voice} />
            <span className="truncate">{attachment.name}</span>
          </div>
          <audio
            src={url}
            controls
            preload="metadata"
            aria-label={mediaLabel}
            onError={reportLoadFailure}
            className="w-full"
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
