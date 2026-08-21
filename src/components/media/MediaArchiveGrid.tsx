import { useCallback, useEffect, useMemo, useState } from 'react';
import { Film, Lock } from 'lucide-react';
import { Lightbox, type LightboxMedia } from '@astryxdesign/core/Lightbox';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Attachment, DailyRecord } from '@/types';

/**
 * Every photo of a period, as one surface.
 *
 * ## Why this exists next to the timeline rather than instead of it
 *
 * The 기록 tab reads a period one day at a time: pick a date, read that day in
 * order. That is the right shape for "what happened on the 14th" and the wrong
 * shape for "where is that photo" -- finding one picture means opening days until
 * it appears. `PRODUCT_V3.md` §17 lists 기억 탐색 개선 as a next candidate and §10
 * wants 우리 to be where 둘의 실제 역사 accumulates; a grid is what makes an
 * accumulation feel like one.
 *
 * So the two are lenses on the same records, not two features: 타임라인 reads a
 * day, 사진 scans a period. Neither hides anything the other shows, and the
 * toggle between them holds no state of its own beyond which lens is up.
 *
 * ## What it is not allowed to become
 *
 * A public grid of everything is the shape of a social profile, and §16 rules
 * that out. Three things keep it honest:
 *
 *   - it draws only from records the caller already filtered through
 *     `visibleRecordsForViewer`, so a partner's private photo cannot reach it;
 *   - a private photo of the VIEWER's own is shown, and marked, because hiding a
 *     person's own record from them is not privacy;
 *   - there are no counts, no ranking, and no "most liked" -- ordering is time,
 *     newest first, and nothing else.
 */

/** Newest first, then latest-in-day first, so the most recent photo is top-left. */
function sortNewestFirst(a: { record: DailyRecord }, b: { record: DailyRecord }): number {
  const left = `${b.record.date}T${b.record.time || '00:00'}`;
  const right = `${a.record.date}T${a.record.time || '00:00'}`;
  return left.localeCompare(right);
}

type Cell = { record: DailyRecord; attachment: Attachment; key: string };

/**
 * One square.
 *
 * Owns its own signed URL through the same hook the timeline uses, including the
 * single automatic re-sign when an hour-old URL stops working, and reports the
 * resolved URL up so the Lightbox can hold the whole set.
 */
function GridCell({
  cell,
  coupleId,
  position,
  onResolved,
  onOpen,
}: {
  cell: Cell;
  coupleId?: string;
  position: number;
  onResolved: (position: number, media: LightboxMedia | undefined) => void;
  onOpen: (position: number) => void;
}) {
  const { url, reportLoadFailure } = useMediaAttachment(
    cell.attachment,
    coupleId,
    cell.record.id,
  );
  const isVideo = cell.attachment.type === 'video';

  useEffect(() => {
    onResolved(
      position,
      url
        ? { src: url, alt: cell.attachment.name, type: isVideo ? 'video' : 'image' }
        : undefined,
    );
  }, [onResolved, position, url, cell.attachment.name, isVideo]);

  /*
   * A video's poster frame, not a player. Twelve `<video controls>` elements on
   * one screen is twelve transport bars competing with the pictures, and
   * `preload="metadata"` twelve times over is a real cost on a phone. The cell
   * is an index entry; the Lightbox is where it plays.
   */
  return (
    <button
      type="button"
      onClick={() => onOpen(position)}
      aria-label={`${cell.record.date} ${cell.record.time || ''} ${cell.attachment.name} 크게 보기`}
      className="press-response relative aspect-square overflow-hidden bg-muted cursor-pointer"
    >
      {url && !isVideo && (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={reportLoadFailure}
          className="w-full h-full object-cover"
        />
      )}
      {url && isVideo && (
        <video
          src={url}
          preload="metadata"
          muted
          playsInline
          aria-hidden="true"
          onError={reportLoadFailure}
          className="w-full h-full object-cover"
        />
      )}
      {isVideo && (
        <span aria-hidden="true" className="absolute top-1 right-1 text-card drop-shadow-sm">
          <Film size={14} />
        </span>
      )}
      {cell.record.isPrivate && (
        /*
          The viewer's own private photo. Marked rather than omitted: this grid is
          their archive, and silently dropping a record they wrote would read as
          data loss. A partner's private record never reaches this component.
        */
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1 w-5 h-5 flex items-center justify-center rounded-full bg-card/85"
        >
          <Lock size={10} className="text-warning-foreground" />
        </span>
      )}
    </button>
  );
}

export interface MediaArchiveGridProps {
  /** Already narrowed by `visibleRecordsForViewer`. */
  records: DailyRecord[];
  coupleId?: string;
  emptyDescription: string;
}

export function MediaArchiveGrid({ records, coupleId, emptyDescription }: MediaArchiveGridProps) {
  const cells = useMemo(() => {
    const collected: Cell[] = [];
    for (const record of records) {
      for (const [index, attachment] of (record.attachments ?? []).entries()) {
        // Voice has no frame to put in a square; it stays in the timeline.
        if (attachment.type === 'voice') continue;
        collected.push({
          record,
          attachment,
          key: `${record.id}-${attachment.path ?? attachment.name}-${index}`,
        });
      }
    }
    return collected.sort(sortNewestFirst);
  }, [records]);

  const [resolved, setResolved] = useState<Record<number, LightboxMedia | undefined>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const onResolved = useCallback((position: number, media: LightboxMedia | undefined) => {
    setResolved((current) => {
      if (current[position]?.src === media?.src) return current;
      return { ...current, [position]: media };
    });
  }, []);

  /*
   * Same remapping as the record gallery: only cells that actually signed become
   * viewer entries, and the tapped position is translated onto that filtered
   * list. Handing the raw grid position to the Lightbox opens the wrong photo as
   * soon as one file in the middle fails to sign.
   */
  const media = useMemo(
    () =>
      cells
        .map((_, position) => resolved[position])
        .filter((entry): entry is LightboxMedia => Boolean(entry)),
    [cells, resolved],
  );

  const openAt = useCallback(
    (position: number) => {
      let mapped = 0;
      for (let i = 0; i < position; i += 1) if (resolved[i]) mapped += 1;
      setLightboxIndex(mapped);
    },
    [resolved],
  );

  if (cells.length === 0) {
    return <EmptyState title="아직 사진이 없어요" description={emptyDescription} />;
  }

  return (
    <>
      {/*
        A 1px gutter, not a gap on the spacing ladder. The grid is one surface made
        of pictures rather than a list of framed cards, and anything wider reads as
        the latter -- which is the thing the editorial timeline already does better.

        The gutter is the PAGE showing through, not a background on the container.
        `bg-border` on the container drew the gutters correctly and also filled the
        empty tracks of the last row -- four photos in a three-column grid painted a
        solid two-cell block of border colour under the final row, which read as a
        broken image rather than as the end of the grid. Caught in a real capture;
        jsdom cannot see it, because it lays nothing out.
      */}
      <div className="grid grid-cols-3 gap-px rounded-surface overflow-hidden">
        {cells.map((cell, position) => (
          <GridCell
            key={cell.key}
            cell={cell}
            coupleId={coupleId}
            position={position}
            onResolved={onResolved}
            onOpen={openAt}
          />
        ))}
      </div>

      {media.length > 0 && (
        <Lightbox
          isOpen={lightboxIndex !== null}
          onOpenChange={(open) => setLightboxIndex(open ? (lightboxIndex ?? 0) : null)}
          media={media}
          index={lightboxIndex ?? 0}
          onIndexChange={setLightboxIndex}
          hasZoom
        />
      )}
    </>
  );
}
