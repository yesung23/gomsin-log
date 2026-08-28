import { useCallback, useEffect, useMemo, useState } from 'react';
import { Expand, Mic } from 'lucide-react';
import { Carousel } from '@astryxdesign/core/Carousel';
import { AspectRatio, type AspectRatioFit } from '@astryxdesign/core/AspectRatio';
import { Lightbox, type LightboxMedia } from '@astryxdesign/core/Lightbox';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { serverErrorMessage } from '@/lib/serverErrors';
import { cn } from '@/lib/utils';
import type { Attachment, ServerErrorKind } from '@/types';

/**
 * A record's photos and video, at the size the person who took them meant.
 *
 * ## What this replaces
 *
 * The editorial timeline gave media a fixed 68px column (76px at >=360px) beside
 * the prose. That column was a real fix for a real bug -- media used to be
 * absolutely positioned, contributed no height, and drew over the record below
 * it -- but it settled the layout by making the photograph the smallest thing in
 * the row. A 68px square is a filing stamp. `DESIGN_V2.md` §3.1 says the app's
 * warmth comes from "사용자의 사진·목소리·문장" and its first principle is
 * content-first hierarchy; a thumbnail one eighth the width of the sentence
 * beside it inverts that.
 *
 * So media moves BELOW the prose and takes the full content column. Nothing about
 * the row's height contract changes -- it is still normal flow, still sized by its
 * content -- it just gets the width it should always have had.
 *
 * ## Why the gallery is not one component per file
 *
 * `useMediaAttachment` owns one attachment's signed URL and the single automatic
 * re-sign when it expires, and hooks cannot be called in a loop. So each slide is
 * its own component that owns its own hook, and reports the URL it resolved back
 * up through `onResolved`. The parent needs those URLs because the Lightbox takes
 * the whole set at once -- swiping inside the fullscreen viewer must not depend on
 * which slide happened to be mounted.
 *
 * ## Two rules that look like styling and are not
 *
 * 1. `[data-testid="record-attachment"]` must never have a `<button>` ancestor.
 *    `<video controls>` inside a button is invalid HTML and a card-level handler
 *    swallows the taps meant for its controls;
 *    `src/pages/keyboardOperableCards.test.tsx` asserts it. The expand affordance
 *    is therefore a SIBLING overlay, not a wrapper.
 *
 * 2. Only photos get that affordance. Video and voice carry their own transport
 *    controls, and an invisible button over a `<video>` eats the play tap -- which
 *    is the same defect as (1) arriving by a different route.
 */

const AUDIO_LABEL = '음성 기록';

/** 4:5 portrait. Wider than a square, and the tallest crop that keeps the next record's existence visible on a 390px screen. */
const PORTRAIT_RATIO = 4 / 5;

type ResolvedSlide = { url: string; name: string; isVideo: boolean };

function attachmentUnavailableCopy(reason: ServerErrorKind): string {
  return `이 파일을 열 수 없어요. ${serverErrorMessage(reason)}`;
}

/**
 * The shell every attachment renders inside.
 *
 * Carries the two data attributes the record tests key on, so that contract holds
 * for photos, video and voice identically regardless of which branch drew them.
 */
/**
 * The width one carousel slide must take.
 *
 * Astryx wraps each carousel child in `display:flex; flex-shrink:0;
 * scroll-snap-align:start` and gives it **no width** -- slides are sized by their
 * content, which is right for a thumbnail strip and wrong for a photo that should
 * fill the column. `w-full` cannot rescue it either: it resolves against a parent
 * that has no definite width, so it collapses, and `AspectRatio` explicitly
 * requires "an ancestor with a definite width".
 *
 * `100cqw` is that definite width, taken from the gallery wrapper's
 * `@container`. A viewport unit would be wrong -- the app frame is capped at
 * 430px and the column is inset from it -- and measuring in JS would put a
 * ResizeObserver on every record in a day.
 */
const SLIDE_WIDTH = 'w-[100cqw]';

function AttachmentFrame({
  type,
  className,
  children,
}: {
  type: Attachment['type'];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="record-attachment"
      data-attachment-type={type}
      className={cn('relative overflow-hidden rounded-surface bg-muted', className)}
    >
      {children}
    </div>
  );
}

function StatusNote({
  refreshing,
  unavailable,
}: {
  refreshing: boolean;
  unavailable?: ServerErrorKind;
}) {
  if (refreshing) {
    return (
      <p className="absolute inset-x-0 bottom-0 px-3 py-2 text-caption font-medium break-keep bg-card/90 text-muted-foreground">
        파일을 다시 불러오는 중이에요…
      </p>
    );
  }
  if (!unavailable) return null;
  return (
    <p className="absolute inset-x-0 bottom-0 px-3 py-2 text-caption font-medium break-keep bg-card/90 text-destructive">
      {attachmentUnavailableCopy(unavailable)}
    </p>
  );
}

/**
 * One photo or one video, filling the content column.
 *
 * `onResolved` fires whenever this slide knows its URL, including after a
 * re-sign, so the Lightbox's copy of the set never goes stale behind it.
 */
function VisualSlide({
  attachment,
  coupleId,
  recordId,
  index,
  inCarousel,
  fit,
  onResolved,
  onExpand,
}: {
  attachment: Attachment;
  coupleId?: string;
  recordId: string;
  index: number;
  /** Slides need an explicit width; a lone photo just fills its parent. */
  inCarousel: boolean;
  fit: AspectRatioFit;
  onResolved: (index: number, slide: ResolvedSlide | undefined) => void;
  onExpand: (index: number) => void;
}) {
  const { url, unavailable, refreshing, reportLoadFailure } = useMediaAttachment(
    attachment,
    coupleId,
    recordId,
  );
  const isVideo = attachment.type === 'video';

  /*
   * Publishing from an effect, not from render.
   *
   * Calling the parent's setter during this component's render is a
   * "cannot update a component while rendering a different component" error --
   * React has no way to schedule the parent's re-render from inside a child's.
   * The one-paint delay costs nothing here: the set is only read when the
   * Lightbox opens, and that needs a tap.
   *
   * `onResolved` de-duplicates by URL, so this settles after one pass rather
   * than looping.
   */
  useEffect(() => {
    onResolved(index, url ? { url, name: attachment.name, isVideo } : undefined);
  }, [onResolved, index, url, attachment.name, isVideo]);

  return (
    <AttachmentFrame type={attachment.type} className={inCarousel ? SLIDE_WIDTH : 'w-full'}>
      <AspectRatio ratio={PORTRAIT_RATIO} fit={fit}>
        {url && !isVideo && (
          <img
            src={url}
            alt={attachment.name}
            loading="lazy"
            decoding="async"
            onError={reportLoadFailure}
            className={cn('w-full h-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        )}
        {url && isVideo && (
          /*
            `playsInline` is load-bearing on iOS: without it Safari hijacks the tap
            into its own fullscreen player. `preload="metadata"` keeps a day of
            clips off the data plan while still giving the controls a duration.
          */
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            aria-label={`${attachment.name} 동영상`}
            onError={reportLoadFailure}
            className={cn('w-full h-full bg-foreground', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        )}
        {!url && (
          <div className="w-full h-full flex items-center justify-center px-4">
            <span className="text-label font-medium text-muted-foreground break-keep text-center">
              {attachment.name}
            </span>
          </div>
        )}
      </AspectRatio>

      {/*
        Sibling of the media, never an ancestor -- see rule (1) in the file header.
        Photos only: a transparent layer over a <video> would eat its play tap.
      */}
      {url && !isVideo && (
        <button
          type="button"
          onClick={() => onExpand(index)}
          aria-label={`${attachment.name} 크게 보기`}
          className="press-response absolute inset-0 flex items-start justify-end p-2 cursor-pointer"
        >
          <span
            aria-hidden="true"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-card/80 backdrop-blur-sm"
          >
            <Expand size={16} className="text-foreground" />
          </span>
        </button>
      )}

      <StatusNote refreshing={refreshing} unavailable={unavailable} />
    </AttachmentFrame>
  );
}

/**
 * A voice memo.
 *
 * Kept out of the swipeable set on purpose. A carousel is a sequence of pictures;
 * putting an audio player in one means a swipe past a photo silences the thing
 * the person actually recorded. Voice notes stack under the visual media as
 * ordinary rows instead.
 */
function VoiceRow({
  attachment,
  coupleId,
  recordId,
}: {
  attachment: Attachment;
  coupleId?: string;
  recordId: string;
}) {
  const { url, unavailable, refreshing, reportLoadFailure } = useMediaAttachment(
    attachment,
    coupleId,
    recordId,
  );

  return (
    <AttachmentFrame type="voice" className="border border-border">
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-label font-medium">
          <Mic size={16} className="text-info" aria-hidden="true" />
          <span className="truncate">{attachment.name}</span>
        </div>
        {url ? (
          <audio
            src={url}
            controls
            preload="metadata"
            aria-label={`${attachment.name} ${AUDIO_LABEL}`}
            onError={reportLoadFailure}
            className="w-full max-w-full"
          />
        ) : null}
        {refreshing && (
          <p className="text-caption text-muted-foreground font-medium break-keep">
            파일을 다시 불러오는 중이에요…
          </p>
        )}
        {!refreshing && unavailable && (
          <p className="text-caption text-destructive font-medium break-keep">
            {attachmentUnavailableCopy(unavailable)}
          </p>
        )}
      </div>
    </AttachmentFrame>
  );
}

export interface RecordMediaGalleryProps {
  attachments: Attachment[];
  coupleId?: string;
  recordId: string;
  className?: string;
  /** Story uses contain so portrait and landscape originals remain fully visible. */
  fit?: AspectRatioFit;
}

export function RecordMediaGallery({
  attachments,
  coupleId,
  recordId,
  className,
  fit = 'cover',
}: RecordMediaGalleryProps) {
  const { visual, voices } = useMemo(() => {
    const visualItems: Attachment[] = [];
    const voiceItems: Attachment[] = [];
    for (const attachment of attachments) {
      (attachment.type === 'voice' ? voiceItems : visualItems).push(attachment);
    }
    return { visual: visualItems, voices: voiceItems };
  }, [attachments]);

  const [resolved, setResolved] = useState<Record<number, ResolvedSlide | undefined>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const onResolved = useCallback((index: number, slide: ResolvedSlide | undefined) => {
    setResolved((current) => {
      const previous = current[index];
      if (previous?.url === slide?.url && previous?.name === slide?.name) return current;
      return { ...current, [index]: slide };
    });
  }, []);

  /*
   * Only slides that actually resolved become Lightbox entries, and the index
   * handed to the viewer is remapped onto that filtered list. Passing the raw
   * slide index would open the viewer on the wrong photo the moment one file in
   * the middle of a set failed to sign.
   */
  const lightboxMedia: LightboxMedia[] = useMemo(
    () =>
      visual
        .map((_, index) => resolved[index])
        .filter((slide): slide is ResolvedSlide => Boolean(slide))
        .map((slide) => ({
          src: slide.url,
          alt: slide.name,
          type: slide.isVideo ? ('video' as const) : ('image' as const),
        })),
    [visual, resolved],
  );

  const openLightbox = useCallback(
    (slideIndex: number) => {
      let mapped = 0;
      for (let i = 0; i < slideIndex; i += 1) if (resolved[i]) mapped += 1;
      setLightboxIndex(mapped);
    },
    [resolved],
  );

  if (visual.length === 0 && voices.length === 0) return null;

  const isCarousel = visual.length > 1;
  const slides = visual.map((attachment, index) => (
    <VisualSlide
      key={`${attachment.path ?? attachment.name}-${index}`}
      attachment={attachment}
      coupleId={coupleId}
      recordId={recordId}
      index={index}
      inCarousel={isCarousel}
      fit={fit}
      onResolved={onResolved}
      onExpand={openLightbox}
    />
  ));

  return (
    <div className={cn('space-y-2', className)}>
      {!isCarousel && slides[0]}

      {isCarousel && (
        /*
          `@container` is what makes `SLIDE_WIDTH` mean anything: it establishes
          the inline-size this column actually has, which is the width each slide
          resolves `100cqw` against.
        */
        <div className="relative @container">
          {/*
            `hasSnap` is what makes this read as one gesture per photo rather than
            as a free-scrolling strip. Buttons are off: this is a touch surface at
            390px, and Astryx's arrows would cover the photo they point at.
          */}
          <Carousel
            gap={2}
            hasSnap
            hasEdgeFade={false}
            aria-label={`사진 ${visual.length}장`}
            data-testid="record-media-carousel"
          >
            {slides}
          </Carousel>
          <span
            aria-hidden="true"
            className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-card/80 backdrop-blur-sm text-caption font-medium tabular-nums"
          >
            {visual.length}장
          </span>
        </div>
      )}

      {voices.map((attachment, index) => (
        <VoiceRow
          key={`${attachment.path ?? attachment.name}-voice-${index}`}
          attachment={attachment}
          coupleId={coupleId}
          recordId={recordId}
        />
      ))}

      {lightboxMedia.length > 0 && (
        <Lightbox
          isOpen={lightboxIndex !== null}
          onOpenChange={(open) => setLightboxIndex(open ? (lightboxIndex ?? 0) : null)}
          media={lightboxMedia}
          index={lightboxIndex ?? 0}
          onIndexChange={setLightboxIndex}
          hasZoom
        />
      )}
    </div>
  );
}
