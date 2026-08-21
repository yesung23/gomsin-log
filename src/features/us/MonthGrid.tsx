import { Star } from 'lucide-react';
import { useMediaAttachment } from '@/lib/useMediaAttachment';
import type { DayCell, MonthTexture } from '@/features/us/monthTexture';

/**
 * One month of the relationship, drawn as a texture.
 *
 * Named `MonthGrid` rather than `MonthTexture` because the data module is
 * `monthTexture.ts`, and on a case-insensitive filesystem -- which macOS is by
 * default -- `MonthTexture.tsx` and `monthTexture.ts` are the same path. TypeScript
 * resolved the import to the wrong one and the error it gave was about an unused
 * variable, which is not where anyone would look.
 *
 * Seven across because that is what fits a phone, NOT because it is a week. The
 * cells are in date order and deliberately not weekday-aligned: alignment makes
 * it a calendar, and 일정 owns the calendar because 일정 owns the future. This is
 * the past, and the past is a texture you take in at a glance rather than a table
 * you look things up in.
 *
 * Every day of the month is present. A day with nothing is quiet, not missing --
 * which is the whole reason the unit is a day (see `monthTexture.ts`).
 */

interface MonthGridProps {
  data: MonthTexture;
  coupleId?: string;
  /** Open that day. The caller decides where a day leads. */
  onOpenDay: (date: string) => void;
}

/**
 * A day that has a picture.
 *
 * Split into its own component because `useMediaAttachment` is a hook and cannot
 * be called inside the cell loop. It also means only photo days pay for the hook
 * at all -- and the URL it starts from was already signed when the record was
 * fetched, so a month of thumbnails is a month of `<img>` loads rather than a
 * month of round trips.
 */
function PhotoCell({
  cell,
  coupleId,
  label,
  onOpenDay,
}: {
  cell: DayCell;
  coupleId?: string;
  label: string;
  onOpenDay: (date: string) => void;
}) {
  const photo = cell.photo!;
  const { url, reportLoadFailure } = useMediaAttachment(photo.attachment, coupleId, photo.recordId);

  return (
    <button
      type="button"
      onClick={() => onOpenDay(cell.date)}
      aria-label={label}
      data-testid={`day-cell-${cell.date}`}
      data-kind="photo"
      className="press-response relative aspect-square w-full overflow-hidden rounded-control bg-muted"
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={reportLoadFailure}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : null}
      {/* The date stays legible over any photograph. */}
      <span className="absolute left-1 top-0.5 text-caption font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] tabular-nums">
        {cell.day}
      </span>
      {cell.special && (
        <Star size={11} className="absolute right-1 top-1 text-white fill-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" aria-hidden="true" />
      )}
      {cell.bothWrote && (
        <span aria-hidden="true" className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-white shadow" />
      )}
      {cell.isToday && (
        <span aria-hidden="true" className="absolute inset-0 rounded-control ring-2 ring-coral-strong ring-inset" />
      )}
    </button>
  );
}

/** A day without a picture. Quiet, but present. */
function PlainCell({
  cell,
  label,
  onOpenDay,
}: {
  cell: DayCell;
  label: string;
  onOpenDay: (date: string) => void;
}) {
  const empty = !cell.hasRecord && !cell.special;

  return (
    <button
      type="button"
      onClick={() => onOpenDay(cell.date)}
      aria-label={label}
      data-testid={`day-cell-${cell.date}`}
      data-kind={empty ? 'empty' : 'marked'}
      /*
        An empty day is still a button. It is not decoration -- it is a day this
        couple lived, and going there to add something to it afterwards is a real
        thing to want. Making it inert would also put holes in the tab order.
      */
      className={`press-response relative aspect-square w-full rounded-control flex flex-col items-center justify-center gap-0.5 border ${
        empty
          ? 'border-transparent bg-muted/40 text-muted-foreground/60'
          : 'border-border bg-card text-foreground'
      }`}
    >
      <span className="text-caption font-semibold tabular-nums leading-none">{cell.day}</span>
      {cell.special ? (
        <Star size={10} className="text-coral-strong fill-coral-strong" aria-hidden="true" />
      ) : cell.hasRecord ? (
        <span
          aria-hidden="true"
          /* Wider, not taller, when both wrote: it stays one mark rather than
             becoming a second kind of thing to learn. */
          className={`rounded-full bg-coral ${cell.bothWrote ? 'w-2.5 h-1.5' : 'w-1.5 h-1.5'}`}
        />
      ) : null}
      {cell.isToday && (
        <span aria-hidden="true" className="absolute inset-0 rounded-control ring-2 ring-coral-strong ring-inset" />
      )}
    </button>
  );
}

/** What a screen reader hears. The marks are decoration; this is the content. */
function cellLabel(cell: DayCell): string {
  const parts = [`${cell.day}일`];
  if (cell.isToday) parts.push('오늘');
  if (cell.special) parts.push('일정 있음');
  if (cell.bothWrote) parts.push('둘 다 기록함');
  else if (cell.hasRecord) parts.push('기록 있음');
  if (cell.photo) parts.push('사진 있음');
  if (parts.length === 1) parts.push('기록 없음');
  return parts.join(', ');
}

export function MonthGrid({ data, coupleId, onOpenDay }: MonthGridProps) {
  return (
    <div
      data-testid={`month-texture-${data.key}`}
      className="grid grid-cols-7 gap-1"
      role="group"
      aria-label={`${data.year}년 ${data.month}월`}
    >
      {data.cells.map((cell) => {
        const label = cellLabel(cell);
        return cell.photo ? (
          <PhotoCell
            key={cell.date}
            cell={cell}
            coupleId={coupleId}
            label={label}
            onOpenDay={onOpenDay}
          />
        ) : (
          <PlainCell key={cell.date} cell={cell} label={label} onOpenDay={onOpenDay} />
        );
      })}
    </div>
  );
}
